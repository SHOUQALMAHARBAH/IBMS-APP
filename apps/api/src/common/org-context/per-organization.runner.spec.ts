import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Organization, User } from '@ibms/db';
import type { OrganizationRepository } from '../../repositories/organization.repository';
import type { UserRepository } from '../../repositories/user.repository';
import { OrgContextService } from './org-context.service';
import {
  PerOrganizationRunner,
  SYSTEM_ACCOUNT_EMAIL,
} from './per-organization.runner';

function org(id: string, legalName = `Office ${id}`): Organization {
  return {
    id,
    legalName,
    // NOT NULL since module 0-ب Part E measurement 3: ZERO rows lacked an Arabic legal
    // database, so the column tightened). The compiler asked for this the moment it did.
    legalNameAr: `مكتب ${id}`,
    brokerLicenseNumber: null,
    subdomain: id,
    // Module 0 item (a). The compiler asked for this the moment the column landed, which is the
    // property the comment below already claimed — so it is stated, not defaulted.
    type: 'BROKERAGE_OFFICE',
    // Module 0 item (b). NOT NULL for a brokerage office by CHECK constraint, NULL for an
    // insurance company — so the fixture has to pick one, and a brokerage office is what this
    // runner is about.
    brokerKind: 'CORPORATE',
    // Module 0 item (e). NULL rather than a figure: "no capital recorded" and "recorded and too
    // low" are deliberately different states, and this runner is about neither.
    paidUpCapital: null,
    status: 'ACTIVE',
    /*
     * MODULE 0-ب ITEM (d) — the 35 registration columns, all null.
     *
     * NULL is the honest value and not a shortcut: this runner is about per-organization iteration,
     * and these three offices were never registered through the form that collects any of this.
     * They are listed rather than spread from a partial, because the comment below is right — the
     * TYPE is what forces a decision here, and `...({} as Organization)` would take that away.
     */
    code: null,
    tradeName: null,
    nationalEstablishmentNo: null,
    commercialRegistrationNo: null,
    commercialRegistrationDate: null,
    taxNumber: null,
    brokerageKind: null,
    countryId: null,
    cityId: null,
    address: null,
    phone: null,
    email: null,
    website: null,
    generalManagerName: null,
    complianceOfficerName: null,
    complianceOfficerEmail: null,
    complianceOfficerPhone: null,
    bankGuaranteeNo: null,
    bankGuaranteeBankId: null,
    bankGuaranteeAmount: null,
    bankGuaranteeExpiry: null,
    bankId: null,
    ibanEnc: null,
    currencyId: null,
    legalFormId: null,
    licensingAuthorityId: null,
    shortName: null,
    insurerLicenseNumber: null,
    // MODULE 0-ب ITEM (e). Listed rather than spread, for the reason this fixture's own comment gives:
    // the TYPE is the reminder that a new office-level column has to be DECIDED here, not defaulted.
    insurerLicenseCertificateDocumentId: null,
    businessModelId: null,
    integrationMethod: null,
    apiEndpoint: null,
    quotationEmail: null,
    claimsEmail: null,
    createdByUserId: null,
    updatedByUserId: null,
    dpoAlternateApproverUserId: null,
    // Part 4 — every office reads SEGREGATED unless it has declared otherwise, which is what the migration
    // left every existing one at. A fixture that omitted these would not compile, deliberately: the type is
    // the reminder that a new office-level setting has to be decided here rather than defaulted silently.
    dutySegregationMode: 'SEGREGATED',
    dutySegregationModeDeclaredAt: null,
    dutySegregationModeDeclaredByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeRunner(
  organizations: Organization[],
  systemAccountByOrg: Record<string, string | null>,
) {
  const findActive = vi.fn().mockResolvedValue(organizations);
  const orgRepo = { findActive } as unknown as OrganizationRepository;

  const findByEmailInOrganization = vi.fn((organizationId: string) =>
    Promise.resolve(
      systemAccountByOrg[organizationId] == null
        ? null
        : ({ id: systemAccountByOrg[organizationId] } as User),
    ),
  );
  const users = { findByEmailInOrganization } as unknown as UserRepository;

  const orgContext = new OrgContextService();
  const logger = new Logger('test');
  const errorSpy = vi
    .spyOn(logger, 'error')
    .mockImplementation(() => undefined);
  const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

  return {
    runner: new PerOrganizationRunner(orgRepo, users, orgContext),
    orgContext,
    logger,
    errorSpy,
    warnSpy,
    mocks: { findActive, findByEmailInOrganization },
  };
}

describe('PerOrganizationRunner.forEach', () => {
  it('runs the work once per ACTIVE organization', async () => {
    const { runner, logger } = makeRunner([org('org-a'), org('org-b')], {
      'org-a': 'system-a',
      'org-b': 'system-b',
    });
    const seen: Array<[string, string]> = [];

    await runner.forEach('Test sweep', logger, (systemUserId, orgId) => {
      seen.push([orgId, systemUserId]);
      return Promise.resolve();
    });

    expect(seen).toEqual([
      ['org-a', 'system-a'],
      ['org-b', 'system-b'],
    ]);
  });

  it('resolves EACH organization its OWN system service account', async () => {
    const { runner, logger, mocks } = makeRunner([org('org-a'), org('org-b')], {
      'org-a': 'system-a',
      'org-b': 'system-b',
    });

    await runner.forEach('Test sweep', logger, () => Promise.resolve());

    // The account is tenant-scoped like any other User, so "the system
    // account" is really "this office's system account".
    expect(mocks.findByEmailInOrganization).toHaveBeenCalledWith(
      'org-a',
      SYSTEM_ACCOUNT_EMAIL,
    );
    expect(mocks.findByEmailInOrganization).toHaveBeenCalledWith(
      'org-b',
      SYSTEM_ACCOUNT_EMAIL,
    );
  });

  it('makes the organization readable from the context inside the work', async () => {
    const { runner, orgContext, logger } = makeRunner([org('org-a')], {
      'org-a': 'system-a',
    });
    let observed: string | null = 'not-run';

    await runner.forEach('Test sweep', logger, () => {
      observed = orgContext.currentOrNull();
      return Promise.resolve();
    });

    // This is what makes every query inside the sweep tenant-filtered.
    expect(observed).toBe('org-a');
  });

  it('skips an organization with no system account, and still runs the others', async () => {
    const { runner, logger, errorSpy } = makeRunner(
      [org('org-a'), org('org-b')],
      {
        'org-a': null,
        'org-b': 'system-b',
      },
    );
    const ran: string[] = [];

    await runner.forEach('Test sweep', logger, (_id, orgId) => {
      ran.push(orgId);
      return Promise.resolve();
    });

    expect(ran).toEqual(['org-b']);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('org-a'));
  });

  it('isolates a failure: one organization throwing does not abandon the rest', async () => {
    const { runner, logger, errorSpy } = makeRunner(
      [org('org-a'), org('org-b'), org('org-c')],
      { 'org-a': 'system-a', 'org-b': 'system-b', 'org-c': 'system-c' },
    );
    const ran: string[] = [];

    await runner.forEach('Test sweep', logger, (_id, orgId) => {
      // Pushed for EVERY org, including the one that then fails — the point is
      // that org-c still gets its turn after org-b blows up.
      ran.push(orgId);
      return orgId === 'org-b'
        ? Promise.reject(new Error('one office has bad data'))
        : Promise.resolve();
    });

    // A single tenant's bad data must not silently stop every other tenant's
    // overnight processing.
    expect(ran).toEqual(['org-a', 'org-b', 'org-c']);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('one office has bad data'),
    );
  });

  it('never rethrows — a scheduled job must not crash the process', async () => {
    const { runner, logger } = makeRunner([org('org-a')], {
      'org-a': 'system-a',
    });

    await expect(
      runner.forEach('Test sweep', logger, () =>
        Promise.reject(new Error('boom')),
      ),
    ).resolves.toBeUndefined();
  });

  it('warns and does nothing when no ACTIVE organization exists', async () => {
    const { runner, logger, warnSpy } = makeRunner([], {});
    const work = vi.fn();

    await runner.forEach('Test sweep', logger, work);

    expect(work).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('no ACTIVE Organization'),
    );
  });
});
