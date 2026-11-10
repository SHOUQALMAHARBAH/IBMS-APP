"""A LEGAL NUMBER MUST NOT BE HARD-CODED. This is the gate that says when a new one is.

Module 1's first quality criterion. Run it: `npm run check:legal-numbers`.

## The discriminator, stated before it was run so no figure could be fitted to it

    A numeric constant is a LEGAL NUMBER iff a legal instrument states its value.

That is not mechanically decidable from a number, so the gate reads a PROXY that is:

    a numeric constant DECLARATION whose OWN comment cites a legal source
    (an article, a law, a set of Instructions, a dated regulation)

The unit is therefore "cited numeric constant declaration", never "numeric literal". That is the
whole reason a page size of 50 is not flagged -- nothing cites it -- and a `LEGAL_VALUES.x` lookup is
not flagged either, because it is not a literal.

## The proxy's weakness, reported rather than hidden

An UNCITED legal number is invisible to this gate. It rides on the repo's standing rule that a
regulatory obligation cites its source document, and that rule is enforced by review rather than by a
script. A figure with no comment at all is the case a reader must still catch.

## Why it reads the declaration's OWN COMMENT BLOCK and not a window

The first version used the 12-line lookback that `undated-absence-claims.py` uses for dates, and it
produced a FALSE POSITIVE on its first real run: `SECOND_NOTICE_DAYS_BEFORE_EXPIRY = 30`, whose own
comment says in terms *"NO ARTICLE -- stated plainly"*, was flagged because the NEIGHBOURING
declaration's comment cites art. 11 and fell inside the window. A gate that reads somebody else's
citation is attributing a legal source to a number nobody claimed one for -- the exact defect the
gate exists to prevent, committed by the gate.

So the block is walked upward from the declaration and stops at the first line that is not a comment
and not blank. A trailing `// ...` on the declaration line counts as its own comment too.

## Why the declared list is a LIST and not a count

A count tells you the number moved; it cannot tell you which one. Each entry carries why it is still
a literal, so the gate is also the record of what module 1 owes the legal-values table. It fails in
BOTH directions: a new cited literal fails, and a fixed one fails until its line is deleted here --
the half that stops a declaration list becoming a ceiling nobody lowers.
"""

import re
import sys
from pathlib import Path

# A GATE INSIDE A `check:` CHAIN SETS ITS OWN STDOUT ENCODING. Recorded 2026-11-08: documenting
# `PYTHONIOENCODING=utf-8` in a header is useless when the invocation is `npm run`, and a sibling
# gate crashed with `UnicodeEncodeError: 'charmap' codec` on every Windows shell while passing in CI
# -- green where it is checked, broken where it is written.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOTS = [Path("apps/api/src"), Path("apps/web/lib"), Path("packages/db/prisma")]

# A numeric constant DECLARATION: `const`/`readonly` assignment of a bare number. An arbitrary
# `foo(50)` call argument is out of scope by construction -- a gate that flagged every numeric
# literal would flag thousands and be switched off in a week.
DECL = re.compile(
    r"^\s*(?:export\s+)?(?:const|readonly|static\s+readonly)\s+([A-Za-z_][A-Za-z0-9_]*)"
    r"\s*(?::\s*[A-Za-z<>\[\]|'\" ]+)?\s*=\s*(-?[0-9][0-9_]*(?:\.[0-9]+)?)\s*(?:as\s+const)?\s*;"
)

# CITES A LEGAL SOURCE. Each alternative is a thing only a legal instrument produces.
#
# CASE-INSENSITIVE, and the self-test keeps that case permanently. The house form is a lowercase
# `art. 21/b/5` mid-sentence, but a doc comment OPENS with `Art. 23 -- ...`, and the case-sensitive
# first version read two planted legal numbers as technical constants (5/7, before any figure rested
# on it). The `\b` before `art` is load-bearing: without it the pattern matches the tail of "part.".
CITATION = re.compile(
    r"\bart\.\s*[0-9]"
    r"|\barticle\s+[0-9]"
    r"|المادة"
    r"|instructions\s+no"
    r"|تعليمات\s*(?:رقم)?\s*\("
    r"|no\.\s*9\s*of\s*2026"
    r"|pdpl|law\s+no|قانون\s+رقم"
    r"|cbj\s+instructions",
    re.IGNORECASE,
)

COMMENT_LINE = re.compile(r"^\s*(/\*|\*|//|\*/)")

# ---------------------------------------------------------------------------
# THE DECLARED LIST. A legal number that is still a literal, each with its reason.
#
# Measured 2026-11-10. Every entry is a figure module 1 intends to move into the legal-values table
# (`SlaPolicy`'s shape extended for non-duration values -- see
# `docs/modules/module-01-opening-measurement.md` and decision 123, which decides WHO supplies a
# value we cannot read).
#
# Keyed by `path:NAME` rather than by line number, so ordinary edits above a declaration do not
# make this list stale.
# ---------------------------------------------------------------------------
DECLARED = {
    "apps/api/src/modules/compliance-risk/broker-license.config.ts:RENEWAL_APPLICATION_DUE_DAYS_BEFORE_EXPIRY":
        "Art. 11's filing deadline, 45 CALENDAR days. The ONE home for it since 2026-11-10 -- "
        "`license-renewal-notice.config.ts` imports it rather than restating it, which it used to do "
        "under a comment denying it did.",
    "apps/api/src/modules/compliance-risk/license-standing.config.ts:ARTICLE_14C_SUSPENSION_LIMIT_YEARS":
        "Art. 14/c -- a voluntary suspension that reaches two years is a deemed cancellation. Readable "
        "in our copy of the instrument, so it is not one of the eight unreadable figures; it still "
        "belongs in the legal-values table once that table takes non-duration values.",
}

# NOT IN THE LIST, and worth saying why, because it is the case this gate CANNOT see:
# the technical-staff minimum (`broker-license-scope.config.ts`) is a legal requirement from art. 3/a
# and is NOT a numeric constant declaration at all, nor does its comment cite the article -- module
# 0-c batch 2 item 8 measured that its comment quotes the brief instead. A first draft of DECLARED
# listed it from memory and THIS GATE REFUSED, naming it as declared-but-not-found. That is the
# second direction of the ratchet catching its own author, which is the only evidence it works.


def own_comment_block(lines, index):
    """The declaration's own comment, and nobody else's."""
    out = []
    i = index - 1
    while i >= 0:
        line = lines[i]
        if line.strip() == "":
            # A blank line separates one declaration's comment from the next. Keep walking only if
            # nothing has been collected yet (a blank between the comment and the declaration is
            # unusual but harmless); otherwise stop, so a neighbour's block cannot be reached.
            if out:
                break
            i -= 1
            continue
        if not COMMENT_LINE.match(line):
            break
        out.append(line)
        i -= 1
    trailing = lines[index].split("//", 1)
    if len(trailing) == 2:
        out.append(trailing[1])
    out.append(lines[index])
    return "\n".join(out)


def scan():
    """Returns (cited, scanned) -- cited as a list of (key, path, line, name, value)."""
    cited = []
    scanned = 0
    for root in ROOTS:
        if not root.exists():
            print("ERROR: %s does not exist -- this gate is reading nothing." % root)
            sys.exit(2)
        for path in sorted(root.rglob("*.ts")):
            if path.name.endswith(".spec.ts") or path.name.endswith(".test.ts"):
                continue
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except (OSError, UnicodeDecodeError):
                continue
            for i, line in enumerate(lines):
                m = DECL.match(line)
                if not m:
                    continue
                scanned += 1
                if CITATION.search(own_comment_block(lines, i)):
                    rel = str(path).replace("\\", "/")
                    cited.append(("%s:%s" % (rel, m.group(1)), rel, i + 1, m.group(1), m.group(2)))
    return cited, scanned


SELF_TEST = [
    (
        "/** Art. 23 -- one year from the Instructions' effective date. */\n"
        "export const TRANSITION_PERIOD_DAYS = 365;",
        True,
        "a legal number WITH a citation -- the gate must catch it",
    ),
    (
        "/** How many rows the directory page shows at a time. */\n"
        "export const PAGE_SIZE = 50;",
        False,
        "a technical constant -- the gate must NOT catch it",
    ),
    (
        "/** art. 11 -- a renewal must be filed this many days before expiry. */\n"
        "const RENEWAL_NOTICE_DAYS = 45;",
        True,
        "LOWERCASE `art.`, non-exported -- still caught",
    ),
    (
        "/** Art. 11 -- the house form appears capitalised at the start of a doc comment. */\n"
        "export const CAPITALISED_CITATION = 45;",
        True,
        "CAPITALISED `Art.` -- kept permanently: the case-sensitive first version scored 5/7 here",
    ),
    (
        "/** Retry budget for the outbound mail queue. */\n"
        "export const MAX_RETRIES = 3;",
        False,
        "technical, no citation",
    ),
    (
        "/** المادة (22) البند (م) -- days an ex-agent is barred. */\n"
        "export const AGENT_BAR_DAYS = 90;",
        True,
        "Arabic citation form -- or an Arabic-cited number is invisible",
    ),
    (
        "/** Art. 4/a -- the first capital tranche. */\n"
        "export const FIRST_TRANCHE = LEGAL_VALUES.firstTranche;",
        False,
        "a table lookup, not a literal -- must NOT be flagged",
    ),
    (
        "/** Art. 11 -- the renewal filing deadline. */\n"
        "export const NEIGHBOUR = 45;\n"
        "\n"
        "/** The owner's second threshold. NO ARTICLE -- stated plainly. */\n"
        "export const SECOND = 30;",
        "LAST_ONLY_NOT_FLAGGED",
        "the NEIGHBOUR's citation must not reach the next declaration -- the real false positive",
    ),
    (
        "export const TRAILING = 90; // art. 22/m -- the ex-agent bar\n",
        True,
        "a trailing comment on the declaration line is its own comment too",
    ),
    (
        "/** Part. 3 of the onboarding flow, step 4. */\n"
        "export const STEP_COUNT = 4;",
        False,
        "`Part.` must not match as `art.` -- the word-boundary case",
    ),
]


def flagged_names(src):
    lines = src.splitlines()
    out = []
    for i, line in enumerate(lines):
        m = DECL.match(line)
        if m and CITATION.search(own_comment_block(lines, i)):
            out.append(m.group(1))
    return out


def self_test():
    passed = failed = 0
    for src, expected, why in SELF_TEST:
        names = flagged_names(src)
        if expected == "LAST_ONLY_NOT_FLAGGED":
            ok = names == ["NEIGHBOUR"]
        else:
            ok = bool(names) == expected
        passed += ok
        failed += not ok
        print(("  ok   " if ok else "  FAIL ") + why + ("" if ok else "  (flagged: %s)" % names))
    print("self-test %d/%d" % (passed, passed + failed))
    return failed == 0


def main():
    # Self-test FIRST, so a broken gate says so rather than printing a plausible pass.
    if not self_test():
        print("\nlegal-numbers: the gate's own self-test failed -- its figures mean nothing. Fix it first.")
        return 1
    print()

    cited, scanned = scan()
    found = {key for key, *_ in cited}
    declared = set(DECLARED)

    print("numeric constant declarations scanned : %d" % scanned)
    print("  own comment cites a legal source    : %d" % len(cited))
    print("  declared                            : %d" % len(declared))

    new = sorted(found - declared)
    gone = sorted(declared - found)
    errors = []

    if new:
        errors.append(
            "A LEGAL NUMBER IS HARD-CODED and not declared:\n"
            + "\n".join(
                "    %s:%d  %s = %s" % (path, line, name, value)
                for key, path, line, name, value in sorted(cited)
                if key in set(new)
            )
            + "\n\n  A figure a legal instrument states belongs in the legal-values table -- a value with its\n"
            "  article, its effective date and who entered it (decision 123). If it must stay a literal\n"
            "  for now, add it to DECLARED in this file WITH ITS REASON, which is a decision somebody\n"
            "  reads rather than a number nobody sees."
        )
    if gone:
        errors.append(
            "DECLARED but no longer found (the list has become a ceiling):\n"
            + "\n".join("    %s" % key for key in gone)
            + "\n\n  Either it moved into the legal-values table -- in which case DELETE its line here, which\n"
            "  is the half of the ratchet that makes progress stick -- or it was renamed, and the key\n"
            "  needs updating."
        )

    if errors:
        print()
        for e in errors:
            print("legal-numbers: " + e)
            print()
        return 1

    print("\nlegal-numbers: ok -- %d cited legal literal(s), all declared with a reason." % len(cited))
    return 0


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(0 if self_test() else 1)
    sys.exit(main())
