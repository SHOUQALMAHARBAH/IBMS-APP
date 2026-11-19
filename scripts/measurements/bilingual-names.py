#!/usr/bin/env python
"""A NAME THAT EXISTS IN BOTH SCRIPTS IS NOT PRINTED IN ONE OF THEM BY HAND.

    python scripts/measurements/bilingual-names.py             # report
    python scripts/measurements/bilingual-names.py --check      # gate, budget zero
    python scripts/measurements/bilingual-names.py --self-test  # prove it can fail

## Why this exists, measured on the owner's demo-path walk of 2026-11-17 (§W3 + §P4)

The Arabic names were already on the wire and the screens were printing the English ones.
`INSURER_IDENTITY_SELECT` selects `legalNameAr`, `insurerIdentity()` resolves the pair, `/insurers`
and `/insurer-directory` rendered the Arabic -- and the RFQ, quotation, comparison, recommendation
and policy blocks rendered the Latin name beside it, in the same language, on the same screen.

🔴 AND ONE OF THEM RENDERED NOTHING AT ALL. The submissions table on `/rfqs/[id]` read
`submission.insurer.name` against a payload that carried `legalName`, because three RFQ reads
never went through `insurerIdentity()` while the picker on `/rfqs/new` did. `undefined` renders as
NOTHING in React, so the column was simply blank -- the same silent shape as message 44's
`DocumentCategory` labels, and for the same reason: a declared type the runtime did not supply.

## What is checked, and why the rule is a CALL rather than a string

Budget ZERO on both counts, in `apps/web/app` and `apps/web/components`:

  * a rendered insurer name must go through `insurerDisplayName(...)`, which takes the INSURER,
    not its `.name` -- so any surviving `.insurer.name` / `.insurer.nameAr` is a hand-written
    answer to a question that has one home;
  * a rendered `legalName` / `legalNameAr` must go through `legalDisplayName(...)`, same reason.

⛔ It deliberately does NOT check for the ternary `language === 'AR' ? x.nameAr : x.name`. That
shape is correct wherever it appears -- it was the behaviour three screens already had, and it is
what this change generalised -- so banning it would be banning the right answer for being written
twice. What the gate bans is reading the FIELD, because that is what cannot be told apart from
the defect: `insurer.name` on a screen is either the English name chosen deliberately or a blank
cell nobody noticed, and a reader cannot see which.

## The declared list is for a screen that shows BOTH names on purpose

A company record prints `companyLegalName` and `companyLegalNameAr` as two labelled fields,
because that screen's subject IS the registered identity in both scripts. That is not a
by-language choice and must not be collapsed into one. Declared, with the reason, and checked in
BOTH directions -- a declaration whose site is gone fails, so the list cannot rot into an amnesty.
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCANNED = (
    os.path.join("apps", "web", "app"),
    os.path.join("apps", "web", "components"),
)

# `.insurer.name`, `.insurer?.name`, `.insurer.nameAr` -- the field read the helper replaces.
INSURER_FIELD = re.compile(r"\binsurer\??\.(name|nameAr)\b")
# A `legalName` / `legalNameAr` read, SCOPED TO AN INSURER ROW by the same line naming one.
#
# ⛔ Deliberately not every `legalName` in the web. A CUSTOMER's legal name and an OFFICE's are
# the same question about different entities, and the owner has ruled on neither -- the demo-path
# walk (§P4) is about the insurer and the insurance line. Measured 2026-11-17: without this scope
# the gate caught 20 sites in the customer onboarding wizard, the KYC queue, `EntitySearch` and
# the three provider registration screens, and declaring each as "this is a customer" would be
# noise standing where a record belongs. They are REPORTED to her instead.
LEGAL_FIELD = re.compile(r"\.\s*(legalName|legalNameAr)\b")
INSURER_CONTEXT = re.compile(r"[Ii]nsurer|[Mm]aster")

# 🔴 THE INSURANCE LINE, ADDED 2026-11-18 — AND THE HOLE IT CLOSES IS WHY.
#
# This gate shipped covering the insurer's NAME only, and its own header above already says the
# walk it came from "is about the insurer and the insurance line". The line half was never
# matched: both regexes above read a `name` field, and a line is `insuranceLine` /
# `insuranceLineAr` behind a different helper. So `/rfqs/[id]`'s heading interpolated the line AS
# STORED and printed «طلب عرض أسعار — Motor Fleet» to a reader who had just chosen the Arabic
# line, with this gate green beside it.
#
# A PROPERTY READ, which is what tells a render from the rest: the three dashboards and
# `/commission` hold `insuranceLine` as FILTER STATE (`insuranceLine.trim()`), with no object
# before it, and those are not renders of anything.
LINE_FIELD = re.compile(r"\.\s*(insuranceLine|insuranceLineAr)\b")
# ⛔ `key=` / `value=` ARE NOT RENDERS. `/rfqs/new`'s own `<option>` is the proof: its key and its
# value are the stored identifier, which is exactly right, and its visible label goes through
# `lineDisplayName` on the next line. A gate that flagged the attribute would be demanding the
# helper in the one place it must not be used.
LINE_ATTRIBUTE = re.compile(r"(key|value)=\{[^}]*\binsuranceLine\b")

HELPERS = (
    "insurerDisplayName(",
    "legalDisplayName(",
    "referenceDisplayName(",
    "lineDisplayName(",
)

# site -> why it is allowed to read the field directly. Checked in BOTH directions.
DECLARED: dict[str, str] = {
    os.path.join("apps", "web", "components", "insurer", "InsurerEditPanel.tsx"):
        "it POPULATES AN EDIT FORM, it does not display a name. The two inputs are the Arabic "
        "and the Latin name being typed, so each must be seeded from its OWN field -- running "
        "them through a by-language helper would put one name in both boxes and the next save "
        "would overwrite the other language with it. That is the one place where reading the "
        "field directly is not merely allowed but required.",
}

# 🔴 A LINE RENDERED AS STORED BECAUSE NO ARABIC NAME IS ON ITS WIRE. Checked in BOTH directions,
# like `DECLARED` above: a site that stops reading the field fails as stale.
#
# ⛔ THIS IS NOT AN AMNESTY AND MUST NOT BECOME ONE. Measured 2026-11-18: exactly THREE services
# send `insuranceLineAr` — `rfq.service.ts`, `policy.service.ts` and
# `insurance-program.service.ts` — so on every other payload the Arabic name is not merely
# unrendered, it was never sent. `lineDisplayName` would hand back the English string the screen
# already shows, and writing the call would claim a by-language choice this screen cannot make.
#
# ⟶ So every row here is a DEBT ON THE API rather than on the screen, and it is reported as one.
#   The day a payload gains `insuranceLineAr`, its row comes off this list and the call goes in.
LINE_DECLARED: dict[str, str] = {
    os.path.join("apps", "web", "app", "(app)", "commission", "page.tsx"):
        "a commission entry's line. `GET /commission/entries` sends no `insuranceLineAr`.",
    os.path.join("apps", "web", "app", "(app)", "dashboards", "policy", "page.tsx"):
        "the policy dashboard's cancellation rows. That aggregate sends no `insuranceLineAr`.",
    os.path.join("apps", "web", "app", "(app)", "renewal-cases", "page.tsx"):
        "a renewal case's line. `GET /renewal-cases` sends no `insuranceLineAr`.",
    os.path.join("apps", "web", "components", "recommendation", "RecommendationSection.tsx"):
        "the recommended QUOTATION's line. The quotation wire sends no `insuranceLineAr`; the "
        "RFQ beside it does, and the two are different payloads.",
    os.path.join("apps", "web", "components", "ui", "EntitySearch.tsx"):
        "the policy picker's detail line. `GET /policies/search` returns a picker projection, "
        "which carries the identifier and the name a person searches by and no Arabic line.",
}


def _tracked(root: str) -> list[str]:
    """Every TypeScript file under the scanned directories.

    TRACKED files in a git tree, because a gate that reads the working tree fails on scratch
    files and throwaway plants -- `decision-index-fit.py` records that lesson and this follows it.

    ⚠️ A TREE WITH NO `.git` IS WALKED INSTEAD, AND THAT IS NOT A FALLBACK FOR A FAILED `git`.
    If `.git` is present, `git ls-files` MUST succeed -- a transient failure there would silently
    change the population this gate measures, which is the false-green shape. The walk exists for
    the self-test's synthetic trees only, and it is what lets them stop calling `git init`.

    🔴 And they had to stop. Measured 2026-11-17: `git init` + `git add` in a temp directory fails
    intermittently on this host with `cygheap read copy failed ... Win32 error 299` -- the
    recorded memory-pressure signature -- so the self-test exited 1 on three runs in five while
    reporting 8 of 8 cases passed. A self-test that fails for a reason unrelated to what it tests
    teaches everybody to re-run it, which is how a real failure gets re-run away.
    """
    if os.path.isdir(os.path.join(root, ".git")):
        out = subprocess.run(
            ["git", "ls-files", *SCANNED],
            cwd=root, capture_output=True, text=True, check=True,
        ).stdout
        return [p for p in out.splitlines() if p.endswith((".ts", ".tsx"))]

    found: list[str] = []
    for base in SCANNED:
        for dirpath, _dirs, files in os.walk(os.path.join(root, base)):
            for name in files:
                if name.endswith((".ts", ".tsx")):
                    rel = os.path.relpath(os.path.join(dirpath, name), root)
                    found.append(rel.replace(os.sep, "/"))
    return sorted(found)


def _strip_comments(text: str) -> str:
    """Blank out comments, so a comment DISCUSSING the defect is not read as the defect.

    This file's own history is the reason: every guard here that skipped this step ended up
    refusing the paragraph that explained why it exists.

    🔴 AND THE FIRST VERSION BLANKED THE NEWLINES TOO -- `" " * len(match)` over a block comment
    turns every line of it into one long line of spaces, so the file's line NUMBERING collapses
    and the text after a long comment merges upward. It reported fourteen findings that were all
    comment prose, each at a line number that pointed somewhere else. Found by opening the first
    three it named and seeing a comment there.
    """
    def blank(m: "re.Match[str]") -> str:
        # Keep every newline; blank everything else, so offsets AND line numbers survive.
        return "".join("\n" if c == "\n" else " " for c in m.group(0))

    out = re.sub(r"/\*.*?\*/", blank, text, flags=re.S)
    out = re.sub(r"//[^\n]*", blank, out)
    return out


def measure(root: str) -> tuple[list[str], list[str], set[str], set[str]]:
    findings: list[str] = []
    lines: list[str] = []
    hit_declared: set[str] = set()
    hit_line_declared: set[str] = set()
    scanned = 0
    for rel in _tracked(root):
        path = os.path.join(root, rel)
        try:
            with open(path, "rb") as fh:
                body = fh.read().decode("utf-8")
        except OSError:
            continue
        scanned += 1
        code = _strip_comments(body)
        norm = rel.replace("/", os.sep)
        declared = norm in DECLARED
        line_declared = norm in LINE_DECLARED
        for n, line in enumerate(code.split("\n"), start=1):
            if any(h in line for h in HELPERS):
                continue
            if LINE_FIELD.search(line) and not LINE_ATTRIBUTE.search(line):
                if line_declared:
                    hit_line_declared.add(norm)
                else:
                    findings.append(
                        f"{rel}:{n}: renders an insurance line as STORED -- call "
                        f"lineDisplayName(row, language) instead, or a reader in Arabic meets "
                        f"the English string on a line they chose in Arabic. If the payload "
                        f"carries no `insuranceLineAr`, the fix is on the API and the site "
                        f"belongs in LINE_DECLARED with that reason."
                    )
            if INSURER_FIELD.search(line):
                if declared:
                    hit_declared.add(norm)
                    continue
                findings.append(
                    f"{rel}:{n}: reads an insurer's name field directly -- call "
                    f"insurerDisplayName(insurer, language) instead, or a reader in Arabic "
                    f"gets the Latin name (or, if the payload is unresolved, a BLANK cell)"
                )
            elif LEGAL_FIELD.search(line) and INSURER_CONTEXT.search(line):
                if declared:
                    hit_declared.add(norm)
                    continue
                findings.append(
                    f"{rel}:{n}: renders legalName/legalNameAr directly -- call "
                    f"legalDisplayName(row, language) instead"
                )
    lines.append(f"  files scanned in apps/web/app + components   {scanned}")
    lines.append(f"  declared both-scripts screens, each asserted  {len(DECLARED)}")
    lines.append(f"  lines with no Arabic ON THE WIRE, declared    {len(LINE_DECLARED)}")
    lines.append(f"  hand-written name/line reads (budget 0)       {len(findings)}")
    return findings, lines, hit_declared, hit_line_declared


def _is_this_repo(root: str) -> bool:
    """A tree that actually holds this product, rather than a synthetic self-test one.

    The staleness check below asserts against the REAL declared files, so on a throwaway tree
    that holds none of them every declaration would read as stale on every run and the clean
    case could never pass. The plants that need the check create this marker, so it is PROVEN
    live rather than switched off -- the same device `decision-index-fit.py` uses, and for the
    same reason.
    """
    return os.path.isdir(os.path.join(root, "apps", "api", "src", "modules"))


def run(root: str, check: bool) -> int:
    findings, lines, hit, hit_line = measure(root)
    errors = list(findings)
    # The second direction: a declaration whose site no longer reads the field is stale.
    for rel in sorted(DECLARED if _is_this_repo(root) else {}):
        if rel not in hit:
            errors.append(
                f"{rel} is declared as a both-scripts screen but no longer reads the name "
                f"field -- the declaration is STALE, remove it rather than leaving an "
                f"exemption nothing uses"
            )
    for rel in sorted(LINE_DECLARED if _is_this_repo(root) else {}):
        if rel not in hit_line:
            errors.append(
                f"{rel} is declared as rendering a line with no Arabic on its wire but no "
                f"longer reads the field -- the declaration is STALE, remove it rather than "
                f"leaving an exemption nothing uses"
            )
    print()
    print("  bilingual name rendering")
    print()
    for ln in lines:
        print(ln)
    print()
    if errors:
        for e in errors:
            print(f"  ERROR  {e}")
        print()
        print(f"  {len(errors)} error(s)")
        return 1 if check else 0
    print("  ok     every rendered insurer name AND insurance line goes through the by-language")
    print("         helper, and every declared site still is one")
    return 0


def _self_test() -> int:
    import shutil
    import tempfile

    def build(tmp):
        """A synthetic tree with NO `.git` — see `_tracked` for why that is the point.

        ⛔ Do not reinstate `git init` + `git add` here. They made this self-test fail
        intermittently for a reason that had nothing to do with any case it checks.
        """
        d = os.path.join(tmp, "apps", "web", "app", "(app)", "x")
        os.makedirs(d, exist_ok=True)
        os.makedirs(os.path.join(tmp, "apps", "web", "components"), exist_ok=True)
        with open(os.path.join(d, "page.tsx"), "wb") as fh:
            fh.write(b"const a = insurerDisplayName(q.insurer, language);\n")

    plants = [
        ("clean tree", None, None),
        ("a screen reading insurer.name directly",
         lambda t: open(os.path.join(t, "apps", "web", "app", "(app)", "x", "p2.tsx"), "wb")
         .write(b"<bdi>{submission.insurer.name}</bdi>\n"),
         "reads an insurer's name field directly"),
        ("a screen reading insurer?.nameAr directly",
         lambda t: open(os.path.join(t, "apps", "web", "components", "C.tsx"), "wb")
         .write(b"const x = row.insurer?.nameAr;\n"),
         "reads an insurer's name field directly"),
        ("an INSURER row rendering legalName directly",
         lambda t: open(os.path.join(t, "apps", "web", "components", "L.tsx"), "wb")
         .write(b"<span>{insurerMaster.legalName}</span>\n"),
         "renders legalName/legalNameAr directly"),
        # The scope line, PROVEN rather than asserted: the identical shape on a CUSTOMER is out
        # of this gate's subject and must not be reported, or the gate quietly becomes a rule
        # the owner never made.
        ("the same shape on a CUSTOMER is NOT a finding",
         lambda t: open(os.path.join(t, "apps", "web", "components", "Cust.tsx"), "wb")
         .write(b"<span>{customer.legalName}</span>\n"),
         None),
        # 🔴 THE LINE HALF, added 2026-11-18. The first four prove the matcher SEES the shape;
        # the three after them keep it from seeing shapes that are not it.
        ("a heading interpolating the line as stored",
         lambda t: open(os.path.join(t, "apps", "web", "app", "(app)", "x", "h.tsx"), "wb")
         .write(b"<h1>{t('rfqDetailHeading', { line: rfq.insuranceLine })}</h1>\n"),
         "renders an insurance line as STORED"),
        ("a table cell rendering the line as stored",
         lambda t: open(os.path.join(t, "apps", "web", "components", "T.tsx"), "wb")
         .write(b"<Td>{r.insuranceLine}</Td>\n"),
         "renders an insurance line as STORED"),
        ("reading insuranceLineAr by hand is the same finding",
         lambda t: open(os.path.join(t, "apps", "web", "components", "A.tsx"), "wb")
         .write(b"<bdi>{row.insuranceLineAr}</bdi>\n"),
         "renders an insurance line as STORED"),
        # ⛔ The three NON-findings, and each is a shape that really ships.
        ("a `value={...insuranceLine}` attribute is NOT a finding",
         lambda t: open(os.path.join(t, "apps", "web", "components", "O.tsx"), "wb")
         .write(b"<option key={l.insuranceLine} value={l.insuranceLine}>\n"),
         None),
        ("filter STATE with no object before it is NOT a finding",
         lambda t: open(os.path.join(t, "apps", "web", "components", "F.tsx"), "wb")
         .write(b"const q = { insuranceLine: insuranceLine.trim() || undefined };\n"),
         None),
        ("a line already going through lineDisplayName is NOT a finding",
         lambda t: open(os.path.join(t, "apps", "web", "components", "G.tsx"), "wb")
         .write(b"<bdi>{lineDisplayName(rfq, language)}</bdi>\n"),
         None),
        # The blindness every guard here has committed at least once.
        ("a COMMENT discussing insurer.name is NOT a finding",
         lambda t: open(os.path.join(t, "apps", "web", "components", "K.tsx"), "wb")
         .write(b"// never read insurer.name here\n/* nor .legalName */\n"),
         None),
        ("a declared site that no longer reads the field",
         lambda t: (os.makedirs(os.path.join(t, "apps", "api", "src", "modules"),
                                exist_ok=True),
                    DECLARED.clear(),
                    DECLARED.__setitem__(os.path.join("apps", "web", "components", "Ghost.tsx"),
                                         "a reason")),
         "the declaration is STALE"),
        # And the marker itself is PROVEN to be what switches the check on: a repo-shaped tree
        # whose declared sites are all absent must report them stale, not pass quietly.
        ("a repo-shaped tree where every declared site is gone",
         lambda t: os.makedirs(os.path.join(t, "apps", "api", "src", "modules"),
                               exist_ok=True),
         "the declaration is STALE"),
    ]
    declared_before = dict(DECLARED)
    line_declared_before = dict(LINE_DECLARED)
    passed = failed = 0
    for label, mutate, needle in plants:
        tmp = tempfile.mkdtemp(prefix="bilingual-names-")
        try:
            build(tmp)
            if mutate:
                mutate(tmp)
            errs, _, hit, hit_line = measure(tmp)
            for rel in sorted(DECLARED if _is_this_repo(tmp) else {}):
                if rel not in hit:
                    errs.append(f"{rel} ... the declaration is STALE")
            for rel in sorted(LINE_DECLARED if _is_this_repo(tmp) else {}):
                if rel not in hit_line:
                    errs.append(f"{rel} ... the declaration is STALE")
            if needle is None:
                ok = not errs
                detail = "no errors" if ok else f"UNEXPECTED {errs[:1]}"
            else:
                ok = any(needle in e for e in errs)
                detail = "named it" if ok else f"DID NOT NAME IT -- {errs or '[none]'}"
            print(f"  {'ok  ' if ok else 'FAIL'}  {label:<52} {detail}")
            passed += ok
            failed += not ok
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
            DECLARED.clear()
            DECLARED.update(declared_before)
            LINE_DECLARED.clear()
            LINE_DECLARED.update(line_declared_before)
    assert DECLARED == declared_before, "the self-test left DECLARED mutated"
    assert LINE_DECLARED == line_declared_before, (
        "the self-test left LINE_DECLARED mutated"
    )
    print(f"\n  self-test: {passed} passed, {failed} failed\n")
    return 1 if failed else 0


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(_self_test())
    sys.exit(run(ROOT, "--check" in sys.argv))
