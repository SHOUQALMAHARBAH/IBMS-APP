import { describe, expect, it, vi } from 'vitest';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CommunicationService } from './communication.service';
import type { CommunicationRepository } from '../../repositories/communication.repository';
import type { AuditService } from '../audit/audit.service';

const commRow = (over: Record<string, unknown> = {}) => ({
  id: 'comm-1',
  customerId: 'cust-1',
  channel: 'EMAIL',
  templateId: null,
  languageUsed: 'AR',
  direction: 'OUTBOUND',
  subject: null,
  body: 'Please find your certificate attached.',
  isMarketing: false,
  respectedConsent: true,
  consentRecordId: null,
  loggedByUserId: 'u-sales',
  sentAt: new Date('2026-09-04T09:00:00.000Z'),
  createdAt: new Date('2026-09-04T09:00:01.000Z'),
  ...over,
});

const grantedConsent = {
  id: 'c-1',
  granted: true,
  withdrawnAt: null,
  grantedAt: new Date('2026-01-01T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

function makeService(over: { repo?: Record<string, unknown> } = {}) {
  const repo = {
    customerForCommunication: vi.fn().mockResolvedValue({
      id: 'cust-1',
      languagePreference: 'AR',
      preferredContactChannel: 'EMAIL',
    }),
    marketingConsentRecords: vi.fn().mockResolvedValue([grantedConsent]),
    create: vi.fn().mockResolvedValue(commRow()),
    findProcess44ById: vi.fn().mockResolvedValue(commRow()),
    findManyProcess44: vi.fn().mockResolvedValue([]),
    ...over.repo,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new CommunicationService(
    repo as unknown as CommunicationRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('CommunicationService.create (Process 44)', () => {
  it('404s when the customer does not exist', async () => {
    const { service } = makeService({
      repo: { customerForCommunication: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.create({ customerId: 'nope', body: 'hi' }, 'u-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('derives channel + language from the customer record and writes a CREATE audit row (no subject/body in it)', async () => {
    const { service, repo, audit } = makeService();
    const v = await service.create(
      { customerId: 'cust-1', body: 'hello' },
      'u-sales',
    );
    expect(v.channel).toBe('EMAIL');
    expect(v.languageUsed).toBe('AR');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust-1',
        channel: 'EMAIL',
        languageUsed: 'AR',
        isMarketing: false,
        consentRecordId: null,
        loggedByUserId: 'u-sales',
      }),
    );
    const auditCall = audit.record.mock.calls[0][0] as {
      action: string;
      entityType: string;
      entityId: string;
      afterValue: unknown;
    };
    expect(auditCall).toMatchObject({
      action: 'CREATE',
      entityType: 'CommunicationLog',
      entityId: 'comm-1',
    });
    expect(JSON.stringify(auditCall.afterValue)).not.toMatch(/body|subject/i);
  });

  it('422s when an explicit channel disagrees with the recorded preference', async () => {
    const { service, repo } = makeService();
    await expect(
      service.create(
        { customerId: 'cust-1', channel: 'SMS', body: 'hi' },
        'u-1',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('422s when an explicit language disagrees with the recorded language', async () => {
    const { service } = makeService();
    await expect(
      service.create(
        { customerId: 'cust-1', languageUsed: 'EN', body: 'hi' },
        'u-1',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422s when channel is omitted and the customer has no recorded preference', async () => {
    const { service } = makeService({
      repo: {
        customerForCommunication: vi.fn().mockResolvedValue({
          id: 'cust-1',
          languagePreference: 'AR',
          preferredContactChannel: null,
        }),
      },
    });
    await expect(
      service.create({ customerId: 'cust-1', body: 'hi' }, 'u-1'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('a marketing send with granted consent records the consentRecordId', async () => {
    const { service, repo } = makeService();
    await service.create(
      { customerId: 'cust-1', isMarketing: true, body: 'promo' },
      'u-sales',
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ isMarketing: true, consentRecordId: 'c-1' }),
    );
  });

  it('a marketing send with NO consent on file is blocked (422), writes a REJECT audit row, and creates no CommunicationLog', async () => {
    const { service, repo, audit } = makeService({
      repo: { marketingConsentRecords: vi.fn().mockResolvedValue([]) },
    });
    await expect(
      service.create(
        { customerId: 'cust-1', isMarketing: true, body: 'promo' },
        'u-sales',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.create).not.toHaveBeenCalled();
    const rejectCall = audit.record.mock.calls[0][0] as {
      action: string;
      entityType: string;
      entityId: string;
      afterValue: { blocked: string; customerId: string };
    };
    expect(rejectCall).toMatchObject({
      action: 'REJECT',
      entityType: 'CommunicationLog',
      entityId: 'blocked',
    });
    expect(rejectCall.afterValue.blocked).toBe('marketing_consent_no_record');
    expect(rejectCall.afterValue.customerId).toBe('cust-1');
  });

  it('a marketing send when the latest consent is withdrawn is blocked (422)', async () => {
    const { service, repo } = makeService({
      repo: {
        marketingConsentRecords: vi.fn().mockResolvedValue([
          {
            ...grantedConsent,
            withdrawnAt: new Date('2026-05-01T00:00:00.000Z'),
          },
        ]),
      },
    });
    await expect(
      service.create(
        { customerId: 'cust-1', isMarketing: true, body: 'promo' },
        'u-sales',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('a non-marketing send never touches the consent table', async () => {
    const { service, repo } = makeService();
    await service.create({ customerId: 'cust-1', body: 'service note' }, 'u-1');
    expect(repo.marketingConsentRecords).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ isMarketing: false, consentRecordId: null }),
    );
  });

  it('a backdated sentAt is parsed; a future one is rejected (422)', async () => {
    const { service, repo } = makeService();
    await service.create(
      {
        customerId: 'cust-1',
        body: 'hi',
        sentAt: '2026-09-01T09:00:00.000Z',
      },
      'u-1',
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sentAt: new Date('2026-09-01T09:00:00.000Z'),
      }),
    );
    await expect(
      service.create(
        {
          customerId: 'cust-1',
          body: 'hi',
          sentAt: '2999-01-01T00:00:00.000Z',
        },
        'u-1',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('a failed audit write never breaks the send', async () => {
    const { service, audit } = makeService();
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    const v = await service.create({ customerId: 'cust-1', body: 'hi' }, 'u-1');
    expect(v.id).toBe('comm-1');
  });
});

describe('CommunicationService.marketingConsentStatus (Process 44)', () => {
  it('returns the pure decision for the customer', async () => {
    const { service } = makeService();
    const status = await service.marketingConsentStatus('cust-1');
    expect(status).toEqual({
      customerId: 'cust-1',
      marketing: { allowed: true, reason: 'granted', consentRecordId: 'c-1' },
    });
  });

  it('404s for an unknown customer', async () => {
    const { service } = makeService({
      repo: { customerForCommunication: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.marketingConsentStatus('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('CommunicationService reads (Process 44)', () => {
  it('get() 404s for an id that is not a Process-44 row', async () => {
    const { service } = makeService({
      repo: { findProcess44ById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('rfq-corr-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('list() maps rows to views and passes the filters through', async () => {
    const { service, repo } = makeService({
      repo: { findManyProcess44: vi.fn().mockResolvedValue([commRow()]) },
    });
    const rows = await service.list({
      customerId: 'cust-1',
      isMarketing: false,
    });
    expect(rows).toHaveLength(1);
    expect(repo.findManyProcess44).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cust-1', isMarketing: false }),
      5000,
    );
  });
});
