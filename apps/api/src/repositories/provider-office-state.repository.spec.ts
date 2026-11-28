import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * 🔴 AND THE SELECT IS BUILT FROM THAT LIST — IT USED TO BE A SECOND COPY, AND THE CONSTANT'S
 * OWN COMMENT CLAIMED IT COULD NOT BE. The full walk §A items 10 and 11, after CI.
 *
 * `PROVIDER_OFFICE_STATE_COLUMNS`' header says it is «kept as one list used for BOTH, so ‘what we
 * select’ and ‘what we checked’ cannot diverge — which they would the first time somebody added a
 * column to one of two lists».
 *
 * There really were two lists. `findAll` named its eighteen columns in a hand-written SQL string,
 * and nothing compared it to the constant — so the commit that added four columns put them in the
 * constant, the row type and `assertViewShape`, and left the SELECT at eighteen. The tests above
 * passed, because they compare the CONSTANT to the VIEW and never the SELECT to either. The rows
 * came back without the fields, `JSON.stringify` DROPS an undefined key, and the payload simply had
 * no `enteredUsers`: no error, no 500, a missing field that reads exactly like a field nobody added.
 *
 * ⚠️ IT WAS CAUGHT IN CI AND COULD NOT HAVE BEEN CAUGHT ON THE AUTHORING MACHINE. `tsc` cannot
 * see across a raw query, and the api e2e that found it does not run there (the db-test `ibms_app`
 * credentials fail locally). ⟶ So these are UNIT tests, in the suite that runs both places, and
 * they assert the structural property rather than the one instance.
 *
 * ⚠️ AND IT IS ONE SITE, CHECKED RATHER THAN GENERALISED. `INSURER_DIRECTORY_COLUMNS` is the only
 * sibling constant of this kind, and it does NOT have the defect: its service projects a row by
 * looping over it (`for (const column of INSURER_DIRECTORY_COLUMNS)`), so the constant really is the
 * one list there.
 */
describe('item (j): the SELECT is derived from the declared list, not written twice', () => {
  const source = readFileSync(
    join(__dirname, 'provider-office-state.repository.ts'),
    'utf8',
  );
  const findAll = source.slice(
    source.indexOf('async findAll('),
    source.indexOf('private async assertViewShape('),
  );

  it('the query body was located — this is not asserting over an empty string', () => {
    expect(findAll).toContain('$queryRaw');
    expect(findAll).toContain('FROM "ProviderOfficeState"');
  });

  it('the SELECT names the derived list', () => {
    expect(findAll).toContain('SELECT ${SELECT_LIST}');
  });

  it('⛔ and no declared column is named inside the query at all', () => {
    /*
     * THE ASSERTION THAT FAILS ON A REGRESSION. Somebody «just adding one column» to the SELECT
     * reintroduces the second list, and the agreement tests above would still pass. So the query is
     * required to name NO declared column directly. `legalName` is exempt because the ORDER BY uses
     * it — and the ORDER BY is asserted separately below, so it cannot be deleted to satisfy this.
     */
    const named = PROVIDER_OFFICE_STATE_COLUMNS.filter(
      (column) => column !== 'legalName' && findAll.includes(`"${column}"`),
    );
    expect(
      named,
      'these columns are named inside findAll\u2019s SQL, so the SELECT list has been hand-written again. Add them to PROVIDER_OFFICE_STATE_COLUMNS instead — the SELECT is built from it.',
    ).toEqual([]);
  });

  it('and the ORDER BY is still there, so the test above is not satisfied by deleting it', () => {
    // A stable order is the repository's own stated reason: a dashboard whose rows move between
    // reloads is one somebody stops trusting.
    expect(findAll).toContain('ORDER BY "legalName" ASC');
  });

  it('every declared column is a plain identifier — the list is interpolated into SQL', () => {
    /*
     * The quoting guard, asserted here as well as thrown at module load. `Prisma.raw` does no
     * escaping, and the safety argument is that every entry is a compile-time literal in that file.
     * This keeps the argument checkable rather than a comment.
     */
    for (const column of PROVIDER_OFFICE_STATE_COLUMNS) {
      expect(
        /^[A-Za-z][A-Za-z0-9]*$/.test(column),
        `"${column}" is not a plain identifier and this list is interpolated into SQL`,
      ).toBe(true);
    }
  });

  it('the four columns added for the full walk are declared', () => {
    /*
     * NON-VACUITY, and the specific regression. The structural assertions above would pass over a
     * constant that had LOST the four names — the SELECT would be derived from a shorter list and
     * name nothing directly — so the names are pinned too.
     */
    for (const column of [
      'renewalProofOnRecord',
      'renewalReferenceOnRecord',
      'renewalDeclarationOnRecord',
      'enteredUsers',
    ]) {
      expect(
        PROVIDER_OFFICE_STATE_COLUMNS as readonly string[],
        `${column} left the declared list; the screen reads it and the payload would silently lose the field`,
      ).toContain(column);
    }
  });
});
