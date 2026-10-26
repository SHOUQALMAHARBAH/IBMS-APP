# -*- coding: utf-8 -*-
"""User-facing English written directly into a screen, on an Arabic-first platform.

Rule 6 of `docs/b7-consistency-record.md`: Arabic and English say the same thing. A string typed into
JSX says it in one language only, and the one that gets missed is the primary one.

## Why this is a script and not a grep

Three ad-hoc detectors written during item 5 each UNDER-COUNTED, which is the dangerous direction: a
sweep that misses violations reports a screen as clean.

  1. A pattern matching `>Text<` missed a date inside a TEMPLATE LITERAL — the compliance dashboard's
     `` ` (as of ${...})` ``, found only because a source-reading guard looked for the field instead.
  2. A refined pattern SKIPPED ANY LINE CONTAINING `t(`, so `Needs assessment {id} — status {t(...)}`
     was invisible: the line is half translated, and the untranslated half is the violation.
  3. The same pattern missed `` `Risk profile ${id}` `` because a BACKTICK is not one of the characters
     it accepted before a capital letter.

So the scan is here, with a self-test whose cases are those three real misses rather than invented ones.
`--self-test` is what makes a future refinement provable rather than hopeful.

## WHAT A ZERO FROM THIS SCRIPT MEANS, AND WHAT IT DOES NOT

**Zero means zero of what this detector can see.** SIX blind spots and one counting defect have been found,
and every single one was found by READING a screen for some other reason — none by the guard, and none by
reasoning about the patterns:

    1  a date inside a template literal            (compliance dashboard)
    2  prose on a line that also calls t()         (insurance-programs/new)
    3  prose after a backtick                      (risk-profiles)
    4  LOWERCASE prose, which no capital-initial rule can see
    5  a ONE-WORD label before a colon             (13 strings on 8 screens, while this read 0/102)
    6  a BARE JSX TEXT LINE, one word, no colon    (21 strings on 14 screens, while this read 0/102)
    +  a DEDUPE keyed on the text alone, so a screen with three `Cancel` buttons reported ONE

Numbers 5 and 6 are the ones to keep in mind, and 6 is the worse of the two: this script reported **0 across
102 screens** while `Cancel` ×7, `Save` ×4, `Rename` ×2, `Search` ×4, `Edit`, `Back`, `Total`, `Channel` and
`Category` stood typed into fourteen screens in English. Fourteen of the twenty-one had a translated key
sitting unused in `common.ts` — the Arabic existed and the screen did not reach for it.

The dedupe is the counting defect and it compounded number 6: `not any(text == t for _, t in out)` skipped a
repeat of the same text ANYWHERE in the file, so the first pass reported 19 where there were 21, and the last
two only became visible once the first two were fixed. It is keyed on `(line, text)` now.

**So this guard PREVENTS REGRESSION; it does not PROVE COMPLIANCE.** Nobody knows whether there is a seventh
blind spot, and the base rate so far is that there is. A reader who takes "0/102" as "there are none" is
building on something that was not measured — the honest reading is "none of the six known shapes remain".

If you find a seventh: add the pattern, add its real case to `--self-test` (never an invented one), and add a
line above. The list getting longer is the point. And when you tighten a pattern, MEASURE THE COUNT BOTH
WAYS — number 6's first version reported 277 hits on 97 screens, almost all of them multi-line code
continuations, which is the cry-wolf direction and gets a guard switched off rather than fixed.

Run:  python scripts/measurements/hardcoded-ui-english.py [<screen-glob> ...]
      python scripts/measurements/hardcoded-ui-english.py --self-test
"""
import io
import os
import re
import sys

APP = os.path.join('apps', 'web', 'app', '(app)')
# BLIND SPOT, CLOSED 2026-10-26 — and the largest one this script has had.
#
# It scanned `page.tsx` and nothing else, so 63 component files had NEVER been read.
# The owner's walk found literal English on twelve screens with her own eyes while
# this reported 0 for every one of them: `StartCyclePanel.tsx` renders the string
# "Start cycle" as a button label, right beside a `t()` call for the submitting
# state. Running the EXISTING eight patterns over those files found 17 strings in 9
# of them, with no new pattern at all — which is the measurement that matters most
# here: the shapes were fine and the SURFACE was half missing.
COMPONENTS = os.path.join('apps', 'web', 'components')

# A translated call, so its ARGUMENT (a key) is never mistaken for prose. Removed rather than used to
# skip the line — failure mode 2 was skipping any line that contained one.
T_CALL = re.compile(r"\b(?:t|tr|tPlural)\(\s*'[^']*'(?:\s*,[^)]*)?\)")
# Attribute values and machine strings that are not user-facing copy.
MACHINE = re.compile(
    r'(data-testid|htmlFor|aria-[a-z]+|className|style=|key=|\bid=|router\.push|'
    r'api(?:Get|Post|Patch|Delete|FetchBlob)|encodeURIComponent|localStorage|'
    r'process\.env|console\.|new RegExp)'
)
CODE_PREFIX = ('//', '*', '/*', 'import ', 'export type', 'type ', 'interface ', 'const ', 'let ')
# ATTRIBUTE VALUES ARE MASKED, NOT SKIPPED — the largest blind spot this script has
# had, larger than the component root.
#
# `MACHINE.search(s)` discarded the WHOLE LINE on `style=`, `className`, `key=`,
# `aria-*` or a `data-testid` — and in this codebase nearly every rendered table
# cell is `<td style={cell}>…</td>`. Measured: **5,218 non-blank lines, 10.7% of
# the web tree, were skipped whole, and 1,233 of those also carried a text
# position.** So twelve patterns were blind to the text beside an attribute.
#
# This is mode 2's own principle, never applied to attributes: *a line that is
# half translated has its untranslated half examined rather than being skipped
# whole.* Masking leaves the `MACHINE` guard meaningful — a line that is NOTHING
# but machinery still goes, because after masking there is nothing left to match.
#
# ONE level of nested braces, which covers `style={{ marginTop: '1rem' }}`.
# Adopting it moved the figure 16 -> 22 with no false positive among the six, every
# one read by hand: a yes/no cell on /audit-trail, three `Reason:`/`Status:` label
# prefixes, and the owner's own «نصه عربي و نصه انج» on /retention-disposal — a
# mode-9 ternary sitting inside a `<td style={cell}>`.
ATTR_BRACE = re.compile(r'\b[A-Za-z-]+=\{(?:[^{}]|\{[^{}]*\})*\}')
ATTR_QUOTED = re.compile(r'\b[A-Za-z-]+=("(?:[^"]*)"|\'(?:[^\']*)\')')


def mask_attributes(line):
    """Replace `name={…}` and `name="…"` with a placeholder, keeping positions sane."""
    return ATTR_QUOTED.sub('ATTR', ATTR_BRACE.sub('ATTR', line))
# Two or more words starting with a capital, after ANY boundary that can precede JSX text — including a
# BACKTICK, which failure mode 3 missed.
PROSE = re.compile(r'(?:^|[>`]|\}\s|\{\'|\{"|\{`)\s*([A-Z][a-z]+(?:\s+[A-Za-z()—-]+){1,})')
# FAILURE MODE 9 — a ternary where ONE branch is translated and the other is a bare
# English literal: `busy ? t('commonWorking') : 'Start cycle'`. The most diagnostic
# shape there is, because the key EXISTS and the mechanism is known and one state was
# simply missed.
#
# None of the eight can see it. Mode 8 needs a ternary of BARE literals and here one
# branch is a call; mode 2 strips the `t(...)` and then needs two capitalised words,
# which `'Withdraw'` and `'manual'` are not.
ASYMMETRIC_TERNARY = [
    re.compile(r"[?]\s*t(?:r|Plural)?\([^)]*\)\s*:\s*(['\"])([^'\"]{2,})\1"),
    re.compile(r"[?]\s*(['\"])([^'\"]{2,})\1\s*:\s*t(?:r|Plural)?\("),
]

# Words that look like prose but are code or a proper noun the product does not translate.
# `IBMS` joined this list when the component root opened: the brand in `AppNavbar` is
# not copy and is translated nowhere.
ALLOW = re.compile(r'^(?:JOD|OK|PDF|CSV|IBMS|Claude|Next|React|TypeScript|Prisma)\b')
# Failure mode 1 was LOWERCASE prose — ` (as of ${...})` — which no capital-initial rule can see. So
# template-literal strings get their own pattern: two or more space-separated lowercase words INSIDE
# backticks. Narrow on purpose. A route template (`/customers/${id}`) has no spaces and cannot match; a
# sentence does. Anything wider started reporting style strings, which is the cry-wolf direction.
TEMPLATE_PROSE = re.compile(r'`[^`]*?\b([a-z]{2,}(?:\s+[a-z]{2,}){1,})\b[^`]*?`')
# FAILURE MODE 5, found while reading two aria-labels rather than by running anything: a ONE-WORD LABEL
# followed by a colon. `<strong>Status: {t(…)}</strong>` survives every pattern above — the `t()` strip
# leaves `<strong>Status: </strong>`, and PROSE needs two words. Thirteen of these existed on eight
# screens while this script reported 0/102, including a THIRD miss on `/dashboards/financial`.
#
# Narrow deliberately: a capitalised word of 3+ letters immediately before a colon. `Status:`, `Current:`,
# `Withdrawn:` are labels; `http:` and `Record<` are not, and the exclusions below carry the rest.
ONE_WORD_LABEL = re.compile(r'(?:^|[>`]|\}\s)\s*([A-Z][a-z]{2,})\s*:')
# FAILURE MODE 6, found in batch 5 by READING a screen for something else: a BARE JSX TEXT LINE holding one
# English word and no colon. `/insurance-programs/new` rendered a back button whose label was the literal
# text `← Back`, and every pattern above missed it — PROSE needs two capitalised words, TEMPLATE_PROSE needs
# backticks, ONE_WORD_LABEL needs a colon. The seventh way this script can report a clean screen that is not.
#
# Narrow deliberately: a line that is PURE TEXT — no tag, no brace, no attribute, no quote — holding one or
# two words of which the first is 3+ letters. Any line carrying JSX or an expression is already covered by
# the patterns above and is excluded here, which is what keeps this from firing on ordinary markup.
BARE_TEXT_LINE = re.compile(r'^[^<>{}=\'"`]*?([A-Za-z]{3,}(?:\s+[A-Za-z]+)?)\s*$')
# FAILURE MODE 7 — A PARENTHETICAL. Found by the OWNER reading `/internal-controls` while this script
# reported 0 for it, and the diagnosis is a shape rather than an accident:
#
#   `(dormant)`                        a bare JSX text line WRAPPED IN PARENTHESES
#   `{p.truncated ? ' (truncated)' : ''}`   a QUOTED lowercase fragment in a JSX expression
#
# Why all five patterns above miss both, traced one at a time rather than guessed:
#   - PROSE needs `[A-Z][a-z]+` and two words. Both are one lowercase word.
#   - TEMPLATE_PROSE needs BACKTICKS and two words. One is single-quoted, both are one word.
#   - ONE_WORD_LABEL needs a colon. Neither has one.
#   - BARE_TEXT_LINE ends `\s*$`, so the CLOSING PAREN defeats it — the leading `(` is inside its
#     character class and fine, the trailing `)` is not whitespace. That one character is the whole miss.
#   - And `' (truncated)'` carries `{`, `}` and `'`, every one excluded by BARE_TEXT_LINE's class.
#
# Both words were LOAD-BEARING, which is why this is the eighth and worst miss: `(truncated)` is the only
# thing telling a reader the self-approval scan hit its limit and the result is INCOMPLETE, so an Arabic
# reader saw a row of zeroes under a partial scan and had no way to know it was not clean.
#
# NARROW DELIBERATELY, BOTH OF THEM, because the cry-wolf direction is the one this script's own header
# calls harder to recover from than under-counting. A parenthetical is matched only when the paired
# parentheses are the WHOLE of the thing:
#   - a text line that is NOTHING BUT a parenthetical. `(dormant)` matches; `doThing(arg)` does not,
#     because the line must START with `(`. Widening BARE_TEXT_LINE's own anchor to tolerate a trailing
#     `)` was tried first and REJECTED: it makes every bare call line a finding.
#   - a quoted string that is NOTHING BUT a parenthetical. `' (truncated)'` matches; `'/customers/(x)'`
#     does not, and no import, key, style value or data attribute in this tree has this shape.
PARENTHETICAL_TEXT_LINE = re.compile(r'^\(\s*([A-Za-z][A-Za-z ,.\'\-\u2014]{1,60}?)\s*\)$')
QUOTED_PARENTHETICAL = re.compile(
    r'[\'"`]\s*\(\s*([A-Za-z][A-Za-z ,.\'\-\u2014]{1,60}?)\s*\)\s*[\'"`]'
)

# Bare words that are code, not copy. A statement on its own line reaches this pattern too.
NOT_BARE_COPY = {
    'return', 'else', 'true', 'false', 'null', 'undefined', 'const', 'let', 'var', 'async', 'await',
    'export', 'default', 'function', 'from', 'import', 'as', 'is', 'and', 'or', 'not', 'in', 'of',
    'if', 'for', 'while', 'case', 'break', 'continue', 'catch', 'try', 'finally', 'throw', 'new',
    'typeof', 'void', 'yield', 'satisfies', 'interface', 'type', 'enum', 'class', 'extends',
}

# Type names and switch syntax that a colon-based pattern would otherwise read as labels.
NOT_A_LABEL = {
    'Record', 'Object', 'Promise', 'String', 'Number', 'Boolean', 'Partial',
    'Array', 'Date', 'Math', 'JSON', 'Omit', 'Pick', 'Exclude', 'Readonly',
}


# ----------------------------------------------------------------------------------------------
# THE TEN PARENTHETICALS FAILURE MODE 7 FOUND, DECLARED — each owed an Arabic word by the owner.
#
# This is NOT a raised budget. The ban on hardcoded English is still flat at zero for everything
# else, and these ten are named individually with what each MEANS, because the meaning is what
# makes them worth her time rather than a translation chore. Every one is a status marker that
# changes how a figure or a row should be read:
#
#   - `(capped)` ×3 is the same class as the `(truncated)` that started this: THE NUMBER SHOWN IS
#     NOT THE REAL NUMBER. An Arabic reader reads the capped figure as the true one.
#   - `(overdue)` ×3 and `(containment overdue)` are PASSED STATUTORY DEADLINES — a PDPL data
#     subject request, a breach containment clock, a regulatory obligation, a BCP test.
#   - `(lapsed)` is professional-indemnity cover that has ENDED.
#   - `(drafted)` is this repository's own sourced-versus-drafted distinction on an SLA duration:
#     a drafted figure carries no regulatory source and must not be read as one.
#
# A ROW IS REMOVED WHEN ITS STRING IS TRANSLATED, NEVER EDITED TO MATCH A NEW ONE. The gate fails
# on a stale row for the same reason it fails on an undeclared finding: a declaration that no
# longer occurs is a declaration covering whatever lands next.
#
# Keyed on `screen|string` exactly, so this cannot become a hiding place for a DIFFERENT kind of
# finding on the same screen — a `PROSE` or `ONE_WORD_LABEL` hit still fails flat.
# FAILURE MODE 8 — A TERNARY OF BARE STRING LITERALS IN A JSX TEXT POSITION. Found by the OWNER
# while measuring the meaning of the nine declared parentheticals, with this script reporting
# CLEAN for both screens. The third distinct shape it has missed, and the third found by a
# person reading a screen rather than by the instrument:
#
#   {p.isCurrent ? 'current' : 'past'}            /operational-pi-risk
#   {it.isSubmitted ? 'submitted' : 'pending'}    /regulatory-compliance
#
# Why all seven patterns above miss it: PROSE and ONE_WORD_LABEL need a capital; TEMPLATE_PROSE
# needs backticks and two words; BARE_TEXT_LINE's class excludes braces and quotes; and the
# two parenthetical patterns need parentheses. A lowercase single word inside single quotes
# inside a brace expression matches nothing.
#
# THE FALSE-POSITIVE BOUNDARY IS THE HARD PART HERE, AND IT IS A POSITION RATHER THAN A WORD.
# The same shape appears constantly as an ATTRIBUTE value, where nobody reads it — the owner's
# own search turned up two, and both are CORRECT code:
#
#   value={activeOnly === undefined ? 'all' : ...}   insurers/page.tsx — an HTML select value
#   data-hr-link={u.employeeId ? 'linked' : 'none'}  settings/users/page.tsx — a test hook
#
# Flagging those would be noise, and noise is what gets a gate LOOSENED later — which is how a
# detector dies. So the discriminator is POSITION: a JSX child expression is a line that is
# ENTIRELY a brace expression, while an attribute is always preceded by `name=` or sits inside
# a tag. Both exclusions are in the self-test with that reason, as the rejected trailing-paren
# widening already is.
# CORRECTED FROM ITS OWN FIRST RUN. The first version matched a PAIR of literals and so lost a
# branch of a CHAINED ternary: `{a ? 'Approved' : b ? 'Declined' : 'Pending'}` reported two of
# its three, because a paired match finds the LAST pair and `Approved` sits before it. That is
# an under-count, which is the direction that looks like a clean result — so the shape is now
# detected in two steps: the LINE is recognised as a ternary child expression, and then EVERY
# bare literal in it is reported.
#
# The literal pattern requires the WHOLE quoted content to be letters and spaces, which is what
# keeps format strings out: `'yyyy-MM-dd'` carries hyphens and cannot match, and `','` and
# `' '` are under the three-letter floor.
TERNARY_TEXT = re.compile(r"^\{[^{}]*\?[^{}]*:[^{}]*\}$")
# FAILURE MODE 12 — the same shape as 8, INLINE in a tag on one line:
# `<td style={cell}>{r.isMarketing ? 'Yes' : 'No'}</td>`.
#
# Mode 8 requires the line to be ENTIRELY a brace expression, which was an
# APPROXIMATION of 'this is a text position' — a good one for a multi-line JSX
# child and blind to a one-line cell. A brace expression sitting BETWEEN `>` and
# `<` is unambiguously text, which is the same discriminator stated exactly
# rather than approximately, and it admits no attribute.
#
# ITS FLOOR IS TWO CHARACTERS, not three. Mode 8's three-character floor keeps
# format strings out — and `'No'` is two, so the pair never reached the
# two-literal threshold and `'Yes'` alone was below it. Four pairs were invisible
# for that reason: /consent, /employees and /transaction-monitoring twice, every
# one a yes/no column. Two characters is safe HERE because the position is exact
# rather than approximated, so there is no attribute value to mistake.
#
# Found by READING a line the raw-value report pointed at, not by this script:
# `{r.purpose}` was the finding and `{r.isMarketing ? 'Yes' : 'No'}` was on the
# next line down.
TERNARY_INLINE = re.compile(r">\s*(\{[^{}]*\?[^{}]*:[^{}]*\})\s*<")
TERNARY_LITERAL_2 = re.compile(r"'([A-Za-z]{2,}[A-Za-z ]{0,40})'")
TERNARY_LITERAL = re.compile(r"'([A-Za-z]{3,}[A-Za-z ]{0,40})'")

DECLARED_PARENTHETICALS = {
    # ------------------------------------------------------------------------------------------
    # THE COMPONENT ROOT'S FINDINGS, DECLARED 2026-10-26 — the owner's walk, module 0-c.
    #
    # These eleven came out of closing this script's largest blind spot: it had never read
    # `components/` at all, so 63 files were unscanned and it reported 0 for every screen she
    # named. Eighteen strings surfaced; SEVEN were derived by slicing a string already
    # shipping and are gone from this list. These eleven have NO source anywhere in 4,235
    # English dictionary entries — measured, not judged — so each is a word she has to decide.
    #
    # EACH ROW CARRIES WHAT IT MEANS ON ITS SCREEN, not the English word, which is how
    # decisions 54 and 55 were put to her. They are also a RELATED SET rather than eleven
    # errands: nine of the eleven are the vocabulary of what happens to a policy after it is
    # issued — checked, delivered, acknowledged, adjusted, reversed, reconciled against an
    # insurer's statement — and that is one sitting rather than nine.
    #
    #   1. `Start cycle` — StartCyclePanel. OPENS an access-recertification cycle: every
    #      active person's roles are assigned to a reviewer and the queue below fills. Not
    #      derivable: «البدء» exists in `secStartingButton` and «الدورة» in
    #      `acrAdminCycleLabel`, but joining two nouns in construct state is composition
    #      rather than a slice, and decision 94 reserves that to her.
    #   2. `your review queue below now reflects it` — the same panel's success line, naming
    #      WHERE the result of the act appeared. The one thing it must not become is a bare
    #      «تم»: the queue filling IS the outcome.
    #   3. `Mark reviewed` — NeedsAssessmentReviewPanel. One half of a maker/checker pair: it
    #      records that a SECOND person read the needs assessment, which is what lets the
    #      file be approved afterwards. «المراجعة» exists as a NOUN (`smReview`); the ACT is
    #      what has no word.
    #   4. `Previously withdrawn` — ConsentCaptureWidget, beside a DATE. The data subject
    #      withdrew consent on that day and has made no decision since, which under PDPL is
    #      a different state from never having consented (`consNoDecisionYet` is translated).
    #   5. `(pending approval)` and
    #   6. `(approved)` — CommissionSection, beside a MANUAL COMMISSION OVERRIDE. The figure
    #      shown is somebody's hand-entered correction to what the broker is owed, and the
    #      marker says whether a second person has approved it yet. An Arabic reader saw a
    #      money figure with its approval state in English.
    #   7. `Insurer statement amount (must equal` — the same screen, a FORM LABEL carrying a
    #      CONSTRAINT: the amount typed must equal the ledger entry, and the figure follows
    #      in the label itself. A label stating a rule the save will enforce.
    #   8. `Premium adjustment` — EndorsementSection, beside a money figure: what the
    #      endorsement changed the premium BY. «التعديل» exists inside
    #      `endorsementCalculateButton` («حساب التعديل») but not as this label.
    #   9. `commission reversal` — the same line: the clawback owed because the premium fell.
    #      Process 22's own money consequence, rendered in English.
    #  10. `Checked by` — PolicySection, naming WHO performed the second-pair-of-eyes policy
    #      check and when. The sentence that makes a maker/checker control readable.
    #  11. `receipt acknowledged` — the same screen: the client CONFIRMED receiving the
    #      policy document, on that date. Its opposite, `policyAwaitingAcknowledgement`, is
    #      already translated — so one half of that pair reads in Arabic and the other does
    #      not, on one line.
    #
    # DELETING a row is how a translation gets recorded, and the gate fails on a STALE row
    # too. Adding a TWELFTH is not the ordinary fix: derive it, or it is hers.
    'apps/web/components/access-recertification/StartCyclePanel.tsx|Start cycle',
    'apps/web/components/access-recertification/StartCyclePanel.tsx|your review queue below now reflects it',
    'apps/web/components/needs-assessment/NeedsAssessmentReviewPanel.tsx|Mark reviewed',
    'apps/web/components/pdpl/ConsentCaptureWidget.tsx|Previously withdrawn',
    'apps/web/components/policy/CommissionSection.tsx|(pending approval)',
    'apps/web/components/policy/CommissionSection.tsx|(approved)',
    'apps/web/components/policy/CommissionSection.tsx|Insurer statement amount (must equal',
    'apps/web/components/policy/EndorsementSection.tsx|Premium adjustment',
    'apps/web/components/policy/EndorsementSection.tsx|commission reversal',
    'apps/web/components/policy/PolicySection.tsx|Checked by',
    'apps/web/components/policy/PolicySection.tsx|receipt acknowledged',
    # ------------------------------------------------------------------------------------------
    # THE TWELFTH WAS DECLARED HERE AND IS NOW DERIVED — the row is gone, and the
    # correction is recorded because it ran the wrong way for one commit.
    #
    # `/retention-disposal`'s `'Active'` is a LEGAL HOLD's state. It was declared
    # for the owner on the ground that «سارية» carries a standing instruction not
    # to reach for it. That instruction is real and it is NARROWER than I read it:
    # it is about a PI RECORD being current while its COVER has lapsed. This
    # product already uses «سارية» for a non-cover thing being in force —
    # `slaPolStatusActive`, for an SLA policy — and a legal hold in force is the
    # same concept, so it is `rdHoldInForce` now, copied from there and sitting
    # beside its own opposite `rdReleased`.
    #
    # Declaring a word that was derivable is a smaller mistake than writing one
    # that was not, and a larger one than it looks: it puts an errand on her list
    # that was never hers. Measured both ways, which is what found it.
    # ------------------------------------------------------------------------------------------
    # FAILURE MODE 8's FINDINGS, DECLARED 2026-10-24. NEW DECLARATIONS WITH THEIR OWN REASON —
    # NOT survivors of the nine parentheticals, which were emptied from this very set in the same
    # commit once owner decision 55 translated them. That distinction is the owner's instruction
    # and it matters: a row that outlives its reason is how a gate stops meaning anything.
    #
    # The owner has just written ELEVEN of these words in one sitting and the list is closed for
    # now, which is why these five are declared rather than written. Both screens are LOAD-BEARING
    # rendered text, read one at a time rather than assumed:
    #
    #   `/data-sharing-approvals` — the STATUS cell of a PDPL data-sharing register. The comment
    #   beside it on that screen already says why `Approved` is the load-bearing one: *"Approved"
    #   is the claim being made and it is only true of a TWO-person decision*. An Arabic reader
    #   saw the whole three-state status in English on the register that records whether sending
    #   personal data to a third party was approved at all.
    #
    #   `/sales-performance` — a BUTTON LABEL, which is the one kind of string a reader has to
    #   understand before acting rather than after. `Revise` and `Set target` are different acts
    #   on the same control, and which one it is depends on whether a target already exists.
    #
    # `Approved` IS HERE BECAUSE THE DETECTOR WAS CORRECTED, not because the screen changed:
    # failure mode 8's first version matched a PAIR of literals and lost the earliest branch of a
    # chained ternary, reporting two of the three. That is an under-count, which is the direction
    # that looks like a clean result.
    'data-sharing-approvals|Approved',
    'data-sharing-approvals|Declined',
    'data-sharing-approvals|Pending',
    'sales-performance|Revise',
    'sales-performance|Set target',
}
# ^ THE NINE PARENTHETICALS ARE GONE FROM HERE, AND THESE FIVE ARE NOT THEM.
#
# The set held NINE rows for exactly one batch. All eleven markers behind them were
# translated on 2026-10-24 (owner decision 55) and those rows were emptied IN THE SAME
# COMMIT. The five above arrived in the same commit from a DIFFERENT shape — failure mode 8,
# a ternary of bare literals — and carry their own dated reason.
#
# It held NINE rows for exactly one batch. All eleven markers behind them were translated on
# 2026-10-24 (owner decision 55) and the set was emptied IN THE SAME COMMIT, because a declared
# list that outlives its reason is how a gate stops meaning anything — the next hardcoded
# string would have landed on a screen that was already declared and said nothing.
#
# THE STALENESS DIRECTION IS WHAT FORCED IT, which is the argument for a declared SET over a
# count: re-measuring after the translations FAILED with six STALE rows named one by one. A
# budget of nine would have read 'three remain' and looked like progress.
#
# RE-POPULATING THIS NEEDS A DATED REASON PER ROW, and a new row is a NEW declaration rather
# than a survivor of these — the owner has just written eleven of these words in one sitting
# and the list is closed for now. Each row must say what the marker MEANS, because that is
# what makes it worth her time: of the nine, three meant *the figure you are reading is not
# the real figure* and four meant *a statutory deadline has passed*.

def mask_comments(src):
    """
    Blank out every JSX and block comment, KEEPING the line count so reported numbers stay right.

    A line-state toggle is not enough, and that is measured rather than assumed: the DSR screen has a
    multi-line `{/* … */}` whose tail was reported as UI copy, because the toggle can be set and cleared
    by one line and then leaves the rest of the block exposed. Masking the whole source with a regex has
    no state to get wrong.
    """
    def blank(m):
        return re.sub(r'[^\n]', ' ', m.group(0))

    src = re.sub(r'\{\s*/\*.*?\*/\s*\}', blank, src, flags=re.S)
    src = re.sub(r'/\*.*?\*/', blank, src, flags=re.S)
    return src


def findings(src):
    """[(line_no, text)] for user-facing English in this source. Comments are masked first."""
    out = []
    lines = mask_comments(src).split('\n')
    for i, line_src in enumerate(lines, 1):
        # The attributes go first; what is LEFT is what a reader sees.
        raw = mask_attributes(line_src)
        s = raw.strip()
        if s.startswith(CODE_PREFIX):
            continue
        if MACHINE.search(s):
            continue
        # Strip translated calls, then look at what is LEFT. This is failure mode 2's fix: a line that
        # is half translated has its untranslated half examined rather than being skipped whole.
        stripped = T_CALL.sub('', raw)
        for m in PROSE.finditer(stripped):
            text = m.group(1).strip()
            if len(text) > 6 and not ALLOW.match(text):
                out.append((i, text[:60]))
        for m in TEMPLATE_PROSE.finditer(stripped):
            text = m.group(1).strip()
            if len(text) > 4 and (i, text) not in out:
                out.append((i, text[:60]))
        if not re.search(r'(case |switch|\bextends\b|\bimplements\b)', s):
            for m in ONE_WORD_LABEL.finditer(stripped):
                text = m.group(1)
                if text not in NOT_A_LABEL and (i, text) not in out:
                    out.append((i, text + ':'))
        # FAILURE MODE 9 — one branch of a ternary translated, the other a bare literal.
        # Read off `raw` rather than `stripped`, because `stripped` has had the `t(...)`
        # call REMOVED and the asymmetry is the whole signal.
        for pat in ASYMMETRIC_TERNARY:
            for m in pat.finditer(raw):
                text = m.group(2).strip()
                if (not ALLOW.match(text)
                        and text.split()[0].lower() not in NOT_BARE_COPY
                        and (i, text) not in out):
                    out.append((i, text))
        # FAILURE MODE 8 — a ternary of bare literals, matched only when the line is ENTIRELY
        # a brace expression, which is what separates a rendered child from an attribute
        # value. Both branches are reported, because both render.
        line = stripped.strip()
        if TERNARY_TEXT.match(line) and len(TERNARY_LITERAL.findall(line)) >= 2:
            # EVERY literal, not a matched pair — a chained ternary has three or more, and
            # the first version silently dropped the earliest one.
            for text in TERNARY_LITERAL.findall(line):
                # NOT a comparison operand. `{busy === 'review' ? t(...) : 'Mark
                # reviewed'}` is wholly a brace expression and holds two literals, and
                # only the second renders — `'review'` is a state value being compared.
                # Reported alongside a TRUE finding on the same line, which is how a
                # false positive survives: the line is on the list either way.
                if re.search(
                        r'(?:===|!==|==|!=)\s*' + re.escape("'" + text + "'"), line):
                    continue
                text = text.strip()
                if (text.split()[0].lower() not in NOT_BARE_COPY
                        and not ALLOW.match(text)
                        and (i, text) not in out):
                    out.append((i, text))
        # FAILURE MODE 12 — the same shape as 8, inline between `>` and `<`.
        for mo in TERNARY_INLINE.finditer(raw):
            expr = mo.group(1)
            if T_CALL.search(expr) or 'ENUM_LABEL' in expr:
                continue
            for text in TERNARY_LITERAL_2.findall(expr):
                if re.search(r'(?:===|!==|==|!=)\s*' + re.escape("'" + text + "'"), expr):
                    continue
                text = text.strip()
                if (text.split()[0].lower() not in NOT_BARE_COPY
                        and not ALLOW.match(text)
                        and (i, text) not in out):
                    out.append((i, text))
        # FAILURE MODE 7 — a parenthetical, in either of its two forms. Neither needs the
        # previous-line context failure mode 6 requires, because the paired parentheses are
        # themselves the evidence that this is a remark to a reader rather than code.
        for m in QUOTED_PARENTHETICAL.finditer(stripped):
            text = m.group(1).strip()
            if (text.split()[0].lower() not in NOT_BARE_COPY
                    and not ALLOW.match(text)
                    and (i, text) not in out):
                out.append((i, '(%s)' % text[:58]))
        paren_line = PARENTHETICAL_TEXT_LINE.match(stripped.strip())
        if paren_line:
            text = paren_line.group(1).strip()
            if (text.split()[0].lower() not in NOT_BARE_COPY
                    and not ALLOW.match(text)
                    and (i, text) not in out
                    and (i, '(%s)' % text[:58]) not in out):
                out.append((i, '(%s)' % text[:58]))
        # Failure mode 6 — a bare JSX text line, and it needs the PREVIOUS LINE to prove it is one.
        #
        # Without that, this fired 277 times on 97 screens and almost every hit was a multi-line CODE
        # expression whose continuation happens to be bare words: `err instanceof ApiError`, `message`,
        # `outcomes`. That is the cry-wolf direction, which this script's own header calls as useless as
        # under-counting and harder to recover from.
        #
        # JSX text children come immediately after a tag CLOSES. So the previous non-blank line must end in
        # `>` — and not `=>`, because an arrow function ends that way too and `onClick={() =>` is followed
        # by exactly the sort of code continuation this has to exclude.
        prev = next((p.strip() for p in reversed(lines[:i - 1]) if p.strip()), '')
        if prev.endswith('>') and not prev.endswith('=>'):
            bare = BARE_TEXT_LINE.match(stripped.strip())
            if bare:
                text = bare.group(1).strip()
                if (text.split()[0].lower() not in NOT_BARE_COPY
                        and not ALLOW.match(text)
                        and (i, text) not in out):
                    out.append((i, text))
    return out


def self_test():
    """The three real misses, as cases. Each must be FOUND; each clean line must not be."""
    cases = [
        (
            'failure mode 1 — a date inside a template literal',
            "                    ? ` (as of ${summary.scan.asOf.slice(0, 10)})`\n",
            True,
        ),
        (
            'failure mode 2 — prose on a line that ALSO calls t()',
            "        Needs assessment {assessment.id.slice(0, 8)} — status {t(ENUM_LABEL.X[y])}.\n",
            True,
        ),
        (
            'failure mode 3 — prose after a BACKTICK',
            "                {profile.siteLabel ?? `Risk profile ${profile.id.slice(0, 8)}`}\n",
            True,
        ),
        (
            'failure mode 9 — one branch translated, the other a bare literal',
            '            {isSubmitting ? t("secStartingButton") : "Start cycle"}\n',
            True,
        ),
        (
            'failure mode 9 — the same asymmetry the other way round',
            "              {h.releasable ? 'Active' : t('rdHoldReleased')}\n",
            True,
        ),
        (
            'a ternary translated on BOTH branches is clean — the whole point of mode 9',
            "            {busy ? t('commonWorking') : t('impSubmit')}\n",
            False,
        ),
        (
            'the brand is not copy',
            "          <span>{'IBMS'}</span>\n",
            False,
        ),
        (
            'a fully translated line is clean',
            "          <h1>{t('iprogHeading')}</h1>\n",
            False,
        ),
        (
            'a test id is not user-facing copy',
            '          <div data-testid="Some Thing Here">{v}</div>\n',
            False,
        ),
        (
            'a JSX comment is not user-facing copy',
            '      {/* Status: this explains something in English on purpose */}\n',
            False,
        ),
        (
            'an untranslated currency label IS a finding',
            '        <span>Current asset value (JOD): {rec.currentAssetValue}</span>\n',
            True,
        ),
        (
            'failure mode 5 — a ONE-WORD label beside a translated value',
            "          <strong>Status: {t(ENUM_LABEL.X[y.status])}</strong>\n",
            True,
        ),
        (
            'a TypeScript type before a colon is not a label',
            '  const byId: Record<string, Thing> = {};\n',
            False,
        ),
        (
            'a switch case is not a label',
            "      case 'Active':\n",
            False,
        ),
        (
            # TWO lines, because the rule is contextual: a bare word is JSX text only when the line before
            # it closes a tag. A one-line case could never pass, and writing it that way would have been a
            # test asserting the wrong thing about a rule that is deliberately context-dependent.
            'failure mode 6 — a BARE JSX TEXT LINE after a tag close',
            '      >\n        ← Back\n',
            True,
        ),
        (
            'the same bare word after an ARROW function is code, not copy',
            '      onClick={() =>\n        doTheThing\n',
            False,
        ),
        (
            'a bare statement on its own line is not copy',
            '      ) {\n        return\n',
            False,
        ),
        (
            # FAILURE MODE 7, both forms. These two lines are the real misses, byte for byte as they
            # stood on /internal-controls while this script reported 0 for that screen.
            'failure mode 7a — a parenthetical BARE TEXT LINE',
            '      >\n        (dormant)\n',
            True,
        ),
        (
            'failure mode 7b — a QUOTED lowercase parenthetical in a JSX expression',
            "                        {p.truncated ? ' (truncated)' : ''}\n",
            True,
        ),
        (
            # The cry-wolf direction, which matters more than the catch: a bare CALL must not read as
            # a parenthetical. Widening BARE_TEXT_LINE to tolerate a trailing `)` would have made
            # every one of these a finding.
            'a bare function call is not a parenthetical',
            '      >\n        doTheThing(arg)\n',
            False,
        ),
        (
            'a route literal with parentheses is not a parenthetical',
            "  const p = '/customers/(x)';\n",
            False,
        ),
        (
            'a parenthetical that is ALREADY translated is clean',
            "                        {p.truncated ? ` ${t('icTruncatedNote')}` : ''}\n",
            False,
        ),
        (
            # FAILURE MODE 8. These two lines are the real misses, byte for byte, while this
            # script reported clean for both screens.
            'failure mode 8a — a ternary of bare literals as JSX text',
            "                  {p.isCurrent ? 'current' : 'past'}\n",
            True,
        ),
        (
            'failure mode 8b — the same shape, lowercase, on another screen',
            "          {it.isSubmitted ? 'submitted' : 'pending'}\n",
            True,
        ),
        (
            # CORRECTED FROM THE RUN: the first version of failure mode 8 reported only
            # TWO of these three, losing `Approved` to a paired match. On a PDPL
            # data-sharing register, `Approved` is the load-bearing one — the comment
            # beside it on that screen says so in as many words.
            'failure mode 8c — a CHAINED ternary loses no branch',
            "      {r.isApproved ? 'Approved' : r.isDeclined ? 'Declined' : 'Pending'}\n",
            True,
        ),
        (
            # A format string in a ternary branch is not copy, and the three-letter,
            # letters-and-spaces-only literal pattern is what keeps it out: `yyyy-MM-dd`
            # carries hyphens and cannot match.
            'a date format string in a ternary is not copy',
            "      {d ? fmt(d, 'yyyy-MM-dd') : fmt(e, 'yyyy-MM-dd')}\n",
            False,
        ),
        (
            # THE FALSE-POSITIVE BOUNDARY, and it matters more than the catch: an HTML select
            # VALUE is not copy. Nobody reads it, and translating it would break the control.
            # Flagging it is the noise that gets a gate loosened.
            'an HTML select value is not rendered copy',
            "            value={activeOnly === undefined ? 'all' : 'active'}\n",
            False,
        ),
        (
            # The same, for a TEST HOOK. `data-*` attributes are read by Playwright, not by a
            # person, and this repository deliberately keys assertions on them.
            'a data-* test hook is not rendered copy',
            "          <td data-hr-link={u.employeeId ? 'linked' : 'none'}>\n",
            False,
        ),
        (
            'a style= attribute no longer discards the text beside it',
            "        <div style={cardMetaStyle}>Reason: {opportunity.dismissReason}</div>\n",
            True,
        ),
        (
            'nor does a nested style object',
            "        <div style={{ marginTop: '1rem' }}>Checked by {x}</div>\n",
            True,
        ),
        (
            'a line that is NOTHING but machinery still goes',
            '        <div className="row" data-testid="Some Thing" />\n',
            False,
        ),
        (
            'failure mode 12 — a yes/no ternary INLINE in a table cell',
            "        <td style={cell}>{r.isMarketing ? 'Yes' : 'No'}</td>\n",
            True,
        ),
        (
            'failure mode 12 — lower case, which the 3-character floor also missed',
            "        <td style={cell}>{r.reportedToAuthorityAt ? 'yes' : 'no'}</td>\n",
            True,
        ),
        (
            'the same cell translated is clean',
            "        <td style={cell}>{r.isMarketing ? t('commonYes') : t('commonNo')}</td>\n",
            False,
        ),
        (
            'an ATTRIBUTE holding the same ternary is not rendered copy',
            "        <div data-marketing={r.isMarketing ? 'Yes' : 'No'} />\n",
            False,
        ),
        (
            'a literal used as a COMPARISON OPERAND is not a rendered branch',
            "            {busy === 'review' ? t('nadRecording') : 'Mark reviewed'}\n",
            # Still TRUE overall — `Mark reviewed` is a real finding on this line. The
            # assertion that `review` is gone is in the dedicated case below, because a
            # boolean self-test cannot express "found one of two".
            True,
        ),
        (
            'and the comparison operand alone is clean',
            "            {busy === 'review' ? t('nadRecording') : t('nadDone')}\n",
            False,
        ),
        (
            'a ternary of TRANSLATED calls is clean',
            "          {p.isCurrent ? t('statusRecordCurrent') : t('statusRecordPast')}\n",
            False,
        ),
    ]
    failures = 0
    for name, src, expected in cases:
        found = len(findings(src)) > 0
        ok = found == expected
        print('  %s%s' % ('ok   ' if ok else '*** FAIL *** ', name))
        if not ok:
            failures += 1
            print('      expected %s, got %s  %r' % (expected, found, findings(src)))
    if failures:
        print('\nSELF-TEST FAILED — %d case(s). The detector would under-count.' % failures)
        return 1
    print('\nSELF-TEST PASSED — all three real misses are caught.')
    return 0


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if '--self-test' in sys.argv:
        return self_test()

    # TWO ROOTS. A screen is `app/(app)/<rel>/page.tsx`; a component is any `.tsx`
    # under `components/`, named by its path so a finding is addressable either way.
    screens = []
    for root, _, files in os.walk(APP):
        if 'page.tsx' in files:
            rel = os.path.relpath(root, APP).replace(os.sep, '/')
            if not args or any(a in rel for a in args):
                screens.append((rel, os.path.join(APP, rel, 'page.tsx')))
    for root, _, files in os.walk(COMPONENTS):
        for name in sorted(files):
            if not name.endswith('.tsx'):
                continue
            path = os.path.join(root, name)
            rel = path.replace(os.sep, '/')
            if not args or any(a in rel for a in args):
                screens.append((rel, path))
    screens.sort()
    # NON-VACUITY FLOOR. A walk that finds nothing reports a clean nothing, which is
    # indistinguishable from a clean tree — and this script spent eleven batches
    # reporting 0 for screens that had English on them. 106 pages and 63 components
    # today; the floor is a minimum so adding either does not trip it.
    if not args and len(screens) < 150:
        print('REFUSING: found only %d files to scan; this tree has ~170. '
              'A run that scans nothing reads exactly like a clean result.' % len(screens),
              file=sys.stderr)
        return 2

    total = 0
    dirty = 0
    seen = set()
    for rel, path in screens:
        src = io.open(path, encoding='utf-8').read()
        hits = findings(src)
        if not hits:
            continue
        dirty += 1
        total += len(hits)
        print('%-40s %d' % (rel, len(hits)))
        for line, text in hits:
            print('      L%-5s %r' % (line, text))
            # Keyed on screen + STRING, never on the line number, so moving a marker up or
            # down a file is not a stale declaration.
            seen.add('%s|%s' % (rel, text))

    print('\nfiles scanned (pages + components)  %4d' % len(screens))
    print('files with hardcoded English        %4d' % dirty)
    print('strings                             %4d' % total)

    # THE DECLARATION, IN BOTH DIRECTIONS. `strings` stays the TOTAL and stays printed, so
    # the real figure is never hidden behind a declaration; what the gate reads is
    # `undeclared`.
    undeclared = sorted(seen - DECLARED_PARENTHETICALS)
    stale = sorted(DECLARED_PARENTHETICALS - seen)
    print('declared parentheticals (owner)     %4d' % len(DECLARED_PARENTHETICALS))
    print('undeclared                          %4d' % len(undeclared))
    for key in undeclared:
        print('      UNDECLARED  %s' % key)
    for key in stale:
        print('      STALE       %s' % key)
    if stale:
        print('\nhardcoded-ui-english: FAILED on a STALE declaration. The row(s) above no '
              'longer occur, so remove them from DECLARED_PARENTHETICALS in the same commit '
              'that translated the string. A declaration left behind covers whatever lands '
              'next, which is the whole reason this is a declared SET rather than a count.')
        return 1
    if undeclared:
        print('\nhardcoded-ui-english: FAILED. This platform is Arabic-first, so an '
              'untranslated string is read by nobody in the primary language. Add the key to '
              'a dictionary in lib/i18n/translations/ and render it through t(). DECLARING a '
              'row is NOT the ordinary fix: every declared row is one of the owner\'s own '
              'backlog, each carrying a meaning she has to decide, and a new one needs the '
              'same.')
        return 1
    return 0


sys.exit(main())
