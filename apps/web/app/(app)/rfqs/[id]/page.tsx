'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  addRfqInsurers,
  getRfq,
  listSelectableInsurers,
  transitionRfqInsurer,
  RFQ_INSURER_TARGET_STATUSES,
  type Rfq,
  type RfqInsurerStatus,
  type SelectableInsurer,
} from '../../../../lib/rfq/rfq-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../../../../components/auth/auth-form.styles';
import { cardMetaStyle, pageStyle } from '../../../../components/lead/lead.styles';
import {
  insurerPickerStyle,
  rfqActionsStyle,
  rfqBadgeStyle,
  rfqCellStyle,
  rfqTableStyle,
} from '../../../../components/rfq/rfq.styles';

const PLACEMENT_ROLE = 'PLACEMENT_TECHNICAL_OFFICER';

function fmt(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : '—';
}

export default function RfqDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();

  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [insurers, setInsurers] = useState<SelectableInsurer[] | null>(null);
  const [toAdd, setToAdd] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRfq(await getRfq(params.id));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && (err.status === 403 || err.status === 404)
          ? 'This RFQ could not be found — it may not exist, or you may not have access to it.'
          : err instanceof ApiError
            ? err.message
            : 'Could not load this RFQ — try again.',
      );
    }
  }, [params.id]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load]);

  async function changeStatus(submissionId: string, toStatus: RfqInsurerStatus) {
    setRowError(null);
    setBusyRow(submissionId);
    try {
      await transitionRfqInsurer(submissionId, toStatus);
      await load();
    } catch (err) {
      setRowError(
        err instanceof ApiError
          ? err.message
          : 'Could not update the insurer status — try again.',
      );
    } finally {
      setBusyRow(null);
    }
  }

  async function openAdd() {
    setAdding(true);
    setAddError(null);
    if (insurers) return;
    try {
      setInsurers(await listSelectableInsurers());
    } catch (err) {
      setAddError(
        err instanceof ApiError
          ? err.message
          : 'Could not load the insurer list — try again.',
      );
    }
  }

  async function submitAdd() {
    if (!rfq || toAdd.size === 0) return;
    setAddBusy(true);
    setAddError(null);
    try {
      await addRfqInsurers(rfq.id, [...toAdd]);
      setToAdd(new Set());
      setAdding(false);
      await load();
    } catch (err) {
      setAddError(
        err instanceof ApiError
          ? err.message
          : 'Could not add insurers — try again.',
      );
    } finally {
      setAddBusy(false);
    }
  }

  if (isLoading || !user) return null;

  const isPlacement = user.roles.includes(PLACEMENT_ROLE);
  const shortlistedIds = new Set(
    rfq?.insurerSubmissions.map((s) => s.insurerId) ?? [],
  );

  return (
    <main style={pageStyle}>
      <button
        type="button"
        onClick={() =>
          router.push(
            rfq ? `/opportunities/${rfq.opportunityId}` : '/opportunities',
          )
        }
        style={{ cursor: 'pointer' }}
      >
        ← Back to the opportunity
      </button>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {rfq ? (
        <>
          <h1>RFQ — {rfq.insuranceLine}</h1>
          <div style={cardMetaStyle}>
            Issued {new Date(rfq.issuedAt).toLocaleDateString()} · follow-up
            threshold {rfq.followUpThresholdDays} business day
            {rfq.followUpThresholdDays === 1 ? '' : 's'}
          </div>

          <h2 style={{ marginTop: '2rem' }}>Insurer submissions</h2>
          {rfq.insurerSubmissions.length === 0 ? (
            <p style={{ opacity: 0.6 }}>No insurers on this RFQ.</p>
          ) : (
            <table style={rfqTableStyle}>
              <thead>
                <tr>
                  <th style={rfqCellStyle}>Insurer</th>
                  <th style={rfqCellStyle}>Status</th>
                  <th style={rfqCellStyle}>Sent</th>
                  <th style={rfqCellStyle}>Responded</th>
                  <th style={rfqCellStyle}>Follow-up alert</th>
                  {isPlacement ? <th style={rfqCellStyle}>Set status</th> : null}
                </tr>
              </thead>
              <tbody>
                {rfq.insurerSubmissions.map((submission) => (
                  <tr key={submission.id}>
                    <td style={rfqCellStyle}>{submission.insurer.name}</td>
                    <td style={rfqCellStyle}>
                      <span style={rfqBadgeStyle}>{submission.status}</span>
                    </td>
                    <td style={rfqCellStyle}>{fmt(submission.sentAt)}</td>
                    <td style={rfqCellStyle}>{fmt(submission.respondedAt)}</td>
                    <td style={rfqCellStyle}>
                      {fmt(submission.followUpAlertSentAt)}
                    </td>
                    {isPlacement ? (
                      <td style={rfqCellStyle}>
                        <select
                          aria-label={`Set status for ${submission.insurer.name}`}
                          disabled={busyRow === submission.id}
                          value=""
                          onChange={(e) => {
                            const next = e.target.value as RfqInsurerStatus;
                            if (next) void changeStatus(submission.id, next);
                          }}
                        >
                          <option value="">—</option>
                          {RFQ_INSURER_TARGET_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {rowError ? (
            <p role="alert" style={errorStyle}>
              {rowError}
            </p>
          ) : null}

          {isPlacement ? (
            <div style={rfqActionsStyle}>
              {adding ? (
                <div style={{ width: '100%' }}>
                  <strong>Add insurers to the shortlist</strong>
                  {addError ? (
                    <p role="alert" style={errorStyle}>
                      {addError}
                    </p>
                  ) : null}
                  {insurers === null ? (
                    <p>Loading…</p>
                  ) : (
                    <div style={insurerPickerStyle}>
                      {insurers
                        .filter((i) => !shortlistedIds.has(i.id))
                        .map((insurer) => (
                          <label
                            key={insurer.id}
                            style={{
                              display: 'flex',
                              gap: '0.5rem',
                              alignItems: 'center',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={toAdd.has(insurer.id)}
                              onChange={() =>
                                setToAdd((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(insurer.id))
                                    next.delete(insurer.id);
                                  else next.add(insurer.id);
                                  return next;
                                })
                              }
                            />
                            <span>{insurer.name}</span>
                          </label>
                        ))}
                      {insurers.filter((i) => !shortlistedIds.has(i.id))
                        .length === 0 ? (
                        <span style={{ opacity: 0.6 }}>
                          Every insurer on file is already on this RFQ.
                        </span>
                      ) : null}
                    </div>
                  )}
                  <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem' }}>
                    <button
                      type="button"
                      disabled={addBusy || toAdd.size === 0}
                      style={{ ...buttonStyle, width: 'auto' }}
                      onClick={() => void submitAdd()}
                    >
                      {addBusy ? 'Adding…' : 'Add selected'}
                    </button>
                    <button
                      type="button"
                      style={{ ...buttonStyle, width: 'auto' }}
                      onClick={() => {
                        setAdding(false);
                        setToAdd(new Set());
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  style={{ ...buttonStyle, width: 'auto' }}
                  onClick={() => void openAdd()}
                >
                  Add insurers…
                </button>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
