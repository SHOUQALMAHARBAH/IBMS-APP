# -*- coding: utf-8 -*-
"""WHICH EXPORTED CLIENT HELPERS NOTHING CALLS — the one question the reachability passes need.

    python scripts/measurements/dead_helpers.py              # the figures
    python scripts/measurements/dead_helpers.py --self-test   # planted inputs, in both directions

## Why this is a module and not a third report

`unreachable-routes.py` and `unreachable-routes-by-verb.py` read the path out of every resolvable
`apiGet`/`apiPost`/... call, INCLUDING the one inside a client helper's own declaration. So a route is
counted REACHED the moment a helper addresses it, whether or not anything calls that helper. Both
figures are therefore an upper bound on reachability, and until now that was said only in a COMMENT
inside each script — prose a reader of the output never sees.

`dead-client-helpers.py` already measured the class and named `updateInsurer` as the proven case. What
it could not do is feed the two gates, because it was written as a report with its own `main()`. This
module is that measurement made importable, so the blind spot becomes a NUMBER IN THE OUTPUT of both
gates rather than a paragraph beside them.

## WHY THIS IS NOT A CALL GRAPH, which is the claim that decided the approach

Both reachability scripts decline to resolve cross-file paths because that "would need a real import
graph", and that refusal is right for their question — resolving what a path IS requires following
values across modules.

This question is narrower and does not. It is not "what calls what". It is:

    is this helper's name referenced anywhere outside its own declaration, under any name it can
    be imported as?

In ES modules a name can be renamed in exactly three places, and all three are local, textual, and
readable without resolving a module path:

    (1) import { X as Y }   - renamed at the import
    (2) export { X as Y }   - renamed at a re-export
    (3) import * as ns      - reached as ns.X

MEASURED on 2026-11-05 rather than assumed, which is what makes this exact rather than a heuristic:
across `apps/web/{app,components,lib}` there are **0** namespace imports, and the only barrel
(`components/ui/index.ts`) re-exports sibling components and **no `lib/**` client helper**. Aliased
imports occur exactly **twice** — `me as fetchMe` and `updateLanguagePreference as
patchLanguagePreference`. So (1) is the only mechanism in play, and resolving it is the few lines
below.

AND THE TWO ABSENT MECHANISMS ARE ASSERTED, NOT TRUSTED. `refuse_on_unhandled_renaming()` raises the
day a namespace import or a `lib/**` re-export appears, because the alternative is this module
silently under-reporting liveness — i.e. calling a live helper dead, which in a gate means a red build
on a correct tree. That is the one direction a gate must never take on a guess.

## THE BIAS, STATED

When in doubt a helper is LIVE. A name that appears anywhere outside its declaration counts as a
reference, even in a test and even in a comment-free string. The cost of that bias is under-reporting
the dead set, which leaves the gates where they already were — an upper bound. The cost of the
opposite bias is a false red. Those are not symmetric, so the bias is not a matter of taste.
"""

from __future__ import annotations

import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = os.path.join(ROOT, "apps", "web")
LIB = os.path.join(WEB, "lib")
SCAN = [os.path.join(WEB, "app"), os.path.join(WEB, "components"), LIB]

# An exported function in `lib/**` whose body addresses a route is a client helper.
EXPORT_FN = re.compile(r"^export (?:async )?function (\w+)\s*[(<]", re.M)
ADDRESSES = re.compile(r"\bapi(?:Get|Post|Patch|Put|Delete|PostFormData|FetchBlob|Fetch)\s*[(<]")

ALIAS_IMPORT = re.compile(r"\b([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)")
NAMESPACE_IMPORT = re.compile(r"^\s*import\s+\*\s+as\s+", re.M)
REEXPORT_FROM = re.compile(r"^\s*export\s*(?:\*|\{[^}]*\})\s*from\s*['\"]([^'\"]+)", re.M)

STRIP_BLOCK = re.compile(r"/\*[\s\S]*?\*/")
STRIP_LINE = re.compile(r"//[^\n]*")


def blank_comments(src: str) -> str:
    """Comments blanked with POSITIONS PRESERVED, so an offset still means the same offset.

    Deleting them instead would shift every span this module hands back, and the reachability passes
    use those spans to decide whether a call site sits inside a dead helper. Blanking is also what
    the `/leads/[id]` depth-counter defect taught: a comment quoting `<div>` broke a paired scan.
    """

    def blank(m: "re.Match[str]") -> str:
        return re.sub(r"\S", " ", m.group(0))

    return STRIP_LINE.sub(blank, STRIP_BLOCK.sub(blank, src))


def walk(bases: list[str], suffixes: tuple[str, ...] = (".ts", ".tsx")) -> list[str]:
    out: list[str] = []
    for base in bases:
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [
                d
                for d in dirnames
                if d not in {"node_modules", ".next", "test-results", "dist"}
            ]
            for name in filenames:
                if name.endswith(suffixes):
                    out.append(os.path.join(dirpath, name))
    return out


def balanced_body_end(src: str, start: int) -> int:
    """Offset just past the `}` matching the first `{` at or after `start`; `start` if none."""
    opened = src.find("{", start)
    if opened == -1:
        return start
    depth = 0
    for i in range(opened, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return i + 1
    return len(src)


def refuse_on_unhandled_renaming(sources: dict[str, str]) -> None:
    """Raise if a renaming mechanism this module does not resolve has appeared.

    Both were measured ABSENT on 2026-11-05. An assertion is the difference between "absent" and
    "assumed absent" — and this module is consumed by gates, where a silently-missed reference means
    a live helper read as dead and a red build on a correct tree.
    """
    for path, src in sources.items():
        rel = os.path.relpath(path, ROOT)
        if NAMESPACE_IMPORT.search(src):
            raise AssertionError(
                "dead_helpers: REFUSED — a namespace import appeared at %s. `import * as ns` reaches "
                "`ns.helper()` without ever naming the helper, so this module can no longer tell a "
                "live helper from a dead one. Resolve namespace access before trusting any figure "
                "here." % rel
            )
        for m in REEXPORT_FROM.finditer(src):
            target = m.group(1)
            # A barrel over sibling COMPONENTS is harmless; one that re-exports a lib client helper
            # can rename it out of this module's sight.
            if (os.sep + "lib" + os.sep) in path or "/lib/" in target or target.startswith("../lib"):
                raise AssertionError(
                    "dead_helpers: REFUSED — a re-export reaching lib/** appeared at %s (`from "
                    "'%s'`). `export { X as Y }` renames a helper, so liveness can no longer be "
                    "decided by name alone." % (rel, target)
                )


def _referenced_names(sources: dict[str, str], blanked: dict[str, str]) -> set[str]:
    """Every identifier referenced in code, plus the ORIGINAL name behind every alias."""
    names: set[str] = set()
    for path, blk in blanked.items():
        for m in re.finditer(r"[A-Za-z_$][\w$]*", blk):
            names.add(m.group(0))
    # An alias is read from the RAW source: `import { X as Y }` makes Y the call-site name, so X
    # would otherwise appear only inside the import statement and read as unreferenced. This is the
    # one false positive the 21-row hand triage actually found.
    for path, src in sources.items():
        for m in ALIAS_IMPORT.finditer(src):
            names.add(m.group(1))
    return names


def measure() -> dict[str, object]:
    """The figures, plus the per-file spans of every dead helper's body."""
    lib_files = walk([LIB])
    scan_files = walk(SCAN)
    sources = {f: io.open(f, encoding="utf-8", errors="replace").read() for f in scan_files}
    blanked = {f: blank_comments(s) for f, s in sources.items()}

    refuse_on_unhandled_renaming(sources)

    # Declarations: name -> (file, body span)
    decls: dict[str, tuple[str, int, int]] = {}
    for f in lib_files:
        blk = blanked[f]
        for m in EXPORT_FN.finditer(blk):
            name = m.group(1)
            end = balanced_body_end(blk, m.end())
            body = blk[m.start() : end]
            if ADDRESSES.search(body):
                decls[name] = (f, m.start(), end)

    if len(decls) < 200:
        raise AssertionError(
            "dead_helpers: REFUSED — only %d route-addressing client helper(s) found against a floor "
            "of 200. The declaration matcher has drifted, and a small dead set from a broken matcher "
            "looks exactly like a clean tree." % len(decls)
        )

    referenced = _referenced_names(sources, blanked)

    dead: dict[str, tuple[str, int, int]] = {}
    for name, (f, s, e) in decls.items():
        # Occurrences INSIDE the declaration itself do not count. Everything else does, including a
        # test and including another lib file — the stated bias.
        outside = False
        for g, blk in blanked.items():
            hay = blk if g != f else blk[:s] + " " * (e - s) + blk[e:]
            if re.search(r"\b" + re.escape(name) + r"\b", hay):
                outside = True
                break
        if not outside and name not in _alias_origins(sources):
            dead[name] = (f, s, e)

    spans: dict[str, list[tuple[int, int]]] = {}
    for name, (f, s, e) in dead.items():
        spans.setdefault(os.path.abspath(f), []).append((s, e))

    return {
        "helpers": len(decls),
        "dead": dead,
        "spans": spans,
        "files_scanned": len(scan_files),
    }


def _alias_origins(sources: dict[str, str]) -> set[str]:
    out: set[str] = set()
    for src in sources.values():
        for m in ALIAS_IMPORT.finditer(src):
            out.add(m.group(1))
    return out


def dead_helper_spans() -> dict[str, list[tuple[int, int]]]:
    """abspath -> body spans of helpers nothing calls. The reachability passes' whole interface."""
    return measure()["spans"]  # type: ignore[return-value]


def inside_any(spans: list[tuple[int, int]], offset: int) -> bool:
    return any(s <= offset < e for s, e in spans)


# ----------------------------------------------------------------------------------------------
# SELF-TEST over planted inputs, which is what this repository uses instead of a count floor.
#
# A floor goes stale the moment the work it guards gets done — `FLOOR = 10` guarding a real 26 then
# REFUSED a correct tree at 9. Planted inputs hold at any count, including zero.
# ----------------------------------------------------------------------------------------------

_PLANTS = [
    # (label, lib source, caller sources, expected dead?)
    (
        "a helper nothing calls is DEAD",
        "export function updateThing(id: string) {\n  return apiPatch(`/things/${id}`, {});\n}\n",
        [],
        True,
    ),
    (
        "a helper called by a screen is LIVE",
        "export function listThings() {\n  return apiGet('/things');\n}\n",
        ["import { listThings } from '../lib/x';\nvoid listThings();\n"],
        False,
    ),
    (
        "a helper called under an ALIAS is LIVE — the one real false positive the triage found",
        "export function patchThing() {\n  return apiPatch('/things', {});\n}\n",
        ["import { patchThing as savePatch } from '../lib/x';\nvoid savePatch();\n"],
        False,
    ),
    (
        "a helper named only in a COMMENT is DEAD — a comment is not a call",
        "export function clearThing() {\n  return apiDelete('/things/x');\n}\n",
        ["// clearThing has no caller anywhere, which is the defect this records\n"],
        True,
    ),
    (
        "a helper named only in a TEST is LIVE by the stated bias",
        "export function readThing() {\n  return apiGet('/things/1');\n}\n",
        ["it('x', () => { readThing(); });\n"],
        False,
    ),
    (
        "an exported function that addresses NO route is not a client helper at all",
        "export function formatThing(n: number) {\n  return String(n);\n}\n",
        [],
        None,
    ),
]


def _self_test() -> int:
    import tempfile

    failures: list[str] = []
    for label, lib_src, callers, expect_dead in _PLANTS:
        with tempfile.TemporaryDirectory() as tmp:
            libdir = os.path.join(tmp, "lib")
            appdir = os.path.join(tmp, "app")
            os.makedirs(libdir)
            os.makedirs(appdir)
            io.open(os.path.join(libdir, "x.ts"), "w", encoding="utf-8").write(lib_src)
            for i, c in enumerate(callers):
                io.open(
                    os.path.join(appdir, "c%d.tsx" % i), "w", encoding="utf-8"
                ).write(c)

            lib_files = walk([libdir])
            scan_files = walk([libdir, appdir])
            sources = {
                f: io.open(f, encoding="utf-8", errors="replace").read() for f in scan_files
            }
            blanked = {f: blank_comments(s) for f, s in sources.items()}

            decls: dict[str, tuple[str, int, int]] = {}
            for f in lib_files:
                blk = blanked[f]
                for m in EXPORT_FN.finditer(blk):
                    end = balanced_body_end(blk, m.end())
                    if ADDRESSES.search(blk[m.start() : end]):
                        decls[m.group(1)] = (f, m.start(), end)

            if expect_dead is None:
                if decls:
                    failures.append(
                        "%s: expected no client helper, found %s" % (label, sorted(decls))
                    )
                else:
                    print("  ok   %s" % label)
                continue

            if not decls:
                failures.append("%s: no client helper detected at all" % label)
                continue

            name, (f, s, e) = next(iter(decls.items()))
            outside = False
            for g, blk in blanked.items():
                hay = blk if g != f else blk[:s] + " " * (e - s) + blk[e:]
                if re.search(r"\b" + re.escape(name) + r"\b", hay):
                    outside = True
                    break
            is_dead = not outside and name not in _alias_origins(sources)

            if is_dead != expect_dead:
                failures.append(
                    "%s: read as %s, expected %s"
                    % (label, "DEAD" if is_dead else "LIVE", "DEAD" if expect_dead else "LIVE")
                )
            else:
                print("  ok   %s" % label)

    print("")
    if failures:
        print("dead_helpers --self-test: FAILED")
        for f in failures:
            print("   " + f)
        return 1
    print("dead_helpers --self-test: %d/%d planted inputs behave as declared." % (len(_PLANTS), len(_PLANTS)))
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return _self_test()
    m = measure()
    dead = m["dead"]
    assert isinstance(dead, dict)
    print("route-addressing client helpers : %d" % m["helpers"])
    print("called by nothing               : %d" % len(dead))
    print("")
    for name in sorted(dead):
        f = dead[name][0]
        print("    %-45s %s" % (name, os.path.relpath(f, ROOT)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
