#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
WHICH CONTROLS THE BASE SHAPE REACHES, AND WHICH ONE KEEPS ITS OWN LOOK.

OWNER DECISION 161 RULING 2 put one base shape in `globals.css` for the buttons and fields
nobody styled. Message 52 measured that population as 582 of 901 and built the rule on
`:not([style]):not([class])` -- the measurement's own definition of «بلا شكل».

AND THAT SELECTOR READ A LAYOUT INSTRUCTION AS A LOOK. `/rfqs/new`'s line select carries
`style={{ minWidth: '20rem', marginTop: '0.35rem' }}` -- two words about WHERE the control sits
and not one about how it looks -- and it was drawn by Chromium's own default beside fields that
had taken the token shape. The same for the five back buttons, the three search buttons, the
new-customer button and the role-revoke buttons: every one of them names a margin or a width
and nothing else.

## HOW THE TWO ARE TOLD APART

By the PROPERTY NAMES INSIDE THE `style` ATTRIBUTE: an inline style that mentions `background`,
`color` or `border` is a look and keeps it; one that does not is layout, and the base shape
reaches it. CSS can ask that question directly -- `:not([style*='background'])` substring-matches
the serialised attribute -- so there is no marker attribute to add to hundreds of call sites and
nothing for a developer to remember.

AND THE THREE SUBSTRINGS COVER MORE THAN THEIR THREE WORDS, WHICH IS WHY THEY ARE ENOUGH:
`color` is inside `background-color`, `border-color`, `caret-color`, `accent-color` and
`outline-color`; `border` is inside `border-radius`, `border-width` and every side of it;
`background` is inside `background-image` and `background-clip`. React renders a camelCase key
as its kebab-case property name, so `backgroundColor` arrives in the DOM as `background-color`
and is matched.

AND AN INLINE DECLARATION STILL WINS. The base rule sets no `width`, no `margin` and no
`min-width`, so a layout-only inline style is not overridden by being reached -- it is completed.

## 🔴 AND THIS MEASUREMENT WAS WRONG TWICE BEFORE IT WAS RIGHT: 318, THEN 222, THEN 85.

Both wrong figures over-stated the work -- they claimed a control was about to change when it
was not -- and both for the same reason: a style object names a colour that the SOURCE AT THE
CALL SITE does not spell.

  318   read the attribute text only. 84 sites spread `buttonStyle`, which sets `color`,
        `background` AND `border`; five spread `cardStyle`, one each `inputStyle` and
        `profileMenuItemStyle`. React serialises a spread into the same `style` attribute, so
        the browser sees those words and skips those controls -- correctly.
  222   followed `...spreads` and `helper(` calls, and was still blind to a BARE REFERENCE:
        `style={inputStyle}` has no `...` and no `(` in it, and 66 inputs and 32 buttons are
        written exactly that way.
   85   follows every identifier that resolves to a declared style object, recursively.

⟶ The SELECTOR was right under all three readings. What had to learn to follow a reference was
  the measurement. ⚠️ And `var(--space-2)` inside a value read as a call to a helper named
  `var` until `NOT_A_STYLE` named it, which put two correct sites in an "unresolved" bucket.

What genuinely cannot be resolved -- a `style` prop a caller hands in -- is counted and printed
as its own population rather than guessed at in either direction. It is currently empty.

This script is the measurement, not a gate: it prints the populations and the list of controls
the widening newly reaches, so the next reader can re-run it instead of trusting it.
"""
import os
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = os.path.join(ROOT, "apps", "web")

TAGS = ("button", "input", "select", "textarea")
QUOTES = ('"', "'", "`")

# The three look words. Kept as a declared tuple so the CSS rule and this measurement cannot
# disagree about which properties mean an element's own look.
LOOK_WORDS = ("background", "color", "border")

# A checkbox, radio or file input is outside the base rule by the ruling's own words.
EXCLUDED_TYPES = ("checkbox", "radio", "file")

# Identifiers that are never a style object, so an unresolved reference to one is not a hole.
NOT_A_STYLE = {"undefined", "null", "true", "false", "String", "Number", "Object",
               # `var(--space-2)` is CSS inside a value, not a helper this script can follow.
               "var", "calc", "clamp", "min", "max", "url", "rgb", "rgba"}


def source_files(exts=(".tsx", ".jsx")):
    out = []
    for base, dirs, names in os.walk(WEB):
        dirs[:] = [d for d in dirs if d not in {"node_modules", ".next", "test-results", "e2e"}]
        for n in names:
            if n.endswith(exts):
                out.append(os.path.join(base, n))
    return sorted(out)


def _balanced(text, i, open_c, close_c):
    """The span starting at text[i] == open_c through its matching close, quotes respected."""
    depth = 0
    quote = None
    j = i
    while j < len(text):
        c = text[j]
        if quote:
            if c == "\\":
                j += 2
                continue
            if c == quote:
                quote = None
        elif c in QUOTES:
            quote = c
        elif c == open_c:
            depth += 1
        elif c == close_c:
            depth -= 1
            if depth == 0:
                return text[i:j + 1]
        j += 1
    return text[i:]


def tags_in(text):
    """Yield (tag, attr_text, line_no) for every element open tag, JSX braces respected.

    A `>` inside `style={{ ... }}` or inside a quoted string is not the end of the tag, which
    is the whole reason this is not a regex.
    """
    for m in re.finditer(r"<(" + "|".join(TAGS) + r")(?=[\s/>])", text):
        tag = m.group(1)
        i = m.end()
        depth = 0
        quote = None
        while i < len(text):
            c = text[i]
            if quote:
                if c == "\\":
                    i += 2
                    continue
                if c == quote:
                    quote = None
            elif c in QUOTES:
                quote = c
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            elif c == ">" and depth == 0:
                break
            i += 1
        yield tag, text[m.end():i], text.count("\n", 0, m.start()) + 1


def attr_value(attrs, name):
    """The raw source of one attribute's value, or None when the attribute is absent."""
    m = re.search(r"(?<![A-Za-z-])" + name + r"\s*=\s*", attrs)
    if not m:
        return None
    i = m.end()
    if i >= len(attrs):
        return ""
    if attrs[i] in ('"', "'"):
        q = attrs[i]
        j = attrs.find(q, i + 1)
        return attrs[i + 1:len(attrs) if j < 0 else j]
    if attrs[i] == "{":
        return _balanced(attrs, i, "{", "}")
    return re.split(r"\s", attrs[i:], 1)[0]


def style_table():
    """Every `const NAME = {...}` / `function NAME(...) {...}` under apps/web, by name.

    A name declared twice (`cardStyle` lives in two `.styles.ts` files) resolves to the
    CONCATENATION of both bodies, which is the conservative direction: if either home sets a
    colour, the reference is treated as a look.
    """
    table = {}
    pat = re.compile(
        r"(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*(?=[{(])"
        r"|(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(")
    for path in source_files((".ts", ".tsx")):
        text = open(path, "rb").read().decode("utf-8")
        for m in pat.finditer(text):
            name = m.group(1) or m.group(2)
            i = m.end()
            if m.group(2):
                i = text.find("{", i)
                if i < 0:
                    continue
            elif text[i] == "(":
                i = text.find("{", i)
                if i < 0:
                    continue
            body = _balanced(text, i, "{", "}")
            table[name] = table.get(name, "") + "\n" + body
    return table


def referenced(expr, table):
    """(identifiers this style expression reaches through, identifiers it cannot resolve).

    🔴 AND A BARE REFERENCE IS NOT A SPREAD, WHICH COST THIS SCRIPT ITS SECOND WRONG FIGURE.
    `style={inputStyle}` names a style object with no `...` and no `(` in sight -- 66 inputs
    and 32 buttons do exactly that -- so a resolver looking only for spreads and calls read
    `inputStyle`'s colour, background and border as absent and called all 98 layout-only. The
    browser reads the serialised attribute and skips every one of them.

    ⟶ Every identifier in the expression is a candidate. One PRESENT in the style table is
    followed; a reference that is the WHOLE expression and is absent from the table is a hole
    and is reported as one; anything else (a ternary's `status`, a number) is neither.
    """
    bare = re.fullmatch(r"\{\s*([A-Za-z_$][\w$]*)\s*\}", expr.strip())
    if bare:
        name = bare.group(1)
        return ({name}, set()) if name in table else (set(), {name})
    names = set(re.findall(r"(?<![\w$.'\"])([A-Za-z_$][\w$]*)(?!\s*:)", expr))
    names |= set(re.findall(r"\.\.\.\s*([A-Za-z_$][\w$]*)", expr))
    names |= set(re.findall(r"(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(", expr))
    names -= NOT_A_STYLE
    # A spread or a call whose target is not a known style object IS a hole; a loose identifier
    # inside an object literal (a ternary's subject) is not.
    reach = {n for n in names if n in table}
    holes = {n for n in re.findall(r"\.\.\.\s*([A-Za-z_$][\w$]*)", expr)
             if n not in table and n not in NOT_A_STYLE}
    holes |= {n for n in re.findall(r"(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(", expr)
              if n not in table and n not in NOT_A_STYLE}
    return reach, holes


def resolve_look(expr, table, seen=None):
    """(look words found, unresolved references) for a style expression, spreads followed."""
    if seen is None:
        seen = set()
    low = expr.lower()
    words = {w for w in LOOK_WORDS if w in low}
    reach, unresolved = referenced(expr, table)
    for name in reach:
        if name in seen:
            continue
        seen.add(name)
        w, u = resolve_look(table[name], table, seen)
        words |= w
        unresolved |= u
    return words, unresolved


def is_excluded_input(tag, attrs):
    if tag != "input":
        return False
    t = attr_value(attrs, "type") or ""
    return any(x in t for x in EXCLUDED_TYPES)


def measure():
    table = style_table()
    counts = {}
    for t in TAGS:
        counts[t] = dict(tags=0, bare=0, styled=0, layout=0, look=0, unknown=0, classed=0)
    excluded = 0
    newly_reached, kept, unknown = [], [], []

    for path in source_files():
        text = open(path, "rb").read().decode("utf-8")
        rel = os.path.relpath(path, ROOT).replace("\\", "/")
        for tag, attrs, line in tags_in(text):
            if is_excluded_input(tag, attrs):
                excluded += 1
                continue
            c = counts[tag]
            c["tags"] += 1
            style = attr_value(attrs, "style")
            if (attr_value(attrs, "className") is not None
                    or attr_value(attrs, "class") is not None):
                c["classed"] += 1
                continue
            if style is None:
                c["bare"] += 1
                continue
            c["styled"] += 1
            words, unres = resolve_look(style, table)
            flat = " ".join(style.split())
            if words:
                c["look"] += 1
                kept.append((rel, line, tag, ",".join(sorted(words)), flat[:100]))
            elif unres:
                c["unknown"] += 1
                unknown.append((rel, line, tag, ",".join(sorted(unres)), flat[:100]))
            else:
                c["layout"] += 1
                newly_reached.append((rel, line, tag, flat[:100]))

    return counts, excluded, newly_reached, kept, unknown


def main():
    counts, excluded, newly_reached, kept, unknown = measure()
    cols = ("tags", "bare", "styled", "layout", "look", "unknown", "classed")

    print("THE POPULATIONS (apps/web, .tsx/.jsx, e2e excluded; spreads resolved)")
    print("")
    print("  %-9s %6s %6s %7s %7s %6s %8s %8s" % (("tag",) + cols))
    for t in TAGS:
        print("  %-9s %6d %6d %7d %7d %6d %8d %8d"
              % ((t,) + tuple(counts[t][k] for k in cols)))
    print("  %-9s %6d %6d %7d %7d %6d %8d %8d"
          % (("total",) + tuple(sum(counts[t][k] for t in TAGS) for k in cols)))
    print("")
    print("  bare      no `style` and no `class`   -- reached before and after")
    print("  styled    a `style`, no `class`       -- the population this measures")
    print("  layout    of those, reaching none of %s" % (LOOK_WORDS,))
    print("  look      of those, reaching one      -- keeps its own look")
    print("  unknown   a reference this script cannot resolve (a `style` prop)")
    print("  class     a `className`               -- outside the rule either way")
    print("  checkbox/radio/file  %d, excluded by the ruling's own words" % excluded)
    print("")
    print("CONTROLS THE WIDENING NEWLY REACHES (%d)" % len(newly_reached))
    for rel, line, tag, flat in newly_reached:
        print("  %s:%d  <%s %s>" % (rel, line, tag, flat))
    print("")
    print("CONTROLS THAT KEEP THEIR OWN LOOK (%d)" % len(kept))
    for rel, line, tag, words, flat in kept:
        print("  %s:%d  <%s %s>   [%s]" % (rel, line, tag, flat, words))
    print("")
    print("UNRESOLVED -- decided in the browser, not here (%d)" % len(unknown))
    for rel, line, tag, names, flat in unknown:
        print("  %s:%d  <%s %s>   [%s]" % (rel, line, tag, flat, names))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
