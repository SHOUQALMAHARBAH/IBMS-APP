'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useLanguage } from '../../lib/i18n/language-context';
import type { TranslationKey } from '../../lib/i18n/translations';
import { listCustomers } from '../../lib/customer/customer-api';
import { listAuditActors } from '../../lib/audit-trail/audit-trail-api';
import { ENUM_LABEL } from '../../lib/i18n/enum-labels';

/**
 * FIND A NAMED THING. One control, every screen.
 *
 * ## What this replaces, and why one component rather than several
 *
 * Ten forms asked for a raw `customerId`. Nobody knows a uuid, so the only way to fill one in was to
 * open another screen and copy it out of the address bar — the field was, in practice, unusable by the
 * people it was for. `CustomerPicker` fixed that for customers and is now gone: this is the same
 * control, with the part that differs per entity moved into a SOURCE.
 *
 * The behaviour worth having in exactly one place: Enter searches without submitting the surrounding
 * form; a native `<select>` carries the ARIA roles, focus management and keyboard handling that a custom
 * combobox would have to re-implement, in both reading directions; the four states (loading, empty,
 * error, populated) each say something a person can act on; and a disambiguation line tells two
 * same-named entries apart. A second picker written by hand gets some of that and not the rest, which is
 * the whole argument against having two.
 *
 * ## What a SOURCE decides
 *
 * How to search, what to call the thing, and what to show beside a name so two of them can be told
 * apart. Nothing else. A new kind is an entry in `ENTITY_SOURCES` — no new markup, no new keyboard
 * handling, no new states.
 */
/**
 * One piece of the disambiguation line: either literal text from the record, or a key to translate.
 *
 * The split exists because of a bug the first draft had. A source that returned an already-translated
 * string had to be handed `t` at FETCH time, and the fetch runs once on mount — so the line was
 * localised in whatever language was active at first render. On this Arabic-first platform that meant an
 * English reader saw `Ahmad Al-Test — نشط · REG-1`: the status label in Arabic, because the language had
 * not resolved from `/auth/me` yet. Measured, not reasoned about.
 *
 * Translating at RENDER instead makes the option data language-free, so switching language re-renders the
 * line correctly without re-fetching and without discarding a selection already made.
 */
export type DetailPart = string | { key: TranslationKey };

export interface EntityOption {
  id: string;
  name: string;
  /** What tells two entries of the same name apart. Optional: some entities have nothing to add. */
  detail?: DetailPart[];
}

interface EntitySource {
  /**
   * `term` of `''` means "the first page, unfiltered", so the control is usable without typing
   * anything — most books are small enough that the first page IS the whole list.
   *
   * Takes no translate function, deliberately: see {@link DetailPart}.
   */
  search(term: string): Promise<EntityOption[]>;
  /** The label above the search box, e.g. "Find a customer". The CHOSEN value's label is a prop. */
  searchLabel: TranslationKey;
  placeholder: TranslationKey;
  /** The empty option, e.g. "— select a customer —". */
  none: TranslationKey;
  noMatches: TranslationKey;
  error: TranslationKey;
}

export type EntityKind = 'customer' | 'auditActor';

export const ENTITY_SOURCES: Record<EntityKind, EntitySource> = {
  /**
   * `GET /customers?search=` — bilingual full text over the legal name, expanding known
   * transliteration variants, so "Ahmad" finds "أحمد". The same search the customers list uses.
   *
   * The disambiguation line deliberately does NOT include the national ID: that column is encrypted
   * with a random IV per value, so it cannot be searched or shown, and making it searchable would mean
   * indexing a Highly Confidential identifier (README § Known gaps).
   */
  customer: {
    searchLabel: 'customerPickerSearchLabel',
    placeholder: 'customerPickerSearchPlaceholder',
    none: 'customerPickerNonePlaceholder',
    noMatches: 'customerPickerNoMatches',
    error: 'customerPickerSearchError',
    async search(term) {
      const page = await listCustomers(term ? { search: term } : {});
      return page.items.map((c) => {
        // The status is a KEY (translated at render); the rest is literal text off the record. Built as
        // two pieces rather than one filtered array because a predicate over a mixed union has to name the
        // narrow literal type of that key, and then widening the vocabulary breaks the filter instead of
        // the thing that actually changed.
        const literals = [
          c.registrationNumber,
          c.nationality,
          c.dateOfBirth ? String(c.dateOfBirth).slice(0, 10) : undefined,
        ].filter((bit): bit is string => Boolean(bit));
        const detail: DetailPart[] = [
          { key: ENUM_LABEL.CustomerStatus[c.status] },
          ...literals,
        ];
        return { id: c.id, name: c.legalName, detail };
      });
    },
  },

  /**
   * `GET /audit-trail/actors?search=` — the people who actually appear in this office's audit log.
   *
   * Its own endpoint, not the admin user list, and that is measured: `audit-log.read` is held by
   * COMPLIANCE, EXTERNAL_AUDITOR and the two administrator roles, while `user.manage` is held by only
   * the administrators. Sourcing this from `/admin/users` would 403 for the compliance officer and the
   * external auditor — the audit trail's primary readers.
   *
   * No detail line: the endpoint returns a name and an id, and an email beside every actor would put a
   * contact list in front of a read-only external auditor for no gain to the question being asked.
   */
  auditActor: {
    searchLabel: 'entitySearchActorLabel',
    placeholder: 'entitySearchActorPlaceholder',
    none: 'entitySearchActorNone',
    noMatches: 'entitySearchActorNoMatches',
    error: 'entitySearchActorError',
    async search(term) {
      const actors = await listAuditActors(term);
      return actors.map((a) => ({ id: a.id, name: a.fullName }));
    },
  },
};

const wrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-1)',
};
const rowStyle: CSSProperties = { display: 'flex', gap: 'var(--space-2)' };
const hintStyle: CSSProperties = {
  fontSize: 'var(--text-sm)',
  color: 'var(--ink-secondary)',
};

export function EntitySearch({
  kind,
  value,
  onChange,
  label,
  required = false,
}: {
  kind: EntityKind;
  /** The selected entity's id, or '' for none. */
  value: string;
  onChange: (id: string) => void;
  /** The label on the CHOICE, which is the caller's words — "Customer", "Actor", "Data subject". */
  label: string;
  required?: boolean;
}) {
  const { t } = useLanguage();
  const source = ENTITY_SOURCES[kind];
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<EntityOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(
    (searchTerm: string) => {
      setBusy(true);
      setError(null);
      // `.then`, not an awaited helper: `set-state-in-effect` traces into the callee, and the
      // cancellation flag closes the unmount race either way.
      source
        .search(searchTerm)
        .then((options) => {
          setResults(options);
          setBusy(false);
        })
        .catch(() => {
          setResults([]);
          setError(t(source.error));
          setBusy(false);
        });
    },
    [source, t],
  );

  // One search on mount, so the field is usable without typing anything.
  useEffect(() => {
    let cancelled = false;
    source
      .search('')
      .then((options) => {
        if (!cancelled) setResults(options);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      });
    return () => {
      cancelled = true;
    };
    // An honest dependency list: the search no longer takes `t`, so the language cannot pin itself to
    // first render, and no eslint exemption is needed to say so.
  }, [source]);

  return (
    <div style={wrapStyle} data-entity-search={kind}>
      <label style={wrapStyle}>
        {t(source.searchLabel)}
        <span style={rowStyle}>
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              // Enter searches; it must not submit the form this sits inside.
              if (e.key === 'Enter') {
                e.preventDefault();
                search(term);
              }
            }}
            placeholder={t(source.placeholder)}
            aria-label={t(source.searchLabel)}
            data-entity-search-term={kind}
          />
          <button
            type="button"
            onClick={() => search(term)}
            disabled={busy}
            data-entity-search-go={kind}
          >
            {busy ? t('commonLoading') : t('commonSearch')}
          </button>
        </span>
      </label>

      <label style={wrapStyle}>
        {label}
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          aria-label={label}
          data-entity-search-select={kind}
        >
          <option value="">{t(source.none)}</option>
          {(results ?? []).map((option) => {
            // Translated HERE, so the reader's current language decides — not the language at mount.
            const detail = (option.detail ?? [])
              .map((part) => (typeof part === 'string' ? part : t(part.key)))
              .join(' · ');
            return (
              <option key={option.id} value={option.id}>
                {detail ? `${option.name} — ${detail}` : option.name}
              </option>
            );
          })}
        </select>
      </label>

      {error ? (
        <p role="alert" style={hintStyle}>
          {error}
        </p>
      ) : results && results.length === 0 ? (
        <p style={hintStyle} data-entity-search-empty={kind}>
          {t(source.noMatches)}
        </p>
      ) : null}
    </div>
  );
}
