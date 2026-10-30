"""Every route gated on a given permission code — the OTHER direction of the acceptance criterion.

## WHY THIS EXISTS

The owner's rule for widening a ROUTE is already a gate: a route's any-of reaches every holder of
every code it names, so the decided ROLE SET is the specification. Decision 11 needed the mirror of
it, which this project had never applied:

    Widening a ROUTE reaches every HOLDER of the code named.
    Widening a ROLE reaches every ROUTE that names the code added.

Her instruction, 2026-10-17: before adding `branch.read` and `department.read` to the insurance
company administrator, enumerate EVERY route gated on either — including composite code sets, and
including writes — and report whether a company administrator reaching each one is acceptable. "If
the enumeration turns up a route where the answer is no, STOP AND REPORT: the fix is then a narrower
code for the org-unit reads, not a grant the owner did not intend."

## IT FOLLOWS COMPOSITE SETS, WHICH IS THE PART A GREP MISSES

`@RequirePermissions(...BRANCH_SEARCH_CODES)` names no code at the call site. A grep for
`'branch.read'` finds the constant's definition and not the route that spreads it, so a route can be
gated on a code without the code appearing anywhere near it. This resolves `...SPREAD` and bare
identifiers through the constants they are declared from, and reports any it could not resolve rather
than silently treating them as naming nothing.

## IT ALSO REPORTS TENANT SCOPE

A route gated on `branch.read` that is NOT tenant-scoped is a different and more serious finding than
a widening question, because the grant would then reach another organization's rows. Tenancy here is
a property of the MODEL — `tenantScopeExtension` filters every model carrying `organizationId` — so
this reports which models the route's controller mentions and whether each carries that column.

Usage:  python scripts/measurements/routes-gated-on.py <code> [<code> ...]
"""

import io
import os
import re
import sys

API_SRC = os.path.join("apps", "api", "src")
SCHEMA = os.path.join("packages", "db", "prisma", "schema.prisma")
VERBS = ("Get", "Post", "Patch", "Put", "Delete")
# controller -> service -> repository is TWO hops, and in this codebase the repository is where
# the Prisma call lives. A one-hop follow therefore found nothing and reported every route as
# tenant-scoped, which is how the first version of this check came to be vacuous. Three is one
# more than the common shape needs, and bounded so a cycle cannot walk forever.
MAX_HOPS = 3


def strip_comments(src):
    src = re.sub(r"/\*[\s\S]*?\*/", "", src)
    return re.sub(r"(?m)^\s*//.*$", "", src)


def constants():
    """Every `export const NAME = [...]` of code literals anywhere in the api, name -> codes."""
    out = {}
    for root, _, files in os.walk(API_SRC):
        for f in files:
            if not f.endswith(".ts"):
                continue
            src = strip_comments(
                io.open(os.path.join(root, f), encoding="utf-8", errors="replace").read()
            )
            for m in re.finditer(
                r"(?:export\s+)?const\s+([A-Z][A-Z_0-9]*)\s*(?::[^=]*)?=\s*\[([^\]]*)\]", src
            ):
                codes = re.findall(r"['\"]([a-z][a-z0-9.\-]*\.[a-z0-9.\-]+)['\"]", m.group(2))
                if codes:
                    out[m.group(1)] = codes
    return out


def tenant_scoped_models():
    """Model -> whether it carries `organizationId`, which is what decides tenant filtering."""
    txt = io.open(SCHEMA, encoding="utf-8").read()
    out = {}
    for m in re.finditer(r"\nmodel (\w+) \{(.*?)\n\}", txt, re.S):
        out[m.group(1)] = bool(re.search(r"^\s*organizationId\s", m.group(2), re.M))
    return out


def models_reached(controller_path, controller_src, models):
    """Which Prisma models this route's controller can reach, THROUGH ITS SERVICES.

    THE FIRST VERSION OF THIS WAS VACUOUS AND THAT IS WORTH RECORDING. It grepped the CONTROLLER for
    camel-cased model names — and a controller never mentions a Prisma model, its service does. So
    the set was always empty, nothing was ever reported as unscoped, and the absence of output read
    as "every route here is tenant-scoped". Probing it against `insurer.master.read`, whose
    `InsurerMaster` is a GLOBAL catalogue model carrying no `organizationId`, is what exposed it: four
    routes and zero findings cannot both be true.

    And ONE HOP WAS NOT ENOUGH EITHER — the second version followed the controller's imports to the
    service beside it and still found nothing, because in this codebase the Prisma call lives in the
    REPOSITORY: controller -> service -> repository is two hops. So the follow is transitive and
    bounded at `MAX_HOPS`, which is what finally made the probe flag `InsurerMaster`,
    `InsurerFormTemplate` and `InsuranceLine` on all four `insurer.master.read` routes.

    A model reached beyond `MAX_HOPS` is still not covered, so the check UNDER-reports rather than
    over-reports and a clean result reads as "nothing found within three hops", not as proof.
    """
    out = set()
    seen = set()
    frontier = [(controller_path, controller_src, 0)]
    while frontier:
        path, src, depth = frontier.pop()
        if path in seen:
            continue
        seen.add(path)
        for name in models:
            camel = name[0].lower() + name[1:]
            if re.search(r"(?:prisma|client|tx)\.%s\b" % re.escape(camel), src):
                out.add(name)
        if depth >= MAX_HOPS:
            continue
        base = os.path.dirname(path)
        for m in re.finditer(r"from\s+'(\.[^']*(?:service|repository|config|util))'", src):
            cand = os.path.normpath(os.path.join(base, m.group(1) + ".ts"))
            if os.path.exists(cand):
                frontier.append(
                    (cand, io.open(cand, encoding="utf-8", errors="replace").read(), depth + 1)
                )
    return out


def routes_for(wanted):
    consts = constants()
    models = tenant_scoped_models()
    unresolved_sets = set()
    rows = []

    verb_re = re.compile(
        r"@RequirePermissions\(([^)]*)\)|@(" + "|".join(VERBS) + r")\(\s*(?:'([^']*)')?\s*\)"
    )
    for root, _, files in os.walk(API_SRC):
        for f in files:
            if not f.endswith(".controller.ts"):
                continue
            path = os.path.join(root, f)
            raw = io.open(path, encoding="utf-8", errors="replace").read()
            src = strip_comments(raw)
            for section in re.split(r"(?=@Controller\()", src):
                if not section.startswith("@Controller("):
                    continue
                cm = re.match(r"@Controller\(\s*'([^']*)'", section)
                prefix = cm.group(1) if cm else ""
                pending = None
                for m in verb_re.finditer(section):
                    if m.group(1) is not None:
                        blob = m.group(1)
                        codes = set(
                            re.findall(r"['\"]([a-z][a-z0-9.\-]*\.[a-z0-9.\-]+)['\"]", blob)
                        )
                        for ident in re.findall(r"\.{3}\s*([A-Z][A-Z_0-9]*)|^\s*([A-Z][A-Z_0-9]*)\s*$", blob):
                            name = ident[0] or ident[1]
                            if not name:
                                continue
                            if name in consts:
                                codes.update(consts[name])
                            else:
                                unresolved_sets.add(name)
                        pending = sorted(codes)
                        continue
                    verb, sub = m.group(2).upper(), m.group(3) or ""
                    full = "/".join(x for x in (prefix, sub) if x)
                    codes = pending or []
                    pending = None
                    if not set(codes) & set(wanted):
                        continue
                    touched = sorted(models_reached(path, raw, models))
                    rows.append(
                        {
                            "route": "%s /%s" % (verb, full),
                            "codes": codes,
                            "file": path.replace(os.sep, "/"),
                            "models": [(n, models[n]) for n in touched],
                        }
                    )
    return rows, sorted(unresolved_sets)


def main():
    wanted = sys.argv[1:]
    if not wanted:
        print("usage: routes-gated-on.py <code> [<code> ...]")
        return 1
    rows, unresolved = routes_for(wanted)

    print("routes gated on %s\n" % ", ".join(wanted))
    for r in sorted(rows, key=lambda x: x["route"]):
        unscoped = [n for n, scoped in r["models"] if not scoped]
        print("  %-44s  %s" % (r["route"], ", ".join(r["codes"])))
        print("      %s" % r["file"])
        if unscoped:
            print(
                "      MODELS WITHOUT organizationId (not tenant-filtered): %s"
                % ", ".join(unscoped)
            )
    print("\n%d route(s)." % len(rows))

    if unresolved:
        print(
            "\nCOMPOSITE SETS THIS COULD NOT RESOLVE (%d) — a route may be gated on a code that does"
            "\nnot appear near it, so this list is a hole in the enumeration:" % len(unresolved)
        )
        for u in unresolved:
            print("    %s" % u)
        return 1

    # NON-VACUITY: an enumeration that finds nothing looks exactly like a code nothing gates.
    if not rows:
        print("\nfound NO route gated on any of those codes, which is not a clean result")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
