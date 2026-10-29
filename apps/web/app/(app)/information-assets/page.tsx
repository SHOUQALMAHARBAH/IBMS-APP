'use client';

import { type CSSProperties, type FormEvent, useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
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
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';
import { EntitySearch } from '../../../components/ui/EntitySearch';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid var(--border-default)' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: 'var(--space-2)', maxWidth: '26rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' };

export default function InformationAssetsPage() {
  const { t } = useLanguage();
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
  }, [isLoading, user, router, t]);

  const load = useCallback(async () => {
    try {
      setAssets(await listInformationAssets());
      setLoadError(null);
    } catch (err) {
      setAssets(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'iassetRefusalAct', 'information-asset.manage')
          : err instanceof ApiError
            ? err.message
            : t('iassetLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

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
        err instanceof ApiError ? err.message : t('iassetCreateError'),
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
      setFormError(err instanceof ApiError ? err.message : t('iassetUpdateError'));
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('iassetHeading')}
        description={t('iassetIntro')}
      />

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      <form onSubmit={onCreate} style={formStyle}>
        <h2>{t('iassetCreateHeading')}</h2>
        <label style={labelStyle}>
          {t('iassetColName')}
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label style={labelStyle}>
          {t('iassetColType')}
          <select value={assetType} onChange={(e) => setAssetType(e.target.value as AssetType)}>
            {ASSET_TYPES.map((opt) => (
              <option key={opt} value={opt}>
                {t(ENUM_LABEL.InformationAssetType[opt])}
              </option>
            ))}
          </select>
        </label>
        <EntitySearch
          kind="user"
          value={ownerUserId}
          onChange={setOwnerUserId}
          label={t('iassetOwnerUserId')}
          required
        />
        <label style={labelStyle}>
          {t('iassetColClassification')}
          <select
            value={classification}
            onChange={(e) => setClassification(e.target.value as DataClassification)}
          >
            {DATA_CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>
                {t(ENUM_LABEL.DataClassification[c])}
              </option>
            ))}
          </select>
        </label>
        {formError ? (
          <ErrorState title={formError} />
        ) : null}
        <button type="submit">{t('iassetSubmitButton')}</button>
      </form>

      {assets ? (
        assets.length === 0 ? (
          <EmptyState title={t('iassetNone')} />
        ) : (
          <Card padded={false}>
            <Table>
            <thead>
              <tr>
                <Th>{t('iassetColName')}</Th>
                <Th>{t('iassetColType')}</Th>
                <Th>{t('iassetColClassification')}</Th>
                <Th>{t('iassetColOwner')}</Th>
                <th style={head} />
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <Tr key={asset.id}>
                  <Td>
                    {editingId === asset.id ? (
                      <input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                      />
                    ) : (
                      asset.name
                    )}
                  </Td>
                  <Td>{asset.assetType}</Td>
                  <Td>{t(ENUM_LABEL.DataClassification[asset.classification])}</Td>
                  {/* ITEM 1 — the accountable colleague by NAME. This is the register whose whole
                      purpose is saying WHO is accountable for a classified asset, and it was
                      naming them by uuid. */}
                  <Td>
                    {asset.ownerName ? <bdi>{asset.ownerName}</bdi> : '—'}
                  </Td>
                  <Td>
                    {editingId === asset.id ? (
                      <button type="button" onClick={() => saveEdit(asset.id)}>
                        {t('commonSave')}
                      </button>
                    ) : (
                      <button type="button" onClick={() => startEdit(asset)}>
                        {t('commonRename')}
                      </button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          </Card>
        )
      ) : loadError ? null : (
        <SkeletonList rows={4} label={t('iassetLoading')} />
      )}

    </main>
  );
}
