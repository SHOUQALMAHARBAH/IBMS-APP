import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WORKFLOW_TRANSITIONS } from './workflow-transitions.config';

/*
 * Part G, checklist item 3 — "every status enum passes exclusively through
 * `transition()`; no direct `status =` assignment anywhere in the code".
 *
 * The audit that produced this found the codebase already clean: of 24
 * candidate lines, every one was either an audit-log snapshot, an in-memory
 * provider-health object, or — the four real Prisma writes — a
 * status-CONDITIONAL update, where `status` sits in the `where` clause (the
 * race-safe pattern `race-safe-invariants.md` requires) while `data` sets a
 * different field entirely.
 *
 * So this spec is a guard, not a fix. It exists because "we checked once" is
 * not the same claim as "it cannot regress", and item 3 is the sort of rule
 * that decays silently: one `data: { status: 'CLOSED' }` in a repository is
 * invisible in review and bypasses the engine, its audit row and its
 * transition validation in one line.
 */

const SRC = path.join(__dirname, '../..');

/** Every entity whose status the engine governs, as Prisma client accessors
 *  (`Policy` -> `policy`, `RFQInsurer` -> `rFQInsurer`). */
function governedAccessors(): string[] {
  return Object.keys(WORKFLOW_TRANSITIONS).map(
    (e) => e.charAt(0).toLowerCase() + e.slice(1),
  );
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.spec.'))
      acc.push(full);
  }
  return acc;
}

/** The text inside the `{ … }` that `opener` matches, brace-balanced. */
function braceBody(text: string, opener: RegExp): string {
  const m = opener.exec(text);
  if (!m) return '';
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  while (depth > 0 && i < text.length) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') depth -= 1;
    i += 1;
  }
  return text.slice(start, i - 1);
}

/**
 * A Prisma write that sets `status` in its `data` payload, on a model the
 * engine governs.
 *
 * Only `data:` counts. `where: { status: … }` is the opposite of a violation —
 * it is the conditional that makes a write race-safe — and an early version of
 * this scan conflated the two and reported four false positives.
 */
function directStatusWrites(): string[] {
  const governed = new Set(governedAccessors());
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    const write =
      /\.(\w+)\.(create|update|updateMany|upsert)\(\s*\{([\s\S]{0,900}?)\n\s*\}\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = write.exec(text)) !== null) {
      const [, model, , body] = m;
      if (!governed.has(model)) continue;
      // Isolate the `data:` object by MATCHING BRACES, not by a regex that
      // hoped for a newline before the closing one. The first version here
      // required `\n\s*\}`, so a single-line `data: { status: 'CLOSED' }`
      // produced an empty payload and passed — a deliberately planted bypass
      // went undetected until it was tested for.
      const payload = braceBody(body, /\bdata:\s*\{/);
      if (/\bstatus\s*:/.test(payload)) {
        const line = text.slice(0, m.index).split('\n').length;
        found.push(`${path.relative(SRC, file).replace(/\\/g, '/')}:${line}`);
      }
    }
  }
  return found;
}

describe('no status write bypasses the workflow engine', () => {
  it('sanity: the engine governs a substantial set of entities', () => {
    expect(governedAccessors().length).toBeGreaterThan(10);
  });

  it('no Prisma write sets `status` in its data payload on a governed entity', () => {
    // A status move belongs in `WorkflowTransitionService.transition()`, which
    // validates the edge against the allowed-transitions map and writes the
    // TRANSITION audit row. A direct write skips both.
    expect(directStatusWrites()).toEqual([]);
  });

  it('no raw SQL updates a status column', () => {
    // `$executeRaw` is outside the reach of the scan above, and is how a
    // status write would most plausibly hide.
    const offenders = sourceFiles(SRC).filter((f) =>
      /\$executeRaw[\s\S]{0,200}?UPDATE[\s\S]{0,200}?status/i.test(
        fs.readFileSync(f, 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
