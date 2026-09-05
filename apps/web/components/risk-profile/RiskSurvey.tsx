'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ASSET_TYPES,
  addAsset,
  deleteAsset,
  getRiskProfile,
  type AssetType,
  type RiskProfileWithSurvey,
} from '../../lib/risk-profile/risk-profile-api';
import { ApiError } from '../../lib/auth/api-client';
import {
  buttonStyle,
  errorStyle,
  inputStyle,
  labelStyle,
} from '../auth/auth-form.styles';
import { sectionStyle, smallButtonStyle } from '../lead/lead.styles';
import {
  assetCellStyle,
  assetFieldStyle,
  assetFormStyle,
  assetTableStyle,
  summaryFigureLabelStyle,
  summaryFigureValueStyle,
  summaryGridStyle,
  summaryPanelStyle,
} from './risk-profile.styles';

const TYPE_LABELS: Record<AssetType, string> = {
  building: 'Building',
  equipment: 'Plant & equipment',
  stock: 'Stock / contents',
  vehicle: 'Vehicle fleet',
  other: 'Other',
};

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={summaryFigureLabelStyle}>{label}</div>
      <div style={summaryFigureValueStyle}>{value}</div>
    </div>
  );
}

export function RiskSurvey({
  riskProfileId,
  canEdit,
  onLoaded,
}: {
  riskProfileId: string;
  canEdit: boolean;
  /** Lets the parent screen show the site label / customer once it's known. */
  onLoaded?: (profile: RiskProfileWithSurvey) => void;
}) {
  const [profile, setProfile] = useState<RiskProfileWithSurvey | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [assetType, setAssetType] = useState<AssetType>('building');
  const [description, setDescription] = useState('');
  const [declaredValue, setDeclaredValue] = useState('');
  const [annualGrossProfit, setAnnualGrossProfit] = useState('');
  const [indemnityPeriodMonths, setIndemnityPeriodMonths] = useState('');
  const [fleetVehicleCount, setFleetVehicleCount] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getRiskProfile(riskProfileId);
      setProfile(result);
      setLoadError(null);
      onLoaded?.(result);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && (err.status === 403 || err.status === 404)
          ? 'This risk profile could not be found — it may not exist, or you may not have access to it.'
          : err instanceof ApiError
            ? err.message
            : 'Could not load the risk survey — try again.',
      );
    }
  }, [riskProfileId, onLoaded]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  function resetForm() {
    setAssetType('building');
    setDescription('');
    setDeclaredValue('');
    setAnnualGrossProfit('');
    setIndemnityPeriodMonths('');
    setFleetVehicleCount('');
  }

  async function handleAddAsset(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const isVehicle = assetType === 'vehicle';
      await addAsset(riskProfileId, {
        assetType,
        description: description || undefined,
        declaredValue: isVehicle || !declaredValue ? undefined : declaredValue,
        annualGrossProfit:
          isVehicle || !annualGrossProfit ? undefined : annualGrossProfit,
        indemnityPeriodMonths:
          isVehicle || !indemnityPeriodMonths
            ? undefined
            : Number(indemnityPeriodMonths),
        fleetVehicleCount:
          isVehicle && fleetVehicleCount
            ? Number(fleetVehicleCount)
            : undefined,
      });
      resetForm();
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : 'Could not add the asset — try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(assetId: string) {
    setFormError(null);
    try {
      await deleteAsset(riskProfileId, assetId);
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : 'Could not remove the asset — try again.',
      );
    }
  }

  if (loadError) {
    return (
      <p role="alert" style={errorStyle}>
        {loadError}
      </p>
    );
  }
  if (!profile) return <p>Loading risk survey…</p>;

  const { assets, sumInsured } = profile;
  const isVehicle = assetType === 'vehicle';

  return (
    <section style={sectionStyle}>
      <h2 style={{ marginTop: 0 }}>Asset survey</h2>
      <p style={{ opacity: 0.8 }}>
        Process 6 — the detailed building / equipment / stock / annual-profit /
        fleet survey for this location. The Sum Insured and indemnity period
        below are derived from it.
      </p>

      <div style={summaryPanelStyle}>
        <strong>Derived Sum Insured</strong>
        <div style={summaryGridStyle}>
          <Figure label="Property (JOD)" value={sumInsured.propertySumInsured} />
          <Figure
            label="Business Interruption (JOD)"
            value={sumInsured.businessInterruptionSumInsured}
          />
          <Figure label="Total (JOD)" value={sumInsured.totalSumInsured} />
          <Figure
            label="Indemnity period"
            value={
              sumInsured.indemnityPeriodMonths == null
                ? '—'
                : `${sumInsured.indemnityPeriodMonths} months`
            }
          />
          <Figure
            label="Fleet vehicles"
            value={String(sumInsured.fleetVehicleCount)}
          />
        </div>
      </div>

      {assets.length === 0 ? (
        <p style={{ opacity: 0.6, marginTop: '1rem' }}>
          No assets surveyed yet for this location.
        </p>
      ) : (
        <table style={assetTableStyle}>
          <thead>
            <tr>
              <th style={assetCellStyle}>Type</th>
              <th style={assetCellStyle}>Description</th>
              <th style={assetCellStyle}>Declared value</th>
              <th style={assetCellStyle}>Annual gross profit</th>
              <th style={assetCellStyle}>Indemnity (mo)</th>
              <th style={assetCellStyle}>Fleet</th>
              {canEdit ? <th style={assetCellStyle}>&nbsp;</th> : null}
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr key={asset.id}>
                <td style={assetCellStyle}>{TYPE_LABELS[asset.assetType]}</td>
                <td style={assetCellStyle}>{asset.description ?? '—'}</td>
                <td style={assetCellStyle}>{asset.declaredValue ?? '—'}</td>
                <td style={assetCellStyle}>{asset.annualGrossProfit ?? '—'}</td>
                <td style={assetCellStyle}>
                  {asset.indemnityPeriodMonths ?? '—'}
                </td>
                <td style={assetCellStyle}>{asset.fleetVehicleCount ?? '—'}</td>
                {canEdit ? (
                  <td style={assetCellStyle}>
                    <button
                      type="button"
                      style={smallButtonStyle}
                      aria-label={`Remove ${TYPE_LABELS[asset.assetType]} asset`}
                      onClick={() => void handleRemove(asset.id)}
                    >
                      Remove
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canEdit ? (
        <form onSubmit={(e) => void handleAddAsset(e)} style={assetFormStyle}>
          <div style={assetFieldStyle}>
            <label htmlFor="asset-type" style={labelStyle}>
              Asset type
            </label>
            <select
              id="asset-type"
              value={assetType}
              onChange={(e) => setAssetType(e.target.value as AssetType)}
              style={inputStyle}
            >
              {ASSET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          <div style={assetFieldStyle}>
            <label htmlFor="asset-description" style={labelStyle}>
              Description (optional)
            </label>
            <input
              id="asset-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={inputStyle}
            />
          </div>

          {isVehicle ? (
            <div style={assetFieldStyle}>
              <label htmlFor="asset-fleet" style={labelStyle}>
                Number of vehicles
              </label>
              <input
                id="asset-fleet"
                type="number"
                min={1}
                value={fleetVehicleCount}
                onChange={(e) => setFleetVehicleCount(e.target.value)}
                style={inputStyle}
              />
            </div>
          ) : (
            <>
              <div style={assetFieldStyle}>
                <label htmlFor="asset-declared" style={labelStyle}>
                  Declared value (JOD)
                </label>
                <input
                  id="asset-declared"
                  inputMode="decimal"
                  placeholder="e.g. 500000.000"
                  value={declaredValue}
                  onChange={(e) => setDeclaredValue(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={assetFieldStyle}>
                <label htmlFor="asset-profit" style={labelStyle}>
                  Annual gross profit (JOD)
                </label>
                <input
                  id="asset-profit"
                  inputMode="decimal"
                  placeholder="Business Interruption basis"
                  value={annualGrossProfit}
                  onChange={(e) => setAnnualGrossProfit(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={assetFieldStyle}>
                <label htmlFor="asset-indemnity" style={labelStyle}>
                  Indemnity period (months)
                </label>
                <input
                  id="asset-indemnity"
                  type="number"
                  min={1}
                  max={60}
                  value={indemnityPeriodMonths}
                  onChange={(e) => setIndemnityPeriodMonths(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={saving}
            style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}
          >
            {saving ? 'Adding…' : 'Add asset'}
          </button>
          {formError ? (
            <p role="alert" style={{ ...errorStyle, flexBasis: '100%' }}>
              {formError}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
