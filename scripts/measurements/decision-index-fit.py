#!/usr/bin/env python
"""
THE DECISION REGISTER: A NUMBER CITED IN CODE, A FILE THAT SAYS WHAT IT MEANS, AND A ROW
THAT POINTS AT THE FILE -- GATED IN BOTH DIRECTIONS.

    python scripts/measurements/decision-index-fit.py             # report
    python scripts/measurements/decision-index-fit.py --check      # gate, both directions
    python scripts/measurements/decision-index-fit.py --self-test  # prove it can fail

## Why this exists

`OWNER DECISION 48` is cited 74 times across 57 files and, until 2026-11-08, there was no file
anywhere saying what decision 48 is. The same held for 46 other numbers. The only way to learn
one was to ask the owner, whose standing instruction is that nobody should have to.
`docs/decision-<n>-<slug>.md` answers each, and `ibms-brain/meta/decision-index.md` indexes
them. **This gate is what stops the next decision being cited without a file** -- which is how
the hole opened in the first place, one citation at a time.

It fails in BOTH directions, because the two failures have different fixes:

  * a number cited in code with no file  -> somebody cited a decision nobody wrote down
  * a file with no citation in code      -> the decision left the code and the file is stale

## The derivation, declared here rather than restated anywhere

Case-insensitive `decision` (or `decisions`), optional single separator, then the number, over
**tracked, decodable files under `apps/` and `packages/`**. That is the method each decision
file states in its own text, and each ends it with the owner's clause: *the figure of whoever
re-runs it beats mine*. So this script is the arbiter and the prose follows it.

A 4-digit run beginning `19` or `20` is a DATE, never a decision number. That exclusion is the
reason the owner's own first count said 48 with a phantom `202` read out of `2026-10-29`.

## The phantoms are DECLARED AND ASSERTED, not silently dropped

Re-running the method gives **52** distinct numbers. Four are the matcher rather than a
decision, and each is ASSERTED to still be a phantom -- if one ever becomes a real citation the
script RAISES rather than reporting a missing file, because the alternative is a red build on a
correct tree. The bias, as everywhere in this directory: when in doubt, REAL.

## What it does not do

It does not check that a file's CONTENT is correct -- only that it exists, is indexed, that its
index row repeats its own first sentence, and that any citation count it states is the measured
one. Prose correctness is the owner's, and three pairs of eyes are the process for it.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys

# ---------------------------------------------------------------------------------------
# THIS GATE PRINTS ARABIC, AND IT RUNS INSIDE `npm run check:docs`, SO IT MAY NOT DEPEND
# ON THE CONSOLE CODEPAGE.
#
# Without this it crashes with `UnicodeEncodeError: 'charmap' codec can't encode` the
# moment it reports decision 98's exception -- whose text contains the section heading
# `## القرار بجملة` -- on any Windows shell, because Python resolves stdout to cp1252
# there. CI is Linux and defaults to UTF-8, so the failure appears ONLY on the machine the
# gate is developed on: it passes in CI and refuses locally, which is the worst direction.
#
# The sibling measurement scripts that print Arabic document `PYTHONIOENCODING=utf-8` in
# their header instead. That is fine for a script a person invokes by hand and wrong for
# one inside a `check:` chain, where the invocation is `npm run` and nobody passes an
# environment variable. A gate must not fail for a reason unrelated to what it measures.
# ---------------------------------------------------------------------------------------
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):  # already UTF-8, or not reconfigurable
        pass
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCS = os.path.join(ROOT, "docs")
INDEX = os.path.join(ROOT, "ibms-brain", "meta", "decision-index.md")

AR_DIGITS = "٠١٢٣٤٥٦٧٨٩"
_AR_TO_EN = {AR_DIGITS[i]: str(i) for i in range(10)}

# "decision"/"decisions", one optional short separator that is NOT a digit, then digits.
CITE = re.compile(
    r"decisions?\b([^0-9A-Za-z؀-ۿ]{0,4})([0-9]+)", re.IGNORECASE
)

# AND THE REST OF A MULTI-NUMBER CITATION, which is how decision 33 hid for as long as the
# register existed. `decisions 32 and 33` appears nine times in the tree; every matcher
# anchored on the word `decision` immediately before a number sees the 32 and is blind to
# the 33 -- so 33 was cited nine times, had no file, had no row, and nothing could say so.
# Walked repeatedly, so `decisions 82-87` yields all six.
CITE_TAIL = re.compile(
    r"\s*(?:and|&|,|-|–|—|to)\s*#?([0-9]+)\b", re.IGNORECASE
)

# ---------------------------------------------------------------------------------------
# DECLARED PHANTOMS -- the matcher's own false positives, each with the text that produces
# it. Every one is ASSERTED below: if the producing text disappears, this list is stale and
# the script says so instead of quietly trusting it.
# ---------------------------------------------------------------------------------------
PHANTOMS: dict[int, tuple[frozenset[str], str]] = {
    409: (
        frozenset({"apps/api/src/modules/client-decision/dto/capture-client-decision.dto.ts"}),
        "an HTTP status in `(409)` immediately after the word `ClientDecision`",
    ),
    6: (
        frozenset({"apps/api/src/modules/opportunity/opportunity.service.ts"}),
        "`Decision (6 outcomes)` -- the count of a process's outcomes, not a decision number",
    ),
    17: (
        frozenset({"packages/db/prisma/schema.prisma"}),
        "`Client Decision #17` -- the backlog's PROCESS number in Domain B, not a decision",
    ),
    1: (
        frozenset({
            "apps/api/src/modules/rbac/services/access-recertification.service.spec.ts"}),
        "the fixture id string `'act-decision-1'`",
    ),
    # The two below are produced by the multi-number tail walk only -- a count joined to a
    # real citation by a dash, which reads as a second decision number and is not one.
    16: (
        frozenset({
            "apps/api/src/modules/management-reporting/compliance-dashboard.service.spec.ts"}),
        "`decision 3 — 16 same-table registry pairs` -- a count of pairs, not a decision",
    ),
    229: (
        frozenset({"apps/api/test/provider-self-administration.e2e-spec.ts",
                   "apps/web/lib/admin/permission-matrix.test.ts"}),
        "`DECISION 36 — 229 -> 230` -- the permission catalogue's size, not a decision",
    ),
}

# ---------------------------------------------------------------------------------------
# A REAL DECISION THAT IS CITED AND HAS NO FILE -- DECLARED SO THE GATE IS NOT
# PERMANENTLY RED, AND ASSERTED SO THE DECLARATION CANNOT GO STALE.
#
# A permanently-red gate is one everybody learns to ignore; this repository already
# records that about `markdown-table-columns.py`. So a known gap is declared with its
# measurement, and the gate fails the moment it is closed (the declaration is then stale)
# or the moment an UNDECLARED number appears -- which is the job.
#
# IT IS EMPTY, AND IT WAS EMPTIED BY THE GATE DOING EXACTLY THAT. Decision 33 was declared
# here on 2026-11-08: cited 10 times, ALWAYS inside the phrase `decisions 32 and 33` and
# never once on its own, so every matcher anchored on the word `decision` immediately
# before a number read the `32` and was blind to the `33` -- which is why it had no file
# and no row for the whole life of the register. Its file was Arabic register content and
# was the owner's; she wrote it the same day, and the gate then went red naming this
# declaration as stale, which is the one proof a declaration list cannot rot.
#
# ⟶ KEEP THIS ACCOUNT. The hole was a matcher's shape, not anybody's oversight, and the
#   only thing stopping it reopening is `CITE_TAIL` plus the two self-test cases that
#   plant the second and fourth numbers of a chain.
# ---------------------------------------------------------------------------------------
KNOWN_MISSING: dict[int, str] = {}

# ---------------------------------------------------------------------------------------
# A DECISION THAT IS NEVER CITED ON ITS OWN DECLARES ITS OWN COUNTING METHOD.
#
# `measured_count` resolves the narrow `decision <n>` that the files themselves declare.
# For decision 33 that measures ZERO -- the string never occurs, because the citation is
# always `decisions 32 and 33` -- so the figure check would have called a correct file
# wrong by its whole count.
#
# ASSERTED: if the narrow form ever appears, this declaration is stale and the gate says
# so, because at that point the ordinary method applies and this special case would be
# measuring something nobody declared.
# ---------------------------------------------------------------------------------------
CITED_ONLY_JOINTLY: dict[int, str] = {
    33: r"decisions 32 and 33",
}

# ---------------------------------------------------------------------------------------
# AND A SITE THAT NO DECLARED METHOD CAN SEE, RECORDED RATHER THAN SILENTLY PICKED OVER.
#
# Decision 33 is cited in TEN places. Nine carry `decisions 32 and 33` on one line; the
# tenth, `retention-notice.config.ts`, breaks it across a line inside a block comment --
# `decisions 32 and` then ` *  33.` -- so every literal search finds nine.
#
# ⟶ THAT IS THIS GATE'S OWN BLIND SPOT ONE LEVEL DOWN. Decision 33 hid inside a
#   multi-number citation; then its own COUNT hid across a line wrap. Same shape, found
#   by re-measuring rather than recalling.
#
# THE FILE'S FIGURE STAYS AT NINE AND THAT IS DELIBERATE. Nine is the correct answer to
# the question every other decision file's declared method asks, and decision 33's file
# states it in THREE places (the measurement, «كلُّ الـ٩ مواضع», and «تسعَ مرّاتٍ»).
# Declaring the wrap-tolerant method would have forced one digit to ten and left the file
# contradicting itself twice -- the one-fact-two-homes defect in miniature -- and bringing
# the other two into line needs «عشرَ مرّاتٍ», which is numeral agreement and therefore
# morphology, the one operation nobody here may perform on the owner's behalf.
#
# So the tenth site is declared HERE, where no Arabic is at stake, and ASSERTED: the day
# somebody joins that wrapped line the two counts agree, this declaration is stale, and
# the gate says so. That is the only thing that stops a known gap becoming a forgotten one.
# ---------------------------------------------------------------------------------------
WRAPPED_CITATIONS: dict[int, tuple[str, int]] = {
    33: ("apps/api/src/modules/pdpl/retention-notice.config.ts", 1),
}
WRAP_TOLERANT = r"decisions[\s*/]+32[\s*/]+and[\s*/]+33"

# Decision files that predate the numbered convention and are addressed by slug alone. They
# are NOT indexed by number and are deliberately out of scope; `decision-98-...` is the one
# numbered precedent and IS in scope.
#
# AND THE SET IS EMPTY AS OF 2026-11-08, WHICH IS THE WHOLE POINT OF DECLARING IT.
# `docs/decision-98-widened-and-concentration.md` was the one entry: 288 lines of ENGLISH
# measurement record -- two scripted measurements and the owner's verbatim widening of
# decision 98's logic -- carrying no `## القرار بجملة` section for an index row to repeat.
# The index therefore had 48 rows against 49 files, and this declaration is what kept that
# a NAMED exception with a reason rather than a figure nobody reconciled.
#
# The comment here stated the choice as the owner's -- *whether 98 gets a five-section file
# and a row, or the index sentence names it as the exception; both answers need Arabic
# written*. She chose the row, and wrote the Arabic for it. So the row landed, this gate
# FAILED on its own declaration going stale (`decision 98 now HAS an index row`) plus a
# second error nobody had predicted -- the file still had no sentence section for the row to
# repeat -- and the fix was to give the file that section with the sentence sliced
# BYTE-IDENTICALLY from her own row, never retyped. The index is 49 of 49 now.
#
# Leaving this dict empty is deliberate. It is the mechanism, and the mechanism is what
# makes the next exception a declared one; `KNOWN_MISSING` above is empty for the same
# reason and for the same history.
NOT_AN_INDEX_ROW: dict[int, str] = {}

SLUG_ONLY = {
    "decision-corporate-customer-identifier.md",
    "decision-correcting-a-customers-details.md",
    "decision-insurer-field-split.md",
    "decision-one-field-finds-a-customer.md",
    "decision-reviewing-your-own-access.md",
    "decision-role-scope.md",
    "decisions-2026-09-28.md",
}

# A count claim inside a decision file. Both shapes state the same fact; the footer is the one
# that carries the declared method.
#
# BOTH ARABIC NOUN FORMS, AND THE REASON IS THE WHOLE POINT OF THIS GATE'S OWN ERROR MESSAGE.
# A number from 3 to 10 takes the genitive plural «مواضع»; 11 to 99 takes the singular
# accusative «موضعاً». This pattern accepted only the SINGULAR, so a figure in the lower band
# was invisible to the figure check -- and every figure corrected in message 27 happened to be
# >= 11, so the gap never showed. Decision 33's is the register's first count below 11.
#
# ⟶ THE GATE THAT EXISTS TO SAY *correct the digit and never re-word the noun* COULD NOT SEE
#   THE OTHER NOUN FORM. Both are read now, and `--self-test` plants the plural shape.
#
# AND ONE NOUN FORM IS SETTLED AS WRONG-AND-KEPT, BY THE OWNER, 2026-11-08. Decision 52's
# footer reads «٢ موضعاً» where two takes a DUAL («موضعين»). It was reported in message 27 and
# her answer was *«ما بيفرق، خليه زي ما هو»* -- leave it. So that is a recorded decision and not
# an uncorrected error: do not "fix" it. This gate does not and must not check grammar -- it
# checks that a stated FIGURE equals the measurement -- so nothing here flags it, deliberately.
CLAIM_FOOTER = re.compile(
    r"مذكورٌ في \*\*([" + AR_DIGITS
    + r"]+)\*\* (?:موضعاً|مواضع)"
)
CLAIM_HEADER = re.compile(
    r"مستشهد به في ([" + AR_DIGITS
    + r"]+) (?:موضع|مواضع)"
)
ONE_SENTENCE = re.compile(
    r"## القرار بجملة\s*\n+(.+?)(?=\n##|\Z)",
    re.S,
)


def _ar_to_int(s: str) -> int:
    return int("".join(_AR_TO_EN.get(c, c) for c in s))


def _tracked_bodies(root: str) -> dict[str, str]:
    out = subprocess.run(
        ["git", "ls-files", "apps", "packages"],
        cwd=root, capture_output=True, text=True, check=True,
    ).stdout
    bodies: dict[str, str] = {}
    for rel in (f for f in out.split("\n") if f.strip()):
        try:
            with open(os.path.join(root, rel), "rb") as fh:
                bodies[rel] = fh.read().decode("utf-8")
        except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError, PermissionError):
            continue
    return bodies


def cited_numbers(bodies: dict[str, str]) -> tuple[dict[int, int], dict[int, set[str]]]:
    """-> {number: citation count}, {number: files}. Dates excluded."""
    counts: dict[int, int] = {}
    files: dict[int, set[str]] = {}

    def record(num: str, rel: str) -> bool:
        """-> False if this is a date rather than a decision number."""
        if len(num) == 4 and num[:2] in ("19", "20"):
            return False
        n = int(num)
        counts[n] = counts.get(n, 0) + 1
        files.setdefault(n, set()).add(rel)
        return True

    for rel, text in bodies.items():
        for m in CITE.finditer(text):
            if not record(m.group(2), rel):
                continue
            # walk the tail of a multi-number citation: `decisions 32 and 33`
            pos = m.end()
            while True:
                tail = CITE_TAIL.match(text, pos)
                if not tail or not record(tail.group(1), rel):
                    break
                pos = tail.end()
    return counts, files


def measured_count(bodies: dict[str, str], n: int) -> tuple[int, int]:
    """The figure each decision file declares, and it is a NARROWER pattern than the one
    `cited_numbers` discovers with -- deliberately, because the two answer different
    questions and conflating them was this script's own first defect.

    The files declare: *a case-insensitive search for `decision <n>`* -- the literal
    string, space and all. `cited_numbers` is broader (it also accepts `decision-48` and
    `decision#48`) because its question is *has anybody cited this number in any shape*,
    where a missed shape means a missing file nobody is told about. Using the broad
    pattern here instead reported five correct figures as wrong.
    """
    joint = CITED_ONLY_JOINTLY.get(n)
    pat = re.compile(joint or rf"decision {n}\b", re.IGNORECASE)
    cites, files = 0, set()
    for rel, text in bodies.items():
        k = len(pat.findall(text))
        if k:
            cites += k
            files.add(rel)
    return cites, len(files)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[*`]", "", s)).strip()


def audit(root: str = ROOT) -> tuple[list[str], list[str]]:
    docs = os.path.join(root, "docs")
    index = os.path.join(root, "ibms-brain", "meta", "decision-index.md")
    errors: list[str] = []
    lines: list[str] = []
    bodies = _tracked_bodies(root)
    counts, files_for = cited_numbers(bodies)

    # ---- the phantoms are still phantoms -------------------------------------------
    #
    # Only meaningful against THIS repository: a synthetic tree contains none of the four
    # producing texts, so asserting there would report four stale phantoms on every
    # self-test run. The marker is a structural directory rather than a flag, because a
    # flag that switches a check off is a hole, and if `apps/api/src/modules` is gone then
    # nothing this gate measures means anything anyway.
    this_repo = os.path.isdir(os.path.join(root, "apps", "api", "src", "modules"))
    if this_repo:
        for n, (where, why) in sorted(PHANTOMS.items()):
            hits = files_for.get(n, set())
            if not hits:
                errors.append(
                    f"declared phantom {n} no longer appears at all -- PHANTOMS is stale, "
                    f"remove it ({why})"
                )
            elif hits - where:
                errors.append(
                    f"declared phantom {n} is now cited somewhere else too: "
                    f"{sorted(hits - where)} -- re-read it before trusting this list ({why})"
                )

        # ---- a joint-only declaration goes stale the day the narrow form appears ---
        for n, _pattern in sorted(CITED_ONLY_JOINTLY.items()):
            narrow = re.compile(rf"decision {n}\b", re.IGNORECASE)
            where = sorted(rel for rel, text in bodies.items() if narrow.search(text))
            if where:
                errors.append(
                    f"decision {n} is declared in CITED_ONLY_JOINTLY but is now cited on "
                    f"its own at {where[:2]} -- the ordinary method applies, so remove it"
                )

        # ---- the wrapped site is still wrapped, and still invisible to the literal ---
        wrap = re.compile(WRAP_TOLERANT, re.IGNORECASE)
        for n, (rel, extra) in sorted(WRAPPED_CITATIONS.items()):
            literal = re.compile(CITED_ONLY_JOINTLY[n], re.IGNORECASE)
            body = bodies.get(rel)
            if body is None:
                errors.append(
                    f"decision {n}'s declared wrapped citation names {rel}, which is no "
                    f"longer a tracked file -- WRAPPED_CITATIONS is stale"
                )
                continue
            seen = len(wrap.findall(body)) - len(literal.findall(body))
            if seen != extra:
                errors.append(
                    f"decision {n}: {rel} was declared to hold {extra} citation(s) that "
                    f"only a wrap-tolerant search can see, and now holds {seen}. If the "
                    f"line was joined, the file's figure and the wrap-tolerant count now "
                    f"agree and this declaration must go; if a new one wrapped, the "
                    f"file's figure under-reports by more than was recorded"
                )

    real = {n for n in counts if n not in PHANTOMS}

    # ---- files on disk -------------------------------------------------------------
    on_disk: dict[int, str] = {}
    for name in sorted(os.listdir(docs)):
        if not name.startswith("decision") or not name.endswith(".md"):
            continue
        if name in SLUG_ONLY:
            continue
        m = re.match(r"decision-(\d+)-", name)
        if not m:
            errors.append(f"docs/{name} is a decision file with no number and is not "
                          f"declared in SLUG_ONLY")
            continue
        on_disk[int(m.group(1))] = name

    lines.append(f"  decision numbers cited in apps/ + packages/   {len(real)}")
    lines.append(f"  declared matcher phantoms, each asserted       {len(PHANTOMS)}")
    lines.append(f"  numbered decision files in docs/              {len(on_disk)}")

    for n in sorted(real - set(on_disk)):
        if n in KNOWN_MISSING:
            lines.append(f"  decision {n}: CITED {counts[n]}x WITH NO FILE, declared and "
                         f"owner-owned")
            lines.append(f"              {KNOWN_MISSING[n]}")
            continue
        where = sorted(files_for[n])[:2]
        errors.append(
            f"decision {n} is cited {counts[n]}x in code and has NO file -- write "
            f"docs/decision-{n}-<slug>.md  (cited at {', '.join(where)})"
        )
    for n in sorted(KNOWN_MISSING):
        if n in on_disk:
            errors.append(
                f"decision {n} now HAS a file ({on_disk[n]}) -- remove it from "
                f"KNOWN_MISSING, which exists only to record that it does not"
            )
        elif n not in real and this_repo:
            errors.append(
                f"decision {n} is declared in KNOWN_MISSING but is no longer cited at all "
                f"-- that declaration is stale"
            )
    for n in sorted(set(on_disk) - real):
        errors.append(
            f"docs/{on_disk[n]} exists and decision {n} is cited NOWHERE in code -- "
            f"either the citation was removed and the file is stale, or it moved"
        )

    # ---- the index -----------------------------------------------------------------
    if not os.path.exists(index):
        errors.append(f"the index is missing: {os.path.relpath(index, root)}")
        return errors, lines
    with open(index, "rb") as fh:
        idx_text = fh.read().decode("utf-8")

    rows: dict[int, tuple[str, str]] = {}
    for line in idx_text.split("\n"):
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.split("|")[1:-1]]
        if len(cells) < 3:
            continue
        head = cells[0].replace("*", "").strip()
        digits = "".join(_AR_TO_EN.get(c, c) for c in head)
        if not digits.isdigit():
            continue
        link = re.search(r"\(([^)]*decision-[^)]+\.md)\)", cells[2])
        rows[int(digits)] = (cells[1], link.group(1) if link else "")

    lines.append(f"  rows in the index                             {len(rows)}")

    for n in sorted(set(on_disk) - set(rows)):
        if n in NOT_AN_INDEX_ROW:
            lines.append(f"  decision {n}: file present, deliberately not a row "
                         f"({NOT_AN_INDEX_ROW[n]})")
            continue
        errors.append(f"docs/{on_disk[n]} has no row in the index")
    for n in sorted(set(rows) - set(on_disk)):
        errors.append(f"the index has a row for decision {n} with no file in docs/")
    for n in sorted(NOT_AN_INDEX_ROW):
        if n in rows:
            errors.append(
                f"decision {n} now HAS an index row -- remove it from NOT_AN_INDEX_ROW, "
                f"which exists only to record that it does not"
            )
        elif n not in on_disk and this_repo:
            errors.append(
                f"decision {n} is declared in NOT_AN_INDEX_ROW but has no file at all -- "
                f"that declaration is stale"
            )

    for n in sorted(set(rows) & set(on_disk)):
        row_text, link = rows[n]
        target = os.path.join(os.path.dirname(index), link.replace("/", os.sep))
        if not link or not os.path.exists(target):
            errors.append(f"index row {n}: link does not resolve -> {link or '(none)'}")
        elif os.path.basename(link) != on_disk[n]:
            errors.append(
                f"index row {n}: link points at {os.path.basename(link)} "
                f"but the file is {on_disk[n]}"
            )
        with open(os.path.join(docs, on_disk[n]), "rb") as fh:
            body = fh.read().decode("utf-8")
        m = ONE_SENTENCE.search(body)
        if not m:
            errors.append(f"docs/{on_disk[n]} has no '## القرار بجملة' section")
            continue
        first = _norm(m.group(1).split("\n\n")[0])
        if _norm(row_text) not in first and first not in _norm(row_text):
            errors.append(
                f"index row {n} does not repeat its file's first sentence -- an index that "
                f"drifts from its files answers wrongly instead of not answering"
            )

    # ---- every count claim equals the measured figure ------------------------------
    claims = 0
    for n in sorted(on_disk):
        with open(os.path.join(docs, on_disk[n]), "rb") as fh:
            body = fh.read().decode("utf-8")
        stated = [_ar_to_int(x) for x in CLAIM_FOOTER.findall(body)]
        stated += [_ar_to_int(x) for x in CLAIM_HEADER.findall(body)]
        if not stated:
            continue
        cites, _ = measured_count(bodies, n)
        for v in stated:
            claims += 1
            if v != cites:
                errors.append(
                    f"docs/{on_disk[n]} states {v} citations; the method it declares "
                    f"measures {cites}. The file's own clause says the re-run wins -- "
                    f"correct the digit, and do NOT re-word the noun to agree "
                    f"(that is morphology)"
                )
    lines.append(f"  citation figures stated in files, all checked  {claims}")
    return errors, lines


# ---------------------------------------------------------------------------------------
# SELF-TEST -- planted inputs, not a count floor.
#
# A count floor refuses a correct tree the moment the work it guards gets done; this
# repository has already paid for that twice (`literal-colours.py`'s FLOOR = 10 refusing at
# a correct 9). Each case below plants exactly one condition in a throwaway tree and asserts
# the gate names it.
# ---------------------------------------------------------------------------------------
def _self_test() -> int:
    import shutil
    import tempfile

    cases: list[tuple[str, str]] = []

    def build(tmp: str) -> None:
        """A minimal tree the real audit() can run over: one cited decision, one file,
        one index row."""
        for d in ("apps", "packages", "docs", os.path.join("ibms-brain", "meta")):
            os.makedirs(os.path.join(tmp, d), exist_ok=True)
        subprocess.run(["git", "init", "-q"], cwd=tmp, check=True)
        src = os.path.join(tmp, "apps", "thing.ts")
        with open(src, "wb") as fh:
            fh.write(b"// owner decision 7 governs this\n")
        with open(os.path.join(tmp, "docs", "decision-7-a-slug.md"), "wb") as fh:
            fh.write(("# x\n\n## القرار "
                      "بجملة\n\n**one sentence.**\n").encode())
        with open(os.path.join(tmp, "ibms-brain", "meta", "decision-index.md"), "wb") as fh:
            fh.write(("| # | x | y | z |\n|---|---|---|---|\n"
                      "| **7** | **one sentence.** | "
                      "[`d`](../../docs/decision-7-a-slug.md) |  |\n").encode())
        subprocess.run(["git", "add", "-A"], cwd=tmp, check=True)

    def run(tmp: str) -> list[str]:
        return audit(tmp)[0]

    passed = failed = 0
    plants = [
        ("clean tree", None, None),
        ("a cited decision with no file",
         lambda t: open(os.path.join(t, "apps", "more.ts"), "wb").write(
             b"// per owner decision 31 this is so\n"),
         "decision 31 is cited"),
        ("a file nothing cites",
         lambda t: open(os.path.join(t, "docs", "decision-88-x.md"), "wb").write(
             b"# x\n"),
         "cited NOWHERE"),
        ("a file with no index row",
         lambda t: (open(os.path.join(t, "apps", "m2.ts"), "wb").write(
             b"// decision 12 applies\n"),
             open(os.path.join(t, "docs", "decision-12-y.md"), "wb").write(b"# y\n")),
         "has no row in the index"),
        ("an index row whose link does not resolve",
         lambda t: _patch(os.path.join(t, "ibms-brain", "meta", "decision-index.md"),
                          "decision-7-a-slug.md", "decision-7-GONE.md"),
         "link does not resolve"),
        ("an index row that no longer repeats its file's sentence",
         lambda t: _patch(os.path.join(t, "ibms-brain", "meta", "decision-index.md"),
                          "| **one sentence.** |", "| **something else entirely.** |"),
         "does not repeat its file's first sentence"),
        ("a stated citation figure that disagrees with the measurement",
         lambda t: _patch(os.path.join(t, "docs", "decision-7-a-slug.md"),
                          "**one sentence.**",
                          "**one sentence.**\n\n**وهو "
                          "مذكورٌ في **٩** "
                          "موضعاً**"),
         "the method it declares measures"),
        # THE SHAPE THAT HID DECISION 33 FOR THE WHOLE LIFE OF THE REGISTER. The first
        # number of a multi-number citation is seen by any matcher; the second is seen only
        # by the tail walk. Without this case the widening is untested and could silently
        # stop working, putting the hole back.
        ("the SECOND number of a `decisions N and M` citation",
         lambda t: open(os.path.join(t, "apps", "pair.ts"), "wb").write(
             b"// the shipped template's deliberate state (decisions 7 and 54)\n"),
         "decision 54 is cited"),
        ("the fourth number of a longer chain",
         lambda t: open(os.path.join(t, "apps", "chain.ts"), "wb").write(
             b"// per decisions 7, 61, 62 and 63 this holds\n"),
         "decision 63 is cited"),
        # THE NOUN FORM THAT THE FIGURE CHECK COULD NOT SEE. A count of 3-10 takes the
        # genitive plural «مواضع»; the matcher accepted only the 11-99 singular «موضعاً»,
        # so every low figure was unchecked. Decision 33's was the register's first.
        ("a stated figure in the 3-10 band, where the noun is a PLURAL",
         lambda t: _patch(os.path.join(t, "docs", "decision-7-a-slug.md"),
                          "**one sentence.**",
                          "**one sentence.**\n\n**وهو "
                          "مذكورٌ في **٩** "
                          "مواضع**"),
         "the method it declares measures"),
        # Proves the joint-only declaration cannot rot: the day a number cited only inside
        # `decisions N and M` starts being cited alone, the ordinary method applies and the
        # special case must go, or it measures something nobody declared.
        ("a joint-only decision that has started being cited on its own",
         lambda t: (os.makedirs(os.path.join(t, "apps", "api", "src", "modules"),
                                exist_ok=True),
                    open(os.path.join(t, "apps", "alone.ts"), "wb").write(
                        b"// per decision 33 the floored category ships bare\n")),
         "declared in CITED_ONLY_JOINTLY but is now cited on"),
        # Proves the wrapped-site declaration cannot become a forgotten gap: joining the
        # line, or wrapping another, must both be named rather than quietly absorbed.
        ("a declared wrapped citation whose file is gone",
         lambda t: os.makedirs(os.path.join(t, "apps", "api", "src", "modules"),
                               exist_ok=True),
         "WRAPPED_CITATIONS is stale"),
        # Proves the phantom audit is LIVE rather than switched off by the marker above:
        # a tree that looks like this repository but no longer contains the four producing
        # texts must report them stale, not pass quietly.
        ("a repo-shaped tree where a declared phantom's text is gone",
         lambda t: os.makedirs(os.path.join(t, "apps", "api", "src", "modules"),
                               exist_ok=True),
         "PHANTOMS is stale"),
    ]
    for label, mutate, needle in plants:
        tmp = tempfile.mkdtemp(prefix="dec-index-")
        try:
            build(tmp)
            if mutate:
                mutate(tmp)
                subprocess.run(["git", "add", "-A"], cwd=tmp, check=True)
            errs = run(tmp)
            if needle is None:
                ok = not errs
                detail = "no errors" if ok else f"unexpected: {errs}"
            else:
                ok = any(needle in e for e in errs)
                detail = (f"named it" if ok
                          else f"DID NOT NAME IT -- got {errs or '[no errors at all]'}")
            print(f"  {'ok  ' if ok else 'FAIL'}  {label:<56} {detail}")
            passed += ok
            failed += not ok
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n  self-test: {passed} passed, {failed} failed\n")
    return 1 if failed else 0


def _patch(path: str, old: str, new: str) -> None:
    with open(path, "rb") as fh:
        t = fh.read().decode("utf-8")
    assert old in t, f"self-test plant anchor missing in {path}: {old!r}"
    with open(path, "wb") as fh:
        fh.write(t.replace(old, new, 1).encode("utf-8"))


def main() -> int:
    if "--self-test" in sys.argv:
        return _self_test()
    errors, lines = audit()
    print("\n  decision register fit\n")
    for line in lines:
        print(line)
    print()
    for e in errors:
        print(f"  ERROR  {e}")
    if errors:
        print(f"\n  {len(errors)} error(s)\n")
        return 1 if "--check" in sys.argv else 0
    print("  ok     every cited decision has a file, every file has a row, every row "
          "repeats its\n         file's own sentence, and every stated figure is the "
          "measured one\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
