import { describe, expect, it } from 'vitest';
import {
  buildCustomerTimeline,
  type TimelineClaim,
  type TimelineComplaint,
  type TimelineInteraction,
  type TimelinePolicy,
} from './crm.config';

function interaction(
  over: Partial<TimelineInteraction> &
    Pick<TimelineInteraction, 'id' | 'occurredAt'>,
): TimelineInteraction {
  return {
    channel: 'CALL',
    summary: 'Called the client',
    loggedByUserId: 'u-1',
    ...over,
  };
}

describe('buildCustomerTimeline', () => {
  it('returns [] for a customer with nothing logged', () => {
    expect(
      buildCustomerTimeline({
        interactions: [],
        policies: [],
        claims: [],
        complaints: [],
      }),
    ).toEqual([]);
  });

  it('maps interactions newest-first', () => {
    const timeline = buildCustomerTimeline({
      interactions: [
        interaction({ id: 'a', occurredAt: new Date('2026-01-01T00:00:00Z') }),
        interaction({ id: 'b', occurredAt: new Date('2026-03-01T00:00:00Z') }),
        interaction({ id: 'c', occurredAt: new Date('2026-02-01T00:00:00Z') }),
      ],
      policies: [],
      claims: [],
      complaints: [],
    });

    expect(timeline.map((e) => e.refId)).toEqual(['b', 'c', 'a']);
    expect(timeline[0]).toMatchObject({
      kind: 'INTERACTION',
      title: 'CALL',
      detail: 'Called the client',
      status: null,
    });
  });

  it('interleaves all four kinds by their representative instant', () => {
    const policy: TimelinePolicy = {
      id: 'p-1',
      policyNumber: 'MP-2024-11',
      insuranceLine: 'Property All Risks',
      status: 'ACTIVE',
      inceptionDate: new Date('2026-02-15T00:00:00Z'),
      expiryDate: null,
      createdAt: new Date('2026-02-01T00:00:00Z'),
    };
    const claim: TimelineClaim = {
      id: 'c-1',
      claimNumber: 'CLM-9',
      status: 'NOTIFIED',
      lossDate: new Date('2026-03-10T00:00:00Z'),
      createdAt: new Date('2026-03-12T00:00:00Z'),
    };
    const complaint: TimelineComplaint = {
      id: 'x-1',
      issue: 'Delayed policy issuance',
      category: 'delayed_issuance',
      status: 'LOGGED',
      createdAt: new Date('2026-01-20T00:00:00Z'),
      closedAt: null,
    };

    const timeline = buildCustomerTimeline({
      interactions: [
        interaction({
          id: 'i-1',
          occurredAt: new Date('2026-02-20T00:00:00Z'),
        }),
      ],
      policies: [policy],
      claims: [claim],
      complaints: [complaint],
    });

    expect(timeline.map((e) => [e.kind, e.refId])).toEqual([
      ['CLAIM', 'c-1'], // 2026-03-10 (lossDate)
      ['INTERACTION', 'i-1'], // 2026-02-20
      ['POLICY', 'p-1'], // 2026-02-15 (inceptionDate, not createdAt)
      ['COMPLAINT', 'x-1'], // 2026-01-20
    ]);
  });

  it('labels an unnumbered policy / claim, falls back to createdAt when a policy has no inception date, and never puts loss detail on a claim', () => {
    const timeline = buildCustomerTimeline({
      interactions: [],
      policies: [
        {
          id: 'p-2',
          policyNumber: null,
          insuranceLine: 'Motor Fleet',
          status: 'PLACEMENT_CONFIRMED',
          inceptionDate: null,
          expiryDate: null,
          createdAt: new Date('2026-05-01T00:00:00Z'),
        },
      ],
      claims: [
        {
          id: 'c-2',
          claimNumber: null,
          status: 'UNDER_ASSESSMENT',
          lossDate: new Date('2026-04-01T00:00:00Z'),
          createdAt: new Date('2026-04-02T00:00:00Z'),
        },
      ],
      complaints: [],
    });

    const policyEvent = timeline.find((e) => e.kind === 'POLICY');
    const claimEvent = timeline.find((e) => e.kind === 'CLAIM');
    expect(policyEvent).toMatchObject({
      title: 'Policy (unnumbered)',
      at: new Date('2026-05-01T00:00:00Z'),
    });
    expect(claimEvent).toMatchObject({
      title: 'Claim (unnumbered)',
      detail: null,
    });
  });

  it('shows a complaint category when present and just "Complaint" when not', () => {
    const [withCat, withoutCat] = buildCustomerTimeline({
      interactions: [],
      policies: [],
      claims: [],
      complaints: [
        {
          id: 'x-2',
          issue: 'Premium dispute',
          category: 'premium_dispute',
          status: 'IN_PROGRESS',
          createdAt: new Date('2026-06-02T00:00:00Z'),
          closedAt: null,
        },
        {
          id: 'x-3',
          issue: 'General grumble',
          category: null,
          status: 'LOGGED',
          createdAt: new Date('2026-06-01T00:00:00Z'),
          closedAt: null,
        },
      ],
    });

    expect(withCat.title).toBe('Complaint — premium_dispute');
    expect(withoutCat.title).toBe('Complaint');
  });

  it('breaks an exact-instant tie deterministically (kind order, then refId)', () => {
    const at = new Date('2026-07-01T00:00:00Z');
    const timeline = buildCustomerTimeline({
      interactions: [
        interaction({ id: 'i-z', occurredAt: at }),
        interaction({ id: 'i-a', occurredAt: at }),
      ],
      policies: [
        {
          id: 'p-9',
          policyNumber: 'P9',
          insuranceLine: 'Public Liability',
          status: 'ACTIVE',
          inceptionDate: at,
          expiryDate: null,
          createdAt: at,
        },
      ],
      claims: [
        {
          id: 'c-9',
          claimNumber: 'C9',
          status: 'NOTIFIED',
          lossDate: at,
          createdAt: at,
        },
      ],
      complaints: [],
    });

    // Same instant everywhere -> KIND_ORDER decides: INTERACTION (0), then
    // CLAIM (1), then POLICY (2); refId breaks the two interactions.
    expect(timeline.map((e) => e.refId)).toEqual(['i-a', 'i-z', 'c-9', 'p-9']);
  });
});
