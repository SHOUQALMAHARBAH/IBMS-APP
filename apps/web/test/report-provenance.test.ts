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
      'A reporting screen is rendering a provenance date itself. Use `ReportProvenance` for the LINE ' +
        'or `FigurePeriod` for a clause beside one figure (owner decision 58) — eight screens ' +
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

/*
 * OWNER DECISION 58 — THE SECOND PROVENANCE COMPONENT, AND THE SAME SINGLE-SOURCE RULE.
 *
 * `FigurePeriod` puts the period beside ONE figure rather than once at the top of the
 * screen, because `/dashboards/sales` already printed the top line and the owner still
 * read the screen as broken: «قسم العملاء المحتملون بيطلع 0 مع إنه في عملاء محتملون جدد».
 *
 * THE PROPERTY GUARDED HERE IS NOT THE WORDING — it is that a screen may not decide
 * WHICH clause a figure gets. Two of `/dashboards/policy`'s four metrics ignore the
 * period filter entirely, so the choice between «خلال …» and «كما في …» comes from the
 * api's `metricScope` on the wire. A screen spelling the key itself would make that
 * choice locally, and the failure would LOOK like the fix: a period printed beside a
 * figure that does not obey it, which is a more confident version of the defect decision
 * 58 exists to remove.
 *
 * This is the same argument this file already makes for `ReportProvenance` — «a component
 * is only the single source while nothing bypasses it» — one level down.
 */
const FIGURE_PERIOD_KEYS = ['dashFigureDuringPeriod', 'dashFigureAsOf'];

describe('the per-figure period clause is one component (owner decision 58)', () => {
  it('no screen spells the clause itself — the clause chooses from `metricScope`, which only the component reads', () => {
    const offenders: string[] = [];
    for (const screen of REPORTING_SCREENS) {
      const src = read(screen);
      for (const key of FIGURE_PERIOD_KEYS) {
        if (src.includes(key)) offenders.push(`${screen}  ${key}`);
      }
    }
    expect(
      offenders,
      'A screen is rendering the per-figure period clause itself. Use `FigurePeriod` and pass the ' +
        'api\'s own `metricScope` entry: the screen must not decide whether a figure obeys the ' +
        'period, because two of /dashboards/policy\'s metrics do not and a period beside one of ' +
        'those is a false claim.',
    ).toEqual([]);
  });

  it('every Playwright spec that mocks a dashboard endpoint carries `metricScope` — the field the screen reads unconditionally', () => {
    /*
     * THE SIXTH TIME A FIXTURE SHORT OF A FIELD HAS BITTEN, so it is a check now.
     *
     * CI found `bidi-text.spec.ts` mocking `/dashboards/policy` without it — a third
     * copy of that response, in a file about bidi isolation. The screen read
     * `undefined.activePoliciesCount`, died during render, and the failure appeared on
     * a `<bdi>` locator that was never the problem. I had widened the two specs whose
     * NAMES matched the feature rather than the three that mock the endpoint.
     *
     * NO FALLBACK WAS ADDED TO THE SCREEN, deliberately, and this is where that
     * decision is recorded: the `IncidentReport` CBJ panel degrades to «the server did
     * not send this» because a missing field there is survivable. The degraded state
     * HERE is a figure with no period clause — which is exactly the bare number owner
     * decision 58 exists to remove, and it would be invisible. A crash is the correct
     * failure for this field.
     *
     * LIMIT, stated rather than discovered: this checks ONE field by name. It cannot
     * derive what a screen reads unconditionally — that needs the api's view type, and
     * `apps/web` cannot import it. A seventh required field needs its own line here.
     */
    const e2e = path.join(__dirname, '..', 'e2e');
    const mocking = fs
      .readdirSync(e2e)
      .filter((f) => f.endsWith('.spec.ts'))
      .map((f) => ({ file: f, src: fs.readFileSync(path.join(e2e, f), 'utf8') }))
      .filter(
        ({ src }) =>
          src.includes('dashboards/policy') || src.includes('dashboards/sales'),
      );

    // THE FLOOR: a readdir that stops matching reports a clean nothing, and three is
    // the measured figure.
    expect(
      mocking.length,
      'no spec was found mocking a dashboard endpoint — the matcher broke, which reads exactly like a clean result',
    ).toBeGreaterThanOrEqual(3);

    const short = mocking
      // `metricScope\s*:` and NOT `includes('metricScope')` — a plant renaming the key
      // to `metricScopeRemoved` satisfied the substring check and the guard passed. The
      // recorded base64-'99' class: a needle that is a PREFIX of something else is not a
      // needle. Found by the plant, not by reading the matcher.
      //
      // And written WITHOUT a word boundary on purpose: the first attempt carried one,
      // a heredoc turned it into a literal BACKSPACE byte, and the regex then matched
      // NOTHING — so the guard flagged all three specs, including the two that are
      // correct. A matcher that matches nothing reads exactly like one finding a real
      // problem everywhere. The key is always preceded by whitespace in a fixture, so
      // the boundary bought nothing and cost a false red.
      .filter(({ src }) => !/metricScope\s*:/.test(src))
      .map(({ file }) => file);
    expect(
      short,
      'these spec(s) mock a dashboard endpoint without `metricScope`. The screen reads it ' +
        'unconditionally, so the page dies during render and the failure surfaces on whatever ' +
        'locator happens to be next — add the field rather than a fallback.',
    ).toEqual([]);
  });

  it('is not vacuous — the component really does use both keys, and the api really does declare the scope', () => {
    /*
     * THE FLOOR. The check above passes against a renamed key, a deleted component and a
     * screen that prints no clause at all — three clean-nothings. So the two keys are
     * asserted to be live in the component, and the component is asserted to read the
     * declaration rather than choosing.
     */
    const component = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'ui', 'FigurePeriod.tsx'),
      'utf8',
    );
    for (const key of FIGURE_PERIOD_KEYS) {
      expect(component, `${key} is not used by FigurePeriod`).toContain(key);
    }
    // It renders from the PROP, never from its own judgement about a metric name.
    expect(component).toContain("scope === 'period'");
    expect(component, 'FigurePeriod names a metric itself instead of taking the scope').not.toContain(
      'activePoliciesCount',
    );
  });
});
