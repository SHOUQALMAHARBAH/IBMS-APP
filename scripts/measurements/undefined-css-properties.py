# -*- coding: utf-8 -*-
"""Every `--custom-property` the web tree REFERENCES must be DEFINED in the stylesheet.

## Why this exists, and why nothing else could have caught it

`--surface-raised` was referenced at three sites and defined nowhere. An undefined custom property
with no fallback makes its whole declaration *invalid at computed-value time* — the browser drops
it and the element renders with NO BACKGROUND AT ALL. Nothing failed:

  * TypeScript cannot check a string against a stylesheet.
  * the CSS was never invalid, so no linter or build step had anything to report.
  * every one of the three blocks still rendered its text, so no Playwright assertion broke and
    no a11y rule fired — a missing background is not a contrast failure, it is a contrast
    ACCIDENT that happened to pass.
  * and a screenshot would only show it to somebody who knew what the block was supposed to
    look like.

One of the three is the DPO assignment section, which carries the owner's own Arabic notice — the
text she wrote and byte-verified. It had been rendering without its surface ever since.

This is a text-level join, like the AR/EN parity guards and `legacy-import-shape-parity.spec.ts`:
two declarations in two languages that no compiler sees together, so the only thing that can
compare them is a script that reads both.

## THE DISTINCTION THAT MAKES IT USEFUL: a bare reference versus one with a fallback

    var(--surface-raised)                        BARE — undefined means the declaration is dropped
    var(--status-warning-ink, var(--ink-primary)) with a fallback — undefined means the fallback renders

The second degrades BY DESIGN and is not a defect; merging the two classes would bury thirteen real
findings under six deliberate ones. Measured: 5 properties are referenced only with a fallback, and
every one of them renders correctly today. They are REPORTED below and never gate the build.

## A DECLARED SET, NOT A COUNT

The bare class is a declared set of `property @ path` pairs rather than a number, for the reason
`screen-route-fit-declared.json` already records: **a count survives a substitution.** At a budget
of 10, defining `--line` and introducing a new undefined property leaves the total unmoved and the
build green. So this fails BY NAME in both directions — on a bare reference nobody declared, and on
a declared one that no longer occurs, which is what stops the list becoming a ceiling.

Keyed on property and FILE, never line number: a line number rots on the next edit above it, and a
guard that goes red on unrelated edits is one people learn to switch off.

## WHAT IS DECLARED AND WHY IT IS NOT FIXED HERE

Batch six fixed `--surface-raised` alone, by instruction. The other three bare properties are real
findings of the same class and are the owner's to schedule, because each needs a decision rather
than a rename:

    --border         5 sites, 3 screens. `--border-default` and `--border-subtle` both exist, so
                     which of the two each site means is a visual judgement, not a typo.
    --line           4 sites. Same question; `EntitySearch`'s is a dropdown separator, where
                     `--border-subtle` is probably right and "probably" is not good enough.
    --shadow-raised  1 site. `--shadow-sm`/`--shadow-md`/`--shadow-lg` exist; picking an elevation
                     for a dropdown is a design decision.

## Non-vacuity

Three floors, because the failure directions are not symmetrical. If the DEFINITION pattern breaks,
`defined` empties and every reference reports undefined — a flood, which nobody mistakes for
success. If the REFERENCE pattern breaks, the finding list empties and the gate reports a clean
nothing, which is the shape this repository has been bitten by four times. The reference floor is
the one that matters.
"""
import io
import os
import re
import subprocess
import sys

# `var(--name` followed by `,` (a fallback) or `)` (bare). Reading the character immediately after
# the name decides it regardless of how deeply the fallback itself nests, which a paren-matching
# parser would have to get right and this does not.
REFERENCE = re.compile(r"var\(\s*(--[A-Za-z0-9_-]+)\s*([,)])")

# A custom-property DECLARATION: `--name:` in a property position. Anchored at line start (modulo
# indentation) so `var(--a, --b)` can never read as a definition of `--b`.
DEFINITION = re.compile(r"^[ \t]*(--[A-Za-z0-9_-]+)[ \t]*:", re.M)

SCANNED_EXTENSIONS = (".ts", ".tsx", ".css")

# Measured 2026-10-23 at 484 files / 80 defined / 74 referenced. Floors, not pins: this tree grows,
# and a pin here would fail on every new screen.
MIN_FILES = 400
MIN_DEFINED = 60
MIN_REFERENCED = 55

# `property @ path` — every BARE reference to an undefined property that is known and deliberately
# not fixed. Adding a row is a decision; removing one is how a fix is recorded. See the module
# docstring for why each survives.
# EMPTY, AND THAT IS THE POINT — a flat ban with no switch to throw.
#
# It held six rows for one batch. Batch seven closed all three remaining properties on the owner's
# ruling, and the ruling's own escape clause is what settled them: "if you find something better and
# sounder, take that instead and say why". Better was available for every one, so no new property
# was invented and no colour value had to be decided.
#
#   --border         5 sites  ->  `--border-default` for a panel outline and a table header rule,
#                                 `--border-subtle` for a row separator. This repository's own
#                                 convention, measured from its existing `cell`/`head` styles and
#                                 `impactPanelStyle` — not a judgement between two plausible tokens.
#   --line           4 sites  ->  the same split: `--border-subtle` for a table cell,
#                                 `--border-default` for a banner and a warning outline.
#   --shadow-raised  1 site   ->  `--shadow-md`, and this one was decided one component over rather
#                                 than by picking an elevation. `NotificationBell`'s panel is the
#                                 app's only other floating dropdown and is the exact comparable —
#                                 same `--surface-card`, same `--border-default`, same
#                                 `--shadow-md`. Matching it makes the two overlays in this product
#                                 look like one product.
#
# RE-POPULATING THIS SET NEEDS A REASON BESIDE THE NAME. A row here says "this reference is bare,
# the declaration is undefined, and we are shipping it anyway" — which renders an element with no
# background, no border or no shadow. The gate fails on a STALE row too, so a fix is recorded by
# deleting its row and cannot be left to cover the next regression.
DECLARED_BARE: set[str] = set()


def tracked_files():
    out = subprocess.check_output(["git", "ls-files", "apps/web"], text=True)
    return [f for f in out.split("\n") if f.endswith(SCANNED_EXTENSIONS)]


def measure():
    defined = set()
    bare = {}       # "name @ path" -> [line numbers]
    fallback = {}   # name -> [(path, lineno)]
    files = tracked_files()

    for path in files:
        text = io.open(path, encoding="utf-8").read()
        if path.endswith(".css"):
            for m in DEFINITION.finditer(text):
                defined.add(m.group(1))
        for lineno, line in enumerate(text.split("\n"), start=1):
            for m in REFERENCE.finditer(line):
                name, following = m.group(1), m.group(2)
                if following == ",":
                    fallback.setdefault(name, []).append((path, lineno))
                else:
                    bare.setdefault("%s @ %s" % (name, path), []).append(lineno)

    referenced = set()
    for key in bare:
        referenced.add(key.split(" @ ")[0])
    referenced |= set(fallback)

    return files, defined, referenced, bare, fallback


def main():
    files, defined, referenced, bare, fallback = measure()

    print("files scanned            %4d" % len(files))
    print("properties defined       %4d" % len(defined))
    print("properties referenced    %4d" % len(referenced))

    # --- non-vacuity, before any verdict ---
    if len(files) < MIN_FILES:
        print(
            "\nundefined-css-properties: REFUSED — scanned only %d files against a floor of %d."
            % (len(files), MIN_FILES)
        )
        print("The file walk is broken. A check that reads nothing reports a clean nothing.")
        return 1
    if len(defined) < MIN_DEFINED:
        print(
            "\nundefined-css-properties: REFUSED — found only %d definitions against a floor of "
            "%d." % (len(defined), MIN_DEFINED)
        )
        print(
            "The DEFINITION pattern has stopped matching, which would report every property in "
            "the tree as undefined. That is a broken parser, not a finding."
        )
        return 1
    if len(referenced) < MIN_REFERENCED:
        print(
            "\nundefined-css-properties: REFUSED — found only %d references against a floor of %d."
            % (len(referenced), MIN_REFERENCED)
        )
        print(
            "The REFERENCE pattern has stopped matching. This is the direction that reports a "
            "clean nothing, so it refuses by name instead."
        )
        return 1

    undefined_bare = {k: v for k, v in bare.items() if k.split(" @ ")[0] not in defined}

    undefined_fallback = sorted(n for n in fallback if n not in defined)
    print("")
    print(
        "=== referenced with a FALLBACK and not defined: %d — these render the fallback, by "
        "design ===" % len(undefined_fallback)
    )
    for name in undefined_fallback:
        for (path, lineno) in fallback[name]:
            print("  %-24s %s:%d" % (name, path, lineno))
    if not undefined_fallback:
        print("  (none)")

    print("")
    print("=== referenced BARE and not defined: %d site group(s) ===" % len(undefined_bare))
    for key in sorted(undefined_bare):
        lines = ", ".join(str(n) for n in undefined_bare[key])
        mark = "declared" if key in DECLARED_BARE else "NOT DECLARED"
        print("  [%-12s] %s  (line %s)" % (mark, key, lines))
    if not undefined_bare:
        print("  (none)")

    found = set(undefined_bare)
    new = sorted(found - DECLARED_BARE)
    stale = sorted(DECLARED_BARE - found)

    if new:
        print(
            "\nundefined-css-properties: FAILED — %d bare reference(s) to an undefined custom "
            "property that nobody declared." % len(new)
        )
        for key in new:
            print("    %s" % key)
        print(
            "A bare `var(--x)` where --x is undefined drops the WHOLE declaration: the element "
            "renders with no background, no border, no shadow — whichever property it was. "
            "Nothing else in this repository can see it, which is why this gate exists."
        )
        print(
            "Define the property in `apps/web/app/globals.css` — in the light block AND both dark "
            "blocks — or point the site at one of the %d that already exist." % len(defined)
        )
        return 1

    if stale:
        print(
            "\nundefined-css-properties: FAILED — %d declared row(s) no longer occur, so remove "
            "them from DECLARED_BARE." % len(stale)
        )
        for key in stale:
            print("    %s" % key)
        print(
            "This half is what stops the declared list becoming a ceiling: a fix is recorded by "
            "deleting its row, not by leaving it to cover a future regression."
        )
        return 1

    print(
        "\nundefined-css-properties: every bare reference resolves, and the %d declared "
        "exception(s) all still occur." % len(DECLARED_BARE)
    )
    return 0


if __name__ == "__main__":
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    sys.exit(main())
