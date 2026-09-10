import { describe, expect, it } from 'vitest';
import { SLA_REGISTRY } from './sla-registry.config';
import {
  SLA_POLICY_SOURCES,
  slaPolicyCodeFor,
} from './sla-policy-source.config';
import { buildSlaPolicySeed } from './sla-policy-seed.builder';
import { SLA_POLICY_SEEDS } from '../../../../../packages/db/prisma/seed-data/sla-policies';

describe('every SLA states where it comes from', () => {
  it('covers every registry entry — none may default to a source type', () => {
    const missing = SLA_REGISTRY.map((e) => e.workflowName).filter(
      (name) => !SLA_POLICY_SOURCES[name],
    );
    expect(missing).toEqual([]);
  });

  it('has no orphan entries left behind by a renamed workflow', () => {
    const known = new Set(SLA_REGISTRY.map((e) => e.workflowName));
    expect(
      Object.keys(SLA_POLICY_SOURCES).filter((k) => !known.has(k)),
    ).toEqual([]);
  });
});

describe('REGULATORY means an instrument is named', () => {
  it('every REGULATORY policy cites a reference AND a document', () => {
    // The DB CHECK enforces this too. Both exist because this is the one claim
    // the system makes that a regulator could take issue with.
    for (const [workflow, source] of Object.entries(SLA_POLICY_SOURCES)) {
      if (source.sourceType !== 'REGULATORY') continue;
      expect(source.sourceReference?.trim(), workflow).toBeTruthy();
      expect(source.sourceDocument?.trim(), workflow).toBeTruthy();
    }
  });

  it('the builder REFUSES a regulatory claim with no instrument', () => {
    expect(() =>
      buildSlaPolicySeed([SLA_REGISTRY[0]], {
        [SLA_REGISTRY[0].workflowName]: {
          sourceType: 'REGULATORY',
          sourceReference: null,
          sourceDocument: null,
          sourceSection: null,
          rationale: 'bogus',
        },
      }),
    ).toThrow(/REGULATORY but names no instrument/);
  });

  it('refuses an entry with no provenance at all rather than defaulting one', () => {
    expect(() => buildSlaPolicySeed([SLA_REGISTRY[0]], {})).toThrow(
      /no provenance/,
    );
  });
});

describe('a DRAFT, UNSOURCED figure is never classified as law', () => {
  // This is the whole point of the feature. Five registry entries carry
  // "DRAFT, UNSOURCED" in their own citation; presenting any of them as a
  // legal requirement is the failure being fixed.
  const draftedWorkflows = SLA_REGISTRY.filter((e) =>
    e.citation.includes('DRAFT, UNSOURCED'),
  ).map((e) => e.workflowName);

  it('finds the drafted entries (guards the premise of the test below)', () => {
    expect(draftedWorkflows.length).toBeGreaterThan(0);
  });

  it.each(draftedWorkflows)('%s is NOT REGULATORY', (workflow) => {
    expect(SLA_POLICY_SOURCES[workflow].sourceType).not.toBe('REGULATORY');
  });

  it('specifically: the sanctions-match 3-business-day figure is INTERNAL_POLICY', () => {
    // Named explicitly because it is the figure that prompted this work: it
    // was drafted in this repo, tighter than the standard KYC review, on
    // reasoning that is the broker's and not a regulator's.
    const source = SLA_POLICY_SOURCES.sanctions_match_review;
    expect(source.sourceType).toBe('INTERNAL_POLICY');
    expect(source.sourceDocument).toBeNull();
  });

  it('does NOT mistake a NEGATED citation for a real one', () => {
    // vendor_termination_access_revocation's citation contains the string
    // "PRIV-SOP" inside the phrase "no independent PRIV-SOP figure
    // identified". A substring classifier reads that negation as a citation
    // and stamps the SLA regulatory — which is exactly the mislabelling this
    // feature exists to prevent, so the classification is explicit per entry.
    const entry = SLA_REGISTRY.find(
      (e) => e.workflowName === 'vendor_termination_access_revocation',
    );
    expect(entry?.citation).toMatch(/PRIV-SOP/);
    expect(entry?.citation).toMatch(/no independent PRIV-SOP figure/);
    expect(
      SLA_POLICY_SOURCES.vendor_termination_access_revocation.sourceType,
    ).not.toBe('REGULATORY');
  });
});

describe('policy codes are stable identifiers', () => {
  it('derives from the workflow name and is unique across the registry', () => {
    expect(slaPolicyCodeFor('dsr_access_deletion')).toBe(
      'SLA-DSR-ACCESS-DELETION',
    );
    const codes = SLA_REGISTRY.map((e) => slaPolicyCodeFor(e.workflowName));
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('the generated seed file has not drifted from its sources', () => {
  // packages/db cannot import from apps/api, so the seed carries its own copy
  // of the table. This is what stops that copy becoming a second, wrong source
  // of a DEADLINE.
  //
  // Compares the IMPORTED module, not the file text. An earlier version parsed
  // the file with a regex and JSON.parse, which broke the moment prettier
  // reformatted the generated output into TypeScript object syntax — a test
  // that fails on formatting is a test people learn to ignore.
  it('matches a fresh build from SLA_REGISTRY + SLA_POLICY_SOURCES', () => {
    const fresh = buildSlaPolicySeed(SLA_REGISTRY, SLA_POLICY_SOURCES);
    expect(SLA_POLICY_SEEDS).toEqual(fresh);
  });

  it('every seeded policy has a stable code and a provenance', () => {
    for (const row of SLA_POLICY_SEEDS) {
      expect(row.policyCode).toMatch(/^SLA-[A-Z0-9-]+$/);
      expect(row.sourceType).toBeTruthy();
      if (row.sourceType === 'REGULATORY') {
        expect(row.sourceReference, row.policyCode).toBeTruthy();
        expect(row.sourceDocument, row.policyCode).toBeTruthy();
      }
    }
  });
});
