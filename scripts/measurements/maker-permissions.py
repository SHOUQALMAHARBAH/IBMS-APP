# -*- coding: utf-8 -*-
"""Which PERMISSION gates the MAKER half of each maker/checker pair?

    python scripts/measurements/maker-permissions.py

## WHY THIS EXISTS AS A SCRIPT RATHER THAN AN ANSWER

The registry has carried `checkerPermission` since it was written, and nothing recorded the
maker's. Item C (decision 22) adds that field — and the owner's instruction was explicit about how
to populate it: **measure it from the ROUTE that writes the maker field, not from the field's
name.** Four readings taken from the name were wrong, and they are the reason this is a derivation:

  * `DataProcessingAgreement`'s maker gate is `vendor.update`, a different family entirely.
  * `Complaint`'s is `complaint.log`, which gates EIGHT routes — so holding it says "may work
    complaints", not "may resolve this one".
  * `AccessRecertificationItem`'s maker is the SUBJECT of the review, so no permission exists, and
    none CAN.
  * `Refund`'s is `endorsement.apply`, NOT `refund.raise` — which exists and is UNENFORCED.

## HOW IT DERIVES

For each registry entry: find the service write of its `makerField` (`makerField: actor…`, the
shape a WRITE takes as opposed to a projection, which reads `makerField: row.makerField`), take the
enclosing method, find the controller handler that calls that method, and read that handler's
nearest preceding `@RequirePermissions`.

Every step is REPORTED rather than silently resolved, because the honest output of a derivation
like this is "here is what I found and here is what I could not" — a single column of permissions
with no working shown is the thing that produced the four wrong answers above.

## WHAT IT IS NOT

It does not decide whether a code is ENFORCED. `refund.raise` exists in the catalogue and gates no
route, which is why recording it would have put a code nothing reads into the one place meant to
answer "who may make this half". That check lives in the guard spec, against the real route table.
"""
import io
import os
import re
import sys

REGISTRY = os.path.join('apps', 'api', 'src', 'common', 'maker-checker-pairs.config.ts')
SRC = os.path.join('apps', 'api', 'src')

FIELD = re.compile(r"(\w+):\s*(?:'([^']*)'|(true|false))")


def read_tree():
    out = {}
    for root, _, files in os.walk(SRC):
        for name in files:
            if name.endswith('.ts') and '.spec.' not in name:
                path = os.path.join(root, name)
                out[path] = io.open(path, encoding='utf-8', errors='replace').read()
    return out


def parse_pairs(text):
    body = text[text.index('export const MAKER_CHECKER_REGISTRY'):]
    out = []
    for block in re.findall(r'\{([^{}]*?)\}', body, re.S):
        got = {}
        for m in FIELD.finditer(block):
            got[m.group(1)] = m.group(2) if m.group(2) is not None else m.group(3)
        if 'entityType' in got and 'dbCheckConstraint' in got:
            out.append(got)
    return out


def enclosing_method(text, index):
    """The nearest `  name(` or `  async name(` at two-space indent above `index`."""
    head = text[:index]
    best = None
    for m in re.finditer(r'\n  (?:async\s+)?(?:private\s+)?(?:async\s+)?([A-Za-z_]\w*)\s*\(', head):
        best = m.group(1)
    return best


def writes_of(tree, field):
    """Service WRITES of a maker field — `field: actor…`, not `field: row.field` projections."""
    hits = []
    pattern = re.compile(re.escape(field) + r':\s*(actor|input\.|dto\.|created\.|user\.)')
    for path, text in tree.items():
        if not path.endswith('.service.ts'):
            continue
        for m in pattern.finditer(text):
            hits.append((path, m.start(), enclosing_method(text, m.start())))
    return hits


def route_for(tree, service_path, method):
    """Controller handlers calling `.<method>(`, with their nearest @RequirePermissions.

    SCOPED TO THE SERVICE'S OWN DIRECTORY, which is the whole difference between a derivation and
    noise: method names here are `create`, `start`, `add`, `approve`, so an unscoped search for
    `.create(` matched thirty-four controllers across the tree and reported every one of them as a
    candidate gate for one pair. The sibling script's header makes the same argument after two
    automatic keys failed there — attribution has to be narrow or it is not attribution.
    """
    service_dir = os.path.dirname(service_path)
    found = []
    for path, text in tree.items():
        if not path.endswith('.controller.ts'):
            continue
        if os.path.dirname(path) != service_dir:
            continue
        for m in re.finditer(r'\.' + re.escape(method) + r'\s*\(', text):
            head = text[: m.start()]
            perms = re.findall(r"@RequirePermissions\(([^)]*)\)", head)
            if not perms:
                continue
            codes = re.findall(r"'([^']+)'", perms[-1])
            verb = re.findall(r'@(Get|Post|Patch|Put|Delete)\(', head)
            found.append((os.path.basename(path), codes, verb[-1] if verb else '?'))
    return found


def main():
    tree = read_tree()
    tree[REGISTRY] = io.open(REGISTRY, encoding='utf-8', errors='replace').read()
    pairs = parse_pairs(tree[REGISTRY])
    assert pairs, 'parsed ZERO pairs — the parser has stopped matching'
    print('%d pairs\n' % len(pairs))

    for p in pairs:
        print('=' * 100)
        print('%s' % p['dbCheckConstraint'])
        print('  maker field   : %s' % p['makerField'])
        print('  checker perm  : %s' % p.get('checkerPermission'))
        hits = writes_of(tree, p['makerField'])
        if not hits:
            print('  WRITES        : none found — the maker may not be written by a route at all')
        for path, _, method in hits:
            base = os.path.basename(path)
            routes = route_for(tree, path, method or '')
            print('  write         : %s#%s' % (base, method))
            if not routes:
                print('                  (no controller handler calls it)')
            for ctrl, codes, verb in routes:
                print('                  %s %s -> %s' % (verb, ctrl, codes))
    return 0


if __name__ == '__main__':
    sys.exit(main())
