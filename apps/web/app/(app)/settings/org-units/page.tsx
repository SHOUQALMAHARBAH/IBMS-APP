'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { useLanguage } from '../../../../lib/i18n/language-context';
import {
  loadIndependently,
  namedFailures,
} from '../../../../lib/load-independently';
import { hasPermission } from '../../../../lib/auth/permissions';
import { ApiError } from '../../../../lib/auth/api-client';
import {
  createBranch,
  createDepartment,
  deactivateBranch,
  deactivateDepartment,
  listBranches,
  listDepartments,
  renameBranch,
  renameDepartment,
  type OrgUnit,
} from '../../../../lib/admin/user-admin-api';
import {
  ErrorState,
  PageHeader,
} from '../../../../components/ui';
import { pageStackStyle } from '../../../../components/lead/lead.styles';
import {
  buttonStyle,
  errorStyle,
  inputStyle,
  labelStyle,
  successStyle,
} from '../../../../components/auth/auth-form.styles';
import {
  orgUnitColumnStyle,
  orgUnitGridStyle,
  orgUnitRenameFieldsStyle,
  orgUnitRowStyle,
} from '../../../../components/admin/admin.styles';
import { permissionRefusalAnyOf } from '../../../../lib/i18n/permission-refusal';

/**
 * Departments and branches — the smallest thing that makes the person form honest.
 *
 * ## Why this screen exists at all
 *
 * `ProvisionUserDto` REQUIRES `departmentId` and `branchId`, and until now nothing in the product
 * could create either. The users screen offered two empty dropdowns, submitted two empty strings,
 * and the API answered 400 — which reached the owner as "the create button is broken". A screen that
 * asks for a value whose source was never built is the defect; this is the source.
 *
 * ## What this is NOT
 *
 * Named units, office-scoped. No hierarchy, no parent/child, no manager, no cost centre, no
 * per-branch licence, and nothing in the system reads a department or branch to make an
 * authorization decision — there is a test asserting that last part, so "minimal" cannot quietly
 * become org structure. The full Phase 4 org model is still Phase 4.
 *
 * ## The four actions
 *
 * These two entities are the pilot for the owner's scheme: view / create / edit / delete as four
 * separate permissions, so a role can be given view without edit. This screen renders each control
 * only for the code that gates it — a person with `department.read` alone sees the list and no
 * buttons, which is the scheme visible rather than merely implemented.
 */
export default function OrgUnitsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t, language } = useLanguage();
  const isArabic = language === 'AR';

  const [departments, setDepartments] = useState<OrgUnit[] | null>(null);
  const [branches, setBranches] = useState<OrgUnit[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newDept, setNewDept] = useState({ name: '', nameAr: '' });
  const [newBranch, setNewBranch] = useState({ name: '', nameAr: '' });
  /*
   * Per-row edit state, keyed by id. Shared state here would show one row's draft in every row —
   * the defect the users screen has with its grant dropdown.
   *
   * BOTH NAMES, 2026-11-07. It was a bare `string` — the English name alone — so the Arabic name
   * of a department or branch could not be corrected from anywhere in this system. Creation has
   * REQUIRED `nameAr` since 2026-10-28, which means every office has one and none could fix a
   * typo in it. The server never needed changing: `RenameOrgUnitDto` has accepted `nameAr` alone
   * all along, and its own comment names this control as the remedy for exactly this case. Only
   * the screen was missing the field.
   */
  const [editing, setEditing] = useState<
    Record<string, { name: string; nameAr: string }>
  >({});

  const canReadDept = hasPermission(user, 'department.read');
  const canCreateDept = hasPermission(user, 'department.create');
  const canUpdateDept = hasPermission(user, 'department.update');
  const canRetireDept = hasPermission(user, 'department.deactivate');
  const canReadBranch = hasPermission(user, 'branch.read');
  const canCreateBranch = hasPermission(user, 'branch.create');
  const canUpdateBranch = hasPermission(user, 'branch.update');
  const canRetireBranch = hasPermission(user, 'branch.deactivate');

  /*
   * ITEM 8 — the two halves of this screen are independent and were loaded as if they were not.
   *
   * `Promise.all` plus `setDepartments(null)` meant a refused BRANCH read blanked the department
   * table as well, under one sentence naming neither. This screen already understood the principle
   * one layer up — `noAccess = !canReadDept && !canReadBranch` renders the half the reader holds —
   * and the loader then threw that away on a refusal.
   *
   * `null` is reserved for "did not arrive", which is what the tables below already read it as, so
   * a failed half stays `null` and the other half renders.
   */
  const load = useCallback(async () => {
    const { values, failures } = await loadIndependently([
      ...(canReadDept
        ? [
            {
              key: 'departments',
              label: t('commonListDepartments'),
              load: listDepartments,
            },
          ]
        : []),
      ...(canReadBranch
        ? [
            {
              key: 'branches',
              label: t('commonListBranches'),
              load: listBranches,
            },
          ]
        : []),
    ]);
    setDepartments(canReadDept ? ((values.departments as OrgUnit[]) ?? null) : []);
    setBranches(canReadBranch ? ((values.branches as OrgUnit[]) ?? null) : []);
    const first = failures[0]?.error;
    setLoadError(
      failures.length === 0
        ? null
        : first instanceof ApiError
          ? `${t('commonListsMissing')} ${namedFailures(failures)} — ${first.message}`
          : `${t('commonListsMissing')} ${namedFailures(failures)}`,
    );
  }, [canReadDept, canReadBranch, t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  // The async IIFE is the house pattern, and it is what the cascading-render lint rule wants:
  // everything this effect does settles on a promise before any state is set.
  useEffect(() => {
    if (!user || (!canReadDept && !canReadBranch)) return;
    void (async () => {
      await load();
    })();
  }, [user, canReadDept, canReadBranch, load]);

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      await work();
      setMessage(done);
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('orgUnitLoadError'),
      );
    } finally {
      setBusy(false);
    }
  }

  function onCreate(kind: 'department' | 'branch') {
    return (e: FormEvent) => {
      e.preventDefault();
      const draft = kind === 'department' ? newDept : newBranch;
      // BOTH names, 2026-10-28. The Arabic used to be omitted when blank, which left a unit with no
      // Arabic name on an Arabic-first platform — it then rendered as its Latin name to a reader who
      // does not read it. Guarded here as well as by the input's `required`, because a screen must
      // not send a request it already knows the api will refuse.
      if (!draft.name.trim() || !draft.nameAr.trim()) return;
      const payload = {
        name: draft.name.trim(),
        nameAr: draft.nameAr.trim(),
      };
      void run(async () => {
        if (kind === 'department') {
          await createDepartment(payload);
          setNewDept({ name: '', nameAr: '' });
        } else {
          await createBranch(payload);
          setNewBranch({ name: '', nameAr: '' });
        }
      }, t('orgUnitCreated'));
    };
  }

  if (isLoading || !user) return null;

  const noAccess = !canReadDept && !canReadBranch;

  function renderColumn(
    kind: 'department' | 'branch',
    units: OrgUnit[] | null,
    can: { read: boolean; create: boolean; update: boolean; retire: boolean },
    draft: { name: string; nameAr: string },
    setDraft: (next: { name: string; nameAr: string }) => void,
  ) {
    if (!can.read) return null;
    return (
      <section style={orgUnitColumnStyle} data-org-unit-kind={kind}>
        <h2>
          {kind === 'department'
            ? t('orgUnitDepartments')
            : t('orgUnitBranches')}
        </h2>

        {can.create ? (
          <form onSubmit={onCreate(kind)}>
            <label style={labelStyle}>
              {t('orgUnitNameEn')}
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
                style={inputStyle}
                data-new-name={kind}
              />
            </label>
            <label style={labelStyle}>
              {t('orgUnitNameAr')}
              <input
                value={draft.nameAr}
                onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })}
                required
                style={inputStyle}
                data-new-name-ar={kind}
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              style={buttonStyle}
              data-create={kind}
            >
              {t('orgUnitCreateButton')}
            </button>
          </form>
        ) : null}

        {units === null ? <p role="status">{t('commonLoading')}</p> : null}
        {units !== null && units.length === 0 ? (
          <p role="status" data-empty={kind}>
            {t('orgUnitNone')}
          </p>
        ) : null}

        {(units ?? []).map((u) => {
          const draft = editing[u.id];
          return (
            <div key={u.id} style={orgUnitRowStyle} data-org-unit={u.id}>
              {draft === undefined ? (
                <span>
                  <bdi>{isArabic ? (u.nameAr ?? u.name) : u.name}</bdi>
                </span>
              ) : (
                <span style={orgUnitRenameFieldsStyle}>
                  <input
                    value={draft.name}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        [u.id]: { ...draft, name: e.target.value },
                      })
                    }
                    style={inputStyle}
                    data-rename-input={u.id}
                    aria-label={t('orgUnitNameEn')}
                  />
                  <input
                    value={draft.nameAr}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        [u.id]: { ...draft, nameAr: e.target.value },
                      })
                    }
                    style={inputStyle}
                    data-rename-input-ar={u.id}
                    aria-label={t('orgUnitNameAr')}
                  />
                </span>
              )}

              {can.update && draft === undefined ? (
                <button
                  type="button"
                  onClick={() =>
                    setEditing({
                      ...editing,
                      // `?? ''` rather than `?? u.name`: a row with no Arabic name must open an
                      // EMPTY Arabic field, never one pre-filled with the Latin name, which a
                      // person would reasonably save as though it were the Arabic one.
                      [u.id]: { name: u.name, nameAr: u.nameAr ?? '' },
                    })
                  }
                  data-rename={u.id}
                >
                  {t('orgUnitRename')}
                </button>
              ) : null}

              {can.update && draft !== undefined ? (
                <button
                  type="button"
                  disabled={
                    busy ||
                    (draft.name.trim().length === 0 &&
                      draft.nameAr.trim().length === 0)
                  }
                  data-save-rename={u.id}
                  onClick={() =>
                    void run(async () => {
                      /*
                       * A DIFF, not the whole form — each half is sent only when it carries a
                       * value. `RenameOrgUnitDto` validates every field it RECEIVES
                       * (`@IsOptional()` + `@Length(1, 100)`), so posting a blank one is a 400
                       * naming a field the person may never have touched; that is the insurer
                       * panel's recorded defect, and the 11 of 14 live branches db-test holds
                       * with no Arabic name at all are exactly the rows that would hit it.
                       * The service refuses a both-blank body itself, so the two agree.
                       *
                       * The cost, stated rather than hidden: a cleared field reads as
                       * UNCHANGED, so this control can set and change an Arabic name and cannot
                       * REMOVE one. No value the DTO accepts means "remove this", and inventing
                       * a sentinel is an api decision rather than a screen's.
                       */
                      const payload = {
                        ...(draft.name.trim()
                          ? { name: draft.name.trim() }
                          : {}),
                        ...(draft.nameAr.trim()
                          ? { nameAr: draft.nameAr.trim() }
                          : {}),
                      };
                      if (kind === 'department')
                        await renameDepartment(u.id, payload);
                      else await renameBranch(u.id, payload);
                      const next = { ...editing };
                      delete next[u.id];
                      setEditing(next);
                    }, t('orgUnitRenamed'))
                  }
                >
                  {t('commonSave')}
                </button>
              ) : null}

              {can.retire ? (
                <button
                  type="button"
                  disabled={busy}
                  data-retire={u.id}
                  onClick={() =>
                    void run(async () => {
                      if (kind === 'department')
                        await deactivateDepartment(u.id);
                      else await deactivateBranch(u.id);
                    }, t('orgUnitRetired'))
                  }
                >
                  {t('orgUnitRetire')}
                </button>
              ) : null}
            </div>
          );
        })}
      </section>
    );
  }

  return (
    <main style={pageStackStyle}>
      <PageHeader title={t('orgUnitHeading')} />
      <p>{t('orgUnitIntro')}</p>

      {noAccess ? (
        <p role="status" style={errorStyle}>
          {permissionRefusalAnyOf(t, 'orgUnitRefusalAct', ['department.read', 'branch.read'])}
        </p>
      ) : null}
      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}
      {actionError ? <p style={errorStyle}>{actionError}</p> : null}
      {message ? (
        <p role="status" style={successStyle}>
          {message}
        </p>
      ) : null}

      <div style={orgUnitGridStyle}>
        {renderColumn(
          'department',
          departments,
          {
            read: canReadDept,
            create: canCreateDept,
            update: canUpdateDept,
            retire: canRetireDept,
          },
          newDept,
          setNewDept,
        )}
        {renderColumn(
          'branch',
          branches,
          {
            read: canReadBranch,
            create: canCreateBranch,
            update: canUpdateBranch,
            retire: canRetireBranch,
          },
          newBranch,
          setNewBranch,
        )}
      </div>
    </main>
  );
}
