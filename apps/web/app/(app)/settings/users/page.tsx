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
} from '../../../../lib/admin/user-admin-api';
import { ApiError } from '../../../../lib/auth/api-client';
import {
  Card,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../../components/ui';
import { pageStackStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { hasPermission } from '../../../../lib/auth/permissions';
import { permissionRefusal } from '../../../../lib/i18n/permission-refusal';
import {
  loadIndependently,
  namedFailures,
} from '../../../../lib/load-independently';

/** The keys `ENUM_LABEL.RoleName` actually has — the eleven seeded names. A role
 *  an office defines is deliberately NOT one of these. */
type LegacyRoleName = keyof typeof ENUM_LABEL.RoleName;

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
  /**
   * The role chosen to grant, PER USER.
   *
   * It was one shared value rendered inside every row's `<select>`: picking a role in one row
   * changed what every other row displayed. The grant itself always went to the right user, so the
   * screen was the only thing lying — which is the hardest kind of bug to trust a screenshot about.
   */
  const [grantChoice, setGrantChoice] = useState<Record<string, string>>({});
  // The office's OWN catalogue, fetched rather than hard-coded — a custom role
  // has to be offerable here or Phase 3 could create one this screen cannot
  // grant.
  const [roleCatalogue, setRoleCatalogue] = useState<RoleCatalogueEntry[]>([]);

  /**
   * The roles a grant may actually use: ACTIVE only.
   *
   * A retired role grants nothing — permission resolution filters on `role.status = 'ACTIVE'` — so
   * an administrator who granted one would hand a person a row that reads as access and confers
   * none. Retired roles remain visible where someone ALREADY holds one, with a marker and a revoke
   * control, because hiding a live assignment would be the screen lying in the other direction.
   */
  const grantableRoles = roleCatalogue.filter((r) => r.status === 'ACTIVE');
  // Part II §4.2.2 — Department and Branch are required, and are deliberately
  // rendered as their own labelled dropdowns rather than folded in with Roles.
  const [departments, setDepartments] = useState<OrgUnit[]>([]);
  const [branches, setBranches] = useState<OrgUnit[]>([]);
  /* ITEM 8 — its OWN state, deliberately not `loadError`. That one hides the user list below
   * (`: loadError ? null :`), and a refused DEPARTMENTS list must not take the user list with
   * it: provisioning is the screen's purpose and the pickers serve one form on it. */
  const [listsMissing, setListsMissing] = useState<string | null>(null);
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
          ? permissionRefusal(t, 'usrRefusalAct', 'user.manage')
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
      /*
       * ITEM 8 — THIS LOADER'S OLD `catch` SET NOTHING, and its comment said an empty dropdown is
       * "self-explanatory". It is not: the owner met eight of them on
       * `/provider-register-office` and concluded the screen was broken. It was also the worst of
       * the nine, because `Promise.all` discarded the two lists that HAD arrived and then said
       * nothing at all — so a 403 on roles alone emptied departments and branches as well, with no
       * sentence anywhere on the screen.
       *
       * `loadIndependently` keeps what resolved and NAMES what did not. The second half is the one
       * that matters: a person can act on "the roles list did not load" and cannot act on a blank
       * select.
       */
      const { values, failures } = await loadIndependently([
        {
          key: 'departments',
          label: t('commonListDepartments'),
          load: listDepartments,
        },
        {
          key: 'branches',
          label: t('commonListBranches'),
          load: listBranches,
        },
        // GET /rbac/roles needs `role.read`, which a holder of `user.manage`
        // does not necessarily have. A caller without it is not a failure — there is nothing to
        // report, so the entry is absent rather than named as a list that did not load.
        ...(canReadRoles
          ? [{ key: 'roles', label: t('commonListRoles'), load: listRoles }]
          : []),
      ]);
      if (values.departments) setDepartments(values.departments as OrgUnit[]);
      if (values.branches) setBranches(values.branches as OrgUnit[]);
      if (values.roles)
        setRoleCatalogue(values.roles as RoleCatalogueEntry[]);
      // The grant dropdown's default is whatever the office actually has.
      // No shared default any more: each row falls back to the first ACTIVE role at render time,
      // so one row's choice cannot become another row's displayed value.
      setListsMissing(
        failures.length === 0
          ? null
          : `${t('commonListsMissing')} ${namedFailures(failures)}`,
      );
    })();
  }, [user, isAdmin, canReadRoles, t]);

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
        // No employeeId: this form is for an account with no person behind it. Linking one happens on
        // that person's own page, where the person is already on screen.
      });
      setFullName('');
      setEmail('');
      setPassword('');
      setRoleIds([]);
      setDepartmentId('');
      setBranchId('');
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
    <main style={pageStackStyle}>
      <PageHeader
        title={t('usrUsersRoles')}
        description={t('usrSelfServiceSignupCreatesAn')}
      />

      {isAdmin ? (
        <form
          onSubmit={submit}
          style={{
            margin: '1rem 0',
            display: 'grid',
            gap: 'var(--space-2)',
            maxWidth: '34rem',
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {t('usrFullName')}
            <input
              aria-label={t('usrFullName')}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {t('usrEmail')}
            <input
              aria-label={t('usrEmail')}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
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
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
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
            THE EMPLOYEE PICKER IS GONE, DELIBERATELY.

            It listed existing HR records so a new account could name one — and the person being
            registered was, by definition, never in it. That is what made "record the person, then
            create their account" two screens in a fixed order, and it reached the owner as a broken
            button.

            Both of its cases moved to where the person is:
              - a NEW person who needs a login: one form on /employees, one Save, one transaction;
              - a person recorded EARLIER who now needs one: their own page, /employees/[id].

            What is left here is the account with NO person behind it — the external auditor — which is
            the only case this screen was ever the right place for.
          */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
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
            {/* ACTIVE only here too: provisioning a new account with a retired role would create a
                person whose access is empty on their first sign-in. */}
            {grantableRoles.map((entry) => (
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
        <ErrorState title={actionError} />
      ) : null}
      {listsMissing ? (
        <p role="status" data-lists-missing style={{ color: 'var(--ink-muted)' }}>
          {listsMissing}
        </p>
      ) : null}
      {loadError ? (
        <ErrorState title={loadError} />
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
            <Card padded={false}>
            <Table>
                <thead>
                  <tr>
                    <Th>{t('usrName')}</Th>
                    <Th>{t('usrEmail2')}</Th>
                    <Th>{t('usrHrRecordColumn')}</Th>
                    <Th>{t('usrRoles2')}</Th>
                    <Th>{t('usrActive')}</Th>
                    <Th>{t('usrAction')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <Tr key={u.id}>
                      <Td>{u.fullName}</Td>
                      <Td>{u.email}</Td>
                      {/* The link is the organising idea, not a field on a form:
                          `User.employeeId` is unique, and once linked the HR
                          record's four-part official name becomes the display
                          name everywhere. An account with no HR record is a real
                          and visible state — somebody still owes this person an
                          employee record. */}
                      <Td data-hr-link={u.employeeId ? 'linked' : 'none'}>
                        {u.employeeId ? (
                          <a href={`/employees/${u.employeeId}`}>
                            {t('usrHrRecordOpen')}
                          </a>
                        ) : (
                          <span style={linkStateStyle}>
                            {t('usrHrRecordNone')}
                          </span>
                        )}
                      </Td>
                      <Td>
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
                      </Td>
                      <Td>
                        {u.isActive
                          ? t('usrYes')
                          : t('usrNo')}
                      </Td>
                      <Td>
                        {isAdmin ? (
                          <div
                            style={{
                              display: 'flex',
                              gap: 'var(--space-2)',
                              flexWrap: 'wrap',
                            }}
                          >
                            <select
                              aria-label={t('usrRoleToGrantAria', { email: u.email })}
                              data-grant-select={u.id}
                              value={grantChoice[u.id] ?? grantableRoles[0]?.id ?? ''}
                              onChange={(e) =>
                                setGrantChoice((current) => ({
                                  ...current,
                                  [u.id]: e.target.value,
                                }))
                              }
                            >
                              {/* value is the ID, not the name. `grantRole`
                                  posts this as `roleId`, and the API validates
                                  it as a UUID — an option carrying the name made
                                  every grant from this dropdown a 400, while the
                                  default (set from `cat[0].id`) matched no option
                                  at all. */}
                              {/* ACTIVE only. A retired role grants nothing, so offering it here
                                  produces an assignment that looks like access and is not. */}
                              {grantableRoles.map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                  {roleLabel(entry)}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  grantRole(
                                    u.id,
                                    grantChoice[u.id] ?? grantableRoles[0]?.id ?? '',
                                  ),
                                )
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
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </>
        )
      ) : loadError ? null : (
        <SkeletonList rows={4} label={t('usrLoading')} />
      )}
    </main>
  );
}
