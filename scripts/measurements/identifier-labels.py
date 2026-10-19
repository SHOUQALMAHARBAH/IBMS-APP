"""LABELS THAT NAME A COLUMN INSTEAD OF SAYING WHAT THE FIELD IS FOR.

## THE RULING THIS MEASURES

Decision 21, the owner's criterion: a label says what the thing is FOR, or what data will be
IN it, and is not a transcription of what the broker calls it or how he pronounces it. The
hiding of displayed ids became a BUILD RULE rather than a backlog row — every new screen
from module 1 onward shows a name, not an id — and this is the half of that rule a script
can police.

## WHAT COUNTS, AND WHY IT IS CLASSIFIED BY USAGE

The defect is a user-facing string whose whole content is a NOUN plus "id": "Branch ID"
tells a person the column's name, "Show one branch only" tells them what the field does.

But a matcher on the TEXT alone over-reaches, and this one did, twice:

  * `pcInsurerIdLabel` and `pcOwnerIdLabel` are rendered inside `<th>` — table column
    HEADINGS, which name the column by design — and their keys contain neither `Col` nor
    `Aria`, so a key-name filter missed them.
  * `rcOwnerUserIdLabel` is rendered by NO screen.

So each candidate is classified by reading the screens: inside `<th>` is a HEADING, inside
`<label>` is a PROMPT, rendered nowhere is DEAD. The ruling is about a field a person fills
in or reads as a prompt, so PROMPTS are what the budget polices. The other two kinds are
PRINTED rather than filtered away, because an exclusion nobody can see is an exclusion
nobody can argue with.

## A REAL-WORLD IDENTIFIER IS NOT THE DEFECT

"National ID" SATISFIES the criterion: it says exactly what data will be in the field,
because a national ID is a document in somebody's hand. "Owner user ID" does not — it names
our surrogate key and tells a person neither whose nor what for. The rule is not "no label
may contain the word id"; it is "no label may offer OUR uuid's column name as a prompt".

## THE DECLARED REMAINDER

`/audit-trail`'s two REQUIRED fields and its browse filter are POLYMORPHIC — `wfEntityId`
addresses any of fifteen workflow entities and `documentId` a `Document` with no search
route — so there is nothing single the label could say the field is FOR beyond naming the
id, which is why both were already recorded as un-pickerable. They are declared BY NAME, not
converted halfway, and they get their own decision if and when those screens are rebuilt.

Written with the editor, never a heredoc: the patterns carry regex escapes and this host eats
backslashes in one. Output is ASCII-only on purpose — this console is cp1252, and printing an
Arabic value raises rather than prints.
"""

import io
import os
import re
import sys

DICTS = os.path.join("apps", "web", "lib", "i18n", "translations")
APP = os.path.join("apps", "web", "app", "(app)")

NAMES_A_COLUMN = re.compile(r"^[A-Z][A-Za-z /()-]{0,40}\b(id|ID|Id)\s*$")

EXCLUDED_SUFFIX = ("Aria", "Button")
EXCLUDED_PREFIX = ("nav",)
REAL_WORLD = ("national",)

DECLARED_POLYMORPHIC = {
    "atWorkflowEntityIdLabel",
    "atDocumentIdLabel",
    "atEntityIdLabel",
}

# PROMPTS only. Must come DOWN, never up. At 0 this is a flat ban with no switch to throw.
BUDGET = 0


def screens():
    out = {}
    for root, _dirs, files in os.walk(APP):
        if "page.tsx" in files:
            rel = os.path.relpath(root, APP).replace(os.sep, "/")
            out[rel] = io.open(os.path.join(root, "page.tsx"), encoding="utf-8").read()
    return out


def classify(key, pages):
    """HEADING / PROMPT / DEAD / OTHER, from how the screens render it."""
    kinds = set()
    for src in pages.values():
        for m in re.finditer(r"t\('" + key + r"'\)", src):
            before = src[max(0, m.start() - 400) : m.start()]
            tags = re.findall(r"<(th|label|legend|option|td|h[1-6])\b", before)
            kinds.add(tags[-1] if tags else "?")
    if not kinds:
        return "DEAD"
    if "label" in kinds:
        return "PROMPT"
    if kinds == {"th"}:
        return "HEADING"
    return "OTHER"


def main():
    files = sorted(f for f in os.listdir(DICTS) if f.endswith(".ts"))
    if len(files) < 15:
        print("identifier-labels: found only %d dictionaries, not a clean result" % len(files))
        return 1

    pages = screens()
    if len(pages) < 90:
        print("identifier-labels: found only %d screens, not a clean result" % len(pages))
        return 1

    hits = {}
    values_seen = 0
    for f in files:
        body = io.open(os.path.join(DICTS, f), encoding="utf-8").read()
        for m in re.finditer(r"^\s*([A-Za-z][A-Za-z0-9]*):\s*'([^']*)',", body, re.M):
            key, value = m.group(1), m.group(2)
            values_seen += 1
            if key.endswith(EXCLUDED_SUFFIX) or key.startswith(EXCLUDED_PREFIX):
                continue
            if any(w in value.lower() for w in REAL_WORLD):
                continue
            if not NAMES_A_COLUMN.match(value):
                continue
            hits.setdefault(key, (f, value))

    if values_seen < 2000:
        print(
            "identifier-labels: parsed only %d values, so a clean result cannot be trusted"
            % values_seen
        )
        return 1

    buckets = {"PROMPT": [], "HEADING": [], "DEAD": [], "OTHER": [], "DECLARED": []}
    for key in sorted(hits):
        f, value = hits[key]
        kind = "DECLARED" if key in DECLARED_POLYMORPHIC else classify(key, pages)
        buckets[kind].append((key, value, f))

    print("dictionary values parsed            %5d" % values_seen)
    print("screens read                        %5d" % len(pages))
    print("labels naming a column              %5d" % len(hits))
    for kind in ("PROMPT", "DECLARED", "HEADING", "OTHER", "DEAD"):
        print("  %-32s %5d" % (kind, len(buckets[kind])))
    print()
    for kind, note in (
        ("PROMPT", "THE BUDGET — a field a person fills in, naming our column"),
        ("DECLARED", "polymorphic, by name, not converted halfway"),
        ("HEADING", "a table column heading names the column by design — not counted"),
        ("OTHER", "a heading or option, not a prompt — not counted"),
        ("DEAD", "rendered by no screen — not counted"),
    ):
        if not buckets[kind]:
            continue
        print("%s — %s:" % (kind, note))
        for key, value, f in buckets[kind]:
            print("    %-30s %-34s %s" % (key, value, f))
        print()

    if "--check" not in sys.argv:
        return 0

    n = len(buckets["PROMPT"])
    if n > BUDGET:
        print(
            "identifier-labels: FAILED - %d PROMPT label(s) name a column against a budget of %d."
            % (n, BUDGET)
        )
        print("A label says what the field is FOR, or what data will be in it - never the column.")
        print("'Branch ID' tells a person nothing they can act on; 'Show one branch only' does.")
        print("Do NOT raise the budget, and do NOT add a row to DECLARED_POLYMORPHIC to absorb one:")
        print("that list is for a field with no single thing to name, and it needs a decision.")
        return 1
    if n < BUDGET:
        print("identifier-labels: FAILED - only %d remain, so lower BUDGET to %d." % (n, n))
        print("This half is what stops a ratchet becoming a ceiling.")
        return 1
    print("identifier-labels: no PROMPT names a column. Budget %d." % BUDGET)
    return 0


if __name__ == "__main__":
    sys.exit(main())
