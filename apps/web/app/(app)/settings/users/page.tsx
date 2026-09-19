'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  grantRole,
  listBranches,
  listDepartments,
  listRoles,
  listUsers,
  provisionUser,
  revokeRole,
  setUserActive,
  type AdminUser,
  type OrgUnit,
  type RoleCatalogueEntry,
  type RoleName,
} from '../../../../lib/admin/user-admin-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { hasPermission } from '../../../../lib/auth/permissions';
import { listEmployees, type EmployeeListRow } from '../../../../lib/supporting-operations/employee-api';

/** The keys `ENUM_LABEL.RoleName` actually has — the eleven seeded names. A role
 *  an office defines is deliberately NOT one of these. */
type LegacyRoleName = keyof typeof ENUM_LABEL.RoleName;

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid var(--border-default)',
};
const noRolesBadgeStyle: CSSProperties = {
  display: 'inline-block',
  padding: '0.1rem 0.4rem',
  borderRadius: '0.25rem',
  border: '1px solid var(--border-default)',
  fontSize: '0.8rem',
  fontWeight: 600,
};
const linkStateStyle: CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  color: 'var(--ink-secondary)',
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
  const canLinkEmployee = hasPermission(user, 'employee.read');
  const canReadRoles = hasPermission(user, 'role.read');

  /**
   * How a role is named on screen.
   *
   * The eleven seeded roles keep their translated labels — those are real Arabic
   * copy the office did not write. A role an office DEFINES has no translation
   * key and never will, so it falls back to the bilingual display names stored on
   * the role itself, and finally to the machine name. That ordering is what lets
   * a custom role appear here without making the legacy eleven suddenly render in
   * English only.
   *
   * Declared inside the component so it closes over `t` and `isArabic` rather
   * than taking them as parameters: `t` is typed to a union of every translation
   * key, which no honest parameter type can restate.
   */
  const roleLabel = (entry: RoleCatalogueEntry): string => {
    const key = ENUM_LABEL.RoleName[entry.name as LegacyRoleName];
    if (key) return t(key);
    return (isArabic ? entry.nameAr : entry.nameEn) || entry.name;
  };

  /** A role a user holds, matched by ID when the catalogue is readable
   *  (`GET /rbac/roles` needs `role.read`) and falling back to the name the API
   *  returned alongside it when it is not. Matched on the id rather than the
   *  name so a rename between the two requests cannot mislabel a row. */
  const roleLabelForHeld = (held: { id: string; name: string }): string => {
    const entry = roleCatalogue.find((e) => e.id === held.id);
    if (entry) return roleLabel(entry);
    const key = ENUM_LABEL.RoleName[held.name as LegacyRoleName];
    return key ? t(key) : held.name;
  };

  const [rows, setRows] = useState<AdminUser[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Role IDS, not names — what the API now addresses.
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [grantChoice, setGrantChoice] = useState<string>('');
  // The office's OWN catalogue, fetched rather than hard-coded — a custom role
  // has to be offerable here or Phase 3 could create one this screen cannot
  // grant.
  const [roleCatalogue, setRoleCatalogue] = useState<RoleCatalogueEntry[]>([]);
  // Part II §4.2.2 — Department and Branch are required, and are deliberately
  // rendered as their own labelled dropdowns rather than folded in with Roles.
  const [departments, setDepartments] = useState<OrgUnit[]>([]);
  const [branches, setBranches] = useState<OrgUnit[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [employees, setEmployees] = useState<EmployeeListRow[]>([]);

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
        const [depts, brs, emps, cat] = await Promise.all([
          listDepartments(),
          listBranches(),
          // Only when the caller can read it — GET /employees needs
          // employee.read, and a 403 here would blank the other two.
          canLinkEmployee ? listEmployees() : Promise.resolve([]),
          // Same shape of guard: GET /rbac/roles needs `role.read`, which a
          // holder of `user.manage` does not necessarily have.
          canReadRoles ? listRoles() : Promise.resolve([]),
        ]);
        setDepartments(depts);
        setBranches(brs);
        setEmployees(emps);
        setRoleCatalogue(cat);
        // The grant dropdown's default is whatever the office actually has.
        setGrantChoice((current) => current || (cat[0]?.id ?? ''));
      } catch {
        // The form's own error line covers a failed submit; an empty dropdown
        // is self-explanatory and must not blank the user list beside it.
      }
    })();
  }, [user, isAdmin, canLinkEmployee, canReadRoles, t]);

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
        roleIds,
        // Omitted rather than sent empty: the DTO treats absence as "no link",
        // and an empty string would fail validation as a malformed id.
        employeeId: employeeId || undefined,
      });
      setFullName('');
      setEmail('');
      setPassword('');
      setRoleIds([]);
      setDepartmentId('');
      setBranchId('');
      setEmployeeId('');
    });
  }

  function toggleRole(roleId: string) {
    setRoleIds((current) =>
      current.includes(roleId)
        ? current.filter((id) => id !== roleId)
        : [...current, roleId],
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
          {/*
            Optional, and rendered only for someone who can actually read the
            employee list — `GET /employees` needs `employee.read`, and a
            select that 403s on load is worse than no select.

            Link-only by design: an Employee cannot be created from here
            because it requires a national ID, which is Highly Confidential
            and has no business being typed into an account-creation form.
          */}
          {canLinkEmployee ? (
            <label>
              {t('usrEmployeeRecord')}
              <select
                aria-label={t('usrEmployeeRecord')}
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                <option value="">{t('usrNoEmployeeLink')}</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
          <fieldset style={{ border: '1px solid var(--border-subtle)', padding: '0.5rem' }}>
            <legend>{t('usrRoles')}</legend>
            {roleCatalogue.map((entry) => (
              <label
                key={entry.id}
                style={{
                  display: 'block',
                  fontWeight: 400,
                  fontSize: '0.9rem',
                }}
              >
                <input
                  type="checkbox"
                  checked={roleIds.includes(entry.id)}
                  onChange={() => toggleRole(entry.id)}
                />{' '}
                {roleLabel(entry)}
              </label>
            ))}
          </fieldset>
          <button
            type="submit"
            disabled={busy || roleIds.length === 0 || !departmentId || !branchId}
            style={{ marginTop: '0.3rem' }}
          >
            {busy
              ? t('usrSaving')
              : t('usrProvisionUser')}
          </button>
          {roleIds.length === 0 ? (
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
                    <th style={head}>{t('usrHrRecordColumn')}</th>
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
                      {/* The link is the organising idea, not a field on a form:
                          `User.employeeId` is unique, and once linked the HR
                          record's four-part official name becomes the display
                          name everywhere. An account with no HR record is a real
                          and visible state — somebody still owes this person an
                          employee record. */}
                      <td style={cell} data-hr-link={u.employeeId ? 'linked' : 'none'}>
                        {u.employeeId ? (
                          <a href={`/employees/${u.employeeId}`}>
                            {t('usrHrRecordOpen')}
                          </a>
                        ) : (
                          <span style={linkStateStyle}>
                            {t('usrHrRecordNone')}
                          </span>
                        )}
                      </td>
                      <td style={cell}>
                        {u.roles.length === 0 ? (
                          /* A badge, not the word "None". An account with no
                             roles can sign in and reach NOTHING, which reads as a
                             broken system rather than an unfinished setup — and
                             after Phase 3 it is a common state, because a new
                             office starts with one role and `POST /auth/signup`
                             has always created accounts with zero. */
                          <span style={noRolesBadgeStyle} data-no-roles="">
                            {t('usrNoRolesBadge')}
                          </span>
                        ) : (
                          u.roles.map((held) => (
                            <span
                              key={held.id}
                              style={{ display: 'block', fontSize: '0.85rem' }}
                            >
                              {roleLabelForHeld(held)}
                              {isAdmin ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  style={{ marginInlineStart: '0.4rem' }}
                                  onClick={() =>
                                    void run(() => revokeRole(u.id, held.id))
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
                              aria-label={t('usrRoleToGrantAria', { email: u.email })}
                              value={grantChoice}
                              onChange={(e) =>
                                setGrantChoice(e.target.value as RoleName)
                              }
                            >
                              {/* value is the ID, not the name. `grantRole`
                                  posts this as `roleId`, and the API validates
                                  it as a UUID — an option carrying the name made
                                  every grant from this dropdown a 400, while the
                                  default (set from `cat[0].id`) matched no option
                                  at all. */}
                              {roleCatalogue.map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                  {roleLabel(entry)}
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
