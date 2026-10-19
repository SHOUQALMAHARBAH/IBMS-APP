"""PAGE-WIDE ABSENCE ASSERTIONS IN THE WEB e2e SUITE — measured, classified, and ratcheted.

## WHY THIS EXISTS

An absence assertion rooted at `page` can match an element the test is not about. It did:
a role-name absence loop on the RFQ not-found notice matched "Compliance" in the NAV
SIDEBAR and failed on a correct tree. It was the FOURTH time that trap had been paid for,
one commit after the rule forbidding it was written down — so the rule is not the fix.

## WHY THE BAN IS NARROW, AND WHY THAT IS THE HONEST SHAPE

191 page-wide absence assertions exist. A flat ban is a red build across 54 files, and
nothing new ships while the build is red. But the shapes are NOT equally dangerous:

  * `getByTestId` — a `data-testid` is unique by construction here, so a page-wide root
    cannot match an unrelated element. Converting these buys nothing.
  * `getByRole` — role-constrained; collides only on a repeated accessible name.
  * `locator` — CSS, and includes the legitimate `main p[role="alert"]` scoping.
  * `getByLabel` — a form label.
  * `getByText` — THE TRAP, and the only shape that can match any text anywhere.

So the ratchet is on the text class alone, which is where the defect lives.

## THE SCRIPT THAT POLICES A NUMBER PRINTS THAT NUMBER

An earlier version printed the breakdown by SCOPING and not by SHAPE, so the figure
carrying the proposed rule was nowhere in its output and had to be re-derived by hand —
which produced a different number (42 against 43) from first-match classification order.
A rule-bearing figure that only exists in a report is a figure nobody can check. So:

  * the shape breakdown is always printed;
  * classification order is EXPLICIT and most-specific-first, below;
  * `--check` compares the text class against `TEXT_LOCATOR_BUDGET` and fails in BOTH
    directions — above it (a new one shipped) and below it (the budget must follow, or a
    ratchet becomes a ceiling).

Written with the editor, never a heredoc: the patterns carry regex escapes and this host
eats backslashes in a heredoc.
"""

import io
import os
import re
import sys

E2E = os.path.join("apps", "web", "e2e")

# An ABSENCE assertion: the matcher says "this is not there".
ABSENT_MATCHER = r"\.(toHaveCount\(\s*0\s*\)|toBeHidden\(\))"
NOT_VISIBLE = r"\.not\.toBeVisible\(\)"

# CLASSIFICATION ORDER, most specific first and stated rather than incidental. A subject can
# mention several (`page.locator('x').getByText('y')`), and whichever is checked first wins — which
# is exactly what made a hand re-derivation disagree with this script by one. The order is part of
# the measurement, so it is here and not implied by a loop.
SHAPES = [
    "getByTestId",
    "getByRole",
    "getByLabel",
    "getByPlaceholder",
    "getByTitle",
    "getByAltText",
    "getByText",
    "locator",
]

# THE REMAINDER, DECLARED BY ITS COUNT RATHER THAN BY SILENCE.
#
# These are the page-wide `getByText` absence assertions that existed when the rule was adopted.
# The number must come DOWN and never up. At 0 it becomes a flat ban on the class with no switch to
# throw — the same shape as `MISSING_DESCRIPTION_BUDGET`, which reached 0 and stayed there.
#
# Lower it as sites are converted. Do NOT raise it: a new one is the defect this measures.
TEXT_LOCATOR_BUDGET = 42


def source_files():
    out = []
    for root, _dirs, names in os.walk(E2E):
        for n in names:
            if n.endswith(".ts"):
                out.append(os.path.join(root, n))
    return out


def classify(subject):
    for shape in SHAPES:
        if re.search(r"\.\s*" + shape + r"\s*\(", subject):
            return shape
    return "(other)"


def main():
    files = source_files()
    if len(files) < 100:
        print(
            "page-wide-absence: scanned only %d e2e files, which is not a clean result"
            % len(files)
        )
        return 1

    page_wide = []
    scoped = 0
    string_level = 0
    via_helper = 0

    for path in sorted(files):
        src = io.open(path, encoding="utf-8").read()
        # Flattened, because prettier wraps most of these across lines and a line-based matcher
        # would see none of them.
        flat = re.sub(r"\s+", " ", src)

        for pattern in (
            r"expect\(\s*([^;]{0,400}?)\s*\)" + ABSENT_MATCHER,
            r"expect\(\s*([^;]{0,400}?)\s*\)" + NOT_VISIBLE,
        ):
            for m in re.finditer(pattern, flat):
                subject = m.group(1)
                # `page.locator('main …')` is SCOPED, not page-wide. Counting it as the defect would
                # classify the correct fix as the thing being measured — the first version of this
                # script did exactly that and reported three more than it should, including the
                # `main p[role="alert"]` scoping written to FIX one of these.
                rooted_at_page = re.search(r"\bpage\s*\.", subject) and not re.search(
                    r"\bpage\s*\.\s*locator\(\s*['\"`]main", subject
                )
                if rooted_at_page:
                    page_wide.append((path, classify(subject), subject[:88]))
                else:
                    scoped += 1

        string_level += len(
            re.findall(r"expect\(\s*[^;]{0,200}?\s*\)\.not\.toContain\(", flat)
        )
        via_helper += len(re.findall(r"expectNone\(", flat))

    by_shape = {}
    for _p, shape, _s in page_wide:
        by_shape[shape] = by_shape.get(shape, 0) + 1
    text_sites = [(p, s) for p, shape, s in page_wide if shape == "getByText"]
    text_files = sorted({p for p, _s in text_sites})

    print("e2e files scanned: %d" % len(files))
    print()
    print("ABSENCE ASSERTIONS, by scoping:")
    print("  page-wide                     : %d" % len(page_wide))
    print("  already scoped                : %d" % scoped)
    print("  string-level (.not.toContain) : %d" % string_level)
    print("  via expectNone(target,anchor) : %d" % via_helper)
    print()
    print("THE PAGE-WIDE ONES, BY SUBJECT SHAPE (most specific matcher wins; see SHAPES):")
    for shape in SHAPES + ["(other)"]:
        if shape not in by_shape:
            continue
        note = ""
        if shape == "getByText":
            note = "   <-- THE TRAP: matches any text anywhere, including the nav"
        elif shape == "getByTestId":
            note = "   (unique by construction here — not the trap)"
        print("  %-18s %3d%s" % (shape, by_shape[shape], note))
    print()
    print(
        "TEXT-LOCATOR CLASS: %d occurrence(s) across %d file(s), budget %d"
        % (len(text_sites), len(text_files), TEXT_LOCATOR_BUDGET)
    )
    for path in text_files:
        n = len([1 for p, _s in text_sites if p == path])
        print("    %-46s %d" % (path.replace(os.sep, "/").replace("apps/web/e2e/", ""), n))

    if "--check" not in sys.argv:
        return 0

    # ---------------------------------------------------------------- the ratchet
    actual = len(text_sites)
    if actual > TEXT_LOCATOR_BUDGET:
        print()
        print(
            "page-wide-absence: FAILED — %d page-wide `getByText` absence assertion(s) against a "
            "budget of %d." % (actual, TEXT_LOCATOR_BUDGET)
        )
        print(
            "A page-wide text absence can match an element the test is not about: a role-name loop "
            "on one notice matched a NAV LABEL and failed on a correct tree."
        )
        print(
            "Scope it with `expectAbsentWithin(scope, build)` from `e2e/support/anchored.ts` — it "
            "takes a Locator, so the compiler refuses a page-wide root, and it asserts the scope "
            "VISIBLE first because scoping fixes the wrong-element failure and NOT the "
            "not-yet-rendered one (`toHaveCount(0)` passes on its first poll)."
        )
        print("Do NOT raise the budget.")
        return 1
    if actual < TEXT_LOCATOR_BUDGET:
        print()
        print(
            "page-wide-absence: FAILED — only %d remain, so lower TEXT_LOCATOR_BUDGET to %d."
            % (actual, actual)
        )
        print(
            "This half is what stops a ratchet becoming a ceiling: at 0 it is a flat ban on the "
            "class with no switch to throw."
        )
        return 1
    print()
    print(
        "page-wide-absence: the text-locator class is at its declared budget of %d."
        % TEXT_LOCATOR_BUDGET
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
