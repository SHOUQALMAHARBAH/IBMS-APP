"use client";

import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth/auth-context";
import {
  getPendingMatchCount,
  listScreeningMatches,
  reviewScreeningMatch,
  type ScreeningMatch,
  type ScreeningMatchStatus,
} from "../../../lib/screening/screening-match-api";
import { ApiError } from "../../../lib/auth/api-client";
import { errorStyle } from "../../../components/auth/auth-form.styles";
import { pageStyle } from "../../../components/lead/lead.styles";
import { useLanguage } from "../../../lib/i18n/language-context";
import { hasPermission } from '../../../lib/auth/permissions';

const STATUSES: ScreeningMatchStatus[] = ["pending", "confirmed", "cleared"];
/** Mirrors the DTO's own floor, so the button disables instead of the server
 * rejecting a too-short reason after a round trip. */
const MIN_REASON = 10;

const cell: CSSProperties = {
  padding: "0.4rem 0.75rem",
  borderBottom: "1px solid #e5e7eb",
  textAlign: "start",
  verticalAlign: "top",
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: "2px solid #d1d5db",
};

export default function ScreeningMatchesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canReview = hasPermission(user, 'sanctions-pep.screen');

  const [status, setStatus] = useState<ScreeningMatchStatus>("pending");
  const [rows, setRows] = useState<ScreeningMatch[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  // null = not yet known. false = the synced sanctions cache is EMPTY.
  const [watchlistReady, setWatchlistReady] = useState<boolean | null>(null);

  const load = useCallback(
    async (next: ScreeningMatchStatus) => {
      try {
        setRows(await listScreeningMatches(next));
        setLoadError(null);
      } catch (err) {
        setRows(null);
        setLoadError(
          err instanceof ApiError && err.status === 403
            ? t('smYouDonTHoldThe')
            : err instanceof ApiError
              ? err.message
              : t('smCouldNotLoadTheMatch'),
        );
      }
    },
    [t],
  );

  useEffect(() => {
    if (!isLoading && !user) router.push("/login");
  }, [isLoading, user, router, t]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load(status);
    })();
  }, [user, status, load, t]);

  // An EMPTY queue is ambiguous: "nothing matched" and "nothing was ever
  // checked" look identical on this screen, and the second is the state every
  // deployment of this system is actually in — the sync has never been run.
  // Without this the page quietly reassures a Compliance Officer.
  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        setWatchlistReady((await getPendingMatchCount()).watchlistReady);
      } catch {
        setWatchlistReady(null); // unknown; say nothing rather than guess
      }
    })();
  }, [user, t]);

  async function decide(
    id: string,
    decision: "cleared" | "confirmed",
  ): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      await reviewScreeningMatch(id, decision, reasons[id] ?? "");
      setReasons((r) => ({ ...r, [id]: "" }));
      await load(status);
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : t('smRecordingThatDecisionFailedTry'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>
        {t('smSanctionsMatchReview')}
      </h1>
      <p style={{ opacity: 0.75, maxWidth: "46rem" }}>
        {t('smNamesAreCheckedAgainstThe')}
      </p>

      <div style={{ display: "flex", gap: "0.4rem", margin: "1rem 0" }}>
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            disabled={busy}
            style={{ fontWeight: s === status ? 700 : 400 }}
          >
            {s}
          </button>
        ))}
      </div>

      {watchlistReady === false ? (
        <p
          role="alert"
          style={{
            ...errorStyle,
            padding: "0.75rem",
            border: "1px solid currentColor",
            borderRadius: 4,
          }}
        >
          {t('smTheLocalSanctionsListIs')}
        </p>
      ) : null}

      {actionError ? (
        <p role="alert" style={errorStyle}>
          {actionError}
        </p>
      ) : null}
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <p style={{ opacity: 0.6 }}>
            {status === "pending"
              ? t('smNothingAwaitingReview')
              : t('smNoRecords')}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", minWidth: "62rem" }}>
              <thead>
                <tr>
                  <th style={head}>{t('smCustomer')}</th>
                  <th style={head}>
                    {t('smMatchedName')}
                  </th>
                  <th style={head}>
                    {t('smListEntry')}
                  </th>
                  <th style={head}>{t('smType')}</th>
                  <th style={head}>{t('smDetected')}</th>
                  <th style={head}>
                    {status === "pending"
                      ? t('smDecision')
                      : t('smReview')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>
                      {r.customerLegalName}
                      {r.isEdd ? (
                        <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>
                          {t('smEdd')}
                        </div>
                      ) : null}
                    </td>
                    <td style={cell}>{r.subjectName}</td>
                    <td style={cell}>
                      {r.listEntryName}
                      <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>
                        {r.listSource}
                      </div>
                      {r.listEntryDelisted ? (
                        <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>
                          {t('smNoLongerOnTheSource')}
                        </div>
                      ) : null}
                    </td>
                    <td style={cell}>{r.matchType}</td>
                    <td style={cell}>{r.detectedAt.slice(0, 10)}</td>
                    <td style={cell}>
                      {r.status !== "pending" ? (
                        <div style={{ fontSize: "0.85rem" }}>
                          <strong>{r.status}</strong>
                          <div style={{ opacity: 0.75 }}>{r.reviewReason}</div>
                        </div>
                      ) : canReview ? (
                        <div style={{ display: "grid", gap: "0.3rem" }}>
                          <textarea
                            aria-label={`Review reason for ${r.subjectName}`}
                            value={reasons[r.id] ?? ""}
                            onChange={(e) =>
                              setReasons((prev) => ({
                                ...prev,
                                [r.id]: e.target.value,
                              }))
                            }
                            rows={2}
                            placeholder={
                              t('smReasonForTheDecisionMin')
                            }
                            style={{ minWidth: "18rem" }}
                          />
                          <div style={{ display: "flex", gap: "0.3rem" }}>
                            <button
                              type="button"
                              disabled={
                                busy ||
                                (reasons[r.id]?.trim().length ?? 0) < MIN_REASON
                              }
                              onClick={() => void decide(r.id, "cleared")}
                            >
                              {t('smClearFalsePositive')}
                            </button>
                            <button
                              type="button"
                              disabled={
                                busy ||
                                (reasons[r.id]?.trim().length ?? 0) < MIN_REASON
                              }
                              onClick={() => void decide(r.id, "confirmed")}
                            >
                              {t('smConfirmMatch')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span style={{ opacity: 0.6 }}>
                          {t('smComplianceOfficerOnly')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loadError ? null : (
        // The loading state directive §2 requires; this page rendered
        // nothing at all while fetching. Guarded on loadError so an error
        // and a "Loading…" line never appear together.
        <p>{t('smLoading')}</p>
      )}
    </main>
  );
}
