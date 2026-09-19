'use client';

import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { hasPermission } from '../../../../lib/auth/permissions';
import { ENUM_LABEL } from '../../../../lib/i18n/enum-labels';
import { ApiError } from '../../../../lib/auth/api-client';
import { stepUp } from '../../../../lib/auth/auth-api';
import {
  createRole,
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
const moduleStyle: CSSProperties = { margin: '1rem 0' };
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
 * `role.manage` is what turns the controls on. A caller with only the first sees
 * the catalogue and no buttons, which is why the prep step separated those names
 * before this screen was written.
 */
export default function RoleAdminPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { language, t } = useLanguage();
  const isArabic = language === 'AR';
  const canRead = hasPermission(user, 'role.read');
  const canManage = hasPermission(user, 'role.manage');
  const canReadCatalogue = hasPermission(user, 'permission.read');

  const [roles, setRoles] = useState<RoleAdminEntry[] | null>(null);
  const [catalogue, setCatalogue] = useState<PermissionCatalogueEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // The role whose matrix is open, with the grants it currently holds.
  const [editing, setEditing] = useState<RoleWithGrants | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [description, setDescription] = useState('');
  const [mfaAlways, setMfaAlways] = useState(true);
  const [hardwareToken, setHardwareToken] = useState(true);

  // Create form.
  const [newName, setNewName] = useState('');
  const [newNameEn, setNewNameEn] = useState('');
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

  const byModule = useMemo(() => {
    const groups = new Map<string, PermissionCatalogueEntry[]>();
    for (const entry of [...catalogue].sort((a, b) =>
      a.module === b.module
        ? a.code.localeCompare(b.code)
        : a.module.localeCompare(b.module),
    )) {
      const list = groups.get(entry.module) ?? [];
      list.push(entry);
      groups.set(entry.module, list);
    }
    return [...groups.entries()];
  }, [catalogue]);

  const segregationWarning = violatesSegregationPair(selected);

  async function openMatrix(roleId: string) {
    setActionError(null);
    setSavedMessage(null);
    try {
      const role = await getRoleWithGrants(roleId);
      setEditing(role);
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
    setBusy(true);
    setActionError(null);
    try {
      await createRole({
        name: newName,
        nameEn: newNameEn,
        nameAr: newNameAr,
        description: newDescription || undefined,
      });
      setNewName('');
      setNewNameEn('');
      setNewNameAr('');
      setNewDescription('');
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

      {roles && roles.length === 0 ? <p>{t('roleNoRoles')}</p> : null}

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
                {canManage ? (
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
                  {canManage ? (
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
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {canManage ? (
        <section style={sectionStyle}>
          <h2>{t('roleCreateHeading')}</h2>
          <form onSubmit={onCreate} style={formStyle}>
            <label style={labelStyle}>
              {t('roleFieldName')}
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
              <small>{t('roleFieldNameHint')}</small>
            </label>
            <label style={labelStyle}>
              {t('roleFieldNameEn')}
              <input
                value={newNameEn}
                onChange={(e) => setNewNameEn(e.target.value)}
                required
              />
            </label>
            <label style={labelStyle}>
              {t('roleFieldNameAr')}
              <input
                value={newNameAr}
                onChange={(e) => setNewNameAr(e.target.value)}
                required
              />
            </label>
            <label style={labelStyle}>
              {t('roleFieldDescription')}
              <input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? t('roleCreating') : t('roleCreateButton')}
            </button>
          </form>
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

          {byModule.map(([module, entries]) => (
            <div key={module} style={moduleStyle}>
              <h3>{module}</h3>
              {entries.map((entry) => (
                <label key={entry.code} style={codeRowStyle}>
                  <input
                    type="checkbox"
                    /* An untranslated hook per code. Every box's visible label is
                       the code plus its description, and a test that selected one
                       by index would silently follow the catalogue's sort order —
                       which is by module, then by code, so it moves whenever a
                       code is added. */
                    data-code={entry.code}
                    checked={selected.has(entry.code)}
                    disabled={editing.isSystem}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(entry.code);
                      else next.delete(entry.code);
                      setSelected(next);
                    }}
                  />
                  <span>
                    <code>{entry.code}</code> — {entry.description}
                  </span>
                </label>
              ))}
            </div>
          ))}

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
