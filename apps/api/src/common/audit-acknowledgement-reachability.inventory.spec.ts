import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/*
 * A SECURITY ACKNOWLEDGEMENT'S REACHABILITY CLAIM, ASSERTED RATHER THAN RE-READ.
 *
 * `scripts/audit-check.mjs` accepts four high-severity multer DoS advisories on two grounds: that there
 * is no upgrade path, and that the vulnerability is UNREACHABLE because this api exposes no multipart
 * route. The acknowledgement even carries its own re-check instruction — *"Re-check the moment a real
 * document-upload endpoint is built, which is what would make it reachable."*
 *
 * That instruction was not followed. Measured 2026-09-29 (§ 1.82):
 *
 *   2026-09-09  the acknowledgement written — the claim was TRUE
 *   2026-09-13  a bulk-import route added WITH a FileInterceptor — false four days later
 *   2026-09-28  that route given a web caller — reachable from the UI by two administrator roles
 *
 * Sixteen days, and the thing the false claim justified was accepting four security advisories.
 *
 * ## What this spec is, and what it deliberately is not
 *
 * **A re-check condition written into a comment is not a control.** This is the control: it fails when
 * the set of multipart entry points in `apps/api/src` differs from the set recorded below. It does NOT
 * decide whether the acknowledgement is still justified — that is the owner's judgement, and a test
 * that tried to make it would either block legitimate work or quietly bless it. What a test CAN do is
 * refuse to let the set change without somebody noticing, which is the half that failed.
 *
 * So adding a multipart route is not a failure. Adding one WITHOUT updating this list is — and the
 * failure message says to re-read the acknowledgement, because the grounds it rests on have moved.
 *
 * ## Why the whole source tree and not the one file
 *
 * Naming `legacy-import.controller.ts` would pass forever while a second upload endpoint appeared
 * beside it. The claim in the acknowledgement is about `apps/api/src` as a whole, so the assertion is
 * too — the same reason the encryption-field and money-column inventories enumerate rather than spot-
 * check.
 */

const API_SRC = path.join(__dirname, '..');

/**
 * Every multipart entry point that exists today, with the acknowledgement's grounds re-checked against
 * it. Each entry is a file path relative to `apps/api/src`.
 *
 * `legacy-import.controller.ts` — `POST /imports/customers`. Gated on `customer.bulk-import`, held by
 * OFFICE_ADMINISTRATOR and SYSTEM_SECURITY_ADMINISTRATOR; requires an authenticated session; capped at
 * `limits: { fileSize: LEGACY_IMPORT_MAX_BYTES, files: 1 }`. So the multer exposure here is a DoS by an
 * authenticated administrator against a size-bounded single-file endpoint — smaller than the advisories'
 * own claim, and larger than "unreachable". Raised for the owner's decision as § 1.82.
 */
const KNOWN_MULTIPART_ENTRY_POINTS = [
  'modules/customer/legacy-import.controller.ts',
];

/** The three spellings that make a route multipart in a Nest application. */
const MULTIPART_MARKERS = [
  'FileInterceptor',
  'FilesInterceptor',
  '@UploadedFile',
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.includes('.spec.')) {
      out.push(full);
    }
  }
  return out;
}

describe('the multer acknowledgement’s reachability claim', () => {
  const found = sourceFiles(API_SRC)
    .filter((file) => {
      const src = fs.readFileSync(file, 'utf8');
      return MULTIPART_MARKERS.some((marker) => src.includes(marker));
    })
    .map((file) => path.relative(API_SRC, file).split(path.sep).join('/'))
    .sort();

  it('finds exactly the multipart entry points the acknowledgement has been re-checked against', () => {
    expect(
      found,
      'The set of multipart entry points in apps/api/src has changed. scripts/audit-check.mjs accepts ' +
        'four high-severity multer DoS advisories partly on the ground that this vulnerability is ' +
        'reachable only in a bounded way — so RE-READ that acknowledgement, re-state what the exposure ' +
        'is now, and add or remove the route here. Adding an upload endpoint is not a defect; adding ' +
        'one without re-checking the acknowledgement is what let a false claim stand for sixteen days ' +
        '(IMPROVEMENTS § 1.82).',
    ).toEqual([...KNOWN_MULTIPART_ENTRY_POINTS].sort());
  });

  it('is not vacuous — the markers really do match this codebase', () => {
    // Without this, a typo in every marker would make `found` empty, the list would have to be emptied
    // to match, and the guard would then pass forever while asserting nothing. The same non-vacuity
    // floor the audit-action parity and negative-assertion guards carry.
    expect(found.length).toBeGreaterThan(0);
  });
});
