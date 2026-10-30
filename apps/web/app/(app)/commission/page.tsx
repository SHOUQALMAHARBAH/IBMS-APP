'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  createCommissionAgreement,
  listCommissionAgreements,
  listCommissionInsurers,
  type CommissionAgreement,
  type Insurer,
} from '../../../lib/commission/commission-api';
import {
  listInsuranceLines,
  type InsuranceLine,
} from '../../../lib/insurer/insurance-line-api';
import { ApiError } from '../../../lib/auth/api-client';
import {
  Card,
  DateEcho,
  EmptyState,
  ErrorState,
  Hint,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';


function pct(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : v;
}


export default function CommissionRatesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t, language } = useLanguage();
  const canManage =
    !!user &&
    hasPermission(user, 'commission-rate.manage');

  const [rows, setRows] = useState<CommissionAgreement[] | null>(null);
  const [insurers, setInsurers] = useState<Insurer[]>([]);
  const [lines, setLines] = useState<InsuranceLine[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [insurerId, setInsurerId] = useState('');
  const [insuranceLine, setInsuranceLine] = useState('');
  const [ratePercent, setRatePercent] = useState('');
  const [vatRatePercent, setVatRatePercent] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ags, ins, lns] = await Promise.all([
        listCommissionAgreements(),
        listCommissionInsurers().catch(() => [] as Insurer[]),
        // Swallowed like the insurer list above: a reader without `insurer.read` still sees the
        // rate table, just without a picker to add one — which is correct, because they cannot
        // add one anyway.
        listInsuranceLines().catch(() => [] as InsuranceLine[]),
      ]);
      setRows(ags);
      setInsurers(ins);
      // Standard lines only. The API resolves a rate's line from a CODE, and an office addition
      // has none by design — offering one here would render a choice the server must refuse.
      // Recorded as the follow-up that makes office lines reachable on this table.
      setLines(lns.filter((l) => l.isStandard && l.code !== null));
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'crateRefusalAct', 'commission-rate.manage')
          : err instanceof ApiError
            ? err.message
            : t('crateLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await createCommissionAgreement({
        insurerId: insurerId.trim(),
        insuranceLine: insuranceLine.trim(),
        ratePercent: ratePercent.trim(),
        ...(vatRatePercent.trim() ? { vatRatePercent: vatRatePercent.trim() } : {}),
        ...(effectiveFrom ? { effectiveFrom } : {}),
      });
      setInsuranceLine('');
      setRatePercent('');
      setVatRatePercent('');
      setEffectiveFrom('');
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : t('crateOpenError'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('crateHeading')}
        description={t('crateIntro')}
      />

      {canManage ? (
        <form
          onSubmit={submit}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-3)',
            alignItems: 'end',
            margin: '1rem 0',
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {t('crateInsurerLabel')}
            <select
              aria-label={t('crateInsurerLabel')}
              value={insurerId}
              onChange={(e) => setInsurerId(e.target.value)}
              required
            >
              <option value="">{t('crateSelectInsurer')}</option>
              {insurers.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {t('crateLineLabel')}
            {/*
              A PICKER, not free text. This was an `<input>` with a placeholder showing a line
              name — and the Arabic placeholder was worded differently from the seeded Arabic name,
              so following it produced a rate on a line nothing could match. The server now
              resolves the line and refuses an unknown one, which would have turned that trap into
              a 422 for anyone who typed. Choosing a CODE removes the guess entirely and is
              language-independent: the label follows the reader, the value does not.
            */}
            <select
              aria-label={t('crateLineLabel')}
              value={insuranceLine}
              onChange={(e) => setInsuranceLine(e.target.value)}
              required
            >
              <option value="">{t('crateLineChoose')}</option>
              {lines.map((l) => (
                <option key={l.id} value={l.code ?? ''}>
                  {language === 'AR' ? l.nameAr : l.nameEn}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {t('crateRateLabel')}
            <input
              aria-label={t('crateRateAria')}
              value={ratePercent}
              onChange={(e) => setRatePercent(e.target.value)}
              placeholder="15"
              inputMode="decimal"
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {t('crateVatLabel')}
            <input
              aria-label={t('crateVatAria')}
              value={vatRatePercent}
              onChange={(e) => setVatRatePercent(e.target.value)}
              placeholder="16"
              inputMode="decimal"
            />
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label htmlFor="crate-effective-from">
              {t('crateEffectiveFromLabel')}
            </label>
            <input
              id="crate-effective-from"
              aria-describedby="crate-effective-from-hint"
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
            <Hint id="crate-effective-from-hint">
              {t('crateEffectiveFromHint')}
            </Hint>
            <DateEcho value={effectiveFrom} />
          </div>
          <button type="submit" disabled={busy}>
            {busy ? t('crateSavingButton') : t('crateOpenWindowButton')}
          </button>
        </form>
      ) : null}
      {formError ? (
        <ErrorState title={formError} />
      ) : null}

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <EmptyState title={t('crateNone')} />
        ) : (
          <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>{t('crateInsurerLabel')}</Th>
                  <Th>{t('crateLineLabel')}</Th>
                  <Th numeric>{t('crateColRate')}</Th>
                  <Th numeric>{t('crateColVat')}</Th>
                  <Th>{t('crateEffectiveFromLabel')}</Th>
                  <Th>{t('crateColEffectiveTo')}</Th>
                  <Th>{t('crateColStatus')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <bdi>{r.insurerName}</bdi>
                    </Td>
                    <Td>
                      <bdi>{r.insuranceLine}</bdi>
                    </Td>
                    <Td numeric>
                      {pct(r.ratePercent)}
                    </Td>
                    <Td numeric>
                      {pct(r.vatRatePercent)}
                    </Td>
                    <Td>{r.effectiveFrom.slice(0, 10)}</Td>
                    <Td>
                      {r.effectiveTo ? r.effectiveTo.slice(0, 10) : '—'}
                    </Td>
                    <Td>
                      {r.isOpen ? <strong>{t('crateOpen')}</strong> : 'Closed'}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )
      ) : loadError ? null : (
        <SkeletonList rows={4} label={t('crateLoading')} />
      )}
    </main>
  );
}
