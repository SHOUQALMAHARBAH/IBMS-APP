'use client';

import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { hasPermission } from '../../../../lib/auth/permissions';
import { ENUM_LABEL } from '../../../../lib/i18n/enum-labels';
import { ApiError } from '../../../../lib/auth/api-client';
import { PermissionMatrix } from '../../../../components/admin/PermissionMatrix';
import { createMatrixStyle, generatedNameStyle } from '../../../../components/admin/admin.styles';
import { machineNameProblem, toMachineName } from '../../../../lib/admin/role-name';
import { stepUp } from '../../../../lib/auth/auth-api';
import {
  createRole,
  deleteRole,
  getRoleWithGrants,
  listPermissionCatalogue,
  listRolesForAdmin,
  setRolePermissions,
  setRoleSecurityAttributes,
  setRoleStatus,
  updateRole,
  violatesSegregationPair,
  type PermissionCatalogueEntry,
  type RoleAdminEntry,
  type RoleWithGrants,
} from '../../../../lib/admin/role-admin-api';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';

/** The keys `ENUM_LABEL.RoleName` actually has — the legacy names. A role an
 *  office defines is deliberately NOT one of these. */
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
const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const formStyle: CSSProperties = {
  margin: '1rem 0',
  display: 'grid',
  gap: '0.4rem',
  maxWidth: '30rem',
};
const labelStyle: CSSProperties = { display: 'grid', gap: '0.2rem' };
const badgeStyle: CSSProperties = {
  display: 'inline-block',
  padding: '0.1rem 0.4rem',
  borderRadius: '0.25rem',
  border: '1px solid var(--border-default)',
  fontSize: '0.8rem',
  marginInlineStart: '0.4rem',
};
const warningStyle: CSSProperties = {
  border: '1px solid var(--border-default)',
  borderInlineStartWidth: '4px',
  padding: '0.6rem 0.75rem',
  margin: '0.75rem 0',
  maxWidth: '48rem',
};
const codeRowStyle: CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  alignItems: 'baseline',
  padding: '0.2rem 0',
};

/**
 * Office-scoped custom RBAC, PHASE 3 — the screen the whole rework exists for.
 *
 * Phases 1 and 2 removed every reason a role an office defines would behave
 * differently from a seeded one: no authorization decision reads a role name, the
 * two MFA controls are columns that default to strict, cross-owner visibility is
 * seven permissions, and the last-administrator guard keys on a capability under
 * an advisory lock. What was missing was the screen to create one.
 *
 * Two permissions, and the split matters. `role.read` renders everything here;
 * the role write codes are what turn the controls on. A caller with only the first sees
 * the catalogue and no buttons, which is why the prep step separated those names
 * before this screen was written.
 */
export default function RoleAdminPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { language, t } = useLanguage();
  const isArabic = language === 'AR';
  const canRead = hasPermission(user, 'role.read');
  // The umbrella became three codes, and this screen is where that has to be visible: an office can
  // now give someone the ability to define roles without the ability to retire them, or to adjust what
  // an existing role grants without being able to add new ones. Each control asks for its own.
  const canCreate = hasPermission(user, 'role.create');
  const canUpdate = hasPermission(user, 'role.update');
  const canRetire = hasPermission(user, 'role.deactivate');
  /** The actions column exists if ANY row action does. */
  const canActOnRow = canUpdate || canRetire;
  const canReadCatalogue = hasPermission(user, 'permission.read');


  const [roles, setRoles] = useState<RoleAdminEntry[] | null>(null);
  const [catalogue, setCatalogue] = useState<PermissionCatalogueEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // The role whose matrix is open, with the grants it currently holds.
  const [editing, setEditing] = useState<RoleWithGrants | null>(null);
  /** The grant set being chosen for a role that does not exist yet. */
  const [newCodes, setNewCodes] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<RoleAdminEntry | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [description, setDescription] = useState('');
  const [mfaAlways, setMfaAlways] = useState(true);
  const [hardwareToken, setHardwareToken] = useState(true);

  // Create form.
  const [newNameEn, setNewNameEn] = useState('');
  // Derived on every keystroke so the permanent identifier is visible before it is written, and so
  // the refusal appears while there is still something to fix.
  const generatedName = toMachineName(newNameEn);
  const nameProblem = machineNameProblem(newNameEn);
  const [newNameAr, setNewNameAr] = useState('');
  const [newDescription, setNewDescription] = useState('');

  /**
   * The step-up challenge, held as pending work rather than run inline.
   *
   * Only ONE operation needs it — the two MFA security attributes — because only
   * that one can WEAKEN a control. The endpoint carries `@RequireStepUp()` and is
   * its first consumer anywhere in the app, so this is also the first screen that
   * has had to satisfy that gate.
   */
  const [stepUpPending, setStepUpPending] = useState<
    null | (() => Promise<void>)
  >(null);
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [stepUpCode, setStepUpCode] = useState('');

  /**
   * How a role is named on screen — the same ordering `settings/users` uses.
   *
   * The legacy roles keep their translated labels: that is real Arabic copy the
   * office did not write. A role an office DEFINES has no translation key and
   * never will, so it falls back to the bilingual display names stored on the
   * role itself, and finally to the machine name.
   */
  const roleLabel = (role: {
    name: string;
    nameEn: string;
    nameAr: string;
  }): string => {
    const key = ENUM_LABEL.RoleName[role.name as LegacyRoleName];
    if (key) return t(key);
    return (isArabic ? role.nameAr : role.nameEn) || role.name;
  };

  const load = useCallback(async () => {
    try {
      const rows = await listRolesForAdmin();
      setRoles(rows);
      setLoadError(null);
    } catch (err) {
      setRoles(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('roleNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('roleCouldNotLoad'),
      );
    }
  }, [t]);

  /**
   * Delete a role. The confirmation is a step, not a gate: it exists because the act is one-way, and
   * it explains the two consequences the owner explicitly accepted — the role is withdrawn from
   * everyone with no reassignment, and a user left with nothing keeps nothing.
   */
  const onDelete = useCallback(
    async (role: RoleAdminEntry) => {
      setBusy(true);
      setActionError(null);
      try {
        await deleteRole(role.id);
        setDeleting(null);
        // Close the matrix if it was open on the role that no longer exists.
        setEditing((current) => (current && current.id === role.id ? null : current));
        setSavedMessage(t('roleDeleted'));
        await load();
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : t('roleCouldNotLoad'));
      } finally {
        setBusy(false);
      }
    },
    [t, load],
  );

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  // The async IIFE is the house pattern here, and it is also what the
  // cascading-render lint rule wants: everything this effect does has to settle
  // on a promise before any state is set.
  useEffect(() => {
    if (!user || !canRead) return;
    void (async () => {
      await load();
      // The catalogue is GLOBAL — it describes the software, not any office's
      // configuration — so reading all of it leaks nothing between offices. It
      // is still behind its own permission, which is why a caller without
      // `permission.read` gets the role list and no matrix.
      if (!canReadCatalogue) return;
      try {
        setCatalogue(await listPermissionCatalogue());
      } catch {
        setCatalogue([]);
      }
    })();
  }, [user, canRead, canReadCatalogue, load]);

  const segregationWarning = violatesSegregationPair(selected);

  async function openMatrix(roleId: string) {
    setActionError(null);
    setSavedMessage(null);
    try {
      const role = await getRoleWithGrants(roleId);
      setEditing(role);
      // The editor now renders above the table, so it is already in view for most of the page — but
      // not for someone who scrolled down a long list of roles to reach the row they clicked. A
      // deliberate scroll is what makes the click's effect unmissable rather than merely present.
      requestAnimationFrame(() => {
        document
          .querySelector('[data-matrix-for]')
          ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
      setSelected(new Set(role.permissionCodes));
      setNameEn(role.nameEn);
      setNameAr(role.nameAr);
      setDescription(role.description ?? '');
      setMfaAlways(role.requiresMfaAlways);
      setHardwareToken(role.requiresHardwareToken);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('roleCouldNotLoad'),
      );
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    // The form refuses rather than storing an identifier nobody can read back to a role. Checked
    // here as well as on the button, because a form can be submitted with Enter.
    if (machineNameProblem(newNameEn)) return;
    setBusy(true);
    setActionError(null);
    try {
      await createRole({
        // The GENERATED name, not a typed one.
        name: generatedName,
        nameEn: newNameEn,
        nameAr: newNameAr,
        description: newDescription || undefined,
        // Required by the API, and the whole point of the flow: the role arrives with its
        // permissions rather than existing for a while able to do nothing.
        permissionCodes: [...newCodes],
      });
      setNewNameEn('');
      setNewNameAr('');
      setNewDescription('');
      setNewCodes(new Set());
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('roleCouldNotLoad'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function onSavePermissions() {
    if (!editing) return;
    setBusy(true);
    setActionError(null);
    try {
      await setRolePermissions(editing.id, [...selected]);
      setSavedMessage(t('roleMatrixSaved'));
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('roleCouldNotLoad'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function onSaveNames() {
    if (!editing) return;
    setBusy(true);
    setActionError(null);
    try {
      await updateRole(editing.id, {
        nameEn,
        nameAr,
        description: description || undefined,
      });
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('roleCouldNotLoad'),
      );
    } finally {
      setBusy(false);
    }
  }

  /** The one operation behind a step-up challenge. See `stepUpPending`. */
  function onSaveSecurityAttributes() {
    if (!editing) return;
    const roleId = editing.id;
    const attributes = {
      requiresMfaAlways: mfaAlways,
      requiresHardwareToken: hardwareToken,
    };
    setStepUpPending(() => async () => {
      await setRoleSecurityAttributes(roleId, attributes);
      await load();
    });
  }

  async function onConfirmStepUp(e: FormEvent) {
    e.preventDefault();
    if (!stepUpPending) return;
    setBusy(true);
    setActionError(null);
    try {
      await stepUp({
        password: stepUpPassword,
        code: stepUpCode || undefined,
      });
      await stepUpPending();
      setStepUpPending(null);
      setStepUpPassword('');
      setStepUpCode('');
    } catch (err) {
      setActionError(
        err instanceof ApiError && err.status !== 401
          ? err.message
          : t('roleStepUpFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function onToggleStatus(role: RoleAdminEntry) {
    setBusy(true);
    setActionError(null);
    try {
      await setRoleStatus(
        role.id,
        role.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      );
      await load();
    } catch (err) {
      // The refusal worth surfacing verbatim: retiring the last role that grants
      // user administration is refused by the API under an advisory lock, and its
      // message explains what to do instead.
      setActionError(
        err instanceof ApiError ? err.message : t('roleCouldNotLoad'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('roleHeading')}</h1>
      <p>{t('roleIntro')}</p>

      {loadError ? <p style={errorStyle}>{loadError}</p> : null}
      {actionError ? <p style={errorStyle}>{actionError}</p> : null}

      {/* A caller the CLIENT already knows cannot read roles never reaches `load()`, so the
          no-permission message — which lived only in that function's catch — never rendered. The
          screen showed a heading, one sentence of intro, and nothing else: no table, no empty state,
          no reason. Measured at 157 characters inside `main`.

          Stated as its own branch rather than by making the effect fire a request it knows will be
          refused: asking the API in order to be told what we already know is a round trip for a
          sentence, and it would put a guaranteed 403 in everyone's network log. */}
      {!canRead ? (
        <p role="status" style={errorStyle}>
          {t('roleNoPermission')}
        </p>
      ) : null}

      {/* And the window before the first response: `roles` is null and there is no error yet, which
          used to render nothing at all. A person who opens this screen on a slow connection must see
          that something is happening. */}
      {canRead && roles === null && !loadError ? <p role="status">{t('commonLoading')}</p> : null}

      {roles && roles.length === 0 ? <p>{t('roleNoRoles')}</p> : null}

      {/* ORDER MATTERS, and it was wrong. The create form sat BELOW the table, so adding a role
          meant scrolling past every existing one — and the permissions editor sat below that, so
          clicking a row's permissions button appeared to do nothing at all. Both were the same
          defect: the thing a person just asked for was rendered last. Create, then the open
          editor, then the table — which is also the users screen's arrangement. */}

      {canCreate ? (
        <section style={sectionStyle}>
          <h2>{t('roleCreateHeading')}</h2>
          <form onSubmit={onCreate} style={formStyle}>
            {/* English name FIRST, because the machine name is derived from it and a person should
                see the cause before the effect. Required — owner decision, 2026-09-24 — precisely
                because it is the source of a permanent identifier. */}
            <label style={labelStyle}>
              {t('roleFieldNameEn')}
              <input
                value={newNameEn}
                onChange={(e) => setNewNameEn(e.target.value)}
                required
                /* An explicit hook. The edit panel carries fields with the same labels, and a test
                   that reaches for a label here has to guess which form it landed in. */
                data-create-name-en
              />
            </label>
            {/* GENERATED, shown, and never typed. An office administrator is a broker, not a
                programmer, and this string is immutable and lands in every audit row that mentions
                the role. Shown read-only as she types so nothing is written that she never saw. */}
            <label style={labelStyle}>
              {t('roleMachineNameLabel')}
              <output data-generated-machine-name style={generatedNameStyle}>
                {generatedName || '—'}
              </output>
              <small>{t('roleMachineNameHint')}</small>
            </label>
            {nameProblem ? (
              <p role="alert" style={errorStyle} data-machine-name-problem>
                {nameProblem === 'empty'
                  ? t('roleEnglishNameRequired')
                  : t('roleMachineNameUnreadable')}
              </p>
            ) : null}
            <label style={labelStyle}>
              {t('roleFieldNameAr')}
              <input
                value={newNameAr}
                onChange={(e) => setNewNameAr(e.target.value)}
                required
                data-create-name-ar
              />
            </label>
            <label style={labelStyle}>
              {t('roleFieldDescription')}
              <input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </label>
            {/* Permissions belong to CREATION. Choosing what a role can do is part of making it,
                not an errand to be found later — and the API has always accepted the whole set in
                the same POST (`CreateRoleDto.permissionCodes` is required, which is why the old
                four-field form could not create a role at all: it omitted the field and got a 400
                about it). */}
            <fieldset style={createMatrixStyle}>
              <legend>{t('roleCreatePermissionsHeading')}</legend>
              <p>{t('roleCreatePermissionsIntro')}</p>
              {catalogue.length > 0 ? (
                <PermissionMatrix
                  catalogue={catalogue}
                  selected={newCodes}
                  onChange={setNewCodes}
                />
              ) : (
                <p role="status">{t('roleMatrixNeedsCatalogue')}</p>
              )}
            </fieldset>
            <button type="submit" disabled={busy || nameProblem !== null}>
              {busy ? t('roleCreating') : t('roleCreateButton')}
            </button>
          </form>
        </section>
      ) : null}

      {deleting ? (
        <section style={sectionStyle} data-delete-confirm={deleting.name}>
          <h2>{t('roleDeleteConfirmHeading', { role: roleLabel(deleting) })}</h2>
          <p>{t('roleDeleteConfirmBody')}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onDelete(deleting)}
            data-confirm-delete
          >
            {t('roleDeleteConfirmButton')}
          </button>
          <button
            type="button"
            onClick={() => setDeleting(null)}
            style={{ marginInlineStart: '0.4rem' }}
          >
            {t('commonCancel')}
          </button>
        </section>
      ) : null}

      {editing ? (
        <section style={sectionStyle} data-matrix-for={editing.name}>
          <h2>{t('roleMatrixHeading', { role: roleLabel(editing) })}</h2>
          <p>{t('roleMatrixIntro')}</p>
          {editing.isSystem ? <p>{t('roleMatrixReadOnly')}</p> : null}
          <p>
            {t('roleMatrixSelectedCount', {
              count: String(selected.size),
              total: String(catalogue.length),
            })}
          </p>

          {segregationWarning ? (
            <p style={warningStyle} role="status" data-segregation-warning="">
              {t('roleSegregationWarning')}
            </p>
          ) : null}

          {savedMessage ? <p role="status">{savedMessage}</p> : null}

          {/* The SAME component the creation form uses. It was two implementations for about an
              hour, and that hour produced two matrices on one page with the same `data-code` hooks —
              which broke three pre-existing tests with a strict-mode ambiguity and would have let
              the two drift. One matrix, used twice. */}
          <PermissionMatrix
            catalogue={catalogue}
            selected={selected}
            onChange={setSelected}
            disabled={editing.isSystem}
          />

          {editing.isSystem ? null : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onSavePermissions()}
              >
                {busy ? t('roleMatrixSaving') : t('roleMatrixSave')}
              </button>

              <h3>{t('roleFieldDescription')}</h3>
              <div style={formStyle}>
                <label style={labelStyle}>
                  {t('roleFieldNameEn')}
                  <input
                    value={nameEn}
                    onChange={(e) => setNameEn(e.target.value)}
                  />
                </label>
                <label style={labelStyle}>
                  {t('roleFieldNameAr')}
                  <input
                    value={nameAr}
                    onChange={(e) => setNameAr(e.target.value)}
                  />
                </label>
                <label style={labelStyle}>
                  {t('roleFieldDescription')}
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onSaveNames()}
                >
                  {t('roleSaveNamesButton')}
                </button>
              </div>

              <h3>{t('roleMfaHeading')}</h3>
              <p>{t('roleMfaIntro')}</p>
              <div style={formStyle}>
                <label style={codeRowStyle}>
                  <input
                    type="checkbox"
                    checked={mfaAlways}
                    onChange={(e) => setMfaAlways(e.target.checked)}
                  />
                  <span>{t('roleMfaAlwaysLabel')}</span>
                </label>
                <label style={codeRowStyle}>
                  <input
                    type="checkbox"
                    checked={hardwareToken}
                    onChange={(e) => setHardwareToken(e.target.checked)}
                  />
                  <span>{t('roleMfaHardwareLabel')}</span>
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onSaveSecurityAttributes}
                >
                  {t('roleMfaSave')}
                </button>
              </div>
            </>
          )}

          <button type="button" onClick={() => setEditing(null)}>
            {t('roleMatrixClose')}
          </button>
        </section>
      ) : null}

      {roles && roles.length > 0 ? (
        <section style={sectionStyle}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={head}>{t('roleTableName')}</th>
                <th style={head}>{t('roleTableStatus')}</th>
                <th style={head}>{t('roleTableHolders')}</th>
                <th style={head}>{t('roleTablePermissions')}</th>
                <th style={head}>{t('roleTableMfa')}</th>
                {canActOnRow ? (
                  <th style={head}>{t('roleTableActions')}</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id} data-role={role.name}>
                  <td style={cell}>
                    <bdi>{roleLabel(role)}</bdi>
                    {role.isSystem ? (
                      <span
                        style={badgeStyle}
                        title={t('roleSystemExplain')}
                        data-system-badge=""
                      >
                        {t('roleSystemBadge')}
                      </span>
                    ) : null}
                  </td>
                  <td style={cell} data-status={role.status}>
                    {role.status === 'ACTIVE'
                      ? t('roleStatusActive')
                      : t('roleStatusInactive')}
                  </td>
                  <td style={cell}>{role.holderCount}</td>
                  <td style={cell}>{role.permissionCount}</td>
                  <td style={cell}>
                    {role.requiresMfaAlways ? t('roleMfaAlwaysLabel') : '—'}
                  </td>
                  {canActOnRow ? (
                    <td style={cell}>
                      <button
                        type="button"
                        onClick={() => void openMatrix(role.id)}
                      >
                        {t('roleEditButton')}
                      </button>
                      {/* A system role is protected from retirement, so the
                          control is absent rather than present-and-refused. */}
                      {role.isSystem ? null : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onToggleStatus(role)}
                          style={{ marginInlineStart: '0.4rem' }}
                        >
                          {role.status === 'ACTIVE'
                            ? t('roleRetireButton')
                            : t('roleReactivateButton')}
                        </button>
                      )}
                      {/* Absent on a system role, like the retire control beside it — the platform
                          defined those rows and the office's screen does not get to remove them. */}
                      {!role.isSystem ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setDeleting(role)}
                          data-delete-role={role.name}
                          style={{ marginInlineStart: '0.4rem' }}
                        >
                          {t('roleDeleteButton')}
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}


      {stepUpPending ? (
        <section style={sectionStyle} data-step-up="">
          <h2>{t('roleStepUpHeading')}</h2>
          <p>{t('roleStepUpIntro')}</p>
          <form onSubmit={onConfirmStepUp} style={formStyle}>
            <label style={labelStyle}>
              {t('roleStepUpPassword')}
              <input
                type="password"
                value={stepUpPassword}
                onChange={(e) => setStepUpPassword(e.target.value)}
                required
              />
            </label>
            <label style={labelStyle}>
              {t('roleStepUpCode')}
              <input
                value={stepUpCode}
                onChange={(e) => setStepUpCode(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {t('roleStepUpConfirm')}
            </button>
            <button type="button" onClick={() => setStepUpPending(null)}>
              {t('roleStepUpCancel')}
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
