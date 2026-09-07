'use client';

import { type CSSProperties, type FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  createVendor,
  listVendors,
  updateVendor,
  VENDOR_TYPES,
  type Vendor,
  type VendorType,
} from '../../../lib/supporting-operations/vendor-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '26rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };

export default function VendorsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [vendorType, setVendorType] = useState<VendorType>('other');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  const load = useCallback(async () => {
    try {
      setVendors(await listVendors());
      setLoadError(null);
    } catch (err) {
      setVendors(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the vendor.manage permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load vendors — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      await createVendor({ name, vendorType });
      setName('');
      setVendorType('other');
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create the vendor.');
    }
  }

  function startEdit(vendor: Vendor) {
    setEditingId(vendor.id);
    setEditingName(vendor.name);
  }

  async function saveEdit(id: string) {
    setFormError(null);
    try {
      await updateVendor(id, { name: editingName });
      setEditingId(null);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not update the vendor.');
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Vendors</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        The shared vendor register — Procurement&apos;s general
        (&ldquo;other&rdquo;) vendors alongside Vendor Management&apos;s
        risk-tiered ones (insurer, reinsurer, loss adjuster, IT/cloud,
        printing/archiving, marketing/call-centre). Open a vendor for risk
        tiering, Data Processing Agreements, and termination.
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {vendors ? (
        vendors.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No vendors recorded yet.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', minWidth: '30rem' }}>
            <thead>
              <tr>
                <th style={head}>Name</th>
                <th style={head}>Type</th>
                <th style={head}>Risk tier</th>
                <th style={head} />
              </tr>
            </thead>
            <tbody>
              {vendors.map((vendor) => (
                <tr key={vendor.id}>
                  <td style={cell}>
                    {editingId === vendor.id ? (
                      <input
                        dir="auto"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                      />
                    ) : (
                      <bdi>{vendor.name}</bdi>
                    )}
                  </td>
                  <td style={cell}>{vendor.vendorType}</td>
                  <td style={cell}>{vendor.riskTier ?? 'unassigned'}</td>
                  <td style={cell}>
                    {editingId === vendor.id ? (
                      <button type="button" onClick={() => saveEdit(vendor.id)}>
                        Save
                      </button>
                    ) : (
                      <>
                        <button type="button" onClick={() => startEdit(vendor)}>
                          Rename
                        </button>{' '}
                        <Link href={`/vendors/${vendor.id}`}>Manage</Link>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : loadError ? null : (
        <p>Loading&hellip;</p>
      )}

      <form onSubmit={onCreate} style={formStyle}>
        <h2>Record a new vendor</h2>
        <label style={labelStyle}>
          Name
          <input dir="auto" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label style={labelStyle}>
          Type
          <select
            value={vendorType}
            onChange={(e) => setVendorType(e.target.value as VendorType)}
          >
            {VENDOR_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {formError ? (
          <p role="alert" style={errorStyle}>
            {formError}
          </p>
        ) : null}
        <button type="submit">Record vendor</button>
      </form>
    </main>
  );
}
