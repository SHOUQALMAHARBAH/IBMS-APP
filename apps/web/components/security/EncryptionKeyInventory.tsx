'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import {
  listEncryptionKeys,
  type EncryptionKeyMetadata,
} from '../../lib/security/encryption-key-api';
import { ApiError } from '../../lib/auth/api-client';
import { useAuth } from '../../lib/auth/auth-context';
import { useLanguage } from '../../lib/i18n/language-context';
import { hasPermission } from '../../lib/auth/permissions';
import { errorStyle } from '../auth/auth-form.styles';

/*
 * THE PII FIELD-ENCRYPTION KEY INVENTORY.
 *
 * `GET /security/encryption-keys` had no web caller (IMPROVEMENTS § 1.44), so the two
 * roles holding `encryption-key.read` could not answer "which key is encrypting our
 * customers' national IDs right now, and how many retired keys are we still holding to
 * decrypt older rows?" without inspecting the running process.
 *
 * WHY IT IS A SECTION ON `/settings/security` RATHER THAN ITS OWN SCREEN
 * --------------------------------------------------------------------
 * That page is deliberately UNGATED — it is the only route through the MFA enrolment
 * guard, so gating it would lock ten of eleven roles out of pairing an authenticator.
 * A gated SECTION on an ungated page is therefore the cheapest correct placement: it
 * renders for exactly the two roles that hold the code and is invisible to everyone
 * else, with no new nav entry and no § 1.61 question to answer.
 *
 * IT RENDERS NOTHING FOR A READER WITHOUT THE CODE — not a refusal sentence. That is
 * the opposite of the choice made on the correction and pause controls, and
 * deliberately: those sit on screens whose whole purpose is the action, so "you cannot
 * do this" is useful. Here the reader came to pair an authenticator and has no reason
 * to be told that a key inventory they have never heard of exists.
 */

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid var(--border-default)',
};

export function EncryptionKeyInventory() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const canRead = hasPermission(user, 'encryption-key.read');

  const [rows, setRows] = useState<EncryptionKeyMetadata[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listEncryptionKeys());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(err instanceof ApiError ? err.message : t('secKeysLoadError'));
    }
  }, [t]);

  useEffect(() => {
    if (!user || !canRead) return;
    void (async () => {
      await load();
    })();
  }, [user, canRead, load]);

  if (!canRead) return null;

  return (
    <section style={{ marginTop: '2rem' }} data-testid="encryption-keys">
      <h2>{t('secKeysHeading')}</h2>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>{t('secKeysIntro')}</p>

      {loadError && (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      )}

      {rows == null ? (
        loadError ? null : (
          <p>{t('secKeysLoading')}</p>
        )
      ) : rows.length === 0 ? (
        <p style={{ color: 'var(--ink-secondary)' }}>{t('secKeysNone')}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: '28rem' }}>
            <thead>
              <tr>
                <th style={head}>{t('secKeysColId')}</th>
                <th style={head}>{t('secKeysColStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((k) => (
                <tr key={k.keyId} data-testid={`encryption-key-${k.keyId}`}>
                  <td style={cell}>{k.keyId}</td>
                  <td style={cell}>
                    {/* The distinction is the whole content: exactly one key is
                      * active, and a retired one is still held because rows written
                      * under it must decrypt. */}
                    {k.active ? t('secKeysActive') : t('secKeysRetired')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
