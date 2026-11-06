'use client';

import { useState } from 'react';
import { Button, Field, Select, TextInput } from '../ui';
import {
  STRUCTURE_LABEL_KEY,
  updateInsurer,
  type Insurer,
  type InsurerStructure,
  type UpdateInsurerInput,
} from '../../lib/insurer/insurer-api';
import type { InsuranceLine } from '../../lib/insurer/insurance-line-api';
import { ApiError } from '../../lib/auth/api-client';
import { useLanguage } from '../../lib/i18n/language-context';
import { sectionStyle } from '../lead/lead.styles';
import { editActionsStyle, editIntroStyle } from './insurer.styles';

/**
 * CORRECTING AN INSURER RECORD — the first and only caller of `updateInsurer`.
 *
 * ## The defect this closes, measured rather than argued
 *
 * `updateInsurer` has existed, with its route and its permission, and NOTHING in `apps/web` called
 * it. So the office could not edit an insurer record at all. The sharpest consequence was already
 * recorded on the detail page beside the rating: `clearFinancialStrengthRating` could remove the
 * office's own solvency judgement and no screen could put one back — a one-way door on a field that
 * feeds placement decisions.
 *
 * Both reachability gates counted `PATCH /insurers/:id` as REACHED the whole time, because each reads
 * the path and verb out of every resolvable client call including the one inside the helper's own
 * declaration. That blind spot is a declared number in both gates now (`dead_helpers.py`), and this
 * panel is what takes this route out of it.
 *
 * ## Why it is a panel on `/insurers/[id]` and not `/insurers/[id]/edit`
 *
 * Because a new route needs a page heading and an intro, and no Arabic for either ships. The standing
 * rule is that no Arabic word is invented — it is sliced from a string already shipping, or it is the
 * owner's. In place, the panel reuses THE DETAIL VIEW'S OWN labels verbatim — the same words the
 * reader saw a moment before pressing Edit — falling back to `/insurers/new`'s only where the detail
 * view has none (the two legal names, the two contact e-mails, the rating's as-of date), plus
 * `commonEdit`, `commonSave` and `commonCancel`. **This screen adds no new string in either
 * language.** A separate route would have required asking for two sentences to deliver a control
 * whose words already existed.
 *
 * CORRECTED while building: the first version borrowed `/insurers/new`'s labels throughout, which
 * pointed ONE label at TWO fields twice over (`insNewPhoneLabel` at both phone numbers,
 * `insNewRfqContactLabel` at both the RFQ contact and the underwriter desk). Playwright's strict
 * mode caught it as a `getByLabel` resolving to two inputs. Reusing a label is only free where the
 * two fields are the same fact — see the omitted `rfqContactPhone` below for the case where they are
 * not.
 *
 * It also inherits the detail page's loading, error and permission scaffolding rather than restating
 * it, and reuses `insurer.update` — the code the clear control beside it already asks for. No role is
 * granted anything.
 *
 * ## IT SENDS A DIFF, AND THE REASON IS THE DTO
 *
 * Only fields whose trimmed value actually CHANGED are sent. Not an optimisation: `UpdateInsurerDto`
 * validates each optional field when present, so `companyEmail: ''` is a 400 from `@IsEmail()` and
 * `companyWebsite: ''` a 400 from `@IsUrl()`. Sending the whole form would therefore refuse any
 * record with a blank optional field — i.e. almost all of them.
 *
 * THE COST, STATED: an empty draft is read as "unchanged", so this panel can SET and CHANGE an
 * optional field and cannot CLEAR one. That is a gap in the WIRE rather than in this screen — there
 * is no value `UpdateInsurerDto` accepts as "remove this" — and inventing a convention for it (a
 * sentinel, or `null`) is an API decision, not a screen's. The one field that genuinely needs
 * clearing already has its own control: `DELETE :id/financial-strength-rating`, which removes the
 * rating and its date together.
 *
 * ## THE RATING AND ITS DATE MOVE TOGETHER, enforced here as well as in the database
 *
 * `Insurer_rating_carries_its_date` is a CHECK — both columns or neither — and it is about the MERGED
 * row after a PATCH, which is why the DTO cannot express it and `InsurerService` re-checks it. The
 * form-level twin is the mutual `required` below: typing one makes the other required, so the refusal
 * that names both fields is unreachable from this screen rather than merely survivable.
 */

/** Every scalar this panel edits, as strings — a form holds text, not numbers. */
interface Draft {
  legalName: string;
  legalNameAr: string;
  structure: string;
  companyPhone: string;
  companyEmail: string;
  companyWebsite: string;
  companyCorrespondenceAddress: string;
  rfqContactName: string;
  rfqContactEmail: string;
  claimsContactName: string;
  claimsContactEmail: string;
  underwriterContact: string;
  creditTermsDays: string;
  financialStrengthRating: string;
  financialStrengthRatingAsOf: string;
}

function draftFrom(insurer: Insurer): Draft {
  return {
    // The company's own name. `name`/`nameAr` are what the detail page renders; the PATCH field
    // names are `legalName`/`legalNameAr`, which is the same fact under the wire's own spelling.
    legalName: insurer.name ?? '',
    legalNameAr: insurer.nameAr ?? '',
    structure: insurer.structure ?? '',
    companyPhone: insurer.companyPhone ?? '',
    companyEmail: insurer.companyEmail ?? '',
    companyWebsite: insurer.companyWebsite ?? '',
    companyCorrespondenceAddress: insurer.companyCorrespondenceAddress ?? '',
    rfqContactName: insurer.rfqContactName ?? '',
    rfqContactEmail: insurer.rfqContactEmail ?? '',
    claimsContactName: insurer.claimsContactName ?? '',
    claimsContactEmail: insurer.claimsContactEmail ?? '',
    underwriterContact: insurer.underwriterContact ?? '',
    creditTermsDays:
      insurer.creditTermsDays === null ? '' : String(insurer.creditTermsDays),
    financialStrengthRating: insurer.financialStrengthRating ?? '',
    financialStrengthRatingAsOf:
      insurer.financialStrengthRatingAsOf === null
        ? ''
        : insurer.financialStrengthRatingAsOf.slice(0, 10),
  };
}

const STRUCTURES: InsurerStructure[] = [
  'CONVENTIONAL',
  'TAKAFUL',
  'TAKAFUL_WINDOW',
];

export function InsurerEditPanel({
  insurer,
  lines,
  onSaved,
  onCancel,
}: {
  insurer: Insurer;
  lines: InsuranceLine[];
  onSaved: (updated: Insurer) => void;
  onCancel: () => void;
}) {
  const { t, language } = useLanguage();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(insurer));
  const [lineIds, setLineIds] = useState<string[]>(() =>
    insurer.linesOffered.map((l) => l.id),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Draft>(key: K) => (value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const original = draftFrom(insurer);
  const originalLineIds = insurer.linesOffered.map((l) => l.id);

  /* The rating and its date are mutually required — the form-level twin of the database CHECK. */
  const ratingTyped = draft.financialStrengthRating.trim() !== '';
  const asOfTyped = draft.financialStrengthRatingAsOf.trim() !== '';

  function changedPayload(): UpdateInsurerInput {
    const body: Record<string, unknown> = {};
    for (const key of Object.keys(draft) as (keyof Draft)[]) {
      const next = draft[key].trim();
      // Unchanged, or blanked — see the diff note in the header: there is no wire value meaning
      // "remove this", so a blank draft is read as "leave it alone" rather than silently 400ing.
      if (next === '' || next === original[key].trim()) continue;
      if (key === 'creditTermsDays') {
        const parsed = Number(next);
        if (!Number.isFinite(parsed)) continue;
        body[key] = parsed;
        continue;
      }
      body[key] = next;
    }
    const sameLines =
      lineIds.length === originalLineIds.length &&
      lineIds.every((id) => originalLineIds.includes(id));
    // An EMPTY selection is sent, unlike an empty text field: `lineIds: []` is a value the DTO
    // accepts and it means "this insurer offers none", which is a real state an office may record.
    if (!sameLines) body.lineIds = lineIds;
    return body as UpdateInsurerInput;
  }

  const payload = changedPayload();
  const nothingChanged = Object.keys(payload).length === 0;

  function submit() {
    setSaving(true);
    setError(null);
    void (async () => {
      try {
        onSaved(await updateInsurer(insurer.id, payload));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('insNewError'));
      } finally {
        setSaving(false);
      }
    })();
  }

  const textField = (
    key: keyof Draft,
    labelKey: Parameters<typeof t>[0],
    type?: string,
  ) => (
    <Field label={t(labelKey)}>
      {(props) => (
        <TextInput
          {...props}
          type={type}
          value={draft[key]}
          onChange={(e) => set(key)(e.target.value)}
        />
      )}
    </Field>
  );

  return (
    <form
      style={sectionStyle}
      data-insurer-edit-panel=""
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2>{t('insDetailCompanyHeading')}</h2>

      {textField('legalName', 'insNewLegalNameLabel')}
      {textField('legalNameAr', 'insNewLegalNameArLabel')}

      <Field label={t('insDetailStructureLabel')}>
        {(props) => (
          <Select
            {...props}
            value={draft.structure}
            onChange={(e) => set('structure')(e.target.value)}
          >
            <option value="">{t('insNewStructureChoose')}</option>
            {STRUCTURES.map((s) => (
              <option key={s} value={s}>
                {t(STRUCTURE_LABEL_KEY[s])}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {textField('companyPhone', 'insDetailPhoneLabel')}
      {textField('companyEmail', 'insDetailEmailLabel', 'email')}
      {textField('companyWebsite', 'insDetailWebsiteLabel')}
      {textField('companyCorrespondenceAddress', 'insDetailAddressLabel')}

      <Field label={t('insLinesLabel')}>
        {(props) => (
          <Select
            {...props}
            multiple
            size={6}
            data-lines-picker=""
            value={lineIds}
            onChange={(e) =>
              setLineIds(
                Array.from(
                  (e.target as unknown as HTMLSelectElement).selectedOptions,
                ).map((o) => o.value),
              )
            }
          >
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {language === 'AR' ? l.nameAr : l.nameEn}
                {l.isStandard ? '' : ` · ${t('insOfficeLineBadge')}`}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <h2>{t('insDetailRelationshipHeading')}</h2>
      <p style={editIntroStyle}>
        {t('insDetailRelationshipNote')}
      </p>

      {/*
        `rfqContactPhone` IS DELIBERATELY NOT HERE, and the reason is that it has no label.
        Measured: `/insurers/new` does not collect it (0 occurrences) and the detail view above does
        not render it, so no string names that field in either language. The api accepts it; the
        product has never had a word for it.

        Borrowing `insDetailPhoneLabel` is what the first version did, and a Playwright strict-mode
        violation killed it — `getByLabel('Company phone')` matched two inputs, which is the real
        defect rather than a test problem: two different fields wearing one visible label leaves the
        reader unable to tell which phone number they are editing. Inventing a word is forbidden, so
        the field is omitted and recorded. It needs one word from the owner.
      */}
      {textField('rfqContactName', 'insDetailRfqContactLabel')}
      {textField('rfqContactEmail', 'insNewRfqEmailLabel', 'email')}
      {textField('claimsContactName', 'insDetailClaimsContactLabel')}
      {textField('claimsContactEmail', 'insNewClaimsEmailLabel', 'email')}
      {textField('underwriterContact', 'insDetailUnderwriterLabel')}
      {textField('creditTermsDays', 'insDetailCreditTermsLabel', 'number')}

      {/*
        MUTUALLY REQUIRED, which is what makes the database CHECK unreachable from here. A native
        `required` also FOCUSES the offending control when the submit is blocked, so the refusal is
        pointed at the field rather than reported as a sentence somewhere else on the page.
      */}
      <Field label={t('insDetailRatingLabel')} required={asOfTyped}>
        {(props) => (
          <TextInput
            {...props}
            required={asOfTyped}
            data-insurer-rating-input=""
            value={draft.financialStrengthRating}
            onChange={(e) => set('financialStrengthRating')(e.target.value)}
          />
        )}
      </Field>
      <Field label={t('insNewRatingAsOfLabel')} required={ratingTyped}>
        {(props) => (
          <TextInput
            {...props}
            type="date"
            required={ratingTyped}
            data-insurer-rating-as-of-input=""
            value={draft.financialStrengthRatingAsOf}
            onChange={(e) =>
              set('financialStrengthRatingAsOf')(e.target.value)
            }
          />
        )}
      </Field>

      {error !== null ? (
        <p role="alert" data-insurer-edit-error="">
          {error}
        </p>
      ) : null}

      <div style={editActionsStyle}>
        <Button
          type="submit"
          variant="primary"
          disabled={saving || nothingChanged}
          data-insurer-edit-save=""
        >
          {saving ? t('insNewSavingButton') : t('commonSave')}
        </Button>
        <Button type="button" onClick={onCancel} disabled={saving}>
          {t('commonCancel')}
        </Button>
      </div>
    </form>
  );
}
