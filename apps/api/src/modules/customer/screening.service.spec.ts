import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ScreeningService } from './screening.service';
import type { KycRecordRepository } from '../../repositories/kyc-record.repository';
import type { CustomerRepository } from '../../repositories/customer.repository';
import type { AuditService } from '../audit/audit.service';

interface ScreeningResultInput {
  kycRecordId: string;
  screeningType: 'SANCTIONS' | 'PEP' | 'AML';
  result: 'CLEAR' | 'HIT';
  listSource?: string;
  escalatedToComplianceAt?: Date;
}

function makeDeps() {
  const findById = vi.fn();
  const createScreeningResult = vi
    .fn()
    .mockImplementation((input: ScreeningResultInput) =>
      Promise.resolve({ id: `sr-${input.screeningType}`, ...input }),
    );
  const upsertRiskRating = vi
    .fn()
    .mockImplementation((input: { kycRecordId: string; level: string }) =>
      Promise.resolve({ id: 'rr-1', ...input }),
    );
  const findRiskRatingByKycRecordId = vi.fn().mockResolvedValue(null);
  const update = vi.fn().mockResolvedValue({});
  const kycRecords = {
    findById,
    createScreeningResult,
    upsertRiskRating,
    findRiskRatingByKycRecordId,
    update,
  } as unknown as KycRecordRepository;

  const findCustomerById = vi.fn();
  const findUbosByCustomerId = vi.fn().mockResolvedValue([]);
  const customers = {
    findById: findCustomerById,
    findUbosByCustomerId,
  } as unknown as CustomerRepository;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;

  return {
    service: new ScreeningService(kycRecords, customers, audit),
    mocks: {
      findById,
      createScreeningResult,
      upsertRiskRating,
      findRiskRatingByKycRecordId,
      update,
      findCustomerById,
      findUbosByCustomerId,
      record,
    },
  };
}

describe('ScreeningService', () => {
  describe('run', () => {
    it('throws NotFoundException for a missing KYCRecord', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue(null);

      await expect(service.run('kyc-1', 'compliance-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('writes one ScreeningResult per screening type and rates STANDARD when every name is clear', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({ id: 'kyc-1', customerId: 'cust-1' });
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        legalName: 'Perfectly Ordinary Trading Co.',
      });

      const outcome = await service.run('kyc-1', 'compliance-1');

      const calls = mocks.createScreeningResult.mock.calls as [
        ScreeningResultInput,
      ][];
      expect(calls).toHaveLength(3);
      expect(calls.map(([input]) => input.screeningType)).toEqual([
        'SANCTIONS',
        'PEP',
        'AML',
      ]);
      for (const [input] of calls) {
        expect(input.result).toBe('CLEAR');
        expect(input.escalatedToComplianceAt).toBeUndefined();
      }
      expect(mocks.upsertRiskRating).toHaveBeenCalledWith(
        expect.objectContaining({ kycRecordId: 'kyc-1', level: 'STANDARD' }),
      );
      // isEdd was already false and stays false — no write, no audit churn.
      expect(mocks.update).not.toHaveBeenCalled();
      expect(outcome.riskLevel).toBe('STANDARD');
      expect(outcome.isEdd).toBe(false);
      expect(outcome.newHit).toBe(false);
    });

    it('flags a HIT and rates HIGH when the Customer legalName matches the sample watchlist', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({ id: 'kyc-1', customerId: 'cust-1' });
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        legalName: 'Sample Sanctioned Trading Co.',
      });

      const outcome = await service.run('kyc-1', 'compliance-1');

      const calls = mocks.createScreeningResult.mock.calls as [
        ScreeningResultInput,
      ][];
      for (const [input] of calls) {
        expect(input.result).toBe('HIT');
        expect(input.escalatedToComplianceAt).toBeInstanceOf(Date);
        expect(input.listSource).toMatch(/OFAC SDN List \(fixture\)/);
      }
      expect(mocks.upsertRiskRating).toHaveBeenCalledWith(
        expect.objectContaining({ kycRecordId: 'kyc-1', level: 'HIGH' }),
      );
      expect(mocks.update).toHaveBeenCalledWith('kyc-1', { isEdd: true });
      expect(outcome.riskLevel).toBe('HIGH');
      expect(outcome.isEdd).toBe(true);
      expect(outcome.newHit).toBe(true);
    });

    it('does not downgrade a prior HIGH rating (or clear isEdd) on a CLEAR re-scan, and audits nothing changed', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'kyc-1',
        customerId: 'cust-1',
        isEdd: true,
      });
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        legalName: 'Perfectly Ordinary Trading Co.',
      });
      mocks.findRiskRatingByKycRecordId.mockResolvedValue({
        id: 'rr-1',
        level: 'HIGH',
      });

      const outcome = await service.run('kyc-1', 'compliance-1');

      // HIGH retained, isEdd retained — a re-scan CLEAR never rolls back a
      // prior escalation. The existing RiskRating row is left untouched: no
      // upsert (which would bump ratedAt / rewrite reason with nothing in
      // the audit trail), no isEdd write.
      expect(mocks.upsertRiskRating).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
      expect(outcome.riskLevel).toBe('HIGH');
      expect(outcome.isEdd).toBe(true);
      expect(outcome.newHit).toBe(false);
      // Nothing changed -> no RiskRating audit row (only the 3
      // ScreeningResult CREATE rows).
      const ratingAudits = (
        mocks.record.mock.calls as [{ entityType: string }][]
      )
        .map(([c]) => c.entityType)
        .filter((t) => t === 'RiskRating');
      expect(ratingAudits).toHaveLength(0);
    });

    it('audits a RiskRating escalation (STANDARD -> HIGH) on a re-scan that newly HITs', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({
        id: 'kyc-1',
        customerId: 'cust-1',
        isEdd: false,
      });
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        legalName: 'Sample Sanctioned Trading Co.',
      });
      mocks.findRiskRatingByKycRecordId.mockResolvedValue({
        id: 'rr-1',
        level: 'STANDARD',
      });

      await service.run('kyc-1', 'compliance-1');

      const ratingUpdate = (
        mocks.record.mock.calls as [
          {
            action: string;
            entityType: string;
            beforeValue?: { level?: string };
            afterValue?: { level?: string };
          },
        ][]
      )
        .map(([c]) => c)
        .find((c) => c.entityType === 'RiskRating' && c.action === 'UPDATE');
      expect(ratingUpdate?.beforeValue?.level).toBe('STANDARD');
      expect(ratingUpdate?.afterValue?.level).toBe('HIGH');
    });

    it('flags a HIT when a UBO name matches, even if the Customer legalName is clear', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({ id: 'kyc-1', customerId: 'cust-1' });
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        legalName: 'Perfectly Ordinary Trading Co.',
      });
      mocks.findUbosByCustomerId.mockResolvedValue([
        { id: 'ubo-1', fullName: 'Zayd Al-Muraqib' },
      ]);

      const outcome = await service.run('kyc-1', 'compliance-1');

      expect(outcome.riskLevel).toBe('HIGH');
      expect(outcome.isEdd).toBe(true);
    });

    it('never logs the matched subject name itself, only the list source', async () => {
      const { service, mocks } = makeDeps();
      mocks.findById.mockResolvedValue({ id: 'kyc-1', customerId: 'cust-1' });
      mocks.findCustomerById.mockResolvedValue({
        id: 'cust-1',
        legalName: 'Sample Sanctioned Trading Co.',
      });

      await service.run('kyc-1', 'compliance-1');

      const auditCalls = mocks.record.mock.calls as [
        { afterValue?: unknown },
      ][];
      for (const [input] of auditCalls) {
        expect(JSON.stringify(input.afterValue)).not.toContain(
          'Sample Sanctioned Trading Co.',
        );
      }
    });
  });
});
