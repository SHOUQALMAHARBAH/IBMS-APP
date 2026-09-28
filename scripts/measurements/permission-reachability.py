# -*- coding: utf-8 -*-
"""For each role: permissions it holds that its NAVIGATION cannot reach.

Twice in one week a permission gated a control its holders had no route to — the DPO held
`sla.timer.pause` and could not open the deadlines dashboard (§ 1.61), and two of three holders of
`access-recertification.cycle.start` had no nav entry for the screen the start-cycle button sits on
(§ 1.71). Two is a pattern, so this is the general check.

## DELIBERATELY NARROW, and here is what defeated the broad version

The first attempt tried to cover every call site, tracing components back to the pages that import
them and matching routes against nav hrefs by substring. It produced **69 false positives**,
including codes plainly reachable (`insurer.create` at `/insurers/new`), for two reasons: a nav
href is `/insurers` while the page route is `/insurers/[id]`, and a regex over `destinations.ts`
truncated on a long comment. Three attempts, three different wrong answers.

A guard that cries wolf 69 times is worse than none — the first false red teaches everyone to
ignore it. So this covers only what it can decide EXACTLY:

  COVERED      a code read directly by an `app/(app)/**/page.tsx`. The page's route is known from
               its path, and a route is reachable when its own route OR AN ANCESTOR of it is a nav
               destination the role can see — an ancestor because `/insurers/[id]` and
               `/insurers/new` are reached from `/insurers`, which is a rule, not a guess.
  NOT COVERED  a code read only by a COMPONENT. Which pages mount it needs the React graph, and
               approximating that is what produced the 69. Counted and named, never judged.

Both real instances above are page-level reads, so the narrow check catches the pattern that
actually occurred while claiming nothing about the rest.

Run:  python scripts/measurements/permission-reachability.py
"""
import io
import os
import re
import sys

WEB = os.path.join('apps', 'web')
APP = os.path.join(WEB, 'app', '(app)')
DESTINATIONS = os.path.join(WEB, 'components', 'app', 'destinations.ts')
FIXTURE = os.path.join(WEB, 'e2e', 'fixtures', 'role-permissions.ts')

READS = re.compile(r"has(?:Any)?Permission\s*\([^)]*?\[?((?:\s*['\"][a-z0-9.\-]+['\"]\s*,?)+)", re.S)
CODE = re.compile(r"['\"]([a-z0-9.\-]+)['\"]")
HREF = re.compile(r"href:\s*'([^']+)'")
PERMS = re.compile(r"permissions:\s*\[([^\]]*)\]", re.S)


def roles_and_codes():
    src = io.open(FIXTURE, encoding='utf-8').read()
    out = {}
    for m in re.finditer(r'"([A-Z_]+)"\s*:\s*\[(.*?)\n  \]', src, re.S):
        out[m.group(1)] = set(re.findall(r"'([a-z0-9.\-]+)'", m.group(2)))
    # Pinned against the fixture's own header, so a parser that matches nothing cannot report that
    # every permission is unreachable.
    assert len(out) == 12, 'expected 12 seeded roles, parsed %d' % len(out)
    assert sum(len(v) for v in out.values()) == 491, 'expected 491 grants'
    return out


def destinations():
    """[(href, [codes])]. Split on `href:` FIRST, so a comment of any length cannot push a
    destination's own `permissions` outside a fixed window — which is what broke the first version."""
    src = io.open(DESTINATIONS, encoding='utf-8').read()
    out = []
    starts = [m.start() for m in HREF.finditer(src)]
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(src)
        chunk = src[start:end]
        href = HREF.search(chunk).group(1)
        perms = PERMS.search(chunk)
        out.append((href, CODE.findall(perms.group(1)) if perms else []))
    assert len(out) > 40, 'parsed only %d destinations — the matcher drifted' % len(out)
    return out


def page_routes():
    """{route: codes read directly by that page file}."""
    out = {}
    for root, _, files in os.walk(APP):
        if 'node_modules' in root or '.next' in root:
            continue
        if 'page.tsx' not in files:
            continue
        norm = os.path.join(root, 'page.tsx').replace('\\', '/')
        seg = norm.split('/app/(app)/', 1)[1][: -len('/page.tsx')]
        route = '/' + seg if seg else '/'
        src = io.open(os.path.join(root, 'page.tsx'), encoding='utf-8', errors='replace').read()
        codes = set()
        for m in READS.finditer(src):
            codes |= set(CODE.findall(m.group(1)))
        out[route] = codes
    return out


def ancestors(route):
    """`/insurers/[id]` -> ['/insurers/[id]', '/insurers'].

    The ROOT IS EXCLUDED, and that exclusion is the whole check. `/` is an ungated destination — the
    launcher, which everyone can open — so including it made every route in the app an ancestor-hop
    from something visible, and the check reported 0 findings whether or not a gap existed. Both
    plants killed nothing until this line changed.

    The launcher does link onward, but its cards are permission-gated one by one
    (`home-launcher.spec.ts` pins that a role is offered no card it cannot open), so reaching `/`
    says nothing about reaching any particular screen.
    """
    parts = [p for p in route.split('/') if p]
    out = []
    while parts:
        out.append('/' + '/'.join(parts))
        parts.pop()
    return out


def component_only_codes(page_code_sets):
    """Codes read somewhere in web/ but by no page file — the uncovered bucket."""
    on_pages = set()
    for codes in page_code_sets.values():
        on_pages |= codes
    elsewhere = set()
    for root, _, files in os.walk(WEB):
        if 'node_modules' in root or '.next' in root or os.sep + 'e2e' in root:
            continue
        for name in files:
            if not name.endswith(('.ts', '.tsx')) or name == 'page.tsx':
                continue
            src = io.open(os.path.join(root, name), encoding='utf-8', errors='replace').read()
            for m in READS.finditer(src):
                elsewhere |= set(CODE.findall(m.group(1)))
    return elsewhere - on_pages


def main():
    roles = roles_and_codes()
    dests = destinations()
    pages = page_routes()
    uncovered = component_only_codes(pages)

    pairs = sum(len(v) for v in roles.values())
    covered_codes = set()
    for codes in pages.values():
        covered_codes |= codes

    findings = {}
    for role, held in sorted(roles.items()):
        visible = {
            href for href, need in dests if not need or any(c in held for c in need)
        }
        for code in sorted(held & covered_codes):
            reachable = False
            for route, codes in pages.items():
                if code not in codes:
                    continue
                if any(a in visible for a in ancestors(route)):
                    reachable = True
                    break
            if not reachable:
                findings.setdefault(code, []).append(role)

    print('(role, permission) pairs in the seeded grid        %5d' % pairs)
    print('  codes read directly by a page.tsx  (COVERED)     %5d' % len(covered_codes))
    print('  codes read only by a component (NOT COVERED)     %5d' % len(uncovered))
    print('  covered (role, code) pairs with NO NAV ROUTE     %5d'
          % sum(len(v) for v in findings.values()))
    print()
    if findings:
        print('NO NAV ROUTE to any page that reads this code:')
        for code, rs in sorted(findings.items()):
            print('  %-38s %s' % (code, ', '.join(sorted(rs))))
    else:
        print('NO NAV ROUTE: none. Every page-level permission has a route for every holder.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
