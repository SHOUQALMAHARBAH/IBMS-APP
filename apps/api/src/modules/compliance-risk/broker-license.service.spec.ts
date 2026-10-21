import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { BrokerLicense } from '@ibms/db';
import { BrokerLicenseService } from './broker-license.service';
import type { BrokerLicenseRepository } from '../../repositories/broker-license.repository';
import type { AuditService } from '../audit/audit.service';
import type { CreateBrokerLicenseDto } from './dto/create-broker-license.dto';
import type { RegulatoryActionRepository } from '../../repositories/regulatory-action.repository';
import { LicenseGateService } from './license-gate.service';

/**
 * Module 0 item (c) rewrote this spec rather than patching it, because the repository it mocks
 * changed shape: every method used to address one globally-keyed row (`findCurrent`, and a `renew`
 * that was an `updateMany` over it), and a licence is now a SERIES OF TERMS per office.
 *
 * The double below is a real in-memory series, not per-method `mockResolvedValue`s. With a
 * singleton the two were equivalent; with a series they are not — "renew appends rather than
 * overwrites" is a claim ABOUT the collection, and a mock returning a fixed row cannot fail it.
 */

const CERT = 'doc-certificate-1';

function term(overrides: Partial<BrokerLicense> = {}): BrokerLicense {
  return {
    id: 'term-1',
    organizationId: 'org-1',
    licenseNumber: 'CBJ-2026-001',
    scopeOfAuthorization: 'General insurance brokerage',
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2028-12-31T00:00:00.000Z'),
    certificateDocumentId: CERT,
    renewalRequestedAt: null,
    ...overrides,
  };
}

function makeDeps(initial: BrokerLicense[] = []) {
  const terms: BrokerLicense[] = [...initial];
  let created = 0;

  const findTerms = vi.fn(() =>
    Promise.resolve(
      [...terms].sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime()),
    ),
  );
  const findTermById = vi.fn((id: string) =>
    Promise.resolve(terms.find((t) => t.id === id) ?? null),
  );
  const createTerm = vi.fn(
    (input: {
      licenseNumber: string;
      scopeOfAuthorization: string | null;
      issuedAt: Date | null;
      expiresAt: Date;
      certificate: {
        fileName: string;
        storageRef: string;
        uploadedByUserId: string;
      };
    }) => {
      // The real table has @@unique([organizationId, licenseNumber, expiresAt]); the double
      // enforces it so the service's P2002 mapping is reachable here at all.
      const clash = terms.some(
        (t) =>
          t.licenseNumber === input.licenseNumber &&
          t.expiresAt.getTime() === input.expiresAt.getTime(),
      );
      if (clash) {
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
          }),
        );
      }
      created += 1;
      const row = term({
        id: `term-new-${created}`,
        licenseNumber: input.licenseNumber,
        scopeOfAuthorization: input.scopeOfAuthorization,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        certificateDocumentId: `doc-${created}`,
      });
      terms.push(row);
      return Promise.resolve(row);
    },
  );
  const recordRenewalRequest = vi.fn((id: string, at: Date) => {
    const t = terms.find((x) => x.id === id && x.renewalRequestedAt === null);
    if (!t) return Promise.resolve({ count: 0 });
    t.renewalRequestedAt = at;
    return Promise.resolve({ count: 1 });
  });

  const repo = {
    findTerms,
    findTermById,
    createTerm,
    recordRenewalRequest,
  } as unknown as BrokerLicenseRepository;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  /*
   * THE ACT STORE, and the acts it holds are fed back to the REAL gate below — so the standing a
   * test asserts is derived from the row the service just wrote, not from a mock that was told the
   * answer. A `{ standing: () => 'SUSPENDED' }` double would make every assertion here pass on the
   * double rather than on `deriveLicenseStanding`.
   */
  const storedActs: Record<string, unknown>[] = [];
  const createAct = vi.fn((data: Record<string, unknown>) => {
    const row = { id: `act-${storedActs.length + 1}`, ...data };
    storedActs.push(row);
    return Promise.resolve(row);
  });
  const acts = {
    create: createAct,
    findAll: vi.fn(() => Promise.resolve(storedActs)),
  } as unknown as RegulatoryActionRepository;

  // The REAL gate over this file's own two mocks — same reasoning as `policy.service.spec.ts`.
  const licenseGate = new LicenseGateService(repo, acts);

  return {
    service: new BrokerLicenseService(repo, audit, acts, licenseGate),
    mocks: {
      findTerms,
      createTerm,
      recordRenewalRequest,
      record,
      createAct,
    },
    terms,
  };
}

const CREATE_DTO: CreateBrokerLicenseDto = {
  licenseNumber: 'CBJ-2026-001',
  scopeOfAuthorization: 'General insurance brokerage',
  issuedAt: '2026-01-01',
  expiresAt: '2028-12-31',
  certificateFileName: 'cbj-licence-2026.pdf',
  certificateStorageRef: 'licences/cbj-licence-2026.pdf',
};

describe('BrokerLicenseService — a series of terms (Module 0 item c)', () => {
  describe('create', () => {
    it('records the first term, with its certificate, and audits CREATE', async () => {
      const { service, mocks, terms } = makeDeps();
      const view = await service.create(CREATE_DTO, 'compliance-1');

      expect(terms).toHaveLength(1);
      expect(view.licenseNumber).toBe('CBJ-2026-001');
      expect(view.certificateDocumentId).toBeTruthy();
      // The certificate is attributed to the actor, not to nobody.
      expect(mocks.createTerm.mock.calls[0]?.[0].certificate).toMatchObject({
        fileName: 'cbj-licence-2026.pdf',
        uploadedByUserId: 'compliance-1',
      });
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entityType: 'BrokerLicense',
        }),
      );
    });

    it('409s when THIS OFFICE already holds a term', async () => {
      const { service } = makeDeps([term()]);
      await expect(service.create(CREATE_DTO, 'compliance-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('409s (not a raw 500) when the same term is recorded twice', async () => {
      const { service } = makeDeps();
      await service.create(CREATE_DTO, 'compliance-1');
      // Same number and expiry -> the unique index. Reached through `renew`, because `create`
      // itself stops at the office-already-holds-one check one step earlier.
      await expect(service.renew(CREATE_DTO, 'compliance-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('a non-P2002 failure still propagates rather than being mapped to 409', async () => {
      const { service, mocks } = makeDeps();
      mocks.createTerm.mockRejectedValueOnce(new Error('connection reset'));
      await expect(service.create(CREATE_DTO, 'compliance-1')).rejects.toThrow(
        'connection reset',
      );
    });
  });

  describe('renew', () => {
    it('404s when the office holds no term yet', async () => {
      const { service } = makeDeps();
      await expect(service.renew(CREATE_DTO, 'compliance-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('APPENDS a term and leaves the previous one intact', async () => {
      const previous = term({
        id: 'term-old',
        expiresAt: new Date('2025-12-31T00:00:00.000Z'),
      });
      const { service, terms } = makeDeps([previous]);

      await service.renew(CREATE_DTO, 'compliance-1');

      // The claim that matters, and the one the old `updateMany` could not satisfy: the office can
      // still show a regulator what it held last period.
      expect(terms).toHaveLength(2);
      const old = terms.find((t) => t.id === 'term-old');
      expect(old?.expiresAt.toISOString()).toBe('2025-12-31T00:00:00.000Z');
      /*
       * THE OLD TERM IS NO LONGER FLIPPED TO `lapsed`, because that column is gone — and nothing is
       * lost: `pickCurrentTerm` already decides which term governs by LATEST EXPIRY, so a superseded
       * term needs no flag to stop governing. The flag was a second answer to a question the series
       * already answers, which is why it went.
       */

      const { current, terms: series } = await service.get();
      expect(series).toHaveLength(2);
      expect(current?.expiresAt).toBe('2028-12-31T00:00:00.000Z');
    });
  });

  describe('recordRenewalRequest', () => {
    it('404s when the office holds no term yet', async () => {
      const { service } = makeDeps();
      await expect(
        service.recordRenewalRequest({}, 'compliance-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('records the filing date against the current term and audits it', async () => {
      const { service, mocks } = makeDeps([term()]);
      const view = await service.recordRenewalRequest(
        { requestedAt: '2028-11-01' },
        'compliance-1',
      );
      expect(view.renewalRequestedAt).toBe('2028-11-01T00:00:00.000Z');
      // Whether a human chose the date is recorded, because that is what makes a backdated
      // filing answerable rather than invisible.
      // Read off the recorded call rather than nesting `expect.objectContaining` inside another:
      // that returns `any`, which this repo's lint refuses as an unsafe assignment — and the value
      // itself is the sharper assertion anyway.
      const recorded = mocks.record.mock.calls[0]?.[0] as {
        action: string;
        afterValue: Record<string, unknown>;
      };
      expect(recorded.action).toBe('UPDATE');
      expect(recorded.afterValue.renewalRequestedAtWasSupplied).toBe(true);
    });

    it('defaults to today and says so in the audit row', async () => {
      const { service, mocks } = makeDeps([term()]);
      const view = await service.recordRenewalRequest({}, 'compliance-1');
      expect(view.renewalRequestedAt).toBeTruthy();
      const recorded = mocks.record.mock.calls[0]?.[0] as {
        afterValue: Record<string, unknown>;
      };
      expect(recorded.afterValue.renewalRequestedAtWasSupplied).toBe(false);
    });

    it('409s on a second call rather than moving the filing date', async () => {
      const { service, terms } = makeDeps([term()]);
      await service.recordRenewalRequest({ requestedAt: '2028-11-01' }, 'c-1');
      await expect(
        service.recordRenewalRequest({ requestedAt: '2028-12-20' }, 'c-1'),
      ).rejects.toThrow(ConflictException);
      // Art. 11 lateness is measured from this date, so a second call must not be able to move it
      // from on-time to late or back.
      expect(terms[0]?.renewalRequestedAt?.toISOString()).toBe(
        '2028-11-01T00:00:00.000Z',
      );
    });
  });

  describe('recordRegulatoryAction — which REPLACED markLapsed', () => {
    /*
     * REPOINTED, with the reversal stated rather than deleted. The three tests here asserted
     * `markLapsed`: that it 404s with no term, that it flips `BrokerLicense.status` to `'lapsed'`
     * and audits an UPDATE, and that it is idempotent on an already-lapsed term.
     *
     * All three encoded the old mechanism as intended, and the mechanism is gone: a bare two-value
     * marker with no basis, no effective date, no decision reference and no letter was the state
     * `RegulatoryAction` exists to end — `license-standing.config.ts` said so in a comment while
     * reading the marker, because nothing could write the table it preferred.
     *
     * The 404-with-no-term case does NOT carry over, and that is the one real behaviour change:
     * a CBJ decision is about the office, not about a term, so an office that has never recorded a
     * licence can still record the letter suspending it. Refusing there would make the office
     * unable to record a fact it has received.
     */
    it('records the act with its basis, date and decision reference — and returns the STANDING it produced', async () => {
      const { service, mocks } = makeDeps([term()]);
      const standing = await service.recordRegulatoryAction(
        {
          kind: 'SUSPENSION',
          basis: 'SANCTION',
          effectiveFrom: '2026-10-01',
          decisionRef: 'CBJ/2026/441',
        },
        { id: 'compliance-1', organizationId: 'org-1' },
      );

      // THE STANDING, not a bare "recorded": a caller told only that the row was written has to go
      // and look to find out what it changed to.
      expect(standing.status).toBe('SUSPENDED');
      expect(standing.mayPractise).toBe(false);
      // AND THE DECISION IS CITABLE, which is the whole difference from the marker it replaced.
      expect(standing.standingActDecisionRef).toBe('CBJ/2026/441');

      expect(mocks.createAct).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          kind: 'SUSPENSION',
          basis: 'SANCTION',
          decisionRef: 'CBJ/2026/441',
          recordedByUserId: 'compliance-1',
        }),
      );
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entityType: 'RegulatoryAction',
        }),
      );
    });

    it('a SANCTION suspension is NOT deemed cancelled by art. 14/c, however old — only a broker-request one is', async () => {
      /*
       * The distinction decision 71 drew and refused to infer past: art. 14/c converts a
       * long-standing art. 14/a suspension into a cancellation, and whether it reaches an art. 21/b
       * SANCTION is unsettled in the text. Asserted here because a reader could reasonably assume
       * "two years is two years".
       *
       * THE TERM IS ISSUED IN 2015 ON PURPOSE. My first version dated the act 2020 against the
       * default term's 2026 issue date, and it read ACTIVE — correctly: `foldActs` ignores an act
       * that PREDATES the current term, because a later term means the office was re-licensed and a
       * suspension lifted by that re-licensing must not keep blocking. The derivation was right and
       * the fixture was careless, so the fixture moved.
       */
      const { service } = makeDeps([
        term({ issuedAt: new Date('2015-01-01T00:00:00.000Z') }),
      ]);
      const standing = await service.recordRegulatoryAction(
        {
          kind: 'SUSPENSION',
          basis: 'SANCTION',
          effectiveFrom: '2020-01-01',
          decisionRef: 'CBJ/2020/7',
        },
        { id: 'compliance-1', organizationId: 'org-1' },
      );
      expect(standing.status).toBe('SUSPENDED');
      expect(standing.deemedCancelledUnderArticle14C).toBe(false);

      // AND THE OTHER BASIS IS the one art. 14/c reaches — asserted beside it, because a test that
      // only shows SANCTION is not deemed cancelled cannot tell "the basis decides" from "nothing
      // is ever deemed cancelled".
      const { service: s2 } = makeDeps([
        term({ issuedAt: new Date('2015-01-01T00:00:00.000Z') }),
      ]);
      const own = await s2.recordRegulatoryAction(
        {
          kind: 'SUSPENSION',
          basis: 'BROKER_REQUEST',
          effectiveFrom: '2020-01-01',
          decisionRef: 'CBJ/2020/8',
        },
        { id: 'compliance-1', organizationId: 'org-1' },
      );
      expect(own.status).toBe('CANCELLED');
      expect(own.deemedCancelledUnderArticle14C).toBe(true);
    });

    it('records the letter for an office that holds NO term — which the marker it replaced refused', async () => {
      // The one behaviour change, asserted so it is a decision rather than a side effect: a CBJ
      // decision is about the OFFICE, and an office with no term on record is exactly the one most
      // likely to have received one.
      const { service, mocks } = makeDeps();
      const standing = await service.recordRegulatoryAction(
        {
          kind: 'CANCELLATION',
          basis: 'SANCTION',
          effectiveFrom: '2026-09-01',
          decisionRef: 'CBJ/2026/500',
        },
        { id: 'compliance-1', organizationId: 'org-1' },
      );
      // NO_TERM_ON_RECORD still wins, because the derivation checks the term first — the act is
      // recorded and the standing reports the more fundamental gap.
      expect(standing.status).toBe('NO_TERM_ON_RECORD');
      expect(mocks.createAct).toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('REPOINTED: no longer 404s for an office with no licence — it reports the absence', async () => {
      // This test asserted `rejects.toThrow(NotFoundException)` before Module 0 item (c).
      //
      // That was defensible while a licence was one global row somebody had either created or not.
      // It is wrong now for a specific reason: "this office holds no licence" is the state that
      // BLOCKS new business (CBJ Instructions No. 9 of 2026, art. 21/a/9), so the screen must be
      // able to render it. A 404 tells the reader nothing and looks like a broken page.
      const { service } = makeDeps();
      const view = await service.get();
      expect(view.current).toBeNull();
      expect(view.terms).toEqual([]);
    });

    it('returns the live-derived view of the current term', async () => {
      const { service } = makeDeps([
        term({ expiresAt: new Date('2020-01-01') }),
      ]);
      const view = await service.get();
      expect(view.current?.isCurrentlyLapsed).toBe(true);
    });

    it('picks the LATEST term as current, not the first recorded', async () => {
      const { service } = makeDeps([
        term({ id: 'old', expiresAt: new Date('2025-12-31') }),
        term({ id: 'new', expiresAt: new Date('2028-12-31') }),
      ]);
      const view = await service.get();
      // Between filing a renewal and the old term expiring, an office holds two. The newer one is
      // what decides whether it may practise tomorrow.
      expect(view.current?.id).toBe('new');
      expect(view.terms).toHaveLength(2);
    });
  });
});
