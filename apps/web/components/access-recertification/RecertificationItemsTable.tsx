'use client';

import { useState } from 'react';
import {
  decideRecertificationItem,
  type RecertificationDecision,
  type RecertificationDecisionResult,
  type RecertificationItem,
} from '../../lib/access-recertification/access-recertification-api';
import { ApiError } from '../../lib/auth/api-client';
import { errorStyle } from '../auth/auth-form.styles';
import {
  adminBadgeStyle,
  decidedTagStyle,
  decisionButtonRowStyle,
  emptyStateStyle,
  inlineButtonStyle,
  roleBadgeStyle,
  tableStyle,
  tdStyle,
  thStyle,
} from './access-recertification.styles';

const ADMIN_ROLE = 'SYSTEM_SECURITY_ADMINISTRATOR';

const DECISION_LABEL: Record<RecertificationDecision, string> = {
  confirmed: 'Confirmed',
  revoked: 'Revoked',
  changed: 'Flagged for change',
};

interface RecertificationItemsTableProps {
  items: RecertificationItem[];
  onItemDecided: (result: RecertificationDecisionResult) => void;
}

export function RecertificationItemsTable({ items, onItemDecided }: RecertificationItemsTableProps) {
  const [decidingItemId, setDecidingItemId] = useState<string | null>(null);
  const [decideErrors, setDecideErrors] = useState<Record<string, string>>({});

  if (items.length === 0) {
    return <p style={emptyStateStyle}>No access-recertification items are currently assigned to you for review.</p>;
  }

  async function handleDecide(item: RecertificationItem, decision: RecertificationDecision) {
    setDecidingItemId(item.id);
    setDecideErrors((prev) => ({ ...prev, [item.id]: '' }));
    try {
      const updated = await decideRecertificationItem(item.id, decision);
      onItemDecided(updated);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not record your decision — try again.';
      setDecideErrors((prev) => ({ ...prev, [item.id]: message }));
    } finally {
      setDecidingItemId(null);
    }
  }

  return (
    <table style={tableStyle}>
      <caption style={{ textAlign: 'start', marginBottom: '0.5rem', opacity: 0.75, fontSize: '0.9rem' }}>
        Access-recertification queue — confirm each person still needs the access listed, or revoke/flag it.
      </caption>
      <thead>
        <tr>
          <th style={thStyle} scope="col">
            Subject
          </th>
          <th style={thStyle} scope="col">
            Current roles
          </th>
          <th style={thStyle} scope="col">
            Cycle
          </th>
          <th style={thStyle} scope="col">
            Status / decision
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const isAdminSubject = item.subjectRoles.includes(ADMIN_ROLE);
          const isDeciding = decidingItemId === item.id;
          return (
            <tr key={item.id}>
              <td style={tdStyle}>
                <strong>{item.subjectFullName}</strong>
                <br />
                <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>{item.subjectEmail}</span>
              </td>
              <td style={tdStyle}>
                {isAdminSubject ? (
                  <span style={adminBadgeStyle}>Admin access — not exempt from review</span>
                ) : null}
                {item.subjectRoles
                  .filter((role) => role !== ADMIN_ROLE)
                  .map((role) => (
                    <span key={role} style={roleBadgeStyle}>
                      {role.replaceAll('_', ' ')}
                    </span>
                  ))}
              </td>
              <td style={tdStyle}>{item.cycleLabel}</td>
              <td style={tdStyle}>
                {item.decision ? (
                  <span style={decidedTagStyle}>{DECISION_LABEL[item.decision]}</span>
                ) : (
                  <div style={decisionButtonRowStyle}>
                    <button
                      type="button"
                      style={inlineButtonStyle}
                      disabled={isDeciding}
                      aria-label={`Confirm access for ${item.subjectFullName}`}
                      onClick={() => void handleDecide(item, 'confirmed')}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      style={inlineButtonStyle}
                      disabled={isDeciding}
                      aria-label={`Revoke access for ${item.subjectFullName}`}
                      onClick={() => void handleDecide(item, 'revoked')}
                    >
                      Revoke
                    </button>
                    <button
                      type="button"
                      style={inlineButtonStyle}
                      disabled={isDeciding}
                      aria-label={`Flag access for change for ${item.subjectFullName}`}
                      onClick={() => void handleDecide(item, 'changed')}
                    >
                      Flag for change
                    </button>
                  </div>
                )}
                {decideErrors[item.id] ? (
                  <p role="alert" style={{ ...errorStyle, marginTop: '0.5rem' }}>
                    {decideErrors[item.id]}
                  </p>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
