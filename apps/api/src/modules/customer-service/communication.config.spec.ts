import { describe, expect, it } from 'vitest';
import {
  blockedCommunicationAuditSnapshot,
  communicationAuditSnapshot,
  deriveCommunicationView,
  evaluateMarketingConsent,
  isCommunicationChannel,
  resolveChannel,
  resolveLanguage,
  type CommunicationRow,
  type MarketingConsentRow,
} from './communication.config';

function consent(
  over: Partial<MarketingConsentRow> & { id: string },
): MarketingConsentRow {
  return {
    granted: true,
    withdrawnAt: null,
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

describe('evaluateMarketingConsent (Process 44)', () => {
  it('no record on file -> blocked, reason no_record, no consentRecordId', () => {
    expect(evaluateMarketingConsent([])).toEqual({
      allowed: false,
      reason: 'no_record',
      consentRecordId: null,
    });
  });

  it('a single granted, not-withdrawn record -> allowed with its id', () => {
    expect(evaluateMarketingConsent([consent({ id: 'c-1' })])).toEqual({
      allowed: true,
      reason: 'granted',
      consentRecordId: 'c-1',
    });
  });

  it('latest record not granted -> blocked (not_granted)', () => {
    expect(
      evaluateMarketingConsent([consent({ id: 'c-1', granted: false })]),
    ).toEqual({
      allowed: false,
      reason: 'not_granted',
      consentRecordId: 'c-1',
    });
  });

  it('latest record withdrawn -> blocked (withdrawn), even if granted is still true', () => {
    expect(
      evaluateMarketingConsent([
        consent({
          id: 'c-1',
          granted: true,
          withdrawnAt: new Date('2026-02-01T00:00:00.000Z'),
        }),
      ]),
    ).toEqual({ allowed: false, reason: 'withdrawn', consentRecordId: 'c-1' });
  });

  it('the most recent record wins by grantedAt: a fresh grant after an earlier withdrawal is a valid re-opt-in', () => {
    const decision = evaluateMarketingConsent([
      consent({
        id: 'old',
        granted: true,
        grantedAt: new Date('2026-01-01T00:00:00.000Z'),
        withdrawnAt: new Date('2026-03-01T00:00:00.000Z'),
      }),
      consent({
        id: 'new',
        granted: true,
        grantedAt: new Date('2026-04-01T00:00:00.000Z'),
        withdrawnAt: null,
      }),
    ]);
    expect(decision).toEqual({
      allowed: true,
      reason: 'granted',
      consentRecordId: 'new',
    });
  });

  it('a withdrawal newer than the last grant blocks', () => {
    const decision = evaluateMarketingConsent([
      consent({
        id: 'grant',
        grantedAt: new Date('2026-04-01T00:00:00.000Z'),
        withdrawnAt: null,
      }),
      consent({
        id: 'withdrawal',
        granted: true,
        grantedAt: new Date('2026-05-01T00:00:00.000Z'),
        withdrawnAt: new Date('2026-05-02T00:00:00.000Z'),
      }),
    ]);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('withdrawn');
    expect(decision.consentRecordId).toBe('withdrawal');
  });

  it('falls back to createdAt when grantedAt is null, and breaks a tie by createdAt', () => {
    const decision = evaluateMarketingConsent([
      consent({
        id: 'a',
        granted: false,
        grantedAt: null,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
      consent({
        id: 'b',
        granted: true,
        grantedAt: null,
        createdAt: new Date('2026-06-02T00:00:00.000Z'),
      }),
    ]);
    expect(decision).toEqual({
      allowed: true,
      reason: 'granted',
      consentRecordId: 'b',
    });
  });

  it('FAIL-SAFE: a withdrawal on an OLDER record, more recent than a newer active grant, still blocks', () => {
    const decision = evaluateMarketingConsent([
      consent({
        id: 'old',
        granted: true,
        grantedAt: new Date('2026-01-01T00:00:00.000Z'),
        withdrawnAt: new Date('2026-03-01T00:00:00.000Z'),
      }),
      consent({
        id: 'newer-grant',
        granted: true,
        grantedAt: new Date('2026-02-01T00:00:00.000Z'),
        withdrawnAt: null,
      }),
    ]);
    expect(decision).toEqual({
      allowed: false,
      reason: 'withdrawn',
      consentRecordId: 'old',
    });
  });

  it('a withdrawal at the SAME instant as the newest active grant blocks (>= , not >)', () => {
    const t = new Date('2026-04-01T00:00:00.000Z');
    const decision = evaluateMarketingConsent([
      consent({ id: 'w', granted: true, grantedAt: t, withdrawnAt: t }),
      consent({ id: 'g', granted: true, grantedAt: t, withdrawnAt: null }),
    ]);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('withdrawn');
  });
});

describe('resolveChannel (Process 44) — respect the recorded channel', () => {
  it('omitted -> the customer recorded preference', () => {
    expect(resolveChannel(undefined, 'EMAIL')).toEqual({
      value: 'EMAIL',
      error: null,
    });
  });

  it('omitted with no recorded preference -> error', () => {
    const r = resolveChannel(undefined, null);
    expect(r.value).toBeNull();
    expect(r.error).toMatch(/recorded preferred channel/);
  });

  it('explicit value equal to the recorded preference -> that value', () => {
    expect(resolveChannel('EMAIL', 'EMAIL')).toEqual({
      value: 'EMAIL',
      error: null,
    });
  });

  it('explicit value disagreeing with the recorded preference -> error', () => {
    const r = resolveChannel('SMS', 'EMAIL');
    expect(r.value).toBeNull();
    expect(r.error).toMatch(/disagrees with the customer's recorded channel/);
  });

  it('explicit value with no recorded preference -> that value', () => {
    expect(resolveChannel('WHATSAPP', null)).toEqual({
      value: 'WHATSAPP',
      error: null,
    });
  });

  it('a recorded value outside the outbound subset (e.g. MEETING) is treated as no preference — omit -> error', () => {
    const r = resolveChannel(undefined, 'MEETING');
    expect(r.value).toBeNull();
    expect(r.error).toMatch(/pass channel explicitly/);
  });

  it('a recorded value outside the outbound subset does NOT 422 an explicit valid channel', () => {
    expect(resolveChannel('EMAIL', 'VISIT')).toEqual({
      value: 'EMAIL',
      error: null,
    });
  });
});

describe('resolveLanguage (Process 44) — respect the recorded language', () => {
  it('omitted -> the customer recorded language', () => {
    expect(resolveLanguage(undefined, 'AR')).toEqual({
      value: 'AR',
      error: null,
    });
  });

  it('explicit value equal to the recorded language -> that value', () => {
    expect(resolveLanguage('EN', 'EN')).toEqual({ value: 'EN', error: null });
  });

  it('explicit value disagreeing with the recorded language -> error', () => {
    const r = resolveLanguage('EN', 'AR');
    expect(r.value).toBeNull();
    expect(r.error).toMatch(/disagrees with the customer's recorded language/);
  });
});

describe('isCommunicationChannel (Process 44)', () => {
  it('accepts the outbound channel subset, rejects an interaction-context value', () => {
    expect(isCommunicationChannel('EMAIL')).toBe(true);
    expect(isCommunicationChannel('PORTAL')).toBe(true);
    expect(isCommunicationChannel('MEETING')).toBe(false);
    expect(isCommunicationChannel('COMPLAINT')).toBe(false);
    expect(isCommunicationChannel('nonsense')).toBe(false);
  });
});

describe('deriveCommunicationView (Process 44)', () => {
  const row: CommunicationRow = {
    id: 'comm-1',
    customerId: 'cust-1',
    channel: 'EMAIL',
    templateId: 'welcome-v2',
    languageUsed: 'AR',
    direction: 'OUTBOUND',
    subject: 'Your policy documents',
    body: 'Please find your certificate attached.',
    isMarketing: false,
    respectedConsent: true,
    consentRecordId: null,
    loggedByUserId: 'u-sales',
    sentAt: new Date('2026-09-04T09:00:00.000Z'),
    createdAt: new Date('2026-09-04T09:00:01.000Z'),
  };

  it('renders the row with ISO timestamps and the body intact', () => {
    expect(deriveCommunicationView(row)).toEqual({
      id: 'comm-1',
      customerId: 'cust-1',
      channel: 'EMAIL',
      templateId: 'welcome-v2',
      languageUsed: 'AR',
      direction: 'OUTBOUND',
      subject: 'Your policy documents',
      body: 'Please find your certificate attached.',
      isMarketing: false,
      respectedConsent: true,
      consentRecordId: null,
      loggedByUserId: 'u-sales',
      sentAt: '2026-09-04T09:00:00.000Z',
      createdAt: '2026-09-04T09:00:01.000Z',
    });
  });
});

describe('communication audit snapshots (Process 44)', () => {
  it('CREATE snapshot carries channel / language / consent metadata but NEVER subject or body', () => {
    const snap = communicationAuditSnapshot({
      communicationLogId: 'comm-1',
      customerId: 'cust-1',
      channel: 'EMAIL',
      templateId: 'promo-v1',
      languageUsed: 'EN',
      direction: 'OUTBOUND',
      isMarketing: true,
      respectedConsent: true,
      consentRecordId: 'c-9',
      sentAt: new Date('2026-09-04T09:00:00.000Z'),
    });
    expect(snap).toEqual({
      communicationLogId: 'comm-1',
      customerId: 'cust-1',
      channel: 'EMAIL',
      templateId: 'promo-v1',
      languageUsed: 'EN',
      direction: 'OUTBOUND',
      isMarketing: true,
      respectedConsent: true,
      consentRecordId: 'c-9',
      sentAt: '2026-09-04T09:00:00.000Z',
    });
    expect(JSON.stringify(snap)).not.toMatch(/subject|body/i);
  });

  it('BLOCKED snapshot records the reason + targeted customer, no message content', () => {
    const snap = blockedCommunicationAuditSnapshot({
      customerId: 'cust-1',
      channel: 'SMS',
      reason: 'withdrawn',
      consentRecordId: 'c-3',
    });
    expect(snap).toEqual({
      customerId: 'cust-1',
      channel: 'SMS',
      isMarketing: true,
      blocked: 'marketing_consent_withdrawn',
      consentRecordId: 'c-3',
    });
  });
});
