"""A LEGAL NUMBER MUST NOT BE HARD-CODED. This is the gate that says when a new one is.

Module 1's first quality criterion. Run it: `npm run check:legal-numbers`.

## The discriminator, stated before it was run so no figure could be fitted to it

    A numeric constant is a LEGAL NUMBER iff a legal instrument states its value.

That is not mechanically decidable from a number, so the gate reads a PROXY that is:

    a DECLARATION whose OWN comment cites a legal source
    (an article, a law, a set of Instructions, a dated regulation)

The unit is therefore "cited declaration carrying a figure", never "numeric literal". That is the
whole reason a page size of 50 is not flagged -- nothing cites it -- and a `LEGAL_VALUES.x` lookup is
not flagged either, because it is not a literal.

## TWO SHAPES, and the second one was added because the gate read `ok` over the wrong population

**Shape 1 -- a bare numeric constant.** `export const X = 45;`

**Shape 2 -- a STRUCTURED literal.** An array or object whose values carry the figures.

Shape 2 was added 2026-11-10 (message 34 §2) after the owner found that
`broker-license-scope.config.ts`'s `CAPITAL_BANDS` carries art. 4/a's five figures -- 6, 12 and the
three paid-up capital amounts -- and the gate said `2 of 2 declared`, which was TRUE over a set that
did not contain them. Two independent mechanisms hid them, and the first is the one worth keeping in
mind:

  1. **Shape.** They are object properties, and the three amounts are STRINGS -- because
     `money-decimal-jod.md` forbids a JOD figure existing as a JS number, and that rule is right.
     **So the right rule for money hid the figures from the right rule for legal numbers.**
  2. **Attribution.** The `ART. 4/a's BANDS` comment was not above `CAPITAL_BANDS` at all. Two doc
     comments were stacked and the citation sat above the WRONG declaration, two above the figures.
     So even a shape-aware gate reading the declaration's own comment block would have found no
     citation. The comment was moved onto the declaration it describes in the same batch.

This is rule 12 in the gate module 1 calls its most important check: a completeness predicate that
asserts the absence of what it fears -- "no cited literal is undeclared" -- over a population that
never contained the thing.

## The proxy's weakness, reported rather than hidden

An UNCITED legal number is invisible to this gate. It rides on the repo's standing rule that a
regulatory obligation cites its source document, and that rule is enforced by review rather than by a
script. A figure with no comment at all is the case a reader must still catch.

A figure in PROSE is deliberately NOT in scope: `schema.prisma` mentions art. 13/b/2's 50,000 JOD and
art. 11's 45 days in doc comments, and no program reads either. The unit is a figure the program
READS. Measured 2026-11-10: 101 legal citations live in `.prisma`/`.sql` and 18 in `apps/web/app`
+`components`, all of them prose or provenance notes, none a figure a program reads.

## Why it reads the declaration's OWN COMMENT BLOCK and not a window

The first version used the 12-line lookback that `undated-absence-claims.py` uses for dates, and it
produced a FALSE POSITIVE on its first real run: `SECOND_NOTICE_DAYS_BEFORE_EXPIRY = 30`, whose own
comment says in terms *"NO ARTICLE -- stated plainly"*, was flagged because the NEIGHBOURING
declaration's comment cites art. 11 and fell inside the window. A gate that reads somebody else's
citation is attributing a legal source to a number nobody claimed one for -- the exact defect the
gate exists to prevent, committed by the gate.

So the block is walked upward from the declaration and stops at the first line that is not a comment
and not blank. A trailing `// ...` on the declaration line counts as its own comment too.

## Why the declared list is a LIST and not a count, and why a STRUCTURED entry pins its figures

A count tells you the number moved; it cannot tell you which one. Each entry carries why it is still
a literal, so the gate is also the record of what module 1 owes the legal-values table. It fails in
BOTH directions: a new cited literal fails, and a fixed one fails until its line is deleted here --
the half that stops a declaration list becoming a ceiling nobody lowers.

For a structured literal the NAME alone has no teeth: a seventh band added to an already-declared
array changes no key, so the owner's own plant would have passed. `DECLARED_FIGURES` therefore pins
the figure SET of each declared structured literal, and the gate fails when a figure is added,
removed or changed. That makes this file a second written home for those five numbers, which is
accepted deliberately: the gate FAILS when the two disagree, so they cannot silently diverge, which
is the standard `permission-catalogue-parity.spec.ts` already sets. The extraction file's `7,000`
against the instrument's `7,500` is exactly the drift this catches.
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

# The START of any `const`/`readonly` declaration. Shape 2 begins here and ends at `END_OF_STATEMENT`
# -- the two are separate because the TYPE ANNOTATION can span lines, which is exactly what
# `CAPITAL_BANDS` does (`: readonly {` ... `}[] = [`), so a single-line "= [" pattern misses it.
DECL_START = re.compile(
    r"^(\s*)(?:export\s+)?(?:const|readonly|static\s+readonly)\s+([A-Za-z_][A-Za-z0-9_]*)\b"
)

CITATION = re.compile(
    r"\bart\.\s*[0-9]"
    r"|\barticle\s+[0-9]"
    r"|المادة"
    r"|instructions\s+no"
    r"|تعليمات\s*(?:رقم)?\s*\("
    r"|no\.\s*9\s*of\s*2026"
    # `pdpl(?!-)`: a LEX FILENAME IS NOT A CITATION. `pdpl-sla-timers.md` is the name of a rule in
    # this repo, and bare `pdpl` matched it -- which made `SLA_DASHBOARD_DUE_SOON_WINDOW`, whose own
    # comment says in terms that it is "a dashboard lookahead heuristic, not an SLA registry value",
    # read as a cited legal figure. The self-test keeps that case permanently.
    r"|pdpl(?!-)|law\s+no|قانون\s+رقم"
    r"|cbj\s+instructions",
    re.IGNORECASE,
)

COMMENT_LINE = re.compile(r"^\s*(/\*|\*|//|\*/)")
QUOTED = re.compile(r"'[^'\n]*'|\"[^\"\n]*\"|`[^`\n]*`")
DIGIT_STRING = re.compile(r"['\"`]\s*(-?[0-9][0-9_]*(?:\.[0-9]+)?)\s*['\"`]")
# A bare number in a VALUE position. The guards on both sides keep it off identifiers (`art4a`),
# decimal tails, and the slashes of a citation (`10/a/2`), which is how a doc comment's article
# number would otherwise read as a figure.
BARE_NUMBER = re.compile(r"(?<![\w.'\"/\-])(-?[0-9][0-9_]*(?:\.[0-9]+)?)(?![\w.'\"/\-])")

# ---------------------------------------------------------------------------
# THE DECLARED LIST. A legal number that is still a literal, each with its reason.
#
# Measured 2026-11-10. Every entry is a figure module 1 intends to move into the legal-values table
# (see `docs/modules/module-01-opening-measurement.md` and decision 123, whose FIRST HALF decides
# this set: a value the instrument STATES is seeded by the provider with its article and page).
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
        "Art. 14/c -- a voluntary suspension that reaches two years is a deemed cancellation. It "
        "belongs in the legal-values table once that table takes non-duration values; it is a "
        "literal until then.",
    "apps/api/src/modules/compliance-risk/broker-license-scope.config.ts:CAPITAL_BANDS":
        "Art. 4/a's paid-up capital bands, printed page 5: 5,000 JOD up to 6 branches, 7,500 up to "
        "12, 10,000 above 12. The three amounts are STRINGS because `money-decimal-jod.md` forbids a "
        "JOD figure as a JS number, and that is why this gate could not see them until shape 2 "
        "existed. Decision 123's first half puts all five in the legal-values table, provider-owned.",
}

# ---------------------------------------------------------------------------
# DECLARATIONS WHOSE COMMENT CITES A SOURCE AND WHOSE VALUE NO INSTRUMENT STATES.
#
# The proxy's one false-positive shape: a comment that mentions an article ABOUT SOMETHING ELSE.
# `DECLARED` may not hold these -- every entry there asserts "a legal instrument states this value",
# and putting a house figure in it would make the record false in the one file that exists to keep it
# true.
#
# WHY A LIST RATHER THAN REWORDING THE COMMENT. The first instance was produced by this batch's own
# edit: `DECLARATION_REASON_MIN_LENGTH`'s comment gained a paragraph REPORTING that the legal
# adviser's drafted art. 15/d window asks for 15 against the 10 here. Deleting the citation would
# satisfy the gate by making the documentation worse -- which is the recorded lesson from the
# page-wide-absence gate, where "the only way to satisfy it was to stop explaining the fix". A gate
# must not be payable in explanation.
#
# Checked in BOTH directions like `DECLARED`: an entry that stops being found fails, so a renamed or
# deleted constant cannot leave a silent exemption behind.
# ---------------------------------------------------------------------------
NOT_A_LEGAL_NUMBER = {
    "apps/api/src/common/declaration-reason.ts:DECLARATION_REASON_MIN_LENGTH":
        "A HOUSE rule, not a legal figure: no instrument states ten. Its comment cites art. 15/d "
        "only to REPORT that the legal adviser's drafted window asks for fifteen -- an open question "
        "for the owner, recorded at the one home for this minimum rather than acted on.",
}

# The FIGURE SET of each declared STRUCTURED literal. See the header: the name alone has no teeth,
# because adding a figure to an already-declared array changes no key.
DECLARED_FIGURES = {
    "apps/api/src/modules/compliance-risk/broker-license-scope.config.ts:CAPITAL_BANDS":
        ("10000", "12", "5000", "6", "7500"),
}

# NOT IN THE LIST, and worth saying why, because it is the case this gate CANNOT see:
# the technical-staff minimum (`broker-license-scope.config.ts`) is a legal requirement from art. 3/a
# and is NOT a declaration carrying a figure at all, nor does its comment cite the article -- module
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


ASSIGN = re.compile(r"(?<![=!<>+\-*/%&|^:])=(?![=>])")


def code_of(line):
    """The line with quoted spans blanked and any `//` tail removed.

    Quotes are blanked FIRST, so a `//` inside a string literal cannot truncate real code -- the
    recorded defect that made a comment-stripper eat `"http://localhost:4000/..."` and destroy four
    assertions while reporting a class had fallen by four.
    """
    blanked = QUOTED.sub(lambda m: m.group(0)[0] * 2, line)
    return blanked.split("//", 1)[0]


def statement_body(lines, index):
    """(body, initialiser_first_char) for the declaration starting at `index`.

    The statement ends where BRACKET DEPTH returns to zero on a line ending in `;`.

    INDENTATION IS NOT THE BOUNDARY, and the first version of this function proved it: it ended at
    the first `;`-terminated line at or left of the declaration's indentation, so a two-line
    declaration whose continuation is INDENTED -- `export const X =\n  SOME_CONSTANT;`, which is
    exactly what message 34 §4's fix produced -- ran straight past its own end and picked up the NEXT
    declaration's figure. A neighbour's number attributed to this declaration is the same defect
    `own_comment_block` exists to prevent, one level down.

    The initialiser's first character decides whether this is a LITERAL at all: `[` or `{` is an
    array or object literal; `(` is a function, a bare identifier is a reference, and a quote is a
    string. Only a literal can hide a figure a program reads.
    """
    out = []
    depth = 0
    init = ""
    seen_assign = False
    for j in range(index, min(index + 400, len(lines))):
        line = lines[j]
        out.append(line)
        code = code_of(line)
        if not seen_assign:
            m = None
            for cand in ASSIGN.finditer(code):
                before = code[: cand.start()]
                # RUNNING depth, not the line's own. `CAPITAL_BANDS`'s assignment sits on `}[] = [`,
                # whose prefix closes a brace opened on an EARLIER line -- so a within-line balance
                # test reads -1 and rejects the real assignment. That was this function's second
                # defect and the self-test's headline case is what caught it.
                prefix = depth + sum(before.count(o) for o in "([{") - sum(
                    before.count(c) for c in ")]}"
                )
                if prefix == 0:
                    m = cand
                    break
            if m is not None:
                seen_assign = True
                tail = code[m.end():].strip()
                if tail:
                    init = tail[0]
        elif not init:
            tail = code.strip()
            if tail:
                init = tail[0]
        depth += sum(code.count(o) for o in "([{") - sum(code.count(c) for c in ")]}")
        if depth <= 0 and line.strip().endswith(";"):
            break
    return out, init


def figures_in(body):
    """Figures a program reads in this declaration: numeric strings and bare numbers in values.

    Comment lines and trailing `//` tails are dropped FIRST. A doc comment inside an array -- which
    `REGISTRATION_PACK_DOCUMENTS` has, carrying `art. 10/a/2` -- would otherwise contribute `10`,
    `2` and the rest of a citation as figures.
    """
    found = set()
    for raw in body[1:] if len(body) > 1 else body:
        line = raw
        if COMMENT_LINE.match(line):
            continue
        line = line.split("//", 1)[0]
        for m in DIGIT_STRING.finditer(line):
            found.add(m.group(1).replace("_", ""))
        # Blank every quoted span before looking for a bare number, so a figure inside a string is
        # counted once (above) and the text around it cannot contribute a second time.
        for m in BARE_NUMBER.finditer(QUOTED.sub("''", line)):
            found.add(m.group(1).replace("_", ""))
    return found


def scan_source(lines, rel="<src>"):
    """(bare, structured) cited declarations. Each entry: (key, path, line, name, detail)."""
    bare = []
    structured = []
    for i, line in enumerate(lines):
        m = DECL.match(line)
        if m:
            if CITATION.search(own_comment_block(lines, i)):
                bare.append(("%s:%s" % (rel, m.group(1)), rel, i + 1, m.group(1), m.group(2)))
            continue
        s = DECL_START.match(line)
        if not s:
            continue
        if not CITATION.search(own_comment_block(lines, i)):
            continue
        body, init = statement_body(lines, i)
        if init not in ("[", "{"):
            # Not a literal: a function, a reference, a string, a call. `FIRST_NOTICE_DAYS_BEFORE_EXPIRY
            # = RENEWAL_APPLICATION_DUE_DAYS_BEFORE_EXPIRY` is the shape this deliberately passes --
            # §4's whole point is that the figure has ONE home and this is the reference to it.
            continue
        figures = figures_in(body)
        if figures:
            structured.append(
                ("%s:%s" % (rel, s.group(2)), rel, i + 1, s.group(2), tuple(sorted(figures)))
            )
    return bare, structured


def scan():
    """(bare, structured, scanned) across every root."""
    bare_all = []
    struct_all = []
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
            scanned += sum(1 for line in lines if DECL.match(line))
            rel = str(path).replace("\\", "/")
            bare, structured = scan_source(lines, rel)
            bare_all.extend(bare)
            struct_all.extend(structured)
    return bare_all, struct_all, scanned


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
        # The 90 here is FICTIONAL and deliberately not art. 22/m's real figure, which is 30 days
        # (printed page 29). A fixture may hold any number; this one says so, because the next reader
        # meets it beside a real citation and would otherwise take it for the provision.
        "/** المادة (22) البند (م) -- days an ex-agent is barred. 90 is FICTIONAL; the real figure is 30. */\n"
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
    # ---- shape 2, added 2026-11-10 -----------------------------------------------------------
    (
        "/**\n"
        " * ART. 4/a's BANDS. Amounts are STRINGS, handed to `toMoney`.\n"
        " */\n"
        "export const BANDS: readonly {\n"
        "  upToBranches: number;\n"
        "  requiredJod: string;\n"
        "}[] = [\n"
        "  { upToBranches: 6, requiredJod: '5000' },\n"
        "  { upToBranches: Number.POSITIVE_INFINITY, requiredJod: '10000' },\n"
        "];",
        True,
        "THE HEADLINE: a cited OBJECT ARRAY whose money figures are STRINGS and whose TYPE spans lines",
    ),
    (
        "/** The two art. 10/a documents, in the order the article lists them. */\n"
        "export const PACK = [\n"
        "  {\n"
        "    key: 'premisesTenure' as const,\n"
        "    /** Art. 10/a/2 -- the lease contract or the title deed. */\n"
        "    article: 'art. 10/a/2',\n"
        "  },\n"
        "] as const;",
        False,
        "a cited array whose ONLY digits are citation text -- must NOT be flagged",
    ),
    (
        "/** A dashboard lookahead heuristic, outside `pdpl-sla-timers.md`'s sourced-value rule. */\n"
        "export const WINDOW: SlaDuration = {\n"
        "  value: 3,\n"
        "  unit: 'calendarDays',\n"
        "};",
        False,
        "a LEX FILENAME is not a citation -- `pdpl-sla-timers.md` must not make this a legal figure",
    ),
    (
        "/** Art. 4/a. */\n"
        "export const REF = SOME_OTHER_CONSTANT;",
        False,
        "a cited one-line REFERENCE is not a literal -- the §4 fix must keep passing",
    ),
    (
        "/** A house minimum. The adviser's drafted art. 15/d window asks for 15; reported only. */\n"
        "export const HOUSE_MINIMUM = 10;",
        True,
        "a comment citing an article ABOUT ANOTHER FIGURE still flags -- which is why NOT_A_LEGAL_NUMBER exists",
    ),
]

FIGURE_SELF_TEST = [
    (
        "/** ART. 4/a's BANDS. */\n"
        "export const BANDS = [\n"
        "  { upToBranches: 6, requiredJod: '5000' },\n"
        "  { upToBranches: 12, requiredJod: '7500' },\n"
        "];",
        ("12", "5000", "6", "7500"),
        "the figure SET is read exactly -- this is what DECLARED_FIGURES pins",
    ),
    (
        "/** ART. 4/a's BANDS. */\n"
        "export const BANDS = [\n"
        "  { upToBranches: 6, requiredJod: '5000' },\n"
        "  { upToBranches: 12, requiredJod: '7500' },\n"
        "  { upToBranches: 20, requiredJod: '15000' },\n"
        "];",
        ("12", "15000", "20", "5000", "6", "7500"),
        "A SEVENTH FIGURE ADDED TO AN EXISTING ARRAY CHANGES THE SET -- the owner's plant",
    ),
]


def flagged_names(src):
    bare, structured = scan_source(src.splitlines())
    return [e[3] for e in bare] + [e[3] for e in structured]


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
    for src, expected, why in FIGURE_SELF_TEST:
        _, structured = scan_source(src.splitlines())
        got = structured[0][4] if structured else ()
        ok = got == expected
        passed += ok
        failed += not ok
        print(("  ok   " if ok else "  FAIL ") + why + ("" if ok else "  (figures: %s)" % (got,)))
    # The declared-figures list must name only declared keys, or a typo makes a pin silently inert --
    # which is the gate's own rule 12 applied to its own declarations.
    both = sorted(set(DECLARED) & set(NOT_A_LEGAL_NUMBER))
    ok = not both
    passed += ok
    failed += not ok
    print(("  ok   " if ok else "  FAIL ")
          + "no key is both DECLARED and NOT_A_LEGAL_NUMBER"
          + ("" if ok else "  (both: %s)" % both))
    stray = sorted(set(DECLARED_FIGURES) - set(DECLARED))
    ok = not stray
    passed += ok
    failed += not ok
    print(("  ok   " if ok else "  FAIL ")
          + "every DECLARED_FIGURES key is a DECLARED key"
          + ("" if ok else "  (stray: %s)" % stray))
    print("self-test %d/%d" % (passed, passed + failed))
    return failed == 0


def main():
    # Self-test FIRST, so a broken gate says so rather than printing a plausible pass.
    if not self_test():
        print("\nlegal-numbers: the gate's own self-test failed -- its figures mean nothing. Fix it first.")
        return 1
    print()

    bare, structured, scanned = scan()
    cited = [(k, p, l, n, v) for k, p, l, n, v in bare] + [
        (k, p, l, n, "{%s}" % ", ".join(v)) for k, p, l, n, v in structured
    ]
    found = {key for key, *_ in cited}
    declared = set(DECLARED)
    exempt = set(NOT_A_LEGAL_NUMBER)

    print("numeric constant declarations scanned : %d" % scanned)
    print("  cited bare numeric constants        : %d" % len(bare))
    print("  cited STRUCTURED literals           : %d" % len(structured))
    print("  declared                            : %d" % len(declared))
    print("  cited but NOT a legal number         : %d" % len(exempt))

    new = sorted(found - declared - exempt)
    gone = sorted(declared - found)
    gone_exempt = sorted(exempt - found)
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
    if gone_exempt:
        errors.append(
            "DECLARED NOT-A-LEGAL-NUMBER but no longer found (a silent exemption):\n"
            + "\n".join("    %s" % key for key in gone_exempt)
            + "\n\n  The declaration was renamed or deleted, or its comment stopped citing a source.\n"
            "  Either way DELETE its line from NOT_A_LEGAL_NUMBER -- an exemption nothing matches\n"
            "  covers whatever lands next."
        )
    if gone:
        errors.append(
            "DECLARED but no longer found (the list has become a ceiling):\n"
            + "\n".join("    %s" % key for key in gone)
            + "\n\n  Either it moved into the legal-values table -- in which case DELETE its line here, which\n"
            "  is the half of the ratchet that makes progress stick -- or it was renamed, and the key\n"
            "  needs updating."
        )

    for key, path, line, name, figures in sorted(structured):
        if key not in DECLARED_FIGURES:
            if key in declared:
                errors.append(
                    "%s:%d  %s is DECLARED but its figures are not pinned.\n\n"
                    "  A structured literal's name has no teeth: a figure added to the array changes no\n"
                    "  key. Add its figure set to DECLARED_FIGURES -- measured now as {%s}."
                    % (path, line, name, ", ".join(figures))
                )
            continue
        want = tuple(sorted(DECLARED_FIGURES[key]))
        if want != figures:
            added = sorted(set(figures) - set(want))
            removed = sorted(set(want) - set(figures))
            errors.append(
                "A LEGAL FIGURE MOVED inside %s:%d  %s\n"
                "    declared : {%s}\n"
                "    found    : {%s}\n"
                "%s%s\n"
                "  A figure a legal instrument states changed, or a new one was added. If the instrument\n"
                "  says so, update DECLARED_FIGURES and cite the printed page. If it does not, this is the\n"
                "  drift the pin exists for -- the extraction file already carries `7,000` where the\n"
                "  instrument says 7,500."
                % (
                    path, line, name,
                    ", ".join(want),
                    ", ".join(figures),
                    ("    added    : %s\n" % ", ".join(added)) if added else "",
                    ("    removed  : %s\n" % ", ".join(removed)) if removed else "",
                )
            )

    if errors:
        print()
        for e in errors:
            print("legal-numbers: " + e)
            print()
        return 1

    print(
        "\nlegal-numbers: ok -- %d cited declaration(s) (%d bare, %d structured): %d declared as legal\n"
        "literals awaiting the legal-values table, %d declared as NOT legal numbers. Every one carries a reason."
        % (len(cited), len(bare), len(structured), len(declared), len(exempt))
    )
    return 0


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(0 if self_test() else 1)
    sys.exit(main())
