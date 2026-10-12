'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import { ApiError } from '../../../lib/auth/api-client';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import {
  listProviderOffices,
  type ProviderOfficeState,
} from '../../../lib/compliance-risk/provider-offices-api';

/**
 * MODULE 0 ITEM (j) — THE PROVIDER DASHBOARD.
 *
 * Every brokerage office on the platform and its state: licence, expiry, whether that licence still
 * lets it place business, how many licensed branches carry no business, user counts, and when the
 * office was last used.
 *
 * ## It says out loud that it crosses offices
 *
 * The banner is not decoration. Every other screen in this product shows the reader's OWN office,
 * and a table that looks like the others but contains competitors' data is the kind of thing
 * somebody screenshots into an email. So the screen states what it is before the first row.
 *
 * ## The three licence states are three states
 *
 * `isCurrentlyLapsed` is `null` when an office holds NO licence term, and that is not the same as
 * lapsed: item (c) made absence BLOCK new business under art. 21/a/9, and an office with nothing on
 * record is further from compliant than one whose licence merely ran out. A screen that collapsed
 * them would tell a provider a licence lapsed when none was ever recorded.
 */

const cell: CSSProperties = {
  border: '1px solid var(--line)',
  padding: '0.4rem 0.6rem',
  textAlign: 'start',
  verticalAlign: 'top',
};

const bannerStyle: CSSProperties = {
  border: '1px solid var(--line)',
  padding: '0.6rem 0.8rem',
  marginBottom: '1rem',
};

const warningStyle: CSSProperties = {
  border: '1px solid var(--line)',
  padding: '0.4rem 0.6rem',
};

function day(iso: string | null): string {
  return iso === null ? '—' : iso.slice(0, 10);
}

export default function ProviderOfficesPage() {
  const { t, language } = useLanguage();
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const canRead = !!user && hasPermission(user, 'provider.office-state.read');

  const [offices, setOffices] = useState<ProviderOfficeState[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  const load = useCallback(async () => {
    try {
      setOffices(await listProviderOffices());
      setLoadError(null);
    } catch (err) {
      setOffices(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(
              t,
              'providerOfficesRefusalAct',
              'provider.office-state.read',
            )
          : t('providerOfficesLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!user || !canRead) return;
    // The house async-IIFE form. `void load()` inside an effect is a lint ERROR here — everything
    // the effect does has to settle on a promise before any state is set, which is the
    // cascading-render rule this repo has already been caught by twice.
    void (async () => {
      await load();
    })();
  }, [user, canRead, load]);

  if (isLoading || !user) return null;

  // A reader without the code sees the refusal and no table. The sentence names the act and the
  // code through the one shared shape — never a hand-written "forbidden".
  if (!canRead) {
    return (
      <main style={pageStyle}>
        <h1>{t('providerOfficesHeading')}</h1>
        <p role="alert" style={errorStyle} data-provider-refusal="">
          {permissionRefusal(
            t,
            'providerOfficesRefusalAct',
            'provider.office-state.read',
          )}
        </p>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1>{t('providerOfficesHeading')}</h1>

      {/* Said BEFORE the first row. A cross-office table that looks like every other screen is the
          kind of thing somebody shares without thinking about whose data it is. */}
      <p style={bannerStyle} role="note" data-provider-cross-office="">
        {t('providerOfficesCrossOfficeNote')}
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : offices === null ? (
        <p role="status">{t('providerOfficesLoading')}</p>
      ) : offices.length === 0 ? (
        // An EMPTY state rather than an empty table: "no offices" on a platform dashboard is a
        // wrong-answer state, not a quiet nothing.
        <p role="status" style={warningStyle} data-provider-empty="">
          {t('providerOfficesEmpty')}
        </p>
      ) : (
        <table data-provider-offices="" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={cell}>{t('providerOfficesColOffice')}</th>
              <th style={cell}>{t('providerOfficesColStatus')}</th>
              <th style={cell}>{t('providerOfficesColLicence')}</th>
              <th style={cell}>{t('providerOfficesColExpiry')}</th>
              <th style={cell}>{t('providerOfficesColStanding')}</th>
              <th style={cell}>{t('providerOfficesColBranches')}</th>
              <th style={cell}>{t('providerOfficesColUsers')}</th>
              <th style={cell}>{t('providerOfficesColLastUsed')}</th>
            </tr>
          </thead>
          <tbody>
            {offices.map((office) => (
              <tr key={office.organizationId} data-office={office.subdomain}>
                <td style={cell}>
                  <bdi>
                    {language === 'AR'
                      ? (office.legalNameAr ?? office.legalName)
                      : office.legalName}
                  </bdi>
                </td>
                <td style={cell}>{office.organizationStatus}</td>
                <td style={cell}>
                  {office.licenseNumber ?? t('providerOfficesNoLicence')}
                </td>
                <td style={cell}>{day(office.licenseExpiresAt)}</td>
                <td style={cell} data-standing={office.subdomain}>
                  {/* THREE states, not two. `null` means no term on record, which blocks new
                      business under art. 21/a/9 and is a different fact from a lapsed licence. */}
                  {office.isCurrentlyLapsed === null
                    ? t('providerOfficesNoTermOnRecord')
                    : office.isCurrentlyLapsed
                      ? t('providerOfficesLapsed')
                      : t('providerOfficesInGoodStanding')}
                </td>
                <td style={cell} data-branches={office.subdomain}>
                  {/* The dormant figure beside the total, never instead of it: "3 dormant" means
                      nothing without knowing of how many. */}
                  {t('providerOfficesBranchesValue', {
                    total: String(office.licensedBranches),
                    dormant: String(office.dormantLicensedBranches),
                  })}
                </td>
                <td style={cell}>
                  {t('providerOfficesUsersValue', {
                    active: String(office.activeUsers),
                    total: String(office.users),
                  })}
                </td>
                <td style={cell}>
                  {/* An OFFICE-level maximum. Never a person's sign-in — the view cannot express
                      one, and the column heading says "office", not "user". */}
                  {office.lastActivityAt === null
                    ? t('providerOfficesNeverUsed')
                    : day(office.lastActivityAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
