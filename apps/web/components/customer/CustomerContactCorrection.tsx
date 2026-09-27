'use client';

import { type CSSProperties, useCallback, useState } from 'react';
import {
  hasSomethingToCorrect,
  updateCustomerContactDetails,
  type CustomerContactCorrection as CorrectionInput,
} from '../../lib/customer/customer-api';
import { ApiError } from '../../lib/auth/api-client';
import { useAuth } from '../../lib/auth/auth-context';
import { useLanguage } from '../../lib/i18n/language-context';
import { hasPermission } from '../../lib/auth/permissions';
import { errorStyle } from '../auth/auth-form.styles';

/*
 * CORRECTING A CUSTOMER'S CONTACT DETAILS — the web caller `PATCH /customers/:id`
 * shipped without (IMPROVEMENTS § 1.65).
 *
 * Two things were unreachable, and the second is the serious one. The owner's
 * requirement was that phone, address and email be correctable unconditionally.
 * And `DsrService.fulfil` refuses to close a CORRECTION request until a correction
 * has actually been RECORDED against it — this route is the only thing that records
 * one — so a customer exercising a statutory right to have their data corrected
 * could have the request neither answered nor closed. A gate whose precondition is
 * unreachable is the same defect as the sanctions queue's (§ 1.62), shipped one
 * commit after it was written up.
 *
 * NOTHING IS PREFILLED, AND THAT IS A CORRECTNESS RULE
 * --------------------------------------------------
 * `contactPhone` and `contactEmail` arrive MASKED on the detail read — encrypted at
 * rest, revealed only through their own audited endpoint. Prefilling this form from
 * what the page displays would write the mask back as the customer's phone number.
 * So each field starts empty and a blank field is omitted rather than sent.
 *
 * WHAT THIS DELIBERATELY CANNOT CORRECT
 * ------------------------------------
 * Name, date of birth, nationality, national ID. Those are screening identifiers:
 * the AMLU requires a fresh screen on a change to any of them, and that mechanism
 * does not exist yet (§ 1.59 — nothing in the product reads a customer's screening
 * standing, so "re-screening required" would be a state with no consumer). The
 * server refuses them structurally: `UpdateCustomerContactDto` does not declare
 * them, and `forbidNonWhitelisted` turns their presence into a 400 naming the
 * field. This note says so on screen, because an officer who cannot find the name
 * field should be told why rather than left to conclude the form is broken.
 */

const field: CSSProperties = { display: 'grid', gap: '0.2rem' };
const label: CSSProperties = { fontSize: '0.8rem' };
const muted: CSSProperties = {
  fontSize: '0.78rem',
  color: 'var(--ink-secondary)',
  margin: 0,
};

export function CustomerContactCorrection({
  customerId,
  onCorrected,
}: {
  customerId: string;
  /** The detail page re-reads the customer: the masked values change, and a
   * correction is the one action on this screen that alters them. */
  onCorrected: () => void | Promise<void>;
}) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const canUpdate = hasPermission(user, 'customer.update');

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CorrectionInput>({});

  const set = useCallback(
    (key: keyof CorrectionInput, value: string) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    [],
  );

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await updateCustomerContactDetails(customerId, {
        ...form,
        // Sent only alongside a reference, so `answersRequestType` never arrives
        // without the id it qualifies.
        ...(form.answersRequestId?.trim()
          ? { answersRequestType: 'dsr' as const }
          : {}),
      });
      setForm({});
      setOpen(false);
      await onCorrected();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('customerCorrectError'));
    } finally {
      setBusy(false);
    }
  }, [customerId, form, onCorrected, t]);

  if (!canUpdate) {
    return (
      <p style={muted} data-testid="customer-correct-denied">
        {t('customerCorrectNoPermission')}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="customer-correct-open"
        onClick={() => {
          setOpen(true);
          setError(null);
        }}
      >
        {t('customerCorrectOpen')}
      </button>
    );
  }

  return (
    <section
      style={{ display: 'grid', gap: '0.5rem', maxWidth: '32rem' }}
      data-testid="customer-correct-form"
    >
      <h3 style={{ margin: 0 }}>{t('customerCorrectHeading')}</h3>
      <p style={muted}>{t('customerCorrectIntro')}</p>

      {error && (
        <p role="alert" style={errorStyle} data-testid="customer-correct-error">
          {error}
        </p>
      )}

      <label style={field}>
        <span style={label}>{t('customerCorrectPhone')}</span>
        <input
          type="text"
          data-testid="correct-phone"
          value={form.contactPhone ?? ''}
          onChange={(e) => set('contactPhone', e.target.value)}
        />
      </label>
      <label style={field}>
        <span style={label}>{t('customerCorrectEmail')}</span>
        <input
          type="text"
          data-testid="correct-email"
          value={form.contactEmail ?? ''}
          onChange={(e) => set('contactEmail', e.target.value)}
        />
      </label>
      <label style={field}>
        <span style={label}>{t('customerCorrectAddress')}</span>
        <input
          type="text"
          data-testid="correct-address"
          value={form.registeredAddress ?? ''}
          onChange={(e) => set('registeredAddress', e.target.value)}
        />
      </label>

      <label style={field}>
        <span style={label}>{t('customerCorrectReason')}</span>
        <textarea
          rows={2}
          data-testid="correct-reason"
          value={form.reason ?? ''}
          onChange={(e) => set('reason', e.target.value)}
        />
      </label>
      <p style={muted}>{t('customerCorrectReasonHint')}</p>

      <label style={field}>
        <span style={label}>{t('customerCorrectAnswersDsr')}</span>
        <input
          type="text"
          data-testid="correct-dsr"
          value={form.answersRequestId ?? ''}
          onChange={(e) => set('answersRequestId', e.target.value)}
        />
      </label>
      <p style={muted}>{t('customerCorrectAnswersDsrHint')}</p>

      <p style={muted} data-testid="customer-correct-identifiers-note">
        {t('customerCorrectIdentifiersNote')}
      </p>

      <div style={{ display: 'flex', gap: '0.4rem' }}>
        <button
          type="button"
          data-testid="customer-correct-submit"
          // At least one of the three values: the service refuses an empty
          // correction with a 422, and a screen must not send one.
          disabled={busy || !hasSomethingToCorrect(form)}
          onClick={() => void submit()}
        >
          {t('customerCorrectSubmit')}
        </button>
        <button
          type="button"
          data-testid="customer-correct-cancel"
          onClick={() => {
            setOpen(false);
            setForm({});
            setError(null);
          }}
        >
          {t('customerCorrectCancel')}
        </button>
      </div>
    </section>
  );
}
