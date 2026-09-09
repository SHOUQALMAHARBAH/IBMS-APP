'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  ROLE_NAMES,
  grantRole,
  listUsers,
  provisionUser,
  revokeRole,
  setUserActive,
  type AdminUser,
  type RoleName,
} from '../../../../lib/admin/user-admin-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';

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
  const { language } = useLanguage();
  const isArabic = language === 'AR';
  const isAdmin = !!user && user.roles.includes('SYSTEM_SECURITY_ADMINISTRATOR');

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
          ? isArabic
            ? 'لا تملك صلاحية user.manage.'
            : "You don't hold the user.manage permission."
          : err instanceof ApiError
            ? err.message
            : isArabic
              ? 'تعذّر تحميل المستخدمين — حاول مرة أخرى.'
              : 'Could not load users — try again.',
      );
    }
  }, [isArabic]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load]);

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
          : isArabic
            ? 'فشل الإجراء — حاول مرة أخرى.'
            : 'That action failed — try again.',
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
        roles,
      });
      setFullName('');
      setEmail('');
      setPassword('');
      setRoles([]);
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
      <h1>{isArabic ? 'المستخدمون والأدوار' : 'Users & roles'}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {isArabic
          ? 'يُنشئ التسجيل الذاتي حساباً بلا أي دور — ومن ثمّ بلا أي صلاحية. تُمنح الأدوار من هنا فقط. إلغاء الدور يسجّل تاريخ الإلغاء ولا يحذف السجل.'
          : 'Self-service signup creates an account with no roles — and therefore no permissions. Roles are granted only here. Revoking stamps the withdrawal date; the grant record is never deleted.'}
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
            {isArabic ? 'الاسم الكامل' : 'Full name'}
            <input
              aria-label="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {isArabic ? 'البريد الإلكتروني' : 'Email'}
            <input
              aria-label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {isArabic
              ? 'كلمة المرور (١٢ محرفاً على الأقل، مع حرف كبير وصغير ورقم ورمز)'
              : 'Password (min. 12 chars, with upper, lower, digit and symbol)'}
            <input
              aria-label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={12}
              required
            />
          </label>
          <fieldset style={{ border: '1px solid #e5e7eb', padding: '0.5rem' }}>
            <legend>{isArabic ? 'الأدوار' : 'Roles'}</legend>
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
            disabled={busy || roles.length === 0}
            style={{ marginTop: '0.3rem' }}
          >
            {busy
              ? isArabic
                ? 'جارٍ الحفظ…'
                : 'Saving…'
              : isArabic
                ? 'إنشاء المستخدم'
                : 'Provision user'}
          </button>
          {roles.length === 0 ? (
            <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>
              {isArabic
                ? 'اختر دوراً واحداً على الأقل — الحساب بلا دور لا يستطيع فعل شيء.'
                : 'Pick at least one role — a zero-role account can do nothing.'}
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
          <p style={{ opacity: 0.6 }}>
            {isArabic ? 'لا يوجد مستخدمون.' : 'No users.'}
          </p>
        ) : (
          <>
            <p style={{ opacity: 0.6 }}>
              {isArabic
                ? `${rows.length} من ${total}`
                : `${rows.length} of ${total}`}
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '56rem' }}>
                <thead>
                  <tr>
                    <th style={head}>{isArabic ? 'الاسم' : 'Name'}</th>
                    <th style={head}>{isArabic ? 'البريد' : 'Email'}</th>
                    <th style={head}>{isArabic ? 'الأدوار' : 'Roles'}</th>
                    <th style={head}>{isArabic ? 'نشط' : 'Active'}</th>
                    <th style={head}>{isArabic ? 'إجراء' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <tr key={u.id}>
                      <td style={cell}>{u.fullName}</td>
                      <td style={cell}>{u.email}</td>
                      <td style={cell}>
                        {u.roles.length === 0 ? (
                          <span style={{ opacity: 0.6 }}>
                            {isArabic ? '— بلا دور' : '— none'}
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
                                  {isArabic ? 'إلغاء' : 'Revoke'}
                                </button>
                              ) : null}
                            </span>
                          ))
                        )}
                      </td>
                      <td style={cell}>
                        {u.isActive
                          ? isArabic
                            ? 'نعم'
                            : 'Yes'
                          : isArabic
                            ? 'لا'
                            : 'No'}
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
                              {isArabic ? 'منح' : 'Grant'}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() => setUserActive(u.id, !u.isActive))
                              }
                            >
                              {u.isActive
                                ? isArabic
                                  ? 'تعطيل'
                                  : 'Deactivate'
                                : isArabic
                                  ? 'تفعيل'
                                  : 'Activate'}
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
      ) : null}
    </main>
  );
}
