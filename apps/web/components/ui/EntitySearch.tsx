'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useLanguage } from '../../lib/i18n/language-context';
import type { TranslationKey } from '../../lib/i18n/translations';
import { searchCustomers } from '../../lib/customer/customer-api';
import { listAuditActors } from '../../lib/audit-trail/audit-trail-api';
import { ENUM_LABEL } from '../../lib/i18n/enum-labels';

/**
 * FIND A NAMED THING. ONE FIELD, every screen.
 *
 * ## What this replaces, and why one field rather than two
 *
 * Ten forms asked for a raw `customerId`. Nobody knows a uuid, so the only way to fill one in was to
 * open another screen and copy it out of the address bar. `CustomerPicker` fixed that, this component
 * generalised it to a SOURCE per entity — and both of those offered a search box AND a separate select
 * below it. The owner's verdict on running the system herself: *"this is right but it is not
 * practical."* Two controls for one decision, and the second only usable after remembering to use the
 * first.
 *
 * So it is one field now: type a name, matching names appear, pick one. The chosen customer displays as
 * a NAME — never as an identifier, which is the rule a picker echoing an id back into the field would
 * break while fixing the usability.
 *
 * ## The four anti-browsing conditions
 *
 * The owner set these for the narrow employee search and applied them here, on the reasoning that a
 * field which COMPLETES names is closer to a directory by nature than one that waits to be submitted:
 *
 *   1. nothing before three characters
 *   2. a bounded number of results, never the whole set
 *   3. nothing at all on an empty query
 *   4. every search recorded
 *
 * **All four are enforced by the SERVER** (`GET /customers/search` — a mandatory `q` with a floor, a
 * hard result bound, and an audit row whose failure fails the request). What is here is the matching
 * client behaviour, so the field does not send a request it knows will be refused. A condition a client
 * enforces alone is a condition the next client forgets.
 *
 * THE PREVIOUS VERSION MET NONE OF THEM FOR CUSTOMERS: it searched once on mount with an empty term,
 * which returns the first page of the whole book, and nothing recorded the search. Opening `/complaints`
 * put a list of customers on screen before anybody typed anything.
 *
 * ## Why a custom combobox rather than the native `<select>` this used to be
 *
 * The native select was chosen BECAUSE it carries the ARIA roles, focus management and keyboard
 * handling for free, in both reading directions — and that argument was right. Merging the two controls
 * gives that up, so the behaviour it provided is now implemented explicitly and asserted: arrow keys
 * move through the options, Enter picks the active one, Escape closes without choosing, Tab leaves, and
 * the input carries `role="combobox"` with `aria-expanded`/`aria-controls`/`aria-activedescendant` so a
 * screen reader announces the list and the active option. A combobox is the easiest control in a UI to
 * make unreachable, which is why `entity-search.spec.ts` drives it by keyboard alone and the a11y suite
 * covers a screen carrying one.
 *
 * ## What a SOURCE decides
 *
 * How to search, what to call the thing, and what to show beside a name so two of them can be told
 * apart. Nothing else.
 */
/**
 * One piece of the disambiguation line: either literal text from the record, or a key to translate.
 *
 * The split exists because of a bug the first draft had. A source that returned an already-translated
 * string had to be handed `t` at FETCH time, and the fetch runs on keystrokes — so the line was
 * localised in whatever language was active when the request went out. On this Arabic-first platform
 * that meant an English reader saw `Ahmad Al-Test — نشط · REG-1`: the status label in Arabic, because
 * the language had not resolved from `/auth/me` yet. Measured, not reasoned about.
 *
 * Translating at RENDER instead makes the option data language-free, so switching language re-renders
 * the line correctly without re-fetching and without discarding a selection already made.
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
   * Called only with a term past the floor — there is no unfiltered mode. See condition 3.
   */
  search(term: string): Promise<EntityOption[]>;
  /** The label on the field. The caller's `label` prop wins when given; this is the fallback. */
  searchLabel: TranslationKey;
  placeholder: TranslationKey;
  noMatches: TranslationKey;
  error: TranslationKey;
  /**
   * The floor, in characters. Three for customers, by the owner's decision.
   *
   * Per SOURCE rather than one constant, because the number is a judgement about how much of THAT set
   * one keystroke may return: an office's staff list is tens of people, its customer book is the whole
   * of its business. It must match the server's floor for that entity or the field either sends a
   * request it knows will 400 or withholds one the server would have answered.
   */
  minChars: number;
}

export type EntityKind = 'customer' | 'auditActor';

export const ENTITY_SOURCES: Record<EntityKind, EntitySource> = {
  /**
   * `GET /customers/search` — the narrow route, NOT `GET /customers?search=`.
   *
   * The list route keeps an unfiltered mode because `/customers` is a register somebody browses on
   * purpose; this one has no such mode at all. Bilingual full text over the legal name with
   * transliteration expansion, so "Ahmad" finds "أحمد", plus a PREFIX match on the two cleartext
   * identifier columns — because a clerk holding a document knows the number and not the spelling.
   *
   * IT CANNOT FIND AN INDIVIDUAL BY NATIONAL ID OR ANYONE BY PHONE, and that is not an oversight.
   * `nationalIdEnc`, `contactPhoneEnc` and `contactEmailEnc` are encrypted with a random IV per value,
   * so the same number stored twice is two different ciphertexts: there is nothing to match. Making
   * them searchable would mean a deterministic encoding of a Highly Confidential identifier, which is
   * the decision the masked national ID exists to refuse. Raised with the owner rather than closed
   * here.
   *
   * The disambiguation line carries the registration number because that is what tells two companies of
   * the same name apart, and it is what a person searching BY that number needs echoed back to confirm
   * they got the right record.
   */
  customer: {
    searchLabel: 'customerPickerSearchLabel',
    placeholder: 'entitySearchCustomerPlaceholder',
    noMatches: 'customerPickerNoMatches',
    error: 'customerPickerSearchError',
    minChars: 3,
    async search(term) {
      const rows = await searchCustomers(term);
      return rows.map((c) => {
        // The status is a KEY (translated at render); the rest is literal text off the record.
        const literals = [c.registrationNumber, c.taxRegistrationNumber].filter(
          (bit): bit is string => Boolean(bit),
        );
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
   * `minChars: 1` rather than 3, and the difference is the point: this set is not the office's book but
   * the actors already present in its own log — typically a handful of colleagues — and it is bounded
   * by that fact rather than by a floor. The four conditions were set for a CUSTOMER field; applying a
   * three-character floor here would make a short name unreachable for no gain.
   *
   * No detail line: the endpoint returns a name and an id, and an email beside every actor would put a
   * contact list in front of a read-only external auditor for no gain to the question being asked.
   */
  auditActor: {
    searchLabel: 'entitySearchActorLabel',
    placeholder: 'entitySearchActorPlaceholder',
    noMatches: 'entitySearchActorNoMatches',
    error: 'entitySearchActorError',
    minChars: 1,
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
  position: 'relative',
};
const hintStyle: CSSProperties = {
  fontSize: 'var(--text-sm)',
  color: 'var(--ink-secondary)',
};
const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  position: 'absolute',
  insetInlineStart: 0,
  insetInlineEnd: 0,
  top: '100%',
  zIndex: 20,
  background: 'var(--surface-card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  maxHeight: '16rem',
  overflowY: 'auto',
  boxShadow: 'var(--shadow-raised)',
};
const optionStyle = (active: boolean): CSSProperties => ({
  padding: 'var(--space-1) var(--space-2)',
  cursor: 'pointer',
  background: active ? 'var(--surface-sunken)' : 'transparent',
});
const chosenStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  flexWrap: 'wrap',
};

/** How long after the last keystroke the search runs. */
const DEBOUNCE_MS = 250;

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
  /** The label on the field, which is the caller's words — "Customer", "Actor", "Data subject". */
  label: string;
  required?: boolean;
}) {
  const { t } = useLanguage();
  const source = ENTITY_SOURCES[kind];
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  const [term, setTerm] = useState('');
  const [results, setResults] = useState<EntityOption[] | null>(null);
  const [chosen, setChosen] = useState<EntityOption | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The term the last dispatched search was for, so a settling response for an older term cannot
  // overwrite a newer one. A `cancelled` flag per effect is not enough on its own: two responses can
  // both belong to live effects and still arrive out of order.
  const latest = useRef('');

  /**
   * The caller may clear the selection (a form reset, a submit), and the field must follow — a name
   * left in the box for an id the form no longer holds is the picker telling a reader they chose
   * somebody they did not.
   *
   * DERIVED FROM `value`, not mirrored into state by an effect. The first version did mirror it, and
   * `npm run lint` refused that too: synchronous setState inside an effect. Deriving is again the
   * better answer — `value` is the caller's truth about what is selected, so asking it directly cannot
   * disagree with it, where a copy can and would for exactly one render.
   *
   * `chosen` is still state because the NAME has to survive: the id comes back from the caller, the
   * name does not, and re-fetching it to render what somebody just clicked would be a request for an
   * answer already on screen.
   */
  const selected = value === '' ? null : chosen;

  const trimmed = term.trim();
  /**
   * CONDITION 1 AND 3 — below the floor nothing is sent and nothing is shown. An empty term is below
   * every floor, so the empty case is this same branch rather than a special one.
   *
   * DERIVED, not stored, and that is not a style choice: the first version cleared `results`/`open`/
   * `busy` from inside the effect when the term fell below the floor, and `npm run lint` refused it —
   * "calling setState synchronously within an effect can trigger cascading renders". Deriving is also
   * the better answer, because a stored copy of "is this term long enough" is a second source of truth
   * for something the term already says.
   */
  const pastFloor = trimmed.length >= source.minChars;

  useEffect(() => {
    if (chosen !== null) return;
    if (!pastFloor) {
      // No setState here: the render reads `pastFloor` and shows nothing. Resetting the ref is what
      // stops an in-flight response for an older term from landing after the field was cleared.
      latest.current = '';
      return;
    }

    const handle = setTimeout(() => {
      latest.current = trimmed;
      setBusy(true);
      setError(null);
      source
        .search(trimmed)
        .then((options) => {
          if (latest.current !== trimmed) return;
          setResults(options);
          setActive(options.length > 0 ? 0 : -1);
          setOpen(true);
          setBusy(false);
        })
        .catch(() => {
          if (latest.current !== trimmed) return;
          // `null`, NOT `[]` — "nobody by that name" and "the search failed" are different claims, and
          // an empty array is how the first one is represented. The first version set `[]` here and my
          // own e2e caught it: the field showed the error AND "No customer matches what you entered"
          // at the same time, so a server fault read as a customer who does not exist.
          //
          // THIS IS THE ONLY GUARD, and it is one because a second one was UNPROVABLE. The first fix
          // also added `error === null` to `showNoMatches`, which read as belt and braces and was in
          // fact dead code: `setError` is non-null only in this catch, which sets `results` to null in
          // the same breath, and the dispatch clears the error before every search — so `error` and an
          // empty result set cannot coexist. The plant for this line killed NOTHING with both guards
          // in place, which is how the dead one was found. One mechanism the plant can reach beats two
          // where one is unreachable.
          setResults(null);
          setError(t(source.error));
          setOpen(false);
          setBusy(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [trimmed, pastFloor, chosen, source, t]);

  const choose = useCallback(
    (option: EntityOption) => {
      setChosen(option);
      setResults(null);
      setOpen(false);
      setActive(-1);
      onChange(option.id);
    },
    [onChange],
  );

  const clear = useCallback(() => {
    setChosen(null);
    setTerm('');
    setResults(null);
    setOpen(false);
    onChange('');
  }, [onChange]);

  // Gated on `pastFloor` and on nothing being chosen, so a result set left over from a longer term is
  // invisible once the term falls back below the floor — the same answer clearing it gave, without the
  // second source of truth or the cascading render.
  const options = pastFloor && selected === null ? (results ?? []) : [];
  const showBusy = busy && pastFloor && selected === null;
  const showError = pastFloor && selected === null ? error : null;
  const showNoMatches =
    pastFloor && selected === null && !busy && results !== null && results.length === 0;
  /**
   * THE CHOSEN CUSTOMER DISPLAYS AS A NAME — the owner's third requirement, and the one that would
   * quietly undo rule 2 while fixing the usability. The identifier never enters this box: it appears
   * only on an option line, where it is what tells two companies of the same name apart.
   */
  const shown = selected ? selected.name : term;

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // Arrow keys must not scroll the page while a list is being walked.
      event.preventDefault();
      if (options.length === 0) return;
      setOpen(true);
      setActive((current) => {
        const next =
          event.key === 'ArrowDown'
            ? (current + 1) % options.length
            : (current <= 0 ? options.length : current) - 1;
        return next;
      });
      return;
    }
    if (event.key === 'Enter') {
      // Never submits the surrounding form while a list is open — the behaviour the two-field version
      // had to implement for its own reasons, kept for this one.
      if (open && active >= 0 && options[active]) {
        event.preventDefault();
        choose(options[active]);
      }
      return;
    }
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setActive(-1);
      }
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (!open || options.length === 0) return;
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : options.length - 1);
    }
  }

  const describedBy: string[] = [];
  if (showBusy) describedBy.push(`${listId}-busy`);

  return (
    <div style={wrapStyle} data-entity-search={kind}>
      <label style={wrapStyle}>
        {label || t(source.searchLabel)}
        <span style={chosenStyle}>
          <input
            // ARIA 1.2 combobox. The native `<select>` this replaces carried all of it for free; having
            // merged the two controls, each piece is now explicit and asserted by keyboard in
            // `entity-search.spec.ts`.
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              open && active >= 0 ? optionId(active) : undefined
            }
            aria-describedby={describedBy.length ? describedBy.join(' ') : undefined}
            // `required` on the INPUT, not on a hidden mirror of the id: the browser then points its
            // own validation message at the control a person is looking at.
            required={required && value === ''}
            value={shown}
            onChange={(e) => {
              // Typing after choosing starts a new search rather than editing the chosen name into
              // something that no longer names the selection.
              if (selected) {
                setChosen(null);
                onChange('');
              }
              setTerm(e.target.value);
            }}
            onKeyDown={onKeyDown}
            onFocus={() => {
              if (!selected && options.length > 0) setOpen(true);
            }}
            onBlur={() => {
              // A click on an option fires blur first, so the close is deferred past the mousedown that
              // chooses. `onMouseDown` on the option (rather than onClick) is the other half.
              setTimeout(() => setOpen(false), 0);
            }}
            placeholder={t(source.placeholder)}
            data-entity-search-term={kind}
          />
          {selected ? (
            <button
              type="button"
              onClick={clear}
              data-entity-search-clear={kind}
            >
              {t('commonClear')}
            </button>
          ) : null}
        </span>
      </label>

      {/* The listbox is always in the DOM so `aria-controls` never dangles, and is emptied rather than
          unmounted when closed — a reference to a missing id is an a11y failure axe reports. */}
      <ul
        role="listbox"
        id={listId}
        aria-label={label || t(source.searchLabel)}
        style={open && options.length > 0 ? listStyle : { display: 'none' }}
        data-entity-search-list={kind}
      >
        {open
          ? options.map((option, index) => {
              // Translated HERE, so the reader's current language decides — not the language in force
              // when the request went out.
              const detail = (option.detail ?? [])
                .map((part) => (typeof part === 'string' ? part : t(part.key)))
                .join(' · ');
              return (
                <li
                  key={option.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  style={optionStyle(index === active)}
                  // mousedown, not click: blur fires before click and would close the list first.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(option);
                  }}
                  onMouseEnter={() => setActive(index)}
                  data-entity-search-option={option.id}
                >
                  <bdi>{option.name}</bdi>
                  {detail ? (
                    <span style={hintStyle}>
                      {' — '}
                      <bdi>{detail}</bdi>
                    </span>
                  ) : null}
                </li>
              );
            })
          : null}
      </ul>

      {/* `aria-live`, so a screen reader hears the result arrive rather than only seeing it. */}
      <p
        id={`${listId}-busy`}
        role="status"
        aria-live="polite"
        style={hintStyle}
        data-entity-search-status={kind}
      >
        {showBusy
          ? t('commonLoading')
          : showNoMatches
            ? t(source.noMatches)
            : ''}
      </p>

      {showError ? (
        <p role="alert" style={hintStyle} data-entity-search-error={kind}>
          {showError}
        </p>
      ) : null}
    </div>
  );
}
