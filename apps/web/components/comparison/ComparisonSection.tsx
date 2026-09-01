'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  buildComparison,
  getComparisonForRfq,
  type ComparisonMatrix,
  type InsurerScoreInput,
} from '../../lib/comparison/comparison-api';
import { ApiError } from '../../lib/auth/api-client';
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

function money(value: string | null, currency: string): string {
  if (value === null) return '—';
  const n = Number(value);
  return Number.isFinite(n)
    ? `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
    : `${currency} ${value}`;
}

export function ComparisonSection({ rfqId, isPlacement }: Props) {
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
            : 'Could not load the comparison — try again.',
        );
      }
    } finally {
      setLoaded(true);
    }
  }, [rfqId]);

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
          : 'Could not build the comparison — try again.',
      );
    } finally {
      setBusy(false);
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
      <h2 style={{ marginTop: '2.5rem' }}>Comparison</h2>
      <p style={{ opacity: 0.7, margin: '0.25rem 0 0' }}>
        Built from every current-version quotation — price alongside coverage,
        exclusions, deductibles, limits, and (optional) insurer quality /
        service scores. Never price alone.
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {!loaded ? (
        <p>Loading…</p>
      ) : matrix === null ? (
        <p style={{ opacity: 0.6 }}>
          No comparison built yet.
          {isPlacement
            ? ' Capture at least one quotation, then build the matrix.'
            : ''}
        </p>
      ) : (
        <>
          <div style={{ ...comparisonPreStyle, opacity: 0.6, marginTop: '0.5rem' }}>
            Built {new Date(matrix.builtAt).toLocaleString()}
          </div>

          <div style={comparisonScrollStyle}>
            <table style={rfqTableStyle}>
              <thead>
                <tr>
                  <th style={rfqCellStyle}>Insurer</th>
                  <th style={rfqCellStyle}>Premium</th>
                  <th style={rfqCellStyle}>Deductible</th>
                  <th style={rfqCellStyle}>Liability limit</th>
                  <th style={rfqCellStyle}>BI period</th>
                  <th style={rfqCellStyle}>Commission %</th>
                  <th style={rfqCellStyle}>Quality</th>
                  <th style={rfqCellStyle}>Service</th>
                  <th style={rfqCellStyle}>Exclusions / conditions</th>
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
                            title="This quotation was revised after the matrix was built — rebuild to refresh."
                          >
                            {' '}
                            · superseded
                          </span>
                        )}
                      </td>
                      <td style={rfqCellStyle}>
                        {money(q.premium, q.currency)}
                      </td>
                      <td style={rfqCellStyle}>
                        {money(q.deductible, q.currency)}
                      </td>
                      <td style={rfqCellStyle}>
                        {money(q.liabilityLimit, q.currency)}
                      </td>
                      <td style={rfqCellStyle}>
                        {q.biPeriodMonths === null
                          ? '—'
                          : `${q.biPeriodMonths} mo`}
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
              <strong>No quote to compare:</strong>{' '}
              {matrix.missingInsurers
                .map((i) => `${i.name}${i.status ? ` (${i.status})` : ''}`)
                .join(', ')}
            </div>
          ) : null}
          {matrix.declinedInsurers.length > 0 ? (
            <div style={comparisonCalloutStyle}>
              <strong>Declined:</strong>{' '}
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
              <strong>Insurer quality / service scores (0–100, optional)</strong>
              <div style={comparisonScoreGridStyle}>
                <span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Insurer</span>
                <span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Quality</span>
                <span style={{ opacity: 0.6, fontSize: '0.8rem' }}>Service</span>
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
              ? 'Building…'
              : matrix
                ? 'Rebuild comparison'
                : 'Build comparison'}
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
}: {
  name: string;
  insurerId: string;
  draft: ScoreDraft;
  onChange: (id: string, key: keyof ScoreDraft, value: string) => void;
}) {
  return (
    <>
      <span>{name}</span>
      <input
        aria-label={`Quality score for ${name}`}
        value={draft.insurerQualityScore}
        inputMode="decimal"
        onChange={(e) =>
          onChange(insurerId, 'insurerQualityScore', e.target.value)
        }
      />
      <input
        aria-label={`Service score for ${name}`}
        value={draft.serviceScore}
        inputMode="decimal"
        onChange={(e) => onChange(insurerId, 'serviceScore', e.target.value)}
      />
    </>
  );
}
