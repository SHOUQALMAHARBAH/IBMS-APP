import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/*
 * NO REPORTING SCREEN RENDERS A PROVENANCE DATE IN ITS OWN JSX — item 5 batch 1, violation 1.
 *
 * Eight of the sixteen reporting screens wrote this sentence in HARDCODED ENGLISH:
 *
 *   dashboards/claims          As of {summary.asOf}.
 *   dashboards/financial       As of {summary.asOf}.
 *   dashboards/sales           Period {periodLabel} ({start} – {end}).
 *   kpi-dashboard              Generated {generatedAt}.
 *   planning-export            Generated {generatedAt} — market period {periodLabel}.
 *   portfolio-analysis         Generated {generatedAt}.
 *   profitability-analysis     Generated {generatedAt}.
 *   sla-dashboard              Generated {generatedAt}.  (inside a WHOLLY English paragraph)
 *
 * So an Arabic reader got the figures and an English sentence about them, on half the reporting surface —
 * the oldest standing rule in this project, broken on the most-read screens. All eight now use
 * `components/ui/ReportProvenance.tsx`.
 *
 * ## Why a guard and not a convention
 *
 * Those eight strings ARE the evidence that the convention does not hold on its own. Each was written by
 * somebody who knew the platform is Arabic-first, and each was the obvious thing to type. A component is
 * the single source of this sentence only while nothing bypasses it.
 *
 * ## What this refuses
 *
 * A reporting screen rendering `generatedAt`, `asOf`, `periodStart` or `periodEnd` inside JSX. Reading the
 * SOURCE rather than the rendered output, for the reason established by the narrow-search guard: a render
 * test proves what one screen showed with one fixture, and cannot prove another screen is not about to
 * print its own date in English.
 *
 * It does NOT ban the fields — a screen may pass them to `ReportProvenance`, filter on them, or send them
 * as a query parameter. What it bans is putting one in JSX text.
 */

const APP = path.join(__dirname, '..', 'app', '(app)');

/** The reporting batch — item 5's first batch, read by hand rather than scanned. */
const REPORTING_SCREENS = [
  'claims-analytics',
  'dashboards/claims',
  'dashboards/compliance',
  'dashboards/executive',
  'dashboards/financial',
  'dashboards/insurer-employee-performance',
  'dashboards/policy',
  'dashboards/sales',
  'employee-performance',
  'insurer-performance',
  'kpi-dashboard',
  'planning-export',
  'portfolio-analysis',
  'profitability-analysis',
  'sales-performance',
  'sla-dashboard',
];

/** The provenance fields. A date in one of these is a "when are these figures from" claim. */
const PROVENANCE_FIELDS = ['generatedAt', 'asOf', 'periodStart', 'periodEnd'];

function read(screen: string): string {
  return fs.readFileSync(path.join(APP, screen, 'page.tsx'), 'utf8');
}

/**
 * Lines where a provenance field appears INSIDE JSX text — i.e. in a `{…}` expression that is not a prop
 * value and not a function argument.
 *
 * The signal that distinguishes them: JSX text interpolation sits on a line with no `=` before the brace
 * (a prop is `at={…}`) and is not inside a `t(`/`tr(` call. Deliberately conservative — a false positive
 * here would be a brittle red build that teaches everyone to ignore the guard, which is the mistake the
 * negative-nav guard's first version made three times over.
 */
function jsxDateRenders(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  src.split('\n').forEach((line, i) => {
    const s = line.trim();
    if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) return;
    for (const field of PROVENANCE_FIELDS) {
      // `{summary.generatedAt…}` with no `=` immediately before the brace → JSX text, not a prop.
      const re = new RegExp(`(^|[^=])\\{[^{}]*\\.${field}\\b`);
      if (!re.test(line)) continue;
      // A translator call is the sanctioned way to put one in a sentence.
      if (/\b(?:t|tr)\(/.test(line)) continue;
      out.push({ line: i + 1, text: s.slice(0, 90) });
    }
  });
  return out;
}

describe('the provenance line is one component, in both languages', () => {
  it('no reporting screen renders a provenance date in its own JSX', () => {
    const offenders: string[] = [];
    for (const screen of REPORTING_SCREENS) {
      for (const hit of jsxDateRenders(read(screen))) {
        offenders.push(`${screen}:${hit.line}  ${hit.text}`);
      }
    }
    expect(
      offenders,
      'A reporting screen is rendering a provenance date itself. Use `ReportProvenance` — eight screens ' +
        'did this in hardcoded ENGLISH, which is what the component exists to stop. If a genuinely new ' +
        'sentence is needed, add a SHAPE to that component\'s discriminated union so it is translated ' +
        'once, rather than writing the sentence here.',
    ).toEqual([]);
  });

  it('the component covers every shape those eight screens needed', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'ui', 'ReportProvenance.tsx'),
      'utf8',
    );
    // The union is what makes a fifth shape a compile error at the call site rather than a silent render of
    // the wrong sentence, so its members are pinned.
    for (const kind of [
      'generatedAt',
      'asOf',
      'generatedAtWithPeriod',
      'period',
    ]) {
      expect(src, `ReportProvenance lost the "${kind}" shape`).toContain(
        `kind: '${kind}'`,
      );
    }
  });

  it('is not vacuous — the screens really are being read', () => {
    // Without this, a wrong path would make every file empty, no offender would ever be found, and the
    // guard would pass forever while asserting nothing. The same floor the narrowness and multer guards
    // carry — and this file's own history is why: a keyword scan that silently matched nothing is what
    // under-counted the violation on `sla-dashboard` in the first place.
    expect(REPORTING_SCREENS).toHaveLength(16);
    for (const screen of REPORTING_SCREENS) {
      expect(read(screen).length, `${screen} read as empty`).toBeGreaterThan(
        500,
      );
    }
    // And the component is actually used, so "no offenders" cannot mean "nobody shows provenance at all".
    const users = REPORTING_SCREENS.filter((s) =>
      read(s).includes('ReportProvenance'),
    );
    expect(users.length, 'nothing imports ReportProvenance').toBeGreaterThan(7);
  });
});
