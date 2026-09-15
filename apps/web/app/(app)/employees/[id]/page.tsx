'use client';

import { type CSSProperties, type FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  completeDeprovisioningChecklist,
  completeTraining,
  getEmployee,
  recordTraining,
  revealEmployeeField,
  terminateEmployee,
  updateDeprovisioningChecklist,
  type EmployeeDetail,
} from '../../../../lib/supporting-operations/employee-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '26rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };

export default function EmployeeDetailPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const params = useParams<{ id: string }>();
  const employeeId = params.id;

  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [revealReason, setRevealReason] = useState('');
  const [revealedValue, setRevealedValue] = useState<string | null>(null);

  const [trainingName, setTrainingName] = useState('');
  const [trainingDueAt, setTrainingDueAt] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  const load = useCallback(async () => {
    try {
      setEmployee(await getEmployee(employeeId));
      setLoadError(null);
    } catch (err) {
      setEmployee(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('empdNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('empdLoadError'),
      );
    }
  }, [employeeId, t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  async function onReveal(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    try {
      const result = await revealEmployeeField(employeeId, revealReason);
      setRevealedValue(result.value);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('empdRevealError'));
    }
  }

  async function onRecordTraining(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    try {
      await recordTraining(employeeId, {
        trainingName,
        dueAt: trainingDueAt || undefined,
      });
      setTrainingName('');
      setTrainingDueAt('');
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('empdRecordTrainingError'));
    }
  }

  async function onCompleteTraining(trainingId: string) {
    setActionError(null);
    try {
      await completeTraining(employeeId, trainingId);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('empdCompleteTrainingError'));
    }
  }

  async function onTerminate() {
    setActionError(null);
    try {
      await terminateEmployee(employeeId);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('empdTerminateError'));
    }
  }

  async function onTickChecklistItem(
    field:
      | 'systemAccessRevoked'
      | 'physicalAccessRevoked'
      | 'deviceReturned'
      | 'knowledgeTransferDone',
  ) {
    setActionError(null);
    try {
      await updateDeprovisioningChecklist(employeeId, { [field]: true });
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('empdChecklistUpdateError'));
    }
  }

  async function onCompleteChecklist() {
    setActionError(null);
    try {
      await completeDeprovisioningChecklist(employeeId);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('empdChecklistCompleteError'));
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('empdHeading')}</h1>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {employee ? (
        <>
          <section style={sectionStyle}>
            <h2>
              <bdi>{employee.fullName}</bdi>
            </h2>
            {employee.givenName ? (
              <p>
                {t('empdGivenName')} <bdi>{employee.givenName}</bdi>
                {employee.fatherName ? (
                  <>
                    {' '}
                    — {t('empdFatherName')} <bdi>{employee.fatherName}</bdi>
                  </>
                ) : null}
                {employee.grandfatherName ? (
                  <>
                    {' '}
                    — {t('empdGrandfatherName')} <bdi>{employee.grandfatherName}</bdi>
                  </>
                ) : null}
                {' '}
                — {t('empdFamilyName')} <bdi>{employee.familyName}</bdi>
              </p>
            ) : null}
            <p>{t('empdNationalIdLabel')} {employee.nationalId}</p>
            <p>{t('empdPositionLabel')} {employee.position ?? '—'}</p>
            <p>{t('empdLicensedRoleLabel')} {employee.licensedRole ?? '—'}</p>
            <p>{t('empdHireDateLabel')} {employee.hireDate?.slice(0, 10) ?? '—'}</p>
            <p>
              {t('empdStatusLabel')}{' '}
              {employee.terminationDate
                ? t('empdTerminatedOn', { date: employee.terminationDate.slice(0, 10) })
                : t('empdActive')}
            </p>

            <form onSubmit={onReveal} style={formStyle}>
              <h3>{t('empdRevealNationalId')}</h3>
              <label style={labelStyle}>
                {t('empdRevealReason')}
                <input
                  value={revealReason}
                  onChange={(e) => setRevealReason(e.target.value)}
                  required
                />
              </label>
              <button type="submit">{t('empdReveal')}</button>
              {revealedValue ? <p>{t('empdFullValue')} {revealedValue}</p> : null}
            </form>

            {!employee.terminationDate ? (
              <button type="button" onClick={onTerminate}>
                {t('empdTerminateButton')}
              </button>
            ) : null}
          </section>

          {actionError ? (
            <p role="alert" style={errorStyle}>
              {actionError}
            </p>
          ) : null}

          <section style={sectionStyle}>
            <h2>{t('empdTrainingHeading')}</h2>
            {employee.trainings.length === 0 ? (
              <p style={{ color: 'var(--ink-secondary)' }}>{t('empdNoTraining')}</p>
            ) : (
              <table style={{ borderCollapse: 'collapse', minWidth: '30rem' }}>
                <thead>
                  <tr>
                    <th style={head}>{t('empdColTraining')}</th>
                    <th style={head}>{t('empdColDue')}</th>
                    <th style={head}>{t('empdColCompleted')}</th>
                    <th style={head} />
                  </tr>
                </thead>
                <tbody>
                  {employee.trainings.map((training) => (
                    <tr key={training.id}>
                      <td style={cell}>{training.trainingName}</td>
                      <td style={cell}>{training.dueAt?.slice(0, 10) ?? '—'}</td>
                      <td style={cell}>{training.completedAt?.slice(0, 10) ?? '—'}</td>
                      <td style={cell}>
                        {!training.completedAt ? (
                          <button type="button" onClick={() => onCompleteTraining(training.id)}>
                            {t('empdMarkComplete')}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <form onSubmit={onRecordTraining} style={formStyle}>
              <h3>{t('empdAssignTrainingHeading')}</h3>
              <label style={labelStyle}>
                {t('empdTrainingName')}
                <input
                  value={trainingName}
                  onChange={(e) => setTrainingName(e.target.value)}
                  required
                />
              </label>
              <label style={labelStyle}>
                {t('empdTrainingDueDate')}
                <input
                  type="date"
                  value={trainingDueAt}
                  onChange={(e) => setTrainingDueAt(e.target.value)}
                />
              </label>
              <button type="submit">{t('empdAssignButton')}</button>
            </form>
          </section>

          {employee.deprovisioningChecklist ? (
            <section style={sectionStyle}>
              <h2>{t('empdDeprovisioningHeading')}</h2>
              <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>
                {t('empdDeprovisioningTriggered', {
                  at: employee.deprovisioningChecklist.triggeredAt
                    .replace('T', ' ')
                    .slice(0, 16),
                })}
              </p>
              <ul>
                <li>
                  {t('empdSystemAccessRevoked')}{' '}
                  {employee.deprovisioningChecklist.systemAccessRevokedAt ? (
                    t('empdYes')
                  ) : (
                    <button type="button" onClick={() => onTickChecklistItem('systemAccessRevoked')}>
                      {t('empdMarkDone')}
                    </button>
                  )}
                </li>
                <li>
                  {t('empdPhysicalAccessRevoked')}{' '}
                  {employee.deprovisioningChecklist.physicalAccessRevokedAt ? (
                    t('empdYes')
                  ) : (
                    <button type="button" onClick={() => onTickChecklistItem('physicalAccessRevoked')}>
                      {t('empdMarkDone')}
                    </button>
                  )}
                </li>
                <li>
                  {t('empdDeviceReturned')}{' '}
                  {employee.deprovisioningChecklist.deviceReturnedAt ? (
                    t('empdYes')
                  ) : (
                    <button type="button" onClick={() => onTickChecklistItem('deviceReturned')}>
                      {t('empdMarkDone')}
                    </button>
                  )}
                </li>
                <li>
                  {t('empdKnowledgeTransferDone')}{' '}
                  {employee.deprovisioningChecklist.knowledgeTransferDoneAt ? (
                    t('empdYes')
                  ) : (
                    <button type="button" onClick={() => onTickChecklistItem('knowledgeTransferDone')}>
                      {t('empdMarkDone')}
                    </button>
                  )}
                </li>
              </ul>
              {employee.deprovisioningChecklist.completedAt ? (
                <p>Completed {employee.deprovisioningChecklist.completedAt.replace('T', ' ').slice(0, 16)}.</p>
              ) : (
                <button type="button" onClick={onCompleteChecklist}>
                  {t('empdCompleteChecklist')}
                </button>
              )}
            </section>
          ) : null}
        </>
      ) : loadError ? null : (
        <p>{t('empdLoading')}</p>
      )}
    </main>
  );
}
