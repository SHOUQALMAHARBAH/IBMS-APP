'use client';

/*
 * Correct an employee record — `PATCH /employees/:id`, which had no web caller.
 *
 * A person could be registered and never corrected. Only the nested training and de-provisioning
 * paths were reachable, so a mistyped position or a licence recorded against the wrong role stayed
 * wrong, and the two compliance dates — the confidentiality undertaking and the background check —
 * could be set at registration and never afterwards.
 *
 * ## This form PREFILLS, and the customer correction form deliberately does not
 *
 * The contrast is the point, and it is about masking rather than taste. A customer's phone and
 * email arrive MASKED on the detail read, so prefilling would write the mask back as the
 * customer's phone number. `position` and `licensedRole` arrive in the clear, so the current value
 * is the right starting point: a correction is an edit of something, and making the reader retype
 * a field they are not changing is how an unrelated field gets changed by accident.
 *
 * The national ID is masked here too — and it is not on this form at all, so the question does not
 * arise.
 *
 * ## What the form cannot include
 *
 * `departmentId` is accepted by the route. `EmployeeDetail` extends `MaskedEmployee`, which does
 * not carry it, so nothing can show which department a person is in — and a field whose current
 * value the reader cannot see is a field they cannot tell they are changing. Left off and recorded
 * (§ 1.73) rather than offered write-only.
 */

import { useState } from 'react';
import { ApiError } from '../../lib/auth/api-client';
import { hasPermission } from '../../lib/auth/permissions';
import { useAuth } from '../../lib/auth/auth-context';
import { useLanguage } from '../../lib/i18n/language-context';
import { errorStyle } from '../auth/auth-form.styles';
import {
  updateEmployee,
  type EmployeeDetail,
} from '../../lib/supporting-operations/employee-api';

/** `YYYY-MM-DD`, or '' when the record carries nothing. */
function dayOf(iso: string | null): string {
  return iso === null ? '' : iso.slice(0, 10);
}

export function CorrectEmployeeRecord({
  employee,
  onCorrected,
}: {
  employee: EmployeeDetail;
  onCorrected: () => void;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const canUpdate = !!user && hasPermission(user, 'employee.update');

  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(employee.position ?? '');
  const [licensedRole, setLicensedRole] = useState(employee.licensedRole ?? '');
  const [confidentiality, setConfidentiality] = useState(
    dayOf(employee.confidentialityAgreementSignedAt),
  );
  const [backgroundCheck, setBackgroundCheck] = useState(
    dayOf(employee.backgroundCheckCompletedAt),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canUpdate) return null;

  // Today, as the maximum for both dates. The server refuses a future value outright — these are
  // records of something that already happened — so the control says so rather than letting the
  // reader find out through a 422.
  const today = new Date().toISOString().slice(0, 10);

  const trimmedPosition = position.trim();
  const trimmedLicensedRole = licensedRole.trim();

  /**
   * Only what CHANGED.
   *
   * A PATCH that resends every field rewrites values the reader never touched, and on a record
   * carrying compliance dates that means re-stamping an undertaking date because somebody fixed a
   * job title. Comparing against the loaded record is what keeps an edit to one field an edit to
   * one field.
   */
  function changedFields() {
    const patch: {
      position?: string;
      licensedRole?: string;
      confidentialityAgreementSignedAt?: string;
      backgroundCheckCompletedAt?: string;
    } = {};
    if (trimmedPosition !== (employee.position ?? ''))
      patch.position = trimmedPosition;
    if (trimmedLicensedRole !== (employee.licensedRole ?? ''))
      patch.licensedRole = trimmedLicensedRole;
    if (confidentiality !== dayOf(employee.confidentialityAgreementSignedAt))
      patch.confidentialityAgreementSignedAt = confidentiality;
    if (backgroundCheck !== dayOf(employee.backgroundCheckCompletedAt))
      patch.backgroundCheckCompletedAt = backgroundCheck;
    return patch;
  }

  const nothingChanged = Object.keys(changedFields()).length === 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await updateEmployee(employee.id, changedFields());
      setOpen(false);
      onCorrected();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('empdCorrectFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div style={{ marginTop: '0.6rem' }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="correct-employee-open"
        >
          {t('empdCorrectOpen')}
        </button>
      </div>
    );
  }

  return (
    <form
      style={{ marginTop: '0.6rem' }}
      data-testid="correct-employee-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset>
        <legend>{t('empdCorrectLegend')}</legend>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-secondary)' }}>
          {t('empdCorrectNote')}
        </p>

        <label>
          {t('empdPositionLabel')}
          <input
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            data-testid="correct-position"
          />
        </label>

        <label>
          {t('empdLicensedRoleLabel')}
          <input
            value={licensedRole}
            onChange={(e) => setLicensedRole(e.target.value)}
            data-testid="correct-licensed-role"
          />
        </label>

        <label>
          {t('empdCorrectConfidentiality')}
          <input
            type="date"
            max={today}
            value={confidentiality}
            onChange={(e) => setConfidentiality(e.target.value)}
            data-testid="correct-confidentiality"
          />
        </label>

        <label>
          {t('empdCorrectBackgroundCheck')}
          <input
            type="date"
            max={today}
            value={backgroundCheck}
            onChange={(e) => setBackgroundCheck(e.target.value)}
            data-testid="correct-background-check"
          />
        </label>

        {error !== null && (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        )}

        <div style={{ marginTop: '0.5rem' }}>
          {/* Refused while nothing has changed. "Nothing to correct" and "corrected" must not look
              the same to somebody who came here to fix a record — the same reason the customer
              correction answers an empty patch with a 422 rather than a silent 200. */}
          <button
            type="submit"
            disabled={busy || nothingChanged}
            data-testid="correct-employee-save"
          >
            {t('empdCorrectSave')}
          </button>{' '}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
          >
            {t('empdCorrectCancel')}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
