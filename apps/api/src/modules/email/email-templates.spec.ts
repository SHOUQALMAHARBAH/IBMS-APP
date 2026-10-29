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

/**
 * EVERY KIND, so a fourth template cannot ship outside the sweeps below. The invitation needs
 * parameters the other two do not, which is why this is a list of rendered CASES rather than of
 * kinds — a `kind` alone cannot be rendered.
 */
const ALL_TEMPLATES = [
  RESET,
  TEST_MESSAGE,
  {
    kind: 'organization_administrator_invitation' as const,
    params: {
      recipientName: 'سارة النعيمي',
      organizationName: 'شركة السلام لوساطة التأمين',
      setPasswordUrl: 'https://waseet.example/reset-password?token=xyz789',
      expiresInMinutes: 60,
    },
  },
];

describe('password reset notification', () => {
  it('renders in Arabic by default — the platform language', () => {
    const message = renderNotification(RESET, 'AR');

    expect(message.subject).toContain('إعادة تعيين كلمة المرور');
    expect(message.bodyText).toContain('أحمد الخطيب');
    expect(message.bodyText).toContain('لم تتغيّر كلمة المرور');
  });

  it('renders in English for a recipient who chose it', () => {
    const message = renderNotification(RESET, 'EN');

    expect(message.subject).toBe('Reset your WASEET 360 password');
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

  it('names the product in EVERY subject, in BOTH languages (owner decision 2026-10-29)', () => {
    /*
     * THE OWNER'S RULING, and the half worth keeping is her reason: the three Arabic subjects
     * were never WRONG — they described the system because there was no name to put there, and
     * they never carried the `IBMS` codename at all. There is a name now, so they carry it.
     *
     * ASSERTED OVER EVERY KIND rather than over the three subjects that exist today, because the
     * failure this guards is a FOURTH template shipping with a generic Arabic subject while its
     * English sibling names the product — which is exactly the asymmetry that was here before.
     *
     * The Arabic and Latin forms are both checked, one per language, because they are two
     * different strings and a subject carrying the Latin `WASEET 360` in Arabic would be the
     * product shouting in the wrong script on the one line a recipient reads first.
     */
    const brand = { AR: 'وسيط 360', EN: 'WASEET 360' } as const;

    for (const template of ALL_TEMPLATES) {
      for (const language of ['AR', 'EN'] as const) {
        const message = renderNotification(template, language);
        expect(message.subject).toContain(brand[language]);
      }
    }
  });

  it('carries no generic stand-in where the product name belongs', () => {
    /*
     * THE ABSENCE IS THE OTHER HALF, and only an absence can fail: a subject that gained the name
     * while KEEPING «نظام إدارة الوساطة التأمينية» beside it would satisfy the check above and
     * still say more in Arabic than in English — two subjects for one email, which is what the
     * substitution was for.
     */
    for (const template of ALL_TEMPLATES) {
      expect(renderNotification(template, 'AR').subject).not.toContain(
        'نظام إدارة الوساطة التأمينية',
      );
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
