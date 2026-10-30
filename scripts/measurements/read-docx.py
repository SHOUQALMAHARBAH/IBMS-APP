# -*- coding: utf-8 -*-
"""
READ AN APPROVED .docx WITH NO DEPENDENCIES — paragraphs and table cells, in order.

    PYTHONIOENCODING=utf-8 python scripts/measurements/read-docx.py <file.docx>

`PYTHONIOENCODING` is not optional on this host: the console is cp1252 and Arabic output
dies with a UnicodeEncodeError without it.

ONE BUG WORTH KNOWING, because the first version had it: `<w:t[^>]*>` also matches
`<w:tcPr>`, so every table cell came back with raw XML wrapped around its text. The
pattern requires whitespace after `w:t`.
"""
import re
import sys
import zipfile

UN = (('&amp;', '&'), ('&lt;', '<'), ('&gt;', '>'), ('&quot;', '"'), ('&apos;', "'"))


def text_of(xml_fragment):
    parts = re.findall(r'<w:t(?:\s[^>]*)?>(.*?)</w:t>', xml_fragment, re.S)
    s = ''.join(parts)
    for a, b in UN:
        s = s.replace(a, b)
    return s.strip()


def main():
    z = zipfile.ZipFile(sys.argv[1])
    xml = z.read('word/document.xml').decode('utf-8')
    # Walk paragraphs and tables in document order.
    for m in re.finditer(r'<w:tbl>.*?</w:tbl>|<w:p\b.*?</w:p>', xml, re.S):
        block = m.group(0)
        if block.startswith('<w:tbl>'):
            for row in re.findall(r'<w:tr\b.*?</w:tr>', block, re.S):
                cells = [text_of(c) for c in
                         re.findall(r'<w:tc>.*?</w:tc>', row, re.S)]
                if any(cells):
                    print(' | '.join(cells))
        else:
            t = text_of(block)
            if t:
                print(t)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
