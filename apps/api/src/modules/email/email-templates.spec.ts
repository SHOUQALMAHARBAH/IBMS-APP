import { describe, expect, it } from 'vitest';
import { renderNotification } from './email-templates';

const RESET = {
  kind: 'password_reset' as const,
  params: {
    recipientName: 'أحمد الخطيب',
    resetUrl: 'https://ibms.example/reset-password?token=abc123',
    expiresInMinutes: 60,
  },
};

const TEST_MESSAGE = {
  kind: 'mailbox_test' as const,
  params: {
    organizationName: 'شركة السلام لوساطة التأمين',
    connectedEmail: 'info@alsalam-insurance.jo',
  },
};

describe('password reset notification', () => {
  it('renders in Arabic by default — the platform language', () => {
    const message = renderNotification(RESET, 'AR');

    expect(message.subject).toContain('إعادة تعيين كلمة المرور');
    expect(message.bodyText).toContain('أحمد الخطيب');
    expect(message.bodyText).toContain('لم تتغيّر كلمة المرور');
  });

  it('renders in English for a recipient who chose it', () => {
    const message = renderNotification(RESET, 'EN');

    expect(message.subject).toBe('Reset your IBMS password');
    expect(message.bodyText).toContain('Hello أحمد الخطيب');
    expect(message.bodyText).toContain('your password has not changed');
  });

  it('carries the link, and states when it stops working', () => {
    for (const language of ['AR', 'EN'] as const) {
      const message = renderNotification(RESET, language);
      expect(message.bodyText).toContain(
        'https://ibms.example/reset-password?token=abc123',
      );
      expect(message.bodyText).toContain('60');
    }
  });

  it('never carries a password or a bare token', () => {
    // §6 — the message is a notification carrying a LINK, not the payload. The
    // token appears only as part of the URL the recipient opens.
    for (const language of ['AR', 'EN'] as const) {
      const body = renderNotification(RESET, language).bodyText;
      const withoutUrl = body.replace(RESET.params.resetUrl, '');
      expect(withoutUrl).not.toContain('abc123');
      expect(body.toLowerCase()).not.toContain('passwordhash');
    }
  });
});

describe('mailbox test notification', () => {
  it('names the office and the address it was sent from, in both languages', () => {
    for (const language of ['AR', 'EN'] as const) {
      const message = renderNotification(TEST_MESSAGE, language);
      expect(message.bodyText).toContain('info@alsalam-insurance.jo');
      expect(message.bodyText).toContain('شركة السلام لوساطة التأمين');
      expect(message.subject.length).toBeGreaterThan(0);
    }
  });

  it('differs by language rather than rendering one language twice', () => {
    const ar = renderNotification(TEST_MESSAGE, 'AR');
    const en = renderNotification(TEST_MESSAGE, 'EN');
    expect(ar.subject).not.toBe(en.subject);
    expect(ar.bodyText).not.toBe(en.bodyText);
  });
});

describe('every template', () => {
  it('supplies a non-empty subject and body in BOTH languages', () => {
    // A missing Arabic body would leave the platform's main audience reading
    // English, which is the wrong way round for this system.
    for (const template of [RESET, TEST_MESSAGE]) {
      for (const language of ['AR', 'EN'] as const) {
        const message = renderNotification(template, language);
        expect(message.subject.trim().length).toBeGreaterThan(0);
        expect(message.bodyText.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('produces plain text only — no HTML, no attachment field', () => {
    for (const template of [RESET, TEST_MESSAGE]) {
      const message = renderNotification(template, 'AR');
      expect(message.bodyText).not.toMatch(/<[a-z][\s\S]*>/i);
      expect(message).not.toHaveProperty('attachments');
      expect(message).not.toHaveProperty('bodyHtml');
    }
  });
});
