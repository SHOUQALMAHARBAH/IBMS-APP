import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * EVERY PRIMITIVE A SCREEN CAN HANG A MACHINE HOOK ON MUST FORWARD `data-*`.
 *
 * The defect this guards is silent by construction — see `components/ui/data-attributes.ts` for
 * the five times it has been found in this batch alone, none of them by the compiler. A component
 * that does not forward accepts `data-anything` happily, drops it, renders perfectly and
 * type-checks clean; the only thing that notices is a test looking for the hook, and only if one
 * has been written.
 *
 * IT CHECKS PER COMPONENT, NOT PER FILE, and that is the fix for a hole in its own first version.
 * `Card.tsx` exports `Card` and `PageHeader`; with a per-file check, planting the forwarding away
 * from `Card` left the file still containing `...dataAttributes` — PageHeader's — and the guard
 * passed on a component that had stopped forwarding. A guard whose own plant survives is not a
 * guard, which is this repository's own recorded standard applied to the thing doing the checking.
 *
 * THE RULE IS BY SHAPE, and both answers are real rather than loopholes:
 *
 *   * spreading `...dataAttributes` inside that component's own body — the index signature;
 *   * a props type extending an `*HTMLAttributes` interface, which forwards `data-*` along with
 *     everything else the element accepts (`Button`, the field components).
 *
 * THE EXEMPTIONS ARE DECLARED WITH A REASON AND THE LIST FAILS IN BOTH DIRECTIONS: an exempt
 * component that has since started forwarding must leave, so the list cannot become a ceiling.
 * Same shape as `DECLARED_BARE` and `DECLARED_RAW` elsewhere here, and for the same reason — a row
 * that outlives its reason covers whatever lands next.
 */

// `process.cwd()` is `apps/web` — this suite is run FROM there, which `globals-theme.test.ts`
// already depends on and which is why `--root` breaks it.
const UI_DIR = join(process.cwd(), 'components', 'ui');

/**
 * `<file>#<component>` → why it renders nothing a screen addresses. Each row says WHY, because
 * "it does not need it" is exactly the sentence that goes stale.
 */
const EXEMPT: Record<string, string> = {
  'Icon.tsx#Icon': 'an `aria-hidden` SVG inside whatever addressed it; the hook goes on the parent',
  'Icon.tsx#IconBadge': 'the same SVG in a circle',
  'Icon.tsx#IconLabel': 'an icon beside a word, inside its caller',
  'BrandMark.tsx#BrandMark': 'the logo geometry — decorative, never a target',
  'BrandMark.tsx#BrandLockup': 'the mark beside the product name',
  'BrandPitch.tsx#BrandPitch': 'one screen, no props at all',
  'AuthFrame.tsx#AuthFrame': 'its two slots are where a caller puts anything addressable',
  'Skeleton.tsx#Skeleton': 'a placeholder for something that is about to replace it',
  'Skeleton.tsx#SkeletonList': 'the same, repeated',
  'SentenceWithLink.tsx#SentenceWithLink': 'returns a fragment of text, not an element',
  'FigurePeriod.tsx#FigurePeriod': 'a text clause beside a figure',
  'SelectedValueDescription.tsx#SelectedValueDescription':
    'the server description under a select; the select carries the hook',
  'ReportProvenance.tsx#ReportProvenance': 'one provenance line, addressed through its own screen',
  'CombinedDutyOnRecord.tsx#CombinedDutyOnRecord':
    'takes an explicit `testId` prop — a NAMED hook, deliberately, because the act it renders is one thing',
  'WorkflowHistoryLink.tsx#WorkflowHistoryLink': 'a link whose href is the stable address',
  'Pagination.tsx#Pagination': 'addressed by its own button roles',
  'EntitySearch.tsx#EntitySearch': 'addressed by its label and its combobox role',
  'DiscardControl.tsx#DiscardControl': 'addressed by its button label',
  'DiscardControl.tsx#DiscardedNotice':
    'a `role="status"` notice rendered beside a withdrawn record; its own screen addresses the record',
  'CombinedDutyReasonField.tsx#CombinedDutyReasonField': 'addressed by its label',
  'ActionStatus.tsx#ActionStatus': 'addressed by its `role="status"`',
};

/** Each exported component, with the source from its own `export function` to the next one. */
function components(): Array<{ key: string; body: string; file: string; src: string }> {
  const out: Array<{ key: string; body: string; file: string; src: string }> = [];
  for (const file of readdirSync(UI_DIR)) {
    if (!file.endsWith('.tsx')) continue;
    const src = readFileSync(join(UI_DIR, file), 'utf8');
    const starts = [...src.matchAll(/^export function (\w+)\(/gm)];
    starts.forEach((m, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].index! : src.length;
      out.push({ key: `${file}#${m[1]}`, body: src.slice(m.index!, end), file, src });
    });
  }
  return out;
}

/**
 * A COMPONENT, not merely an exported function. `CombinedDutyReasonField.tsx` exports two
 * predicates that return booleans; a matcher counting every `export function` reported both as
 * components with no forwarding, which is a finding about the matcher rather than the code.
 */
function rendersMarkup(body: string): boolean {
  return /return \(\s*</.test(body) || /=> \(\s*</.test(body);
}

/**
 * The `...dataAttributes` spread is checked in the COMPONENT's own body, because that is the
 * thing being asserted — `Card.tsx` exports two components and only one of them spreading must
 * not pass.
 *
 * The `HTMLAttributes` route is checked at FILE level, deliberately: `Button`'s props are a NAMED
 * interface declared above the function, so a per-component slice cannot see it without resolving
 * the type. Allowing it per file is the honest limit — a file that declares that extension has a
 * real forwarding mechanism, and the strict half is the one that caught the plant.
 */
function forwards(body: string, fileSrc: string): boolean {
  // THE SPREAD ONTO AN ELEMENT, NOT THE DESTRUCTURE — and that distinction is the fix for the
  // guard's SECOND hole, found the same way as the first. `...dataAttributes` in the parameter
  // list collects the attributes; `{...dataAttributes}` on the root element is what forwards
  // them. Matching the bare name passed a planted `Card` that still collected and no longer
  // spread, which is precisely the state this exists to catch.
  return body.includes('{...dataAttributes}') || /HTMLAttributes/.test(fileSrc);
}

describe('every `components/ui` primitive forwards `data-*`', () => {
  // Only the ones that actually render markup — see `rendersMarkup`.
  const all = components().filter((c) => rendersMarkup(c.body));

  it('finds the primitive set at all', () => {
    // A NON-VACUITY FLOOR. A matcher that reads an empty directory reports a clean nothing, which
    // is the shape this repository has already paid for four times.
    expect(all.length).toBeGreaterThan(25);
  });

  it('every non-exempt component forwards', () => {
    const missing = all.filter((c) => !(c.key in EXEMPT)).filter((c) => !forwards(c.body, c.src));

    expect(
      missing.map((c) => c.key),
      `These render something a screen can address and do NOT forward \`data-*\`, so a hook put on\n` +
        `one of them type-checks and goes nowhere:\n  ${missing.map((c) => c.key).join('\n  ')}\n\n` +
        `Add \`...dataAttributes\` to the destructure, \`& DataAttributes\` to the prop type and\n` +
        `\`{...dataAttributes}\` on the root element — or add a row to EXEMPT with a real reason.`,
    ).toEqual([]);
  });

  it('no exemption is stale', () => {
    const stale = all.filter((c) => c.key in EXEMPT).filter((c) => forwards(c.body, c.src));
    expect(
      stale.map((c) => c.key),
      `Declared exempt and forwarding now — remove their rows:\n  ${stale.map((c) => c.key).join('\n  ')}`,
    ).toEqual([]);
  });

  it('no exemption names a component that is gone', () => {
    const keys = new Set(all.map((c) => c.key));
    const gone = Object.keys(EXEMPT).filter((k) => !keys.has(k));
    expect(gone, `EXEMPT names components that are not there:\n  ${gone.join('\n  ')}`).toEqual([]);
  });
});
