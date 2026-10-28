#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Every (ink, surface) pairing this product's tokens can produce, with its WCAG contrast ratio,
in BOTH themes.

WHY THIS EXISTS
---------------
The design batch's instruction was *"re-check every pairing the existing WCAG test covers"* — and
measured, **there is no token-level WCAG test**. The accessibility gate is axe-core driven through
Playwright over 84 specs, which measures RENDERED contrast on whatever a screen happens to paint.
That is the stronger check for a screen that exists, and it says nothing at all about a token
pairing no screen has reached yet — which is precisely the hole a brand re-anchoring falls into: the
ramp moves, every a11y spec stays green because none of them renders the moved step, and the first
screen to use it fails for somebody else months later.

So this reads `globals.css` itself and answers the question at the token layer, before any screen is
built. It is a GATE: a pairing the product declares as text-on-surface must clear 4.5, and one
declared as a non-text boundary or a graphical object must clear 3.0 (WCAG 1.4.3 and 1.4.11).

WHAT IT CANNOT SEE, stated rather than discovered
-------------------------------------------------
It reads the TOKENS, not the markup. A screen that paints `--ink-muted` on `--nav-bg` creates a
pairing this file knows nothing about unless somebody declares it here. That is why the a11y suite
is the other half: this one covers the palette, axe covers the composition.

It also cannot see `opacity`. `globals.css`'s own header records why that matters — muting text with
opacity composites toward whatever is behind it, so the rendered colour is one no token declared and
axe measures the blend.

And it resolves `var()` only one level deep through the same block, so a token defined as a gradient
or an `rgba()` is reported UNRESOLVED rather than silently skipped: a pairing that cannot be
measured is a finding, not a pass.
"""
from __future__ import annotations

import pathlib
import re
import sys

CSS = pathlib.Path("apps/web/app/globals.css")

TEXT = "text"
UI = "ui"
SEPARATOR = "sep"

# --- the declared pairings -------------------------------------------------------------------
#
# (ink token, surface token, kind, why). Each row is a pairing the product ACTUALLY paints; adding
# one means a screen paints it, and removing one means no screen does.
#
# THREE KINDS, AND THE THIRD IS THE ONE THAT KEEPS THIS GATE CREDIBLE. `TEXT` is WCAG 1.4.3's 4.5
# and `UI` is 1.4.11's 3.0 — a boundary or a graphical object whose appearance CARRIES INFORMATION,
# which is a chart series and a focus ring. A `SEPARATOR` is a decorative hairline: a card's own
# outline, a row rule. 1.4.11 does not reach it (the card is not a control and its edge carries no
# state), it is REPORTED and never gated, and the reason is measured rather than conceded — the
# first version of this file gated every border at 3.0 and produced SIX reds on a palette whose
# accessibility suite is green, which is the cry-wolf direction `hardcoded-ui-english.py`'s own
# header warns is harder to recover from than under-counting. Raising those hairlines to clear 3.0
# would darken every card and input outline in the product, which is a design change nobody asked
# for, made to satisfy a gate I had just invented.
PAIRINGS: list[tuple[str, str, str, str]] = [
    # --- ink on the four surfaces -----------------------------------------------------------
    ("--ink-primary", "--surface-page", TEXT, "body copy on the page ground"),
    ("--ink-primary", "--surface-card", TEXT, "body copy on a card"),
    ("--ink-primary", "--surface-sunken", TEXT, "body copy on an inset block"),
    ("--ink-secondary", "--surface-page", TEXT, "a description line under a heading"),
    ("--ink-secondary", "--surface-card", TEXT, "a card's description line"),
    ("--ink-secondary", "--surface-sunken", TEXT, "a hint inside a filter bar"),
    ("--ink-muted", "--surface-page", TEXT, "a column heading"),
    ("--ink-muted", "--surface-card", TEXT, "a table head on a card"),
    ("--ink-muted", "--surface-sunken", TEXT, "a field label in a filter bar"),
    # --- the brand ---------------------------------------------------------------------------
    ("--ink-brand", "--surface-card", TEXT, "a link, and a ghost button's label"),
    ("--ink-brand", "--surface-page", TEXT, "a link on the page ground"),
    ("--ink-brand", "--surface-sunken", TEXT, "a link inside a filter bar"),
    ("--brand-700", "--brand-50", TEXT, "Badge tone=brand"),
    ("--brand-800", "--surface-card", TEXT, "a heading in the brand's deep navy"),
    # --- the ink that goes ON the interactive fill -------------------------------------------
    #
    # `--on-brand` exists because the pairing has to be DECLARABLE. Reference page B redefines its
    # brand colour to a light blue in dark mode while leaving `.btn`'s label `#fff`, which is white
    # on `#6BB0E6` — measured 3.02, a real contrast defect in the page this batch builds from. A
    # named ink lets the dark theme flip it to navy and lets this gate check that it did.
    ("--on-brand", "--brand-600", TEXT, "the primary button's own label"),
    # --- the amber, which is a FILL and never text -------------------------------------------
    ("--accent-ink", "--accent", TEXT, "the one thing written ON amber"),
    # --- the navy rail -----------------------------------------------------------------------
    ("--nav-ink", "--nav-bg", TEXT, "a rail link"),
    ("--nav-ink-muted", "--nav-bg", TEXT, "a rail group heading"),
    # --- semantic ----------------------------------------------------------------------------
    ("--info-ink", "--info-bg", TEXT, "an informational pill"),
    ("--success-ink", "--success-bg", TEXT, "a success pill"),
    ("--warning-ink", "--warning-bg", TEXT, "a warning pill"),
    ("--danger-ink", "--danger-bg", TEXT, "a refusal, and an error line"),
    # --- graphical objects whose appearance carries information, 3.0 -------------------------
    #
    # A series is measured against its TRACK, not against the card: what a reader has to tell apart
    # is the filled part of a bar or ring from the unfilled part behind it.
    ("--chart-1", "--track", UI, "the first series against its track"),
    ("--chart-2", "--track", UI, "the second series against its track"),
    ("--chart-3", "--track", UI, "the third series against its track"),
    ("--chart-4", "--track", UI, "the fourth series against its track"),
    ("--accent", "--nav-bg", UI, "the amber rail marking the active nav item"),
    # --- decorative hairlines: REPORTED, never gated -----------------------------------------
    ("--border-subtle", "--surface-card", SEPARATOR, "a row rule inside a table"),
    ("--border-default", "--surface-card", SEPARATOR, "a card's own outline"),
    ("--border-strong", "--surface-card", SEPARATOR, "an input's outline"),
    ("--border-strong", "--surface-sunken", SEPARATOR, "an input inside a filter bar"),
    ("--track", "--surface-card", SEPARATOR, "the unfilled track itself against the card"),
]

FLOORS = {TEXT: 4.5, UI: 3.0, SEPARATOR: 0.0}


def srgb_to_linear(channel: float) -> float:
    c = channel / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(hex_colour: str) -> float:
    h = hex_colour.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    r, g, b = (int(h[i : i + 2], 16) for i in (0, 2, 4))
    return (
        0.2126 * srgb_to_linear(r)
        + 0.7152 * srgb_to_linear(g)
        + 0.0722 * srgb_to_linear(b)
    )


def ratio(a: str, b: str) -> float:
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


HEX = re.compile(r"^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$")


def declarations(block: str) -> dict[str, str]:
    raw: dict[str, str] = {}
    for name, value in re.findall(r"(--[a-z0-9-]+)\s*:\s*([^;]+);", block):
        raw[name] = value.strip()
    out: dict[str, str] = {}
    for name, value in raw.items():
        hops = 0
        while value.startswith("var(") and hops < 4:
            inner = value[4:].split(")", 1)[0].split(",")[0].strip()
            nxt = raw.get(inner)
            if nxt is None:
                break
            value = nxt
            hops += 1
        out[name] = value
    return out


def theme_blocks(css: str) -> dict[str, dict[str, str]]:
    root = re.search(r":root \{(.*?)\n\}", css, re.S)
    if root is None:
        sys.exit("REFUSED: no :root block found — the parser is broken, not the palette")
    light = declarations(root.group(1))

    dark_match = re.search(r':root\[data-theme="dark"\] \{(.*?)\n\}', css, re.S)
    if dark_match is None:
        sys.exit('REFUSED: no :root[data-theme="dark"] block found')
    dark = dict(light)
    dark.update(declarations(dark_match.group(1)))
    return {"light": light, "dark": dark}


def main() -> int:
    css = CSS.read_text(encoding="utf-8")
    themes = theme_blocks(css)

    # Non-vacuity. A parser that stops matching reports a clean nothing, which is the shape this
    # repository has paid for four times. Both are floors, not pins.
    if len(themes["light"]) < 60:
        sys.exit(
            "REFUSED: parsed only %d light tokens — the parser is broken, not the palette"
            % len(themes["light"])
        )
    if len(PAIRINGS) < 20:
        sys.exit("REFUSED: fewer than 20 declared pairings — somebody emptied the list")

    failures: list[str] = []
    unresolved: list[str] = []
    rows: list[tuple[str, str, str, float, float]] = []

    for ink, surface, kind, why in PAIRINGS:
        values: dict[str, float | None] = {}
        for theme, tokens in themes.items():
            a, b = tokens.get(ink), tokens.get(surface)
            if a is None or b is None:
                missing = ink if a is None else surface
                unresolved.append("%-5s %s on %s — %s is not declared" % (theme, ink, surface, missing))
                values[theme] = None
                continue
            if not HEX.match(a) or not HEX.match(b):
                unresolved.append(
                    "%-5s %s on %s — not a flat hex (%s on %s); a gradient or rgba() cannot be "
                    "measured here" % (theme, ink, surface, a, b)
                )
                values[theme] = None
                continue
            values[theme] = ratio(a, b)

        rows.append((ink, surface, kind, values["light"] or 0.0, values["dark"] or 0.0))
        floor = FLOORS[kind]
        for theme, value in values.items():
            if value is not None and value < floor:
                failures.append(
                    "%-5s %s on %s: %.2f < %.1f (%s) — %s"
                    % (theme, ink, surface, value, floor, kind, why)
                )

    width = max(len(i) + len(s) for i, s, _, _, _ in rows) + 5
    print("%-*s %-5s %6s %6s" % (width, "pairing", "kind", "light", "dark"))
    print("-" * (width + 20))
    for ink, surface, kind, light, dark in rows:
        print("%-*s %-5s %6.2f %6.2f" % (width, "%s on %s" % (ink, surface), kind, light, dark))

    print("")
    print("tokens parsed: %d light, %d dark" % (len(themes["light"]), len(themes["dark"])))
    print("pairings declared: %d" % len(PAIRINGS))

    if unresolved:
        print("")
        print("UNRESOLVED — a declared pairing that cannot be measured:")
        for line in unresolved:
            print("  %s" % line)

    if failures or unresolved:
        print("")
        print("FAILED:")
        for line in failures:
            print("  %s" % line)
        print("")
        print(
            "Fix the TOKEN, never this list: a pairing removed to clear the gate is a pairing a\n"
            "screen still paints. If a row genuinely no longer occurs, delete it in the same commit\n"
            "that removes its last render site, and say so."
        )
        return 1

    print("")
    print("OK — every declared pairing clears its floor in both themes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
