#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Every server refusal that puts an INTERNAL IDENTIFIER or a RAW ENUM MEMBER in front of a reader.

WHY THIS EXISTS
---------------
These messages are read by a person. The screens render the SERVER'S own sentence rather than a
generic one — decision 90, and `/retention-disposal`'s `catch` is the worked example — which is
right, because "a duplicate establishment number" and "a missing API endpoint" need different
people to fix them. The cost of that decision is that an api message carrying a uuid or a
`SCREAMING_SNAKE` enum member is a uuid or an enum member ON A SCREEN, with none of the web's
gates able to see it: `rendered-identifiers.py` reads `.tsx`, and this text lives in the api.

THE THREE-WAY SPLIT, which is the output that matters:

  IDENTIFIER   the message interpolates an id — a uuid, a `*Id` variable, a record key. A reader
               is handed a value they cannot act on, and on a REFUSAL that is the worst moment for
               it, because they are already stuck.

  ENUM         the message interpolates or spells a raw enum member. `CLIENT_NOTIFIED` and
               `PERIODIC_REVIEW_DUE` are machine words; the product has Arabic for most of them.

  VOCABULARY   the message names a FIELD, a PERMISSION CODE or a ROUTE. These are deliberate and
               mostly correct — a refusal that names the permission is this product's own
               established shape, and `permissionRefusal` puts the code in a parenthetical on
               purpose. Reported so the other two are not inflated by them.

WHAT IT CANNOT DO, stated rather than discovered
------------------------------------------------
It reads TEXT. A message that interpolates a variable called `reference` may be carrying a
human-readable receipt reference (correct) or a surrogate key (not), and no matcher can tell those
apart — so `reference`-shaped names are reported under VOCABULARY with their line, to be read. The
counts are a starting point for reading rows, never a verdict, which is the same honesty
`raw-stored-values.py`'s own header carries.

It is a REPORT, not a gate. Which of these should change is a wording decision per module, and the
owner's standing rule routes a message whose vocabulary belongs to a module to THAT module.
"""
from __future__ import annotations

import io
import pathlib
import re
import sys

ROOT = pathlib.Path("apps/api/src")

THROW = re.compile(
    r"throw new (BadRequest|Conflict|UnprocessableEntity|NotFound|Forbidden|"
    r"InternalServerError)Exception\(",
)

# An interpolated value whose NAME says it is an identifier.
IDENTIFIER_NAME = re.compile(
    r"\$\{[^}]*\b(\w*[Ii]d|uuid|[Kk]ey|pk)\b[^}]*\}"
)
# A bare uuid written into the text.
LITERAL_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
# A SCREAMING_SNAKE token of two or more parts, or an interpolated `status`/`state`-shaped value.
LITERAL_ENUM = re.compile(r"\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b")
ENUM_NAME = re.compile(
    r"\$\{[^}]*\b(status|state|kind|type|classification|severity|basis|decision|outcome)\b[^}]*\}",
    re.I,
)
# Deliberate and correct: a permission code, a route, a field name.
VOCAB = re.compile(r"[a-z][a-z-]*\.[a-z][a-z.-]*|/[a-z][a-z-]*(?:/|\b)|\b[a-z]+[A-Z]\w*\b")


def message_of(block: str) -> str:
    """The first string or template literal after the opening paren — the message a reader sees."""
    m = re.search(r"[`'\"]", block)
    if m is None:
        return ""
    quote = block[m.start()]
    closing = "`" if quote == "`" else quote
    end = m.end()
    out = []
    while end < len(block):
        ch = block[end]
        if ch == "\\":
            end += 2
            continue
        if ch == closing:
            break
        out.append(ch)
        end += 1
    return "".join(out)


def main() -> int:
    if not ROOT.is_dir():
        sys.exit("REFUSED: %s is not a directory — run from the repository root" % ROOT)

    identifiers: list[tuple[str, int, str]] = []
    enums: list[tuple[str, int, str]] = []
    vocabulary: list[tuple[str, int, str]] = []
    total = 0
    files = set()

    for path in sorted(ROOT.rglob("*.ts")):
        rel = path.as_posix()
        if ".spec." in rel or rel.endswith(".d.ts"):
            continue
        src = path.read_text(encoding="utf-8")
        for m in THROW.finditer(src):
            total += 1
            line = src.count("\n", 0, m.start()) + 1
            # 600 characters is generous for one exception call and bounded enough that a long
            # file cannot bleed one message into the next.
            text = message_of(src[m.end() : m.end() + 600])
            if not text:
                continue
            files.add(rel)
            short = " ".join(text.split())[:150]
            if IDENTIFIER_NAME.search(text) or LITERAL_UUID.search(text):
                identifiers.append((rel, line, short))
            elif LITERAL_ENUM.search(text) or ENUM_NAME.search(text):
                enums.append((rel, line, short))
            elif VOCAB.search(text):
                vocabulary.append((rel, line, short))

    if total < 400:
        sys.exit(
            "REFUSED: only %d exception call(s) found — the matcher is broken, not the api" % total
        )

    # THE ROWS GO TO A UTF-8 FILE AND THE SUMMARY GOES TO STDOUT, and that is not tidiness:
    # this host's console is cp1252, so printing a message containing an Arabic word or even an
    # arrow raises `UnicodeEncodeError` and the whole run dies partway through a report that was
    # otherwise correct. Writing the rows out means the Arabic survives intact for a reader, and
    # the counts still reach whoever ran it.
    out_path = pathlib.Path("server-message-identifiers.txt")
    out = io.StringIO()

    def report(title: str, rows: list[tuple[str, int, str]], note: str) -> None:
        out.write(
            "\n=== %s — %d site(s) across %d file(s) ===\n"
            % (title, len(rows), len({r for r, _, _ in rows}))
        )
        out.write(note + "\n")
        for rel, line, short in rows:
            out.write("  %s:%d\n" % (rel.replace("apps/api/src/", ""), line))
            out.write("      %s\n" % short)

    report(
        "IDENTIFIER",
        identifiers,
        "A reader is handed a value they cannot act on, at the moment they are already stuck.",
    )
    report(
        "ENUM",
        enums,
        "A machine word where the product mostly has an Arabic one. READ THE ROW: a message may\n"
        "name a WORKFLOW STATE on purpose, where the state is the thing being refused.",
    )
    report(
        "VOCABULARY",
        vocabulary,
        "A field, a permission code or a route — mostly DELIBERATE and mostly correct. Reported so\n"
        "the other two are not inflated by them.",
    )

    out_path.write_text(out.getvalue(), encoding="utf-8")

    print("")
    print("rows written to %s (UTF-8 — this console is cp1252)" % out_path)
    print("exception call sites scanned   %5d" % total)
    print("  of which carry a message     %5d across %d file(s)"
          % (len(identifiers) + len(enums) + len(vocabulary), len(files)))
    print("  IDENTIFIER                   %5d" % len(identifiers))
    print("  ENUM                         %5d" % len(enums))
    print("  VOCABULARY                   %5d" % len(vocabulary))
    print("")
    print("A REPORT, not a gate. Read the rows, never the counts: which of these should change is a")
    print("wording decision per module, and a message whose vocabulary belongs to a module goes to")
    print("THAT module rather than being rewritten here.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
