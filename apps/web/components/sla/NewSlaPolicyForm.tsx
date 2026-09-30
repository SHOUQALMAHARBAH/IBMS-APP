'use client';

/*
 * Define an SLA policy — `POST /sla/policies`, which had no web caller.
 *
 * An office could edit the duration of a seeded policy and could not state a target of its own.
 * `sla.policy.create` was split out of the `sla.policy.manage` umbrella deliberately and granted
 * to three roles, and nothing could exercise it.
 *
 * ## `sourceType` is the only field here that can make a false claim
 *
 * REGULATORY means this SLA has legal force. The DTO's own comment is explicit that "recording an
 * internal target as a legal requirement is the failure this field exists to prevent", and a
 * database CHECK refuses REGULATORY without naming the instrument.
 *
 * The SERVER enforces this, on BOTH paths, since the owner's decision of 2026-09-28: creating a
 * policy already marked REGULATORY requires `sla.policy.regulatory`, exactly as changing one to
 * REGULATORY does. `SlaPolicyService.create` refuses otherwise.
 *
 * **This form is not the guard.** It offers REGULATORY only to a holder so the reader is never
 * shown a choice the server will refuse — but the guard is the service, deliberately, because
 * every office defines its own roles and a screen-only check reopens the moment anything else
 * calls the route: another screen, an import, a script. § 1.72 has the re-derivation.
 *
 * ## The form sits ABOVE the list
 *
 * B.7 rule 1. A create form below the table it adds to is a control the reader scrolls past.
 */

import { useState } from 'react';
import { ApiError } from '../../lib/auth/api-client';
import { hasPermission } from '../../lib/auth/permissions';
import { useAuth } from '../../lib/auth/auth-context';
import { useLanguage } from '../../lib/i18n/language-context';
import { errorStyle } from '../auth/auth-form.styles';
import {
  createSlaPolicy,
  type SlaDurationUnit,
  type SlaSourceType,
} from '../../lib/sla/sla-policy-api';
import { reducedCapability } from '../../lib/i18n/permission-refusal';

const DURATION_UNITS: SlaDurationUnit[] = [
  'MINUTES',
  'HOURS',
  'BUSINESS_DAYS',
  'CALENDAR_DAYS',
  'MONTHS',
];

/**
 * Every source type EXCEPT `REGULATORY`, which is added only for a caller who may assert it.
 *
 * Ordered with `INTERNAL_POLICY` first because it is the honest default: the DTO says so in as
 * many words — "if no authoritative source exists, INTERNAL_POLICY is the honest classification".
 */
const NON_REGULATORY_SOURCES: SlaSourceType[] = [
  'INTERNAL_POLICY',
  'CONTRACTUAL',
  'OPERATIONAL',
  'OTHER',
];

export function NewSlaPolicyForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useLanguage();
  const { user } = useAuth();

  const canCreate = !!user && hasPermission(user, 'sla.policy.create');
  // A SEPARATE code, checked separately. Holding the create code does not mean this person may
  // state that an SLA is a legal requirement — see the header.
  const canAssertRegulatory =
    !!user && hasPermission(user, 'sla.policy.regulatory');

  const [open, setOpen] = useState(false);
  const [policyCode, setPolicyCode] = useState('');
  const [policyName, setPolicyName] = useState('');
  const [processType, setProcessType] = useState('');
  const [workflowState, setWorkflowState] = useState('');
  const [description, setDescription] = useState('');
  const [durationValue, setDurationValue] = useState('');
  const [durationUnit, setDurationUnit] =
    useState<SlaDurationUnit>('BUSINESS_DAYS');
  const [calendarType, setCalendarType] = useState<
    'JORDAN_STANDARD' | 'CONTINUOUS_24_7'
  >('JORDAN_STANDARD');
  const [sourceType, setSourceType] =
    useState<SlaSourceType>('INTERNAL_POLICY');
  const [sourceReference, setSourceReference] = useState('');
  const [sourceDocument, setSourceDocument] = useState('');
  const [sourceSection, setSourceSection] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canCreate) return null;

  // The server refuses REGULATORY without both citations, and a database CHECK refuses it behind
  // that. Blocking here means the reader is told what is missing instead of being handed a 422.
  const citationsMissing =
    sourceType === 'REGULATORY' &&
    (sourceReference.trim() === '' || sourceDocument.trim() === '');

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await createSlaPolicy({
        policyCode: policyCode.trim().toUpperCase(),
        policyName: policyName.trim(),
        processType: processType.trim(),
        // An untouched optional field must be ABSENT, never the empty string: '' would store a
        // workflow state of "" rather than meaning "the whole process".
        workflowState: workflowState.trim() || undefined,
        description: description.trim() || undefined,
        durationValue: Number(durationValue),
        durationUnit,
        calendarType,
        sourceType,
        sourceReference: sourceReference.trim() || undefined,
        sourceDocument: sourceDocument.trim() || undefined,
        sourceSection: sourceSection.trim() || undefined,
      });
      setOpen(false);
      setPolicyCode('');
      setPolicyName('');
      setProcessType('');
      setWorkflowState('');
      setDescription('');
      setDurationValue('');
      setSourceType('INTERNAL_POLICY');
      setSourceReference('');
      setSourceDocument('');
      setSourceSection('');
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('slapCreateFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div style={{ margin: '1rem 0' }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="new-sla-policy-open"
        >
          {t('slapCreateOpen')}
        </button>
      </div>
    );
  }

  return (
    <form
      style={{ margin: '1rem 0' }}
      data-testid="new-sla-policy-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset>
        <legend>{t('slapCreateLegend')}</legend>

        <label>
          {t('slapCreateCode')}
          <input
            value={policyCode}
            onChange={(e) => setPolicyCode(e.target.value)}
            required
            data-testid="new-sla-code"
          />
        </label>
        {/* The server's pattern, stated rather than discovered through a 422. */}
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-secondary)' }}>
          {t('slapCreateCodeHint')}
        </p>

        <label>
          {t('slapCreateName')}
          <input
            value={policyName}
            onChange={(e) => setPolicyName(e.target.value)}
            required
            data-testid="new-sla-name"
          />
        </label>

        <label>
          {t('slapCreateProcess')}
          <input
            value={processType}
            onChange={(e) => setProcessType(e.target.value)}
            required
            data-testid="new-sla-process"
          />
        </label>

        <label>
          {t('slapCreateWorkflowState')}
          <input
            value={workflowState}
            onChange={(e) => setWorkflowState(e.target.value)}
            data-testid="new-sla-state"
          />
        </label>

        <label>
          {t('slapCreateDescription')}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="new-sla-description"
          />
        </label>

        <label>
          {t('slapCreateDuration')}
          <input
            type="number"
            // 0 is valid and meaningful — an SLA whose deadline is the triggering event itself.
            // `min={1}` would refuse a real policy the registry already contains.
            min={0}
            value={durationValue}
            onChange={(e) => setDurationValue(e.target.value)}
            required
            data-testid="new-sla-duration"
          />
        </label>

        <label>
          {t('slapCreateUnit')}
          <select
            value={durationUnit}
            onChange={(e) =>
              setDurationUnit(e.target.value as SlaDurationUnit)
            }
            data-testid="new-sla-unit"
          >
            {DURATION_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t('slapCreateCalendar')}
          <select
            value={calendarType}
            onChange={(e) =>
              setCalendarType(
                e.target.value as 'JORDAN_STANDARD' | 'CONTINUOUS_24_7',
              )
            }
            data-testid="new-sla-calendar"
          >
            {/* CUSTOM is absent on purpose: it needs `customWeekendDays`, and a calendar whose
                weekend nobody set would count deadlines against Jordan's by accident. */}
            <option value="JORDAN_STANDARD">{t('slapJordanWorkingDays')}</option>
            <option value="CONTINUOUS_24_7">{t('slap247')}</option>
          </select>
        </label>

        <label>
          {t('slapCreateSourceType')}
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as SlaSourceType)}
            data-testid="new-sla-source-type"
          >
            {NON_REGULATORY_SOURCES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
            {/* REGULATORY only for somebody who may assert legal force — the same code that
                gates changing an existing policy's source type. */}
            {canAssertRegulatory && (
              <option value="REGULATORY">REGULATORY</option>
            )}
          </select>
        </label>

        {!canAssertRegulatory && (
          <p
            style={{ fontSize: '0.8rem', color: 'var(--ink-secondary)' }}
            data-testid="new-sla-regulatory-note"
          >
            {reducedCapability(t, 'slapRegulatoryCanAct', 'slapRegulatoryCannotAct', 'sla.policy.regulatory')}
          </p>
        )}

        {sourceType === 'REGULATORY' && (
          <>
            <p style={errorStyle} data-testid="new-sla-regulatory-warning">
              {t('slapCreateRegulatoryWarning')}
            </p>
            <label>
              {t('slapCreateSourceReference')}
              <input
                value={sourceReference}
                onChange={(e) => setSourceReference(e.target.value)}
                data-testid="new-sla-source-reference"
              />
            </label>
            <label>
              {t('slapCreateSourceDocument')}
              <input
                value={sourceDocument}
                onChange={(e) => setSourceDocument(e.target.value)}
                data-testid="new-sla-source-document"
              />
            </label>
            <label>
              {t('slapCreateSourceSection')}
              <input
                value={sourceSection}
                onChange={(e) => setSourceSection(e.target.value)}
                data-testid="new-sla-source-section"
              />
            </label>
          </>
        )}

        {error !== null && (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        )}

        {/* A new policy is born DRAFT — activation is its own audited decision — and the form
            says so, because somebody who creates one and sees no change in behaviour will
            otherwise assume it failed. */}
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-secondary)' }}>
          {t('slapCreateBornDraft')}
        </p>

        <div style={{ marginTop: '0.5rem' }}>
          <button
            type="submit"
            disabled={busy || citationsMissing}
            data-testid="new-sla-save"
          >
            {t('slapCreateSave')}
          </button>{' '}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
          >
            {t('slapCreateCancel')}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
