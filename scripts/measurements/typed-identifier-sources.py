#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
WHAT WOULD IT COST TO CLOSE EACH TYPED IDENTIFIER FIELD?

    python scripts/measurements/typed-identifier-sources.py

`typed-identifier-inputs.py` counts the fields a person has to PASTE A UUID INTO and
gates the figure at 26. It does not say what closing one would cost, and the answers
differ by an order of magnitude: wiring a component that already ships, against building
a search route, against a field no picker can ever close, against a field that is already
correct and must be LEFT ALONE.

THE HEADLINE: fourteen of the twenty-six are WIRING, and `branch` is a source with ZERO
CONSUMERS. The component ships, the route ships, `BRANCH_SEARCH_CODES` names six
dashboard codes plus `insurer-performance.view` — and `picker-route-reachability.mjs`
reports `0 stuck` over all eleven screens that type a `branchId`. So somebody measured
the gates, WIDENED THEM FOR THESE EXACT SCREENS, and not one screen reaches for the
source. `INSURER_SEARCH_CODES`' own comment reads *"six dashboard/report screens type an
`insurerId`"* — the anticipation written down beside the thing it anticipated.

## THE FIELD-TO-SOURCE MAP IS DERIVED FROM THE PRODUCT, NOT FROM THE SUFFIX

This script's first version guessed the source from the field name, and the guess was
wrong four times in one run — which is why the map is now read off the `<EntitySearch>`
mounts that already ship:

  * `ownerId` is NOT a user. On `/consent` it is the consent DATA SUBJECT (customer,
    insured person or lead) and on `/payment-channels` it is a customer OR an insurer,
    both chosen by a sibling kind selector. Guessing `user` from the name would have
    pointed a picker at the wrong table.
  * `eventPiPolicyId` names a `ProfessionalIndemnityPolicy`, a different model from
    `Policy`, so the `policy` source would answer nothing for every term.
  * `documentId` on `/audit-trail` is CORRECT AS IT STANDS — owner decision 41 gates the
    chooser on `document.read` alone so the EXTERNAL_AUDITOR keeps the typed field, and
    the comment at that site argues it. A report that called it a gap would have somebody
    "fix" a decision.
  * `wfEntityId` already HAS a chooser for one of its eighteen types.

So three of the six classes below exist only because reading the sites contradicted the
field names. A suffix convention is a hypothesis; the mounts are the measurement.

## What it does NOT claim

That a wired picker would work. Whether every reader of a screen can reach the route is
`picker-route-reachability.mjs`'s question, answered against the seeded grid, and both
have to be green before a screen is changed — `filterCustomerId` is the worked example:
its route is gated on codes `/consent`'s own reader does not hold.

A REPORT, not a gate. The gate is `typed-identifier-inputs.py`, whose budget must come
DOWN as sites are closed and never up.
"""
import io
import os
import re
import sys

WEB = os.path.join('apps', 'web')
SOURCES_FILE = os.path.join(WEB, 'components', 'ui', 'EntitySearch.tsx')
SCREEN_ROOT = os.path.join(WEB, 'app', '(app)')
INPUTS = os.path.join('scripts', 'measurements', 'typed-identifier-inputs.py')

MOUNT = re.compile(r'<EntitySearch\b(.*?)/>', re.S)
MOUNT_KIND = re.compile(r'kind="([a-zA-Z]+)"')
MOUNT_VALUE = re.compile(r'value=\{([A-Za-z0-9_]+)\}')
SOURCE_DECL = re.compile(r'^  ([a-z][a-zA-Z]*): \{$', re.M)

# (screen, field) -> it is CORRECT as a typed field and must not be "fixed".
CORRECT_BY_DECISION = {
    ('audit-trail', 'documentId'):
        'Owner decision 41. `GET /documents/search` is gated on `document.read` ALONE so the '
        'EXTERNAL_AUDITOR sees NO chooser and keeps the typed field — widening it would hand a '
        'read-only auditor a name search over every KYC pack and incident report in the office, '
        'when what the role is entitled to is the history of a document it already has the id '
        'of. The chooser IS rendered for `document.read`; the argument is at the site and in '
        '`picker-search.config.ts`.',
}

# (screen, field) -> a chooser already serves PART of this field's range.
PARTLY_CLOSED = {
    ('consent', 'ownerId'):
        'THREE-WAY, and one third is closed: when the kind selector says `customer` the screen '
        "renders the `customer` chooser. The typed field is what an INSURED PERSON or a LEAD "
        "falls back to, and neither model has a search route — an insured person's identifiers "
        'are encrypted per value with a random IV, so a number cannot be matched at all and a '
        'route would have to search names only.',
    ('audit-trail', 'wfEntityId'):
        'ONE OF EIGHTEEN is closed: the `customer` chooser appears when the sibling type select '
        'says `Customer`. The other seventeen workflow entity types have no name search, which '
        'is recorded in the screen-pass measurement as not closable by a picker rather than as '
        'unfinished work.',
}

# (screen, field) -> closing it needs a decision that is not an engineering one.
BLOCKED_ON_A_DECISION = {
    ('consent', 'filterCustomerId'):
        "The SOURCE exists and the GATE does not admit this screen's reader: "
        '`CUSTOMER_SEARCH_CODES` is `customer.read` + `dsr.log`, and `/consent` is gated on '
        '`consent.manage`. Adding that code is permitted by the house rule — but it would not '
        'help, because `CustomerService` then filters results to the customers the actor OWNS '
        "and the DATA_PROTECTION_OFFICER owns none. That is the one cause behind the owner's "
        'items 2.2 and 2.7, and it is a GRANT decision reserved to her.',
}

# field -> the MODEL a route would have to search, and what makes it hard.
NEEDS_A_ROUTE = {
    'claimId': 'Claim. A claim carries a `claimNumber` that is broker-internal and OPTIONAL '
               '(null on 78 of 82 claims measured), so a route would have to search the '
               'customer and the loss date rather than a reference.',
    'vendorId': 'Vendor. The third party a data-sharing approval is for — the record that makes '
                'sending personal data to them lawful at all. A vendor has a name, so this is '
                'the most ordinary of the seven.',
    'eventPiPolicyId': 'ProfessionalIndemnityPolicy — a DIFFERENT model from `Policy`. The '
                       'existing `policy` source would search the wrong table and answer '
                       'nothing for every term, which is why this map is derived and not '
                       'guessed.',
    'extendHoldId': 'LegalHold. A hold has a scope and a reason rather than a name, so what a '
                    'picker would DISPLAY is a question before a route is.',
    'holdCategoryId': 'RetentionScheduleItem — the record CATEGORY, which is free text '
                      '(`recordCategory`, String 1..200, resolved to a model by nothing). A '
                      'picker over it lists what this office has typed, which is a different '
                      'thing from a vocabulary.',
    'nominateCategoryId': 'RetentionScheduleItem — the same category field on the nominate form.',
    'holdInsuredPersonId': 'InsuredPerson. Its identifiers are ENCRYPTED per value with a random '
                           'IV, so the same number stored twice is two different ciphertexts and '
                           'there is nothing to match. Name only.',
}

# field -> why NO picker can close it, ever.
UNCLOSABLE = {
    'browseEntityId': "POLYMORPHIC over an OPEN set: the audit log's `entityType` holds 32 "
                      'distinct values on dev and 139 on db-test, so there is no closed list to '
                      'choose a source from — and a label map over it would be `t(undefined)` '
                      'for every type nobody has named.',
}


# field -> a source that EXISTS and has NO CONSUMER YET, so there is no mount to derive
# from. `branch` is the whole of this map and is this report's headline: the component,
# the route and a gate naming seven of these very screens all ship, and not one screen
# reaches for it. The entry is DECLARED rather than guessed from the suffix, which is the
# same discipline the rest of the map follows — and the script REFUSED until it was
# written, naming all eight sites, which is the floor working.
SOURCE_WITHOUT_A_CONSUMER = {
    'branchId': 'branch',
}


def sources_that_exist():
    src = io.open(SOURCES_FILE, encoding='utf-8').read()
    found = SOURCE_DECL.findall(src)
    if len(found) < 3:
        sys.stderr.write(
            'REFUSED: read %d ENTITY_SOURCES from %s. The declaration shape moved and this '
            'script would report every field as unserviceable, which is the clean-nothing '
            'failure it exists to avoid.\n' % (len(found), SOURCES_FILE))
        raise SystemExit(2)
    return set(found)


def mounted_kinds():
    """field name -> the set of `kind`s a shipping `<EntitySearch>` binds it to.

    THE MEASUREMENT behind the field-to-source map. Read off the product rather than
    inferred from the suffix, because the suffix was wrong four times.
    """
    out = {}
    for dp, _d, ns in os.walk(SCREEN_ROOT):
        if 'page.tsx' not in ns:
            continue
        src = io.open(os.path.join(dp, 'page.tsx'), encoding='utf-8').read()
        if 'EntitySearch' not in src:
            continue
        for m in MOUNT.finditer(src):
            k, v = MOUNT_KIND.search(m.group(1)), MOUNT_VALUE.search(m.group(1))
            if k and v:
                out.setdefault(v.group(1), set()).add(k.group(1))
    if len(out) < 5:
        sys.stderr.write(
            'REFUSED: read %d mounted field(s). The `<EntitySearch>` call shape moved, so the '
            'field-to-source map would be empty and every site would read as needing a route.\n'
            % len(out))
        raise SystemExit(2)
    return out


def typed_sites():
    """Re-use the gate's own CONSTANTS rather than restating its pattern.

    The scan loop lives inside that script's `main()`, so the loop is repeated here while
    the PATTERNS are imported — which is the half that must not have two homes, since a
    second copy of `VALUE_BINDING` is a second answer to *what is a typed identifier*.
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location('tii', INPUTS)
    mod = importlib.util.module_from_spec(spec)
    argv, sys.argv = sys.argv, ['typed-identifier-inputs']
    try:
        spec.loader.exec_module(mod)
    except SystemExit:
        pass
    finally:
        sys.argv = argv

    rows = []
    paths = sorted(mod.SCREENS.rglob('page.tsx'))
    if len(paths) < mod.MINIMUM_SCREENS_SCANNED:
        sys.stderr.write(
            "REFUSED: %d screen(s) against the gate's own floor of %d. The screen root "
            "moved, and a report that scans nothing reads exactly like a clean one.\n"
            % (len(paths), mod.MINIMUM_SCREENS_SCANNED))
        raise SystemExit(2)
    for path in paths:
        lines = path.read_text(encoding='utf-8').split('\n')
        for i, line in enumerate(lines):
            if not mod.INPUT_OPEN.search(line):
                continue
            chunk = '\n'.join(lines[i:i + 8])
            end = chunk.find('/>')
            if end == -1:
                end = chunk.find('>')
            element = chunk[:end + 1] if end != -1 else chunk
            if mod.SELECT_OPEN.search(element):
                continue
            m = mod.VALUE_BINDING.search(element)
            if not m:
                continue
            name = m.group(1)
            if name.endswith('.id'):
                continue
            screen = str(path.relative_to(mod.SCREENS).parent).replace(os.sep, '/')
            if (screen, name) in mod.HAND_VERIFIED_CORRECT:
                continue
            rows.append((screen, i + 1, name))
    return rows


def main():
    have = sources_that_exist()
    mounts = mounted_kinds()
    rows = typed_sites()
    if not rows:
        sys.stderr.write(
            'REFUSED: the typed-identifier scanner returned nothing. A measurement that '
            'finds no sites reads exactly like a tree with none.\n')
        raise SystemExit(2)

    wiring, decided, partly, blocked, route, unclosable, unknown = [], [], [], [], [], [], []
    for screen, line, field in rows:
        key = (screen, field)
        if key in CORRECT_BY_DECISION:
            decided.append((screen, line, field))
        elif key in PARTLY_CLOSED:
            partly.append((screen, line, field))
        elif key in BLOCKED_ON_A_DECISION:
            blocked.append((screen, line, field))
        elif field in mounts and len(mounts[field]) == 1:
            kind = next(iter(mounts[field]))
            (wiring if kind in have else unknown).append((screen, line, field, kind))
        elif field in SOURCE_WITHOUT_A_CONSUMER:
            kind = SOURCE_WITHOUT_A_CONSUMER[field]
            (wiring if kind in have else unknown).append((screen, line, field, kind))
        elif field in NEEDS_A_ROUTE:
            route.append((screen, line, field))
        elif field in UNCLOSABLE:
            unclosable.append((screen, line, field))
        else:
            unknown.append((screen, line, field, '?'))

    bar = '=' * 96
    unused = sorted(have - {k for ks in mounts.values() for k in ks})
    print('ENTITY_SOURCES that ship        %s' % ', '.join(sorted(have)))
    print('sources with ZERO consumers     %s' % (', '.join(unused) or 'none'))
    print('typed identifier sites          %d' % len(rows))
    print()

    print(bar)
    print('WIRING ONLY  the source, the route and the widened gate all ship  %d' % len(wiring))
    print('  (the field-to-source pairing below is read off the mounts that already ship)')
    for screen, line, field, kind in sorted(wiring):
        print('  %-42s L%-5s %-20s -> kind="%s"' % (screen, line, field, kind))

    for title, items, notes in (
        ('CORRECT AS IT STANDS  do not "fix" these', decided, CORRECT_BY_DECISION),
        ('PARTLY CLOSED  a chooser already serves part of the range', partly, PARTLY_CLOSED),
        ("BLOCKED ON A DECISION OF THE OWNER'S", blocked, BLOCKED_ON_A_DECISION),
    ):
        print()
        print(bar)
        print('%s  %d' % (title, len(items)))
        for screen, line, field in sorted(items):
            print('  %-42s L%-5s %s' % (screen, line, field))
            print('      %s' % notes[(screen, field)])

    print()
    print(bar)
    print('NEEDS A ROUTE  no source serves this model  %d' % len(route))
    for screen, line, field in sorted(route):
        print('  %-42s L%-5s %s' % (screen, line, field))
        print('      %s' % NEEDS_A_ROUTE[field])

    print()
    print(bar)
    print('NO PICKER CAN CLOSE IT  %d' % len(unclosable))
    for screen, line, field in sorted(unclosable):
        print('  %-42s L%-5s %s' % (screen, line, field))
        print('      %s' % UNCLOSABLE[field])

    total = len(wiring) + len(decided) + len(partly) + len(blocked) + len(route) + len(unclosable)
    if unknown or total != len(rows):
        print()
        print(bar)
        print('UNCLASSIFIED  %d  classify it, with the MODEL a route would search' % len(unknown))
        for screen, line, field, kind in sorted(unknown):
            print('  %-42s L%-5s %-20s (%s)' % (screen, line, field, kind))
        print()
        print('typed-identifier-sources: REFUSED. %d of %d site(s) accounted for. An '
              'unclassified field is a field whose cost nobody has read, and answering exactly '
              'that is what this report is for.' % (total, len(rows)))
        raise SystemExit(1)

    print()
    print('typed-identifier-sources: a REPORT, not a gate. %d of %d sites are WIRING. Lower '
          '`TYPED_IDENTIFIER_BUDGET` as sites close; never raise it.' % (len(wiring), len(rows)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
