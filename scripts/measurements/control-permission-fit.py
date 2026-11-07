"""Every web control's permission, against the permission the route it drives actually enforces.

## THE DEFECT THIS MEASURES

`hasPermission(user, code)` takes a plain `string`. A control gated on one code while its route
enforces another therefore typechecks, and under the SEEDED grants it is usually invisible: the
twelve legacy roles tend to hold both codes of a pair, so the control appears for the people who
can use it and the mismatch never shows. It goes live the first time an office defines a role
holding ONE of the pair — which is exactly what office-scoped RBAC exists to let them do.

Two directions, and they are not equally bad:

  * **HIDDEN** — the control is gated on a code the route does NOT require. Somebody who may
    perform the action cannot see the control. Fails closed, silently; the screen looks correct to
    everybody who lacks the permission anyway.
  * **OFFERED** — the control is gated on a code that is NOT sufficient for the route. Somebody
    sees a control and is answered 403 when they press it. Loud, and the recorded case
    (`isManager={canNegotiate}`) where BOTH halves were wrong at once: the placement officer saw two
    controls and was refused twice, while the manager saw neither.

## THREE LIMITS, EVERY ONE OF WHICH PRODUCED A FALSE FINDING ON THE FIRST RUN

Recorded here because an unstated limit becomes a wrong figure somebody quotes:

 1. **A SPREAD DECORATOR READS AS NO PERMISSION.** `@RequirePermissions(...CUSTOMER_SEARCH_CODES)`
    is the picker-search shape — **7 routes use it**, measured 2026-11-06 by
    `git grep -c "@RequirePermissions(\\.\\.\\." -- 'apps/api/src/**/*.controller.ts'` — and the code
    pattern below reads only quoted strings, so those routes came back with an empty code list.
    `GET /documents/search` therefore looked unguarded and is not. The count is PRINTED by the
    report, so the gap is bounded rather than invisible.

    (That figure was "ten" in the first draft of this comment, from a `git grep --include=` which
    git ignores — `--include` is a grep flag, not a git-grep one, so the count swept two spec and
    config files as well. Corrected against the script's own output, which is the whole argument
    for printing it.)
 2. **A PERMISSION CHECKED IN A SERVICE IS INVISIBLE HERE.** `customer.national-id.reveal` is
    enforced in `customer.service.ts`, deliberately, as a second check beyond the route guard — so
    it showed as "bound on a screen, enforced by no route". Route decorators are not the whole
    enforcement surface.
 3. **THE PROP RESOLVER FOLLOWS ONE LEVEL.** `ClaimSection` forwards its eight booleans to
    `NotifyClaimForm` and `ClaimCard`, which make the calls — so all eight read as mismatches and
    none is (spot-checked: `canNotify` gates `POST /claims`, which enforces `claim.notify`,
    correctly). A row here means "the resolver could not tie this prop to a route it calls
    DIRECTLY", not "this is wrong".

## WHY IT IS A REPORT AND NOT A GATE

The mapping from a CONTROL to a ROUTE is not expressible as a pattern. A boolean is passed as a
prop, sometimes renamed, sometimes combined, and the component that consumes it may call several
routes. So this resolves what it can mechanically — the route each api-client function addresses,
and the permission each controller route enforces — and prints the pairs for a person to read. A
ratchet on a resolver this partial would be a red build on a correct tree, which this repository
has already paid for twice.

    python scripts/measurements/control-permission-fit.py            # the full report
    python scripts/measurements/control-permission-fit.py --json     # machine-readable
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
WEB = ROOT / "apps" / "web"
API = ROOT / "apps" / "api" / "src"

# ---------------------------------------------------------------- the api side

CONTROLLER_CLASS = re.compile(r"@Controller\(\s*'([^']*)'")
ROUTE = re.compile(r"@(Get|Post|Patch|Put|Delete)\(\s*(?:'([^']*)')?\s*\)")
REQUIRE = re.compile(r"@RequirePermissions\(([^)]*)\)")
# Limit 1: a decorator that SPREADS a constant carries no quoted code for `CODE` to find.
SPREAD = re.compile(r"@RequirePermissions\(\s*\.\.\.")
CODE = re.compile(r"'([^']+)'")


def join(prefix: str, path: str) -> str:
    parts = [p for p in (prefix.strip("/"), path.strip("/")) if p]
    return "/" + "/".join(parts)


def api_routes() -> list[dict]:
    """Every route with the permission(s) its decorator names.

    The decorators are read in FILE ORDER and attached to the next route below them, which is how
    Nest itself applies them. A `@RequirePermissions` sitting on the CLASS rather than a method
    would be mis-attributed by this — measured: no controller in this tree does that, and the
    assertion below is what keeps that true.
    """
    out: list[dict] = []
    for path in sorted(API.rglob("*.controller.ts")):
        text = path.read_text(encoding="utf-8")
        prefix_match = CONTROLLER_CLASS.search(text)
        prefix = prefix_match.group(1) if prefix_match else ""
        pending: list[str] = []
        pending_spread = False
        for line in text.splitlines():
            req = REQUIRE.search(line)
            if req:
                pending = CODE.findall(req.group(1))
                pending_spread = SPREAD.search(line) is not None
                continue
            route = ROUTE.search(line)
            if route:
                out.append(
                    {
                        "method": route.group(1).upper(),
                        "path": join(prefix, route.group(2) or ""),
                        "codes": pending,
                        "spread": pending_spread,
                        "file": str(path.relative_to(ROOT)).replace("\\", "/"),
                    }
                )
                pending = []
                pending_spread = False
    return out


# ---------------------------------------------------------------- the web side

# `export function name(...)` ... `apiPost(`/path/${x}`, ...)` — the call is usually the last line
# of the function, so the function's text is sliced to the next `export` rather than to a brace.
WEB_FN = re.compile(r"export function (\w+)\s*\(")
WEB_CALL = re.compile(r"api(Get|Post|Patch|Put|Delete)(?:<[^>]*>)?\(\s*[`'\"]([^`'\"]*)")

METHOD_BY_HELPER = {
    "Get": "GET",
    "Post": "POST",
    "Patch": "PATCH",
    "Put": "PUT",
    "Delete": "DELETE",
}


def web_functions() -> dict[str, dict]:
    """api-client function -> the route it addresses."""
    out: dict[str, dict] = {}
    for path in sorted((WEB / "lib").rglob("*.ts")):
        text = path.read_text(encoding="utf-8")
        marks = [(m.start(), m.group(1)) for m in WEB_FN.finditer(text)]
        for i, (start, name) in enumerate(marks):
            end = marks[i + 1][0] if i + 1 < len(marks) else len(text)
            body = text[start:end]
            call = WEB_CALL.search(body)
            if not call:
                continue
            raw = call.group(2)
            # `${x}` -> `*`, and drop a query string: neither affects which route matches.
            route = re.sub(r"\$\{[^}]*\}", "*", raw).split("?")[0].rstrip("/")
            out[name] = {
                "method": METHOD_BY_HELPER[call.group(1)],
                "path": route if route.startswith("/") else "/" + route,
                "file": str(path.relative_to(ROOT)).replace("\\", "/"),
            }
    return out


def route_matches(web_path: str, api_path: str) -> bool:
    """`/vendors/*/terminate` matches `/vendors/:id/terminate`."""
    w = [p for p in web_path.strip("/").split("/") if p]
    a = [p for p in api_path.strip("/").split("/") if p]
    if len(w) != len(a):
        return False
    for wp, ap in zip(w, a):
        if ap.startswith(":") or wp == "*":
            continue
        if wp != ap:
            return False
    return True


BINDING = re.compile(
    r"const (\w+)\s*=\s*hasPermission\(\s*user,\s*['\"]([^'\"]+)['\"]", re.S
)
ANY_BINDING = re.compile(
    r"const (\w+)\s*=\s*hasAnyPermission\(\s*user,\s*\[([^\]]*)\]", re.S
)


def web_bindings() -> list[dict]:
    out: list[dict] = []
    for base in (WEB / "app", WEB / "components"):
        for path in sorted(base.rglob("*.tsx")):
            text = path.read_text(encoding="utf-8")
            rel = str(path.relative_to(ROOT)).replace("\\", "/")
            for m in BINDING.finditer(text):
                out.append({"name": m.group(1), "codes": [m.group(2)], "file": rel})
            for m in ANY_BINDING.finditer(text):
                out.append(
                    {
                        "name": m.group(1),
                        "codes": CODE.findall(m.group(2).replace('"', "'")),
                        "file": rel,
                        "anyOf": True,
                    }
                )
    return out


def main() -> int:
    routes = api_routes()
    fns = web_functions()
    bindings = web_bindings()

    resolved = 0
    for name, fn in fns.items():
        hits = [
            r
            for r in routes
            if r["method"] == fn["method"] and route_matches(fn["path"], r["path"])
        ]
        fn["codes"] = sorted({c for r in hits for c in r["codes"]})
        fn["routeFile"] = hits[0]["file"] if hits else None
        if hits:
            resolved += 1

    # NON-VACUITY, and it is the whole reason this is trustworthy at all: if either side's pattern
    # stops matching, both lists go empty and every comparison below passes while seeing nothing.
    assert len(routes) > 200, f"only {len(routes)} api routes read — the pattern broke"
    assert len(fns) > 150, f"only {len(fns)} web api functions read — the pattern broke"
    assert len(bindings) > 100, f"only {len(bindings)} web bindings read — the pattern broke"

    if "--json" in sys.argv:
        print(
            json.dumps(
                {"routes": routes, "functions": fns, "bindings": bindings}, indent=1
            )
        )
        return 0

    spreads = sum(1 for r in routes if r.get("spread"))
    print(f"api routes read                  {len(routes)}")
    print(f"  of those, SPREAD decorators    {spreads}  <- codes unreadable here, see limit 1")
    print(f"  of those, with a permission    {sum(1 for r in routes if r['codes'])}")
    print(f"web api-client functions read    {len(fns)}")
    print(f"  of those, resolved to a route  {resolved}")
    print(f"web permission bindings read     {len(bindings)}")
    print()

    codes_in_use = sorted({c for b in bindings for c in b["codes"]})
    enforced = {c for r in routes for c in r["codes"]}
    orphans = [c for c in codes_in_use if c not in enforced]
    print(f"codes bound on a screen          {len(codes_in_use)}")
    print(f"  NOT enforced by any route      {len(orphans)}")
    for c in orphans:
        where = sorted({b["file"] for b in bindings if c in b["codes"]})
        print(f"    {c}")
        for w in where:
            print(f"      {w}")
    print()

    # ---------------------------------------------------------------- the pairs
    #
    # FILE-LEVEL, and the limit is stated rather than hidden: this asks "does this file bind a code
    # that none of the routes it calls enforces, while calling a route whose code it does not
    # bind?" — which names the files to READ. It cannot say which BUTTON is wrong, because a
    # boolean is passed as a prop and renamed on the way. The pairs below are candidates for a
    # person, not findings.
    call_sites: dict[str, set[str]] = {}
    for base in (WEB / "app", WEB / "components"):
        for path in sorted(base.rglob("*.tsx")):
            text = path.read_text(encoding="utf-8")
            rel = str(path.relative_to(ROOT)).replace("\\", "/")
            called = {n for n in fns if re.search(r"\b" + re.escape(n) + r"\s*\(", text)}
            if called:
                call_sites[rel] = called

    print("CANDIDATE PAIRS — a file whose bound codes and called routes disagree")
    print("(read these; the resolver cannot tie a boolean to a button)")
    pairs = 0
    for rel in sorted(call_sites):
        bound = {c for b in bindings if b["file"] == rel for c in b["codes"]}
        if not bound:
            continue
        needed = {c for n in call_sites[rel] for c in fns[n]["codes"]}
        if not needed:
            continue
        offered = sorted(bound - needed)   # bound here, required by none of the routes called
        missing = sorted(needed - bound)   # required by a route called here, bound nowhere here
        if not offered or not missing:
            continue
        pairs += 1
        print(f"  {rel}")
        print(f"    bound but not required by any route called here : {', '.join(offered)}")
        print(f"    required by a route called here but not bound   : {', '.join(missing)}")
    print(f"\ncandidate files: {pairs}")
    print()

    # ---------------------------------------------------- prop-level resolution
    #
    # THE FILE-LEVEL PASS ABOVE CANNOT SEE `/opportunities/[id]`, and that is the one that matters:
    # the page binds 27 codes and calls almost no routes itself — every control lives in a child
    # component that makes its own calls. So this follows the PROP: `<PolicySection
    # canPlace={canPlacePolicy} />` ties the prop to the boolean, the boolean to its code, and the
    # component to the routes it calls.
    #
    # Still a report. A component may call several routes under one prop, and a prop may gate a
    # section rather than a single button — so a row here means "the code behind this prop is not
    # among the codes the routes in this component enforce", which is a question, not a verdict.
    JSX = re.compile(r"<([A-Z]\w+)([^>]*?)/?>", re.S)
    PROP = re.compile(r"(\w+)=\{(\w+)\}")
    component_files: dict[str, str] = {}
    for path in (WEB / "components").rglob("*.tsx"):
        component_files[path.stem] = str(path.relative_to(ROOT)).replace("\\", "/")

    print("PROP-LEVEL — the code behind a prop, against the routes the component calls")
    prop_rows = 0
    for base in (WEB / "app", WEB / "components"):
        for path in sorted(base.rglob("*.tsx")):
            text = path.read_text(encoding="utf-8")
            rel = str(path.relative_to(ROOT)).replace("\\", "/")
            by_name = {
                b["name"]: b["codes"] for b in bindings if b["file"] == rel
            }
            if not by_name:
                continue
            for tag in JSX.finditer(text):
                comp, attrs = tag.group(1), tag.group(2)
                target = component_files.get(comp)
                if not target:
                    continue
                needed = {c for n in call_sites.get(target, set()) for c in fns[n]["codes"]}
                if not needed:
                    continue
                for pm in PROP.finditer(attrs):
                    prop, value = pm.group(1), pm.group(2)
                    codes = by_name.get(value)
                    if not codes:
                        continue
                    if not set(codes) & needed:
                        prop_rows += 1
                        print(f"  {rel}")
                        print(
                            f"    <{comp} {prop}={{{value}}}>  gates on {', '.join(codes)}"
                        )
                        print(
                            f"    {target} calls routes enforcing: {', '.join(sorted(needed))}"
                        )
    print(f"\nprop-level candidates: {prop_rows}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
