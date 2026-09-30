# -*- coding: utf-8 -*-
"""Every NEGATIVE NAVIGATION assertion — version 2, resolving identifiers.

Version 1 missed `sidebar-executive.spec.ts:141`, where the target is a variable assigned
on the previous line:

    const planning = sidebar.locator('a[href="/planning-export"]');
    await expect(planning).toBeHidden();

The statement itself contains no navigation marker, so a classifier that reads only the
statement reports "not navigation" and the sweep quietly stops one short. This version
expands single-identifier targets (and helper calls) against the file's own `const`
declarations and function bodies before classifying.
"""
import io
import os
import re

E2E = 'apps/web/e2e'

NEG = re.compile(
    r'toHaveCount\(\s*0\s*\)|expectNone\(|toBeHidden\(\)|not\.toBeVisible\(\)|'
    r'not\.toContainText\(|not\.toHaveText\('
)

NAV = re.compile(
    r"getByRole\(\s*[\"']link[\"']|a\[href|getByRole\(\s*[\"']navigation[\"']|"
    r"getByTestId\(\s*[\"'](?:nav|sidebar|launcher)|navGroup|\bsidebar\b|\bnav\(",
    re.I,
)


def statements(src):
    out = []
    i = 0
    line = 1
    while True:
        m = re.search(r'\b(?:await\s+)?expect(?:None)?\s*\(', src[i:])
        if not m:
            break
        start = i + m.start()
        line += src[i:start].count('\n')
        j = start
        depth = 0
        while j < len(src):
            c = src[j]
            if c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
            elif c == ';' and depth == 0:
                break
            j += 1
        out.append((line, src[start:j + 1]))
        line += src[start:j + 1].count('\n')
        i = j + 1
    return out


def definitions(src):
    """identifier -> the text it is defined as (const or function)."""
    defs = {}
    for m in re.finditer(r'\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);', src):
        defs[m.group(1)] = m.group(2)
    for m in re.finditer(
        r'\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{(.{0,400}?)\}', src, re.S
    ):
        defs[m.group(1)] = m.group(2)
    return defs


def expand(stmt, defs, rounds=3):
    """Substitute identifiers with their definitions, so a nav marker one hop away is seen."""
    text = stmt
    for _ in range(rounds):
        grew = False
        for ident in set(re.findall(r'\b([A-Za-z_$][\w$]*)\b', text)):
            if ident in defs and defs[ident] not in text:
                text += ' /*' + ident + '=*/ ' + defs[ident]
                grew = True
        if not grew:
            break
    return text


def main():
    total_neg = 0
    rows = []
    for f in sorted(os.listdir(E2E)):
        if not f.endswith('.spec.ts'):
            continue
        src = io.open(os.path.join(E2E, f), encoding='utf-8').read()
        defs = definitions(src)
        for line, stmt in statements(src):
            if not NEG.search(stmt):
                continue
            total_neg += 1
            if NAV.search(stmt):
                how = 'direct'
            elif NAV.search(expand(stmt, defs)):
                how = 'via identifier'
            else:
                continue
            rows.append((f, line, how, ' '.join(stmt.split())[:120]))

    print('negative assertions in the suite : %d' % total_neg)
    print('of which NAVIGATION-targeted     : %d' % len(rows))
    print()
    for f, line, how, text in rows:
        print('%-32s :%-5d [%-14s] %s' % (f, line, how, text))


if __name__ == '__main__':
    main()
