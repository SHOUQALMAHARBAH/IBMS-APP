'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useLanguage } from '../../lib/i18n/language-context';
import { ApiError } from '../../lib/auth/api-client';
import {
  getDpoDesignation,
  isCombinedDeclarationRequired,
  recordDpoDesignation,
  type DpoDesignationView,
} from '../../lib/admin/dpo-designation-api';
import {
  buttonStyle,
  errorStyle,
  labelStyle,
  successStyle,
} from '../auth/auth-form.styles';
import { formatDateTime } from '../../lib/i18n/format';

/**
 * MODULE 0-ب — WHO HOLDS THE DPO ASSIGNMENT, AND THE ACKNOWLEDGEMENT WHEN THAT IS THE MANAGER.
 *
 * ## IT DECLARES. IT DOES NOT REFUSE
 *
 * One person may hold both assignments; an office of one person does not contain two people. This
 * reverses a hard block the repository previously recorded, knowingly — see
 * `dpo-designation.config.ts` for the decision and the recorded departure from the legal adviser's
 * own written answer.
 *
 * So there is no disabled control, no warning styling and no reason box. A notice, a tick, and the
 * save goes through.
 *
 * ## TWO PATHS REVEAL THE NOTICE, AND NEITHER IS A SECOND COPY OF THE SAMENESS TEST
 *
 * 1. OPTIMISTIC, on screen: the typed name equals the manager on record after trimming. That is the
 *    ordinary case — somebody typing the name as it is written on the row — and catching it here is
 *    what keeps the acknowledgement in the SAME request rather than making it a second step.
 * 2. THE SERVER'S 422, identified by its `code`: the canonical fold treats two spellings as one
 *    person. The screen holds no copy of that fold on purpose — `canonicalNameKey` is the api's, and
 *    a second copy of "are these the same person" is a second answer to it.
 *
 * The consequence is stated rather than hidden: in case 2 the reader presses Save, is shown the
 * notice with the server's own sentence, and saves again. That is one extra press in the uncommon
 * case, which is the honest price of not duplicating the fold.
 *
 * ## THE SENTENCE IS THE OWNER'S AND IS SENT FROM HERE
 *
 * Decision 28's rule: the record carries what the office WAS SHOWN, so the sentence travels from the
 * client and the server stores it verbatim. Re-deriving it at submit would answer a different
 * question. `dpo-designation-notice.test.ts` pins the rendered text by hash against the file she
 * supplied.
 */
export function DpoAssignmentSection({ canDeclare }: { canDeclare: boolean }) {
  const { language, t } = useLanguage();

  const [view, setView] = useState<DpoDesignationView | null>(null);
  const [name, setName] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [serverAsked, setServerAsked] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await getDpoDesignation();
      setView(next);
      setName(next.dataProtectionOfficerName ?? '');
      setLoadError(null);
    } catch (err) {
      setView(null);
      setLoadError(
        err instanceof ApiError ? err.message : t('dpoAssignLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const manager = view?.generalManagerName?.trim() ?? '';
  const typed = name.trim();

  // The notice is shown when the office is being asked. Three ways in: the optimistic comparison,
  // the server having asked, and the designation ALREADY stored as combined but not yet
  // acknowledged — which is the state an office is left in if the column was filled by any other
  // path.
  const looksCombined = typed !== '' && manager !== '' && typed === manager;
  const asking = looksCombined || serverAsked || (view?.declarationRequired ?? false);

  // ALREADY ACKNOWLEDGED, for this person: show what was agreed and stop asking.
  const settled =
    (view?.combinedWithManager ?? false) &&
    !(view?.declarationRequired ?? false) &&
    view?.acknowledgedAt != null;

  const notice = `${t('dpoAssignNotice')}\n\n${t('dpoAssignAcknowledge')}`;
  const blocked = asking && !acknowledged;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    setSaved(false);
    try {
      const next = await recordDpoDesignation({
        dataProtectionOfficerName: typed,
        ...(asking && acknowledged
          ? { declaration: { noticeShown: notice, acknowledged: true } }
          : {}),
      });
      setView(next);
      setName(next.dataProtectionOfficerName ?? '');
      setAcknowledged(false);
      setServerAsked(false);
      setSaved(true);
    } catch (err) {
      // THE SERVER ASKED. Reveal the notice and keep its own sentence, which says the arrangement is
      // permitted — a generic failure here would read as a refusal of the thing it explicitly allows.
      if (isCombinedDeclarationRequired(err)) setServerAsked(true);
      setFormError(
        err instanceof ApiError ? err.message : t('dpoAssignSaveError'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="dpo-assign" style={{ marginTop: '2.5rem' }}>
      <h2>{t('dpoAssignHeading')}</h2>
      <p style={{ color: 'var(--ink-secondary)', maxWidth: '44rem' }}>
        {t('dpoAssignIntro')}
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {view ? (
        <p
          data-testid="dpo-assign-manager"
          style={{ margin: '0.6rem 0', fontSize: '0.9rem' }}
        >
          <strong>{t('dpoAssignManagerLabel')}</strong>{' '}
          {manager === '' ? (
            <span style={{ color: 'var(--ink-secondary)' }}>
              {t('dpoAssignManagerUnset')}
            </span>
          ) : (
            <bdi>{manager}</bdi>
          )}
        </p>
      ) : null}

      {settled ? (
        <p
          data-testid="dpo-assign-acknowledged"
          role="status"
          style={{ color: 'var(--ink-secondary)', fontSize: '0.9rem', margin: '0.3rem 0' }}
        >
          {t('dpoAssignAcknowledgedOn', {
            who: view?.acknowledgedByName ?? '—',
            when: formatDateTime(view?.acknowledgedAt ?? '', language),
          })}
        </p>
      ) : null}

      {canDeclare && view ? (
        <form
          onSubmit={(e) => void submit(e)}
          style={{ marginTop: '1rem', maxWidth: '44rem' }}
        >
          <label htmlFor="dpo-assign-name" style={labelStyle}>
            {t('dpoAssignNameLabel')}
          </label>
          <input
            id="dpo-assign-name"
            data-testid="dpo-assign-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ width: '100%' }}
          />
          <p
            style={{
              color: 'var(--ink-secondary)',
              fontSize: '0.8rem',
              margin: '0.25rem 0',
            }}
          >
            {t('dpoAssignNameHint')}
          </p>

          {asking ? (
            <div
              data-testid="dpo-assign-notice"
              /*
               * `role="status"`, NEVER `alert`. This is the basis of a thing the system PERMITS, not
               * a refusal — the same call the art. 3/a basis note made, and for the same reason: an
               * `alert` would tell an office of one person that something is wrong with an
               * arrangement the owner specifically decided to allow.
               */
              role="status"
              style={{
                marginTop: '1rem',
                padding: '0.9rem 1rem',
                border: '1px solid var(--border-subtle)',
                borderRadius: '0.4rem',
                /*
                 * was `--surface-raised`, which `globals.css` defines nowhere — so THIS block, the
                 * one carrying the owner's own Arabic notice, rendered with no surface behind it
                 * from the day it shipped. See the surfaces note in globals.css.
                 */
                background: 'var(--surface-sunken)',
                whiteSpace: 'pre-line',
                maxWidth: '44rem',
              }}
            >
              {t('dpoAssignNotice')}
            </div>
          ) : null}

          {asking ? (
            <label
              style={{ display: 'block', margin: '0.8rem 0' }}
              htmlFor="dpo-assign-acknowledge"
            >
              <input
                id="dpo-assign-acknowledge"
                data-testid="dpo-assign-acknowledge"
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />{' '}
              {t('dpoAssignAcknowledge')}
            </label>
          ) : null}

          {formError ? (
            <p role="alert" style={errorStyle}>
              {formError}
            </p>
          ) : null}
          {saved ? (
            <p role="status" style={successStyle}>
              {t('dpoAssignSaved')}
            </p>
          ) : null}

          <button
            type="submit"
            data-testid="dpo-assign-save"
            disabled={busy || blocked}
            style={{ ...buttonStyle, width: 'auto' }}
          >
            {busy ? t('dpoAssignWorkingButton') : t('dpoAssignSaveButton')}
          </button>
        </form>
      ) : null}
    </section>
  );
}
