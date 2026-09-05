import { describe, expect, it, vi } from 'vitest';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PaymentChannelService } from './payment-channel.service';
import type { PaymentChannelRepository } from '../../repositories/payment-channel.repository';
import type { AuditService } from '../audit/audit.service';

const channelRow = (over: Record<string, unknown> = {}) => ({
  id: 'pc-1',
  ownerType: 'customer',
  customerId: 'cust-1',
  insurerId: null,
  channelType: 'bank_transfer',
  label: 'Primary JOD',
  bankName: 'Cairo Amman Bank',
  accountLast4: '1234',
  currency: 'JOD',
  status: 'active',
  disabledAt: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  ...over,
});

function makeService(over: Partial<Record<string, unknown>> = {}) {
  const channels = {
    customerExists: vi.fn().mockResolvedValue(true),
    insurerExists: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockResolvedValue(channelRow()),
    findById: vi.fn().mockResolvedValue(channelRow()),
    findMany: vi.fn().mockResolvedValue([]),
    disable: vi.fn().mockResolvedValue({ count: 1 }),
    ...over,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new PaymentChannelService(
    channels as unknown as PaymentChannelRepository,
    audit as unknown as AuditService,
  );
  return { service, channels, audit };
}

describe('PaymentChannelService.create (Process 38)', () => {
  it('creates a customer channel + a CREATE audit row', async () => {
    const { service, channels, audit } = makeService();
    const v = await service.create(
      {
        ownerType: 'customer',
        customerId: 'cust-1',
        channelType: 'bank_transfer',
        label: 'Primary JOD',
        accountLast4: '1234',
      },
      'fin-1',
    );
    expect(v).toMatchObject({ ownerType: 'customer', isActive: true });
    expect(channels.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerType: 'customer',
        customerId: 'cust-1',
        insurerId: null,
        currency: 'JOD',
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'PaymentChannel',
      }),
    );
    // the audit snapshot never carries the account fragment
    const snap = JSON.stringify(audit.record.mock.calls[0]?.[0]);
    expect(snap).not.toContain('1234');
  });

  it('creates an insurer channel', async () => {
    const { service, channels } = makeService({
      create: vi.fn().mockResolvedValue(
        channelRow({
          ownerType: 'insurer',
          customerId: null,
          insurerId: 'ins-1',
        }),
      ),
    });
    const v = await service.create(
      {
        ownerType: 'insurer',
        insurerId: 'ins-1',
        channelType: 'cheque',
        label: 'Insurer settlement',
      },
      'fin-1',
    );
    expect(v.ownerType).toBe('insurer');
    expect(channels.create).toHaveBeenCalledWith(
      expect.objectContaining({ insurerId: 'ins-1', customerId: null }),
    );
  });

  it('422s a customer channel that also carries an insurerId', async () => {
    const { service } = makeService();
    await expect(
      service.create(
        {
          ownerType: 'customer',
          customerId: 'cust-1',
          insurerId: 'ins-1',
          channelType: 'bank_transfer',
          label: 'x y',
        },
        'fin-1',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('404s an unknown customer', async () => {
    const { service } = makeService({
      customerExists: vi.fn().mockResolvedValue(false),
    });
    await expect(
      service.create(
        {
          ownerType: 'customer',
          customerId: 'nope',
          channelType: 'cash',
          label: 'x y',
        },
        'fin-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s an unknown insurer', async () => {
    const { service } = makeService({
      insurerExists: vi.fn().mockResolvedValue(false),
    });
    await expect(
      service.create(
        {
          ownerType: 'insurer',
          insurerId: 'nope',
          channelType: 'cash',
          label: 'x y',
        },
        'fin-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PaymentChannelService.disable (Process 38)', () => {
  it('disables an active channel + a UPDATE audit row', async () => {
    const { service, channels, audit } = makeService({
      findById: vi
        .fn()
        .mockResolvedValueOnce(channelRow())
        .mockResolvedValue(
          channelRow({ status: 'disabled', disabledAt: new Date() }),
        ),
    });
    const v = await service.disable('pc-1', 'fin-1');
    expect(channels.disable).toHaveBeenCalledWith('pc-1');
    expect(v.status).toBe('disabled');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'PaymentChannel',
      }),
    );
  });

  it('is idempotent on an already-disabled channel (no write, no audit)', async () => {
    const { service, channels, audit } = makeService({
      findById: vi.fn().mockResolvedValue(channelRow({ status: 'disabled' })),
    });
    const v = await service.disable('pc-1', 'fin-1');
    expect(v.status).toBe('disabled');
    expect(channels.disable).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('404s an unknown channel', async () => {
    const { service } = makeService({
      findById: vi.fn().mockResolvedValue(null),
    });
    await expect(service.disable('nope', 'fin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('PaymentChannelService.list (Process 38)', () => {
  it('maps rows through the view', async () => {
    const { service } = makeService({
      findMany: vi
        .fn()
        .mockResolvedValue([channelRow(), channelRow({ id: 'pc-2' })]),
    });
    const rows = await service.list({});
    expect(rows.map((r) => r.id)).toEqual(['pc-1', 'pc-2']);
  });
});
