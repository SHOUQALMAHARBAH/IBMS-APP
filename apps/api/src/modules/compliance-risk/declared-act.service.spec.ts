import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DECLARATION_REASON_MIN_LENGTH } from '../../common/declaration-reason';

import { ARTICLE_15_D } from './declared-act.config';
import {
  DeclaredActService,
  type DeclareArticle15DInput,
} from './declared-act.service';

/**
 * The declared-act service — module-1 paper §٨, OWNER DECISION 126.
 *
 * Each test names the ELEMENT it proves, so a reader can check the nine against this file rather
 * than against a summary of it.
 */

const created = { id: 'act-1' };

function makeService() {
  const create = vi.fn().mockResolvedValue(created);
  const findForRecord = vi.fn().mockResolvedValue([]);
  const service = new DeclaredActService({
    create,
    findForRecord,
  } as unknown as ConstructorParameters<typeof DeclaredActService>[0]);
  return { service, create, findForRecord };
}

function input(
  overrides: Partial<DeclareArticle15DInput> = {},
): DeclareArticle15DInput {
  return {
    reason: 'the client instructed us to approach this insurer only',
    entity: 'RFQ',
    entityId: 'rfq-1',
    transactionRef: 'TX-0001',
    actorUserId: 'user-1',
    actorNameShown: 'سامر عبد الله',
    networkAddress: '198.51.100.7',
    acknowledged: true,
    ...overrides,
  };
}

describe('DeclaredActService.declareArticle15D', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => {
    ctx = makeService();
  });

  it('ELEMENTS 1 and 4 — stores the article text and acknowledgement from the CONFIG, never from the caller', async () => {
    await ctx.service.declareArticle15D(input());
    const payload = ctx.create.mock.calls[0][0] as Record<string, unknown>;

    expect(payload.articleTextShown).toBe(ARTICLE_15_D.articleText);
    expect(payload.acknowledgementTextShown).toBe(
      ARTICLE_15_D.acknowledgementText,
    );
    // The input type has no field for either, so a caller CANNOT supply one. This asserts the
    // consequence rather than the type: a caller that could pass its own article text could record
    // a sentence nobody was ever shown, which is the one thing elements 1 and 4 exist to prevent.
    expect(Object.keys(input())).not.toContain('articleTextShown');
    expect(Object.keys(input())).not.toContain('acknowledgementTextShown');
  });

  it('ELEMENT 9 — the stored acknowledgement carries the release AND its limit together', async () => {
    await ctx.service.declareArticle15D(input());
    const payload = ctx.create.mock.calls[0][0] as {
      acknowledgementTextShown: string;
    };
    // Asserted on what is WRITTEN, not on the constant: `declared-act.config.spec.ts` pins the
    // constant to the adviser's file, and this pins what reaches the row. A service that composed
    // its own acknowledgement would pass that spec and fail this one.
    expect(payload.acknowledgementTextShown).toContain(
      'إبراء ذمة الشركة المطورة',
    );
    expect(payload.acknowledgementTextShown).toContain('الجزائية');
  });

  it('ELEMENT 6 — writes the responsibility sentence as a SENTENCE, not an inference', async () => {
    await ctx.service.declareArticle15D(input());
    const payload = ctx.create.mock.calls[0][0] as {
      responsibilitySentence: string;
    };
    expect(payload.responsibilitySentence).toBe(
      ARTICLE_15_D.responsibilitySentence,
    );
    expect(payload.responsibilitySentence.trim().length).toBeGreaterThan(0);
  });

  it('ELEMENT 3 — records THIS SITE’S own permission, which is not the permission to send the request', async () => {
    await ctx.service.declareArticle15D(input());
    const payload = ctx.create.mock.calls[0][0] as { permissionCode: string };
    expect(payload.permissionCode).toBe(ARTICLE_15_D.permissionCode);
    // Module paper §٤.١: whoever can act is not thereby able to declare. `rfq.create` is the
    // permission to SEND a quote request; it must never be what a declaration records.
    expect(payload.permissionCode).not.toBe('rfq.create');
  });

  it('ELEMENT 4 — refuses an acknowledgement that was not ticked', async () => {
    await expect(
      ctx.service.declareArticle15D(input({ acknowledged: false })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      ctx.create,
      'an unticked acknowledgement still wrote a row — an unticked box is not a weaker declaration, it is none at all',
    ).not.toHaveBeenCalled();
  });

  it('ELEMENT 2 — refuses a reason below the ONE shared floor, and the floor is the shared constant', async () => {
    const tooShort = 'x'.repeat(DECLARATION_REASON_MIN_LENGTH - 1);
    await expect(
      ctx.service.declareArticle15D(input({ reason: tooShort })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.create).not.toHaveBeenCalled();

    // And exactly AT the floor is accepted — a boundary asserted in both directions, because an
    // off-by-one here refuses a reason the database would have taken.
    await ctx.service.declareArticle15D(
      input({ reason: 'y'.repeat(DECLARATION_REASON_MIN_LENGTH) }),
    );
    expect(ctx.create).toHaveBeenCalledTimes(1);
  });

  it('ELEMENT 2 — measures the reason AFTER trimming, so whitespace cannot clear the floor', async () => {
    await expect(
      ctx.service.declareArticle15D({
        ...input(),
        reason: `  ${'z'.repeat(DECLARATION_REASON_MIN_LENGTH - 2)}  `,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // The database agrees: its CHECK is `length(btrim("reason")) >= 10`. If this service measured
    // the untrimmed string, a reason that passed here would be refused at the INSERT — a 500 where
    // a 400 belongs, which is the recorded declaration-floor drift.
    expect(ctx.create).not.toHaveBeenCalled();
  });

  it('stores the trimmed reason, so the record holds the words and not the padding', async () => {
    await ctx.service.declareArticle15D(
      input({ reason: '   a reason with padding around it   ' }),
    );
    const payload = ctx.create.mock.calls[0][0] as { reason: string };
    expect(payload.reason).toBe('a reason with padding around it');
  });

  it('THE ADVISER’S HARDENING — carries the name, the transaction number and the network address', async () => {
    await ctx.service.declareArticle15D(input());
    const payload = ctx.create.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.actorNameShown).toBe('سامر عبد الله');
    expect(payload.transactionRef).toBe('TX-0001');
    expect(payload.networkAddress).toBe('198.51.100.7');
  });

  it('accepts a NULL network address rather than inventing one', async () => {
    // `clientIpForRecord` returns null where `clientIpOf` would return the string 'unknown'. A row
    // reading 'unknown' would claim an address it does not have, and an inspector could not tell
    // that from a host genuinely so named.
    await ctx.service.declareArticle15D(input({ networkAddress: null }));
    const payload = ctx.create.mock.calls[0][0] as { networkAddress: unknown };
    expect(payload.networkAddress).toBeNull();
  });

  it('does not set organizationId — the session GUC and the tenancy extension do', async () => {
    await ctx.service.declareArticle15D(input());
    const payload = ctx.create.mock.calls[0][0] as Record<string, unknown>;
    expect(
      'organizationId' in payload,
      'the service passed organizationId by hand. The column defaults from `app.current_org_id` and `tenantScopeExtension` supplies it; a second answer to *which office is acting* is how they drift.',
    ).toBe(false);
  });
});
