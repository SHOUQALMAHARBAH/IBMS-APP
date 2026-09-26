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
            m = re.search(r"@Controller\(\s*'([^']*)'", src)
            prefix = m.group(1) if m else ''
            for vm in verb_re.finditer(src):
                verb, sub = vm.group(1), vm.group(2) or ''
                full = '/'.join(x for x in (prefix, sub) if x)
                out.append((verb.upper(), norm(full), p.replace('\\', '/')))
    return out


CALL = re.compile(
    r"(api(?:Get|Post|Patch|Put|Delete|FetchBlob)|authFetch|apiFetch|request)"
    r"\s*<[^>]*>\s*\(|"
    r"(api(?:Get|Post|Patch|Put|Delete|FetchBlob)|authFetch|apiFetch|request)\s*\("
)
PATHARG = re.compile(r"^\s*([`'\"])(.*?)\1", re.S)


def web_calls():
    """Verb-agnostic: every path STRING passed as the first argument of a client call.

    Verb-agnostic on purpose. Matching the verb too would need the caller's own helper name to map
    reliably onto a method, and `apiFetch`/`request` take it as an option. The question this answers
    is "does any web code address this path at all", which is 1.44's own question.
    """
    paths = set()
    for base in WEB:
        for root, _, files in os.walk(base):
            if 'node_modules' in root or '.next' in root:
                continue
            for f in files:
                if not f.endswith(('.ts', '.tsx')):
                    continue
                src = io.open(os.path.join(root, f), encoding='utf-8', errors='replace').read()
                for m in CALL.finditer(src):
                    arg = PATHARG.match(src[m.end():])
                    if not arg:
                        continue
                    p = norm(arg.group(2))
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
    return paths


routes = api_routes()
paths = web_calls()
print('api routes       :', len(routes))
print('web path shapes  :', len(paths))

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

io.open(sys.argv[1], 'w', encoding='utf-8').write(
    json.dumps({'routes': len(routes), 'unreached': by_file}, indent=1, ensure_ascii=False))
