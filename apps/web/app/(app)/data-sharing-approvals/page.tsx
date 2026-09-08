'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  DATA_CLASSIFICATIONS,
  DATA_SHARING_CHANNELS,
  approveDataSharingApproval,
  createDataSharingApproval,
  declineDataSharingApproval,
  listDataSharingApprovals,
  type DataSharingApproval,
} from '../../../lib/pdpl/data-sharing-approval-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const REQUEST_ROLES = [
  'SALES_RELATIONSHIP_OFFICER',
  'PLACEMENT_TECHNICAL_OFFICER',
  'CLAIMS_OFFICER',
  'FINANCE_COLLECTIONS_OFFICER',
  'COMPLIANCE_OFFICER',
];
const APPROVE_ROLES = ['DATA_PROTECTION_OFFICER'];

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };

function hasAny(roles: string[] | undefined, allowed: string[]): boolean {
  return !!roles && roles.some((r) => allowed.includes(r));
}

export default function DataSharingApprovalsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canRequest = hasAny(user?.roles, REQUEST_ROLES);
  const canApprove = hasAny(user?.roles, APPROVE_ROLES);

  const [rows, setRows] = useState<DataSharingApproval[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [description, setDescription] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [classification, setClassification] = useState<string>(DATA_CLASSIFICATIONS[0]);
  const [channel, setChannel] = useState<string>(DATA_SHARING_CHANNELS[0]);
  const [isRegulatoryChannel, setIsRegulatoryChannel] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await listDataSharingApprovals());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError
          ? err.message
          : 'Could not load data-sharing requests — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'That action failed — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createDataSharingApproval({
        description: description.trim(),
        vendorId: vendorId.trim() || undefined,
        classification,
        channel,
        isRegulatoryChannel,
      });
      setDescription('');
      setVendorId('');
      setIsRegulatoryChannel(false);
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Third Parties &amp; Data Sharing</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        A one-off data-sharing path separate from the standing vendor
        relationship. Sharing with a named vendor requires that vendor to
        be risk-tiered and data-share ready first, unless the channel is a
        recognized regulatory one (e.g. the CBJ portal) — still subject to
        classification and secure-channel checks either way.
      </p>

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

      {canRequest ? (
        <form
          onSubmit={(ev) => void submit(ev)}
          style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            Description
            <input
              aria-label="Data sharing description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              minLength={20}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            Vendor ID (optional)
            <input
              aria-label="Vendor ID"
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            Classification
            <select
              aria-label="Data classification"
              value={classification}
              onChange={(e) => setClassification(e.target.value)}
            >
              {DATA_CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            Channel
            <select
              aria-label="Sharing channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              {DATA_SHARING_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <input
              type="checkbox"
              checked={isRegulatoryChannel}
              onChange={(e) => setIsRegulatoryChannel(e.target.checked)}
            />
            Regulatory channel
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Request share'}
          </button>
        </form>
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No data-sharing requests yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '64rem' }}>
              <thead>
                <tr>
                  <th style={head}>Description</th>
                  <th style={head}>Classification</th>
                  <th style={head}>Channel</th>
                  <th style={head}>SLA due</th>
                  <th style={head}>Status</th>
                  <th style={head}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={cell}>{r.description}</td>
                    <td style={cell}>{r.classification}</td>
                    <td style={cell}>{r.channel}</td>
                    <td style={cell}>{r.slaDueAt.slice(0, 10)}</td>
                    <td style={cell}>
                      {r.isApproved ? 'Approved' : r.isDeclined ? 'Declined' : 'Pending'}
                    </td>
                    <td style={cell}>
                      {canApprove && r.isPending ? (
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => approveDataSharingApproval(r.id))}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => declineDataSharingApproval(r.id))}
                          >
                            Decline
                          </button>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loadError ? null : (
        <p>Loading&hellip;</p>
      )}
    </main>
  );
}
