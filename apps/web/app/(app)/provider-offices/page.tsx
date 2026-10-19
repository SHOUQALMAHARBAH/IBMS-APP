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
import {
  inviteOrganizationAdministrator,
  invitePermissionFor,
  type InvitableOrganizationType,
} from '../../../lib/provider/administrator-invitation-api';

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
 *
 * ## BATCH 5 — IT CARRIES REGISTERED INSURANCE COMPANIES NOW, AND THAT NEEDED A FOURTH STATE
 *
 * The view's filter widened from `BROKERAGE_OFFICE` to the two registered types, so that item (و)'s
 * invite control could live on the organization row for both. An insurance company has no broker
 * licence BY NATURE, and the mapper turns that into `isCurrentlyLapsed === null` — which for an
 * office means "no term on record" and blocks new business under art. 21/a/9.
 *
 * Rendered unbranched, this screen would report a registered insurance company as being in
 * regulatory default. That is the SAME false finding the `BROKERAGE_OFFICE` filter was added to
 * prevent, moved one type over. So the licence cells branch on `organizationType`, which the view
 * already carries, and `provider-offices.spec.ts` asserts both halves: a company row carries no
 * licence notice, and an office with no term still does.
 *
 * ## ITEM (و) — THE WAY IN
 *
 * The invite routes were correct, gated and proven over HTTP for two batches, and NOTHING IN THE WEB
 * APP CALLED EITHER. Measured on dev: three organizations held zero users and the only way to know
 * was to query the database. So the row now SAYS whether an organization has an account, and offers
 * the invitation where it does not.
 *
 * It is a control on the row rather than a destination, because it acts on one organization the
 * reader is already looking at — unlike `/provider-register-office`, which creates a tenant.
 *
 * NO PERMISSION CODE WAS ADDED. Each type's existing code gates its own route, both are
 * `scope: PLATFORM`, and MEASURED on dev each is held by `PLATFORM_OPERATOR` in the `provider`
 * organization and by no other role in any organization. The control is shown per row against the
 * code for THAT row's type, so a reader who could invite an office but not a company sees exactly
 * the rows they can act on.
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

  /*
   * ITEM (و)'s FORM STATE. One row at a time: `inviteFor` is the organization being invited, or
   * null. Opening a second row closes the first, so there is never a half-filled form behind
   * another one — and the reason field, which the server requires at ten characters, cannot be
   * carried accidentally from one organization to the next.
   */
  const [inviteFor, setInviteFor] = useState<ProviderOfficeState | null>(null);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteDone, setInviteDone] = useState<string | null>(null);

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

  const openInvite = useCallback((organization: ProviderOfficeState) => {
    setInviteFor(organization);
    setEmail('');
    setFullName('');
    setReason('');
    setInviteError(null);
    setInviteDone(null);
  }, []);

  /*
   * THE REASON FLOOR IS CHECKED HERE TOO, and that is not duplication for its own sake: the server
   * refuses below ten characters with a 400, and a screen that sends a request it already knows
   * will be refused teaches the reader that the system is unreliable. The server stays the
   * authority — this only stops the pointless round trip.
   */
  const reasonTooShort = reason.trim().length < 10;

  const submitInvite = useCallback(
    async (organization: ProviderOfficeState) => {
      setSending(true);
      setInviteError(null);
      setInviteDone(null);
      try {
        const result = await inviteOrganizationAdministrator(
          organization.organizationType as InvitableOrganizationType,
          organization.organizationId,
          { email: email.trim(), fullName: fullName.trim(), reason: reason.trim() },
        );
        setInviteDone(
          t('providerOfficesInviteDone', {
            email: result.email,
            roleName: result.roleName,
          }),
        );
        setInviteFor(null);
        // The row's own account count is what the reader came to change, so the table is re-read
        // rather than patched in place: a hand-incremented count would disagree with the server the
        // moment anything else about that organization moved.
        await load();
      } catch (err) {
        setInviteError(
          err instanceof ApiError
            ? err.message
            : t('providerOfficesInviteFailed'),
        );
      } finally {
        setSending(false);
      }
    },
    [email, fullName, reason, t, load],
  );

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
              <th style={cell}>{t('providerOfficesColAdministrator')}</th>
            </tr>
          </thead>
          <tbody>
            {offices.map((office) => {
              // Read once per row: the licence cells, the branch counts and the invite code all
              // depend on it, and three separate comparisons are three chances to disagree.
              const isOffice = office.organizationType === 'BROKERAGE_OFFICE';
              const canInvite =
                !!user &&
                hasPermission(
                  user,
                  invitePermissionFor(
                    office.organizationType as InvitableOrganizationType,
                  ),
                );
              return (
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
                  {isOffice
                    ? (office.licenseNumber ?? t('providerOfficesNoLicence'))
                    : '—'}
                </td>
                <td style={cell}>{isOffice ? day(office.licenseExpiresAt) : '—'}</td>
                <td style={cell} data-standing={office.subdomain}>
                  {/* FOUR states now. For an OFFICE: three, and `null` means no term on record,
                      which blocks new business under art. 21/a/9 and is a different fact from a
                      lapsed licence. For an INSURANCE COMPANY: NONE OF THEM — a company has no
                      broker licence by nature, so rendering the office states here would report a
                      registered company as being in regulatory default. That is the false finding
                      the view's old BROKERAGE_OFFICE filter existed to prevent. */}
                  {!isOffice
                    ? t('providerOfficesLicenceNotApplicable')
                    : office.isCurrentlyLapsed === null
                      ? t('providerOfficesNoTermOnRecord')
                      : office.isCurrentlyLapsed
                        ? t('providerOfficesLapsed')
                        : t('providerOfficesInGoodStanding')}
                </td>
                <td style={cell} data-branches={office.subdomain}>
                  {/* The dormant figure beside the total, never instead of it: "3 dormant" means
                      nothing without knowing of how many. Blank for a company: these count the
                      BROKER licence's scope lines, and "0 (0 with no business)" would read as a
                      finding about a company that cannot have any. */}
                  {isOffice
                    ? t('providerOfficesBranchesValue', {
                        total: String(office.licensedBranches),
                        dormant: String(office.dormantLicensedBranches),
                      })
                    : '—'}
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
                <td style={cell} data-administrator={office.subdomain}>
                  {/* THE INVITATION STATE, which was previously answerable only by querying the
                      database. `users > 0` is the honest test: the invite route itself refuses once
                      the organization has ANY account, so "has an account" and "cannot be invited"
                      are the same fact and must not be two different sentences. */}
                  {office.users > 0 ? (
                    <span data-has-administrator={office.subdomain}>
                      {t('providerOfficesHasAdministrator')}
                    </span>
                  ) : (
                    <>
                      <span data-no-account={office.subdomain}>
                        {t('providerOfficesNoAccountYet')}
                      </span>
                      {/* A control a reader cannot use does not exist on their screen. */}
                      {canInvite ? (
                        <>
                          {' '}
                          <button
                            type="button"
                            data-invite-open={office.subdomain}
                            onClick={() =>
                              inviteFor?.organizationId === office.organizationId
                                ? setInviteFor(null)
                                : openInvite(office)
                            }
                          >
                            {inviteFor?.organizationId === office.organizationId
                              ? t('providerOfficesInviteCancel')
                              : t('providerOfficesInviteOpen')}
                          </button>
                        </>
                      ) : null}
                    </>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {inviteDone ? (
        <p role="status" style={bannerStyle} data-invite-done="">
          {inviteDone}
        </p>
      ) : null}

      {inviteFor ? (
        <section data-invite-form={inviteFor.subdomain} style={bannerStyle}>
          <h2>{t('providerOfficesInviteHeading')}</h2>
          <p>
            <bdi>
              {language === 'AR'
                ? (inviteFor.legalNameAr ?? inviteFor.legalName)
                : inviteFor.legalName}
            </bdi>
          </p>

          {/*
            THE LINE OF HONESTY, and it is shown BEFORE the fields rather than after the button.
            An invited insurance-company administrator can reach `/company-record` and the one
            destination shared with a brokerage office, and nothing else — no RFQ inbox, no pricing,
            no issuance, because those are the gateway and the gateway is a separate module that is
            not built. Saying so at the point of inviting is the difference between a provider who
            knows what they are handing over and one who finds out from the company.
          */}
          {inviteFor.organizationType === 'INSURANCE_COMPANY' ? (
            <p role="note" style={warningStyle} data-invite-company-limit="">
              {t('providerOfficesInviteCompanyLimitNote')}
            </p>
          ) : null}

          {/* Two guarantees the reader is entitled to see before typing a colleague's name into a
              form that creates an account in somebody else's organization. */}
          <p role="note" style={warningStyle} data-invite-no-password="">
            {t('providerOfficesInviteNoPasswordNote')}
          </p>
          <p role="note" style={warningStyle} data-invite-not-licensing="">
            {t('providerOfficesInviteNotLicensingNote')}
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                await submitInvite(inviteFor);
              })();
            }}
          >
            <p>
              <label>
                <span>{t('providerOfficesInviteEmailLabel')}</span>{' '}
                <input
                  type="email"
                  required
                  value={email}
                  data-invite-email=""
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            </p>
            <p>
              <label>
                <span>{t('providerOfficesInviteNameLabel')}</span>{' '}
                <input
                  type="text"
                  required
                  value={fullName}
                  data-invite-name=""
                  onChange={(e) => setFullName(e.target.value)}
                />
              </label>
            </p>
            <p>
              <label>
                <span>{t('providerOfficesInviteReasonLabel')}</span>{' '}
                <textarea
                  required
                  value={reason}
                  data-invite-reason=""
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </p>
            {reasonTooShort && reason.length > 0 ? (
              <p role="status" data-invite-reason-short="">
                {t('providerOfficesInviteReasonTooShort')}
              </p>
            ) : null}
            <p>
              <button
                type="submit"
                data-invite-submit=""
                disabled={sending || reasonTooShort}
              >
                {sending
                  ? t('providerOfficesInviteSending')
                  : t('providerOfficesInviteSubmit')}
              </button>
            </p>
          </form>

          {inviteError ? (
            <p role="alert" style={errorStyle} data-invite-error="">
              {inviteError}
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
