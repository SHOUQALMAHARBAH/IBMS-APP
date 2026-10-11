import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  requiredCapitalForType,
  typesInScope,
  type ScopedBranch,
} from './broker-license-scope.config';

/**
 * THE ASSUMPTION MODULE 0 ITEM (e) RESTS ON, MADE EXPLICIT.
 *
 * ## The assumption
 *
 * **An office cannot be licensed for an insurance TYPE in which it holds no branches.**
 *
 * Item (e) derives a licence's types from the categories of its branches, which means such a
 * licence is not merely disallowed — it is UNREPRESENTABLE. That is a strong property and a good
 * one, but it is load-bearing, so it must not be implicit.
 *
 * ## Why it is believed, and what was NOT checked
 *
 * The reasoning: CBJ Instructions No. 9 of 2026 art. 4/a ties the capital requirement to the count
 * of branches WITHIN each type, so a type holding zero branches has nothing to measure and no
 * requirement attached — it would be a licence entry that says nothing and costs nothing.
 *
 * What was not checked, stated plainly rather than glossed: the CBJ licence forms and the field
 * list named for this module (`WASEET360_Broker_Insurer_Data_Fields.xlsx`) WERE NOT AVAILABLE. They
 * are in neither this repository nor the machine's Downloads directory — the only WASEET360 archive
 * present is branding assets (logos, two marketing flyers, a logo-concepts PDF), and the only text
 * in this repository citing art. 4/a is what Module 0 itself wrote. So this is an inference from the
 * regulation's own arithmetic, NOT a reading of a licence form, and nobody should upgrade it to one.
 *
 * If a form or the text turns out to allow a type with no branches, the change is NOT small: types
 * would have to become stored rather than derived, and `requiredCapitalForScope` would need a band
 * for zero. This file is where that discovery should land.
 *
 * ## What these tests guard
 *
 * The derivation itself cannot be violated by data — but it CAN be bypassed by a future schema
 * change that stores a type alongside the branches. That is the real risk, and the second test
 * below is what refuses it.
 */

const SCHEMA_PATH = join(
  __dirname,
  '../../../../../packages/db/prisma/schema.prisma',
);

function modelBody(schema: string, model: string): string {
  const start = schema.indexOf(`model ${model} {`);
  expect(start, `model ${model} not found in schema.prisma`).toBeGreaterThan(
    -1,
  );
  const end = schema.indexOf('\n}', start);
  return schema.slice(start, end);
}

describe('item (e)’s assumption: a licensed type always has at least one branch', () => {
  it('a type is never in scope without a branch — the derivation makes it unrepresentable', () => {
    // Tautological given the derivation, and asserted anyway: it is the statement of the
    // assumption, and if `typesInScope` ever gains another source for a type this fails.
    const branches: ScopedBranch[] = [{ category: 'GENERAL' }];
    expect(typesInScope(branches)).toEqual(['GENERAL']);
    expect(typesInScope([])).toEqual([]);
  });

  it('and would demand nothing even if one somehow existed', () => {
    // Defence in depth on the arithmetic rather than the shape: should a zero-branch type ever
    // become representable, art. 4/a has nothing to charge it, so the capital figure stays honest
    // instead of silently inventing a 5,000 JOD requirement.
    expect(requiredCapitalForType(0).toFixed(3)).toBe('0.000');
  });

  it('NO COLUMN STORES A LICENCE TYPE — the derivation cannot be bypassed', () => {
    /*
     * This is the test that earns its place. The assumption survives only while the branches are
     * the single source of the type; a future `insuranceTypes String[]` on the licence, or a
     * `category` copied onto the scope row, would let a type exist with no branches behind it and
     * nothing would fail.
     *
     * Matched on the shape of such a field rather than a hand-kept list of forbidden names, so a
     * differently-named version of the same mistake is still caught.
     */
    const schema = readFileSync(SCHEMA_PATH, 'utf8');

    for (const model of ['BrokerLicense', 'BrokerLicenseScopeLine']) {
      const body = modelBody(schema, model);
      const offenders = body
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => !line.startsWith('//') && !line.startsWith('///'))
        .filter((line) =>
          /^\w*(insuranceType|insuranceTypes|licensedType|licenceType|lineCategory|category)\b/i.test(
            line,
          ),
        );
      expect(
        offenders,
        `${model} has a field that looks like a stored insurance TYPE or line category. Item (e) derives the licence's types from its branches' categories, and a stored copy would let a type exist with no branch behind it — see this file's header before adding one.`,
      ).toEqual([]);
    }
  });

  it('is not vacuous — the schema really is being read and the models really are found', () => {
    // Without this, a wrong path or a renamed model would make the guard above pass against an
    // empty string. The repo has been bitten by a measurement that found nothing and looked clean.
    const schema = readFileSync(SCHEMA_PATH, 'utf8');
    expect(schema.length).toBeGreaterThan(1000);
    expect(modelBody(schema, 'BrokerLicenseScopeLine')).toContain(
      'insuranceLineId',
    );
    expect(modelBody(schema, 'BrokerLicense')).toContain('scopeLines');
  });
});
