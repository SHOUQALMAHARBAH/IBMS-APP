/**
 * MODULE 0 ITEM (g) — a person's CBJ approval, on their own record.
 *
 * ## Why a panel here and not a new screen
 *
 * The approval is a fact about a person, and this is the person's page. A separate screen would need
 * its own nav entry, its own permission question (§ 1.61), and a way to find the person again — all
 * for a fact that belongs beside their position and hire date.
 *
 * ## The three states are rendered as three states
 *
 * Not approved · approved and CURRENT · approved and SUSPENDED/CANCELLED. The last pair keeps the
 * date and the branches on screen, because that is the whole reason the marker carries a status
 * rather than a boolean: an office must still be able to say what somebody was approved for after
 * the CBJ stands them down.
 *
 * ## Withdrawing is explicit
 *
 * The API treats an ABSENT status as "leave it alone" and `null` as "withdraw", so the withdraw
 * control is the only thing that sends null — a Save that cleared the approval whenever the select
 * happened to be empty would empty the office's staffing count by accident.
 */

import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/auth/api-client';
import { hasPermission } from '../../lib/auth/permissions';
import { useAuth } from '../../lib/auth/auth-context';
import { useLanguage } from '../../lib/i18n/language-context';
import { ENUM_LABEL } from '../../lib/i18n/enum-labels';
import { errorStyle } from '../auth/auth-form.styles';
import {
  addCbjApprovalBranch,
  removeCbjApprovalBranch,
  setCbjApproval,
  type CbjApproval,
  type CbjApprovalStatus,
} from '../../lib/supporting-operations/employee-api';
import {
  listInsuranceLines,
  type InsuranceLine,
} from '../../lib/insurer/insurance-line-api';

const STATUSES: CbjApprovalStatus[] = ['CURRENT', 'SUSPENDED', 'CANCELLED'];

export function CbjApprovalPanel({
  employeeId,
  approval,
  onChanged,
}: {
  employeeId: string;
  /**
   * UNDEFINED is a real possibility and a DISTINCT state from "no approval".
   *
   * `EmployeeDetail` is HAND-COPIED over an HTTP response and TypeScript cannot check it, so a web
   * build paired with an api that does not send this field would otherwise throw during render —
   * taking down the reveal, the training list, the correction form and the de-provisioning
   * checklist along with this panel. CI caught exactly that shape on two specs whose mocks lacked
   * the field.
   *
   * Rendered as "not available from the server" rather than as "no approval on record", because
   * those are different facts and the second would be a wrong claim about a person's regulatory
   * standing. The api e2e is still what guarantees the field is sent; this only bounds the damage.
   */
  approval: CbjApproval | undefined;
  onChanged: () => void;
}) {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const canUpdate = !!user && hasPermission(user, 'employee.update');

  // Optional-chained because the hooks run BEFORE the absent-approval early return — React requires
  // every hook on every render, so the guard cannot come first. `tsc` said so, which is the
  // compiler doing the one thing it can here: this file's props arrive over HTTP and it cannot
  // check those.
  const [status, setStatus] = useState<string>(approval?.status ?? '');
  const [approvalDate, setApprovalDate] = useState(
    approval?.approvalDate ?? '',
  );
  const [lines, setLines] = useState<InsuranceLine[]>([]);
  const [branchLineId, setBranchLineId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The catalogue is only needed by somebody who can change the approval, and a reader without
    // `employee.update` sees no add form to fill.
    if (!canUpdate) return;
    void (async () => {
      try {
        setLines(await listInsuranceLines());
      } catch {
        setLines([]);
      }
    })();
  }, [canUpdate]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t('cbjApprovalGenericError'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!approval) {
    return (
      <section data-cbj-approval="">
        <h3>{t('cbjApprovalHeading')}</h3>
        <p role="status" data-cbj-approval-unavailable="">
          {t('cbjApprovalUnavailable')}
        </p>
      </section>
    );
  }

  return (
    <section data-cbj-approval="">
      <h3>{t('cbjApprovalHeading')}</h3>

      {approval.status === null ? (
        <p data-cbj-approval-none="">{t('cbjApprovalNone')}</p>
      ) : (
        <>
          <p>
            <strong>{t('cbjApprovalStatusLabel')}</strong>{' '}
            <span data-cbj-approval-status="">
              {t(ENUM_LABEL.CbjApprovalStatus[approval.status])}
            </span>
            {/* Whether this person counts toward item (f)'s minimum staff, computed by the server so
                this panel and the licence screen cannot disagree about who counts. */}
            {approval.countsTowardMinimumStaff ? null : (
              <span data-cbj-approval-not-counted="">
                {' '}
                — {t('cbjApprovalNotCounted')}
              </span>
            )}
          </p>
          <p>
            <strong>{t('cbjApprovalDateLabel')}</strong>{' '}
            <span data-cbj-approval-date="">
              {/* An unrecorded date is said OUT LOUD rather than shown as an em dash: "nobody has
                  entered it" is a different fact from "there is no date", and 54 migrated rows are
                  in exactly that state. */}
              {approval.approvalDate ?? t('cbjApprovalDateUnrecorded')}
            </span>
          </p>
          <p>
            <strong>{t('cbjApprovalTypes')}</strong>{' '}
            <span data-cbj-approval-types="">
              {approval.types.length > 0
                ? approval.types
                    .map((type) => t(ENUM_LABEL.InsuranceLineCategory[type]))
                    .join(' · ')
                : t('cbjApprovalNoTypes')}
            </span>
          </p>

          {approval.branches.length === 0 ? (
            <p style={{ opacity: 0.75 }} data-cbj-approval-no-branches="">
              {t('cbjApprovalNoBranches')}
            </p>
          ) : (
            <ul data-cbj-approval-branches="">
              {approval.branches.map((branch) => (
                <li key={branch.id}>
                  <bdi>{language === 'AR' ? branch.nameAr : branch.nameEn}</bdi>{' '}
                  ({t(ENUM_LABEL.InsuranceLineCategory[branch.category])})
                  {canUpdate ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            removeCbjApprovalBranch(employeeId, branch.id),
                          )
                        }
                      >
                        {t('cbjApprovalRemoveBranch')}
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {canUpdate ? (
        <div data-cbj-approval-form="">
          <label>
            {t('cbjApprovalStatusLabel')}
            <select
              aria-label={t('cbjApprovalStatusLabel')}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">—</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(ENUM_LABEL.CbjApprovalStatus[s])}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('cbjApprovalDateLabel')}
            <input
              type="date"
              aria-label={t('cbjApprovalDateLabel')}
              value={approvalDate}
              onChange={(e) => setApprovalDate(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || status === ''}
            onClick={() =>
              void run(() =>
                setCbjApproval(employeeId, {
                  status: status as CbjApprovalStatus,
                  // '' is sent as null, which is "no date on record" — the honest value, and the
                  // only one the CHECK accepts beside a real day.
                  approvalDate: approvalDate === '' ? null : approvalDate,
                }),
              )
            }
          >
            {t('cbjApprovalSave')}
          </button>

          {approval.status !== null ? (
            <button
              type="button"
              disabled={busy}
              data-cbj-approval-withdraw=""
              onClick={() =>
                void run(() =>
                  setCbjApproval(employeeId, {
                    status: null,
                    approvalDate: null,
                  }),
                )
              }
            >
              {t('cbjApprovalWithdraw')}
            </button>
          ) : null}

          {approval.status !== null ? (
            <div>
              <label>
                {t('cbjApprovalAddBranchLabel')}
                {/* A SELECT over the managed catalogue, never free text: a branch IS a catalogue
                    row, and `isStandard` decides which id the api is given because the two
                    catalogues are addressed by different fields. */}
                <select
                  aria-label={t('cbjApprovalAddBranchLabel')}
                  value={branchLineId}
                  onChange={(e) => setBranchLineId(e.target.value)}
                >
                  <option value="">—</option>
                  {lines.map((line) => (
                    <option key={line.id} value={line.id}>
                      {(language === 'AR' ? line.nameAr : line.nameEn) +
                        ' · ' +
                        t(ENUM_LABEL.InsuranceLineCategory[line.category])}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || !branchLineId}
                onClick={() =>
                  void run(async () => {
                    const line = lines.find((l) => l.id === branchLineId);
                    if (!line) return;
                    await addCbjApprovalBranch(
                      employeeId,
                      line.isStandard
                        ? { insuranceLineId: line.id }
                        : { officeInsuranceLineId: line.id },
                    );
                    setBranchLineId('');
                  })
                }
              >
                {t('cbjApprovalAddBranch')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p style={errorStyle} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
