"""Can a holder of this role OPEN this screen and have it actually WORK?

## THE DEFECT THIS EXISTS TO MAKE UNSHIPPABLE

The owner opened `/provider-register-office` as the platform operator and found eight empty
dropdowns. The page returned 200. The nav entry was visible. Her permission to open it was correct.
And the screen could not be used, because one of its two supporting calls — `GET /insurance-lines` —
is gated on `insurer.read`, an OFFICE permission the platform operator does not hold and must not be
given.

So the class is: **a screen whose supporting routes require permissions its intended users cannot
hold.** It is invisible to every check that asks whether a page loaded, because the page loads. It is
invisible to a nav-reachability check, because the nav entry is right. And it is invisible to the api
e2e suite, because each route is correctly gated when asked about on its own.

A check that only asked "can this role open this screen" would have PASSED the exact defect she
found. So this one asks the harder question: for every (role, screen) pair the role can open, does
every route that screen calls resolve for that role?

## HOW A SCREEN'S ROUTES ARE DERIVED

Three hops, because nothing in the codebase states it directly:

  page.tsx  --imports-->  lib/**/*-api.ts function  --calls-->  apiGet('/path')

So this builds a function -> {(verb, path)} map over every `lib/**` module, reads each screen's
import list, and unions the routes of the functions it imports. A function imported but never called
counts as called: `no-unused-vars` is an error in this workspace, so an imported-and-unused client
function does not survive lint, and treating an import as a call is therefore sound here and much
more robust than trying to decide reachability inside JSX.

## WHAT COUNTS AS A FAILURE, AND WHY THE BAR IS WHERE IT IS

A route is SATISFIED for a role if the role holds ANY of the codes the route names — because
`PermissionsGuard` ORs them (`required.some`), which is the semantics, not a convenience.

A (role, screen) pair FAILS if the role can open the screen and at least one route it calls is NOT
satisfied. The page returning 200 and rendering empty is the failure, not the exception.

## WHAT IT CANNOT KNOW, STATED SO THE OUTPUT IS NOT OVER-READ

It cannot tell a route called ON MOUNT from one called behind a button. A screen whose write route
refuses a read-only role is CORRECT — that is the reduced-capability shape this product uses
deliberately — so the output separates the two by METHOD: a refused GET is almost always a real
defect (the screen cannot render), a refused write is usually correct (the control should not be
offered). Both are printed; only the GET failures are counted against the gate, and the writes are
listed as declarable.

That split is the whole reason this is reportable rather than automatic: some refusals need
DECLARING on screen, not widening, and that distinction is the owner's.

Usage:  python scripts/measurements/screen-route-permission-fit.py [--json out.json]
Exit 1 if any role/screen pair cannot RENDER. Exit 0 otherwise.
"""

import glob
import io
import json
import os
import re
import sys

ROOT = os.getcwd()
WEB_APP = os.path.join("apps", "web", "app")
WEB_LIB = os.path.join("apps", "web", "lib")
API_SRC = os.path.join("apps", "api", "src")
DESTINATIONS = os.path.join("apps", "web", "components", "app", "destinations.ts")
GRID = os.path.join("packages", "db", "prisma", "seed-data", "permissions.ts")

VERBS = ("Get", "Post", "Patch", "Put", "Delete")
READ_VERBS = {"GET"}

# ---------------------------------------------------------------------------- api side


def collapse_interpolations(path):
    """Replace every BALANCED `${...}` with `*`, counting braces so a nested one does not truncate.

    `[^}]*` was not enough: `${qs ? `?${qs}` : ''}` contains a `}` in the middle, so a lazy match
    ended at the wrong brace and left the tail behind. That is half of why 49 paths could not be
    resolved.
    """
    out = []
    i = 0
    while i < len(path):
        if path.startswith("${", i):
            depth = 1
            j = i + 2
            while j < len(path) and depth:
                if path[j] == "{":
                    depth += 1
                elif path[j] == "}":
                    depth -= 1
                j += 1
            out.append("*")
            i = j
        else:
            out.append(path[i])
            i += 1
    return "".join(out)


def norm(path):
    """`/customers/${id}/ubos` -> `customers/*/ubos`; `:id` -> `*`; a trailing querystring is dropped.

    THE TRAILING `*` IS DROPPED, and that is the other half of the 49.

    `/audit-trail${qs ? `?${qs}` : ''}` collapses to `/audit-trail*`, and `/renewal-cases${suffix}`
    to `/renewal-cases*` — but in both the interpolation is a QUERYSTRING, not a path segment, so
    the route is `/audit-trail` and `/renewal-cases`. A `*` in the MIDDLE is a real segment
    (`/customers/*/ubos`) and stays.

    This cannot confuse the two: a path parameter is always followed by more path, so it is never
    the last thing in the string. A trailing interpolation is a suffix the caller appends, which in
    this codebase is always `?...` or an empty string.
    """
    path = collapse_interpolations(path)
    path = re.sub(r":[A-Za-z_][\w]*", "*", path)
    path = path.split("?")[0]
    path = re.sub(r"\*+", "*", path)
    # THE TRAILING `*` IS A QUERYSTRING ONLY WHEN IT IS NOT A SEGMENT, and the discriminator is the
    # character before it. My first version stripped every trailing `*` on the theory that a
    # trailing interpolation is always a suffix — which was FALSE for
    # `/admin/users/${id}/${isActive ? 'activate' : 'deactivate'}`, where the last interpolation IS
    # a path segment. Two routes stayed unresolved because of it.
    #
    #   /audit-trail*      -> `*` follows `l`, so it is glued to the segment: a querystring. Strip.
    #   /admin/users/*/*   -> `*` follows `/`, so it is its own segment. Keep.
    if path.endswith("*") and not path.endswith("/*"):
        path = path[:-1]
    path = path.rstrip("/")
    return path.strip("/")


def api_routes():
    """(verb, normalised path) -> sorted list of required codes (ANY-OF), plus the controller."""
    out = {}
    verb_re = re.compile(
        r"@RequirePermissions\(([^)]*)\)|@(" + "|".join(VERBS) + r")\(\s*(?:'([^']*)')?\s*\)"
    )
    for root, _, files in os.walk(API_SRC):
        for f in files:
            if not f.endswith(".controller.ts"):
                continue
            p = os.path.join(root, f)
            src = io.open(p, encoding="utf-8", errors="replace").read()
            # ONE PREFIX PER CLASS, NOT PER FILE. `provider.controller.ts` declares TWO
            # `@Controller`s — `provider/brokerage-offices` and `provider/insurance-companies` — and
            # taking the first match for the whole file gave every company route the office prefix.
            # That is why `POST /provider/insurance-companies` read as addressed by no controller
            # while being one of only two routes in this product that create a tenant. Measured: it
            # is the only file in the api with more than one, which is exactly why a single-match
            # parser survived this long.
            sections = re.split(r"(?=@Controller\()", src)
            for section in sections:
                # A BARE `@Controller()` IS LEGAL AND COMMON — `kyc.controller.ts` and
                # `sales-performance.controller.ts` both use it, mounting their routes at the root.
                # Requiring a quoted prefix to recognise a controller section made this parser SKIP
                # those files entirely, which turned three resolvable paths into unresolved ones. So
                # the test is whether the section IS a controller, and the prefix is empty when it
                # declares none.
                if not section.startswith("@Controller("):
                    continue
                cm = re.match(r"@Controller\(\s*'([^']*)'", section)
                prefix = cm.group(1) if cm else ""
                _collect_routes(section, prefix, p, verb_re, out)
    return out


def _collect_routes(src, prefix, p, verb_re, out):
            pending = None
            for m in verb_re.finditer(src):
                if m.group(1) is not None:
                    pending = sorted(set(re.findall(r"'([^']+)'", m.group(1))))
                    continue
                verb, sub = m.group(2).upper(), m.group(3) or ""
                full = norm("/".join(x for x in (prefix, sub) if x))
                out[(verb, full)] = {
                    "codes": pending or [],
                    "controller": p.replace(os.sep, "/"),
                }
                pending = None


# ---------------------------------------------------------------------------- web side

CALL = re.compile(r"\bapi(Get|Post|Patch|Put|Delete|PostFormData|FetchBlob)\s*(?:<[^>]*>)?\s*\(")
# A plain-quoted literal. Template literals are scanned separately, because a nested one
# (`` `/a${x ? `?${x}` : ''}` ``) terminates this pattern at the INNER backtick and hands back a
# truncated path — which is exactly how 49 routes came to be unresolvable.
_STR = re.compile(r"(['\"])((?:\\.|(?!\1)[^\\])*)\1", re.S)


def _template_literals(text):
    """Every backtick template in `text`, with nesting counted rather than assumed away."""
    out = []
    i = 0
    while i < len(text):
        if text[i] != "`":
            i += 1
            continue
        j = i + 1
        depth = 0
        while j < len(text):
            c = text[j]
            if c == "\\":
                j += 2
                continue
            if text.startswith("${", j):
                depth += 1
                j += 2
                continue
            if c == "}" and depth:
                depth -= 1
            elif c == "`" and depth == 0:
                break
            elif c == "`" and depth:
                # A nested template inside an interpolation: skip to ITS close.
                k = j + 1
                while k < len(text) and text[k] != "`":
                    k += 1
                j = k
            j += 1
        out.append(text[i + 1 : j])
        i = j + 1
    return out


def first_arg_literals(text):
    depth = 0
    end = len(text)
    for i, ch in enumerate(text):
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            if depth == 0:
                end = i
                break
            depth -= 1
        elif ch == "," and depth == 0:
            end = i
            break
    window = text[:end]
    found = [m.group(2) for m in _STR.finditer(window) if m.group(2).startswith("/")]
    found += [lit for lit in _template_literals(window) if lit.startswith("/")]
    return found


def client_functions():
    """exported client function name -> set of (verb, normalised path) it calls."""
    out = {}
    for path in glob.glob(os.path.join(WEB_LIB, "**", "*.ts"), recursive=True):
        if path.endswith(".spec.ts") or path.endswith(".test.ts"):
            continue
        src = io.open(path, encoding="utf-8", errors="replace").read()
        # Split the module into exported function bodies by their declarations, in order.
        decls = list(
            re.finditer(
                r"export\s+(?:async\s+)?function\s+([A-Za-z_]\w*)|"
                r"export\s+const\s+([A-Za-z_]\w*)\s*(?::[^=]*)?=\s*(?:async\s*)?\(",
                src,
            )
        )
        for i, d in enumerate(decls):
            name = d.group(1) or d.group(2)
            body = src[d.end() : decls[i + 1].start() if i + 1 < len(decls) else len(src)]
            routes = set()
            for cm in CALL.finditer(body):
                verb = cm.group(1).upper()
                if verb == "POSTFORMDATA":
                    verb = "POST"
                if verb == "FETCHBLOB":
                    verb = "GET"
                for lit in first_arg_literals(body[cm.end() :]):
                    routes.add((verb, norm(lit)))
            if routes:
                out.setdefault(name, set()).update(routes)
    return out


def screens():
    for path in sorted(glob.glob(os.path.join(WEB_APP, "**", "page.tsx"), recursive=True)):
        rel = path[len(WEB_APP) :].replace(os.sep, "/")[: -len("/page.tsx")]
        rel = re.sub(r"/\([^)]*\)", "", rel)
        yield (rel or "/"), path


def screen_imports(src):
    names = set()
    for m in re.finditer(r"import\s*\{([^}]*)\}\s*from\s*'([^']*)'", src, re.S):
        if "/lib/" not in m.group(2) and not m.group(2).startswith("."):
            continue
        for raw in m.group(1).split(","):
            n = raw.strip().split(" as ")[0].strip()
            if n and not n.startswith("type "):
                names.add(n)
    return names


def screen_open_codes(src):
    """Codes the screen itself requires to render anything, from its own gate."""
    codes = set(re.findall(r"hasPermission\(\s*user\s*,\s*'([^']+)'", src))
    for m in re.finditer(r"hasAnyPermission\(\s*user\s*,\s*\[([^\]]*)\]", src):
        codes.update(re.findall(r"'([^']+)'", m.group(1)))
    return codes


# A permission code as this codebase spells them: dotted, lower-case, at least one dot.
CODE_LITERAL = re.compile(r"['\"]([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)['\"]")


def screen_mentions(src):
    """Every permission code the screen NAMES anywhere.

    THIS IS THE CONDITION THAT SEPARATES A DEFECT FROM A DELIBERATE SECTION GATE, and the first
    version of this measurement lacked it — reporting 113 render failures, most of them correct.

    A screen that NAMES a code is a screen that knows about it: it gates a section on it, or renders
    `permissionRefusal(t, '...Act', 'code')` for it, or hides a control. A route refused for a code
    the screen never mentions is the other thing entirely — an unconditional call the screen cannot
    be handling, which is exactly `/provider-register-office` calling `GET /insurance-lines` while
    testing only `provider.office.register`.

    So: the role can open it, the route refuses, and the screen never asks about why. That triple is
    the owner's defect and it is what this counts.
    """
    return set(CODE_LITERAL.findall(src))


def destinations():
    """route -> (any-of codes, organizationTypes or None)."""
    src = io.open(DESTINATIONS, encoding="utf-8").read()
    out = {}
    parts = src.split("href:")
    for chunk in parts[1:]:
        hm = re.match(r"\s*'([^']+)'", chunk)
        if not hm:
            continue
        href = hm.group(1)
        stop = chunk.find("href:")
        window = chunk if stop == -1 else chunk[:stop]
        pm = re.search(r"permissions:\s*\[([^\]]*)\]", window)
        codes = sorted(set(re.findall(r"'([^']+)'", pm.group(1)))) if pm else []
        om = re.search(r"organizationTypes:\s*\[([^\]]*)\]", window)
        types = sorted(set(re.findall(r"'([^']+)'", om.group(1)))) if om else None
        out[href] = (codes, types)
    assert len(out) > 40, "parsed only %d destinations — the matcher drifted" % len(out)
    return out


# ---------------------------------------------------------------------------- roles


def role_codes():
    """seeded role name -> set of codes, read from the GRID, which is the one home.

    The grid names roles through aliases in BOTH spellings — `const ADMIN = RoleName.SYSTEM_...;`
    for the legacy eleven and `const OFFICE_ADMIN = "OFFICE_ADMINISTRATOR";` for the one that enum
    cannot name. The first version of this parser read only single-quoted literals and resolved ZERO
    roles, which its own non-vacuity assertion caught rather than reporting a clean sweep.
    """
    src = io.open(GRID, encoding="utf-8").read()
    # STRIP COMMENTS FIRST. The grid's entry for `provider.office-state.read` explains, IN A COMMENT,
    # that the code used to read `roles: [ADMIN]` before the PROVIDER type existed — and the parser
    # matched that sentence instead of the real `roles: []` four lines below, attributing a
    # PLATFORM-scoped code to the security administrator. A comment that quotes code is the window
    # artefact this repository keeps recording; here it reached a measurement's output.
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"(?m)^\s*//.*$", "", src)
    aliases = {}
    for m in re.finditer(r"const\s+([A-Z][A-Z_0-9]*)\s*=\s*RoleName\.([A-Z_]+)\s*;", src):
        aliases[m.group(1)] = m.group(2)
    for m in re.finditer(r"const\s+([A-Z][A-Z_0-9]*)\s*=\s*[\"']([A-Z_]+)[\"']\s*;", src):
        aliases[m.group(1)] = m.group(2)
    assert len(aliases) >= 10, "parsed only %d role aliases" % len(aliases)

    out = {}
    # Split on the entry boundary FIRST so a `roles:` lookahead can never cross into the next code.
    chunks = src.split("code:")
    for chunk in chunks[1:]:
        cm = re.match(r"\s*[\"']([^\"']+)[\"']", chunk)
        if not cm:
            continue
        code = cm.group(1)
        rm = re.search(r"roles:\s*\[([^\]]*)\]", chunk)
        if not rm:
            continue
        for tok in re.findall(r"[A-Za-z_][\w]*", rm.group(1)):
            name = aliases.get(tok)
            if name:
                out.setdefault(name, set()).add(code)
    assert len(out) >= 10, "parsed only %d roles from the grid" % len(out)
    return out


# PROVIDER-SIDE ROLES are not in the office grid: the seed creates PLATFORM_OPERATOR and the company
# administrator from their own explicit code lists, which is why they are read from there instead of
# being inferred. This is the exact pair the owner's defect involved, so getting it from the real
# source matters more here than anywhere else.
def provider_role_codes():
    """The two roles the office grid does not contain, read from where the seed declares them.

    `PLATFORM_OPERATOR` and `INSURANCE_COMPANY_ADMINISTRATOR` are created from explicit code lists
    rather than from the grid, because an OFFICE-scoped grid cannot express them. This is the exact
    pair the owner's defect involved, so reading them from the real declaration rather than inferring
    them matters more here than anywhere else.
    """
    out = {}
    seed = os.path.join("packages", "db", "prisma", "seed.ts")
    if os.path.exists(seed):
        src = io.open(seed, encoding="utf-8").read()
        m = re.search(r"PROVIDER_CODES[^=]*=\s*\[(.*?)\]", src, re.S)
        if m:
            codes = set(re.findall(r"[\"']([a-z][a-z0-9.\-]*\.[a-z0-9.\-]+)[\"']", m.group(1)))
            if codes:
                out["PLATFORM_OPERATOR"] = codes
    grants = os.path.join(
        API_SRC, "modules", "provider", "insurance-company-administrator-grants.ts"
    )
    if os.path.exists(grants):
        src = io.open(grants, encoding="utf-8").read()
        codes = set(re.findall(r"[\"']([a-z][a-z0-9.\-]*\.[a-z0-9.\-]+)[\"']", src))
        if codes:
            out["INSURANCE_COMPANY_ADMINISTRATOR"] = codes
    assert out, "resolved neither provider-side role"
    return out


# ---------------------------------------------------------------------------- the question


def resolve(routes, verb, rpath):
    """Every controller route a web call could be addressing, as (key, info) pairs.

    Usually exactly one. The exception is a call whose FINAL segment is interpolated:

        apiPost(`/admin/users/${id}/${isActive ? 'activate' : 'deactivate'}`)

    which normalises to `admin/users/*/*` and is addressing two different routes. Those were the last
    two of the 49 unresolved paths, and listing them as matcher gaps would have been wrong — they are
    resolvable, just not to ONE route. So a trailing `*` segment expands to every controller route
    that shares the prefix and has one more segment, and the caller requires ALL of them to pass.
    """
    exact = routes.get((verb, rpath))
    if exact is not None:
        return [((verb, rpath), exact)]
    if not rpath.endswith("/*"):
        return []
    prefix = rpath[: -len("/*")]
    depth = len(prefix.split("/")) + 1
    out = []
    for (v, path), info in routes.items():
        if v != verb or not path.startswith(prefix + "/"):
            continue
        if len(path.split("/")) == depth:
            out.append(((v, path), info))
    return out


def satisfied(codes, held):
    """ANY-OF, because PermissionsGuard is `required.some`. No codes = open to any authenticated user."""
    return (not codes) or any(c in held for c in codes)


def main():
    routes = api_routes()
    fns = client_functions()
    dests = destinations()
    roles = role_codes()
    roles.update(provider_role_codes())

    unresolved_paths = set()
    render_failures = []
    action_refusals = []
    handled_refusals = []
    ungated_screens = []
    screens_examined = 0
    pairs_examined = 0

    for route, path in screens():
        src = io.open(path, encoding="utf-8", errors="replace").read()
        called = set()
        for name in screen_imports(src):
            called |= fns.get(name, set())
        if not called:
            continue
        screens_examined += 1

        # A DETAIL PAGE HAS NO NAV ENTRY, so without this every role counted as able to open it and
        # every detail page reported a failure for every role. The honest gate is the PARENT list's:
        # `/prospects/[id]` is reached from `/prospects`, which is where the nav gate lives. The
        # sibling measurement `permission-reachability.py` already walks ancestors for this reason.
        dest_codes, dest_types = dests.get(route, (None, None))
        if dest_codes is None:
            parts = route.strip("/").split("/")
            while parts and dest_codes is None:
                parts.pop()
                parent = "/" + "/".join(parts)
                if parent in dests:
                    dest_codes, dest_types = dests[parent]
            if dest_codes is None:
                dest_codes, dest_types = [], None
        # THE NAV GATE IS THE AUTHORITY, NOT A UNION WITH THE SCREEN'S OWN CHECKS.
        #
        # The first version unioned them, which made the open test too permissive in exactly the
        # wrong direction: a screen's own `hasPermission` calls are mostly SECTION gates, so a
        # screen mentioning any code a role happens to hold made that role count as able to open it.
        # That is how PLATFORM_OPERATOR appeared on `/prospects/[id]`, which is gated on
        # `prospect.read` and correctly invisible to it.
        #
        # So: the destination's codes decide it when there is a destination, and the screen's own
        # gate is the fallback only for a screen with no nav entry at all.
        own = screen_open_codes(src)
        open_codes = sorted(dest_codes) if dest_codes else sorted(own)

        # A SCREEN WITH NO GATE AT ALL IS ITS OWN FINDING, and reporting it as N render failures
        # would be wrong twice: the role set is unfiltered, so every role appears, and the real
        # defect is upstream of any route. `/rfqs/new` and `/rfqs/[id]` are in neither the nav map
        # nor gated by their own code, which is why they produced a row for every seeded role.
        if not open_codes:
            ungated_screens.append({"screen": route, "file": path.replace(os.sep, "/")})
            continue
        mentioned = screen_mentions(src)

        for role, held in sorted(roles.items()):
            # Can this role open it at all? If not, the screen is correctly invisible to them.
            if open_codes and not any(c in held for c in open_codes):
                continue
            pairs_examined += 1
            for verb, rpath in sorted(called):
                candidates = resolve(routes, verb, rpath)
                if not candidates:
                    unresolved_paths.add("%s /%s" % (verb, rpath))
                    continue
                # EVERY candidate must be satisfied, not any. One call site can address several
                # routes — `/admin/users/${id}/${isActive ? 'activate' : 'deactivate'}` is one
                # function reaching two — and the screen may call either, so a role refused by one of
                # them cannot use the control. Requiring ANY would let a screen pass because the half
                # the role happens to hold exists.
                refused = [
                    (key, info)
                    for key, info in candidates
                    if not satisfied(info["codes"], held)
                ]
                if not refused:
                    continue
                key, info = refused[0]
                rpath = key[1]
                # Does the screen KNOW about this permission? If it names the code, the refusal is
                # something it is handling — a hidden control, a gated section, a refusal sentence —
                # and reporting it would be noise on a red build.
                handled = any(c in mentioned for c in info["codes"])
                row = {
                    "screen": route,
                    "role": role,
                    "route": "%s /%s" % (verb, rpath),
                    "requires": info["codes"],
                    "controller": info["controller"],
                    "opens_via": open_codes,
                }
                if handled:
                    handled_refusals.append(row)
                elif verb in READ_VERBS:
                    render_failures.append(row)
                else:
                    action_refusals.append(row)

    # ------------------------------------------------------------------ report
    print(
        "screen/route permission fit: %d screen(s) with resolvable calls, %d (role, screen) pair(s) "
        "examined, %d role(s)\n" % (screens_examined, pairs_examined, len(roles))
    )

    print("A. CANNOT RENDER — the role opens the screen and a GET it needs refuses (%d)\n" % len(render_failures))
    for r in sorted(render_failures, key=lambda x: (x["screen"], x["route"], x["role"])):
        print(
            "  %-34s %-32s %s  requires any of: %s"
            % (r["screen"], r["role"], r["route"], ", ".join(r["requires"]) or "(none)")
        )

    print(
        "\nB. ACTION REFUSED — a write the role cannot make. Usually CORRECT (reduced capability); "
        "needs DECLARING on screen, not widening (%d)\n" % len(action_refusals)
    )
    seen = set()
    for r in sorted(action_refusals, key=lambda x: (x["screen"], x["route"], x["role"])):
        key = (r["screen"], r["route"])
        if key in seen:
            continue
        seen.add(key)
        who = sorted(
            x["role"] for x in action_refusals if (x["screen"], x["route"]) == key
        )
        print(
            "  %-34s %s  requires any of: %s\n      refused for: %s"
            % (r["screen"], r["route"], ", ".join(r["requires"]) or "(none)", ", ".join(who))
        )

    print(
        "\nD. REFUSED BUT HANDLED — the screen NAMES the code, so it gates a section, hides a "
        "control or renders a refusal. Not findings (%d)\n" % len(handled_refusals)
    )
    print(
        "\nE. SCREENS WITH NO PERMISSION GATE AT ALL — in neither the nav map nor gated by their "
        "own code, so every role reaches them (%d)\n" % len(ungated_screens)
    )
    for s in ungated_screens:
        print("  %-34s %s" % (s["screen"], s["file"]))

    if unresolved_paths:
        # OWNER DECISION, 2026-10-17, item 9: "when a path genuinely cannot be resolved, the
        # measurement must FAIL on the unresolved path rather than list it as a note — an unmatched
        # path is a hole in the measurement, not a footnote to it."
        #
        # It was 49, and every one of them was a MATCHER defect rather than a product fact: a nested
        # template literal truncating the scan, a trailing querystring read as a path segment, a file
        # with two `@Controller`s, a bare `@Controller()`, and a call addressing two routes at once.
        # While they were listed as notes the headline figure was a FLOOR and read like a total.
        print(
            "\nC. UNRESOLVED PATHS (%d) — THE MEASUREMENT IS INCOMPLETE BY THIS MUCH:"
            % len(unresolved_paths)
        )
        for up in sorted(unresolved_paths):
            print("    %s" % up)
        print(
            "\nEach of these is a screen call this check could NOT map to a controller, so that"
            "\nscreen was examined with some of its calls invisible. Resolve the path form in"
            "\n`norm`/`resolve`, or name the controller route it addresses. Do not add a tolerated"
            "\nlist: the whole point of item 9 is that a gate believed total and actually partial is"
            "\nworse than a known-partial one."
        )

    # NON-VACUITY. A matcher that stops resolving imports reports a clean tree, which is the one
    # outcome indistinguishable from success.
    if screens_examined < 20 or pairs_examined < 50 or len(fns) < 50:
        print(
            "\nNOT A CLEAN RESULT: %d screens, %d pairs, %d client functions — the matcher drifted"
            % (screens_examined, pairs_examined, len(fns))
        )
        return 1

    if "--check" in sys.argv:
        return check(render_failures)

    if "--json" in sys.argv:
        out = sys.argv[sys.argv.index("--json") + 1]
        io.open(out, "w", encoding="utf-8").write(
            json.dumps(
                {"cannotRender": render_failures, "actionRefused": action_refusals},
                indent=2,
                ensure_ascii=False,
            )
        )
        print("\nwrote %s" % out)

    print(
        "\n%d screen(s) cannot render for at least one role that can open them."
        % len({(r["screen"], r["role"]) for r in render_failures})
    )
    # An unresolved path fails the run even when nothing else does — see section C.
    return 1 if (render_failures or unresolved_paths) else 0


DECLARED = os.path.join("scripts", "measurements", "screen-route-fit-declared.json")


def check(render_failures):
    """The GATE. Fails by name in BOTH directions, which is what stops a baseline becoming a ceiling.

    A triple not in the declared list is a NEW mismatch: a route gated on a permission its screen's
    intended users cannot hold, found by a machine instead of by the owner on a Thursday evening.

    A declared triple that no longer occurs is a FIXED mismatch whose row was left behind. Failing on
    that too is what keeps the list honest — otherwise it accumulates rows nobody can account for, and
    a reader cannot tell a real declaration from a stale one.

    Neither direction can be satisfied by widening a ROLE, because the list is keyed on the route's
    requirement: granting a role more makes the row disappear and the check then demands the row be
    removed, which is a reviewed edit to this file rather than a silent pass.
    """
    declared = json.load(io.open(DECLARED, encoding="utf-8"))["declared"]
    # ITEM 10 — every row carries the owner's decision, and a row without one is refused here rather
    # than quietly tolerated. A declaration nobody can account for is the thing this file exists to
    # prevent, so an empty or missing `decision` is a failure of the gate and not a lint nit.
    undecided = [
        d
        for d in declared
        if not str(d.get("decision", "")).strip()
        or "NO DECISION RECORDED" in str(d.get("decision"))
    ]
    if undecided:
        print("\nDECLARED WITH NO RECORDED DECISION (%d):\n" % len(undecided))
        for d in undecided:
            print("  %-26s %-32s %s" % (d["screen"], d["role"], d["route"]))
        print(
            "\nEvery row needs the owner's decision in its `decision` field — widen the route,"
            "\ndeclare the refusal, or close the door. A row without one cannot be reviewed."
        )
        return 1
    want = {(d["screen"], d["role"], d["route"]) for d in declared}
    got = {(r["screen"], r["role"], r["route"]) for r in render_failures}

    new = sorted(got - want)
    gone = sorted(want - got)

    if new:
        print("\nNEW MISMATCH(ES) — a screen cannot render for a role that can open it:\n")
        for s, ro, rt in new:
            print("  %-30s %-32s %s" % (s, ro, rt))
        print(
            "\nFix the ROUTE's gate (make it an ANY-OF) or DECLARE the refusal on the screen."
            "\nNEVER widen the ROLE to make this pass. If the owner has decided the refusal stays,"
            "\nadd it to %s with her decision recorded beside it." % DECLARED
        )
    if gone:
        print("\nDECLARED BUT NO LONGER OCCURRING (%d) — remove these rows:\n" % len(gone))
        for s, ro, rt in gone:
            print("  %-30s %-32s %s" % (s, ro, rt))
        print("\nA declaration nobody can account for is worse than no declaration.")

    if not new and not gone:
        print(
            "\nscreen/route fit: %d declared mismatch(es), no new ones, none stale." % len(want)
        )
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
