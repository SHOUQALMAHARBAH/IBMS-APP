# -*- coding: utf-8 -*-
"""The mechanical half of a screen's design pass, applied with REFUSAL rather than tolerance.

WHAT THIS IS AND IS NOT. It is not a sweep: every transform below is EXACT-MATCH and the script
refuses a file where a transform it was told to apply does not match, so a screen whose shape is
even slightly different is handed back rather than half-converted. The JUDGEMENT half of a design
pass — what a screen is for, what belongs in which group, which badge carries a meaning — cannot be
mechanised and is done per screen by hand afterwards.

It exists because 99 of 106 screens open `<main style={pageStyle}>` and 95 render the identical
`<p role="alert" style={errorStyle}>`, so doing those by hand 100 times would spend the batch's
whole budget on the part that carries no decision.

EVERY TRANSFORM IS A REAL IMPROVEMENT, not a rename:
  * `opacity: 0.75` as muting is what `globals.css` itself bans — it dims the BACKGROUND through
    the text and is what caused this product's recorded a11y contrast regression. `--ink-secondary`
    is a colour with a measured ratio behind it.
  * a bare `<p>` for a load error is one of the four states done as an afterthought; `ErrorState`
    is the component the directive asks for.
  * `0.4rem`/`0.2rem`/`0.75rem` are off the five-step scale the owner set (4 · 8 · 12 · 16 · 22).
  * a hand-rolled `<table>` carries its own borders and its own minimum width, so no two screens
    in this product agreed on either.
"""
import io
import re
import sys

NL = "\n"

UI_IMPORT = """import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '%(prefix)s/components/ui';"""


def convert(path, quote, prefix, expect):
    """`expect` names the transforms that MUST apply; anything else is optional."""
    t = io.open(path, encoding="utf-8").read()
    original = t
    applied = []

    q = quote

    def sub(name, pattern, repl, flags=0, count=0):
        nonlocal t
        new, n = re.subn(pattern, repl, t, count=count, flags=flags)
        if n:
            t = new
            applied.append("%s x%d" % (name, n))
        elif name in expect:
            sys.stderr.write("REFUSED %s: %s matched nothing%s" % (path, name, NL))
            raise SystemExit(1)

    # 1. THE LOCAL TABLE STYLES, which every one of these files declares for itself.
    #
    # THE BODY MATCHER IS `\{[^{}]*\}` AND NOT `\{.*?\}`, and that is not a style preference.
    # The first version used a non-greedy DOTALL run to the next `};\n\n`, which on a file whose
    # `const head` is a ONE-LINER followed by three more style constants ran straight past all of
    # them and deleted `sectionStyle`, `formStyle` and `labelStyle` as well. A brace-free body
    # cannot cross a declaration boundary, so the transform can only ever remove the two it names.
    #
    # The compiler caught it — six `TS2304`s naming every orphaned use — which is the argument for
    # typechecking after each group rather than at the end of forty.
    sub("table-styles",
        r"const cell: CSSProperties = \{[^{}]*\};\nconst head: CSSProperties = \{[^{}]*\};\n\n",
        "", re.S)

    # 2. the page wrapper
    sub("page-style", r"<main style=\{pageStyle\}>", "<main style={pageStackStyle}>")

    # 3. the heading pair -> PageHeader. `opacity` as muting is the defect; the component
    #    carries a real colour token and the right type scale.
    sub("page-header",
        r"<h1>\{t\(" + q + r"(\w+)" + q + r"\)\}</h1>\s*\n\s*<p style=\{\{ opacity: 0\.75[^}]*\}\}>\s*\n?\s*\{t\(" + q + r"(\w+)" + q + r"\)\}\s*\n?\s*</p>",
        lambda m: "<PageHeader\n        title={t(%s%s%s)}\n        description={t(%s%s%s)}\n      />"
                  % (q, m.group(1), q, q, m.group(2), q))

    # 4. THE RAW TABLE, IN ITS TWO SHIPPED SHAPES. Most screens wrap it in an overflow div and
    #    some do not — and the ones that do not are the defect, because a 30rem table with no
    #    horizontal scroll is a table that pushes the whole page sideways on a phone. `Table`
    #    carries the scroll container itself, so both shapes converge on the same component.
    #
    # WHICH SHAPE THIS FILE HAS IS DECIDED BEFORE EITHER PATH RUNS, and that is the fix for a real
    # defect: the first version ran the WRAPPED path and then asked whether it had worked. On a
    # screen whose opening `<div>` and `<table>` are separated by a line the opener missed while
    # the CLOSER still matched `</table>\n</div>`, the bare path then fired as well — so the file
    # gained `<Card><Table>` while keeping an opening `<div>` whose `</div>` had been consumed.
    # Six parse errors on one screen, caught by `tsc`; the two paths are now exclusive by
    # construction rather than by a count taken afterwards.
    open_wrapped = re.compile(
        r"<div style=\{\{ overflowX: " + q + r"auto" + q + r" \}\}>\s*\n\s*<table style=\{\{ borderCollapse: "
        + q + r"collapse" + q + r", minWidth: " + q + r"[\d.]+rem" + q + r" \}\}>")
    # A SCREEN MAY CARRY BOTH SHAPES — `/audit-trail` has a wrapped table and a bare one. So the
    # wrapped pass runs first and the bare pass runs on WHAT IS LEFT, gated on the remainder being
    # BALANCED: equal numbers of surviving `<table` and `</table>`. An unbalanced remainder means
    # the wrapped pass converted one end of a table and not the other, and running the bare pass
    # over that is exactly how a file ends up with an opening `<div>` whose close has been eaten.
    if open_wrapped.search(t):
        sub("table-open", open_wrapped.pattern, "<Card padded={false}>\n            <Table>")
        sub("table-close", r"</table>\s*\n(\s*)</div>",
            lambda m: "</Table>\n%s</Card>" % m.group(1))
    if len(re.findall(r"<table[ >]", t)) == len(re.findall(r"</table>", t)) > 0:
        sub("table-bare-open",
            r"<table style=\{\{ borderCollapse: " + q + r"collapse" + q + r"(?:, minWidth: " + q + r"[\d.]+rem" + q + r")? \}\}>",
            "<Card padded={false}>\n            <Table>")
        sub("table-bare-close", r"</table>", "</Table>\n          </Card>")
    # A CELL MAY CARRY MORE THAN ITS STYLE — `colSpan`, a `data-` hook, a `title`. The first
    # version matched `<td style={cell}>` with the closing bracket included, so an attributed
    # cell kept its lowercase tag while its `</td>` became `</Td>`: eight parse errors on one
    # screen. Dropping the bracket from the pattern carries every remaining attribute through,
    # which is why `Td` and `Th` had to learn `colSpan` in the same commit.
    # THE LOCAL STYLE CONSTANT IS NOT ALWAYS CALLED `cell` OR `head`. Screens here use
    # `headCellStyle`, `thStyle`, `cellStyle` — one name per author. Matching ANY identifier is
    # what stops this becoming a list of names that grows by one every time a screen refuses.
    #
    # The three spread forms are the same cell wearing an override. `textAlign: 'start'` is `Td`'s
    # own default so it simply disappears; `'end'` is what `numeric` means, and translating it
    # rather than dropping it is the difference between a right-aligned money column and one that
    # silently moves.
    for tag, comp in (("th", "Th"), ("td", "Td")):
        sub(tag + "-numeric",
            r"<%s style=\{\{ \.\.\.\w+, textAlign: %s(?:end|right)%s \}\}" % (tag, q, q),
            "<%s numeric" % comp)
        sub(tag + "-spread",
            r"<%s style=\{\{ \.\.\.\w+(?:, textAlign: %s(?:start|left)%s)? \}\}" % (tag, q, q),
            "<%s" % comp)
        sub(tag, r"<%s style=\{\w+\}" % tag, "<%s" % comp)
        sub(tag + "-close", r"</%s>" % tag, "</%s>" % comp)
    sub("tr-open", r"<tr key=", "<Tr key=")
    # A BODY ROW WITH NO KEY — the *nothing matched* row several screens render inside the table.
    # Matched by what it CONTAINS rather than by where it sits, because `thead`'s own `<tr>` must
    # stay a plain row: `Tr` is styled for a data row.
    sub("tr-bare", r"<tr>(\s*\n\s*<Td)", lambda m: "<Tr>%s" % m.group(1))

    # THE CLOSING TAG IS FOUND BY PAIRING, NOT BY WHAT PRECEDES IT.
    #
    # The first version matched `</tr>` only where a `</Td>` sat immediately above — true of most
    # rows and false of any row whose last cell is conditional, where the line before the close is
    # `) : null}`. Two parse errors on one screen, and the general shape of the mistake is reading
    # a tree with a pattern that assumes its shape.
    #
    # This walks the openers in order and converts the close that actually belongs to each one,
    # counting nested `<tr`/`</tr>` so the pairing is real rather than nearest-match.
    opened = len(re.findall(r"<Tr[ >]", t))
    if opened:
        out, i, converted = [], 0, 0
        while True:
            m = re.compile(r"<Tr[ >]").search(t, i)
            if m is None:
                out.append(t[i:])
                break
            out.append(t[i:m.end()])
            depth, j = 1, m.end()
            while depth:
                n = re.compile(r"<tr[ >]|</tr>").search(t, j)
                if n is None:
                    break
                depth += 1 if n.group().startswith("<tr") else -1
                if depth == 0:
                    out.append(t[m.end():n.start()] + "</Tr>")
                    j = n.end()
                    converted += 1
                    break
                j = n.end()
            else:
                j = m.end()
            if depth:
                out.append(t[m.end():j])
            i = j
        t = "".join(out)
        if converted != opened:
            sys.stderr.write("REFUSED %s: %d row(s) opened, %d closed%s"
                             % (path, opened, converted, NL))
            raise SystemExit(1)
        applied.append("tr-close x%d" % converted)

    # 5. the error paragraph -> the state component
    sub("error-state",
        r"<p role=\"alert\" style=\{errorStyle\}>\s*\n\s*\{(\w+)\}\s*\n\s*</p>",
        lambda m: "<ErrorState title={%s} />" % m.group(1))
    sub("error-state-inline",
        r"<p role=\"alert\" style=\{errorStyle\}>\{(\w+)\}</p>",
        lambda m: "<ErrorState title={%s} />" % m.group(1))

    # 6. the empty paragraph -> the state component
    sub("empty-state",
        r"<p style=\{\{ color: " + q + r"var\(--ink-secondary\)" + q + r" \}\}>\{t\(" + q + r"(\w+)" + q + r"\)\}</p>",
        lambda m: "<EmptyState title={t(%s%s%s)} />" % (q, m.group(1), q))

    # 7. the bare loading paragraph -> a skeleton that says what is loading
    sub("loading",
        r"<p>\{t\(" + q + r"(\w+Loading)" + q + r"\)\}</p>",
        lambda m: "<SkeletonList rows={4} label={t(%s%s%s)} />" % (q, m.group(1), q))

    # 8. off-scale spacing inside what is left
    for raw, token in (("0.2rem", "var(--space-1)"), ("0.3rem", "var(--space-2)"),
                       ("0.4rem", "var(--space-2)"), ("0.75rem", "var(--space-3)"),
                       ("1rem", "var(--space-4)")):
        sub("spacing-%s" % raw, r"gap: " + q + raw + q, "gap: '%s'" % token)

    # 8b. A LEFTOVER `const cell` OR `const head` THAT NOTHING READS ANY MORE. The paired
    #     transform above only fires on the exact two-declaration shape; a file that declares them
    #     apart, or with a third constant between, keeps them — and an unread constant is a lint
    #     warning, not an error, so it would ship quietly. Removed only when the file no longer
    #     mentions the name anywhere else, which is the measurement rather than an assumption.
    for name in ("cell", "head"):
        if len(re.findall(r"\b%s\b" % name, t)) == 1:
            sub("dead-const-%s" % name,
                r"const %s: CSSProperties = \{[^{}]*\};\n" % name, "")

    # 9. IMPORTS — only what the file now actually uses. Importing the whole set would leave an
    #    unused-import warning on every screen that has no empty state, and a warning nobody can
    #    act on is a warning everybody stops reading.
    used = [n for n in ("Card", "EmptyState", "ErrorState", "PageHeader", "SkeletonList",
                        "Table", "Td", "Th", "Tr")
            if re.search(r"<%s[ />\n]" % n, t)]
    ui_import = ("import {\n%s\n} from %s%s/components/ui%s;"
                 % ("\n".join("  %s," % n for n in used), q, prefix, q))
    sub("import-page-style",
        r"import \{ pageStyle \} from " + q + r"([^" + q + r"]*lead\.styles)" + q + r";",
        lambda m: "%s\nimport { pageStackStyle } from %s%s%s;" % (ui_import, q, m.group(1), q))
    sub("import-error-style",
        r"import \{ errorStyle \} from " + q + r"[^" + q + r"]*auth-form\.styles" + q + r";\n",
        "")
    # The react `CSSProperties` import goes ONLY if nothing in the file still needs it. The first
    # version stripped it unconditionally and broke four screens whose own style constants the
    # table transform had legitimately left in place.
    if not re.search(r"CSSProperties(?!\s*\} from)", re.sub(r"import[^\n]*CSSProperties[^\n]*\n", "", t)):
        sub("import-cssproperties-only",
            r"import type \{ CSSProperties \} from " + q + r"react" + q + r";\n", "")
        sub("import-cssproperties-mixed",
            r"import \{ type CSSProperties, ", "import { ")

    if t == original:
        sys.stderr.write("REFUSED %s: nothing changed%s" % (path, NL))
        raise SystemExit(1)

    io.open(path, "w", encoding="utf-8", newline=NL).write(t)
    print("ok %-54s %s" % (path.replace("apps/web/app/(app)/", ""), ", ".join(applied)))


# `th` is NOT required: a table with no header row exists in this product and is its own
# defect, but refusing to convert such a screen would leave it with raw markup as well.
MUST = {"page-style", "page-header", "td",
        "error-state", "import-page-style", "import-error-style"}


def quote_of(src):
    """Which JS quote the file uses — measured from its own imports, never assumed."""
    return '"' if src.count('from "') > src.count("from '") else "'"


if len(sys.argv) < 2:
    sys.stderr.write("usage: convert.py <screen> [<screen> ...]%s" % NL)
    raise SystemExit(2)

for screen in sys.argv[1:]:
    path = "apps/web/app/(app)/%s/page.tsx" % screen
    # THE IMPORT PREFIX IS DERIVED FROM DEPTH, not assumed: `dashboards/financial` is one level
    # deeper than `claims`, and a hand-written `../../..` there resolves to the wrong directory —
    # which typechecks as a missing module rather than silently, but only after the write.
    depth = screen.count("/") + 3
    convert(path, quote_of(io.open(path, encoding="utf-8").read()), "/".join([".."] * depth), MUST)
