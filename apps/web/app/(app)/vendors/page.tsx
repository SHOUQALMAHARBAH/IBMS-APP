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
import { useLanguage } from '../../../lib/i18n/language-context';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid var(--border-default)' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '26rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };

export default function VendorsPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [vendorType, setVendorType] = useState<VendorType>('other');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // Part F item #6 — bilingual full-text search over name. Submit-triggered,
  // matching customers/page.tsx's and prospects/page.tsx's own.
  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  const load = useCallback(async (term: string) => {
    try {
      setVendors(await listVendors(undefined, term || undefined));
      setLoadError(null);
    } catch (err) {
      setVendors(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('venNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('venLoadError'),
      );
    }
  }, [t]);

  function onSearchSubmit(e: FormEvent) {
    e.preventDefault();
    setSearchTerm(search);
  }

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load(searchTerm);
    })();
  }, [user, searchTerm, load, t]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      await createVendor({ name, vendorType });
      setName('');
      setVendorType('other');
      await load(searchTerm);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('venCreateError'));
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
      await load(searchTerm);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('venUpdateError'));
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('venHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('venIntro')}
      </p>

      <form onSubmit={onSearchSubmit} style={{ margin: '0.75rem 0' }}>
        <label htmlFor="vendor-search" style={{ marginInlineEnd: '0.5rem' }}>
          Search
        </label>
        <input
          id="vendor-search"
          dir="auto"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('venSearchPlaceholder')}
        />
        <button type="submit" style={{ marginInlineStart: '0.5rem', cursor: 'pointer' }}>
          Search
        </button>
      </form>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {vendors ? (
        vendors.length === 0 ? (
          <p style={{ color: 'var(--ink-secondary)' }}>
            {searchTerm ? t('venNoneMatch') : t('venNone')}
          </p>
        ) : (
          <table style={{ borderCollapse: 'collapse', minWidth: '30rem' }}>
            <thead>
              <tr>
                <th style={head}>{t('venColName')}</th>
                <th style={head}>{t('venColType')}</th>
                <th style={head}>{t('venColRiskTier')}</th>
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
                        <Link href={`/vendors/${vendor.id}`}>{t('venManageButton')}</Link>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : loadError ? null : (
        <p>{t('venLoading')}</p>
      )}

      <form onSubmit={onCreate} style={formStyle}>
        <h2>{t('venCreateHeading')}</h2>
        <label style={labelStyle}>
          {t('venColName')}
          <input dir="auto" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label style={labelStyle}>
          {t('venColType')}
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
        <button type="submit">{t('venSubmitButton')}</button>
      </form>
    </main>
  );
}
