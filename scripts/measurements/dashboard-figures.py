# -*- coding: utf-8 -*-
"""What figures each reporting dashboard actually DISPLAYS.

The owner needs this to write the Arabic permission descriptions truthfully: "view the
finance dashboard" may mean seeing total commission income, and an office manager cannot
decide who may open a screen without knowing what it reveals.

Method: read each screen's own `t('key')` calls and resolve them to their ENGLISH text
from the registered dictionaries. The SCREEN is the authority here, not the API's response
shape — a route can return a figure the screen never renders (which is exactly § 1.60's
finding), so asking the API would over-report what a reader can see.

Chrome is filtered by name, not by guessing at meaning: headings, intros, errors, empty
states, permission messages, filter labels and aria labels are not figures.
"""
import io
import os
import re

WEB = 'apps/web'
DICTS = os.path.join(WEB, 'lib/i18n/translations')

SCREENS = [
    # The seven Part E dashboards
    ('dashboards/claims', 'Claims dashboard'),
    ('dashboards/compliance', 'Compliance dashboard'),
    ('dashboards/executive', 'Executive dashboard'),
    ('dashboards/financial', 'Financial dashboard'),
    ('dashboards/insurer-employee-performance', 'Insurer & employee performance dashboard'),
    ('dashboards/policy', 'Policy dashboard'),
    ('dashboards/sales', 'Sales dashboard'),
    # Domain G reports
    ('kpi-dashboard', 'KPI dashboard'),
    ('sales-performance', 'Sales performance'),
    ('insurer-performance', 'Insurer performance'),
    ('employee-performance', 'Employee performance'),
    ('portfolio-analysis', 'Portfolio analysis'),
    ('profitability-analysis', 'Profitability analysis'),
    # The finance report
    ('financial-report', 'Financial report'),
    # Operational, listed for completeness
    ('claims-analytics', 'Claims analytics'),
    ('sla-dashboard', 'SLA dashboard'),
]

CHROME = re.compile(
    r'(Heading|Intro|NoPermission|LoadError|Error$|Loading|NoData|Empty|None$|'
    r'Aria|Placeholder|ApplyFilters|Label$|Filter|Button|Refresh|Export|Tab$|'
    r'Note$|Hint$|Blurb|Title$|Show|Cancel|Save|Close|Done)'
)


CALL_RE = re.compile(r"(?:\bt|\btr)" + re.escape("('") + r"([A-Za-z0-9_]+)'")


def en_strings():
    """key -> English text, across every registered dictionary."""
    out = {}
    for f in sorted(os.listdir(DICTS)):
        if not f.endswith('.ts'):
            continue
        src = io.open(os.path.join(DICTS, f), encoding='utf-8').read()
        # The EN half starts at the EN/en key and runs to the end of the object.
        m = re.search(r'\n  (?:EN|en): \{', src)
        if not m:
            continue
        tail = src[m.end():]
        for km in re.finditer(r"^    ([A-Za-z0-9_]+):\s*(.+?),?\s*$", tail, re.M):
            key, raw = km.group(1), km.group(2)
            if key in out:
                continue
            # Concatenated strings: join the quoted fragments.
            parts = re.findall(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"", raw)
            text = ''.join(a or b for a, b in parts)
            if text:
                out[key] = text.replace("\\'", "'")
    return out


def keys_in(screen_dir):
    """Every translation key the screen renders, in first-seen order.

    Both `t(` and `tr(` — the SLA dashboard aliases the translator to `tr` because it
    already binds `t` to a totals row, and a pattern that only sees `t(` reported that
    screen as displaying nothing at all.
    """
    p = os.path.join(WEB, 'app/(app)', screen_dir, 'page.tsx')
    if not os.path.exists(p):
        return None
    src = io.open(p, encoding='utf-8').read()
    seen, order = set(), []
    for m in CALL_RE.finditer(src):
        k = m.group(1)
        if k not in seen:
            seen.add(k)
            order.append(k)
    return order


def main():
    en = en_strings()
    print('# What each reporting dashboard DISPLAYS')
    print()
    print('Resolved from each screen\'s own translation keys to their English text.')
    print('Chrome (headings, errors, filters, empty states) filtered out by name.')
    print()
    for screen_dir, label in SCREENS:
        keys = keys_in(screen_dir)
        print('=' * 78)
        if keys is None:
            print('%s  —  NO page.tsx at app/(app)/%s' % (label, screen_dir))
            continue
        figures = [k for k in keys if not CHROME.search(k)]
        print('%s   (/%s)' % (label, screen_dir))
        print('  %d keys, %d after removing chrome' % (len(keys), len(figures)))
        print()
        for k in figures:
            text = en.get(k)
            if text is None:
                print('    %-34s (!! no EN string found)' % k)
                continue
            # Prose is not a figure label. A dashboard's intro sentence and its
            # "could not load" line do not follow the naming convention, so they are
            # caught here by LENGTH instead — a figure label is a few words.
            if len(text) > 60:
                continue
            print('    %-34s %s' % (k, text))
        print()


if __name__ == '__main__':
    main()
