# -*- coding: utf-8 -*-
"""
"Loading..." left on screen for ever by a list that loaded and came back EMPTY.

Her walk, on /internal-audit-findings: «ما بتظهر شي الي، بس بكون مكتوب عليها
جارِ التحميل». On /documents: «جارٍ التحميل…» and it never resolves.

Both loaded fine. The shape is:

    {rows && rows.length > 0 ? (
       <table/>
    ) : loadError ? null : (
       <p>{t('...Loading')}</p>      <-- an EMPTY array lands HERE
    )}

So the fallback MEANS "nothing recorded yet" and SAYS "still fetching", and the
directive's three distinct states collapse into two. On
/internal-audit-findings there is an empty state as well, two lines above — so
an empty list renders the empty state AND the loading line together, which is
why a reader concludes the screen never finished. The comment beside that very
branch says it is guarded "so an error and a Loading... line never appear
together": the ERROR coexistence was thought about and the EMPTY one was not.

HOW IT IS DETECTED
------------------
For each `: loadError ? null : (` the condition of the ternary it belongs to is
recovered by walking BACKWARDS to the `(` that opens the true branch, then to
the `?` before it. The condition is a DEFECT when an empty collection makes it
false — it tests `.length`, `.length > 0`, `.length !== 0` or `?.length`.

A condition that tests only the VARIABLE (`rows ? ... : loadError ? null : ...`)
is CORRECT and is counted separately: `null` means fetching, `[]` is truthy and
falls into the true branch, where an empty table or an empty state belongs.

TWO THINGS THIS SCRIPT LEARNED ABOUT ITSELF, BOTH WORTH KEEPING
---------------------------------------------------------------
1. The first backward walk treated the opening `(` of the true branch as a
   balancing paren, so it could never recognise an opener and reported ALL 48
   sites as unreadable. It printed that honestly rather than classifying them,
   which is the only reason the bug was visible. Walking backwards, the opener
   is the `(` that brings the unmatched-`)` count from 1 to 0.
2. The corrected version then reported 0/0/0 — because it had been run from a
   directory where `apps/web/app` does not exist, so it walked no files at all.
   A run that finds nothing because it scanned nothing is indistinguishable from
   a clean tree, which is why the floor below EXITS instead of printing a zero.
"""
import io
import os
import re
import sys

ROOT = "apps/web/app"
NEEDLE = ": loadError ? null : ("
LENGTH_TEST = re.compile(r"\.length|\?\.length")
# This tree has ~100 `page.tsx` files. Well below that means the walk is in the
# wrong place, not that the tree is clean.
MIN_FILES = 80

defects, correct, unreadable = [], [], []
scanned = 0

for dirpath, _dirs, names in os.walk(ROOT):
    for n in names:
        if n != "page.tsx":
            continue
        path = os.path.join(dirpath, n)
        src = io.open(path, encoding="utf-8").read()
        scanned += 1
        rel = path.replace(os.sep, "/")
        start = 0
        while True:
            at = src.find(NEEDLE, start)
            if at < 0:
                break
            start = at + 1
            line = src[:at].count("\n") + 1
            depth = 0
            i = at
            opener = -1
            while i > 0:
                i -= 1
                c = src[i]
                if c == ")":
                    depth += 1
                elif c == "(":
                    depth -= 1
                    if depth == 0:
                        before = src[:i].rstrip()
                        if before.endswith("?"):
                            opener = len(before) - 1
                        break
            if opener < 0:
                unreadable.append((rel, line, ""))
                continue
            brace = src.rfind("{", 0, opener)
            cond = " ".join(src[brace + 1:opener].split())
            row = (rel, line, cond)
            (defects if LENGTH_TEST.search(cond) else correct).append(row)

if scanned < MIN_FILES:
    sys.stderr.write(
        "REFUSING: walked only %d page.tsx file(s); this tree has ~100.\n"
        "A run that finds nothing because it scanned nothing reads exactly like\n"
        "a clean tree. Run this from the repository root.\n" % scanned
    )
    raise SystemExit(2)

print("scanned %d page.tsx file(s)" % scanned)
print()
print("=== (1) REACHED BY AN EMPTY LIST - the defect: %d ===" % len(defects))
for rel, line, cond in defects:
    print("  %s:%d" % (rel, line))
    print("        condition: %s" % cond[:110])
print()
print("=== (2) tests the VARIABLE, so an empty list is handled: %d ===" % len(correct))
for rel, line, cond in correct:
    print("  %-62s %s" % ("%s:%d" % (rel, line), cond[:60]))
print()
print("=== (3) condition unreadable - reported, never assumed: %d ===" % len(unreadable))
for rel, line, _ in unreadable:
    print("  %s:%d" % (rel, line))
