'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getCustomer,
  listCustomerDocuments,
  listUbos,
  revealCustomerField,
  type Customer,
  type CustomerDocument,
  type RevealableField,
  type Ubo,
} from '../../../../lib/customer/customer-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle, smallButtonStyle } from '../../../../components/lead/lead.styles';
import {
  profileFieldLabelStyle,
  profileFieldValueStyle,
  profileGridStyle,
} from '../../../../components/prospect/prospect.styles';
import { repeatableRowStyle } from '../../../../components/customer/customer.styles';

function ProfileField({
  label,
  value,
  revealed,
  onReveal,
}: {
  label: string;
  value: string | null | undefined;
  revealed?: string;
  onReveal?: () => void;
}) {
  return (
    <div>
      <div style={profileFieldLabelStyle}>{label}</div>
      <div style={profileFieldValueStyle}>
        {revealed ?? value ?? '—'}
        {onReveal && !revealed ? (
          <button
            type="button"
            style={{ ...smallButtonStyle, marginLeft: '0.5rem' }}
            onClick={onReveal}
          >
            Reveal
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function CustomerProfilePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [ubos, setUbos] = useState<Ubo[]>([]);
  const [documents, setDocuments] = useState<CustomerDocument[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Partial<Record<RevealableField, string>>>({});
  const [revealReason, setRevealReason] = useState('');
  const [revealTarget, setRevealTarget] = useState<RevealableField | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getCustomer(params.id);
      setCustomer(result);
      setLoadError(null);
      if (result.customerType === 'CORPORATE') {
        setUbos(await listUbos(params.id));
      }
      setDocuments(await listCustomerDocuments(params.id));
    } catch (err) {
      setLoadError(
        err instanceof ApiError && (err.status === 403 || err.status === 404)
          ? 'This customer could not be found — it may not exist, or you may not have access to it.'
          : err instanceof ApiError
            ? err.message
            : 'Could not load this customer — try again.',
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

  async function handleReveal(field: RevealableField) {
    setRevealError(null);
    if (!revealReason.trim()) {
      setRevealError('A written justification is required to reveal this field.');
      return;
    }
    try {
      const { value } = await revealCustomerField(params.id, field, revealReason);
      setRevealed((prev) => ({ ...prev, [field]: value }));
      setRevealTarget(null);
      setRevealReason('');
    } catch (err) {
      setRevealError(err instanceof ApiError ? err.message : 'Could not reveal this field — try again.');
    }
  }

  if (isLoading || !user) return null;

  // Client-side hint only (same convention as CAN_CREATE_CUSTOMER_ROLES) —
  // the backend enforces needs-assessment.create / risk-profile.* on write
  // regardless.
  const canStartNeedsAssessment = user.roles.includes('SALES_RELATIONSHIP_OFFICER');
  const canOpenRiskSurvey = user.roles.some((role) =>
    ['SALES_RELATIONSHIP_OFFICER', 'PLACEMENT_TECHNICAL_OFFICER'].includes(role),
  );
  const canOpenInsuranceProgram = user.roles.some((role) =>
    [
      'SALES_RELATIONSHIP_OFFICER',
      'PLACEMENT_TECHNICAL_OFFICER',
      'BRANCH_DEPARTMENT_MANAGER',
      'EXECUTIVE_MANAGEMENT',
    ].includes(role),
  );

  return (
    <main style={pageStyle}>
      <button type="button" onClick={() => router.push('/customers')} style={{ cursor: 'pointer' }}>
        ← All customers
      </button>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {customer ? (
        <>
          <h1>{customer.legalName}</h1>
          <p style={{ opacity: 0.8 }}>
            {customer.customerType} — Status: {customer.status}
          </p>

          <div style={profileGridStyle}>
            <ProfileField
              label="National ID"
              value={customer.nationalId}
              revealed={revealed.nationalId}
              onReveal={
                customer.nationalId ? () => setRevealTarget('nationalId') : undefined
              }
            />
            <ProfileField
              label="Contact phone"
              value={customer.contactPhone}
              revealed={revealed.contactPhone}
              onReveal={() => setRevealTarget('contactPhone')}
            />
            <ProfileField
              label="Contact email"
              value={customer.contactEmail}
              revealed={revealed.contactEmail}
              onReveal={() => setRevealTarget('contactEmail')}
            />
            <ProfileField label="Registration number" value={customer.registrationNumber} />
            <ProfileField label="Registered address" value={customer.registeredAddress} />
            <ProfileField label="Nature of business" value={customer.natureOfBusiness} />
            <ProfileField label="Language preference" value={customer.languagePreference} />
          </div>

          {revealTarget ? (
            <div style={repeatableRowStyle}>
              <label htmlFor="reveal-reason">
                Justification for revealing {revealTarget} (Part 10.6, logged)
              </label>
              <input
                id="reveal-reason"
                value={revealReason}
                onChange={(e) => setRevealReason(e.target.value)}
                style={{ width: '100%', padding: '0.4rem', marginTop: '0.4rem' }}
              />
              <button
                type="button"
                style={{ ...smallButtonStyle, marginTop: '0.5rem' }}
                onClick={() => void handleReveal(revealTarget)}
              >
                Confirm reveal
              </button>
              {revealError ? (
                <p role="alert" style={{ ...errorStyle, marginTop: '0.4rem' }}>
                  {revealError}
                </p>
              ) : null}
            </div>
          ) : null}

          {customer.customerType === 'CORPORATE' ? (
            <section style={{ marginTop: '2rem' }}>
              <h2>Ultimate Beneficial Owners</h2>
              {ubos.length === 0 ? <p style={{ opacity: 0.6 }}>None recorded.</p> : null}
              {ubos.map((u) => (
                <div key={u.id} style={repeatableRowStyle}>
                  <strong>{u.fullName}</strong>
                  {u.ownershipPercent ? <span> — {u.ownershipPercent}%</span> : null}
                  {u.isPep ? <span> — PEP</span> : null}
                </div>
              ))}
            </section>
          ) : null}

          <section style={{ marginTop: '2rem' }}>
            <h2>Documents</h2>
            {documents.length === 0 ? <p style={{ opacity: 0.6 }}>None attached.</p> : null}
            {documents.map((d) => (
              <div key={d.id} style={repeatableRowStyle}>
                <strong>{d.fileName}</strong> — {d.classification}
              </div>
            ))}
          </section>

          <section style={{ marginTop: '2rem' }}>
            <h2>Needs assessment</h2>
            <p style={{ opacity: 0.8 }}>
              Process 5 — a structured risk questionnaire that recommends a coverage list,
              reviewed and approved before it feeds an opportunity or RFQ.
            </p>
            {canStartNeedsAssessment ? (
              <button
                type="button"
                style={{ cursor: 'pointer' }}
                onClick={() =>
                  router.push(`/needs-assessments/new?customerId=${customer.id}`)
                }
              >
                Start a needs assessment
              </button>
            ) : (
              <p style={{ opacity: 0.6 }}>
                You don&apos;t hold the needs-assessment.create permission.
              </p>
            )}
          </section>

          <section style={{ marginTop: '2rem' }}>
            <h2>Risk survey</h2>
            <p style={{ opacity: 0.8 }}>
              Process 6 — the detailed asset survey per location (building / equipment /
              stock / annual profit / fleet), deriving the Sum Insured and indemnity
              period, consolidated across sites.
            </p>
            {canOpenRiskSurvey ? (
              <button
                type="button"
                style={{ cursor: 'pointer' }}
                onClick={() =>
                  router.push(`/risk-profiles?customerId=${customer.id}`)
                }
              >
                Open the risk survey
              </button>
            ) : (
              <p style={{ opacity: 0.6 }}>
                You don&apos;t hold the risk-profile.read permission.
              </p>
            )}
          </section>

          <section style={{ marginTop: '2rem' }}>
            <h2>Insurance program</h2>
            <p style={{ opacity: 0.8 }}>
              Process 7 — a multi-line Insurance Program assembled from an approved
              needs assessment&apos;s coverage list and the risk survey&apos;s derived
              Sum Insured, then finalized to feed an RFQ.
            </p>
            {canOpenInsuranceProgram ? (
              <button
                type="button"
                style={{ cursor: 'pointer' }}
                onClick={() =>
                  router.push(`/insurance-programs?customerId=${customer.id}`)
                }
              >
                Open the insurance program
              </button>
            ) : (
              <p style={{ opacity: 0.6 }}>
                You don&apos;t hold the program.read permission.
              </p>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
