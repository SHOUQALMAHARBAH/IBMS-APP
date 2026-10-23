'use client';

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react';
import { useAuth } from '../../lib/auth/auth-context';
import { useLanguage } from '../../lib/i18n/language-context';
import { hasPermission } from '../../lib/auth/permissions';
import { ApiError } from '../../lib/auth/api-client';
import {
  declareConflictOfInterest,
  listConflictOfInterestDisclosures,
  DISCLOSURE_MIN_LENGTH,
  type ConflictOfInterestEntry,
} from '../../lib/compliance-risk/conflict-of-interest-api';
import {
  buttonStyle,
  errorStyle,
  labelStyle,
  successStyle,
} from '../auth/auth-form.styles';
import { formatDateTime } from '../../lib/i18n/format';

/*
 * THE CONFLICT-OF-INTEREST DISCLOSURE REGISTER — decision 36.
 *
 * TWO HALVES WITH DIFFERENT AUDIENCES, ON ONE SECTION
 * ---------------------------------------------------
 * DECLARING is for everybody and is gated by nothing: the discloser is the SUBJECT, so there is no
 * permission code for it and there cannot be one — a code an office could withhold would leave the
 * person who HAS the conflict as the one person unable to say so.
 *
 * READING other people's disclosures is `conflict-of-interest.register.read`, whose seeded holder is
 * a TEMPLATE DEFAULT and not a lock (decision 80).
 *
 * WHY `/settings/security` AND NOT A NEW SCREEN
 * --------------------------------------------
 * The declaring half has to be reachable by EVERY role, and this page is the only universally
 * reachable one in the application — it is the sole route through the MFA enrolment guard, which is
 * why it is deliberately ungated. A nav entry gated on the read code would leave ten of eleven roles
 * unable to reach the form; an ungated nav entry for every role is noise on ten sidebars.
 *
 * So the `EncryptionKeyInventory` placement is reused: a section on an ungated page, with the GATED
 * half rendering nothing at all for a reader without the code — not a refusal sentence, because
 * somebody who came here to pair an authenticator has no reason to be told a register they cannot
 * read exists. The cost is discoverability for the manager, and it is recorded rather than hidden:
 * the screen pass may well move this, which is the owner's call.
 */

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid var(--border-default)',
};

export function ConflictOfInterestRegister() {
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const canRead = hasPermission(user, 'conflict-of-interest.register.read');

  const [disclosure, setDisclosure] = useState('');
  const [rows, setRows] = useState<ConflictOfInterestEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!canRead) return;
    try {
      setRows(await listConflictOfInterestDisclosures());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError ? err.message : t('coiRegLoadError'),
      );
    }
  }, [canRead, t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  if (!user) return null;

  const tooShort = disclosure.trim().length < DISCLOSURE_MIN_LENGTH;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    setSaved(false);
    try {
      await declareConflictOfInterest(disclosure.trim());
      setDisclosure('');
      setSaved(true);
      // Re-read, so a reader who can see the register sees their own entry land. A no-op for
      // everybody else, which is most people.
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : t('coiRegSaveError'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="coi-register" style={{ marginTop: '2.5rem' }}>
      <h2>{t('coiRegHeading')}</h2>
      <p style={{ color: 'var(--ink-secondary)', maxWidth: '44rem' }}>
        {t('coiRegIntro')}
      </p>

      <form onSubmit={(e) => void submit(e)} style={{ maxWidth: '44rem' }}>
        <label htmlFor="coi-disclosure" style={labelStyle}>
          {t('coiRegDisclosureLabel')}
        </label>
        <textarea
          id="coi-disclosure"
          data-testid="coi-disclosure"
          value={disclosure}
          rows={3}
          onChange={(e) => setDisclosure(e.target.value)}
          style={{ width: '100%' }}
        />
        <p
          style={{
            color: 'var(--ink-secondary)',
            fontSize: '0.8rem',
            margin: '0.25rem 0',
          }}
        >
          {t('coiRegDisclosureHint', { min: String(DISCLOSURE_MIN_LENGTH) })}
        </p>

        {formError ? (
          <p role="alert" style={errorStyle}>
            {formError}
          </p>
        ) : null}
        {saved ? (
          <p role="status" style={successStyle}>
            {t('coiRegSaved')}
          </p>
        ) : null}

        <button
          type="submit"
          data-testid="coi-declare"
          disabled={busy || tooShort}
          style={{ ...buttonStyle, width: 'auto' }}
        >
          {busy ? t('coiRegWorkingButton') : t('coiRegDeclareButton')}
        </button>
      </form>

      {/* THE GATED HALF. Nothing renders here without the code — see the header. */}
      {canRead ? (
        <div data-testid="coi-register-table" style={{ marginTop: '2rem' }}>
          <h3>{t('coiRegTableHeading')}</h3>
          {loadError ? (
            <p role="alert" style={errorStyle}>
              {loadError}
            </p>
          ) : rows === null ? null : rows.length === 0 ? (
            <p style={{ color: 'var(--ink-secondary)' }}>{t('coiRegEmpty')}</p>
          ) : (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={head}>{t('coiRegWhoHeading')}</th>
                  <th style={head}>{t('coiRegWhenHeading')}</th>
                  <th style={head}>{t('coiRegWhatHeading')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    {/*
                      THE NAME, never `declaredByUserId`. A uuid in front of the manager reading this
                      is the identifier-where-a-name-exists fault, and the api includes the name for
                      exactly this reason. `bdi` because a name may be in either script.
                    */}
                    <td style={cell}>
                      {/* Owner decision 48 — the HR record's name, resolved by the api. The em
                        * dash is the resolver's absent case, the same branch the three sibling
                        * registers have; the FK is RESTRICT so it does not arise today. */}
                      {row.declaredByName ? (
                        <bdi>{row.declaredByName}</bdi>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={cell}>
                      {formatDateTime(row.declaredAt, language)}
                    </td>
                    <td style={cell}>{row.disclosure}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </section>
  );
}
