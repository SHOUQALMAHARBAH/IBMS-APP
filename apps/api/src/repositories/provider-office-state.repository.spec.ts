import { describe, expect, it, vi } from 'vitest';
import {
  PROVIDER_OFFICE_STATE_COLUMNS,
  ProviderOfficeStateRepository,
} from './provider-office-state.repository';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * MODULE 0 ITEM (j) — the column boundary, tested where it can actually fail.
 *
 * A PLANT SURVIVED the e2e against this: removing `await this.assertViewShape()` changed nothing,
 * because the declared list and the view agree today, so the check passing or being absent produce
 * the same answer. That is the shape of a guard nothing observes.
 *
 * So the check is exercised against a column set that DISAGREES, in both directions — a view missing
 * a declared column, and a view carrying one nobody declared. The second is the disclosure
 * direction: this is a CROSS-OFFICE read, and an undeclared column is a column nobody argued for.
 */

function repositoryOver(columns: string[]): ProviderOfficeStateRepository {
  const queryRaw = vi.fn().mockImplementation((sql: unknown) => {
    // The shape check asks pg_attribute; the data read asks the view. Discriminated on the SQL text
    // so one mock serves both and the test cannot pass by answering the wrong query.
    const text = JSON.stringify(sql);
    if (text.includes('pg_attribute')) {
      return Promise.resolve(columns.map((attname) => ({ attname })));
    }
    return Promise.resolve([]);
  });
  return new ProviderOfficeStateRepository({
    client: { $queryRaw: queryRaw },
  } as unknown as PrismaService);
}

describe('item (j): the view and the declared column list must agree', () => {
  it('passes when they match exactly', async () => {
    // The control. Without it, a check that threw on EVERYTHING would pass the two tests below and
    // the dashboard would never work — a guard that refuses the correct case is not a guard.
    const repo = repositoryOver([...PROVIDER_OFFICE_STATE_COLUMNS]);
    await expect(repo.findAll()).resolves.toEqual([]);
  });

  it('REFUSES a view missing a declared column, naming it', async () => {
    // A missing column is a runtime failure in a raw query, and Postgres's own message
    // (`column "x" does not exist`) names the column but not why anybody expected it.
    const repo = repositoryOver(
      PROVIDER_OFFICE_STATE_COLUMNS.filter(
        (c) => c !== 'dormantLicensedBranches',
      ),
    );
    await expect(repo.findAll()).rejects.toThrow(/dormantLicensedBranches/);
  });

  it('REFUSES a view carrying an UNDECLARED column — the disclosure direction', async () => {
    /*
     * The direction that matters most. Somebody widens the view for one reason; the next careless
     * change here carries the new column to a cross-office screen. The check fails before any row
     * is read, and the message names the column and the migration to read first.
     */
    const repo = repositoryOver([
      ...PROVIDER_OFFICE_STATE_COLUMNS,
      'premiumWrittenThisYear',
    ]);
    await expect(repo.findAll()).rejects.toThrow(/premiumWrittenThisYear/);
    await expect(repo.findAll()).rejects.toThrow(/CROSS-OFFICE/);
  });

  it('the declared list is not empty — not vacuous', () => {
    // If the list were emptied, the first test would compare two empty sets and pass, and the
    // repository would select nothing while reporting agreement.
    expect(PROVIDER_OFFICE_STATE_COLUMNS.length).toBeGreaterThan(10);
    expect(PROVIDER_OFFICE_STATE_COLUMNS).toContain('organizationId');
  });
});
