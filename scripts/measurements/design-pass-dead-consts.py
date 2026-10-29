# -*- coding: utf-8 -*-
"""Style constants nothing reads any more, once their cells became components.

AN UNREAD CONSTANT IS A LINT WARNING RATHER THAN AN ERROR, so it ships quietly — and a screen that
still DECLARES a cell style is a screen the next reader will assume still hand-rolls its table.

REMOVAL IS CONDITIONAL ON A MEASUREMENT, never on the name: the identifier has to appear exactly
once in the whole file, which is its own declaration. That is what stops it deleting a constant
another constant spreads into (`const head = { ...cell, … }`), where the name appears twice and the
declaration is still load-bearing.
"""
import io
import pathlib
import re
import sys

NL = "\n"
DECL = re.compile(r"^const (\w+): CSSProperties = \{[^{}]*\};\n", re.M)

removed = 0
touched = []
for path in sorted(pathlib.Path("apps/web/app").rglob("page.tsx")):
    src = path.read_text(encoding="utf-8")
    out = src
    # COMMENTS ARE STRIPPED BEFORE COUNTING, and this is the recorded class recurring inside my
    # own tool: a check that reads TEXT cannot tell a comment from code. `claims-analytics` kept an
    # unread `cellStyle` because a comment I had just written QUOTED the name — the sweep counted
    # two occurrences and spared the declaration. `check:css-properties` carries the same limit and
    # the pilot reported it rather than fixing it there, for the opposite reason: stripping comments
    # would blind that gate to a reference inside a commented-out block, which is a real thing it
    # needs to see. Here there is no such case — a style constant named only in prose is unread.
    body = re.sub(r"/\*.*?\*/|//[^\n]*", "", src, flags=re.S)
    for m in DECL.finditer(src):
        name = m.group(1)
        if len(re.findall(r"\b%s\b" % re.escape(name), body)) == 1:
            out = out.replace(m.group(0), "", 1)
            removed += 1
    if out == src:
        continue
    # `CSSProperties` goes with the last of them, and only if nothing else needs it.
    if not re.search(r"CSSProperties", re.sub(r"^import[^\n]*\n", "", out, flags=re.M)):
        out = re.sub(r"import type \{ CSSProperties \} from ['\"]react['\"];\n", "", out)
        out = out.replace("import { type CSSProperties, ", "import { ")
        out = re.sub(r"import \{ type CSSProperties \} from ['\"]react['\"];\n", "", out)
    path.write_text(out, encoding="utf-8", newline=NL)
    touched.append(path.as_posix().replace("apps/web/app/(app)/", ""))

if removed == 0:
    sys.stderr.write("REFUSED: nothing matched — the declaration shape has changed%s" % NL)
    raise SystemExit(1)
print("removed %d unread style constant(s) across %d file(s)" % (removed, len(touched)))
for f in touched:
    print("   %s" % f)
