'use client';

import { type CSSProperties, type FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  ASSET_TYPES,
  createInformationAsset,
  DATA_CLASSIFICATIONS,
  listInformationAssets,
  updateInformationAsset,
  type AssetType,
  type DataClassification,
  type InformationAsset,
} from '../../../lib/supporting-operations/information-asset-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'left',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '26rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };

export default function InformationAssetsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [assets, setAssets] = useState<InformationAsset[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [assetType, setAssetType] = useState<AssetType>('customer_data');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [classification, setClassification] = useState<DataClassification>('CONFIDENTIAL');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  const load = useCallback(async () => {
    try {
      setAssets(await listInformationAssets());
      setLoadError(null);
    } catch (err) {
      setAssets(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the information-asset.manage permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load information assets — try again.',
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
      await createInformationAsset({ name, assetType, ownerUserId, classification });
      setName('');
      setOwnerUserId('');
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : 'Could not create the information asset.',
      );
    }
  }

  function startEdit(asset: InformationAsset) {
    setEditingId(asset.id);
    setEditingName(asset.name);
  }

  async function saveEdit(id: string) {
    setFormError(null);
    try {
      await updateInformationAsset(id, { name: editingName });
      setEditingId(null);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not update the asset.');
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Information Assets</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        The ISO 27001 Clause 8.1 asset inventory — every information asset
        (a data store, a document repository, a backup, an integration)
        with its owner and classification.
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {assets ? (
        assets.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No information assets recorded yet.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', minWidth: '36rem' }}>
            <thead>
              <tr>
                <th style={head}>Name</th>
                <th style={head}>Type</th>
                <th style={head}>Classification</th>
                <th style={head}>Owner</th>
                <th style={head} />
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.id}>
                  <td style={cell}>
                    {editingId === asset.id ? (
                      <input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                      />
                    ) : (
                      asset.name
                    )}
                  </td>
                  <td style={cell}>{asset.assetType}</td>
                  <td style={cell}>{asset.classification}</td>
                  <td style={cell}>{asset.ownerUserId}</td>
                  <td style={cell}>
                    {editingId === asset.id ? (
                      <button type="button" onClick={() => saveEdit(asset.id)}>
                        Save
                      </button>
                    ) : (
                      <button type="button" onClick={() => startEdit(asset)}>
                        Rename
                      </button>
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
        <h2>Record a new information asset</h2>
        <label style={labelStyle}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label style={labelStyle}>
          Type
          <select value={assetType} onChange={(e) => setAssetType(e.target.value as AssetType)}>
            {ASSET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Owner user ID
          <input
            value={ownerUserId}
            onChange={(e) => setOwnerUserId(e.target.value)}
            required
          />
        </label>
        <label style={labelStyle}>
          Classification
          <select
            value={classification}
            onChange={(e) => setClassification(e.target.value as DataClassification)}
          >
            {DATA_CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        {formError ? (
          <p role="alert" style={errorStyle}>
            {formError}
          </p>
        ) : null}
        <button type="submit">Record asset</button>
      </form>
    </main>
  );
}
