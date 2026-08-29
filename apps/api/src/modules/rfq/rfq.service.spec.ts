import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { RfqService } from './rfq.service';
import type { RfqRepository } from '../../repositories/rfq.repository';
import type { OpportunityRepository } from '../../repositories/opportunity.repository';
import type { InsuranceProgramRepository } from '../../repositories/insurance-program.repository';
import type { CustomerRepository } from '../../repositories/customer.repository';
import type { AuditService } from '../audit/audit.service';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { AuthenticatedUser } from '../auth/auth.types';

function placement(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'plc-1',
    email: 'placement@ibms.test',
    roles: ['PLACEMENT_TECHNICAL_OFFICER'],
    sessionId: 'session-1',
    ...overrides,
  };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

const RFQ_ROW = {
  id: 'rfq-1',
  opportunityId: 'opp-1',
  insuranceLine: 'Property All Risks',
  issuedAt: new Date(),
  followUpThresholdDays: 9,
  issuedByUserId: 'plc-1',
  insurerSubmissions: [
    {
      id: 'sub-1',
      rfqId: 'rfq-1',
      insurerId: 'ins-1',
      status: 'SENT',
      sentAt: new Date(),
      respondedAt: null,
      followUpAlertSentAt: null,
      insurer: {
        id: 'ins-1',
        name: 'Insurer One',
        nameAr: null,
        financialStrengthRating: null,
      },
    },
  ],
};

function makeDeps() {
  const createRfq = vi
    .fn()
    .mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({
        id: 'rfq-1',
        issuedAt: new Date(),
        followUpThresholdDays: 9,
        ...input,
      }),
    );
  const findRfqById = vi.fn().mockResolvedValue({ ...RFQ_ROW });
  const findRfqsByOpportunityId = vi.fn().mockResolvedValue([{ ...RFQ_ROW }]);
  const findRfqsByCustomerId = vi.fn().mockResolvedValue([{ ...RFQ_ROW }]);
  const findRfqByOpportunityAndLine = vi.fn().mockResolvedValue(null);
  const createInsurerSubmission = vi.fn().mockResolvedValue({ id: 'sub-x' });
  const findInsurerSubmissionById = vi.fn().mockResolvedValue({
    id: 'sub-1',
    rfqId: 'rfq-1',
    insurerId: 'ins-1',
    status: 'SENT',
    sentAt: new Date(),
    respondedAt: null,
    followUpAlertSentAt: null,
    insurer: {
      id: 'ins-1',
      name: 'Insurer One',
      nameAr: null,
      financialStrengthRating: null,
    },
    rfq: {
      id: 'rfq-1',
      opportunityId: 'opp-1',
      opportunity: { id: 'opp-1', customerId: 'cust-1' },
    },
  });
  const findExistingShortlistInsurerIds = vi.fn().mockResolvedValue([]);
  const stampFollowUpAlert = vi.fn().mockResolvedValue(1);
  const findOpenSubmissionsForFollowUp = vi.fn().mockResolvedValue([]);
  const findSelectableInsurers = vi.fn().mockResolvedValue([]);
  const countInsurersByIds = vi
    .fn()
    .mockImplementation((ids: string[]) => Promise.resolve(ids.length));
  // Mirrors Prisma's default-fill: an undefined `sentAt` in `data` becomes
  // now() on the persisted row.
  const createCommunication = vi
    .fn()
    .mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({
        id: 'comm-1',
        createdAt: new Date(),
        ...input,
        sentAt: (input.sentAt as Date | undefined) ?? new Date(),
      }),
    );
  const findCommunicationsByRfqId = vi.fn().mockResolvedValue([]);
  const rfqs = {
    createRfq,
    findRfqById,
    findRfqsByOpportunityId,
    findRfqsByCustomerId,
    findRfqByOpportunityAndLine,
    createInsurerSubmission,
    findInsurerSubmissionById,
    findExistingShortlistInsurerIds,
    stampFollowUpAlert,
    findOpenSubmissionsForFollowUp,
    findSelectableInsurers,
    countInsurersByIds,
    createCommunication,
    findCommunicationsByRfqId,
  } as unknown as RfqRepository;

  const findOpportunityById = vi.fn().mockResolvedValue({
    id: 'opp-1',
    customerId: 'cust-1',
    status: 'NEEDS_CONFIRMED',
    insuranceProgramId: 'prog-1',
  });
  const opportunities = {
    findById: findOpportunityById,
  } as unknown as OpportunityRepository;

  const findProgramById = vi.fn().mockResolvedValue({
    id: 'prog-1',
    lines: [
      { insuranceLine: 'Property All Risks' },
      { insuranceLine: 'Business Interruption' },
    ],
  });
  const programs = {
    findById: findProgramById,
  } as unknown as InsuranceProgramRepository;

  const findCustomerById = vi
    .fn()
    .mockResolvedValue({ id: 'cust-1', ownerUserId: 'sales-1' });
  const customers = {
    findById: findCustomerById,
  } as unknown as CustomerRepository;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  const transition = vi
    .fn()
    .mockResolvedValue({ id: 'opp-1', status: 'RFQ_ISSUED' });
  const workflow = { transition } as unknown as WorkflowTransitionService;

  return {
    service: new RfqService(
      rfqs,
      opportunities,
      programs,
      customers,
      audit,
      workflow,
    ),
    mocks: {
      createRfq,
      findRfqById,
      findRfqsByOpportunityId,
      findRfqsByCustomerId,
      findRfqByOpportunityAndLine,
      createInsurerSubmission,
      findInsurerSubmissionById,
      findExistingShortlistInsurerIds,
      stampFollowUpAlert,
      findOpenSubmissionsForFollowUp,
      findSelectableInsurers,
      countInsurersByIds,
      createCommunication,
      findCommunicationsByRfqId,
      findOpportunityById,
      findProgramById,
      findCustomerById,
      record,
      transition,
    },
  };
}

const CREATE_DTO = {
  opportunityId: 'opp-1',
  insuranceLine: 'Property All Risks',
  insurerIds: ['ins-1', 'ins-2'],
};

describe('RfqService', () => {
  describe('createRfq', () => {
    it('creates a SENT submission per shortlisted insurer, audits CREATE first, and moves the Opportunity to RFQ_ISSUED', async () => {
      const { service, mocks } = makeDeps();
      const order: string[] = [];
      mocks.record.mockImplementation(() => {
        order.push('audit');
        return Promise.resolve(undefined);
      });
      mocks.createInsurerSubmission.mockImplementation(() => {
        order.push('submission');
        return Promise.resolve({ id: 'sub-x' });
      });

      await service.createRfq(CREATE_DTO, placement());

      expect(mocks.createRfq).toHaveBeenCalledWith(
        expect.objectContaining({
          opportunityId: 'opp-1',
          insuranceLine: 'Property All Risks',
          issuedByUserId: 'plc-1',
        }),
      );
      expect(mocks.createInsurerSubmission).toHaveBeenCalledTimes(2);
      expect(order).toEqual(['audit', 'submission', 'submission']);
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'Opportunity',
          toStatus: 'RFQ_ISSUED',
          actorUserId: 'plc-1',
        }),
      );
    });

    it('does not transition an Opportunity already in RFQ_ISSUED', async () => {
      const { service, mocks } = makeDeps();
      mocks.findOpportunityById.mockResolvedValue({
        id: 'opp-1',
        customerId: 'cust-1',
        status: 'RFQ_ISSUED',
        insuranceProgramId: 'prog-1',
      });
      await service.createRfq(
        { ...CREATE_DTO, insuranceLine: 'Business Interruption' },
        placement(),
      );
      expect(mocks.transition).not.toHaveBeenCalled();
    });

    it('rejects an insuranceLine that is not on the designed programme', async () => {
      const { service, mocks } = makeDeps();
      await expect(
        service.createRfq(
          { ...CREATE_DTO, insuranceLine: 'Propery All Risks' },
          placement(),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mocks.createRfq).not.toHaveBeenCalled();
    });

    it('does not fail the RFQ when the Opportunity transition throws (already committed)', async () => {
      const { service, mocks } = makeDeps();
      mocks.transition.mockRejectedValueOnce(
        new ConflictException('status changed concurrently'),
      );
      const rfq = await service.createRfq(CREATE_DTO, placement());
      expect(rfq.id).toBe('rfq-1');
    });

    it('rejects an unknown insurer with a 422', async () => {
      const { service, mocks } = makeDeps();
      mocks.countInsurersByIds.mockResolvedValue(1); // only 1 of 2 exist
      await expect(service.createRfq(CREATE_DTO, placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mocks.createRfq).not.toHaveBeenCalled();
    });

    it('rejects an Opportunity that is past the RFQ stage', async () => {
      const { service, mocks } = makeDeps();
      mocks.findOpportunityById.mockResolvedValue({
        id: 'opp-1',
        customerId: 'cust-1',
        status: 'PLACEMENT',
      });
      await expect(service.createRfq(CREATE_DTO, placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('409s a duplicate (opportunity, line) via the pre-check', async () => {
      const { service, mocks } = makeDeps();
      mocks.findRfqByOpportunityAndLine.mockResolvedValue({ id: 'rfq-0' });
      await expect(service.createRfq(CREATE_DTO, placement())).rejects.toThrow(
        ConflictException,
      );
      expect(mocks.createRfq).not.toHaveBeenCalled();
    });

    it('maps the @@unique violation from a concurrent create to a 409', async () => {
      const { service, mocks } = makeDeps();
      mocks.createRfq.mockRejectedValueOnce(p2002());
      await expect(service.createRfq(CREATE_DTO, placement())).rejects.toThrow(
        ConflictException,
      );
    });

    it('tolerates a duplicate insurer row (P2002) during the shortlist insert', async () => {
      const { service, mocks } = makeDeps();
      mocks.createInsurerSubmission
        .mockResolvedValueOnce({ id: 'sub-a' })
        .mockRejectedValueOnce(p2002());
      const rfq = await service.createRfq(CREATE_DTO, placement());
      expect(rfq.id).toBe('rfq-1');
    });

    it('404s a missing Opportunity', async () => {
      const { service, mocks } = makeDeps();
      mocks.findOpportunityById.mockResolvedValue(null);
      await expect(service.createRfq(CREATE_DTO, placement())).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('addInsurers', () => {
    it('adds only insurers not already on the shortlist and audits the added ids', async () => {
      const { service, mocks } = makeDeps();
      mocks.findExistingShortlistInsurerIds.mockResolvedValue(['ins-1']);
      await service.addInsurers(
        'rfq-1',
        { insurerIds: ['ins-1', 'ins-2'] },
        placement(),
      );
      expect(mocks.createInsurerSubmission).toHaveBeenCalledTimes(1);
      expect(mocks.createInsurerSubmission).toHaveBeenCalledWith(
        'rfq-1',
        'ins-2',
      );
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          entityType: 'RFQ',
          afterValue: { addedShortlistInsurerIds: ['ins-2'] },
        }),
      );
    });

    it('does not write an audit row when every id was already on the shortlist', async () => {
      const { service, mocks } = makeDeps();
      mocks.findExistingShortlistInsurerIds.mockResolvedValue([
        'ins-1',
        'ins-2',
      ]);
      await service.addInsurers(
        'rfq-1',
        { insurerIds: ['ins-1', 'ins-2'] },
        placement(),
      );
      expect(mocks.createInsurerSubmission).not.toHaveBeenCalled();
      expect(mocks.record).not.toHaveBeenCalled();
    });
  });

  describe('transitionInsurer', () => {
    it('stamps respondedAt for QUOTED and drives the workflow engine', async () => {
      const { service, mocks } = makeDeps();
      await service.transitionInsurer(
        'sub-1',
        { toStatus: 'QUOTED' },
        placement(),
      );
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'RFQInsurer',
          entityId: 'sub-1',
          toStatus: 'QUOTED',
        }),
      );
      const call = mocks.transition.mock.calls[0]?.[0] as {
        data?: { respondedAt?: unknown };
      };
      expect(call.data?.respondedAt).toBeInstanceOf(Date);
    });

    it('does not stamp respondedAt for VIEWED', async () => {
      const { service, mocks } = makeDeps();
      await service.transitionInsurer(
        'sub-1',
        { toStatus: 'VIEWED' },
        placement(),
      );
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({ toStatus: 'VIEWED', data: undefined }),
      );
    });

    it('surfaces an illegal move rejected by the engine', async () => {
      const { service, mocks } = makeDeps();
      mocks.transition.mockRejectedValueOnce(
        new UnprocessableEntityException('cannot transition'),
      );
      await expect(
        service.transitionInsurer('sub-1', { toStatus: 'QUOTED' }, placement()),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('404s a submission on a customer the caller cannot see', async () => {
      const { service, mocks } = makeDeps();
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-2',
      });
      await expect(
        service.transitionInsurer(
          'sub-1',
          { toStatus: 'QUOTED' },
          placement({ id: 'sales-1', roles: ['SALES_RELATIONSHIP_OFFICER'] }),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('requires exactly one of opportunityId / customerId', async () => {
      const { service } = makeDeps();
      await expect(service.list({}, placement())).rejects.toThrow(
        UnprocessableEntityException,
      );
      await expect(
        service.list(
          { opportunityId: 'opp-1', customerId: 'cust-1' },
          placement(),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('lists by opportunity after a visibility check', async () => {
      const { service, mocks } = makeDeps();
      await service.list({ opportunityId: 'opp-1' }, placement());
      expect(mocks.findRfqsByOpportunityId).toHaveBeenCalledWith('opp-1');
    });
  });

  describe('runFollowUpScan', () => {
    const OLD_SENT = new Date('2020-01-06T09:00:00Z');

    function dueRow(overrides?: Record<string, unknown>) {
      return {
        id: 'sub-1',
        rfqId: 'rfq-1',
        insurerId: 'ins-1',
        status: 'SENT',
        sentAt: OLD_SENT,
        followUpAlertSentAt: null,
        rfq: { id: 'rfq-1', followUpThresholdDays: 9 },
        ...overrides,
      };
    }

    it('stamps + audits + auto-advances an over-threshold open submission', async () => {
      const { service, mocks } = makeDeps();
      mocks.findOpenSubmissionsForFollowUp.mockResolvedValue([dueRow()]);
      mocks.transition.mockResolvedValue({
        id: 'sub-1',
        status: 'NO_RESPONSE',
      });

      const result = await service.runFollowUpScan('system-1');

      expect(result).toEqual({
        candidates: 1,
        due: 1,
        alerted: 1,
        autoNoResponse: 1,
        transitionSkipped: 0,
        failed: 0,
      });
      expect(mocks.stampFollowUpAlert).toHaveBeenCalledWith(
        'sub-1',
        expect.any(Date),
      );
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'RFQInsurer',
          entityId: 'sub-1',
          toStatus: 'NO_RESPONSE',
          actorUserId: 'system-1',
        }),
      );
      // respondedAt is NOT stamped by an auto-NO_RESPONSE move.
      const call = mocks.transition.mock.calls[0]?.[0] as {
        data?: unknown;
      };
      expect(call.data).toBeUndefined();
      const auditArg = mocks.record.mock.calls[0]?.[0] as {
        action: string;
        entityType: string;
        entityId: string;
        afterValue: { followUpAlert: boolean };
      };
      expect(auditArg.action).toBe('UPDATE');
      expect(auditArg.entityType).toBe('RFQInsurer');
      expect(auditArg.entityId).toBe('sub-1');
      expect(auditArg.afterValue.followUpAlert).toBe(true);
    });

    it('auto-advances a VIEWED submission too', async () => {
      const { service, mocks } = makeDeps();
      mocks.findOpenSubmissionsForFollowUp.mockResolvedValue([
        dueRow({ status: 'VIEWED' }),
      ]);
      const result = await service.runFollowUpScan('system-1');
      expect(result.autoNoResponse).toBe(1);
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({ toStatus: 'NO_RESPONSE' }),
      );
    });

    it('counts a concurrent insurer response as transitionSkipped, not failed', async () => {
      const { service, mocks } = makeDeps();
      mocks.findOpenSubmissionsForFollowUp.mockResolvedValue([
        dueRow({ id: 'sub-1' }),
        dueRow({ id: 'sub-2' }),
      ]);
      mocks.transition
        .mockRejectedValueOnce(new ConflictException('status changed'))
        .mockResolvedValueOnce({ id: 'sub-2', status: 'NO_RESPONSE' });

      const result = await service.runFollowUpScan('system-1');

      expect(result).toEqual({
        candidates: 2,
        due: 2,
        alerted: 2,
        autoNoResponse: 1,
        transitionSkipped: 1,
        failed: 0,
      });
    });

    it('treats an illegal-move 422 from a terminal state as transitionSkipped', async () => {
      const { service, mocks } = makeDeps();
      mocks.findOpenSubmissionsForFollowUp.mockResolvedValue([dueRow()]);
      mocks.transition.mockRejectedValue(
        new UnprocessableEntityException('cannot transition from QUOTED'),
      );
      const result = await service.runFollowUpScan('system-1');
      expect(result.transitionSkipped).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('still auto-advances when another sweep stamped the alert first (count 0)', async () => {
      const { service, mocks } = makeDeps();
      mocks.findOpenSubmissionsForFollowUp.mockResolvedValue([dueRow()]);
      mocks.stampFollowUpAlert.mockResolvedValue(0);
      const result = await service.runFollowUpScan('system-1');
      expect(result).toEqual({
        candidates: 1,
        due: 1,
        alerted: 0,
        autoNoResponse: 1,
        transitionSkipped: 0,
        failed: 0,
      });
      expect(mocks.record).not.toHaveBeenCalled();
    });

    it('skips a submission that has not yet cleared its threshold', async () => {
      const { service, mocks } = makeDeps();
      mocks.findOpenSubmissionsForFollowUp.mockResolvedValue([
        dueRow({ sentAt: new Date() }),
      ]);
      const result = await service.runFollowUpScan('system-1');
      expect(result).toEqual({
        candidates: 1,
        due: 0,
        alerted: 0,
        autoNoResponse: 0,
        transitionSkipped: 0,
        failed: 0,
      });
      expect(mocks.stampFollowUpAlert).not.toHaveBeenCalled();
      expect(mocks.transition).not.toHaveBeenCalled();
    });

    it('isolates a row that throws unexpectedly and keeps going', async () => {
      const { service, mocks } = makeDeps();
      mocks.findOpenSubmissionsForFollowUp.mockResolvedValue([
        dueRow({ id: 'sub-1' }),
        dueRow({ id: 'sub-2' }),
      ]);
      mocks.stampFollowUpAlert
        .mockRejectedValueOnce(new Error('db blip'))
        .mockResolvedValueOnce(1);
      const result = await service.runFollowUpScan('system-1');
      expect(result).toEqual({
        candidates: 2,
        due: 2,
        alerted: 1,
        autoNoResponse: 1,
        transitionSkipped: 0,
        failed: 1,
      });
    });
  });

  describe('logCommunication', () => {
    const COMM_DTO = {
      direction: 'INBOUND' as const,
      channel: 'EMAIL' as const,
      body: 'Please send 3 years of loss history for site 2.',
    };

    it('creates the row, backfills customerId, and audits metadata only (no body)', async () => {
      const { service, mocks } = makeDeps();

      await service.logCommunication('rfq-1', COMM_DTO, placement());

      expect(mocks.createCommunication).toHaveBeenCalledWith(
        expect.objectContaining({
          rfqId: 'rfq-1',
          customerId: 'cust-1',
          direction: 'INBOUND',
          channel: 'EMAIL',
          body: 'Please send 3 years of loss history for site 2.',
          loggedByUserId: 'plc-1',
        }),
      );
      const auditArg = mocks.record.mock.calls[0]?.[0] as {
        action: string;
        entityType: string;
        afterValue: Record<string, unknown>;
      };
      expect(auditArg.action).toBe('CREATE');
      expect(auditArg.entityType).toBe('RfqCommunication');
      expect(auditArg.afterValue).toMatchObject({
        rfqId: 'rfq-1',
        rfqInsurerId: null,
        direction: 'INBOUND',
        channel: 'EMAIL',
      });
      // Free text never enters the audit row — no `subject`, no `body`.
      expect(auditArg.afterValue).not.toHaveProperty('subject');
      expect(auditArg.afterValue).not.toHaveProperty('body');
      expect(JSON.stringify(auditArg.afterValue)).not.toContain('loss history');
    });

    it('accepts an OUTBOUND exchange', async () => {
      const { service, mocks } = makeDeps();
      await service.logCommunication(
        'rfq-1',
        { ...COMM_DTO, direction: 'OUTBOUND' },
        placement(),
      );
      expect(mocks.createCommunication).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'OUTBOUND' }),
      );
    });

    it('422s an rfqInsurerId that is not on this RFQ', async () => {
      const { service, mocks } = makeDeps();
      await expect(
        service.logCommunication(
          'rfq-1',
          { ...COMM_DTO, rfqInsurerId: 'sub-999' },
          placement(),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mocks.createCommunication).not.toHaveBeenCalled();
    });

    it('accepts an rfqInsurerId that IS on this RFQ', async () => {
      const { service, mocks } = makeDeps();
      await service.logCommunication(
        'rfq-1',
        { ...COMM_DTO, rfqInsurerId: 'sub-1' },
        placement(),
      );
      expect(mocks.createCommunication).toHaveBeenCalledWith(
        expect.objectContaining({ rfqInsurerId: 'sub-1' }),
      );
    });

    it('422s an offset-less datetime occurredAt', async () => {
      const { service, mocks } = makeDeps();
      await expect(
        service.logCommunication(
          'rfq-1',
          { ...COMM_DTO, occurredAt: '2026-01-15T09:30:00' },
          placement(),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mocks.createCommunication).not.toHaveBeenCalled();
    });

    it('422s a future occurredAt', async () => {
      const { service } = makeDeps();
      const future = new Date(Date.now() + 3 * 3600_000).toISOString();
      await expect(
        service.logCommunication(
          'rfq-1',
          { ...COMM_DTO, occurredAt: future },
          placement(),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('passes a valid backdated occurredAt through as sentAt', async () => {
      const { service, mocks } = makeDeps();
      await service.logCommunication(
        'rfq-1',
        { ...COMM_DTO, occurredAt: '2026-01-15T09:30:00.000Z' },
        placement(),
      );
      expect(mocks.createCommunication).toHaveBeenCalledWith(
        expect.objectContaining({
          sentAt: new Date('2026-01-15T09:30:00.000Z'),
        }),
      );
    });

    it('404s an RFQ on a customer the caller cannot see', async () => {
      const { service, mocks } = makeDeps();
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        ownerUserId: 'sales-2',
      });
      await expect(
        service.logCommunication(
          'rfq-1',
          COMM_DTO,
          placement({ id: 'sales-1', roles: ['SALES_RELATIONSHIP_OFFICER'] }),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listCommunications', () => {
    it('returns the RFQ correspondence after a visibility check', async () => {
      const { service, mocks } = makeDeps();
      mocks.findCommunicationsByRfqId.mockResolvedValue([{ id: 'comm-1' }]);
      const rows = await service.listCommunications('rfq-1', placement());
      expect(rows).toEqual([{ id: 'comm-1' }]);
      expect(mocks.findCommunicationsByRfqId).toHaveBeenCalledWith('rfq-1');
    });

    it('404s when the RFQ is not visible', async () => {
      const { service, mocks } = makeDeps();
      mocks.findRfqById.mockResolvedValue(null);
      await expect(
        service.listCommunications('rfq-1', placement()),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
