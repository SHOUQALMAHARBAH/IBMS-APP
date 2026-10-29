'use client';

import { type CSSProperties, useCallback, useState } from 'react';
import {
  correctCustomerIdentifiers,
  hasAnIdentifierToCorrect,
  type CustomerIdentifierCorrection as CorrectionInput,
} from '../../lib/customer/customer-api';
import { Button, Card } from '../ui';
import { ApiError } from '../../lib/auth/api-client';
import { useAuth } from '../../lib/auth/auth-context';
import { useLanguage } from '../../lib/i18n/language-context';
import { hasPermission } from '../../lib/auth/permissions';
import { errorStyle } from '../auth/auth-form.styles';
import { permissionRefusal } from '../../lib/i18n/permission-refusal';

/*
 * CORRECTING A CUSTOMER'S DATE OF BIRTH OR NATIONALITY — the owner's narrow strike of her own
 * 2026-09-28 deferral, 2026-10-28.
 *
 * Her instruction for this half: *"extend the existing `CustomerIdentifierCorrection` path to
 * `dateOfBirth`/`nationality` with a control on the customer screen — NOT a new edit screen and not a
 * new mechanism"*. So this is a sibling of `CustomerContactCorrection` on the same screen, reaching a
 * sibling route, writing to the table that already existed for exactly this.
 *
 * WHY A SECOND COMPONENT RATHER THAN TWO MORE FIELDS ON THE CONTACT ONE
 * --------------------------------------------------------------------
 * Four things differ, and each one would have become a branch inside that form:
 *
 *   * the REASON is mandatory here and optional there — the server refuses below ten characters;
 *   * these fields are INDIVIDUAL-only, so the control does not belong on a corporate customer's
 *     screen at all, while phone and email do;
 *   * saving RE-SCREENS, which the intro has to say before somebody presses the button;
 *   * `dateOfBirth` is a date input and `nationality` a two-letter code, neither of which is a free
 *     text box.
 *
 * WHAT IT DELIBERATELY DOES NOT SAY
 * ---------------------------------
 * Nothing about whether the re-screen SUCCEEDED. The api returns `rescreened` and this screen does
 * not word it, which is a stated gap rather than an oversight: there is no Arabic for *"the
 * correction was recorded but the re-screen did not complete"* anywhere in the dictionary, and
 * writing one is the owner's (decision 94). So the confirmation says the correction was recorded —
 * true in both cases — and makes no claim about screening at all, which is the one wording that
 * cannot be false. The sentence for the failure case is on her list, and the backstop meanwhile is
 * the screening hold: a file whose identity changed and whose screening did not re-run raises
 * IDENTITY_CHANGED_SINCE_SCREENING and the next decision on it is refused.
 *
 * PLACEMENT AND WORDING POLISH BELONG TO THE DESIGN BATCH, by the owner's sequencing — the same
 * departure the DSR intake's two inputs shipped under one batch ago, and for the same reason: a
 * route with no control is a capability nobody can exercise (§ 1.44), so the minimum honest control
 * ships with the route.
 */

const field: CSSProperties = { display: 'grid', gap: '0.2rem' };
const label: CSSProperties = { fontSize: '0.8rem' };
const muted: CSSProperties = {
  fontSize: '0.78rem',
  color: 'var(--ink-secondary)',
  margin: 0,
};

export function CustomerIdentifierCorrection({
  customerId,
  customerType,
  onCorrected,
}: {
  customerId: string;
  /**
   * REQUIRED rather than optional, deliberately. A company has no date of birth or nationality of
   * its own — those belong to the natural persons behind it, which is what the UBO records carry —
   * and the server refuses a corporate customer with a 422. An optional prop would let a caller omit
   * it and render a control that cannot work, which is the shape a required argument makes
   * unrepresentable.
   */
  customerType: string;
  /** The detail page re-reads the customer: both values are displayed in the clear, so a correction
   *  changes what is on screen. */
  onCorrected: () => void | Promise<void>;
}) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const canUpdate = hasPermission(user, 'customer.update');

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CorrectionInput>({ reason: '' });

  const set = useCallback(
    (key: keyof CorrectionInput, value: string) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    [],
  );

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await correctCustomerIdentifiers(customerId, {
        ...form,
        // Sent only alongside a reference, so `answersRequestType` never arrives without the id it
        // qualifies.
        ...(form.answersRequestId?.trim()
          ? { answersRequestType: 'dsr' as const }
          : {}),
      });
      setForm({ reason: '' });
      setOpen(false);
      await onCorrected();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t('customerCorrectError'),
      );
    } finally {
      setBusy(false);
    }
  }, [customerId, form, onCorrected, t]);

  // Rendered for nobody on a corporate customer — not a disabled control and not a refusal
  // sentence. A reader on a company's screen did not come looking for a date of birth, and a
  // disabled button is a promise with a date on it.
  if (customerType !== 'INDIVIDUAL') return null;

  if (!canUpdate) {
    return (
      <p style={muted} data-testid="customer-correct-identifiers-denied">
        {permissionRefusal(
          t,
          'customerCorrectIdentifiersRefusalAct',
          'customer.update',
        )}
      </p>
    );
  }

  if (!open) {
    return (
      <Button
        variant="secondary"
        data-testid="customer-correct-identifiers-open"
        onClick={() => {
          setOpen(true);
          setError(null);
        }}
      >
        {t('customerCorrectIdentifiersOpen')}
      </Button>
    );
  }

  return (
    <Card
      title={t('customerCorrectIdentifiersHeading')}
      style={{ display: 'grid', gap: 'var(--space-2)', maxWidth: '32rem' }}
      data-testid="customer-correct-identifiers-form"
    >
      <p style={muted}>{t('customerCorrectIdentifiersIntro')}</p>

      {error && (
        <p
          role="alert"
          style={errorStyle}
          data-testid="customer-correct-identifiers-error"
        >
          {error}
        </p>
      )}

      <label style={field}>
        <span style={label}>{t('customerFieldDateOfBirth')}</span>
        <input
          type="date"
          data-testid="correct-date-of-birth"
          value={form.dateOfBirth ?? ''}
          onChange={(e) => set('dateOfBirth', e.target.value)}
        />
      </label>
      <label style={field}>
        {/* `impFieldNationality` rather than a new key — it already ships this label in both
            languages for the import field list, and a second key for one word is a second place
            for it to drift. */}
        <span style={label}>{t('impFieldNationality')}</span>
        <input
          type="text"
          inputMode="text"
          maxLength={2}
          data-testid="correct-nationality"
          value={form.nationality ?? ''}
          // Upper-cased as it is typed: the server takes ISO 3166-1 alpha-2 in upper case and
          // nothing else, and refusing `jo` after the fact would be a round trip for a shift key.
          onChange={(e) => set('nationality', e.target.value.toUpperCase())}
        />
      </label>

      <label style={field}>
        <span style={label}>{t('customerCorrectReason')}</span>
        <textarea
          rows={2}
          data-testid="correct-identifiers-reason"
          value={form.reason}
          onChange={(e) => set('reason', e.target.value)}
        />
      </label>
      <p style={muted}>{t('customerCorrectReasonHint')}</p>

      <label style={field}>
        <span style={label}>{t('customerCorrectAnswersDsr')}</span>
        <input
          type="text"
          data-testid="correct-identifiers-dsr"
          value={form.answersRequestId ?? ''}
          onChange={(e) => set('answersRequestId', e.target.value)}
        />
      </label>
      <p style={muted}>{t('customerCorrectAnswersDsrHint')}</p>

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <Button
          data-testid="customer-correct-identifiers-submit"
          // One identifier AND a reason the server will accept. Both halves, because a screen must
          // not send a request it already knows is a 400 — and the reason floor is the half a
          // careless version omits, since the field looks filled the moment anything is typed.
          disabled={busy || !hasAnIdentifierToCorrect(form)}
          onClick={() => void submit()}
        >
          {t('customerCorrectSubmit')}
        </Button>
        <Button
          variant="ghost"
          data-testid="customer-correct-identifiers-cancel"
          onClick={() => {
            setOpen(false);
            setForm({ reason: '' });
            setError(null);
          }}
        >
          {t('customerCorrectCancel')}
        </Button>
      </div>
    </Card>
  );
}
