import { describe, expect, it } from 'vitest';
import {
  buildExecutiveDashboardSummary,
  buildExecutiveHeadlines,
} from './executive-dashboard.config';
import type { SalesDashboardSummary } from './sales-dashboard.config';
import type { PolicyDashboardSummary } from './policy-dashboard.config';
import type { ClaimsDashboardSummary } from './claims-dashboard.config';
import type { FinancialDashboardSummary } from './financial-dashboard.config';
import type { ComplianceDashboardSummary } from './compliance-dashboard.config';

const sales = {
  generatedAt: '2026-09-09T00:00:00.000Z',
  periodLabel: '2026-08',
  periodStart: '2026-08-01T00:00:00.000Z',
  periodEnd: '2026-08-31T23:59:59.999Z',
  leads: {
    newLeadsCount: 12,
    convertedToProspectCount: 3,
    conversionRatePercent: 25,
  },
  premiumWritten: { newJod: '1000.000', renewalJod: '0.000' },
  commissionIncomeJod: '125.000',
  crossSell: { openCount: 0, convertedCount: 0, conversionRatePercent: 0 },
  upSell: { openCount: 0, convertedCount: 0, conversionRatePercent: 0 },
} as unknown as SalesDashboardSummary;

const policy = {
  activePoliciesCount: 40,
  expiringPoliciesCount: 5,
  newPoliciesIssuedCount: 7,
  cancelledPolicies: [],
} as unknown as PolicyDashboardSummary;

const claims = {
  openClaimsCount: 4,
  closedClaimsCount: 11,
  outstandingClaimsValueJod: '8000.000',
} as unknown as ClaimsDashboardSummary;

const financial = {
  asOf: '2026-09-01T00:00:00.000Z',
  receivables: { totals: { outstandingTotal: '5000.000' } },
  payables: { totals: { outstandingAmount: '3000.000' } },
} as unknown as FinancialDashboardSummary;

const compliance = {
  dsr: { openCount: 2, byStatus: {} },
  complianceExceptions: {
    openAmlAlertsCount: 3,
    amlByPatternType: {},
    lastSelfApprovalScan: null,
  },
  breachRegister: { openCount: 1, byStatus: {} },
} as unknown as ComplianceDashboardSummary;

const sections = { sales, policy, claims, financial, compliance };

describe('buildExecutiveHeadlines (Process 64)', () => {
  it('lifts each headline verbatim from the dashboard that produced it', () => {
    const h = buildExecutiveHeadlines(sections);
    expect(h).toEqual({
      newLeadsCount: 12,
      leadConversionRatePercent: 25,
      commissionIncomeJod: '125.000',
      activePoliciesCount: 40,
      expiringPoliciesCount: 5,
      openClaimsCount: 4,
      outstandingClaimsValueJod: '8000.000',
      receivablesOutstandingJod: '5000.000',
      payablesOutstandingJod: '3000.000',
      openDsrCount: 2,
      openComplianceExceptionsCount: 4, // 3 open AML alerts + 1 open breach
    });
  });

  it('never re-derives a money figure — the strings are the source dashboards own', () => {
    const h = buildExecutiveHeadlines(sections);
    // Identity with the section payload is the whole point: an executive
    // summary that disagrees with the dashboard it summarises is worse than
    // no summary (IMPROVEMENTS.md §3.1's two-sources-of-truth lesson).
    expect(h.commissionIncomeJod).toBe(sales.commissionIncomeJod);
    expect(h.receivablesOutstandingJod).toBe(
      financial.receivables.totals.outstandingTotal,
    );
    expect(h.payablesOutstandingJod).toBe(
      financial.payables.totals.outstandingAmount,
    );
    expect(h.outstandingClaimsValueJod).toBe(claims.outstandingClaimsValueJod);
  });

  it('pools AML alerts and breach-register entries into one exceptions count', () => {
    const h = buildExecutiveHeadlines({
      ...sections,
      compliance: {
        ...compliance,
        complianceExceptions: {
          ...compliance.complianceExceptions,
          openAmlAlertsCount: 0,
        },
        breachRegister: { openCount: 0, byStatus: {} },
      },
    });
    expect(h.openComplianceExceptionsCount).toBe(0);
  });
});

describe('buildExecutiveDashboardSummary', () => {
  it('echoes the resolved window and reference date, and carries every section', () => {
    const view = buildExecutiveDashboardSummary({
      now: new Date('2026-09-09T12:00:00.000Z'),
      ...sections,
    });
    expect(view.generatedAt).toBe('2026-09-09T12:00:00.000Z');
    expect(view.periodLabel).toBe('2026-08');
    expect(view.asOf).toBe('2026-09-01T00:00:00.000Z');
    expect(view.sales).toBe(sales);
    expect(view.policy).toBe(policy);
    expect(view.claims).toBe(claims);
    expect(view.financial).toBe(financial);
    expect(view.compliance).toBe(compliance);
  });
});
