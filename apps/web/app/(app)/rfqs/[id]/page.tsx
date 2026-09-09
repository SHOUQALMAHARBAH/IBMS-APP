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
import type { Language, TranslationKey } from '../../../../lib/i18n/translations';

const PLACEMENT_ROLE = 'PLACEMENT_TECHNICAL_OFFICER';

// The medium of a broker<->insurer exchange. The API accepts the full
// InteractionChannel enum; this is the practical subset for placement work.
const COMM_CHANNELS = ['EMAIL', 'CALL', 'PORTAL', 'MEETING', 'OTHER'] as const;
const COMM_DIRECTIONS: CommunicationDirection[] = ['INBOUND', 'OUTBOUND'];

const RFQ_INSURER_STATUS_LABEL_KEY: Record<RfqInsurerStatus, TranslationKey> = {
  SENT: 'rfqInsurerStatusSent',
  VIEWED: 'rfqInsurerStatusViewed',
  QUOTED: 'rfqInsurerStatusQuoted',
  DECLINED: 'rfqInsurerStatusDeclined',
  NO_RESPONSE: 'rfqInsurerStatusNoResponse',
};

const COMM_DIRECTION_BADGE_LABEL_KEY: Record<CommunicationDirection, TranslationKey> = {
  INBOUND: 'commDirectionInboundBadge',
  OUTBOUND: 'commDirectionOutboundBadge',
};

const COMM_CHANNEL_LABEL_KEY: Record<(typeof COMM_CHANNELS)[number], TranslationKey> = {
  EMAIL: 'commChannelEmail',
  CALL: 'commChannelCall',
  PORTAL: 'commChannelPortal',
  MEETING: 'commChannelMeeting',
  OTHER: 'commChannelOther',
};

function fmt(value: string | null, language: Language): string {
  return value ? formatDate(value, language) : '—';
}

export default function RfqDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();
  const { language, t } = useLanguage();

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
          ? t('rfqDetailNotFound')
          : err instanceof ApiError
            ? err.message
            : t('rfqDetailLoadError'),
      );
    }
  }, [params.id, t]);

  const loadComms = useCallback(async () => {
    try {
      setComms(await listRfqCommunications(params.id));
      setCommsError(null);
    } catch (err) {
      setCommsError(
        err instanceof ApiError
          ? err.message
          : t('rfqDetailCommsLoadError'),
      );
    }
  }, [params.id, t]);

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
          : t('rfqUpdateStatusError'),
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
          : t('rfqAddInsurersLoadError'),
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
          : t('rfqAddInsurersError'),
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
          : t('rfqLogExchangeError'),
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
        {t('rfqDetailBackButton')}
      </button>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {rfq ? (
        <>
          <h1>{t('rfqDetailHeading', { line: rfq.insuranceLine })}</h1>
          <div style={cardMetaStyle}>
            {t(
              rfq.followUpThresholdDays === 1 ? 'rfqFollowUpThresholdOne' : 'rfqFollowUpThresholdOther',
              { date: formatDate(rfq.issuedAt, language), count: rfq.followUpThresholdDays },
            )}
          </div>

          <ConsentCaptureWidget
            customerId={rfq.opportunity.customerId}
            purpose="SHARING_WITH_INSURER"
            label={t('rfqConsentLabel')}
            defaultConsentTextVersion="market-placement-notice-v1"
          />
          <PrivacyNoticeDisplay
            touchpoint="rfq_market_placement"
            canRead={!!user && user.roles.some((r) => NOTICE_READ_ROLES.includes(r))}
          />

          <h2 style={{ marginTop: '2rem' }}>{t('rfqSubmissionsHeading')}</h2>
          <p style={{ opacity: 0.6, fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
            {t('rfqSubmissionsHint')}
          </p>
          {rfq.insurerSubmissions.length === 0 ? (
            <p style={{ opacity: 0.6 }}>{t('rfqSubmissionsNone')}</p>
          ) : (
            <table style={rfqTableStyle}>
              <thead>
                <tr>
                  <th style={rfqCellStyle}>{t('rfqColumnInsurer')}</th>
                  <th style={rfqCellStyle}>{t('commonStatus')}</th>
                  <th style={rfqCellStyle}>{t('rfqColumnSent')}</th>
                  <th style={rfqCellStyle}>{t('rfqColumnResponded')}</th>
                  <th style={rfqCellStyle}>{t('rfqColumnFollowUpAlert')}</th>
                  {isPlacement ? <th style={rfqCellStyle}>{t('rfqColumnSetStatus')}</th> : null}
                </tr>
              </thead>
              <tbody>
                {rfq.insurerSubmissions.map((submission) => (
                  <tr key={submission.id}>
                    <td style={rfqCellStyle}>
                      <bdi>{submission.insurer.name}</bdi>
                    </td>
                    <td style={rfqCellStyle}>
                      <span style={rfqBadgeStyle}>{t(RFQ_INSURER_STATUS_LABEL_KEY[submission.status])}</span>
                    </td>
                    <td style={rfqCellStyle}>{fmt(submission.sentAt, language)}</td>
                    <td style={rfqCellStyle}>{fmt(submission.respondedAt, language)}</td>
                    <td style={rfqCellStyle}>
                      {fmt(submission.followUpAlertSentAt, language)}
                    </td>
                    {isPlacement ? (
                      <td style={rfqCellStyle}>
                        <select
                          aria-label={t('rfqSetStatusAria', { name: submission.insurer.name })}
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
                              {t(RFQ_INSURER_STATUS_LABEL_KEY[status])}
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
                  <strong>{t('rfqAddInsurersHeading')}</strong>
                  {addError ? (
                    <p role="alert" style={errorStyle}>
                      {addError}
                    </p>
                  ) : null}
                  {insurers === null ? (
                    <p>{t('commonLoading')}</p>
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
                          {t('rfqAllInsurersAlreadyOnRfq')}
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
                      {addBusy ? t('rfqAddingButton') : t('rfqAddSelectedButton')}
                    </button>
                    <button
                      type="button"
                      style={{ ...buttonStyle, width: 'auto' }}
                      onClick={() => {
                        setAdding(false);
                        setToAdd(new Set());
                      }}
                    >
                      {t('commonCancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  style={{ ...buttonStyle, width: 'auto' }}
                  onClick={() => void openAdd()}
                >
                  {t('rfqAddInsurersButton')}
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

          <h2 style={{ marginTop: '2.5rem' }}>{t('rfqCorrespondenceHeading')}</h2>
          <p style={{ opacity: 0.7, margin: '0.25rem 0 0' }}>{t('rfqCorrespondenceIntro')}</p>

          {commsError ? (
            <p role="alert" style={errorStyle}>
              {commsError}
            </p>
          ) : null}

          {comms === null ? (
            <p>{t('commonLoading')}</p>
          ) : comms.length === 0 ? (
            <p style={{ opacity: 0.6 }}>{t('rfqCorrespondenceNone')}</p>
          ) : (
            <table style={rfqTableStyle}>
              <thead>
                <tr>
                  <th style={rfqCellStyle}>{t('rfqColumnWhen')}</th>
                  <th style={rfqCellStyle}>{t('rfqColumnDirection')}</th>
                  <th style={rfqCellStyle}>{t('rfqColumnChannel')}</th>
                  <th style={rfqCellStyle}>{t('rfqColumnInsurer')}</th>
                  <th style={rfqCellStyle}>{t('rfqColumnExchange')}</th>
                </tr>
              </thead>
              <tbody>
                {comms.map((c) => (
                  <tr key={c.id}>
                    <td style={rfqCellStyle}>{formatDateTime(c.sentAt, language)}</td>
                    <td style={rfqCellStyle}>
                      <span style={rfqBadgeStyle}>{t(COMM_DIRECTION_BADGE_LABEL_KEY[c.direction])}</span>
                    </td>
                    <td style={rfqCellStyle}>
                      {c.channel in COMM_CHANNEL_LABEL_KEY
                        ? t(COMM_CHANNEL_LABEL_KEY[c.channel as keyof typeof COMM_CHANNEL_LABEL_KEY])
                        : c.channel}
                    </td>
                    <td style={rfqCellStyle}>
                      <bdi>{c.rfqInsurer?.insurer.name ?? t('rfqPanelWide')}</bdi>
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
              <strong>{t('rfqLogExchangeHeading')}</strong>
              {commError ? (
                <p role="alert" style={errorStyle}>
                  {commError}
                </p>
              ) : null}
              <div style={rfqFieldStyle}>
                <label htmlFor="comm-direction">{t('rfqDirectionLabel')}</label>
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
                        ? t('rfqDirectionInboundOption')
                        : t('rfqDirectionOutboundOption')}
                    </option>
                  ))}
                </select>
              </div>
              <div style={rfqFieldStyle}>
                <label htmlFor="comm-channel">{t('rfqChannelLabel')}</label>
                <select
                  id="comm-channel"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                >
                  {COMM_CHANNELS.map((ch) => (
                    <option key={ch} value={ch}>
                      {t(COMM_CHANNEL_LABEL_KEY[ch])}
                    </option>
                  ))}
                </select>
              </div>
              <div style={rfqFieldStyle}>
                <label htmlFor="comm-insurer">{t('rfqCommInsurerLabel')}</label>
                <select
                  id="comm-insurer"
                  value={commInsurerId}
                  onChange={(e) => setCommInsurerId(e.target.value)}
                >
                  <option value="">{t('rfqCommInsurerWholePanel')}</option>
                  {rfq.insurerSubmissions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.insurer.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={rfqFieldStyle}>
                <label htmlFor="comm-subject">{t('rfqCommSubjectLabel')}</label>
                <input
                  id="comm-subject"
                  value={subject}
                  maxLength={200}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
              <div style={rfqFieldStyle}>
                <label htmlFor="comm-body">{t('rfqCommBodyLabel')}</label>
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
                {commBusy ? t('rfqLoggingButton') : t('rfqLogExchangeButton')}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
