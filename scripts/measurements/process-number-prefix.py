#!/usr/bin/env python
"""NO SHIPPED STRING OPENS BY NUMBERING A BACKLOG PROCESS — DECISIONS 150 (AR) AND 152 (EN).

    python scripts/measurements/process-number-prefix.py             # report
    python scripts/measurements/process-number-prefix.py --check      # gate, budget zero
    python scripts/measurements/process-number-prefix.py --self-test  # prove it can fail

## What was wrong, and it was on twenty-five screens

Twenty-five Arabic descriptions opened «العملية 11 — …», «العمليات 23-30 — …» and so on. That
number is the BACKLOG's own index — Part C process 11, process 23-30 — and it means nothing
whatever to the person reading the screen. It is our build order leaking into their product, at
the top of the paragraph that is supposed to tell them what the screen is for.

Her ruling (150, 3-أ): «يُحذَف من الخمسة والعشرين، ولا تتغيّر كلمة بعده» — delete it from all
twenty-five, and change no word after it.

🔴 AND THE ENGLISH FOLLOWED A BATCH LATER, WHICH IS WHY THIS GATE WAS HALF A GATE. Ruling 3
could only reach the ARABIC: every row of decision 150's annex names an Arabic span and its §٥
gives Arabic text only. So twenty-five English values went on opening «Process 11 — » beside
Arabic twins that no longer did — reported as an EMPTY CELL rather than decided for her, in
`bilingual-prose-screenshots.spec.ts`'s own comment. **Decision 152 §٢ rules it**, and the
matcher covers both languages now.

## Why the budget is ZERO rather than a ratchet

There is no correct instance. A screen never needs to tell its reader which backlog item built
it, so the right number of these is none, and a ratchet would only record how long the next one
survived.

⚠️ AND IT CHECKS THE **VALUE**, NOT THE KEY. The prefix is Arabic prose inside a shipped string;
nothing about the key's name gives it away. Both noun forms are matched — «العملية» (singular)
and «العمليات» (plural, used by `claimIntro`'s «العمليات 23-30 —») — because matching only the
singular would have let the one plural through, which is the shape `decision-index-fit.py`
records for Arabic number agreement and this file inherits rather than rediscovers.
"""
import os
import re
import subprocess
import sys

# This gate PRINTS ARABIC -- the offending string, so a reader can see what it is about -- and
# Windows gives Python a cp1252 stdout, which raises `UnicodeEncodeError` on the first Arabic
# character. CI is Linux and defaults to UTF-8, so the failure appears ONLY on the machine the
# gate is developed on: green in CI, crashing locally, which is the worst direction. Measured
# here on the first run. Same device, and the same reasoning, as `decision-index-fit.py`:
# a `check:` chain is invoked by `npm run`, where nobody passes `PYTHONIOENCODING`.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):  # already UTF-8, or not reconfigurable
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCANNED = os.path.join("apps", "web", "lib", "i18n", "translations")

# A quoted literal in either style -- `customers.ts` uses double quotes, the rest single.
QUOTED = re.compile(r"'((?:[^'\\]|\\.)*)'" + "|" + r'"((?:[^"\\]|\\.)*)"')

# «العملية» or «العمليات», then a digit (Western or Eastern) within a few characters -- the
# space-digit shape of `العملية 11 —`, allowing the digits to be a range like `23-30`.
#
# 🔴 AND THE ENGLISH, ADDED 2026-11-18 FOR OWNER DECISION 152 §٢.
#
# Decision 150 ruling 3 deleted the prefix from twenty-five ARABIC descriptions and could not
# reach the English: every row of its annex names an Arabic span and §٥ gives Arabic only. So
# the twenty-five English values went on opening «Process 11 — » while their Arabic twins no
# longer did — which `bilingual-prose-screenshots.spec.ts` recorded in its own comment as an
# EMPTY CELL rather than deciding for her. Decision 152 §٢ rules it: *«تُحذَف البادئة منها
# أيضاً، ولا تتغيّر كلمة بعدها»*.
#
# ⚠️ BOTH ENGLISH FORMS, for the reason the Arabic pair is already matched here: `claimIntro`
# opens «Processes 23–30 — », the PLURAL, and a `Process\s` matcher does not match `Processes`
# at all. Measured while writing this: a singular-only sweep counted TWENTY-FOUR and the real
# figure is twenty-five. That is the same Arabic-agreement blindness this file's header already
# records, reappearing in a language that has nothing to do with Arabic agreement.
PREFIX = re.compile(
    r"^\s*(?:العمل(?:ية|يات)\s+[0-9٠-٩]|Process(?:es)?\s+[0-9])"
)

# 🔴 THE SECOND RULE OF THE SAME SHAPE — OWNER DECISION 151 RULING 2-أ, ADDED 2026-11-19.
#
# Seven shipped strings cited one of OUR OWN internal documents by clause: «(الجزء 5.1)»,
# «(البند 10.6، يُسجَّل)», «(الجزء 8.2)», «وفق الجزء 4.2 —», «البند 5.1 — ». That is the same
# defect this file already exists for, one document over: an internal index leaking into the
# product, in the sentence meant to tell the reader what the screen is for. A customer cannot
# look up «البند 10.6» — there is nowhere for them to look it up.
#
# ⚠️ SEARCHED ANYWHERE IN THE VALUE, not anchored like PREFIX. Five of the seven carried the
# reference MID-SENTENCE and only two opened with it, so a `^` would have caught two of seven
# and reported a clean tree over the other five.
#
# 🔴 AND THE ENGLISH HALF JOINED IT ON 2026-11-19 — OWNER DECISION 155 RULING 4.
#
# Decision 151's annex names an ARABIC span in every «كان» cell, so when it shipped the English
# halves still read «(Part 5.1)», «(Part 10.6, logged)», «Part 4.2» and «Part 5.1 — ». That was
# reported as an EMPTY CELL rather than guessed at, exactly as decision 150's English prefix was.
# Decision 155 ruling 4 fills it: *««Part N» في النصوص السبعة وجملة التسجيل الذاتي تُحذَف من
# الإنجليزية بالحذف نفسه»* — the same deletion, and ⛔ «لا كلمة أخرى تتغيّر».
#
# ⚠️ `Part` IS AN ORDINARY ENGLISH WORD, so the digits are what make this a reference: `Part 5.1`
# matches and «part of the policy» does not. The self-test carries that as a NON-finding.
CLAUSE = re.compile(r"(?:البند|الجزء)\s+[0-9٠-٩]|\bPart\s+\d+\.\d+")

# ⛔ THE ONE EXEMPTION, AND IT IS HERS, NOT A CONVENIENCE.
#
# Annex §٢ states it in terms: *«يبقى كما هو: `iassetIntro` «جرد الأصول وفق البند 8.1 من معيار
# ISO 27001»، لأنه مرجع لمعيار خارجي»* — it stays because it cites an EXTERNAL standard. A
# reader CAN look up ISO 27001 clause 8.1; that is the whole difference from «البند 10.6»,
# which names a document only we hold.
#
# Declared as a (key, span) pair rather than inferred from «من معيار», deliberately: a rule
# that exempts anything followed by those two words would let the next internal reference
# through the moment somebody wrote them. And it is checked in BOTH directions — a declared
# exemption whose span has gone is STALE and fails, so the day `iassetIntro` is reworded this
# list cannot quietly keep an entry for a string that no longer exists.
#
# ⚠️ AND THE ENGLISH HALF OF THAT SAME STRING NEEDS NO EXEMPTION, WHICH THIS LIST PROVED.
#
# `iassetIntro` reads «The ISO 27001 Clause 8.1 asset inventory» in English. Declaring it here
# was the first thing tried, and the STALENESS check refused it: the English matcher is
# `Part N.N`, and that value says **Clause**, so it never meets the matcher and an exemption for
# it would be a row describing a finding that cannot occur. ⟶ The external ISO reference is
# outside this gate in English by its own words rather than by a declaration, and the four
# internal references decision 155 deleted all said «Part». ⛔ Do not widen the matcher to
# `Clause N.N` to make the symmetry look tidier: it would flag the one reference the owner
# ruled must stay.
CLAUSE_EXEMPT = {
    ("iassetIntro", "البند 8.1 من معيار ISO 27001"),
}


def _files(root: str) -> list[str]:
    """Tracked dictionaries, or a walk on a tree with no `.git` (the self-test's trees)."""
    if os.path.isdir(os.path.join(root, ".git")):
        out = subprocess.run(
            ["git", "ls-files", SCANNED],
            cwd=root, capture_output=True, text=True, check=True,
        ).stdout
        return [p for p in out.splitlines() if p.endswith(".ts")]
    found = []
    for dirpath, _dirs, fs in os.walk(os.path.join(root, SCANNED)):
        for n in fs:
            if n.endswith(".ts"):
                found.append(
                    os.path.relpath(os.path.join(dirpath, n), root).replace(os.sep, "/")
                )
    return sorted(found)


def _entry_text(lines: list[str], start: int) -> "str | None":
    """The joined text of the dictionary entry beginning at `lines[start]`.

    A value may sit on the key's own line, on the next one, or across several joined with `+`.
    Reads forward to the line that ends the entry (a trailing comma outside a string) and
    concatenates every quoted piece. Returns None when the entry holds no string literal at all
    (a nested object, a function, a number).

    Bounded at 12 lines: the longest real entry is well under that, and an unbounded walk over a
    malformed file would swallow the rest of the dictionary into one "value".
    """
    out: list[str] = []
    for line in lines[start:start + 12]:
        for a, b in QUOTED.findall(line):
            out.append(a or b)
        if line.rstrip().endswith(","):
            break
    return "".join(out) if out else None


def measure(root: str) -> tuple[list[str], list[str]]:
    findings: list[str] = []
    scanned = values = 0
    clause_hits = 0
    exempt_seen: set = set()
    for rel in _files(root):
        try:
            with open(os.path.join(root, rel), "rb") as fh:
                body = fh.read().decode("utf-8")
        except OSError:
            continue
        scanned += 1
        lines_of = body.split("\n")
        for n, line in enumerate(lines_of, start=1):
            m = re.match(r"^\s{4}([A-Za-z0-9_]+):\s*(.*)$", line)
            if not m:
                continue
            #
            # 🔴 THE VALUE MAY BE ON THE NEXT LINE, AND THE FIRST VERSION OF THIS GATE COULD
            # NOT SEE THAT -- it matched key and value on ONE line, so every entry prettier had
            # wrapped was invisible. Measured with the plant: putting «العملية 11 —» back onto
            # `rfqNewIntro` (a wrapped entry) left the gate reporting ZERO, which is the exact
            # false green a budget-zero gate exists to make impossible. ⟶ The entry is read to
            # its terminating comma, and every quoted piece joined.
            #
            text = _entry_text(lines_of, n - 1)
            if text is None:
                continue
            values += 1
            if PREFIX.match(text):
                findings.append(
                    f"{rel}:{n}: `{m.group(1)}` opens by numbering a backlog process -- "
                    f"{text[:40]}... Owner decision 150 ruling 3-أ deletes that prefix from "
                    f"all twenty-five Arabic descriptions and decision 152 §٢ from the "
                    f"twenty-five English ones, and neither changes a word after it. The "
                    f"backlog's index means nothing to the person reading the screen"
                )
            # DECISION 151 RULING 2-أ — an internal clause reference, anywhere in the value.
            if CLAUSE.search(text):
                exemption = next(
                    (e for e in CLAUSE_EXEMPT
                     if e[0] == m.group(1) and e[1] in text),
                    None,
                )
                if exemption is not None:
                    exempt_seen.add(exemption)
                else:
                    clause_hits += 1
                    findings.append(
                        f"{rel}:{n}: `{m.group(1)}` cites one of OUR OWN documents by clause -- "
                        f"{text[:40]}... Owner decision 151 ruling 2-أ deletes «البند N» and "
                        f"«الجزء N» from the seven strings that carried them: the reader has "
                        f"nowhere to look that clause up. The ONLY exemption is a reference to "
                        f"an EXTERNAL standard, and it is declared by key and span in "
                        f"CLAUSE_EXEMPT -- add one only with a ruling, never to pass a build"
                    )

    # A declared exemption whose span has gone is STALE. Reported as a finding so the list
    # cannot outlive the string it describes -- the direction `hardcoded-ui-english.py`'s own
    # declared set already checks, inherited here rather than rediscovered later.
    for key, span in sorted(CLAUSE_EXEMPT - exempt_seen):
        findings.append(
            f"CLAUSE_EXEMPT declares `{key}` carries «{span}» and no shipped value does. "
            f"Either the string was reworded -- in which case delete the row in the SAME "
            f"commit -- or the file it lives in stopped being scanned, which is worse"
        )

    lines = [
        f"  dictionary files scanned                     {scanned}",
        f"  first-line values examined                   {values}",
        f"  process-number prefixes, AR + EN (budget 0)  "
        f"{len([f for f in findings if 'backlog process' in f])}",
        f"  internal clause references (budget 0)        {clause_hits}",
        f"  external-standard exemptions matched         "
        f"{len(exempt_seen)} of {len(CLAUSE_EXEMPT)} declared",
    ]
    return findings, lines


def run(root: str, check: bool) -> int:
    findings, lines = measure(root)
    print()
    print("  process-number prefixes")
    print()
    for ln in lines:
        print(ln)
    print()
    if findings:
        for f in findings:
            print(f"  ERROR  {f}")
        print()
        print(f"  {len(findings)} error(s)")
        return 1 if check else 0
    print(
        "  ok     no shipped string opens by numbering a backlog process, and none "
        "cites one of our own documents by clause"
    )
    return 0


def _self_test() -> int:
    import shutil
    import tempfile

    def build(tmp):
        d = os.path.join(tmp, "apps", "web", "lib", "i18n", "translations")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "ok.ts"), "wb") as fh:
            fh.write("    goodIntro: 'إنشاء طلب عرض أسعار واحد وإرساله.',\n".encode("utf-8"))
        # ⛔ THE DECLARED EXEMPTION LIVES IN EVERY SYNTHETIC TREE, and that is not a
        # convenience: CLAUSE_EXEMPT is checked for STALENESS, so a tree without this string
        # would report the declaration stale and every case below would fail for a reason that
        # has nothing to do with what it tests. Putting it here also makes the exemption itself
        # a permanent case — the "clean tree" run proves an ISO reference is NOT a finding.
        with open(os.path.join(d, "exempt.ts"), "wb") as fh:
            fh.write(
                "    iassetIntro: 'جرد الأصول وفق البند 8.1 من معيار ISO 27001 — كل أصل.',\n"
                .encode("utf-8")
            )

    def plant(name, text):
        def go(tmp):
            p = os.path.join(tmp, "apps", "web", "lib", "i18n", "translations", name)
            with open(p, "wb") as fh:
                fh.write(text.encode("utf-8"))
        return go

    plants = [
        ("clean tree", None, None),
        ("the singular «العملية 11 —»",
         plant("a.ts", "    aIntro: 'العملية 11 — إنشاء طلب.',\n"),
         "opens by numbering a backlog process"),
        # The one `claimIntro` actually used. Matching only the singular would miss it.
        ("the PLURAL «العمليات 23-30 —»",
         plant("b.ts", "    bIntro: 'العمليات 23-30 — المطالبات.',\n"),
         "opens by numbering a backlog process"),
        ("double-quoted, as customers.ts writes its Arabic",
         plant("c.ts", '    cIntro: "العملية 5 — استبيان.",\n'),
         "opens by numbering a backlog process"),
        ("Eastern digits after the word",
         plant("d.ts", "    dIntro: 'العملية ١١ — إنشاء طلب.',\n"),
         "opens by numbering a backlog process"),
        # The word is ordinary Arabic. Only the NUMBERED PREFIX is the defect.
        ("«العملية» used as an ordinary word is NOT a finding",
         plant("e.ts", "    eIntro: 'العملية تبدأ بعد الاعتماد.',\n"),
         None),
        ("the prefix in the MIDDLE of a sentence is not this defect",
         plant("f.ts", "    fIntro: 'تبدأ العملية 11 بعد الاعتماد.',\n"),
         None),
        # 🔴 THE HOLE THE PLANT FOUND, now permanent. The first version matched key and value on
        # ONE line, so every entry prettier had wrapped was invisible -- and the real
        # `rfqNewIntro` is wrapped. Planting the prefix back onto it left the gate reporting
        # ZERO: a budget-zero gate printing a confident green over the defect it exists for.
        ("the value WRAPPED onto the next line",
         plant("g.ts", "    gIntro:\n      'العملية 11 — إنشاء طلب عرض أسعار واحد.',\n"),
         "opens by numbering a backlog process"),
        ("and wrapped across several lines joined with +",
         plant("h.ts", "    hIntro:\n      'العمليات 23-30 — المطالبات ' +\n      'من الإشعار.',\n"),
         "opens by numbering a backlog process"),
        # 🔴 THE ENGLISH HALF — OWNER DECISION 152 §٢, added 2026-11-18.
        ("the English singular «Process 11 — »",
         plant("i.ts", "    iIntro: 'Process 11 — create one RFQ.',\n"),
         "opens by numbering a backlog process"),
        # ⚠️ `claimIntro`'s own shape, and the one a `Process\s` matcher cannot see at all. A
        # singular-only sweep counted 24 English values; the real figure is 25.
        ("the English PLURAL «Processes 23–30 — »",
         plant("j.ts", "    jIntro: 'Processes 23–30 — notify claim.',\n"),
         "opens by numbering a backlog process"),
        ("the English value WRAPPED onto the next line",
         plant("k.ts", "    kIntro:\n      'Process 7 — a multi-line Insurance Program.',\n"),
         "opens by numbering a backlog process"),
        # The WORD is ordinary English and appears in real copy. Only the NUMBERED PREFIX is the
        # defect — without this case the matcher could be widened to `Process` alone and nothing
        # would say so.
        ("«Process» as an ordinary word is NOT a finding",
         plant("l.ts", "    lIntro: 'Process the application before the deadline.',\n"),
         None),
        ("a process number in the MIDDLE of a sentence is not this defect",
         plant("m.ts", "    mIntro: 'Covered by Process 11 once approved.',\n"),
         None),
        # ⛔ A permission DESCRIPTION carrying a parenthetical «(Process 17)» is a different
        # thing and decision 152 §٢ does not touch it: the ruling is about the PREFIX on the
        # twenty-five screen descriptions. Without this case, tightening the matcher later could
        # quietly start failing six `permissions.ts` entries nobody ruled on.
        ("a parenthetical «(Process 17)» inside a description is NOT a finding",
         plant("n.ts", "    nIntro: 'Capture the decision (Process 17) on a recommendation.',\n"),
         None),
        # 🔴 DECISION 151 RULING 2-أ — the internal clause reference, added 2026-11-19.
        #
        # ⚠️ Five of the seven real strings carried it MID-SENTENCE, so the first three cases
        # here are the ones an anchored matcher would miss. Without them the rule could be
        # written with `^` and report a clean tree over five of its own seven subjects.
        ("«(البند 10.6، يُسجَّل)» mid-sentence IS a finding",
         plant("o.ts", "    oLabel: 'مبرر كشف {field} (البند 10.6، يُسجَّل)',\n"),
         "cites one of OUR OWN documents by clause"),
        ("«(الجزء 5.1)» mid-sentence IS a finding",
         plant("p.ts", "    pIntro: 'العدسة القرائية فقط للمدقّق الخارجي (الجزء 5.1): السجلات.',\n"),
         "cites one of OUR OWN documents by clause"),
        ("«البند 5.1 — » opening the value IS a finding",
         plant("q.ts", "    qIntro: 'البند 5.1 — مراجعة دورية لمن يملك الصلاحيات.',\n"),
         "cites one of OUR OWN documents by clause"),
        ("a clause reference in a WRAPPED value IS a finding",
         plant("r.ts", "    rIntro:\n      'سجلات الموظفين والتوعية الأمنية ' +\n      'والتدريب (الجزء 8.2).',\n"),
         "cites one of OUR OWN documents by clause"),
        # ⛔ «البند» as an ordinary word. `acrIntro` itself says «أكّد كل بند أدناه» — confirm
        # each ITEM below — so a matcher on the word alone would fail the very string the
        # ruling just cleaned.
        ("«بند» as an ordinary word with no number is NOT a finding",
         plant("s.ts", "    sIntro: 'أكّد كل بند أدناه أو ألغِه أو ضع عليه علامة.',\n"),
         None),
        # 🔴 DECISION 155 RULING 4 — the ENGLISH half, added 2026-11-19. Decision 151's annex
        # named Arabic spans only, so these four shapes shipped on in English for three days
        # after the Arabic lost them. They are the real strings, one case each.
        ("«(Part 5.1)» mid-sentence in ENGLISH IS a finding",
         plant("t.ts", "    tIntro: \"The External Auditor's read-only lens (Part 5.1): logs.\",\n"),
         "cites one of OUR OWN documents by clause"),
        ("«(Part 10.6, logged)» in ENGLISH IS a finding",
         plant("u.ts", "    uLabel: 'Justification for revealing {field} (Part 10.6, logged)',\n"),
         "cites one of OUR OWN documents by clause"),
        ("«Part 5.1 — » opening an ENGLISH value IS a finding",
         plant("v.ts", "    vIntro: 'Part 5.1 — periodic review of who holds access.',\n"),
         "cites one of OUR OWN documents by clause"),
        ("an ENGLISH clause reference in a WRAPPED value IS a finding",
         plant("w.ts", "    wIntro:\n      'This cycle covered no administrator account. That is the ' +\n      'condition Part 5.1 exists to prevent.',\n"),
         "cites one of OUR OWN documents by clause"),
        # ⛔ THE THREE ENGLISH NON-FINDINGS, and the first is why the digits are in the matcher:
        # «Part» is an ordinary English word and this product says it in ordinary sentences.
        ("«part» as an ordinary English word is NOT a finding",
         plant("x.ts", "    xIntro: 'Part of the premium is refundable once the policy is cancelled.',\n"),
         None),
        # ⛔ The ISO reference in ENGLISH says «Clause», not «Part», so it is outside this
        # matcher by its own words. Without this case, widening to `Clause N.N` for symmetry
        # would flag the one reference decision 151 ruled must STAY.
        ("the ENGLISH ISO 27001 reference is NOT a finding",
         plant("y.ts", "    yIntro: 'The ISO 27001 Clause 8.1 asset inventory — every information asset.',\n"),
         None),
        ("a bare part number with no decimal is NOT a finding",
         plant("z.ts", "    zIntro: 'Part 5 of the schedule lists the excesses.',\n"),
         None),
        # 🔴 THE STALE DIRECTION. `exempt.ts` is overwritten so the declared span is gone;
        # without this case CLAUSE_EXEMPT could outlive the string it describes, and a
        # declaration nobody can falsify is how an exemption quietly becomes an amnesty.
        ("a DECLARED exemption whose span has gone is reported STALE",
         plant("exempt.ts", "    iassetIntro: 'جرد الأصول مع مالكه وتصنيفه.',\n"),
         "and no shipped value does"),
    ]
    passed = failed = 0
    for label, mutate, needle in plants:
        tmp = tempfile.mkdtemp(prefix="process-prefix-")
        try:
            build(tmp)
            if mutate:
                mutate(tmp)
            errs, _ = measure(tmp)
            if needle is None:
                ok = not errs
                detail = "no errors" if ok else f"UNEXPECTED {errs[:1]}"
            else:
                ok = any(needle in e for e in errs)
                detail = "named it" if ok else f"DID NOT NAME IT -- {errs or '[none]'}"
            print(f"  {'ok  ' if ok else 'FAIL'}  {label:<56} {detail}")
            passed += ok
            failed += not ok
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n  self-test: {passed} passed, {failed} failed\n")
    return 1 if failed else 0


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(_self_test())
    sys.exit(run(ROOT, "--check" in sys.argv))
