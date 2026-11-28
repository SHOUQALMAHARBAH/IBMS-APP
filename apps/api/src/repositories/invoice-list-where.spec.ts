import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  OPEN_INVOICE_STATUSES,
  buildInvoiceListWhere,
} from './invoice.repository';

/**
 * THE INVOICE LIST'S `where`, PROVEN HERE BECAUSE IT CAN BE.
 *
 * `findPageWithNames` used to build this filter inline inside a `$transaction([findMany, count])`,
 * and that form is refused under tenant isolation — see `prisma/transaction-form.spec.ts`. Pulling
 * the filter out into `buildInvoiceListWhere` was what made the page and the count agree; ⟶ **it
 * also made every branch of the filter a pure function this machine can prove**, where before it
 * was reachable only through a real database and therefore only through an api e2e that does not
 * run here.
 *
 * That is the same lesson #80 paid for twice, pointed the other way: when a fix makes something
 * locally verifiable, verify it locally.
 */
describe('buildInvoiceListWhere — decision 167/13', () => {
  const base = { openOnly: false, skip: 0, take: 50 };

  it('⛔ asks for nothing it was not given', () => {
    // The empty filter is the book-wide, everything-included read. A stray clause here would
    // silently narrow a finance officer's screen.
    expect(buildInvoiceListWhere(base)).toEqual({});
  });

  it('`openOnly` narrows to the open statuses and nothing else', () => {
    expect(buildInvoiceListWhere({ ...base, openOnly: true })).toEqual({
      status: { in: [...OPEN_INVOICE_STATUSES] },
    });
  });

  it('⛔ and `openOnly: false` writes no status clause at all', () => {
    // NOT `status: { in: everything }` — an absent clause and an exhaustive one read the same
    // today and diverge the moment a seventh status exists.
    expect(
      buildInvoiceListWhere({ ...base, openOnly: false }),
    ).not.toHaveProperty('status');
  });

  it('the insurer is filtered THROUGH the policy, because `Invoice` has no insurer column', () => {
    expect(buildInvoiceListWhere({ ...base, insurerId: 'ins-1' })).toEqual({
      policy: { insurerId: 'ins-1' },
    });
  });

  it('`search` matches the policy number and the customer name, case-insensitively', () => {
    const where = buildInvoiceListWhere({ ...base, search: 'acme' });
    expect(where.OR).toEqual([
      { policy: { policyNumber: { contains: 'acme', mode: 'insensitive' } } },
      { customer: { legalName: { contains: 'acme', mode: 'insensitive' } } },
    ]);
  });

  it('⛔ and `search` NEVER matches the invoice id', () => {
    /*
     * The whole of decision 167/13 is that no uuid is typed or shown. A search that matched the id
     * would be a box inviting one — and `check:typed-identifiers` cannot see a server-side filter,
     * so this is where that stays true.
     */
    expect(
      JSON.stringify(buildInvoiceListWhere({ ...base, search: 'x' })),
    ).not.toContain('"id"');
  });

  it('the three clauses COMPOSE rather than displacing one another', () => {
    const where = buildInvoiceListWhere({
      ...base,
      openOnly: true,
      insurerId: 'ins-1',
      search: 'acme',
    });
    expect(where.status).toEqual({ in: [...OPEN_INVOICE_STATUSES] });
    expect(where.policy).toEqual({ insurerId: 'ins-1' });
    expect(where.OR).toHaveLength(2);
  });

  it('⚠️ and the insurer clause and the search clause both name `policy` without colliding', () => {
    /*
     * THE ONE THAT WOULD HAVE BITTEN. Both the insurer filter and the search write a `policy` key,
     * and the search's lives inside `OR` — so a later edit that hoisted the policy-number match out
     * of `OR` would silently overwrite the insurer filter and widen the read to every insurer.
     * Pinned: the top-level `policy` carries the insurer, the search's carries the number.
     */
    const where = buildInvoiceListWhere({
      ...base,
      insurerId: 'ins-1',
      search: 'POL-9',
    });
    expect(where.policy).toEqual({ insurerId: 'ins-1' });
    expect(JSON.stringify(where.OR)).toContain('POL-9');
    expect(JSON.stringify(where.policy)).not.toContain('POL-9');
  });

  it('⛔ an empty `search` string is not a filter', () => {
    // `?search=` from a cleared box must read as "no search", not as "contains nothing".
    expect(buildInvoiceListWhere({ ...base, search: '' })).not.toHaveProperty(
      'OR',
    );
  });
});

describe('OPEN_INVOICE_STATUSES is the schema minus REMITTED, derived not listed', () => {
  /**
   * 🔴 THE LIST IS HAND-WRITTEN AND THE ENUM IS NOT, SO THIS IS WHERE THEY ARE MADE TO AGREE.
   *
   * `OPEN_INVOICE_STATUSES` is five literals. `InvoiceStatus` has six members. A seventh member
   * added later would be silently treated as CLOSED — so an invoice in that new status would vanish
   * from the finance officer's screen, which is the surface decision 167/13 exists to give them.
   * ⟶ The members are parsed out of `schema.prisma`, so the commit that adds one fails BY NAME here
   *   and whoever adds it has to say whether it is open.
   *
   * This is `declared-vocabulary.test.ts`'s own shape, for the same reason.
   */
  const schema = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'packages',
      'db',
      'prisma',
      'schema.prisma',
    ),
    'utf8',
  );

  function schemaMembers(): string[] {
    const block = /enum InvoiceStatus \{([^}]*)\}/.exec(schema);
    if (!block)
      throw new Error('enum InvoiceStatus not found in schema.prisma');
    return block[1]
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter((l) => l.length > 0);
  }

  it('finds the enum at all — the premise, not an assumption', () => {
    expect(schemaMembers().length).toBeGreaterThan(1);
    expect(schemaMembers()).toContain('REMITTED');
  });

  it('every member is either open or REMITTED, with nothing unclassified', () => {
    const unclassified = schemaMembers().filter(
      (m) =>
        m !== 'REMITTED' &&
        !(OPEN_INVOICE_STATUSES as readonly string[]).includes(m),
    );
    expect(
      unclassified,
      'a new InvoiceStatus member must be classified: add it to OPEN_INVOICE_STATUSES, or state here why it is closed. ' +
        'An unclassified status is an invoice nobody can find on /invoices.',
    ).toEqual([]);
  });

  it('⛔ and nothing in the open list has left the schema', () => {
    const members = schemaMembers();
    const stale = (OPEN_INVOICE_STATUSES as readonly string[]).filter(
      (s) => !members.includes(s),
    );
    expect(
      stale,
      'OPEN_INVOICE_STATUSES names a status the schema no longer has',
    ).toEqual([]);
  });

  it('⛔ REMITTED is the only closed status, and it really is excluded', () => {
    expect(OPEN_INVOICE_STATUSES as readonly string[]).not.toContain(
      'REMITTED',
    );
    expect(OPEN_INVOICE_STATUSES).toHaveLength(schemaMembers().length - 1);
  });
});
