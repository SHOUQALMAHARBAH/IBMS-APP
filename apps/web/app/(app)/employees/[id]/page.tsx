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
          ? "You don't hold the employee.manage permission."
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
                Given name: <bdi>{employee.givenName}</bdi>
                {employee.fatherName ? (
                  <>
                    {' '}
                    — Father&apos;s name: <bdi>{employee.fatherName}</bdi>
                  </>
                ) : null}
                {employee.grandfatherName ? (
                  <>
                    {' '}
                    — Grandfather&apos;s name: <bdi>{employee.grandfatherName}</bdi>
                  </>
                ) : null}
                {' '}
                — Family name: <bdi>{employee.familyName}</bdi>
              </p>
            ) : null}
            <p>National ID: {employee.nationalId}</p>
            <p>Position: {employee.position ?? '—'}</p>
            <p>Licensed role: {employee.licensedRole ?? '—'}</p>
            <p>Hire date: {employee.hireDate?.slice(0, 10) ?? '—'}</p>
            <p>
              Status:{' '}
              {employee.terminationDate
                ? `Terminated ${employee.terminationDate.slice(0, 10)}`
                : 'Active'}
            </p>

            <form onSubmit={onReveal} style={formStyle}>
              <h3>{t('empdRevealNationalId')}</h3>
              <label style={labelStyle}>
                Reason (Part 10.6, min. 10 characters)
                <input
                  value={revealReason}
                  onChange={(e) => setRevealReason(e.target.value)}
                  required
                />
              </label>
              <button type="submit">{t('empdReveal')}</button>
              {revealedValue ? <p>Full value: {revealedValue}</p> : null}
            </form>

            {!employee.terminationDate ? (
              <button type="button" onClick={onTerminate}>
                Terminate employment
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
              <p style={{ opacity: 0.6 }}>{t('empdNoTraining')}</p>
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
                  {employee.trainings.map((t) => (
                    <tr key={t.id}>
                      <td style={cell}>{t.trainingName}</td>
                      <td style={cell}>{t.dueAt?.slice(0, 10) ?? '—'}</td>
                      <td style={cell}>{t.completedAt?.slice(0, 10) ?? '—'}</td>
                      <td style={cell}>
                        {!t.completedAt ? (
                          <button type="button" onClick={() => onCompleteTraining(t.id)}>
                            Mark complete
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
                Training name
                <input
                  value={trainingName}
                  onChange={(e) => setTrainingName(e.target.value)}
                  required
                />
              </label>
              <label style={labelStyle}>
                Due date (optional)
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
                Triggered {employee.deprovisioningChecklist.triggeredAt.replace('T', ' ').slice(0, 16)}
                {' — '}due the same business day (24h escalation to IT
                management if still open).
              </p>
              <ul>
                <li>
                  System access revoked:{' '}
                  {employee.deprovisioningChecklist.systemAccessRevokedAt ? (
                    'Yes'
                  ) : (
                    <button type="button" onClick={() => onTickChecklistItem('systemAccessRevoked')}>
                      Mark done
                    </button>
                  )}
                </li>
                <li>
                  Physical access revoked:{' '}
                  {employee.deprovisioningChecklist.physicalAccessRevokedAt ? (
                    'Yes'
                  ) : (
                    <button type="button" onClick={() => onTickChecklistItem('physicalAccessRevoked')}>
                      Mark done
                    </button>
                  )}
                </li>
                <li>
                  Device returned:{' '}
                  {employee.deprovisioningChecklist.deviceReturnedAt ? (
                    'Yes'
                  ) : (
                    <button type="button" onClick={() => onTickChecklistItem('deviceReturned')}>
                      Mark done
                    </button>
                  )}
                </li>
                <li>
                  Knowledge transfer done:{' '}
                  {employee.deprovisioningChecklist.knowledgeTransferDoneAt ? (
                    'Yes'
                  ) : (
                    <button type="button" onClick={() => onTickChecklistItem('knowledgeTransferDone')}>
                      Mark done
                    </button>
                  )}
                </li>
              </ul>
              {employee.deprovisioningChecklist.completedAt ? (
                <p>Completed {employee.deprovisioningChecklist.completedAt.replace('T', ' ').slice(0, 16)}.</p>
              ) : (
                <button type="button" onClick={onCompleteChecklist}>
                  Complete checklist
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
