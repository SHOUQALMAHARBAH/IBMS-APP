'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  ROLE_NAMES,
  grantRole,
  listBranches,
  listDepartments,
  listUsers,
  provisionUser,
  revokeRole,
  setUserActive,
  type AdminUser,
  type OrgUnit,
  type RoleName,
} from '../../../../lib/admin/user-admin-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { hasPermission } from '../../../../lib/auth/permissions';

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid #d1d5db',
};

/**
 * Backlog A.2 — the provisioning surface `user.manage` was seeded for. Without
 * it a freshly-seeded deployment has the full 11-role catalogue, the full
 * permission grid, and no way to give anyone a role.
 */
export default function UserAdminPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { language, t } = useLanguage();
  const isArabic = language === 'AR';
  const isAdmin = hasPermission(user, 'user.manage');

  const [rows, setRows] = useState<AdminUser[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<RoleName[]>([]);
  const [grantChoice, setGrantChoice] = useState<RoleName>(ROLE_NAMES[0]);
  // Part II §4.2.2 — Department and Branch are required, and are deliberately
  // rendered as their own labelled dropdowns rather than folded in with Roles.
  const [departments, setDepartments] = useState<OrgUnit[]>([]);
  const [branches, setBranches] = useState<OrgUnit[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [branchId, setBranchId] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await listUsers();
      setRows(result.users);
      setTotal(result.total);
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('usrNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('usrCouldNotLoadUsersTry'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  useEffect(() => {
    if (!user || !isAdmin) return;
    void (async () => {
      try {
        const [depts, brs] = await Promise.all([
          listDepartments(),
          listBranches(),
        ]);
        setDepartments(depts);
        setBranches(brs);
      } catch {
        // The form's own error line covers a failed submit; an empty dropdown
        // is self-explanatory and must not blank the user list beside it.
      }
    })();
  }, [user, isAdmin, t]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : t('usrThatActionFailedTryAgain'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await provisionUser({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        departmentId,
        branchId,
        roles,
      });
      setFullName('');
      setEmail('');
      setPassword('');
      setRoles([]);
      setDepartmentId('');
      setBranchId('');
    });
  }

  function toggleRole(role: RoleName) {
    setRoles((current) =>
      current.includes(role)
        ? current.filter((r) => r !== role)
        : [...current, role],
    );
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('usrUsersRoles')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('usrSelfServiceSignupCreatesAn')}
      </p>

      {isAdmin ? (
        <form
          onSubmit={submit}
          style={{
            margin: '1rem 0',
            display: 'grid',
            gap: '0.4rem',
            maxWidth: '34rem',
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {t('usrFullName')}
            <input
              aria-label={t('usrFullName')}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {t('usrEmail')}
            <input
              aria-label={t('usrEmail')}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {t('usrPasswordMin12CharsWith')}
            <input
              aria-label={t('usrPasswordAria')}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={12}
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {t('usrDepartment')}
            <select
              aria-label={t('usrDepartment')}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              required
            >
              <option value="">{t('usrSelect')}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {isArabic ? (d.nameAr ?? d.name) : d.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {t('usrBranch')}
            <select
              aria-label={t('usrBranch')}
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              required
            >
              <option value="">{t('usrSelect2')}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {isArabic ? (b.nameAr ?? b.name) : b.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset style={{ border: '1px solid #e5e7eb', padding: '0.5rem' }}>
            <legend>{t('usrRoles')}</legend>
            {ROLE_NAMES.map((role) => (
              <label
                key={role}
                style={{
                  display: 'block',
                  fontWeight: 400,
                  fontSize: '0.9rem',
                }}
              >
                <input
                  type="checkbox"
                  checked={roles.includes(role)}
                  onChange={() => toggleRole(role)}
                />{' '}
                {role}
              </label>
            ))}
          </fieldset>
          <button
            type="submit"
            disabled={busy || roles.length === 0 || !departmentId || !branchId}
            style={{ marginTop: '0.3rem' }}
          >
            {busy
              ? t('usrSaving')
              : t('usrProvisionUser')}
          </button>
          {roles.length === 0 ? (
            <p style={{ color: 'var(--ink-secondary)', fontSize: '0.85rem' }}>
              {t('usrPickAtLeastOneRole')}
            </p>
          ) : null}
        </form>
      ) : null}

      {actionError ? (
        <p role="alert" style={errorStyle}>
          {actionError}
        </p>
      ) : null}
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <p style={{ color: 'var(--ink-secondary)' }}>
            {t('usrNoUsers')}
          </p>
        ) : (
          <>
            <p style={{ color: 'var(--ink-secondary)' }}>
              {isArabic
                ? `${rows.length} من ${total}`
                : `${rows.length} of ${total}`}
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '56rem' }}>
                <thead>
                  <tr>
                    <th style={head}>{t('usrName')}</th>
                    <th style={head}>{t('usrEmail2')}</th>
                    <th style={head}>{t('usrRoles2')}</th>
                    <th style={head}>{t('usrActive')}</th>
                    <th style={head}>{t('usrAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <tr key={u.id}>
                      <td style={cell}>{u.fullName}</td>
                      <td style={cell}>{u.email}</td>
                      <td style={cell}>
                        {u.roles.length === 0 ? (
                          <span style={{ color: 'var(--ink-secondary)' }}>
                            {t('usrNone')}
                          </span>
                        ) : (
                          u.roles.map((role) => (
                            <span
                              key={role}
                              style={{ display: 'block', fontSize: '0.85rem' }}
                            >
                              {role}
                              {isAdmin ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  style={{ marginInlineStart: '0.4rem' }}
                                  onClick={() =>
                                    void run(() => revokeRole(u.id, role))
                                  }
                                >
                                  {t('usrRevoke')}
                                </button>
                              ) : null}
                            </span>
                          ))
                        )}
                      </td>
                      <td style={cell}>
                        {u.isActive
                          ? t('usrYes')
                          : t('usrNo')}
                      </td>
                      <td style={cell}>
                        {isAdmin ? (
                          <div
                            style={{
                              display: 'flex',
                              gap: '0.3rem',
                              flexWrap: 'wrap',
                            }}
                          >
                            <select
                              aria-label={`Role to grant to ${u.email}`}
                              value={grantChoice}
                              onChange={(e) =>
                                setGrantChoice(e.target.value as RoleName)
                              }
                            >
                              {ROLE_NAMES.map((role) => (
                                <option key={role} value={role}>
                                  {role}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() => grantRole(u.id, grantChoice))
                              }
                            >
                              {t('usrGrant')}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() => setUserActive(u.id, !u.isActive))
                              }
                            >
                              {u.isActive
                                ? t('usrDeactivate')
                                : t('usrActivate')}
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : loadError ? null : (
        <p>{t('usrLoading')}</p>
      )}
    </main>
  );
}
