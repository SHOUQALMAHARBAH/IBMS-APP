import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A SCREENING IDENTIFIER IS NEVER CHANGED WITHOUT BEING RE-SCREENED — and the other six are never
 * changed at all.
 *
 * ## WHY THIS GUARD EXISTS AT ALL
 *
 * The owner's 2026-09-28 deferral refused *editing any screening identifier*, and her strike of
 * 2026-10-28 opens exactly two of them — `dateOfBirth` and `nationality` — on the ground that the
 * controlled path now records who, when, before, after, a written reason, **and re-screens**. Every
 * word of that is the safety case. A second write path that skipped the re-screen would not be a
 * missing feature; it would retire the reason the strike was safe, silently, and nothing else in the
 * build would notice.
 *
 * So this asserts four properties, three of them as ABSENCES, which is the only form that can fail:
 *
 *   1. `updateIdentifiers` has exactly ONE non-spec caller, and that caller re-screens.
 *   2. No file outside the repository writes `dateOfBirth` or `nationality` onto a `Customer` through
 *      a Prisma update.
 *   3. The other six identifiers are absent from every DTO that reaches a customer update — that is
 *      the 2026-09-28 deferral's safety condition 1, layer 1, and it must still hold afterwards.
 *   4. `UpdateCustomerContactDto` still declares exactly three fields, which is layer 2's premise.
 *
 * ## A SWEEP RATHER THAN A LIST
 *
 * Every `.ts` under `apps/api/src` is read, specs excluded. A hand-kept allow-list of files permitted
 * to write an identifier would go stale the first time a module was added, which is the failure mode
 * `insurance-company-license.inventory.spec.ts` records in its own header.
 *
 * COMMENTS ARE STRIPPED FIRST. This file's own prose names `nationality` and `dateOfBirth` a dozen
 * times, and so does the DTO that refuses them — a sweep that read comments would flag the
 * documentation of the rule as a breach of it, which is the defect `check:seed-sweeps` paid for.
 */

// File-scoped, never global: this spec walks the api source tree, and vitest's 5000ms default is a
// real signal for the thousands of ordinary tests beside it.
vi.setConfig({ testTimeout: 60_000 });

const API_SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (name.endsWith('.ts') && !name.includes('.spec.')) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(API_SRC);

/** The file with comments removed. See the header: without this the rule's own documentation is a
 *  finding. */
function code(path: string): string {
  return readFileSync(path, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function relative(path: string): string {
  return path.slice(API_SRC.length + 1).replace(/\\/g, '/');
}

describe('a screening identifier is never changed without a re-screen', () => {
  it('finds the api source tree it claims to read — the non-vacuity floor', () => {
    // A sweep that reads nothing reports a clean nothing, which is indistinguishable from a sweep
    // that found no breach. The floor is deliberately well below the real figure (278 files at the
    // time of writing) so it refuses a BROKEN walk rather than a grown codebase.
    expect(FILES.length).toBeGreaterThan(150);
    expect(
      FILES.some((f) => relative(f) === 'modules/customer/customer.service.ts'),
    ).toBe(true);
  });

  it('calls updateIdentifiers from exactly one place, and that place re-screens', () => {
    const callers = FILES.filter(
      (f) =>
        /\.updateIdentifiers\s*\(/.test(code(f)) &&
        !relative(f).startsWith('repositories/'),
    ).map(relative);

    expect(
      callers,
      'updateIdentifiers writes a screening discriminator. Every caller must re-screen (Jordan AMLU: screening is required "Upon KYC reviews or CHANGES TO A CUSTOMER\'S INFORMATION"), and the owner\'s 2026-10-28 strike of her own deferral rests on that. A second caller is a second answer to whether a corrected identifier is re-checked.',
    ).toEqual(['modules/customer/customer.service.ts']);

    const service = code(
      join(API_SRC, 'modules', 'customer', 'customer.service.ts'),
    );
    expect(
      /this\.screening\.run\(/.test(service),
      'the one caller of updateIdentifiers no longer re-screens — which retires the reason the 2026-09-28 deferral was struck',
    ).toBe(true);
  });

  it('writes dateOfBirth or nationality onto a Customer from nowhere else', () => {
    // The shape a second write path would take: a Prisma update on `customer` carrying either field.
    // Matched on the UPDATE rather than on the field name alone, because `buildScreeningSubjects`,
    // the hold evaluator and four view mappers all legitimately READ both.
    const offenders = FILES.filter((f) => {
      const src = code(f);
      if (relative(f) === 'repositories/customer.repository.ts') return false;
      return /customer\.update(Many)?\s*\(\s*\{[\s\S]{0,400}?(dateOfBirth|nationality)\s*:/.test(
        src,
      );
    }).map(relative);

    expect(
      offenders,
      "a Customer's date of birth or nationality is written outside CustomerRepository. Both are screening discriminators: the write belongs behind `updateIdentifiers`, whose one caller re-screens.",
    ).toEqual([]);
  });

  it('keeps the other six identifiers out of every customer-update DTO', () => {
    // SAFETY CONDITION 1, LAYER 1, asserted after the strike rather than taken on trust. The owner
    // opened two fields; `legalName`, the four name parts, `nationalId` and `registrationNumber`
    // stay *"exactly as the 2026-09-28 deferral left them — do not build, do not extend"*.
    const forbidden = [
      'legalName',
      'givenName',
      'fatherName',
      'grandfatherName',
      'familyName',
      'nationalId',
      'registrationNumber',
    ];
    const dtos = [
      'modules/customer/dto/update-customer-contact.dto.ts',
      'modules/customer/dto/correct-customer-identifiers.dto.ts',
    ];

    for (const dto of dtos) {
      const src = code(join(API_SRC, ...dto.split('/')));
      for (const field of forbidden) {
        // The DECLARATION shape — `field?: type` or `field!: type` at the end of a property — rather
        // than any mention, since a validator's message may legitimately name a field.
        const declared = new RegExp(`\\b${field}[?!]?\\s*:\\s*\\w`).test(src);
        expect(
          declared,
          `${dto} declares \`${field}\`. That identifier is inside the 2026-09-28 deferral, which the owner struck for dateOfBirth and nationality ONLY. Read IMPROVEMENTS.md § The 2026-09-28 deferral before adding it.`,
        ).toBe(false);
      }
    }
  });

  it('keeps the contact write to its three fields — safety condition 1, layer 2', () => {
    const repo = code(join(API_SRC, 'repositories', 'customer.repository.ts'));
    const signature =
      /updateContactDetails\([\s\S]*?\)\s*:\s*Promise<Customer>/.exec(repo);
    expect(
      signature,
      'updateContactDetails no longer has a readable signature — the sweep cannot check layer 2',
    ).not.toBeNull();

    // TYPED rather than inferred: `String.prototype.match` is declared as returning
    // `RegExpMatchArray | null`, and with `noUncheckedIndexedAccess` the `?? []` branch widens the
    // element type to `any` — which eslint refuses here (five errors on one line), correctly, since
    // an `any` flowing into an assertion is an assertion about nothing.
    const accepted: string[] =
      (signature?.[0] ?? '').match(/^\s+(\w+)\??:/gm) ?? [];
    expect(
      accepted.map((m) => m.trim().replace(/\??:$/, '')),
      'the contact write accepts something other than its three fields. That signature IS the second of the three layers keeping six identifiers uneditable — *"even a service bug cannot pass a name"*. A new field belongs in `updateIdentifiers`, which re-screens.',
      // `data` is the parameter the three fields sit inside — the parser reads every property
      // declaration in the signature, and that is one of them.
    ).toEqual([
      'id',
      'data',
      'contactPhoneEnc',
      'contactEmailEnc',
      'registeredAddress',
    ]);
  });
});
