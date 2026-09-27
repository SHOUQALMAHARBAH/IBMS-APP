'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { hasPermission } from '../../../../lib/auth/permissions';
import {
  addInsuranceLine,
  lineEditHasChanges,
  lineNamesAreValid,
  listInsuranceLines,
  updateInsuranceLine,
  type InsuranceLine,
} from '../../../../lib/insurer/insurance-line-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';

/*
 * THE OFFICE'S OWN ADDITIONS TO THE INSURANCE-LINE VOCABULARY.
 *
 * `POST /insurance-lines` and `PATCH /insurance-lines/:id` both shipped with no web
 * caller, and the POST was invisible to IMPROVEMENTS § 1.44's original measurement
 * because that pass compares PATHS: `GET /insurance-lines` is called by three
 * pickers, so a POST on the same path read as covered. The verb-aware second pass
 * found it (§ 1.65).
 *
 * What that cost: an office could pick from the vocabulary and could neither extend
 * nor correct it. For a broker that means a line of business it actually writes has no
 * entry at all, and every screen that groups by line has nowhere to put that business.
 *
 * WHY /settings, AND WHY GATED ON BOTH WRITE CODES
 * ----------------------------------------------
 * Measured: `insurance-line.create` and `insurance-line.update` are held by
 * OFFICE_ADMINISTRATOR alone, and that role also holds the `insurer.read` the list
 * needs — so the control sits on a screen every holder of its permission can open
 * (§ 1.61). Both codes gate the nav entry, following `/settings/org-units`: a future
 * role holding only one still gets in, and the column it cannot use renders read-only.
 *
 * STANDARD LINES ARE NOT EDITABLE HERE, AND THE SERVER AGREES STRUCTURALLY
 * ---------------------------------------------------------------------
 * `PATCH` resolves through `findOfficeLineById`, so a standard line's id reads as
 * ABSENT rather than forbidden — it is not an office addition. The screen therefore
 * offers the control only where `isStandard` is false, and says why on the rows it
 * does not, because a missing button with no explanation reads as a broken screen.
 */

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
const muted: CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--ink-secondary)',
  margin: 0,
};
const fieldStyle: CSSProperties = { display: 'grid', gap: '0.2rem' };

type Draft = { nameEn: string; nameAr: string; category: 'GENERAL' | 'LIFE' };

const EMPTY: Draft = { nameEn: '', nameAr: '', category: 'GENERAL' };

export default function InsuranceLinesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  const canCreate = hasPermission(user, 'insurance-line.create');
  const canUpdate = hasPermission(user, 'insurance-line.update');

  const [rows, setRows] = useState<InsuranceLine[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft>(EMPTY);

  const load = useCallback(async () => {
    try {
      setRows(await listInsuranceLines());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError ? err.message : t('lineAdminLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load]);

  const add = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      await addInsuranceLine(draft);
      setDraft(EMPTY);
      await load();
    } catch (err) {
      // The server's own sentence when it has one: a collision with a standard line
      // and a collision with this office's own addition are different problems.
      setActionError(
        err instanceof ApiError ? err.message : t('lineAdminAddError'),
      );
    } finally {
      setBusy(false);
    }
  }, [draft, load, t]);

  const save = useCallback(
    async (id: string) => {
      setBusy(true);
      setActionError(null);
      try {
        await updateInsuranceLine(id, edit);
        setEditingId(null);
        setEdit(EMPTY);
        await load();
      } catch (err) {
        setActionError(
          err instanceof ApiError ? err.message : t('lineAdminSaveError'),
        );
      } finally {
        setBusy(false);
      }
    },
    [edit, load, t],
  );

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('lineAdminHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '50rem' }}>{t('lineAdminIntro')}</p>

      {loadError && (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      )}
      {actionError && (
        <p role="alert" style={errorStyle} data-testid="line-admin-error">
          {actionError}
        </p>
      )}

      {canCreate ? (
        <section style={{ margin: '1.5rem 0' }} data-testid="line-add-form">
          <h2 style={{ fontSize: '1.05rem' }}>{t('lineAdminAddHeading')}</h2>
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'end',
              flexWrap: 'wrap',
            }}
          >
            <label style={fieldStyle}>
              <span style={{ fontSize: '0.8rem' }}>{t('lineAdminNameEn')}</span>
              <input
                type="text"
                data-testid="line-name-en"
                value={draft.nameEn}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, nameEn: e.target.value }))
                }
              />
            </label>
            <label style={fieldStyle}>
              <span style={{ fontSize: '0.8rem' }}>{t('lineAdminNameAr')}</span>
              <input
                type="text"
                data-testid="line-name-ar"
                value={draft.nameAr}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, nameAr: e.target.value }))
                }
              />
            </label>
            <label style={fieldStyle}>
              <span style={{ fontSize: '0.8rem' }}>
                {t('lineAdminCategory')}
              </span>
              <select
                data-testid="line-category"
                value={draft.category}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    category: e.target.value as 'GENERAL' | 'LIFE',
                  }))
                }
              >
                <option value="GENERAL">GENERAL</option>
                <option value="LIFE">LIFE</option>
              </select>
            </label>
            <button
              type="button"
              data-testid="line-add"
              disabled={busy || !lineNamesAreValid(draft)}
              onClick={() => void add()}
            >
              {t('lineAdminAdd')}
            </button>
          </div>
          <p style={{ ...muted, marginTop: '0.4rem', maxWidth: '44rem' }}>
            {t('lineAdminBothNamesNote')}
          </p>
          <p style={{ ...muted, maxWidth: '44rem' }}>
            {t('lineAdminNoCodeNote')}
          </p>
        </section>
      ) : (
        <p style={muted} data-testid="line-admin-readonly">
          {t('lineAdminNoPermission')}
        </p>
      )}

      {rows == null ? (
        loadError ? null : (
          <p>{t('lineAdminLoading')}</p>
        )
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: '46rem' }}>
            <thead>
              <tr>
                <th style={head}>{t('lineAdminColName')}</th>
                <th style={head}>{t('lineAdminColCategory')}</th>
                <th style={head}>{t('lineAdminColOrigin')}</th>
                {canUpdate && <th style={head}>{t('lineAdminColActions')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} data-testid={`line-${l.id}`}>
                  <td style={cell}>
                    {editingId === l.id ? (
                      <div style={{ display: 'grid', gap: '0.3rem' }}>
                        <input
                          type="text"
                          aria-label={t('lineAdminNameEn')}
                          data-testid={`line-edit-en-${l.id}`}
                          value={edit.nameEn}
                          onChange={(e) =>
                            setEdit((d) => ({ ...d, nameEn: e.target.value }))
                          }
                        />
                        <input
                          type="text"
                          aria-label={t('lineAdminNameAr')}
                          data-testid={`line-edit-ar-${l.id}`}
                          value={edit.nameAr}
                          onChange={(e) =>
                            setEdit((d) => ({ ...d, nameAr: e.target.value }))
                          }
                        />
                      </div>
                    ) : (
                      <>
                        {l.nameEn}
                        <div style={muted}>{l.nameAr}</div>
                      </>
                    )}
                  </td>
                  <td style={cell}>
                    {editingId === l.id ? (
                      <select
                        aria-label={t('lineAdminCategory')}
                        data-testid={`line-edit-category-${l.id}`}
                        value={edit.category}
                        onChange={(e) =>
                          setEdit((d) => ({
                            ...d,
                            category: e.target.value as 'GENERAL' | 'LIFE',
                          }))
                        }
                      >
                        <option value="GENERAL">GENERAL</option>
                        <option value="LIFE">LIFE</option>
                      </select>
                    ) : (
                      l.category
                    )}
                  </td>
                  <td style={cell}>
                    {l.isStandard ? (
                      <>
                        {t('lineAdminStandard')}
                        {/* The code is shown only for a standard line, because that
                          * is the whole distinction: an office cannot mint one. */}
                        {l.code && <div style={muted}>{l.code}</div>}
                      </>
                    ) : (
                      t('lineAdminOwn')
                    )}
                  </td>
                  {canUpdate && (
                    <td style={cell}>
                      {l.isStandard ? (
                        <span style={muted} data-testid={`line-locked-${l.id}`}>
                          {t('lineAdminStandardLocked')}
                        </span>
                      ) : editingId === l.id ? (
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                          <button
                            type="button"
                            data-testid={`line-save-${l.id}`}
                            disabled={busy || !lineEditHasChanges(edit, l)}
                            onClick={() => void save(l.id)}
                          >
                            {t('lineAdminSave')}
                          </button>
                          <button
                            type="button"
                            data-testid={`line-cancel-${l.id}`}
                            onClick={() => {
                              setEditingId(null);
                              setEdit(EMPTY);
                              setActionError(null);
                            }}
                          >
                            {t('lineAdminCancel')}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          data-testid={`line-edit-${l.id}`}
                          disabled={busy}
                          onClick={() => {
                            setEditingId(l.id);
                            // PREFILLED FROM THE ROW, unlike the customer
                            // correction: these values are plain text, not masked,
                            // so the current name is what a corrector starts from.
                            setEdit({
                              nameEn: l.nameEn,
                              nameAr: l.nameAr,
                              category: l.category,
                            });
                            setActionError(null);
                          }}
                        >
                          {t('lineAdminEdit')}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
