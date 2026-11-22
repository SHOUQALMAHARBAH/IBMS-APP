import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { OPPORTUNITY_NOT_OPEN_FOR_RFQ } from './rfq-api';

/**
 * 🔴 OWNER DECISION 157 RULING 1 — THE CODE THE SCREEN READS IS THE CODE THE SERVER SENDS.
 *
 * `/rfqs/new` renders her ratified Arabic sentence, naming the opportunity's stage, when the api
 * refuses with `OPPORTUNITY_NOT_OPEN_FOR_RFQ`. The web and the api are separate builds and
 * nothing is imported across them, so the string is restated on the web side — the same shape
 * `isMfaEnrolmentError` already uses for `MFA_ENROLLMENT_REQUIRED`.
 *
 * ## Why a restated string needs a test and the MFA one got away without
 *
 * If this code is renamed on the server and not here, nothing breaks loudly. The refusal still
 * arrives, `err.code` simply stops matching, and the screen falls through to `err.message` —
 * which is the server's ENGLISH sentence, printed on an Arabic page. A silent reversion to
 * exactly the defect decision 157 was written to fix, visible only to someone who re-walks the
 * screen. So both ends are pinned, in both directions.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const API_CONFIG = join(
  REPO,
  'apps',
  'api',
  'src',
  'modules',
  'rfq',
  'rfq.config.ts',
);
const API_SERVICE = join(
  REPO,
  'apps',
  'api',
  'src',
  'modules',
  'rfq',
  'rfq.service.ts',
);

describe('owner decision 157 ruling 1 — the refusal code', () => {
  it('the web constant is the one the api declares', () => {
    const source = readFileSync(API_CONFIG, 'utf8');
    const found =
      /export const OPPORTUNITY_NOT_OPEN_FOR_RFQ = '([A-Z_]+)';/.exec(source);
    expect(
      found,
      'the api no longer declares OPPORTUNITY_NOT_OPEN_FOR_RFQ in rfq.config.ts',
    ).toBeTruthy();
    expect(OPPORTUNITY_NOT_OPEN_FOR_RFQ).toBe(found![1]);
  });

  it('and the service actually raises the refusal with it', () => {
    // NON-VACUITY. The constant could agree perfectly and be attached to nothing: a refusal that
    // carries no code makes the screen print English and this file would still be green.
    const source = readFileSync(API_SERVICE, 'utf8');
    expect(source).toContain('code: OPPORTUNITY_NOT_OPEN_FOR_RFQ');
  });

  it('and it sends the status beside it, which is what names the stage', () => {
    // Her sentence has a slot. Without this field the screen has a code and nothing to put in
    // it, and would fall back to the server's English — passing the first two tests.
    const source = readFileSync(API_SERVICE, 'utf8');
    expect(source).toContain('opportunityStatus: opportunity.status');
  });
});
