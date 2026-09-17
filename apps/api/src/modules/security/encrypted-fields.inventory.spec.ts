import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ENCRYPTED_FIELDS, ENCRYPTED_ELSEWHERE } from './encrypted-fields';

/*
 * Part G, checklist item 4 — "every `-- ENCRYPT` field is actually encrypted
 * before being written to the database".
 *
 * That question was previously unanswerable from the code: the schema marked
 * nine fields, `ENCRYPTED_FIELDS` listed eight, and nothing compared them. The
 * three discrepancies that fell out on the first run are exactly what this
 * exists to catch:
 *
 *   - `MfaCredential.secretEnc` — encrypted, but through `MfaService`, so it
 *     belongs in `ENCRYPTED_ELSEWHERE` rather than the map that drives
 *     `encryptEntityFields`.
 *   - `OrganizationEmailIntegration.oauthRefreshTokenEnc` — encrypted, but the
 *     schema had no `-- ENCRYPT` marker to say so.
 *   - `MfaCredential.webauthnPublicKeyEnc` — marked, and written by nothing at
 *     all. Deliberately allowed below, as an open question recorded in README
 *     § Known gaps rather than a guess about whether WebAuthn is coming.
 *
 * Modelled on `common/money-fields.inventory.spec.ts`, which does the same job
 * for `Decimal` columns.
 */

const SCHEMA = path.join(
  __dirname,
  '../../../../../packages/db/prisma/schema.prisma',
);

/** Fields marked `-- ENCRYPT` in the schema, as `Model.field`. */
function markedInSchema(): string[] {
  const text = fs.readFileSync(SCHEMA, 'utf8');
  const out: string[] = [];
  let model: string | null = null;
  for (const line of text.split('\n')) {
    const m = /^model (\w+) \{/.exec(line);
    if (m) model = m[1];
    if (line.trim().startsWith('///')) continue; // a doc comment, not a marker
    if (!line.includes('-- ENCRYPT')) continue;
    const f = /^\s*(\w+)\s+/.exec(line);
    if (f && model) out.push(`${model}.${f[1]}`);
  }
  return out;
}

function flatten(map: Record<string, readonly string[]>): string[] {
  return Object.entries(map).flatMap(([model, fields]) =>
    fields.map((f) => `${model}.${f}`),
  );
}

/**
 * Marked in the schema and encrypted by NEITHER path, knowingly.
 *
 * `webauthnPublicKeyEnc` is written by nothing: WebAuthn enrolment is not
 * implemented (see `/settings/security`, which says a hardware key is not yet
 * available). Whether this column is a placeholder for that or dead code is a
 * question for the client, not a guess to encode here — so it is listed, and
 * the moment anything writes it the omission has to be revisited.
 */
const KNOWINGLY_UNWRITTEN = ['MfaCredential.webauthnPublicKeyEnc'];

describe('the `-- ENCRYPT` inventory matches the schema', () => {
  it('sanity: the parser actually finds markers', () => {
    expect(markedInSchema().length).toBeGreaterThan(5);
  });

  it('every marked field is accounted for — by this module, by another path, or knowingly unwritten', () => {
    const accounted = new Set([
      ...flatten(ENCRYPTED_FIELDS),
      ...flatten(ENCRYPTED_ELSEWHERE),
      ...KNOWINGLY_UNWRITTEN,
    ]);
    const unaccounted = markedInSchema().filter((f) => !accounted.has(f));
    // A marked column nobody encrypts is personal data written in the clear.
    expect(unaccounted).toEqual([]);
  });

  it('every field this module encrypts is marked in the schema', () => {
    // The reverse gap, and the one that actually happened: the email
    // integration's refresh token was encrypted correctly while the schema
    // said nothing, so a reader auditing the schema would have missed it.
    const marked = new Set(markedInSchema());
    const unmarked = flatten(ENCRYPTED_FIELDS).filter((f) => !marked.has(f));
    expect(unmarked).toEqual([]);
  });

  it('no field is claimed by both encryption paths', () => {
    // `ENCRYPTED_FIELDS` drives `encryptEntityFields`. A field in both lists
    // would be encrypted twice, and the second decrypt would return
    // ciphertext.
    const here = new Set(flatten(ENCRYPTED_FIELDS));
    const overlap = flatten(ENCRYPTED_ELSEWHERE).filter((f) => here.has(f));
    expect(overlap).toEqual([]);
  });

  it('the knowingly-unwritten list has no stale entries', () => {
    const marked = new Set(markedInSchema());
    expect(KNOWINGLY_UNWRITTEN.filter((f) => !marked.has(f))).toEqual([]);
  });
});
