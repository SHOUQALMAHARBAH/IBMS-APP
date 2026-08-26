'use client';

import { useState } from 'react';
import {
  transitionLead,
  LEAD_NEXT_STATUSES,
  LEAD_STATUS_LABEL,
  LEAD_STATUSES,
  type Lead,
  type LeadStatus,
} from '../../lib/lead/lead-api';
import { ApiError } from '../../lib/auth/api-client';
import { errorStyle } from '../auth/auth-form.styles';
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

// Keyed by the TARGET status a button moves a lead to, not the current one.
const MOVE_TO_LABEL: Record<LeadStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Mark contacted',
  QUALIFIED: 'Mark qualified',
  CONVERTED_TO_PROSPECT: 'Convert to prospect',
  DISQUALIFIED: 'Disqualify',
};

interface LeadPipelineBoardProps {
  leads: Lead[];
  currentUserId: string;
  onLeadTransitioned: (result: { id: string; status: LeadStatus }) => void;
}

export function LeadPipelineBoard({ leads, currentUserId, onLeadTransitioned }: LeadPipelineBoardProps) {
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleTransition(lead: Lead, toStatus: LeadStatus) {
    setTransitioningId(lead.id);
    setErrors((prev) => ({ ...prev, [lead.id]: '' }));
    try {
      const result = await transitionLead(lead.id, toStatus);
      onLeadTransitioned(result);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not update this lead — try again.';
      setErrors((prev) => ({ ...prev, [lead.id]: message }));
    } finally {
      setTransitioningId(null);
    }
  }

  if (leads.length === 0) {
    return <p style={emptyColumnStyle}>No leads yet — add one above to start your pipeline.</p>;
  }

  return (
    <div style={boardStyle}>
      {LEAD_STATUSES.map((status) => {
        const columnLeads = leads.filter((l) => l.status === status);
        return (
          <div key={status} style={columnStyle}>
            <div style={columnHeaderStyle}>
              <span>{LEAD_STATUS_LABEL[status]}</span>
              <span>{columnLeads.length}</span>
            </div>
            {columnLeads.length === 0 ? <p style={emptyColumnStyle}>Empty</p> : null}
            {columnLeads.map((lead) => {
              const isOwner = lead.ownerUserId === currentUserId;
              const nextStatuses = LEAD_NEXT_STATUSES[lead.status];
              const isTransitioning = transitioningId === lead.id;
              return (
                <article key={lead.id} style={cardStyle} aria-label={`Lead: ${lead.fullName}`}>
                  <strong>{lead.fullName}</strong>
                  <div style={cardMetaStyle}>{lead.source.replaceAll('_', ' ')}</div>
                  {lead.contactPhone ? <div style={cardMetaStyle}>{lead.contactPhone}</div> : null}
                  {lead.contactEmail ? <div style={cardMetaStyle}>{lead.contactEmail}</div> : null}
                  {isOwner && nextStatuses.length > 0 ? (
                    <div style={cardActionsStyle}>
                      {nextStatuses.map((next) => (
                        <button
                          key={next}
                          type="button"
                          style={smallButtonStyle}
                          disabled={isTransitioning}
                          aria-label={`${MOVE_TO_LABEL[next]} — ${lead.fullName}`}
                          onClick={() => void handleTransition(lead, next)}
                        >
                          {MOVE_TO_LABEL[next]}
                        </button>
                      ))}
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
