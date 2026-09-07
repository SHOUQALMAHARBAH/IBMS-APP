'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  addRfqInsurers,
  getRfq,
  listRfqCommunications,
  listSelectableInsurers,
  logRfqCommunication,
  transitionRfqInsurer,
  RFQ_INSURER_TARGET_STATUSES,
  type CommunicationDirection,
  type Rfq,
  type RfqCommunication,
  type RfqInsurerStatus,
  type SelectableInsurer,
} from '../../../../lib/rfq/rfq-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { QuotationsSection } from '../../../../components/quotation/QuotationsSection';
import { ComparisonSection } from '../../../../components/comparison/ComparisonSection';
import { buttonStyle, errorStyle } from '../../../../components/auth/auth-form.styles';
import { cardMetaStyle, pageStyle } from '../../../../components/lead/lead.styles';
import {
  commBodyStyle,
  insurerPickerStyle,
  rfqActionsStyle,
  rfqBadgeStyle,
  rfqCellStyle,
  rfqFieldStyle,
  rfqTableStyle,
} from '../../../../components/rfq/rfq.styles';
import { ConsentCaptureWidget } from '../../../../components/pdpl/ConsentCaptureWidget';
import { PrivacyNoticeDisplay, NOTICE_READ_ROLES } from '../../../../components/pdpl/PrivacyNoticeDisplay';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { formatDate, formatDateTime } from '../../../../lib/i18n/format';
import type { Language } from '../../../../lib/i18n/translations';

const PLACEMENT_ROLE = 'PLACEMENT_TECHNICAL_OFFICER';

// The medium of a broker<->insurer exchange. The API accepts the full
// InteractionChannel enum; this is the practical subset for placement work.
const COMM_CHANNELS = ['EMAIL', 'CALL', 'PORTAL', 'MEETING', 'OTHER'] as const;
const COMM_DIRECTIONS: CommunicationDirection[] = ['INBOUND', 'OUTBOUND'];

function fmt(value: string | null, language: Language): string {
  return value ? formatDate(value, language) : '—';
}

export default function RfqDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();
  const { language } = useLanguage();

  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [insurers, setInsurers] = useState<SelectableInsurer[] | null>(null);
  const [toAdd, setToAdd] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);

  const [comms, setComms] = useState<RfqCommunication[] | null>(null);
  const [commsError, setCommsError] = useState<string | null>(null);
  const [direction, setDirection] = useState<CommunicationDirection>('OUTBOUND');
  const [channel, setChannel] = useState<string>('EMAIL');
  const [commInsurerId, setCommInsurerId] = useState<string>('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [commError, setCommError] = useState<string | null>(null);
  const [commBusy, setCommBusy] = useState(false);

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

  const loadComms = useCallback(async () => {
    try {
      setComms(await listRfqCommunications(params.id));
      setCommsError(null);
    } catch (err) {
      setCommsError(
        err instanceof ApiError
          ? err.message
          : 'Could not load the correspondence log — try again.',
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
      await loadComms();
    })();
  }, [user, load, loadComms]);

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

  async function submitComm() {
    if (!rfq || body.trim().length === 0) return;
    setCommBusy(true);
    setCommError(null);
    try {
      await logRfqCommunication(rfq.id, {
        direction,
        channel,
        body: body.trim(),
        subject: subject.trim() || undefined,
        rfqInsurerId: commInsurerId || undefined,
      });
      setSubject('');
      setBody('');
      setCommInsurerId('');
      await loadComms();
    } catch (err) {
      setCommError(
        err instanceof ApiError
          ? err.message
          : 'Could not log the exchange — try again.',
      );
    } finally {
      setCommBusy(false);
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
            Issued {formatDate(rfq.issuedAt, language)} · follow-up
            threshold {rfq.followUpThresholdDays} business day
            {rfq.followUpThresholdDays === 1 ? '' : 's'}
          </div>

          <ConsentCaptureWidget
            customerId={rfq.opportunity.customerId}
            purpose="SHARING_WITH_INSURER"
            label="RFQ / market placement consent"
            defaultConsentTextVersion="market-placement-notice-v1"
          />
          <PrivacyNoticeDisplay
            touchpoint="rfq_market_placement"
            canRead={!!user && user.roles.some((r) => NOTICE_READ_ROLES.includes(r))}
          />

          <h2 style={{ marginTop: '2rem' }}>Insurer submissions</h2>
          <p style={{ opacity: 0.6, fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
            A status of <code>NO_RESPONSE</code> may be set by the nightly
            follow-up sweep once the threshold above has lapsed.
          </p>
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
                    <td style={rfqCellStyle}>
                      <bdi>{submission.insurer.name}</bdi>
                    </td>
                    <td style={rfqCellStyle}>
                      <span style={rfqBadgeStyle}>{submission.status}</span>
                    </td>
                    <td style={rfqCellStyle}>{fmt(submission.sentAt, language)}</td>
                    <td style={rfqCellStyle}>{fmt(submission.respondedAt, language)}</td>
                    <td style={rfqCellStyle}>
                      {fmt(submission.followUpAlertSentAt, language)}
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
                            <span>
                              <bdi>{insurer.name}</bdi>
                            </span>
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

          <QuotationsSection
            rfqId={rfq.id}
            isPlacement={isPlacement}
            submissions={rfq.insurerSubmissions}
          />

          <ComparisonSection rfqId={rfq.id} isPlacement={isPlacement} />

          <h2 style={{ marginTop: '2.5rem' }}>Correspondence</h2>
          <p style={{ opacity: 0.7, margin: '0.25rem 0 0' }}>
            Insurer queries during the market phase, and the answers /
            additional information supplied.
          </p>

          {commsError ? (
            <p role="alert" style={errorStyle}>
              {commsError}
            </p>
          ) : null}

          {comms === null ? (
            <p>Loading…</p>
          ) : comms.length === 0 ? (
            <p style={{ opacity: 0.6 }}>Nothing logged yet.</p>
          ) : (
            <table style={rfqTableStyle}>
              <thead>
                <tr>
                  <th style={rfqCellStyle}>When</th>
                  <th style={rfqCellStyle}>Direction</th>
                  <th style={rfqCellStyle}>Channel</th>
                  <th style={rfqCellStyle}>Insurer</th>
                  <th style={rfqCellStyle}>Exchange</th>
                </tr>
              </thead>
              <tbody>
                {comms.map((c) => (
                  <tr key={c.id}>
                    <td style={rfqCellStyle}>{formatDateTime(c.sentAt, language)}</td>
                    <td style={rfqCellStyle}>
                      <span style={rfqBadgeStyle}>{c.direction}</span>
                    </td>
                    <td style={rfqCellStyle}>{c.channel}</td>
                    <td style={rfqCellStyle}>
                      <bdi>{c.rfqInsurer?.insurer.name ?? 'Panel'}</bdi>
                    </td>
                    <td style={rfqCellStyle}>
                      {c.subject ? <strong>{c.subject}</strong> : null}
                      <p style={commBodyStyle}>{c.body}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {isPlacement ? (
            <div style={{ marginTop: '1.5rem', maxWidth: '32rem' }}>
              <strong>Log an exchange</strong>
              {commError ? (
                <p role="alert" style={errorStyle}>
                  {commError}
                </p>
              ) : null}
              <div style={rfqFieldStyle}>
                <label htmlFor="comm-direction">Direction</label>
                <select
                  id="comm-direction"
                  value={direction}
                  onChange={(e) =>
                    setDirection(e.target.value as CommunicationDirection)
                  }
                >
                  {COMM_DIRECTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d === 'INBOUND'
                        ? 'INBOUND — insurer asked us'
                        : 'OUTBOUND — we answered / sent info'}
                    </option>
                  ))}
                </select>
              </div>
              <div style={rfqFieldStyle}>
                <label htmlFor="comm-channel">Channel</label>
                <select
                  id="comm-channel"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                >
                  {COMM_CHANNELS.map((ch) => (
                    <option key={ch} value={ch}>
                      {ch}
                    </option>
                  ))}
                </select>
              </div>
              <div style={rfqFieldStyle}>
                <label htmlFor="comm-insurer">Insurer (optional)</label>
                <select
                  id="comm-insurer"
                  value={commInsurerId}
                  onChange={(e) => setCommInsurerId(e.target.value)}
                >
                  <option value="">Whole panel</option>
                  {rfq.insurerSubmissions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.insurer.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={rfqFieldStyle}>
                <label htmlFor="comm-subject">Subject (optional)</label>
                <input
                  id="comm-subject"
                  value={subject}
                  maxLength={200}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
              <div style={rfqFieldStyle}>
                <label htmlFor="comm-body">Exchange</label>
                <textarea
                  id="comm-body"
                  value={body}
                  rows={4}
                  maxLength={4000}
                  onChange={(e) => setBody(e.target.value)}
                />
              </div>
              <button
                type="button"
                disabled={commBusy || body.trim().length === 0}
                style={{ ...buttonStyle, width: 'auto' }}
                onClick={() => void submitComm()}
              >
                {commBusy ? 'Logging…' : 'Log exchange'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
