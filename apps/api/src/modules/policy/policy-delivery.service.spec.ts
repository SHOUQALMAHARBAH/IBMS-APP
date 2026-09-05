import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { PolicyDeliveryService } from './policy-delivery.service';
import type { PolicyRepository } from '../../repositories/policy.repository';
import type { PolicyDeliveryRepository } from '../../repositories/policy-delivery.repository';
import type { AuditService } from '../audit/audit.service';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { PolicyService } from './policy.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { RecordPolicyDeliveryDto } from './dto/record-policy-delivery.dto';

function deliverer(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'plc-1',
    email: 'plc@ibms.test',
    roles: ['PLACEMENT_TECHNICAL_OFFICER'],
    sessionId: 'session-1',
    ...overrides,
  };
}

const DELIVERY_DTO: RecordPolicyDeliveryDto = {
  method: 'email',
  recipient: 'ops@acme.test',
};

interface Opts {
  policyStatus?: string;
  deliveryRecord?: {
    id: string;
    deliveredAt: Date;
    receiptAcknowledgedAt: Date | null;
  } | null;
  notVisible?: boolean;
  transitionRejects?: 'conflict' | 'unprocessable' | 'other' | false;
  stampLosesRace?: boolean;
}

function makeDeps(opts: Opts = {}) {
  const state = { status: opts.policyStatus ?? 'VERIFIED' };

  const policyRow = () => ({
    id: 'pol-1',
    customerId: 'cust-1',
    status: state.status,
    deliveryRecord: opts.deliveryRecord ?? null,
  });

  const loadVisible = vi.fn().mockImplementation(() => {
    if (opts.notVisible) {
      return Promise.reject(new NotFoundException('Policy not found'));
    }
    return Promise.resolve(policyRow());
  });
  const get = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve({ id: 'pol-1', status: state.status }),
    );
  const policyService = { loadVisible, get } as unknown as PolicyService;

  const findStatus = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve({ id: 'pol-1', status: state.status }),
    );
  const policies = { findStatus } as unknown as PolicyRepository;

  const create = vi
    .fn<(input: Record<string, unknown>) => Promise<unknown>>()
    .mockImplementation((input) =>
      Promise.resolve({ id: 'del-1', ...input, receiptAcknowledgedAt: null }),
    );
  const stampReceiptAck = vi.fn().mockImplementation((id: string, at: Date) =>
    opts.stampLosesRace
      ? Promise.resolve(null)
      : Promise.resolve({
          id,
          deliveredAt: opts.deliveryRecord?.deliveredAt ?? new Date(0),
          receiptAcknowledgedAt: at,
        }),
  );
  const deliveries = {
    create,
    stampReceiptAck,
  } as unknown as PolicyDeliveryRepository;

  const record = vi
    .fn<(input: { action: string; entityType: string }) => Promise<void>>()
    .mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  const transition = vi
    .fn<(p: { toStatus: string }) => Promise<unknown>>()
    .mockImplementation((p) => {
      if (opts.transitionRejects === 'conflict') {
        return Promise.reject(
          new ConflictException('status changed concurrently'),
        );
      }
      if (opts.transitionRejects === 'unprocessable') {
        return Promise.reject(
          new UnprocessableEntityException('already in status DELIVERED'),
        );
      }
      if (opts.transitionRejects === 'other') {
        return Promise.reject(new Error('boom'));
      }
      state.status = p.toStatus;
      return Promise.resolve({ id: 'pol-1', status: p.toStatus });
    });
  const workflow = { transition } as unknown as WorkflowTransitionService;

  return {
    service: new PolicyDeliveryService(
      deliveries,
      policies,
      audit,
      workflow,
      policyService,
    ),
    state,
    mocks: {
      loadVisible,
      get,
      findStatus,
      create,
      stampReceiptAck,
      record,
      transition,
    },
  };
}

describe('PolicyDeliveryService', () => {
  describe('recordDelivery', () => {
    it('walks VERIFIED -> DELIVERED, creates the DeliveryRecord, audits CREATE', async () => {
      const { service, mocks, state } = makeDeps();

      await service.recordDelivery('pol-1', DELIVERY_DTO, deliverer());

      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: 'pol-1', toStatus: 'DELIVERED' }),
      );
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          policyId: 'pol-1',
          method: 'email',
          recipient: 'ops@acme.test',
        }),
      );
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entityType: 'DeliveryRecord',
        }),
      );
      expect(state.status).toBe('DELIVERED');
    });

    it('409 when the VERIFIED -> DELIVERED transition loses the race (engine ConflictException)', async () => {
      const { service, mocks } = makeDeps({ transitionRejects: 'conflict' });
      await expect(
        service.recordDelivery('pol-1', DELIVERY_DTO, deliverer()),
      ).rejects.toThrow(ConflictException);
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it('409 (not 422) when the engine rejects with "already in status DELIVERED" — same race, one status code', async () => {
      const { service, mocks } = makeDeps({
        transitionRejects: 'unprocessable',
      });
      await expect(
        service.recordDelivery('pol-1', DELIVERY_DTO, deliverer()),
      ).rejects.toThrow(ConflictException);
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it('422 when the policy is not VERIFIED and not a resumable partial delivery', async () => {
      const { service, mocks } = makeDeps({ policyStatus: 'ISSUED' });
      await expect(
        service.recordDelivery('pol-1', DELIVERY_DTO, deliverer()),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mocks.transition).not.toHaveBeenCalled();
    });

    it('resumes a partial delivery (DELIVERED, no DeliveryRecord) without re-transitioning', async () => {
      const { service, mocks } = makeDeps({
        policyStatus: 'DELIVERED',
        deliveryRecord: null,
      });
      await service.recordDelivery('pol-1', DELIVERY_DTO, deliverer());
      expect(mocks.transition).not.toHaveBeenCalled();
      expect(mocks.create).toHaveBeenCalledTimes(1);
    });

    it('422 when DELIVERED and a DeliveryRecord already exists (not a resume)', async () => {
      const { service } = makeDeps({
        policyStatus: 'DELIVERED',
        deliveryRecord: {
          id: 'del-1',
          deliveredAt: new Date(),
          receiptAcknowledgedAt: null,
        },
      });
      await expect(
        service.recordDelivery('pol-1', DELIVERY_DTO, deliverer()),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('409 when the DeliveryRecord insert hits the policyId unique index', async () => {
      const { service, mocks } = makeDeps();
      mocks.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(
        service.recordDelivery('pol-1', DELIVERY_DTO, deliverer()),
      ).rejects.toThrow(ConflictException);
    });

    it('404 when the caller cannot see the policy', async () => {
      const { service } = makeDeps({ notVisible: true });
      await expect(
        service.recordDelivery('pol-1', DELIVERY_DTO, deliverer()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('acknowledgeReceipt', () => {
    // "today" in the test env is 2026-09-01, so these instants are all in the
    // past — parseHistoricalInstant rejects future dates.
    const withDelivery = (
      over?: Partial<Opts['deliveryRecord'] & object>,
    ): Opts => ({
      policyStatus: 'DELIVERED',
      deliveryRecord: {
        id: 'del-1',
        deliveredAt: new Date('2026-08-20T00:00:00Z'),
        receiptAcknowledgedAt: null,
        ...over,
      },
    });

    it('stamps the receipt, audits UPDATE, and best-effort advances DELIVERED -> ACTIVE', async () => {
      const { service, mocks, state } = makeDeps(withDelivery());

      await service.acknowledgeReceipt(
        'pol-1',
        { acknowledgedAt: '2026-08-25T00:00:00Z' },
        deliverer(),
      );

      expect(mocks.stampReceiptAck).toHaveBeenCalledWith(
        'del-1',
        expect.any(Date),
      );
      expect(mocks.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          entityType: 'DeliveryRecord',
        }),
      );
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({ toStatus: 'ACTIVE' }),
      );
      expect(state.status).toBe('ACTIVE');
    });

    it('422 when no delivery has been recorded', async () => {
      const { service } = makeDeps({
        policyStatus: 'VERIFIED',
        deliveryRecord: null,
      });
      await expect(
        service.acknowledgeReceipt('pol-1', {}, deliverer()),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('409 when receipt was already acknowledged (and the policy has moved on)', async () => {
      const { service } = makeDeps({
        ...withDelivery({
          receiptAcknowledgedAt: new Date('2026-08-25T00:00:00Z'),
        }),
        policyStatus: 'ACTIVE',
      });
      await expect(
        service.acknowledgeReceipt('pol-1', {}, deliverer()),
      ).rejects.toThrow(ConflictException);
    });

    it('resumes the DELIVERED -> ACTIVE advance when the stamp already committed', async () => {
      const { service, mocks, state } = makeDeps(
        withDelivery({
          receiptAcknowledgedAt: new Date('2026-08-25T00:00:00Z'),
        }),
      );
      await service.acknowledgeReceipt('pol-1', {}, deliverer());
      expect(mocks.stampReceiptAck).not.toHaveBeenCalled();
      expect(mocks.transition).toHaveBeenCalledWith(
        expect.objectContaining({ toStatus: 'ACTIVE' }),
      );
      expect(state.status).toBe('ACTIVE');
    });

    it('422 when acknowledgedAt is before the delivery date', async () => {
      const { service } = makeDeps(withDelivery());
      await expect(
        service.acknowledgeReceipt(
          'pol-1',
          { acknowledgedAt: '2026-08-10T00:00:00Z' },
          deliverer(),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('409 when the stamp loses the race', async () => {
      const { service } = makeDeps({ ...withDelivery(), stampLosesRace: true });
      await expect(
        service.acknowledgeReceipt('pol-1', {}, deliverer()),
      ).rejects.toThrow(ConflictException);
    });

    it('still records the acknowledgement when the ACTIVE advance fails (best-effort)', async () => {
      const { service, mocks } = makeDeps({
        ...withDelivery(),
        transitionRejects: 'other',
      });
      const view = await service.acknowledgeReceipt('pol-1', {}, deliverer());
      expect(mocks.stampReceiptAck).toHaveBeenCalled();
      expect(view).toBeDefined();
    });
  });
});
