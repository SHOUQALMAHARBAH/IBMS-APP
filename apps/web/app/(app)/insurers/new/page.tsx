'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  registerInsurer,
  STRUCTURE_LABEL_KEY,
  type InsurerStructure,
  type RegisterInsurerInput,
} from '../../../../lib/insurer/insurer-api';
import {
  listInsurerMasters,
  type InsurerMaster,
} from '../../../../lib/insurer/insurer-master-api';
import {
  listInsuranceLines,
  type InsuranceLine,
} from '../../../../lib/insurer/insurance-line-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import {
  fieldStyle,
  formRowStyle,
  pageStyle,
  sectionStyle,
} from '../../../../components/lead/lead.styles';
import { hasPermission } from '../../../../lib/auth/permissions';
import { useLanguage } from '../../../../lib/i18n/language-context';

const STRUCTURES: readonly InsurerStructure[] = [
  'CONVENTIONAL',
  'TAKAFUL',
  'TAKAFUL_WINDOW',
];

/**
 * Registering an insurer, by either identity path.
 *
 * ## The two paths are a RADIO, not two forms and not two optional fields
 *
 * The API accepts exactly one of `insurerMasterId` or (`legalName` + `legalNameAr`), and refuses
 * both-or-neither with a 422 naming which. A form with both sets of fields always visible would let
 * someone fill in both and only find out on submit. A radio makes the invalid combination
 * unexpressible, which is the same reason `RegisterInsurerInput` is a union type rather than a bag
 * of optional fields.
 *
 * ## Why the catalogue path can be unavailable
 *
 * The picker needs `insurer.master.read`. A user who holds `insurer.create` without it
 * can still register locally — which is the path that needs no catalogue — so a 403 on the
 * catalogue disables that half and says so, rather than failing the whole screen.
 */
export default function RegisterInsurerPage() {
  const { t, language } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canRegister = !!user && hasPermission(user, 'insurer.create');

  const [path, setPath] = useState<'MASTER' | 'LOCAL'>('MASTER');
  const [masters, setMasters] = useState<InsurerMaster[] | null>(null);
  const [lines, setLines] = useState<InsuranceLine[]>([]);

  const [insurerMasterId, setInsurerMasterId] = useState('');
  const [legalName, setLegalName] = useState('');
  const [legalNameAr, setLegalNameAr] = useState('');
  const [structure, setStructure] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [companyWebsite, setCompanyWebsite] = useState('');
  const [companyCorrespondenceAddress, setCompanyCorrespondenceAddress] = useState('');
  const [lineIds, setLineIds] = useState<string[]>([]);
  const [creditTermsDays, setCreditTermsDays] = useState('');
  const [financialStrengthRating, setFinancialStrengthRating] = useState('');
  const [rfqContactName, setRfqContactName] = useState('');
  const [rfqContactEmail, setRfqContactEmail] = useState('');
  const [claimsContactName, setClaimsContactName] = useState('');
  const [claimsContactEmail, setClaimsContactEmail] = useState('');

  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [ms, ls] = await Promise.all([
      // `null` distinguishes "not allowed to see the catalogue" from "the catalogue is empty" —
      // the first disables the path and explains why, the second is just a short list.
      listInsurerMasters().catch(() => null),
      listInsuranceLines().catch(() => [] as InsuranceLine[]),
    ]);
    setMasters(ms);
    setLines(ls);
    if (ms === null) setPath('LOCAL');
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      // Built as the union's two shapes, so the "both paths" combination the API refuses cannot be
      // constructed here at all.
      const identity: Pick<
        RegisterInsurerInput,
        'insurerMasterId' | 'legalName' | 'legalNameAr'
      > =
        path === 'MASTER'
          ? { insurerMasterId: insurerMasterId.trim() }
          : { legalName: legalName.trim(), legalNameAr: legalNameAr.trim() };

      const created = await registerInsurer({
        ...identity,
        structure: structure as InsurerStructure,
        companyPhone: companyPhone.trim(),
        companyEmail: companyEmail.trim(),
        ...(companyWebsite.trim() ? { companyWebsite: companyWebsite.trim() } : {}),
        ...(companyCorrespondenceAddress.trim()
          ? { companyCorrespondenceAddress: companyCorrespondenceAddress.trim() }
          : {}),
        ...(lineIds.length ? { lineIds } : {}),
        ...(creditTermsDays.trim()
          ? { creditTermsDays: Number(creditTermsDays.trim()) }
          : {}),
        ...(financialStrengthRating.trim()
          ? { financialStrengthRating: financialStrengthRating.trim() }
          : {}),
        ...(rfqContactName.trim() ? { rfqContactName: rfqContactName.trim() } : {}),
        ...(rfqContactEmail.trim() ? { rfqContactEmail: rfqContactEmail.trim() } : {}),
        ...(claimsContactName.trim()
          ? { claimsContactName: claimsContactName.trim() }
          : {}),
        ...(claimsContactEmail.trim()
          ? { claimsContactEmail: claimsContactEmail.trim() }
          : {}),
      } as RegisterInsurerInput);
      router.push(`/insurers/${created.id}`);
    } catch (err) {
      // The API's own message is shown verbatim for a 409 and a 422: it names WHICH uniqueness was
      // refused ("already registered from the catalogue" vs "already registered locally under a
      // name that matches"), and a generic "could not save" would throw away the only sentence
      // that tells the administrator what to do next.
      setFormError(err instanceof ApiError ? err.message : t('insNewError'));
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;
  if (!canRegister)
    return (
      <main style={pageStyle}>
        <h1>{t('insNewHeading')}</h1>
        <p role="alert" style={errorStyle}>
          {t('insNewNoPermission')}
        </p>
      </main>
    );

  return (
    <main style={pageStyle}>
      <h1>{t('insNewHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>{t('insNewIntro')}</p>

      <form onSubmit={submit}>
        <fieldset style={sectionStyle}>
          <legend>{t('insNewPathLabel')}</legend>
          <label style={{ marginInlineEnd: '1rem' }}>
            <input
              type="radio"
              name="identityPath"
              value="MASTER"
              checked={path === 'MASTER'}
              disabled={masters === null}
              onChange={() => setPath('MASTER')}
            />{' '}
            {t('insNewPathMaster')}
          </label>
          <label>
            <input
              type="radio"
              name="identityPath"
              value="LOCAL"
              checked={path === 'LOCAL'}
              onChange={() => setPath('LOCAL')}
            />{' '}
            {t('insNewPathLocal')}
          </label>
          {masters === null ? (
            <p style={{ color: 'var(--ink-secondary)', fontSize: '0.85rem' }}>
              {t('insNewMasterUnavailable')}
            </p>
          ) : null}

          {path === 'MASTER' ? (
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {t('insNewMasterLabel')}
              <select
                aria-label={t('insNewMasterLabel')}
                value={insurerMasterId}
                onChange={(e) => setInsurerMasterId(e.target.value)}
                required
              >
                <option value="">{t('insNewMasterChoose')}</option>
                {(masters ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {language === 'AR' ? (m.legalNameAr ?? m.legalName) : m.legalName}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div style={formRowStyle}>
              <label style={fieldStyle}>
                {t('insNewLegalNameLabel')}
                <input
                  aria-label={t('insNewLegalNameLabel')}
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  required
                />
              </label>
              <label style={fieldStyle}>
                {t('insNewLegalNameArLabel')}
                <input
                  aria-label={t('insNewLegalNameArLabel')}
                  value={legalNameAr}
                  onChange={(e) => setLegalNameAr(e.target.value)}
                  required
                />
              </label>
            </div>
          )}
        </fieldset>

        <fieldset style={sectionStyle}>
          <legend>{t('insNewCompanyHeading')}</legend>
          <p style={{ color: 'var(--ink-secondary)', fontSize: '0.85rem' }}>
            {t('insNewCompanyIntro')}
          </p>
          <div style={formRowStyle}>
            <label style={fieldStyle}>
              {t('insNewStructureLabel')}
              <select
                aria-label={t('insNewStructureLabel')}
                value={structure}
                onChange={(e) => setStructure(e.target.value)}
                required
              >
                <option value="">{t('insNewStructureChoose')}</option>
                {STRUCTURES.map((s) => (
                  <option key={s} value={s}>
                    {t(STRUCTURE_LABEL_KEY[s])}
                  </option>
                ))}
              </select>
            </label>
            <label style={fieldStyle}>
              {t('insNewPhoneLabel')}
              <input
                aria-label={t('insNewPhoneLabel')}
                value={companyPhone}
                onChange={(e) => setCompanyPhone(e.target.value)}
                required
              />
            </label>
            <label style={fieldStyle}>
              {t('insNewEmailLabel')}
              <input
                type="email"
                aria-label={t('insNewEmailLabel')}
                value={companyEmail}
                onChange={(e) => setCompanyEmail(e.target.value)}
                required
              />
            </label>
          </div>
          <div style={formRowStyle}>
            <label style={fieldStyle}>
              {t('insNewWebsiteLabel')}
              <input
                aria-label={t('insNewWebsiteLabel')}
                value={companyWebsite}
                onChange={(e) => setCompanyWebsite(e.target.value)}
              />
            </label>
            <label style={fieldStyle}>
              {t('insNewAddressLabel')}
              <input
                aria-label={t('insNewAddressLabel')}
                value={companyCorrespondenceAddress}
                onChange={(e) => setCompanyCorrespondenceAddress(e.target.value)}
              />
            </label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {t('insLinesLabel')}
            {/* Multi-select rather than a chip picker: the API takes ONE array of ids mixing
                catalogue lines and this office's own additions, because whether a line came from
                the standard 32 is our data model and not a distinction the person picking should
                have to make. */}
            <select
              multiple
              aria-label={t('insLinesLabel')}
              data-lines-picker=""
              value={lineIds}
              onChange={(e) =>
                setLineIds(
                  Array.from(e.target.selectedOptions).map((o) => o.value),
                )
              }
              size={6}
            >
              {lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {language === 'AR' ? l.nameAr : l.nameEn}
                  {l.isStandard ? '' : ` · ${t('insOfficeLineBadge')}`}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset style={sectionStyle}>
          <legend>{t('insNewRelationshipHeading')}</legend>
          <p style={{ color: 'var(--ink-secondary)', fontSize: '0.85rem' }}>
            {t('insNewRelationshipIntro')}
          </p>
          <div style={formRowStyle}>
            <label style={fieldStyle}>
              {t('insNewCreditTermsLabel')}
              <input
                aria-label={t('insNewCreditTermsLabel')}
                value={creditTermsDays}
                onChange={(e) => setCreditTermsDays(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <label style={fieldStyle}>
              {t('insNewRatingLabel')}
              <input
                aria-label={t('insNewRatingLabel')}
                value={financialStrengthRating}
                onChange={(e) => setFinancialStrengthRating(e.target.value)}
              />
            </label>
          </div>
          <div style={formRowStyle}>
            <label style={fieldStyle}>
              {t('insNewRfqContactLabel')}
              <input
                aria-label={t('insNewRfqContactLabel')}
                value={rfqContactName}
                onChange={(e) => setRfqContactName(e.target.value)}
              />
            </label>
            <label style={fieldStyle}>
              {t('insNewRfqEmailLabel')}
              <input
                type="email"
                aria-label={t('insNewRfqEmailLabel')}
                value={rfqContactEmail}
                onChange={(e) => setRfqContactEmail(e.target.value)}
              />
            </label>
          </div>
          <div style={formRowStyle}>
            <label style={fieldStyle}>
              {t('insNewClaimsContactLabel')}
              <input
                aria-label={t('insNewClaimsContactLabel')}
                value={claimsContactName}
                onChange={(e) => setClaimsContactName(e.target.value)}
              />
            </label>
            <label style={fieldStyle}>
              {t('insNewClaimsEmailLabel')}
              <input
                type="email"
                aria-label={t('insNewClaimsEmailLabel')}
                value={claimsContactEmail}
                onChange={(e) => setClaimsContactEmail(e.target.value)}
              />
            </label>
          </div>
        </fieldset>

        {formError ? (
          <p role="alert" style={errorStyle}>
            {formError}
          </p>
        ) : null}

        <button type="submit" disabled={busy}>
          {busy ? t('insNewSavingButton') : t('insNewSubmitButton')}
        </button>
      </form>
    </main>
  );
}
