'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getComplianceDashboard,
  type ComplianceDashboardSummary,
} from '../../../../lib/management-reporting/compliance-dashboard-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const statStyle: CSSProperties = { fontSize: '1.4rem', fontWeight: 600 };

function BreakdownTable({ title, rows }: { title: string; rows: Record<string, number> }) {
  const entries = Object.entries(rows);
  return (
    <section style={sectionStyle}>
      <h3>{title}</h3>
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {entries.map(([key, count]) => (
            <tr key={key}>
              <td style={{ padding: '0.15rem 0.75rem 0.15rem 0' }}>{key}</td>
              <td style={{ padding: '0.15rem 0', fontWeight: 600 }}>{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function ComplianceDashboardPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [summary, setSummary] = useState<ComplianceDashboardSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [branchId, setBranchId] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  const load = useCallback(async () => {
    try {
      setSummary(await getComplianceDashboard({ branchId: branchId.trim() || undefined }));
      setLoadError(null);
    } catch (err) {
      setSummary(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the dashboard.compliance.view permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load the Compliance Dashboard — try again.',
      );
    }
  }, [branchId]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
    // Filters apply on explicit "Apply filters" submit only — see below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function applyFilters(ev: React.FormEvent) {
    ev.preventDefault();
    void load();
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Compliance Dashboard</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        A live, current-state rollup — KYC status, complaints by status/category,
        compliance exceptions (open AML alerts and the latest self-approval
        scan), regulatory filing status, open DSRs, breach-register status, and
        the DPIA backlog. Branch scoping applies only to KYC, complaints, DSRs,
        and AML alerts — the regulatory calendar, breach register, and DPIA
        screenings carry no branch/owner dimension.
      </p>

      <form
        onSubmit={applyFilters}
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          Branch ID
          <input aria-label="Branch ID filter" value={branchId} onChange={(e) => setBranchId(e.target.value)} />
        </label>
        <button type="submit">Apply filters</button>
      </form>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {summary ? (
        <>
          <BreakdownTable title="KYC status" rows={summary.kyc.byStatus} />

          <BreakdownTable title="Complaints by status" rows={summary.complaints.byStatus} />
          <BreakdownTable title="Complaints by category" rows={summary.complaints.byCategory} />

          <section style={sectionStyle}>
            <h2>Compliance exceptions</h2>
            <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start' }}>
              <div>
                <div style={statStyle}>{summary.complianceExceptions.openAmlAlertsCount}</div>
                <div>Open AML/CFT alerts</div>
              </div>
              <div>
                <div style={statStyle}>
                  {summary.complianceExceptions.lastSelfApprovalScan?.violationCount ?? '—'}
                </div>
                <div>
                  Self-approval violations
                  {summary.complianceExceptions.lastSelfApprovalScan
                    ? ` (as of ${summary.complianceExceptions.lastSelfApprovalScan.asOf.slice(0, 10)})`
                    : ' (no scan has run yet)'}
                </div>
              </div>
            </div>
            <BreakdownTable title="AML alerts by pattern type" rows={summary.complianceExceptions.amlByPatternType} />
          </section>

          <section style={sectionStyle}>
            <h2>Regulatory filing / report status</h2>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={statStyle}>{summary.regulatoryFilings.submittedCount}</div>
                <div>Submitted</div>
              </div>
              <div>
                <div style={statStyle}>{summary.regulatoryFilings.pendingCount}</div>
                <div>Pending</div>
              </div>
              <div>
                <div style={statStyle}>{summary.regulatoryFilings.overdueCount}</div>
                <div>Overdue</div>
              </div>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>Open DSRs</h2>
            <div style={statStyle}>{summary.dsr.openCount}</div>
            <BreakdownTable title="By status" rows={summary.dsr.byStatus} />
          </section>

          <section style={sectionStyle}>
            <h2>Breach-register status</h2>
            <div style={statStyle}>{summary.breachRegister.openCount} open</div>
            <BreakdownTable title="By status" rows={summary.breachRegister.byStatus} />
          </section>

          <section style={sectionStyle}>
            <h2>DPIA backlog</h2>
            <div style={statStyle}>{summary.dpiaBacklog.pendingReviewCount}</div>
            <BreakdownTable title="By outcome" rows={summary.dpiaBacklog.byOutcome} />
          </section>
        </>
      ) : loadError ? null : (
        <p>Loading&hellip;</p>
      )}
    </main>
  );
}
