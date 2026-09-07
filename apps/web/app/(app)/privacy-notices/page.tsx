'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  PRIVACY_NOTICE_TOUCHPOINTS,
  createPrivacyNotice,
  listPrivacyNotices,
  recordPrivacyNoticeLegalReview,
  type PrivacyNotice,
} from '../../../lib/pdpl/privacy-notice-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const ROLES = ['DATA_PROTECTION_OFFICER', 'COMPLIANCE_OFFICER'];

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

export default function PrivacyNoticesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canManage = hasAny(user?.roles, ROLES);

  const [rows, setRows] = useState<PrivacyNotice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [touchpoint, setTouchpoint] = useState<string>(PRIVACY_NOTICE_TOUCHPOINTS[0]);
  const [textEn, setTextEn] = useState('');
  const [textAr, setTextAr] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await listPrivacyNotices());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError
          ? err.message
          : 'Could not load privacy notices — try again.',
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
      await createPrivacyNotice({ touchpoint, textEn: textEn.trim(), textAr: textAr.trim() });
      setTextEn('');
      setTextAr('');
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Notices</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        Bilingual, version-controlled privacy notice text for each
        touchpoint. Publishing IS the act — there is no draft state, and
        each publish for a touchpoint is a new, immutable version.
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

      {canManage ? (
        <form
          onSubmit={(ev) => void submit(ev)}
          style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            Touchpoint
            <select
              aria-label="Touchpoint"
              value={touchpoint}
              onChange={(e) => setTouchpoint(e.target.value)}
            >
              {PRIVACY_NOTICE_TOUCHPOINTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            Text (English)
            <textarea
              aria-label="Notice text (English)"
              value={textEn}
              onChange={(e) => setTextEn(e.target.value)}
              required
              rows={3}
              style={{ minWidth: '20rem' }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            Text (Arabic)
            <textarea
              aria-label="Notice text (Arabic)"
              dir="rtl"
              value={textAr}
              onChange={(e) => setTextAr(e.target.value)}
              required
              rows={3}
              style={{ minWidth: '20rem' }}
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Publishing…' : 'Publish new version'}
          </button>
        </form>
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No privacy notices published yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '56rem' }}>
              <thead>
                <tr>
                  <th style={head}>Touchpoint</th>
                  <th style={head}>Version</th>
                  <th style={head}>Published</th>
                  <th style={head}>Legally reviewed</th>
                  <th style={head}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => (
                  <tr key={n.id}>
                    <td style={cell}>{n.touchpoint}</td>
                    <td style={cell}>{n.versionNumber}</td>
                    <td style={cell}>{n.publishedAt.slice(0, 10)}</td>
                    <td style={cell}>{n.legallyReviewedAt ? n.legallyReviewedAt.slice(0, 10) : '—'}</td>
                    <td style={cell}>
                      {canManage && !n.legallyReviewedAt ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => recordPrivacyNoticeLegalReview(n.id))}
                        >
                          Record legal review
                        </button>
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
