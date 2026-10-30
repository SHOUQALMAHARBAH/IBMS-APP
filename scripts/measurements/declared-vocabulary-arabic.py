# -*- coding: utf-8 -*-
"""
OWNER DECISION 59's PRE-MEASUREMENT — which of the twelve raw-rendered vocabulary values
ALREADY have an Arabic word somewhere in this product.

The standing rule is that a word is SLICED from a string already shipping or it is hers.
So before anything reaches her, the question is how many of the twelve are already
answered by the product — and the honest expectation is "several", because this product
has shipped SLA work and «أيام عمل» in particular is unlikely to be absent.

WHAT THIS DOES AND WHAT IT CANNOT DO. It cannot derive "which Arabic word means
BUSINESS_DAYS" — that is a reading, not a match. So it carries, per value, the CANDIDATE
Arabic forms a reader would look for, finds every shipping string containing one, and
prints the key it lives in. **A row is a candidate to read, not a verdict.** The
judgement — does this shipping string actually mean this value — stays with a person,
and the printed key is what makes that judgement cheap.

Run:  PYTHONIOENCODING=utf-8 python scripts/measurements/declared-vocabulary-arabic.py
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
I18N = os.path.join(ROOT, "apps", "web", "lib", "i18n")

# value -> (list, candidate Arabic forms to look for)
#
# The candidates are deliberately GENEROUS: a false candidate costs one line of reading,
# a missing one costs an Arabic word being written that already shipped.
VALUES = [
    ("pending", "screening-match status", ["قيد الانتظار", "لم يُبَتَّ", "معلّق", "معلق", "بانتظار"]),
    ("confirmed", "screening-match status", ["مؤكَّد", "مؤكد", "تأكيد"]),
    ("cleared", "screening-match status", ["مُستبعَد", "مستبعد", "استبعاد", "مُستثنى"]),
    ("MINUTES", "SLA duration unit", ["دقيقة", "دقائق"]),
    ("HOURS", "SLA duration unit", ["ساعة", "ساعات", "ساعتان"]),
    ("BUSINESS_DAYS", "SLA duration unit", ["أيام عمل", "أيام العمل", "يوم عمل", "أيّام عمل"]),
    ("CALENDAR_DAYS", "SLA duration unit", ["أيام تقويمية", "تقويمي", "ميلادي", "يوماً", "أيام"]),
    ("MONTHS", "SLA duration unit", ["شهر", "أشهر", "شهراً"]),
    ("INTERNAL_POLICY", "non-regulatory SLA source", ["سياسة داخلية", "سياسة المكتب", "داخلي"]),
    ("CONTRACTUAL", "non-regulatory SLA source", ["تعاقدي", "تعاقدية", "العقد", "عقدي"]),
    ("OPERATIONAL", "non-regulatory SLA source", ["تشغيلي", "تشغيلية", "تشغيل"]),
    ("OTHER", "non-regulatory SLA source", ["أخرى", "آخر", "غير ذلك", "أخرى/"]),
]


def arabic_strings():
    """Every Arabic-bearing string literal in the i18n tree, with its key and file."""
    out = []
    pat = re.compile(r"^\s*'?([A-Za-z0-9_:.\-]+)'?\s*:\s*(['\"])(.*?)\2\s*,?\s*$")
    for base, _dirs, files in os.walk(I18N):
        for f in sorted(files):
            if not f.endswith(".ts") or f.endswith(".test.ts"):
                continue
            p = os.path.join(base, f)
            for i, line in enumerate(io.open(p, encoding="utf-8").read().split("\n"), 1):
                m = pat.match(line)
                if not m:
                    continue
                val = m.group(3)
                if not any("؀" <= ch <= "ۿ" for ch in val):
                    continue
                out.append((os.path.relpath(p, ROOT), i, m.group(1), val))
    return out


def main():
    strings = arabic_strings()
    # A FLOOR. Every row below is satisfied by a parser that read nothing, and this
    # dictionary is thousands of Arabic strings — a small number here means the matcher
    # broke, not that the product has no Arabic.
    if len(strings) < 500:
        sys.stderr.write(
            "FAIL: only %d Arabic string(s) parsed out of the i18n tree — the matcher "
            "broke, which reads exactly like a product with no Arabic in it.\n" % len(strings)
        )
        return 1
    print("Arabic strings parsed from the i18n tree: %d" % len(strings))
    print()

    ships, owed = [], []
    for value, kind, candidates in VALUES:
        hits = []
        for rel, line, key, val in strings:
            for c in candidates:
                if c in val:
                    hits.append((key, c, val, rel, line))
                    break
        print("%-18s %-26s %d candidate string(s)" % (value, kind, len(hits)))
        for key, c, val, rel, line in hits[:6]:
            short = val if len(val) <= 64 else val[:61] + "…"
            print("      %-34s «%s»  in  %s" % (key, short, c))
        if len(hits) > 6:
            print("      … and %d more" % (len(hits) - 6))
        (ships if hits else owed).append(value)

    print()
    print("CANDIDATES FOUND for %d of %d: %s" % (len(ships), len(VALUES), ", ".join(ships)))
    print("NO CANDIDATE AT ALL for %d: %s" % (len(owed), ", ".join(owed) or "none"))
    print()
    print("READ THE ROWS. A candidate is a string CONTAINING a likely word, not a word")
    print("that means this value — `أيام` appears in «أيام عمل» and in «١٥ يوماً» and the")
    print("two are different claims. Where a shipping string genuinely means the value,")
    print("the word is SLICED from it; only the real remainder is the owner's.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
