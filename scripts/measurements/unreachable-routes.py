# -*- coding: utf-8 -*-
"""Route-level reachability: every api route against every web client call.

    Usage:  python scripts/measurements/unreachable-routes.py <out.json>   (from the repo root)

A MEASUREMENT, NOT A GATE, and deliberately so. Nothing runs this automatically. It needed four
corrections before it stopped reporting working screens as unreachable, and a matcher with that history
does not belong behind a red build — the first false red teaches everyone to ignore it. Re-run it when
you want the number, read the OUTPUT rather than the count, and see IMPROVEMENTS § 1.44 for the
triaged findings and for the four false-positive classes so the next run starts ahead of this one.

Section 1.44 measured at CONTROLLER-PREFIX level and said so. Its blind spot is a controller whose
OTHER routes are called: `/sla` looked reachable because the policy routes are, while
`POST /sla/holidays` had no caller at all (that became 1.57). This is the finer grain.

Two false-positive classes had to be closed before any number here was worth reading:
  1. Auth routes go through the auth client, not `apiGet` and friends.
  2. A path built by concatenation (`/audit-trail${qs}`) normalises with a trailing wildcard the
     route does not have, so every filtered list read as uncalled.
"""
import io, os, re, json, sys

API = 'apps/api/src'
WEB = ['apps/web/lib', 'apps/web/app', 'apps/web/components']
VERBS = ('Get', 'Post', 'Patch', 'Put', 'Delete')

# Reached by something other than the web app, and correctly so. Each is a decision, not an omission.
NOT_WEB_CALLABLE = {
    ('GET', ''), ('GET', 'health'), ('GET', 'health/db'),   # liveness probes
    ('POST', 'auth/sso/*/callback'),                        # invoked by the identity provider
    ('GET', 'orgs/resolve'),                                # subdomain resolution, infrastructure
}


TEMPLATE = re.compile(r'\$\{[^{}]*\}')


def norm(path):
    path = path.strip('/')
    path = re.sub(r':[A-Za-z0-9_]+', '*', path)
    # Collapse `${...}` INNERMOST-FIRST, repeatedly.
    #
    # A single non-greedy pass is wrong on a nested template, and the common shape in this codebase is
    # nested: `/dashboards/claims${qs ? `?${qs}` : ''}`. `[^}]*` stops at the inner `}` and leaves
    # ` : ''}` behind, so all six dashboards read as unreachable — the fourth false-positive class, and
    # the one that would have put six live screens in a findings list.
    for _ in range(10):
        collapsed = TEMPLATE.sub('*', path)
        if collapsed == path:
            break
        path = collapsed
    path = re.sub(r'\?.*$', '', path)
    # Anything left after a stray brace, quote, backtick or `$` is template debris, not a path.
    #
    # `$` matters and is subtle. The path ARGUMENT capture stops at the first backtick, and a nested
    # template contains one: `/dashboards/claims${qs ? `?${qs}` : ''}` is captured as
    # `/dashboards/claims${qs ? ` — an INCOMPLETE template, so the collapse above cannot touch it, and
    # what survives is `dashboards/claims$`. Splitting on `$` yields the stem, which is the route.
    #
    # Order is load-bearing: complete templates are collapsed FIRST, so `/customers/${id}/ubos` becomes
    # `customers/*/ubos` and never reaches this split. Splitting on `$` first would truncate it to
    # `customers` and hide every sub-resource in the codebase.
    for junk in ('{', '}', '$', chr(39), chr(34), chr(96)):
        path = path.split(junk)[0]
    path = re.sub(r'\*+', '*', path)
    return path.strip('/')


def api_routes():
    out = []
    verb_re = re.compile(r"@(" + '|'.join(VERBS) + r")\(\s*(?:'([^']*)')?\s*\)")
    for root, _, files in os.walk(API):
        for f in files:
            if not f.endswith('.controller.ts'):
                continue
            p = os.path.join(root, f)
            src = io.open(p, encoding='utf-8', errors='replace').read()
            # FAILURE MODE 6, found 2026-10-22 while triaging the 20: this took the FIRST
            # `@Controller` in the file, so a file declaring TWO gave every route the first
            # prefix. `provider/provider.controller.ts` is such a file — `provider/brokerage-offices`
            # at the top and `provider/insurance-companies` below it — and the symptom was the
            # BROKERAGE administrator route printed TWICE in the findings while the COMPANY one
            # never appeared under its own name. A reader chasing the second row would have gone to
            # the wrong controller for a route that is not there.
            #
            # Measured before fixing: exactly ONE file in the api declares more than one
            # `@Controller`, so this corrects two labels and moves no count — both rows stay
            # unreached by this matcher, for a reason recorded in the triage rather than here.
            #
            # Attribution is POSITIONAL: each route takes the nearest preceding prefix. The
            # alternative — one prefix per file — is what was wrong.
            prefixes = [(m.start(), m.group(1)) for m in
                        re.finditer(r"@Controller\(\s*'([^']*)'", src)]
            for vm in verb_re.finditer(src):
                verb, sub = vm.group(1), vm.group(2) or ''
                prefix = ''
                for at, value in prefixes:
                    if at < vm.start():
                        prefix = value
                    else:
                        break
                full = '/'.join(x for x in (prefix, sub) if x)
                out.append((verb.upper(), norm(full), p.replace('\\', '/')))
    return out


CALL = re.compile(
    r"(api(?:Get|PostFormData|Post|Patch|Put|Delete|FetchBlob)|authFetch|apiFetch|request)"
    r"\s*<[^>]*>\s*\(|"
    r"(api(?:Get|PostFormData|Post|Patch|Put|Delete|FetchBlob)|authFetch|apiFetch|request)\s*\("
)
PATHARG = re.compile(r"^\s*([`'\"])(.*?)\1", re.S)

# FAILURE MODE 5, found 2026-09-28: PATHARG is anchored at `^`, so it only matches a first
# argument that BEGINS with a quote. A ternary does not:
#
#     apiGet(
#       category
#         ? `/knowledge-base-articles?category=${encodeURIComponent(category)}`
#         : '/knowledge-base-articles',
#     )
#
# The match failed, the call was skipped, and the path counted as addressed by nothing. This
# pass is verb-AGNOSTIC so it usually survives — some other call POSTs the same path with a
# bare literal and the path reads as reached. The VERB-AWARE pass does not: it separates GET
# from POST, so a path POSTed with a literal and GET through a ternary reads as "GET
# unreachable". That produced two false positives, and one of them had been recorded in
# CLAUDE.md as a hand-CHECKED finding (`GET /knowledge-base-articles`).
#
# So scan the whole FIRST argument for path-like literals instead of requiring it to start
# with one. Bounded at the first top-level comma, because argument two is a request body and
# a string inside it is not a path.
_STRLIT = re.compile(
    r"([`'" + '"' + r"])((?:" + (chr(92) * 2) + r".|(?!" + chr(92) + r"1)[^" + (chr(92) * 2) + r"])*)" + chr(92) + r"1",
    re.S,
)


def first_arg_paths(text):
    """Every '/'-leading string literal in the first argument of a call whose '(' was consumed."""
    depth = 0
    end = len(text)
    for i, ch in enumerate(text):
        if ch in '([{':
            depth += 1
        elif ch in ')]}':
            if depth == 0:
                end = i
                break
            depth -= 1
        elif ch == ',' and depth == 0:
            end = i
            break
    return [m.group(2) for m in _STRLIT.finditer(text[:end]) if m.group(2).startswith('/')]


# FAILURE MODE 7, found 2026-10-22 and fixed 2026-10-23: A PATH BUILT IN A HELPER.
#
#     export function invitePathFor(organizationType, organizationId) {
#       switch (organizationType) {
#         case 'BROKERAGE_OFFICE':
#           return `/provider/brokerage-offices/${organizationId}/administrator`;
#         case 'INSURANCE_COMPANY':
#           return `/provider/insurance-companies/${organizationId}/administrator`;
#       }
#     }
#     export function inviteOrganizationAdministrator(...) {
#       return apiPost<InvitedAdministrator>(invitePathFor(organizationType, organizationId), input);
#     }
#
# The first argument is a FUNCTION CALL, so it contains no string literal at all and
# `first_arg_paths` returns nothing — both administrator routes read as addressed by nothing. That
# was reported as a finding and then disproved by hand, which is what register entry 113 records,
# and it is the same family as failure mode 5 (a ternary) one step further out: the path is in the
# file, just not in the argument.
#
# ONE LEVEL, DELIBERATELY. If the first argument is a bare call to a function DECLARED IN THE SAME
# FILE, that function's own body is scanned for path literals. Two levels is not attempted and
# cross-file resolution is not attempted, because each would need a real import graph and a matcher
# that has been wrong in BOTH directions does not get to grow a new way to be confidently right.
#
# AND WHAT IS STILL INVISIBLE IS COUNTED RATHER THAN IGNORED — see `UNRESOLVED_FIRST_ARGS`. A
# matcher that cannot see something must say so: silent blindness is the shape that produced four
# wrong measurements in this repository, and a declared gap is a different thing from a hidden one.
_HELPER_CALL = re.compile(r'^\s*([A-Za-z_$][\w$]*)\s*\(')

_HELPER_DECL = (
    r'(?:export\s+)?(?:async\s+)?function\s+%s\s*[(<]'
    r'|(?:export\s+)?const\s+%s\s*(?::[^=]*)?=\s*(?:async\s*)?[(<]'
)


def _balanced_body(src, start):
    """The text from the first `{` at or after `start` to its matching `}`."""
    opened = src.find('{', start)
    if opened == -1:
        return ''
    depth = 0
    for i in range(opened, len(src)):
        if src[i] == '{':
            depth += 1
        elif src[i] == '}':
            depth -= 1
            if depth == 0:
                return src[opened:i + 1]
    return ''


def helper_paths(src, name):
    """Path literals returned by a function of this name declared in this same file."""
    pattern = _HELPER_DECL % (re.escape(name), re.escape(name))
    decl = re.search(pattern, src)
    if not decl:
        return []
    body = _balanced_body(src, decl.end())
    if not body:
        return []
    return [m.group(2) for m in _STRLIT.finditer(body) if m.group(2).startswith('/')]


def resolve_first_arg_paths(src, after_paren):
    """Path literals for one client call: in the argument, else in a same-file helper it names.

    Returns `(paths, resolved)`. `resolved` is False only when NOTHING could be read — which is
    what `UNRESOLVED_FIRST_ARGS` reports, so the matcher's remaining blindness is a number on the
    report rather than an absence nobody can see.
    """
    direct = first_arg_paths(after_paren)
    if direct:
        return direct, True
    call = _HELPER_CALL.match(after_paren)
    if call:
        borrowed = helper_paths(src, call.group(1))
        if borrowed:
            return borrowed, True
    return [], False



def web_calls():
    """Verb-agnostic: every path STRING passed as the first argument of a client call.

    Verb-agnostic on purpose. Matching the verb too would need the caller's own helper name to map
    reliably onto a method, and `apiFetch`/`request` take it as an option. The question this answers
    is "does any web code address this path at all", which is 1.44's own question.
    """
    paths = set()
    unresolved = 0
    for base in WEB:
        for root, _, files in os.walk(base):
            if 'node_modules' in root or '.next' in root:
                continue
            for f in files:
                if not f.endswith(('.ts', '.tsx')):
                    continue
                src = io.open(os.path.join(root, f), encoding='utf-8', errors='replace').read()
                for m in CALL.finditer(src):
                    # WAS `PATHARG.match(...)`, WHICH IS ANCHORED AT `^` AND READ ONLY AN ARGUMENT
                    # BEGINNING WITH A QUOTE. Failure mode 5 was fixed for the VERB-AWARE pass and
                    # left here, so this pass still could not see a ternary or a helper — it
                    # survived on being verb-agnostic (some sibling call POSTs the same path with a
                    # bare literal, so the path read as reached), which is luck rather than
                    # correctness. Both passes share one resolver now.
                    found, resolved = resolve_first_arg_paths(src, src[m.end():])
                    if not resolved:
                        unresolved += 1
                        continue
                    for raw in found:
                        p = norm(raw)
                        if not p:
                            continue
                        paths.add(p)
                        # Also record every wildcard-free stem, so a concatenated querystring or a
                        # sub-resource does not hide the parent route.
                        stem = p
                        while stem.endswith('*'):
                            stem = stem[:-1].strip('/')
                            if stem:
                                paths.add(stem)
    return paths, unresolved


routes = api_routes()
paths, UNRESOLVED_FIRST_ARGS = web_calls()
print('api routes       :', len(routes))
print('web path shapes  :', len(paths))
# DECLARED BLINDNESS. Every client call whose first argument yielded no path even after one level of
# helper resolution. These are calls this matcher CANNOT read, so any route only they address will be
# reported as unreachable and will be a false positive. Printed rather than suppressed: the brief's
# own instruction is that silent blindness is worse than a declared gap, and this repository has paid
# four times for a matcher that reported a clean nothing.
print('unreadable calls :', UNRESOLVED_FIRST_ARGS)

def segments_match(web, api):
    """Segment-by-segment, where a wildcard on EITHER side matches anything.

    The discard client posts to `/${collection}/${id}/discard`, so its leading segment is a variable
    too. Compared literally that never matches `claims/*/discard`, and every one of the four discard
    routes read as unreachable — the third false-positive class, and the one 1.44 named as the
    method's blind spot without generalising past it.
    """
    a, b = web.split('/'), api.split('/')
    if len(a) != len(b):
        return False
    return all(x == '*' or y == '*' or x == y for x, y in zip(a, b))


unreached = []
for verb, path, f in routes:
    if path in paths or (verb, path) in NOT_WEB_CALLABLE:
        continue
    # The web may address a LONGER path whose stem is this route.
    if any(c.startswith(path + '/') for c in paths):
        continue
    if any(segments_match(c, path) for c in paths):
        continue
    unreached.append((verb, path, f))

by_file = {}
for verb, path, f in unreached:
    by_file.setdefault(f.replace('apps/api/src/modules/', ''), []).append(verb + ' /' + path)

print('')
print('UNREACHED:', len(unreached), 'routes across', len(by_file), 'controllers')
print('')
for f in sorted(by_file):
    print(f)
    for r in sorted(by_file[f]):
        print('    ', r)

_positional = [a for a in sys.argv[1:] if not a.startswith('--')]
if _positional:
    io.open(_positional[0], 'w', encoding='utf-8').write(
        json.dumps({'routes': len(routes), 'unreached': by_file}, indent=1, ensure_ascii=False))

# ---------------------------------------------------------------------------- the ratchet
#
# Decision 34's fault (3): every capability a role holds must have a route to it. This is the
# BY-PATH half; `unreachable-routes-by-verb.py` carries the other nine, and the two numbers are
# gated separately because they are found by different matchers and a single total would hide one
# matcher breaking.
#
# ## A COUPLING THAT HAS TO BE SAID OUT LOUD
#
# This file has no `if __name__ == '__main__'` guard: `unreachable-routes-by-verb.py` IMPORTS it to
# borrow `api_routes()` and `segments_match()`, which runs this whole body. That sibling fakes
# `sys.argv` to `[origin, os.devnull]`, so `--check` is absent there and the branch below cannot
# fire inside it. If that ever changes, a `sys.exit(1)` here would kill the sibling's process and
# the sibling would report nothing while exiting non-zero — which reads like its own failure.
#
# ## WHAT A MOVE MEANS, IN BOTH DIRECTIONS
#
# UP means a new route nothing calls: a capability nobody can exercise. That class shipped here for
# weeks with every gate green — the insurer screens, the email mailbox, the customer import — which
# is why it is gated rather than surveyed.
#
# DOWN means one was closed or correctly reclassified, and the budget follows it so the improvement
# cannot be silently given back.
#
# Measured 2026-10-22: 530 api routes against 399 web path shapes, 20 unreached across 11
# controllers. Matched the screen-pass measurement document.
#
# ## 20 -> 18 AND 11 -> 10 ON 2026-10-23, AND THE INSTRUMENT MOVED, NOT THE CODEBASE
#
# Re-measured after FAILURE MODE 7 was fixed: 531 api routes (the one new route this batch added)
# against 402 web path shapes, **18 unreached across 10 controllers**. Both rows that left were the
# administrator invitations, whose path `invitePathFor()` returns and `apiPost` receives as a
# function call — reported as a finding on 2026-10-22, disproved by hand the same day, and recorded
# in `docs/deferred-register.md` entry 113 as **"the true by-path figure is 18 across 10"**. That
# entry also says the budgets were LEFT at 20 and 11 deliberately, because lowering a ratchet onto
# an uncorrected instrument is worse than holding it at a number whose error is written down. The
# instrument is corrected now, so the number follows — which is the whole reason the DOWN direction
# fails too.
#
# NOTHING WAS CLOSED TO EARN THIS. Two false positives were removed. That distinction matters to
# whoever reads these two numbers next: a drop here can mean a capability was connected OR that the
# matcher stopped being wrong, and only one of those is progress on decision 34's fault (3).
#
# 18 -> 16 ON 2026-10-23, AND THIS ONE IS THE OTHER KIND OF DROP — owner decision 43, the first time
# these two numbers have moved because something was WIRED rather than because the matcher stopped
# being wrong. `GET /retention-notices/register` (the extension register) and
# `GET /retention-archive/bases` now have readers on `/retention-disposal`. The distinction the
# paragraph above insists on is therefore live: that move was an instrument correction, this one is
# progress on decision 34's fault (3), and the two must not be read as the same event.
# 16 -> 14 in the next commit of the same batch: `GET /imports/customers/batches` and
# `.../batches/:id` — the durable customer-import report, which had been a RECORDED defect since
# 2026-10-02 ("THE DURABLE REPORT HAS NO SCREEN") rather than something this triage discovered.
UNREACHED_BY_PATH_BUDGET = 14
# 11 -> 10 in the same move. `provider.controller.ts` leaves the list entirely, which is also the
# controller whose TWO `@Controller` prefixes failure mode 6 collapsed into one — so the file that
# produced both of this measurement's known defects is the file both fixes remove from the findings.
#
# 10 -> 8 on 2026-10-23: `retention-notice.controller.ts` and `retention-archive.controller.ts` each
# carried exactly ONE unreached route, so wiring two routes took two controllers off the list. That
# is why this count is gated separately — two routes and two controllers moving together is a
# different fact from two routes leaving one controller, and a single total cannot tell them apart.
# 8 -> 7: `legacy-import.controller.ts` carried exactly those two and nothing else.
UNREACHED_CONTROLLER_BUDGET = 7

# Blank is not zero, in BOTH tables. A route parser that breaks reports zero unreached (nothing to
# compare) and a web parser that breaks reports every route unreached — so the floor is on both
# sides, and the second failure is the one that looks like a catastrophe rather than a clean run.
_MINIMUM_API_ROUTES = 400
_MINIMUM_WEB_PATHS = 300

if '--check' in sys.argv:
    _fail = False
    if len(routes) < _MINIMUM_API_ROUTES:
        print('')
        print('unreachable-routes: REFUSED — only %d api route(s) parsed against a floor of %d. '
              'The controller matcher has drifted and "0 unreached" would be meaningless.'
              % (len(routes), _MINIMUM_API_ROUTES))
        _fail = True
    if len(paths) < _MINIMUM_WEB_PATHS:
        print('')
        print('unreachable-routes: REFUSED — only %d web path shape(s) parsed against a floor of '
              '%d. With the web side empty EVERY route reads as unreachable, which is a broken '
              'parser wearing the costume of a catastrophe.' % (len(paths), _MINIMUM_WEB_PATHS))
        _fail = True

    if not _fail:
        if len(unreached) > UNREACHED_BY_PATH_BUDGET:
            print('')
            print('unreachable-routes: FAILED — %d route(s) addressed by no web code, against a '
                  'budget of %d.' % (len(unreached), UNREACHED_BY_PATH_BUDGET))
            print('A route nothing calls is a capability nobody can exercise. Build the way in, or '
                  'record the route as redundant surface — but do not leave a role holding a code '
                  'whose act it cannot reach.')
            print('Do NOT raise the budget.')
            _fail = True
        elif len(unreached) < UNREACHED_BY_PATH_BUDGET:
            print('')
            print('unreachable-routes: FAILED — only %d remain, so lower UNREACHED_BY_PATH_BUDGET '
                  'to %d.' % (len(unreached), len(unreached)))
            print('This half is what stops the ratchet becoming a ceiling.')
            _fail = True

        if len(by_file) != UNREACHED_CONTROLLER_BUDGET:
            print('')
            print('unreachable-routes: FAILED — %d controller(s) carry an unreached route, against '
                  'a declared %d. Set UNREACHED_CONTROLLER_BUDGET to %d if that is the intent.'
                  % (len(by_file), UNREACHED_CONTROLLER_BUDGET, len(by_file)))
            print('The controller count is gated beside the route count because the two can move '
                  'in opposite directions: closing two routes in one controller and opening two in '
                  'a fresh one leaves the total unchanged and is not the same codebase.')
            _fail = True

    if _fail:
        sys.exit(1)
    print('')
    print('unreachable-routes: at its declared budget — %d route(s) across %d controller(s).'
          % (UNREACHED_BY_PATH_BUDGET, UNREACHED_CONTROLLER_BUDGET))
