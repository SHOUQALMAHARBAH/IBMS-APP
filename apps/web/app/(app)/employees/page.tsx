'use client';

import { type CSSProperties, type FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import { hasPermission } from '../../../lib/auth/permissions';
import {
  createEmployee,
  listEmployees,
  type EmployeeListRow,
  type PersonInput,
} from '../../../lib/supporting-operations/employee-api';
import {
  listBranches,
  listDepartments,
  listRoles,
  provisionUser,
  type OrgUnit,
  type RoleCatalogueEntry,
} from '../../../lib/admin/user-admin-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle, successStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid var(--border-default)' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '26rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };
const sectionStyle: CSSProperties = {
  display: 'grid',
  gap: '0.4rem',
  border: '1px solid var(--border-subtle)',
  padding: '0.75rem',
  margin: '0.5rem 0',
};
const hintStyle: CSSProperties = { color: 'var(--ink-secondary)', fontSize: '0.85rem', margin: 0 };

/**
 * PEOPLE — one screen, one Save, whether or not the person gets a login.
 *
 * ## What this replaces
 *
 * Registering someone who needed an account was two screens in a fixed order: record the employee
 * here, then go to Settings → Users and provision an account naming that employee in a PICKER. The
 * picker listed existing employees, so the person being registered was by definition never in it, and
 * the two org-unit fields it required had no source screen at all. Every part of that reached the owner
 * as "the button is broken".
 *
 * Now the login is a checkbox on this form. One Save writes both rows in one transaction
 * (`POST /admin/users` with an `employee` block) — never two calls from the browser, because the
 * second can fail and leave a person who half exists with no way to tell which half.
 *
 * ## Why the checkbox can be absent
 *
 * Issuing a login needs `user.manage`; recording a person needs `employee.create`. Measured against
 * the permission grid: the office administrator holds both, a Branch/Department Manager holds only the
 * second. So a Manager sees this form with no login half and a sentence saying why — the same
 * view-without-edit shape the department and branch screen uses, and the reason the two permissions are
 * separate codes at all.
 *
 * ## Department and branch appear ONCE
 *
 * They are the person's placement and the account's, filled in one pair of fields and used for both
 * rows. The API refuses a person and an account that name different departments; here there is nothing
 * to disagree — which is better than being refused.
 */
export default function EmployeesPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [rows, setRows] = useState<EmployeeListRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Jordanian national-ID-convention name parts (Part F item #4) —
  // givenName/familyName are required, fatherName/grandfatherName optional;
  // fullName is computed server-side from these.
  const [givenName, setGivenName] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [grandfatherName, setGrandfatherName] = useState('');
  const [familyName, setFamilyName] = useState('');
  // The same four in English. Optional as a set, and nothing fills them in from the Arabic.
  const [givenNameEn, setGivenNameEn] = useState('');
  const [fatherNameEn, setFatherNameEn] = useState('');
  const [grandfatherNameEn, setGrandfatherNameEn] = useState('');
  const [familyNameEn, setFamilyNameEn] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [position, setPosition] = useState('');
  const [hireDate, setHireDate] = useState('');
  const [licensedRole, setLicensedRole] = useState('');

  const [departments, setDepartments] = useState<OrgUnit[]>([]);
  const [branches, setBranches] = useState<OrgUnit[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [branchId, setBranchId] = useState('');

  const [withLogin, setWithLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<RoleCatalogueEntry[]>([]);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [registrationType, setRegistrationType] = useState<'DEFAULT' | 'WINDOWS'>('DEFAULT');

  const canIssueLogin = hasPermission(user, 'user.manage');
  const canReadOrgUnits =
    hasPermission(user, 'department.read') && hasPermission(user, 'branch.read');

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

  // The org units and the role catalogue, each behind its own permission. A failure here must not
  // take the employee list down with it: the person half of this form works without either.
  useEffect(() => {
    if (!user || !canReadOrgUnits) return;
    void (async () => {
      try {
        const [d, b] = await Promise.all([listDepartments(), listBranches()]);
        setDepartments(d);
        setBranches(b);
      } catch {
        setDepartments([]);
        setBranches([]);
      }
    })();
  }, [user, canReadOrgUnits]);

  useEffect(() => {
    if (!user || !canIssueLogin) return;
    void (async () => {
      try {
        // ACTIVE only. A retired role grants nothing — `findCodesForRoles` filters on status — so
        // offering one would hand a new account a row that reads as access and confers none.
        setRoles((await listRoles()).filter((r) => r.status === 'ACTIVE'));
      } catch {
        setRoles([]);
      }
    })();
  }, [user, canIssueLogin]);

  function personFromForm(): PersonInput {
    return {
      givenName,
      fatherName: fatherName || undefined,
      grandfatherName: grandfatherName || undefined,
      familyName,
      givenNameEn: givenNameEn || undefined,
      fatherNameEn: fatherNameEn || undefined,
      grandfatherNameEn: grandfatherNameEn || undefined,
      familyNameEn: familyNameEn || undefined,
      nationalId,
      position: position || undefined,
      hireDate,
      licensedRole: licensedRole || undefined,
    };
  }

  function resetForm() {
    setGivenName('');
    setFatherName('');
    setGrandfatherName('');
    setFamilyName('');
    setGivenNameEn('');
    setFatherNameEn('');
    setGrandfatherNameEn('');
    setFamilyNameEn('');
    setNationalId('');
    setPosition('');
    setHireDate('');
    setLicensedRole('');
    setEmail('');
    setPassword('');
    setRoleIds([]);
    setWithLogin(false);
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setMessage(null);
    if (withLogin && roleIds.length === 0) {
      setCreateError(t('empRoleRequired'));
      return;
    }
    setBusy(true);
    try {
      if (withLogin) {
        // ONE request. The person and the account are written in one transaction server-side; two
        // calls from here would be the half-created person this form exists to prevent.
        await provisionUser({
          email,
          password,
          departmentId,
          branchId,
          roleIds,
          registrationType,
          employee: personFromForm(),
        });
        setMessage(t('empCreatedWithLogin'));
      } else {
        await createEmployee({
          ...personFromForm(),
          departmentId: departmentId || undefined,
          branchId: branchId || undefined,
        });
        setMessage(t('empCreatedPerson'));
      }
      resetForm();
      await load();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : t('empCreateError'));
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  const orgUnitsReady = departments.length > 0 && branches.length > 0;

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

      <form onSubmit={onCreate} style={formStyle}>
        <h2>{t('empCreateHeading')}</h2>

        <section style={sectionStyle}>
          <h3>{t('empPersonHeading')}</h3>
          <label style={labelStyle}>
            {t('empGivenName')}
            <input
              dir="auto"
              value={givenName}
              onChange={(e) => setGivenName(e.target.value)}
              required
              data-person-field="givenName"
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
              data-person-field="familyName"
            />
          </label>
          <label style={labelStyle}>
            {t('empNationalId')}
            <input
              value={nationalId}
              onChange={(e) => setNationalId(e.target.value)}
              required
              data-person-field="nationalId"
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
              data-person-field="hireDate"
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
        </section>

        <section style={sectionStyle} data-english-names>
          <h3>{t('empEnglishNameHeading')}</h3>
          <p style={hintStyle}>{t('empEnglishNameHint')}</p>
          <label style={labelStyle}>
            {t('empGivenNameEn')}
            <input
              dir="ltr"
              value={givenNameEn}
              onChange={(e) => setGivenNameEn(e.target.value)}
              data-person-field="givenNameEn"
            />
          </label>
          <label style={labelStyle}>
            {t('empFatherNameEn')}
            <input dir="ltr" value={fatherNameEn} onChange={(e) => setFatherNameEn(e.target.value)} />
          </label>
          <label style={labelStyle}>
            {t('empGrandfatherNameEn')}
            <input
              dir="ltr"
              value={grandfatherNameEn}
              onChange={(e) => setGrandfatherNameEn(e.target.value)}
            />
          </label>
          <label style={labelStyle}>
            {t('empFamilyNameEn')}
            <input
              dir="ltr"
              value={familyNameEn}
              onChange={(e) => setFamilyNameEn(e.target.value)}
              data-person-field="familyNameEn"
            />
          </label>
        </section>

        {canReadOrgUnits ? (
          <section style={sectionStyle} data-placement>
            <h3>{t('empPlacementHeading')}</h3>
            {orgUnitsReady ? null : (
              <p style={hintStyle} data-org-units-missing>
                {t('empOrgUnitsMissing')}{' '}
                <Link href="/settings/org-units">{t('empOrgUnitsLink')}</Link>
              </p>
            )}
            <label style={labelStyle}>
              {t('empDepartment')}
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                required={withLogin}
                data-person-field="departmentId"
              >
                <option value="">{t('empUnset')}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              {t('empBranch')}
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                required={withLogin}
                data-person-field="branchId"
              >
                <option value="">{t('empUnset')}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          </section>
        ) : null}

        {canIssueLogin ? (
          <section style={sectionStyle} data-account-section>
            <h3>{t('empAccountHeading')}</h3>
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={withLogin}
                onChange={(e) => setWithLogin(e.target.checked)}
                data-give-login
              />
              {t('empGiveLogin')}
            </label>
            <p style={hintStyle}>{t('empGiveLoginHint')}</p>

            {withLogin && !orgUnitsReady ? (
              // Not a silent disable: an account needs both org units and the sentence says where to
              // get them. A refusal that does not name the way forward is the shape the owner met as
              // "the button is broken".
              <p role="alert" style={errorStyle} data-account-blocked>
                {t('empAccountNeedsOrgUnits')}{' '}
                <Link href="/settings/org-units">{t('empOrgUnitsLink')}</Link>
              </p>
            ) : null}

            {withLogin ? (
              <>
                <label style={labelStyle}>
                  {t('empAccountEmail')}
                  <input
                    type="email"
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    data-account-field="email"
                  />
                </label>
                <label style={labelStyle}>
                  {t('empTempPassword')}
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={12}
                    data-account-field="password"
                  />
                </label>
                <p style={hintStyle}>{t('empTempPasswordHint')}</p>

                <fieldset style={{ border: '1px solid var(--border-subtle)', padding: '0.5rem' }}>
                  <legend>{t('empRolesHeading')}</legend>
                  <p style={hintStyle}>{t('empRolesHint')}</p>
                  {roles.length === 0 ? (
                    <p style={hintStyle}>{t('empRolesNone')}</p>
                  ) : (
                    roles.map((r) => (
                      <label
                        key={r.id}
                        style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}
                      >
                        <input
                          type="checkbox"
                          checked={roleIds.includes(r.id)}
                          onChange={(e) =>
                            setRoleIds((prev) =>
                              e.target.checked
                                ? [...prev, r.id]
                                : prev.filter((id) => id !== r.id),
                            )
                          }
                          data-account-role={r.id}
                        />
                        {r.name}
                      </label>
                    ))
                  )}
                </fieldset>

                <label style={labelStyle}>
                  {t('empRegistrationType')}
                  <select
                    value={registrationType}
                    onChange={(e) =>
                      setRegistrationType(e.target.value === 'WINDOWS' ? 'WINDOWS' : 'DEFAULT')
                    }
                    data-account-field="registrationType"
                  >
                    <option value="DEFAULT">{t('empRegistrationDefault')}</option>
                    <option value="WINDOWS">{t('empRegistrationWindows')}</option>
                  </select>
                </label>
                <p style={hintStyle}>{t('empRegistrationHint')}</p>
              </>
            ) : null}
          </section>
        ) : (
          // Said plainly rather than left blank: recording people is this role's job, issuing logins
          // is not, and an absent control with no explanation reads as a missing feature.
          <p style={hintStyle} data-no-login-permission>
            {t('empNoLoginPermission')}
          </p>
        )}

        {createError ? (
          <p role="alert" style={errorStyle}>
            {createError}
          </p>
        ) : null}
        {message ? (
          <p role="status" style={successStyle}>
            {message}
          </p>
        ) : null}
        <button type="submit" disabled={busy || (withLogin && !orgUnitsReady)}>
          {withLogin ? t('empSubmitWithLogin') : t('empSubmitButton')}
        </button>
      </form>

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
                <tr key={row.id} data-employee-row={row.id}>
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

    </main>
  );
}
