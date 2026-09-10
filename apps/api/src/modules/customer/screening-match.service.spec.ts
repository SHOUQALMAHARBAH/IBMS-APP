import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ScreeningMatchService } from './screening-match.service';
import type { ScreeningMatchRepository } from '../../repositories/screening-match.repository';
import type { AuditService } from '../audit/audit.service';
import type { KycRecordRepository } from '../../repositories/kyc-record.repository';
import type { WatchlistEntryRepository } from '../../repositories/watchlist-entry.repository';
import type { SlaTimerService } from '../sla/sla-timer.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const actor = { id: 'compliance-1' } as AuthenticatedUser;

function matchRow(over: Record<string, unknown> = {}) {
  return {
    id: 'sm-1',
    kycRecordId: 'kyc-1',
    watchlistEntryId: 'wl-1',
    subjectName: 'Ahmad Khalid Al Hashimi',
    subjectCanonical: 'ahmad al hashimi khaled',
    entrySource: 'OFAC_SDN',
    entrySourceRecordId: '2674',
    entryFullName: 'AHMAD AL HASHIMI',
    entryListProgram: 'SDGT',
    matchType: 'fuzzy',
    status: 'pending',
    // Part B §16 — a decision may only be recorded on a case somebody picked
    // up, so the fixture for the decision path is a case UNDER REVIEW. The
    // refusal from OPEN is covered on its own, at the e2e level, against the
    // real transition table.
    caseStatus: 'UNDER_REVIEW',
    detectedAt: new Date('2026-09-09T00:00:00.000Z'),
    reviewedByUserId: null,
    reviewedAt: null,
    reviewReason: null,
    watchlistEntry: {
      id: 'wl-1',
      source: 'OFAC_SDN',
      sourceRecordId: '2674',
      fullName: 'AHMAD AL HASHIMI',
      listProgram: 'SDGT',
      remarks: null,
    },
    kycRecord: {
      id: 'kyc-1',
      customerId: 'cust-1',
      status: 'APPROVED',
      isEdd: true,
      customer: { id: 'cust-1', legalName: 'Acme Ltd', status: 'ACTIVE' },
    },
    ...over,
  };
}

function makeDeps(over: Record<string, unknown> = {}) {
  const matches = {
    findMany: vi.fn().mockResolvedValue([matchRow()]),
    findById: vi.fn().mockResolvedValue(matchRow()),
    countPending: vi.fn().mockResolvedValue(3),
    recordDecision: vi.fn().mockResolvedValue({ id: 'sm-1' }),
    ...(over.matches as object),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const kycRecords = { update: vi.fn().mockResolvedValue({}) };
  const sla = { resolve: vi.fn().mockResolvedValue({ count: 1 }) };
  const watchlistEntries = {
    hasUsableEntries: vi.fn().mockResolvedValue(true),
  };
  const service = new ScreeningMatchService(
    matches as unknown as ScreeningMatchRepository,
    watchlistEntries as unknown as WatchlistEntryRepository,
    kycRecords as unknown as KycRecordRepository,
    sla as unknown as SlaTimerService,
    audit as unknown as AuditService,
  );
  return { service, matches, audit, kycRecords, sla, watchlistEntries };
}

describe('ScreeningMatchService.list', () => {
  it('projects the customer, the matched subject and the list entry together', async () => {
    const deps = makeDeps();
    const [row] = await deps.service.list({ status: 'pending' }, actor);
    expect(row.customerLegalName).toBe('Acme Ltd');
    expect(row.subjectName).toBe('Ahmad Khalid Al Hashimi');
    expect(row.listEntryName).toBe('AHMAD AL HASHIMI');
    expect(row.listSource).toBe('OFAC_SDN (SDGT)');
    expect(row.matchType).toBe('fuzzy');
  });

  it('audits the read as sensitive data access when rows came back', async () => {
    const deps = makeDeps();
    await deps.service.list({ status: 'pending' }, actor);
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'READ',
        entityType: 'ScreeningMatch',
        isSensitiveDataAccess: true,
      }),
    );
  });

  it('never puts a customer or subject name into the audit row', async () => {
    const deps = makeDeps();
    await deps.service.list({ status: 'pending' }, actor);
    const serialised = JSON.stringify(deps.audit.record.mock.calls);
    expect(serialised).not.toContain('Acme Ltd');
    expect(serialised).not.toContain('Al Hashimi');
  });

  it('is not a sensitive access when the queue is empty', async () => {
    const deps = makeDeps({
      matches: { findMany: vi.fn().mockResolvedValue([]) },
    });
    await deps.service.list({ status: 'pending' }, actor);
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ isSensitiveDataAccess: false }),
    );
  });
});

describe('ScreeningMatchService.decide', () => {
  it('clears a false positive and persists the reason verbatim ON THE MATCH', async () => {
    const deps = makeDeps();
    const reason =
      'Different date of birth and nationality; not the sanctioned individual.';
    await deps.service.decide('sm-1', 'cleared', reason, actor);
    // The justification IS the control — it must survive intact, on the row
    // itself, which is where a reviewer and a regulator read it.
    expect(deps.matches.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'cleared',
        reviewedByUserId: 'compliance-1',
        reviewReason: reason,
      }),
    );
  });

  it('does NOT copy the free-text reason into the audit row', async () => {
    // This is the one free-text field on a sanctions path, so it is exactly
    // where a reviewer writes "our client is not the <name> on the SDN list".
    // The audit row records that a reason exists and points at the entity —
    // sensitive-data-handling.md, log identifiers not the sensitive value.
    const deps = makeDeps();
    await deps.service.decide(
      'sm-1',
      'cleared',
      'Not the same person as Ahmad Al-Hashimi of Amman; DOB differs.',
      actor,
    );
    const serialised = JSON.stringify(deps.audit.record.mock.calls);
    expect(serialised).not.toContain('Ahmad Al-Hashimi');
    expect(serialised).not.toContain('DOB differs');
    // ...but the audit row still records THAT a reason was given, so the
    // decision is not indistinguishable from one made with no basis.
    expect(serialised).toContain('reviewReasonRecorded');
  });

  it('records a confirm as an APPROVE and a clear as a REJECT', async () => {
    const confirmed = makeDeps();
    await confirmed.service.decide(
      'sm-1',
      'confirmed',
      'Same individual — DOB and passport match.',
      actor,
    );
    expect(confirmed.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'APPROVE' }),
    );

    const cleared = makeDeps();
    await cleared.service.decide(
      'sm-1',
      'cleared',
      'Common name coincidence only.',
      actor,
    );
    expect(cleared.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REJECT' }),
    );
  });

  it('409s a match that was already reviewed — a recorded decision is not overwritten', async () => {
    const deps = makeDeps({
      matches: {
        findById: vi.fn().mockResolvedValue(
          matchRow({
            status: 'cleared',
            reviewedAt: new Date('2026-09-08T00:00:00.000Z'),
          }),
        ),
      },
    });
    await expect(
      deps.service.decide(
        'sm-1',
        'confirmed',
        'Changing my mind about this.',
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(deps.matches.recordDecision).not.toHaveBeenCalled();
  });

  it('409s when another reviewer decided it concurrently (0-row conditional write)', async () => {
    const deps = makeDeps({
      matches: { recordDecision: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      deps.service.decide(
        'sm-1',
        'cleared',
        'False positive, verified.',
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s an unknown match', async () => {
    const deps = makeDeps({
      matches: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      deps.service.decide(
        'nope',
        'cleared',
        'False positive, verified.',
        actor,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ScreeningMatchService — a decision has consequences', () => {
  it('resolves the review SLA timer on EITHER outcome', async () => {
    for (const decision of ['cleared', 'confirmed'] as const) {
      const deps = makeDeps();
      await deps.service.decide('sm-1', decision, 'A stated basis.', actor);
      expect(deps.sla.resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'ScreeningMatch',
          entityId: 'sm-1',
          workflowName: 'sanctions_match_review',
        }),
      );
    }
  });

  it('forces the KYC file back into review when a match is CONFIRMED', async () => {
    // "Never auto-block" is deliberate and stands. But before this, confirming
    // a TRUE sanctions hit left KYCRecord, Customer, isEdd and RiskRating
    // byte-identical to clearing it — adjudicating a real match changed
    // nothing observable. Expiring nextReviewDueAt puts it back in front of
    // Compliance via the re-KYC sweep that already exists.
    const deps = makeDeps();
    await deps.service.decide(
      'sm-1',
      'confirmed',
      'Same individual; DOB and passport match.',
      actor,
    );
    const [kycId, patch] = deps.kycRecords.update.mock.calls[0] as [
      string,
      { nextReviewDueAt: Date },
    ];
    expect(kycId).toBe('kyc-1');
    expect(patch.nextReviewDueAt).toBeInstanceOf(Date);
  });

  it('does NOT touch the KYC file when a match is cleared as a false positive', async () => {
    const deps = makeDeps();
    await deps.service.decide(
      'sm-1',
      'cleared',
      'Common name coincidence; different nationality.',
      actor,
    );
    expect(deps.kycRecords.update).not.toHaveBeenCalled();
  });

  it('never lets a failed side effect undo a committed decision', async () => {
    const deps = makeDeps();
    deps.sla.resolve.mockRejectedValue(new Error('sla down'));
    deps.kycRecords.update.mockRejectedValue(new Error('db down'));
    await expect(
      deps.service.decide('sm-1', 'confirmed', 'A stated basis.', actor),
    ).resolves.toBeDefined();
    expect(deps.matches.recordDecision).toHaveBeenCalled();
  });
});
