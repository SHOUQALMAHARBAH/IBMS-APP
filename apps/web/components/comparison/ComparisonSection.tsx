'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  buildComparison,
  downloadComparisonDocument,
  getComparisonForRfq,
  type ComparisonMatrix,
  type InsurerScoreInput,
} from '../../lib/comparison/comparison-api';
import { ApiError } from '../../lib/auth/api-client';
import { useLanguage } from '../../lib/i18n/language-context';
import { formatDateTime, formatMoney } from '../../lib/i18n/format';
import { buttonStyle, errorStyle } from '../auth/auth-form.styles';
import { rfqCellStyle, rfqTableStyle } from '../rfq/rfq.styles';
import {
  comparisonCalloutStyle,
  comparisonPreStyle,
  comparisonScoreGridStyle,
  comparisonScrollStyle,
} from './comparison.styles';

interface Props {
  rfqId: string;
  isPlacement: boolean;
}

interface ScoreDraft {
  insurerQualityScore: string;
  serviceScore: string;
}

export function ComparisonSection({ rfqId, isPlacement }: Props) {
  const { language, t } = useLanguage();
  const [matrix, setMatrix] = useState<ComparisonMatrix | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, ScoreDraft>>({});

  const load = useCallback(async () => {
    try {
      const m = await getComparisonForRfq(rfqId);
      setMatrix(m);
      setScores(
        Object.fromEntries(
          m.rows.map((r) => [
            r.quotation.insurerId,
            {
              insurerQualityScore: r.insurerQualityScore ?? '',
              serviceScore: r.serviceScore ?? '',
            },
          ]),
        ),
      );
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setMatrix(null);
      } else {
        setLoadError(
          err instanceof ApiError
            ? err.message
            : t('comparisonLoadError'),
        );
      }
    } finally {
      setLoaded(true);
    }
  }, [rfqId, t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function runBuild() {
    setBusy(true);
    setBuildError(null);
    try {
      const scoreInputs: InsurerScoreInput[] = Object.entries(scores)
        .map(([insurerId, d]) => ({
          insurerId,
          insurerQualityScore: d.insurerQualityScore.trim() || undefined,
          serviceScore: d.serviceScore.trim() || undefined,
        }))
        .filter((s) => s.insurerQualityScore || s.serviceScore);
      await buildComparison({
        rfqId,
        scores: scoreInputs.length > 0 ? scoreInputs : undefined,
      });
      await load();
    } catch (err) {
      setBuildError(
        err instanceof ApiError
          ? err.message
          : t('comparisonBuildError'),
      );
    } finally {
      setBusy(false);
    }
  }

  // Part F item #7 — the customer's own languagePreference decides the
  // document's language server-side; no picker here for a first pass.
  async function downloadDocument(id: string) {
    setBuildError(null);
    try {
      const blob = await downloadComparisonDocument(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `quotation-comparison-${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setBuildError(
        err instanceof ApiError
          ? err.message
          : t('comparisonDownloadError'),
      );
    }
  }

  function setScore(
    insurerId: string,
    key: keyof ScoreDraft,
    value: string,
  ) {
    setScores((prev) => {
      const current = prev[insurerId] ?? {
        insurerQualityScore: '',
        serviceScore: '',
      };
      return { ...prev, [insurerId]: { ...current, [key]: value } };
    });
  }

  return (
    <section>
      <h2 style={{ marginTop: '2.5rem' }}>{t('comparisonHeading')}</h2>
      <p style={{ opacity: 0.7, margin: '0.25rem 0 0' }}>{t('comparisonIntro')}</p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {!loaded ? (
        <p>{t('commonLoading')}</p>
      ) : matrix === null ? (
        <p style={{ opacity: 0.6 }}>
          {t('comparisonNoneYet')}
          {isPlacement ? t('comparisonNoneYetPlacementHint') : ''}
        </p>
      ) : (
        <>
          <div style={{ ...comparisonPreStyle, opacity: 0.6, marginTop: '0.5rem' }}>
            {t('comparisonBuiltAt', { date: formatDateTime(matrix.builtAt, language) })}
          </div>

          <button
            type="button"
            onClick={() => void downloadDocument(matrix.id)}
            style={{ margin: '0.5rem 0' }}
          >
            {t('comparisonDownloadButton')}
          </button>

          <div style={comparisonScrollStyle}>
            <table style={rfqTableStyle}>
              <thead>
                <tr>
                  <th style={rfqCellStyle}>{t('rfqColumnInsurer')}</th>
                  <th style={rfqCellStyle}>{t('comparisonColumnPremium')}</th>
                  <th style={rfqCellStyle}>{t('comparisonColumnDeductible')}</th>
                  <th style={rfqCellStyle}>{t('comparisonColumnLiabilityLimit')}</th>
                  <th style={rfqCellStyle}>{t('comparisonColumnBiPeriod')}</th>
                  <th style={rfqCellStyle}>{t('comparisonColumnCommissionPercent')}</th>
                  <th style={rfqCellStyle}>{t('comparisonColumnQuality')}</th>
                  <th style={rfqCellStyle}>{t('comparisonColumnService')}</th>
                  <th style={rfqCellStyle}>{t('comparisonColumnExclusionsConditions')}</th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => {
                  const q = row.quotation;
                  return (
                    <tr key={row.id}>
                      <td style={rfqCellStyle}>
                        {q.insurer.name}
                        {q.isCurrentVersion ? null : (
                          <span
                            style={{ opacity: 0.6, fontSize: '0.78rem' }}
                            title={t('comparisonSupersededTitle')}
                          >
                            {' '}
                            · {t('comparisonSupersededSuffix')}
                          </span>
                        )}
                      </td>
                      <td style={rfqCellStyle}>
                        {formatMoney(q.premium, language, q.currency)}
                      </td>
                      <td style={rfqCellStyle}>
                        {formatMoney(q.deductible, language, q.currency)}
                      </td>
                      <td style={rfqCellStyle}>
                        {formatMoney(q.liabilityLimit, language, q.currency)}
                      </td>
                      <td style={rfqCellStyle}>
                        {q.biPeriodMonths === null
                          ? '—'
                          : t('comparisonBiPeriodAbbrev', { months: q.biPeriodMonths })}
                      </td>
                      <td style={rfqCellStyle}>
                        {q.commissionRatePercent === null
                          ? '—'
                          : `${q.commissionRatePercent}%`}
                      </td>
                      <td style={rfqCellStyle}>
                        {row.insurerQualityScore ?? '—'}
                      </td>
                      <td style={rfqCellStyle}>{row.serviceScore ?? '—'}</td>
                      <td style={rfqCellStyle}>
                        <p style={comparisonPreStyle}>
                          {[q.exclusions, q.conditions]
                            .filter(Boolean)
                            .join('\n\n') || '—'}
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {matrix.missingInsurers.length > 0 ? (
            <div style={comparisonCalloutStyle}>
              <strong>{t('comparisonMissingInsurersLabel')}</strong>{' '}
              {matrix.missingInsurers
                .map((i) => `${i.name}${i.status ? ` (${i.status})` : ''}`)
                .join(', ')}
            </div>
          ) : null}
          {matrix.declinedInsurers.length > 0 ? (
            <div style={comparisonCalloutStyle}>
              <strong>{t('comparisonDeclinedInsurersLabel')}</strong>{' '}
              {matrix.declinedInsurers.map((i) => i.name).join(', ')}
            </div>
          ) : null}
        </>
      )}

      {buildError ? (
        <p role="alert" style={errorStyle}>
          {buildError}
        </p>
      ) : null}

      {isPlacement ? (
        <div style={{ marginTop: '1.25rem' }}>
          {matrix && matrix.rows.length > 0 ? (
            <>
              <strong>{t('comparisonScoresHeading')}</strong>
              <div style={comparisonScoreGridStyle}>
                <span style={{ opacity: 0.6, fontSize: '0.8rem' }}>{t('comparisonScoreColumnInsurer')}</span>
                <span style={{ opacity: 0.6, fontSize: '0.8rem' }}>{t('comparisonScoreColumnQuality')}</span>
                <span style={{ opacity: 0.6, fontSize: '0.8rem' }}>{t('comparisonScoreColumnService')}</span>
                {matrix.rows.map((row) => {
                  const insurerId = row.quotation.insurerId;
                  const draft = scores[insurerId] ?? {
                    insurerQualityScore: '',
                    serviceScore: '',
                  };
                  return (
                    <ScoreRow
                      key={insurerId}
                      name={row.quotation.insurer.name}
                      insurerId={insurerId}
                      draft={draft}
                      onChange={setScore}
                      qualityAriaLabel={t('comparisonQualityScoreAria', { name: row.quotation.insurer.name })}
                      serviceAriaLabel={t('comparisonServiceScoreAria', { name: row.quotation.insurer.name })}
                    />
                  );
                })}
              </div>
            </>
          ) : null}
          <button
            type="button"
            disabled={busy}
            style={{ ...buttonStyle, width: 'auto', marginTop: '0.75rem' }}
            onClick={() => void runBuild()}
          >
            {busy
              ? t('comparisonBuildingButton')
              : matrix
                ? t('comparisonRebuildButton')
                : t('comparisonBuildButton')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ScoreRow({
  name,
  insurerId,
  draft,
  onChange,
  qualityAriaLabel,
  serviceAriaLabel,
}: {
  name: string;
  insurerId: string;
  draft: ScoreDraft;
  onChange: (id: string, key: keyof ScoreDraft, value: string) => void;
  qualityAriaLabel: string;
  serviceAriaLabel: string;
}) {
  return (
    <>
      <span>{name}</span>
      <input
        aria-label={qualityAriaLabel}
        value={draft.insurerQualityScore}
        inputMode="decimal"
        onChange={(e) =>
          onChange(insurerId, 'insurerQualityScore', e.target.value)
        }
      />
      <input
        aria-label={serviceAriaLabel}
        value={draft.serviceScore}
        inputMode="decimal"
        onChange={(e) => onChange(insurerId, 'serviceScore', e.target.value)}
      />
    </>
  );
}
