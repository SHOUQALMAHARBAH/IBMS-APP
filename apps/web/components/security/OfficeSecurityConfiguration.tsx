'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { getSecurityConfig, type SecurityConfig } from '../../lib/auth/auth-api';
import { ApiError } from '../../lib/auth/api-client';
import { useAuth } from '../../lib/auth/auth-context';
import { useLanguage } from '../../lib/i18n/language-context';
import { hasPermission } from '../../lib/auth/permissions';
import { errorStyle } from '../auth/auth-form.styles';
import type { PluralKey } from '../../lib/i18n/plurals';
import type { TranslationKey } from '../../lib/i18n/translations';

/*
 * THE OFFICE'S OWN SESSION AND LOCKOUT POLICY — OWNER DECISION 47, THE READ HALF.
 *
 * WHY THIS EXISTS WHEN NOTHING IS BROKEN
 * --------------------------------------
 * `SecurityConfig` is one row per Organization and every column carries a working default, so
 * sessions expire and accounts lock correctly today and have always done. What an office could
 * NOT do is ANSWER FOR IT: asked by a CBJ inspector or a PDPL audit "what is your session and
 * lockout policy?", the seven numbers that govern it were readable only by someone with database
 * access. `GET /auth/security-config` existed, `getSecurityConfig()` existed, and nothing called
 * either — one of the dead client helpers `dead-client-helpers.py` reports.
 *
 * The value is therefore an ANSWERABLE QUESTION, not a new capability. Nothing here changes
 * behaviour for anybody.
 *
 * WHY IT IS A SECTION ON `/settings/security` AND NOT A SCREEN
 * -----------------------------------------------------------
 * The same argument as `EncryptionKeyInventory` beside it: that page is deliberately UNGATED,
 * because it is the only route through `MfaRequiredGuard`, so gating the PAGE would lock ten of
 * eleven roles out of pairing an authenticator. A gated SECTION needs no nav entry and raises no
 * § 1.61 question — `security-config.read` is held by SYSTEM_SECURITY_ADMINISTRATOR and
 * OFFICE_ADMINISTRATOR, both of whom can already open this page, as can everybody.
 *
 * IT RENDERS NOTHING FOR A READER WITHOUT THE CODE — not a refusal sentence. That follows the
 * recorded rule rather than the opposite habit: explain a refusal WHERE THE READER CAME FOR THE
 * THING REFUSED. A Sales Officer opens this page to pair an authenticator and has no reason to be
 * told that an office security policy they have never heard of exists and is closed to them.
 * `EncryptionKeyInventory` and `ConflictOfInterestRegister` both made that call on this same page.
 *
 * THERE IS NO EMPTY STATE, DELIBERATELY
 * -------------------------------------
 * `SecurityConfig` is `@@unique([organizationId])` with a default for every column, and the
 * repository UPSERTS, so an office always has exactly one row and "no configuration" is not a
 * state this screen can be in. An empty branch here would be unreachable code asserting a
 * possibility the schema forbids — the § 1.62 shape. The other three states are all real and all
 * present: loading, a load error with a way forward in both languages, and populated.
 *
 * THERE IS NO EDIT AFFORDANCE, NOT EVEN A DISABLED ONE
 * ---------------------------------------------------
 * `PUT /auth/security-config` stays unreached BY DECISION (47), owed to the
 * employees-and-permissions module: changing any of these seven is a POLICY decision whose home is
 * beside the other sign-in policies, and the owner's walk may change the numbers themselves. A
 * disabled button is a promise with a date on it, so there is none.
 */

const row: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(10rem, 18rem) auto',
  gap: '0.5rem 1rem',
  padding: '0.5rem 0',
  borderBottom: '1px solid var(--border-subtle)',
  alignItems: 'baseline',
};
const labelStyle: CSSProperties = { fontWeight: 600 };
const valueStyle: CSSProperties = { fontVariantNumeric: 'tabular-nums' };
const meaningStyle: CSSProperties = {
  gridColumn: '1 / -1',
  margin: 0,
  fontSize: '0.875rem',
  color: 'var(--ink-secondary)',
};

/*
 * The seven, each paired with the unit it is measured in.
 *
 * `field` is keyed to `SecurityConfig` rather than to a string, so a column renamed on the api
 * side is a COMPILE ERROR here rather than a row rendering `undefined`. The labels and meanings
 * are the owner's own words (decision 47) and must not be reworded; the unit sets are derived in
 * `plurals.ts` from forms that already shipped.
 *
 * `maxFailedLoginAttempts` is the one that is not a duration — it is a count of attempts, and its
 * unit noun is therefore the thing counted rather than a span of time.
 */
const FIELDS: ReadonlyArray<{
  field: keyof SecurityConfig;
  label: TranslationKey;
  meaning: TranslationKey;
  unit: PluralKey;
}> = [
  {
    field: 'idleTimeoutMinutes',
    label: 'secCfgIdleLabel',
    meaning: 'secCfgIdleMeaning',
    unit: 'secCfgUnitMinutes',
  },
  {
    field: 'hardLogoutAfterIdleMinutes',
    label: 'secCfgHardLogoutLabel',
    meaning: 'secCfgHardLogoutMeaning',
    unit: 'secCfgUnitMinutes',
  },
  {
    field: 'accessTokenTtlMinutes',
    label: 'secCfgAccessTokenLabel',
    meaning: 'secCfgAccessTokenMeaning',
    unit: 'secCfgUnitMinutes',
  },
  {
    field: 'refreshTokenTtlDays',
    label: 'secCfgRefreshTokenLabel',
    meaning: 'secCfgRefreshTokenMeaning',
    unit: 'secCfgUnitDays',
  },
  {
    field: 'stepUpMaxAgeMinutes',
    label: 'secCfgStepUpLabel',
    meaning: 'secCfgStepUpMeaning',
    unit: 'secCfgUnitMinutes',
  },
  {
    field: 'maxFailedLoginAttempts',
    label: 'secCfgFailedAttemptsLabel',
    meaning: 'secCfgFailedAttemptsMeaning',
    unit: 'secCfgUnitAttempts',
  },
  {
    field: 'lockoutMinutes',
    label: 'secCfgLockoutLabel',
    meaning: 'secCfgLockoutMeaning',
    unit: 'secCfgUnitMinutes',
  },
];

export function OfficeSecurityConfiguration() {
  const { user } = useAuth();
  const { t, tPlural } = useLanguage();
  const canRead = hasPermission(user, 'security-config.read');

  const [config, setConfig] = useState<SecurityConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setConfig(await getSecurityConfig());
      setLoadError(null);
    } catch (err) {
      setConfig(null);
      setLoadError(err instanceof ApiError ? err.message : t('secCfgLoadError'));
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
    <section style={{ marginTop: '2rem' }} data-testid="office-security-config">
      <h2>{t('secCfgHeading')}</h2>

      {loadError && (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      )}

      {config == null ? (
        loadError ? null : (
          <p>{t('secCfgLoading')}</p>
        )
      ) : (
        <dl style={{ margin: '0.75rem 0 0', maxWidth: '44rem' }}>
          {FIELDS.map(({ field, label, meaning, unit }) => (
            <div key={field} style={row} data-security-config-field={field}>
              <dt style={labelStyle}>{t(label)}</dt>
              {/*
                * The number NEVER renders bare and never renders our column name: the unit is part
                * of the value, selected by CLDR category so Arabic noun agreement follows the
                * figure rather than being frozen at one form.
                */}
              <dd style={{ ...valueStyle, margin: 0 }} data-security-config-value={field}>
                {tPlural(unit, config[field])}
              </dd>
              <dd style={meaningStyle}>{t(meaning)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
