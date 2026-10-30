# -*- coding: utf-8 -*-
"""Every hand-written colour in a screen or a component — the design pass's own fourth rule, GATED.

§4 of the design pass says in its own words that a literal colour in a screen is a defect: it is
invisible to the dark theme and to the next brand change. The batch that said so named `#b91c1c` BY
NAME as the example and removed one site.

AND NOTHING COULD SEE THE REST. Eighteen `check:*` scripts and not one looked for a literal colour:
`check:inline-styles` counts style SITES and not what is in them, `check:css-properties` resolves
bare custom-property references, and `check:token-contrast` reads hex only for the pairings it is
given. So the fourth rule was written and unenforced — a wish rather than a control, which is the
distinction this repository draws everywhere else.

## THE DEFECT IS ARITHMETIC, NOT TASTE — AND IT RUNS IN BOTH DIRECTIONS

Measured against the two card surfaces (`#ffffff` light, `#1e2733` dark) when the sweep ran:

    literal    what            on light   on DARK     the token          light    DARK
    #b91c1c    danger text         6.47      2.33      --danger-ink       7.26    6.76
    #15803d    success text        5.02      3.01      --success-ink      6.50    7.81
    #b45309    warning text        5.02      3.00      --warning-ink      5.91    7.91
    #c00       danger fallback     5.89      2.56      --danger-ink       7.26    6.76
    #2a7       ok fallback         2.96      5.08      --success-ink      6.50    7.81
    #6b7280    muted ink           4.83      3.12      --ink-muted

Five of the six FAIL AA in the dark theme, where their token passes comfortably. And `#2a7` fails
in the LIGHT theme instead — a policy that passed its QC check rendered its own "no discrepancy"
marker at 2.96:1 for every light-theme reader, which is the `--brand-800` ramp inversion met a
second time. **The a11y suite is silent about all of it**: axe reads RENDERED contrast and
Playwright runs one theme, so a literal that is legible in the theme the suite happens to be in is
a pass. Same shape as the recorded `opacity`-as-muting regression, and the same reason it survived.

## IT FAILS IN BOTH DIRECTIONS AND THE BUDGET IS ZERO

A new literal fails. A DECLARED exception that no longer occurs fails too — otherwise the list
becomes a ceiling that quietly absorbs whatever lands next, which is what every other ratchet here
is built to prevent. Removing a row is how a fix gets recorded.

## WHY THERE IS A DECLARED LIST AT ALL

Because `rgba(…)` is not automatically a defect, and converting one to make a sweep finish is worse
than leaving it. A modal scrim darkens whatever is behind it in BOTH themes on purpose; a radial
gradient needs a colour at ALPHA, which a plain `var()` cannot express; and a solid badge wants a
step the semantic token set does not have — it ships (bg tint, ink, border) designed for a NOTICE.

**Adding a token to the system to empty this list is not the fix.** `globals.css`'s own 86
properties are a set somebody reasoned about, and a new one needs a light value and two dark ones
decided for it. Each row below names the colour, the site and what it is FOR; a row whose reason is
"so the sweep passes" does not belong here.

## COMMENTS ARE STRIPPED, positions preserved

A colour named in a comment that EXPLAINS why a token replaced it is not a defect, and counting one
is how a gate loses its reader. This file's own header is the first thing that would fail.

## AND THE FLOOR IS A SELF-TEST, NOT A COUNT

It began as `FLOOR = 10` against a real 26 — and the moment the sweep succeeded that floor REFUSED
a correct tree at 9, because a count floor goes stale every time the work it guards gets done. The
matcher is proven against planted inputs instead, which holds at any count including zero.

Run:  python scripts/measurements/literal-colours.py            # the report
      python scripts/measurements/literal-colours.py --check     # the gate
      python scripts/measurements/literal-colours.py --self-test # prove the matcher
"""
import io
import os
import re
import sys

ROOTS = (os.path.join("apps", "web", "app"), os.path.join("apps", "web", "components"))

# A hex colour, and the three CSS colour functions a hand-written colour arrives as. `--token: #x`
# inside `globals.css` is NOT in scope: that file is where a colour is SUPPOSED to be written, and
# it is not a `.tsx`.
HEX = re.compile(r"#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b")
FUNC = re.compile(r"\b(?:rgba?|hsla?)\s*\(")

# ─────────────────────────────────────────────────────────────────────────────────────────────
# DECLARED EXCEPTIONS — a literal with no token, and what it is for.
#
# Keyed `path|colour` rather than `path|line`, because a line number moves on every reflow and a
# declaration that goes stale on a prettier pass teaches everyone to re-number it without reading.
# A file may legitimately hold two of the same colour; the count is checked, so a THIRD fails.
DECLARED = {
    # The unread-notification badge is a SOLID red chip with white text on it. The semantic token
    # set has no solid step: `--danger-bg` is a tint for a panel and `--danger-ink` is text ON that
    # tint, so using the ink as a background inverts in the dark theme (it becomes a pale #e59a9a
    # with white text on it). The code has read `var(--danger-solid, …)` since it was written —
    # somebody anticipated the token and it was never added. Adding `--danger-solid` plus its dark
    # value is a design decision and is in `docs/deferred-register.md`.
    "apps/web/components/app/NotificationBell.tsx|#b42318": 1,
    "apps/web/components/app/NotificationBell.tsx|#fff": 1,
    # A modal scrim. It darkens whatever is behind it and must NOT follow the theme: a scrim that
    # lightens in dark mode stops being a scrim.
    "apps/web/components/auth/IdleLockOverlay.tsx|rgba(": 1,
    # The sign-in panel's two decorative glows: `--brand-600` and the amber at ALPHA inside a
    # radial gradient. A plain `var()` cannot express a token at an alpha, and the amber's own rule
    # (1.99:1 on white — never text, never a ground) is what makes it safe as a glow and unsafe as
    # anything else, so it is deliberately not reachable through a colour token.
    "apps/web/components/ui/AuthFrame.tsx|rgba(": 4,
    # White at alpha on the one surface that stays dark in both themes. The site's own comment
    # already records the reason: there is no token for "a sixth of the surface above me".
    "apps/web/components/ui/BrandPitch.tsx|rgba(": 2,
}

# Planted inputs that prove the matcher. Each is (source, how many colours it must find).
SELF_TEST = (
    ("color: '#b91c1c',", 1),
    ("color: '#fff',", 1),
    ("color: '#b91c1caa',", 1),
    ("borderInlineStart: `3px solid ${x ? 'var(--error, #c00)' : 'var(--ok, #2a7)'}`,", 2),
    ("background: 'rgba(0, 0, 0, 0.6)',", 1),
    ("background: 'radial-gradient(circle, rgba(32,114,184,.5), rgba(32,114,184,0) 68%)',", 2),
    ("boxShadow: 'var(--shadow-md, 0 8px 24px rgba(0,0,0,0.18))',", 1),
    # NEGATIVES. A token reference carries no colour; a comment explaining a removal is not a site;
    # and a hex-looking id or a CSS length must not match.
    ("color: 'var(--danger-ink)',", 0),
    ("/* was #b91c1c — see the token note */", 0),
    ("// #15803d became var(--success-ink)", 0),
    ("href={`/customers/${id}`}", 0),
    ("width: '100%', zIndex: 40,", 0),
)


def strip_comments(src):
    out, i, n = [], 0, len(src)
    while i < n:
        two = src[i : i + 2]
        if two == "//":
            j = src.find("\n", i)
            j = n if j < 0 else j
            out.append(" " * (j - i))
            i = j
        elif two == "/*":
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append("".join(c if c == "\n" else " " for c in src[i:j]))
            i = j
        else:
            out.append(src[i])
            i += 1
    return "".join(out)


def colours_in(src):
    """Every literal colour in one source string, as (line, what). `what` is the hex itself, or
    the bare function name so a declaration does not have to quote an alpha value."""
    found = []
    for n, line in enumerate(strip_comments(src).split("\n"), 1):
        for m in HEX.finditer(line):
            found.append((n, m.group(0)))
        for m in FUNC.finditer(line):
            found.append((n, m.group(0).split("(")[0].strip() + "("))
    return found


def self_test():
    failures = 0
    for src, expected in SELF_TEST:
        got = len(colours_in(src))
        ok = got == expected
        if not ok:
            failures += 1
        sys.stdout.write(
            "  %s expected %d, found %d  %s\n" % ("ok  " if ok else "FAIL", expected, got, src[:70])
        )
    sys.stdout.write("\nself-test: %d case(s), %d failure(s)\n" % (len(SELF_TEST), failures))
    return 1 if failures else 0


def scan():
    rows = []
    for root in ROOTS:
        for d, _, fs in os.walk(root):
            for f in sorted(fs):
                if not f.endswith(".tsx") and not f.endswith(".ts"):
                    continue
                path = os.path.join(d, f)
                rel = path.replace(os.sep, "/")
                for n, what in colours_in(io.open(path, encoding="utf-8").read()):
                    rows.append((rel, n, what))
    return rows


def main():
    if "--self-test" in sys.argv:
        raise SystemExit(self_test())

    rows = scan()
    check = "--check" in sys.argv

    counts = {}
    for rel, _, what in rows:
        counts["%s|%s" % (rel, what)] = counts.get("%s|%s" % (rel, what), 0) + 1

    undeclared = {k: v for k, v in counts.items() if DECLARED.get(k, 0) < v}
    stale = {k: v for k, v in DECLARED.items() if counts.get(k, 0) < v}

    by_file = {}
    for rel, n, what in rows:
        by_file.setdefault(rel, []).append((n, what))

    sys.stdout.write(
        "literal colours: %d site(s) across %d file(s) | %d declared, %d undeclared\n"
        % (len(rows), len(by_file), sum(DECLARED.values()), sum(undeclared.values()))
    )
    sys.stdout.write("\n")
    for rel in sorted(by_file):
        sys.stdout.write("%s\n" % rel)
        for n, what in by_file[rel]:
            key = "%s|%s" % (rel, what)
            mark = "declared" if DECLARED.get(key, 0) else "UNDECLARED"
            sys.stdout.write("    L%-6d %-10s %s\n" % (n, what, mark))

    if undeclared:
        sys.stdout.write("\n=== UNDECLARED, %d site(s) ===\n" % sum(undeclared.values()))
        for k in sorted(undeclared):
            rel, what = k.rsplit("|", 1)
            sys.stdout.write("  %-12s %s (x%d)\n" % (what, rel, undeclared[k]))
        sys.stdout.write(
            "\nA literal colour does not follow the theme. Point it at a token --- the semantic\n"
            "set is (bg, ink, border) x info/success/warning/danger, and --ink-muted /\n"
            "--border-subtle / --shadow-{sm,md,lg} cover the rest. If the colour genuinely has no\n"
            "token, DECLARE it with what it is for; do NOT add a token to make this pass.\n"
        )
    if stale:
        sys.stdout.write("\n=== STALE DECLARATION(S), %d ===\n" % len(stale))
        for k in sorted(stale):
            rel, what = k.rsplit("|", 1)
            sys.stdout.write(
                "  %-12s %s --- declared %d, found %d\n"
                % (what, rel, DECLARED[k], counts.get(k, 0))
            )
        sys.stdout.write(
            "\nRemove the row. A declaration that outlives its site is a ceiling that absorbs\n"
            "whatever lands there next.\n"
        )

    if check and (undeclared or stale):
        raise SystemExit(1)
    if not check:
        sys.stdout.write(
            "\nThe floor is `--self-test`, not a count: a count floor refuses a correct tree the\n"
            "moment the work it guards gets done, which is what this one did at 9 against 10.\n"
        )
    raise SystemExit(0)


if __name__ == "__main__":
    main()
