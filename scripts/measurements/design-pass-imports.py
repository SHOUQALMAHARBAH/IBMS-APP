#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Add the `components/ui` imports a converted screen now needs, and drop the names it no longer does.

RUN IT AFTER `design-pass-sections.py`, which deliberately does not touch imports: a converter that
rewrites markup AND imports in one pass has two ways to go wrong per file and only one of them is
visible, because an unused import is a lint WARNING while a missing one is a compile ERROR.

WHAT IT ADDS is measured from the file's own markup — the components actually used, not a fixed
list — so a screen with no empty state does not acquire an unused `EmptyState`.

WHAT IT REMOVES is conditional on the same measurement with COMMENTS STRIPPED: a name that appears
exactly once outside comments is a name only its own declaration mentions. That matters because a
check reading TEXT cannot tell a comment from code, and a comment quoting a constant has already
defeated this test once.
"""
from __future__ import annotations

import pathlib
import re
import sys

NL = "\n"
COMPONENTS = ("Badge", "Button", "Card", "EmptyState", "ErrorState", "Field", "FilterBar",
              "Icon", "KeyValue", "Note", "PageHeader", "Select", "SkeletonList", "Table",
              "Td", "TextArea", "TextInput", "Th", "Tile", "Tiles", "Tr")
UI_BLOCK = re.compile(
    r"import \{\n((?:\s+\w+,\n)+)\} from ['\"][^'\"]*/components/ui['\"];"
)

DEAD = ("errorStyle", "cellStyle", "cell", "head", "bodyCell", "headCell", "sectionStyle",
        "pageStyle")


def convert(path: pathlib.Path) -> None:
    src = path.read_text(encoding="utf-8")
    t = src
    # DERIVED FROM THE PATH, and the arithmetic is worth writing down: from
    # `apps/web/app/(app)/<screen>/page.tsx` the target is `apps/web/components/ui`, so the
    # climb is one level per path segment above `apps/web` — five slashes means three `..`.
    depth = path.as_posix().count("/") - 2
    prefix = "/".join([".."] * depth)

    # MERGE FIRST, SO THE TOOL IS IDEMPOTENT. Running it twice — or running it after a sibling tool
    # that already added a block — otherwise leaves two `components/ui` imports, and every name the
    # two share becomes `TS2300: Duplicate identifier`. One block, in the position of the first.
    blocks = list(UI_BLOCK.finditer(t))
    if len(blocks) > 1:
        names = sorted({n for b in blocks for n in re.findall(r"\w+", b.group(1))})
        merged = "import {\n%s\n} from '%s/components/ui';" % (
            "\n".join("  %s," % n for n in names), prefix)
        for b in reversed(blocks[1:]):
            t = t[: b.start()] + t[b.end() :].lstrip("\n")
        first = UI_BLOCK.search(t)
        t = t[: first.start()] + merged + t[first.end() :]

    body = re.sub(r"/\*.*?\*/|//[^\n]*", "", t, flags=re.S)
    used = [c for c in COMPONENTS if re.search(r"<%s[ />\n]" % c, body)]
    already = UI_BLOCK.search(t)
    have = set(re.findall(r"\w+", already.group(1))) if already else set()
    missing = [c for c in used if c not in have]

    if missing:
        names = sorted(have | set(missing))
        block = "import {\n%s\n} from '%s/components/ui';" % (
            "\n".join("  %s," % n for n in names), prefix)
        if already:
            t = t[:already.start()] + block + t[already.end():]
        else:
            # Before the first import that is not a React one, so the block sits with the rest.
            m = re.search(r"^import .*$", t, re.M)
            if m is None:
                sys.exit("REFUSED %s: no import to anchor on" % path)
            t = t[:m.start()] + block + "\n" + t[m.start():]

    # NAMES NOTHING READS ANY MORE, AND THE SWEEP ITERATES — which is not tidiness.
    #
    # These declarations depend on each other: `const head = { ...cell, … }`. Removing `head`
    # is what MAKES `cell` unread, so a single pass clears the first and leaves the second,
    # and lint reports a warning for a constant that only became dead in the pass that just ran.
    # Four more fell out on the second and third iterations here.
    #
    # Comments are stripped before counting: a check that reads TEXT cannot tell a comment from
    # code, and a comment quoting a constant's name has already defeated this test once.
    for _ in range(5):
        before = t
        body = re.sub(r"/\*.*?\*/|//[^\n]*", "", t, flags=re.S)
        names = list(DEAD) + re.findall(r"const (\w+): CSSProperties =", t)
        for name in names:
            if len(re.findall(r"\b%s\b" % re.escape(name), body)) != 1:
                continue
            for pattern in (r"^\s*%s,\n" % name,
                            r"^import \{ %s \} from [^\n]*\n" % name,
                            r"^const %s: CSSProperties = \{[^{}]*\};\n" % name):
                new = re.sub(pattern, "", t, count=1, flags=re.M)
                if new != t:
                    t = new
                    break
        if t == before:
            break

    if not re.search(r"CSSProperties", re.sub(r"^import[^\n]*\n", "", t, flags=re.M)):
        t = re.sub(r"import type \{ CSSProperties \} from ['\"]react['\"];\n", "", t)
        t = t.replace("import { type CSSProperties, ", "import { ")

    if t == src:
        print("   %s unchanged" % path.name)
        return
    path.write_text(t, encoding="utf-8", newline=NL)
    print("ok %-40s +%s" % (path.as_posix().replace("apps/web/app/(app)/", ""),
                            ",".join(missing) or "nothing"))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: design-pass-imports.py <screen> [<screen> ...]")
    for screen in sys.argv[1:]:
        convert(pathlib.Path("apps/web/app/(app)/%s/page.tsx" % screen))
