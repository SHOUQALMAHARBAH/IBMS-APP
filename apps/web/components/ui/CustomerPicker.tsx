'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useLanguage } from '../../lib/i18n/language-context';
import { listCustomers, type Customer } from '../../lib/customer/customer-api';
import { ENUM_LABEL } from '../../lib/i18n/enum-labels';

/*
 * Choose a customer by NAME, not by pasting a UUID.
 *
 * Ten forms used to ask for a raw `customerId`. Nobody knows a customer's
 * UUID, so the only way to fill one in was to open another screen and copy it
 * out of the address bar — which meant the field was, in practice, unusable
 * by the people it was for.
 *
 * Search runs through `GET /customers?search=`, which is bilingual full text
 * over the legal name AND expands known transliteration variants, so "Ahmad"
 * finds "أحمد". It is the same search the customers list uses.
 *
 * The result is a <select>, deliberately: a custom combobox would need its own
 * ARIA roles, focus management and keyboard handling, and a native select
 * already has all three, in both reading directions.
 *
 * Disambiguation uses what the list actually returns — type, nationality, date
 * of birth, registration number. It does NOT use the national ID: that column
 * is encrypted with a random IV per value, so it cannot be searched or shown,
 * and making it searchable would mean indexing a Highly Confidential
 * identifier (see README § Known gaps).
 */

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

/** What tells two customers of the same name apart, in one line. */
function describe(c: Customer, statusLabel: string): string {
  const bits = [statusLabel];
  if (c.registrationNumber) bits.push(c.registrationNumber);
  if (c.nationality) bits.push(c.nationality);
  if (c.dateOfBirth) bits.push(String(c.dateOfBirth).slice(0, 10));
  return bits.join(' · ');
}

export function CustomerPicker({
  value,
  onChange,
  label,
  required = false,
}: {
  /** The selected customer's id, or '' for none. */
  value: string;
  onChange: (customerId: string) => void;
  label: string;
  required?: boolean;
}) {
  const { t } = useLanguage();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Customer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(
    (searchTerm: string) => {
      setBusy(true);
      setError(null);
      // `.then`, not an awaited helper: `set-state-in-effect` traces into the
      // callee, and the cancellation flag closes the unmount race either way.
      listCustomers(searchTerm ? { search: searchTerm } : {})
        .then((page) => {
          setResults(page.items);
          setBusy(false);
        })
        .catch(() => {
          setResults([]);
          setError(t('customerPickerSearchError'));
          setBusy(false);
        });
    },
    [t],
  );

  // One search on mount, so the field is usable without typing anything: most
  // books are small enough that the first page IS the whole list.
  useEffect(() => {
    let cancelled = false;
    listCustomers({})
      .then((page) => {
        if (!cancelled) setResults(page.items);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={wrapStyle}>
      <label style={wrapStyle}>
        {t('customerPickerSearchLabel')}
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
            placeholder={t('customerPickerSearchPlaceholder')}
            aria-label={t('customerPickerSearchLabel')}
          />
          <button type="button" onClick={() => search(term)} disabled={busy}>
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
        >
          <option value="">{t('customerPickerNonePlaceholder')}</option>
          {(results ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.legalName} — {describe(c, t(ENUM_LABEL.CustomerStatus[c.status]))}
            </option>
          ))}
        </select>
      </label>

      {error ? (
        <p role="alert" style={hintStyle}>
          {error}
        </p>
      ) : results && results.length === 0 ? (
        <p style={hintStyle}>{t('customerPickerNoMatches')}</p>
      ) : null}
    </div>
  );
}
