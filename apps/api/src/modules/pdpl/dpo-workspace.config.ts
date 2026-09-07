import type { DataSubjectRequestView } from './dsr.config';
import type { IncidentReportView } from '../compliance-risk/incident.config';
import type { DpiaScreeningView } from './dpia-screening.config';
import type { LegalHoldView } from './legal-hold.config';
import type { CrossBorderTransferRecordView } from './cross-border-transfer.config';
import type { ConsentRecordView } from './consent.config';

/**
 * Backlog Part D §5.1, Process #52 item #9 — "A DPO Workspace screen
 * aggregating consent status + the DSR queue with SLA countdowns + the
 * incident/breach register + the DPIA register + the Legal Hold register +
 * the cross-border transfer register, on one screen."
 *
 * Zero cross-module SERVICE dependency, the #58 KPI Dashboard / #63
 * Profitability Analysis shape — `DpoWorkspaceService` reads five
 * already-built PDPL repositories directly (Consent, DSR, DPIA, Legal
 * Hold, Cross-Border Transfer, all in THIS module) plus ONE cross-module
 * repository, `IncidentRepository` (`compliance-risk`), injected directly
 * rather than importing `ComplianceRiskModule` — the established "give the
 * other module's repository, not the whole module" pattern.
 *
 * `dpo-workspace.view` is a GENUINELY NEW permission (DPO-only) — unlike
 * every other Part D item, no permission was pre-seeded for this screen at
 * all (the #71 "vendor_termination_access_revocation... a genuine gap, not
 * dormant" precedent, applied to a permission code instead of an SLA
 * entry).
 *
 * Each register section reuses its OWNING module's already-derived "View"
 * shape verbatim — no new projection logic duplicates what
 * `deriveDsrView`/`deriveIncidentReportView`/`deriveDpiaScreeningView`/
 * `deriveLegalHoldView`/`deriveCrossBorderTransferView`/`deriveConsentView`
 * already compute. The DSR queue additionally carries a plain
 * `daysUntilDue` — calendar-day arithmetic against the SAME `slaDueAt` the
 * DSR module already computed (business-day-aware, at creation time); this
 * is a quick-glance countdown for a dashboard read, not a second SLA
 * computation. Each register is filtered to what a DPO actually needs to
 * act on (open DSRs, non-CLOSED incidents, DPIA screenings awaiting
 * review, active Legal Holds) except cross-border transfers, which have no
 * "open/closed" concept — the most recent N are shown instead.
 */
export interface DsrQueueItem extends DataSubjectRequestView {
  /** Whole calendar days until slaDueAt; negative if already overdue. */
  daysUntilDue: number;
}

export interface ConsentStatusSummary {
  activeCount: number;
  withdrawnCount: number;
  declinedCount: number;
}

export interface DpoWorkspaceSummary {
  generatedAt: string;
  consentStatus: ConsentStatusSummary;
  dsrQueue: DsrQueueItem[];
  incidentRegister: IncidentReportView[];
  dpiaRegister: DpiaScreeningView[];
  legalHoldRegister: LegalHoldView[];
  crossBorderTransferRegister: CrossBorderTransferRecordView[];
}

export function computeDaysUntilDue(slaDueAtIso: string, now: Date): number {
  const ms = new Date(slaDueAtIso).getTime() - now.getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export function summarizeConsentStatus(
  rows: ConsentRecordView[],
): ConsentStatusSummary {
  let activeCount = 0;
  let withdrawnCount = 0;
  let declinedCount = 0;
  for (const r of rows) {
    if (r.isActive) activeCount++;
    else if (r.withdrawnAt) withdrawnCount++;
    else declinedCount++;
  }
  return { activeCount, withdrawnCount, declinedCount };
}
