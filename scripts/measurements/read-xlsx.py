# -*- coding: utf-8 -*-
"""
READ AN APPROVED .xlsx WITH NO DEPENDENCIES — it is a zip of XML.

    python scripts/measurements/read-xlsx.py <file.xlsx>              # list the sheets
    python scripts/measurements/read-xlsx.py <file.xlsx> IncidentReport

Committed because `docs/pcms-dictionary-divergences.md` tells the next reader to run it,
and because group 7 of the owner's walk is a compare-and-report pass over all fourteen
sheets of `PRIV-SRS-02` — a one-off script in a scratch directory would make that pass
unrepeatable, and an unrepeatable measurement is one nobody can argue with.

NO openpyxl, deliberately: adding a dependency to read a document that lives on a
removable drive is a change to the build for the sake of a measurement.

It concatenates every `<t>` inside a shared string, because a cell whose text carries
formatting is stored as several runs and reading only the first silently truncates it.
"""
import io
import re
import sys
import zipfile


def shared_strings(z):
    try:
        xml = z.read('xl/sharedStrings.xml').decode('utf-8')
    except KeyError:
        return []
    out = []
    for si in re.findall(r'<si>(.*?)</si>', xml, re.S):
        # Concatenate every <t> in the item, which is how a run-formatted cell is stored.
        parts = re.findall(r'<t[^>]*>(.*?)</t>', si, re.S)
        txt = ''.join(parts)
        txt = (txt.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
                  .replace('&quot;', '"').replace('&apos;', "'"))
        out.append(txt)
    return out


def sheet_names(z):
    wb = z.read('xl/workbook.xml').decode('utf-8')
    names = re.findall(r'<sheet[^>]*name="([^"]*)"[^>]*r:id="(rId\d+)"', wb)
    rels = z.read('xl/_rels/workbook.xml.rels').decode('utf-8')
    target = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="([^"]*)"', rels))
    out = []
    for name, rid in names:
        t = target.get(rid, '')
        if t.startswith('/'):
            t = t[1:]
        elif not t.startswith('xl/'):
            t = 'xl/' + t
        out.append((name, t))
    return out


def rows(z, path, strings):
    xml = z.read(path).decode('utf-8')
    out = []
    for row in re.findall(r'<row[^>]*>(.*?)</row>', xml, re.S):
        cells = {}
        for c in re.findall(r'<c\s([^>]*?)(?:/>|>(.*?)</c>)', row, re.S):
            attrs, body = c
            ref = re.search(r'r="([A-Z]+)\d+"', attrs)
            col = ref.group(1) if ref else '?'
            t = re.search(r't="(\w+)"', attrs)
            kind = t.group(1) if t else 'n'
            v = re.search(r'<v>(.*?)</v>', body or '', re.S)
            if kind == 's' and v:
                cells[col] = strings[int(v.group(1))]
            elif kind == 'inlineStr':
                ts = re.findall(r'<t[^>]*>(.*?)</t>', body or '', re.S)
                cells[col] = ''.join(ts)
            elif v:
                cells[col] = v.group(1)
        if cells:
            out.append(cells)
    return out


def main():
    path = sys.argv[1]
    want = sys.argv[2] if len(sys.argv) > 2 else None
    z = zipfile.ZipFile(path)
    strings = shared_strings(z)
    sheets = sheet_names(z)
    if want is None:
        print('sheets (%d):' % len(sheets))
        for name, t in sheets:
            print('  %-40s %s' % (name, t))
        return 0
    for name, t in sheets:
        if name.strip().lower() != want.strip().lower():
            continue
        data = rows(z, t, strings)
        cols = sorted({c for r in data for c in r},
                      key=lambda s: (len(s), s))
        print('=== %s — %d row(s) ===' % (name, len(data)))
        for r in data:
            vals = [r.get(c, '') for c in cols]
            while vals and vals[-1] == '':
                vals.pop()
            print(' | '.join(vals))
        return 0
    print('no sheet named %r' % want, file=sys.stderr)
    return 2


if __name__ == '__main__':
    raise SystemExit(main())
