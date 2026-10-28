import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/*
 * THE COMPOSITION LAYER — a filter row, an inset section, a key/value list, a note and a log.
 *
 * These are the five shapes the approved reference screen is made of, and every one of them is a
 * shape a screen in this product otherwise hand-rolls with inline styles. The owner's instruction
 * for the crowded screens is the reason they exist as components rather than as a convention:
 * *«الشاشات الي معجقة و فيها اكثر من قسم تتزبط و تتنسق عشان الموظف ما يضيع»* — a reader must be
 * able to tell, without reading everything, where they are and what to press. That is a property
 * of grouping, and grouping is only consistent if one file decides the padding.
 *
 * SPACING COMES FROM THE FIVE-STEP SCALE AND NOTHING ELSE (4 · 8 · 12 · 16 · 22). That single rule
 * is most of why the reference pages look composed: boxes land on the same lines because their
 * padding is the same number. Siblings are laid out with `gap`, never with a per-element margin.
 */

/** The filter row above a list. Sits on the sunken surface so it reads as a control strip. */
export function FilterBar({
  children,
  actions,
  style,
}: {
  children: ReactNode;
  /** Controls that act on the filtered set rather than define it — Apply, Clear. */
  actions?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--surface-sunken)',
        borderBottom: '1px solid var(--border-subtle)',
        ...style,
      }}
    >
      {children}
      {actions ? (
        <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 'var(--space-2)' }}>{actions}</div>
      ) : null}
    </div>
  );
}

/**
 * THE EXPANDED RECORD. The reference screen opens a row's detail IN PLACE, in two columns, rather
 * than navigating to a second screen — which is the whole point: a reader working a queue keeps
 * their position in the list.
 *
 * It is `auto-fit` with a floor rather than a fixed two-column grid, so one section fills the
 * width, two sit side by side, and the phone gets one column with no media query.
 */
export function DetailPanel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: 'var(--surface-sunken)',
        borderTop: '1px solid var(--border-subtle)',
        padding: 'var(--space-4)',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(19rem, 1fr))',
        gap: 'var(--space-4)',
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** One section inside a DetailPanel — or anywhere a titled block sits on a page. */
export function DetailSection({
  icon,
  title,
  children,
  style,
}: {
  icon?: IconName;
  title: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-3) var(--space-4)',
        minWidth: 0,
        ...style,
      }}
    >
      <h3
        style={{
          fontSize: 'var(--text-base)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-3)',
        }}
      >
        {icon ? (
          <span
            style={{
              width: '1.375rem',
              height: '1.375rem',
              borderRadius: 'var(--radius-full)',
              background: 'var(--brand-50)',
              color: 'var(--ink-brand)',
              display: 'grid',
              placeItems: 'center',
              flex: 'none',
            }}
          >
            <Icon name={icon} size={13} />
          </span>
        ) : null}
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * A key/value list, as a real `<dl>`. The semantics are not decoration: a screen reader announces
 * the term with its definition, which is what makes *"عدد أصحاب البيانات المتأثرين تقريباً — ٤١"*
 * read as one fact rather than as two stray strings.
 */
export function KeyValue({
  rows,
  style,
}: {
  rows: Array<{ term: ReactNode; value: ReactNode }>;
  style?: CSSProperties;
}) {
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: 'var(--space-2) var(--space-3)',
        fontSize: 'var(--text-base)',
        margin: 0,
        minWidth: 0,
        ...style,
      }}
    >
      {rows.map((row, index) => (
        <div key={index} style={{ display: 'contents' }}>
          <dt style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}>{row.term}</dt>
          <dd style={{ margin: 0, color: 'var(--ink-primary)', minWidth: 0 }}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * SOMETHING WORTH READING BEFORE ACTING — a rule, a limit, a consequence.
 *
 * `tone` carries no `role` by default, deliberately: a reassurance announced through an `alert`
 * region reads as a problem, which is the mistake `SelectedValueDescription` already records. A
 * caller that genuinely needs the announcement passes `role` itself, and chooses `status` over
 * `alert` unless something has actually gone wrong.
 */
export function Note({
  tone = 'info',
  icon = 'info',
  children,
  role,
  style,
}: {
  tone?: 'info' | 'warning' | 'neutral';
  icon?: IconName;
  children: ReactNode;
  role?: 'status' | 'alert';
  style?: CSSProperties;
}) {
  const palette =
    tone === 'warning'
      ? { background: 'var(--warning-bg)', border: 'var(--warning-border)', color: 'var(--warning-ink)' }
      : tone === 'neutral'
        ? { background: 'var(--surface-sunken)', border: 'var(--border-default)', color: 'var(--ink-secondary)' }
        : { background: 'var(--info-bg)', border: 'var(--info-border)', color: 'var(--info-ink)' };

  return (
    <div
      role={role}
      style={{
        display: 'flex',
        gap: 'var(--space-2)',
        alignItems: 'flex-start',
        background: palette.background,
        border: `1px solid ${palette.border}`,
        color: palette.color,
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-3)',
        fontSize: 'var(--text-sm)',
        minWidth: 0,
        ...style,
      }}
    >
      <Icon name={icon} size={15} style={{ marginTop: '0.125rem' }} />
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}

/**
 * AN APPEND-ONLY LOG — who did what, and when.
 *
 * The reference screen's containment log is the worked example, and its shape answers a real
 * requirement rather than a visual one: `PRIV-SRS-02` types that field *Text (log) · Required ·
 * Timestamped*, which is why it is a child table and why each entry names the actor. A joined
 * string would discard exactly those two facts.
 */
export function TimelineLog({
  entries,
  style,
}: {
  entries: Array<{ when: ReactNode; what: ReactNode; who?: ReactNode }>;
  style?: CSSProperties;
}) {
  return (
    <ul style={{ display: 'grid', margin: 0, padding: 0, listStyle: 'none', minWidth: 0, ...style }}>
      {entries.map((entry, index) => (
        <li
          key={index}
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: 'var(--space-3)',
            padding: 'var(--space-2) 0',
            borderBottom: index === entries.length - 1 ? 'none' : '1px dashed var(--border-subtle)',
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>
            {entry.when}
          </span>
          <span style={{ fontSize: 'var(--text-base)', minWidth: 0 }}>
            {entry.what}
            {entry.who ? (
              <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}>
                {entry.who}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
