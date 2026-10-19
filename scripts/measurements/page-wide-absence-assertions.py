"""How many PAGE-WIDE absence assertions exist in the web e2e suite today?

The question decides the shape of the fix. If there are two, a hard ban is free. If there
are eighty, a ban is a red build and the honest answer is a helper plus a declared
remainder — and the owner asked to be told which.

Written with the editor: the patterns below carry regex escapes, and on this host a
heredoc eats them (a leading word-boundary escape has arrived as a literal 0x08 before,
and the pattern then matched nothing while reading correctly).
"""

import io
import os
import re

E2E = os.path.join("apps", "web", "e2e")

# An ABSENCE assertion: the matcher says "this is not there".
ABSENT_MATCHER = r"\.(toHaveCount\(\s*0\s*\)|toBeHidden\(\))"
NOT_VISIBLE = r"\.not\.toBeVisible\(\)"

files = []
for root, _dirs, names in os.walk(E2E):
    for n in names:
        if n.endswith(".ts"):
            files.append(os.path.join(root, n))

assert len(files) > 100, "found only %d e2e files, which is not a clean result" % len(files)

page_wide = []
scoped = []
string_level = []
helper = []

for path in sorted(files):
    src = io.open(path, encoding="utf-8").read()
    # Flatten so a multi-line `expect(\n  page.getByText(...)\n).toHaveCount(0)` is still seen as
    # one assertion. Collapsing whitespace is the only way to read these reliably: prettier wraps
    # most of them.
    flat = re.sub(r"\s+", " ", src)

    for m in re.finditer(r"expect\(\s*([^;]{0,400}?)\s*\)" + ABSENT_MATCHER, flat):
        subject = m.group(1)
        entry = (path, subject[:90])
        if re.search(r"\bpage\s*\.", subject) and not re.search(
            r"\bpage\s*\.\s*locator\(\s*['\"`]main", subject
        ):
            page_wide.append(entry)
        else:
            scoped.append(entry)

    for m in re.finditer(r"expect\(\s*([^;]{0,400}?)\s*\)" + NOT_VISIBLE, flat):
        subject = m.group(1)
        entry = (path, subject[:90])
        if re.search(r"\bpage\s*\.", subject):
            page_wide.append(entry)
        else:
            scoped.append(entry)

    string_level += [
        (path, m.group(1)[:70])
        for m in re.finditer(r"expect\(\s*([^;]{0,200}?)\s*\)\.not\.toContain\(", flat)
    ]
    helper += [
        (path, m.group(0)[:70]) for m in re.finditer(r"expectNone\(", flat)
    ]

print("e2e files scanned: %d" % len(files))
print()
print("ABSENCE ASSERTIONS, by shape:")
print("  page-wide (the trap)          : %d" % len(page_wide))
print("  already scoped                : %d" % len(scoped))
print("  string-level (.not.toContain) : %d" % len(string_level))
print("  via expectNone(target,anchor)  : %d" % len(helper))
print()
print("=== THE PAGE-WIDE ONES, by file ===")
by_file = {}
for path, subject in page_wide:
    by_file.setdefault(path, []).append(subject)
for path in sorted(by_file):
    print("  %-58s %d" % (path.replace(os.sep, "/").replace("apps/web/e2e/", ""), len(by_file[path])))
print()
print("=== a sample of the subjects, so the shapes are visible rather than counted ===")
for path, subject in page_wide[:14]:
    print("  %-34s %s" % (os.path.basename(path), subject))
