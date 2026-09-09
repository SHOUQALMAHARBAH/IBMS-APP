'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  transitionLead,
  LEAD_NEXT_STATUSES,
  LEAD_STATUSES,
  type Lead,
  type LeadSource,
  type LeadStatus,
} from '../../lib/lead/lead-api';
import { ApiError } from '../../lib/auth/api-client';
import { errorStyle } from '../auth/auth-form.styles';
import { useLanguage } from '../../lib/i18n/language-context';
import type { TranslationKey } from '../../lib/i18n/translations';
import {
  boardStyle,
  cardActionsStyle,
  cardMetaStyle,
  cardStyle,
  columnHeaderStyle,
  columnStyle,
  emptyColumnStyle,
  smallButtonStyle,
} from './lead.styles';

// Keyed by the current status a column/badge represents.
const STATUS_LABEL_KEY: Record<LeadStatus, TranslationKey> = {
  NEW: 'leadStatusNew',
  CONTACTED: 'leadStatusContacted',
  QUALIFIED: 'leadStatusQualified',
  CONVERTED_TO_PROSPECT: 'leadStatusConvertedToProspect',
  DISQUALIFIED: 'leadStatusDisqualified',
};

// Keyed by the TARGET status a button moves a lead to, not the current one.
const MOVE_TO_LABEL_KEY: Record<LeadStatus, TranslationKey> = {
  NEW: 'leadMoveToNew',
  CONTACTED: 'leadMoveToContacted',
  QUALIFIED: 'leadMoveToQualified',
  CONVERTED_TO_PROSPECT: 'leadMoveToConvertedToProspect',
  DISQUALIFIED: 'leadMoveToDisqualified',
};

const SOURCE_LABEL_KEY: Record<LeadSource, TranslationKey> = {
  referral: 'leadSourceReferral',
  website: 'leadSourceWebsite',
  social_media: 'leadSourceSocialMedia',
  campaign: 'leadSourceCampaign',
  tender: 'leadSourceTender',
  bank_partner: 'leadSourceBankPartner',
  strategic_partner: 'leadSourceStrategicPartner',
  ex_customer: 'leadSourceExCustomer',
  renewal: 'leadSourceRenewal',
};

interface LeadPipelineBoardProps {
  leads: Lead[];
  currentUserId: string;
  onLeadTransitioned: (result: { id: string; status: LeadStatus }) => void;
}

export function LeadPipelineBoard({ leads, currentUserId, onLeadTransitioned }: LeadPipelineBoardProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // CONVERTED_TO_PROSPECT must also create the linked Prospect row (backlog
  // Part C #2) — the generic transition endpoint rejects this target
  // directly (lead.service.ts), so this move goes to the qualification
  // screen instead of a plain status-change button. leadFullName is only a
  // display-prefill hint for that screen's form (see prospects/new/page.tsx).
  function goToProspectConversion(lead: Lead) {
    const params = new URLSearchParams({ leadId: lead.id, leadFullName: lead.fullName });
    router.push(`/prospects/new?${params.toString()}`);
  }

  async function handleTransition(lead: Lead, toStatus: LeadStatus) {
    setTransitioningId(lead.id);
    setErrors((prev) => ({ ...prev, [lead.id]: '' }));
    try {
      const result = await transitionLead(lead.id, toStatus);
      onLeadTransitioned(result);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('leadsUpdateError');
      setErrors((prev) => ({ ...prev, [lead.id]: message }));
    } finally {
      setTransitioningId(null);
    }
  }

  if (leads.length === 0) {
    return <p style={emptyColumnStyle}>{t('leadsNoneYet')}</p>;
  }

  return (
    <div style={boardStyle}>
      {LEAD_STATUSES.map((status) => {
        const columnLeads = leads.filter((l) => l.status === status);
        return (
          <div key={status} style={columnStyle}>
            <div style={columnHeaderStyle}>
              <span>{t(STATUS_LABEL_KEY[status])}</span>
              <span>{columnLeads.length}</span>
            </div>
            {columnLeads.length === 0 ? <p style={emptyColumnStyle}>{t('leadsColumnEmpty')}</p> : null}
            {columnLeads.map((lead) => {
              const isOwner = lead.ownerUserId === currentUserId;
              const nextStatuses = LEAD_NEXT_STATUSES[lead.status];
              const isTransitioning = transitioningId === lead.id;
              return (
                <article key={lead.id} style={cardStyle} aria-label={`Lead: ${lead.fullName}`}>
                  <strong>{lead.fullName}</strong>
                  <div style={cardMetaStyle}>{t(SOURCE_LABEL_KEY[lead.source])}</div>
                  {lead.contactPhone ? <div style={cardMetaStyle}>{lead.contactPhone}</div> : null}
                  {lead.contactEmail ? <div style={cardMetaStyle}>{lead.contactEmail}</div> : null}
                  {isOwner && nextStatuses.length > 0 ? (
                    <div style={cardActionsStyle}>
                      {nextStatuses.map((next) =>
                        next === 'CONVERTED_TO_PROSPECT' ? (
                          <button
                            key={next}
                            type="button"
                            style={smallButtonStyle}
                            // Disabled while another transition on this same
                            // card (e.g. Disqualify) is in flight — otherwise
                            // an officer could navigate to the conversion
                            // screen mid-flight and later submit it against a
                            // Lead that transitioned to a different status in
                            // the background.
                            disabled={isTransitioning}
                            aria-label={`${t(MOVE_TO_LABEL_KEY[next])} — ${lead.fullName}`}
                            onClick={() => goToProspectConversion(lead)}
                          >
                            {t(MOVE_TO_LABEL_KEY[next])}
                          </button>
                        ) : (
                          <button
                            key={next}
                            type="button"
                            style={smallButtonStyle}
                            disabled={isTransitioning}
                            aria-label={`${t(MOVE_TO_LABEL_KEY[next])} — ${lead.fullName}`}
                            onClick={() => void handleTransition(lead, next)}
                          >
                            {t(MOVE_TO_LABEL_KEY[next])}
                          </button>
                        ),
                      )}
                    </div>
                  ) : null}
                  {errors[lead.id] ? (
                    <p role="alert" style={{ ...errorStyle, marginTop: '0.4rem', fontSize: '0.75rem' }}>
                      {errors[lead.id]}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
