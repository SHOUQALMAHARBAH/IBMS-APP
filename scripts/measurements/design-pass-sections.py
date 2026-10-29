#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A screen's `<section>` becomes a `Card` with a title, and its tables become `Table`.

WHY THIS IS A SECOND TOOL. `design-pass-convert.py` handles the shape a LIST screen shares — one
page wrapper, one heading, one table, two error paragraphs. The crowded screens §4(c) is about are
a different shape: SIX `<section>`s on one page, each a bare `<h2>` over a table that brings its
own borders and its own minimum width — 56rem here, 64rem there, `width: 100%` somewhere else — so
a reader scrolling the page meets three different horizontal behaviours and nothing tells them
where one block of work ends and the next begins.

A SECTION BECOMES A CARD WITH A TITLE, so the heading and the thing it heads share one surface
instead of the heading floating above it. On a page with six of them that is the difference
between a page and a pile.

BOTH CLOSING TAGS ARE FOUND BY PAIRING, never by a blanket replace. `</section>` and `</tr>` both
nest, and a screen where one section converts and another does not would get a `</Card>` closing a
`<section>` — which is a parse error if you are lucky and a mis-nested tree if you are not. The
scan counts depth, and the script REFUSES if the number closed does not equal the number opened.

IT DOES NOT TOUCH IMPORTS. Run it, then `tsc`, then add what the compiler asks for — the same
contract as its sibling: a screen it gets wrong is handed back whole.
"""
from __future__ import annotations

import io
import pathlib
import re
import sys

NL = "\n"


def pair(text: str, opener: re.Pattern[str], raw_open: str, raw_close: str, closed: str) -> tuple[str, int]:
    """Convert the closing tag that BELONGS to each converted opener, counting nested depth."""
    out: list[str] = []
    i = 0
    converted = 0
    nest = re.compile(r"%s|%s" % (raw_open, raw_close))
    while True:
        m = opener.search(text, i)
        if m is None:
            out.append(text[i:])
            break
        out.append(text[i:m.end()])
        depth, j = 1, m.end()
        while depth:
            n = nest.search(text, j)
            if n is None:
                break
            depth += 1 if not n.group().startswith("</") else -1
            if depth == 0:
                out.append(text[m.end():n.start()] + closed)
                j = n.end()
                converted += 1
                break
            j = n.end()
        else:
            j = m.end()
        if depth:
            out.append(text[m.end():j])
        i = j
    return "".join(out), converted


def convert(path: pathlib.Path) -> None:
    t = path.read_text(encoding="utf-8")
    original = t
    applied: list[str] = []

    def sub(name: str, pattern: str, repl, flags: int = 0) -> None:
        nonlocal t
        new, n = re.subn(pattern, repl, t, flags=flags)
        if n:
            t = new
            applied.append("%s x%d" % (name, n))

    # ---------------------------------------------------------------- tables
    # Three shipped shapes. The `data-testid` rides across because `Table` forwards `data-*`.
    sub("table-hooked-split",
        r"<table\n\s*data-testid=\"([^\"]+)\"\n\s*style=\{\{ borderCollapse: ['\"]collapse['\"][^}]*\}\}\n?\s*>",
        lambda m: '<Table data-testid="%s">' % m.group(1))
    sub("table-hooked-inline",
        r"<table\n\s*data-testid=\"([^\"]+)\" style=\{\{ borderCollapse: ['\"]collapse['\"][^}]*\}\}>",
        lambda m: '<Table data-testid="%s">' % m.group(1))
    sub("table-bare",
        r"<table style=\{\{ borderCollapse: ['\"]collapse['\"][^}]*\}\}>", "<Table>")
    opened = len(re.findall(r"<Table[ >]", t))
    if opened:
        t, n = pair(t, re.compile(r"<Table[ >]"), r"<table[ >]", r"</table>", "</Table>")
        if n != opened:
            sys.exit("REFUSED %s: %d table(s) opened, %d closed" % (path, opened, n))
        applied.append("table-close x%d" % n)

    # ---------------------------------------------------------------- cells
    for tag, comp in (("th", "Th"), ("td", "Td")):
        sub(tag + "-numeric",
            r"<%s style=\{\{ \.\.\.\w+, textAlign: ['\"](?:end|right)['\"] \}\}" % tag,
            "<%s numeric" % comp)
        sub(tag + "-spread",
            r"<%s style=\{\{ \.\.\.\w+(?:, textAlign: ['\"](?:start|left)['\"])? \}\}" % tag,
            "<%s" % comp)
        sub(tag, r"<%s style=\{\w+\}" % tag, "<%s" % comp)
        # THE STYLE IS NOT ALWAYS THE FIRST ATTRIBUTE. `<th key={k} style={headCellStyle}>` is the
        # shape a mapped header row produces, and matching only the leading position left the
        # opening tag lowercase while its close converted — a parse error per cell.
        sub(tag + "-anywhere",
            r"<%s((?:\s+[\w-]+=(?:\{[^{}]*\}|\"[^\"]*\"))*?)\s+style=\{\w+\}((?:\s+[\w-]+=(?:\{[^{}]*\}|\"[^\"]*\"))*)\s*>" % tag,
            lambda m: "<%s%s%s>" % (comp, m.group(1), m.group(2)))
        sub(tag + "-wrapped", r"<%s\n(\s*)style=\{\w+\}\n" % tag, lambda m: "<%s\n" % comp)
        sub(tag + "-close", r"</%s>" % tag, "</%s>" % comp)

    sub("tr-open", r"<tr key=", "<Tr key=")
    sub("tr-bare", r"<tr>(\s*\n\s*<Td)", lambda m: "<Tr>%s" % m.group(1))
    opened = len(re.findall(r"<Tr[ >]", t))
    if opened:
        t, n = pair(t, re.compile(r"<Tr[ >]"), r"<tr[ >]", r"</tr>", "</Tr>")
        if n != opened:
            sys.exit("REFUSED %s: %d row(s) opened, %d closed" % (path, opened, n))
        applied.append("tr-close x%d" % n)

    # ---------------------------------------------------------------- sections
    sub("section-hooked",
        r"<section style=\{\w+\} (data-testid=\"[^\"]+\")>\s*\n\s*<h2[^>]*>\{t\(['\"](\w+)['\"]\)\}</h2>",
        lambda m: "<Card title={t('%s')} %s>" % (m.group(2), m.group(1)))
    sub("section-plain",
        r"<section style=\{\w+\}>\s*\n\s*<h2[^>]*>\{t\(['\"](\w+)['\"]\)\}</h2>",
        lambda m: "<Card title={t('%s')}>" % m.group(1))
    opened = len(re.findall(r"<Card[ >]", t)) - len(re.findall(r"</Card>", t))
    if opened > 0:
        t, n = pair(t, re.compile(r"<Card title=\{t\("), r"<section[ >]", r"</section>", "</Card>")
        if n != opened:
            sys.exit("REFUSED %s: %d section(s) opened, %d closed" % (path, opened, n))
        applied.append("section-close x%d" % n)

    if t == original:
        sys.exit("REFUSED %s: nothing changed" % path)
    path.write_text(t, encoding="utf-8", newline=NL)
    print("ok %-40s %s" % (path.as_posix().replace("apps/web/app/(app)/", ""), ", ".join(applied)))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: design-pass-sections.py <screen> [<screen> ...]")
    for screen in sys.argv[1:]:
        convert(pathlib.Path("apps/web/app/(app)/%s/page.tsx" % screen))
