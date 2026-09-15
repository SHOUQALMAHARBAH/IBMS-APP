'use client';

import { type CSSProperties, type FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  createEmployee,
  listEmployees,
  type EmployeeListRow,
} from '../../../lib/supporting-operations/employee-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '26rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };

export default function EmployeesPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [rows, setRows] = useState<EmployeeListRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // Jordanian national-ID-convention name parts (Part F item #4) —
  // givenName/familyName are required, fatherName/grandfatherName optional;
  // fullName is computed server-side from these.
  const [givenName, setGivenName] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [grandfatherName, setGrandfatherName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [position, setPosition] = useState('');
  const [hireDate, setHireDate] = useState('');
  const [licensedRole, setLicensedRole] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  const load = useCallback(async () => {
    try {
      setRows(await listEmployees());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('empNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('empLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    try {
      await createEmployee({
        givenName,
        fatherName: fatherName || undefined,
        grandfatherName: grandfatherName || undefined,
        familyName,
        nationalId,
        position: position || undefined,
        hireDate,
        licensedRole: licensedRole || undefined,
      });
      setGivenName('');
      setFatherName('');
      setGrandfatherName('');
      setFamilyName('');
      setNationalId('');
      setPosition('');
      setHireDate('');
      setLicensedRole('');
      await load();
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : t('empCreateError'),
      );
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('empHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('empIntro')}
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <p style={{ color: 'var(--ink-secondary)' }}>{t('empNone')}</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', minWidth: '36rem' }}>
            <thead>
              <tr>
                <th style={head}>{t('empColName')}</th>
                <th style={head}>{t('empColPosition')}</th>
                <th style={head}>{t('empColLicensedRole')}</th>
                <th style={head}>{t('empColHireDate')}</th>
                <th style={head}>{t('empColTerminated')}</th>
                <th style={head} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={cell}>
                    <bdi>{row.fullName}</bdi>
                  </td>
                  <td style={cell}>{row.position ?? '—'}</td>
                  <td style={cell}>{row.licensedRole ?? '—'}</td>
                  <td style={cell}>{row.hireDate?.slice(0, 10) ?? '—'}</td>
                  <td style={cell}>{row.terminationDate ? 'Yes' : 'No'}</td>
                  <td style={cell}>
                    <Link href={`/employees/${row.id}`}>{t('empViewButton')}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : loadError ? null : (
        <p>{t('empLoading')}</p>
      )}

      <form onSubmit={onCreate} style={formStyle}>
        <h2>{t('empCreateHeading')}</h2>
        <label style={labelStyle}>
          {t('empGivenName')}
          <input
            dir="auto"
            value={givenName}
            onChange={(e) => setGivenName(e.target.value)}
            required
          />
        </label>
        <label style={labelStyle}>
          {t('empFatherName')}
          <input dir="auto" value={fatherName} onChange={(e) => setFatherName(e.target.value)} />
        </label>
        <label style={labelStyle}>
          {t('empGrandfatherName')}
          <input
            dir="auto"
            value={grandfatherName}
            onChange={(e) => setGrandfatherName(e.target.value)}
          />
        </label>
        <label style={labelStyle}>
          {t('empFamilyName')}
          <input
            dir="auto"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            required
          />
        </label>
        <label style={labelStyle}>
          {t('empNationalId')}
          <input
            value={nationalId}
            onChange={(e) => setNationalId(e.target.value)}
            required
          />
        </label>
        <label style={labelStyle}>
          {t('empPosition')}
          <input value={position} onChange={(e) => setPosition(e.target.value)} />
        </label>
        <label style={labelStyle}>
          {t('empHireDate')}
          <input
            type="date"
            value={hireDate}
            onChange={(e) => setHireDate(e.target.value)}
            required
          />
        </label>
        <label style={labelStyle}>
          {t('empLicensedRole')}
          <input
            value={licensedRole}
            onChange={(e) => setLicensedRole(e.target.value)}
            placeholder={t('empLicensedRolePlaceholder')}
          />
        </label>
        {createError ? (
          <p role="alert" style={errorStyle}>
            {createError}
          </p>
        ) : null}
        <button type="submit">{t('empSubmitButton')}</button>
      </form>
    </main>
  );
}
