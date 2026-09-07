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

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '26rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };

export default function EmployeesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [rows, setRows] = useState<EmployeeListRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [position, setPosition] = useState('');
  const [hireDate, setHireDate] = useState('');
  const [licensedRole, setLicensedRole] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  const load = useCallback(async () => {
    try {
      setRows(await listEmployees());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the employee.manage permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load employees — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    try {
      await createEmployee({
        fullName,
        nationalId,
        position: position || undefined,
        hireDate,
        licensedRole: licensedRole || undefined,
      });
      setFullName('');
      setNationalId('');
      setPosition('');
      setHireDate('');
      setLicensedRole('');
      await load();
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : 'Could not create the employee record.',
      );
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Employees</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Employee records, licensing/certification tracking, and security
        awareness training (Part 8.2).
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No employees recorded yet.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', minWidth: '36rem' }}>
            <thead>
              <tr>
                <th style={head}>Name</th>
                <th style={head}>Position</th>
                <th style={head}>Licensed role</th>
                <th style={head}>Hire date</th>
                <th style={head}>Terminated</th>
                <th style={head} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={cell}>{row.fullName}</td>
                  <td style={cell}>{row.position ?? '—'}</td>
                  <td style={cell}>{row.licensedRole ?? '—'}</td>
                  <td style={cell}>{row.hireDate?.slice(0, 10) ?? '—'}</td>
                  <td style={cell}>{row.terminationDate ? 'Yes' : 'No'}</td>
                  <td style={cell}>
                    <Link href={`/employees/${row.id}`}>View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : loadError ? null : (
        <p>Loading&hellip;</p>
      )}

      <form onSubmit={onCreate} style={formStyle}>
        <h2>Record a new employee</h2>
        <label style={labelStyle}>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>
        <label style={labelStyle}>
          National ID
          <input
            value={nationalId}
            onChange={(e) => setNationalId(e.target.value)}
            required
          />
        </label>
        <label style={labelStyle}>
          Position (optional)
          <input value={position} onChange={(e) => setPosition(e.target.value)} />
        </label>
        <label style={labelStyle}>
          Hire date
          <input
            type="date"
            value={hireDate}
            onChange={(e) => setHireDate(e.target.value)}
            required
          />
        </label>
        <label style={labelStyle}>
          Licensed role (optional)
          <input
            value={licensedRole}
            onChange={(e) => setLicensedRole(e.target.value)}
            placeholder="e.g. CBJ-licensed Broker Representative"
          />
        </label>
        {createError ? (
          <p role="alert" style={errorStyle}>
            {createError}
          </p>
        ) : null}
        <button type="submit">Record employee</button>
      </form>
    </main>
  );
}
