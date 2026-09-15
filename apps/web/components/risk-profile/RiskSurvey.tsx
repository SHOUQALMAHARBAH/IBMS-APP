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
import { useLanguage } from '../../lib/i18n/language-context';
import type { TranslationKey } from '../../lib/i18n/translations';
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

// Module scope has no translator, so this maps to label KEYS and each
// consumer resolves them.
const TYPE_LABEL_KEY: Record<AssetType, TranslationKey> = {
  building: 'rsTypeBuilding',
  equipment: 'rsTypePlant',
  stock: 'rsTypeStock',
  vehicle: 'rsTypeFleet',
  other: 'rsTypeOther',
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
  const { t } = useLanguage();
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
          ? t('rsNotFound')
          : err instanceof ApiError
            ? err.message
            : t('rsLoadError'),
      );
    }
  }, [riskProfileId, onLoaded, t]);

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
          : t('rsAddError'),
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
          : t('rsRemoveError'),
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
  if (!profile) return <p>{t('rsLoading')}</p>;

  const { assets, sumInsured } = profile;
  const isVehicle = assetType === 'vehicle';

  return (
    <section style={sectionStyle}>
      <h2 style={{ marginTop: 0 }}>{t('rsAssetSurvey')}</h2>
      <p style={{ opacity: 0.8 }}>
        {t('rsSurveyIntro')}
      </p>

      <div style={summaryPanelStyle}>
        <strong>{t('rsDerivedSi')}</strong>
        <div style={summaryGridStyle}>
          <Figure label={t('rsProperty')} value={sumInsured.propertySumInsured} />
          <Figure
            label={t('rsBusinessInterruption')}
            value={sumInsured.businessInterruptionSumInsured}
          />
          <Figure label={t('rsTotal')} value={sumInsured.totalSumInsured} />
          <Figure
            label={t('rsIndemnityPeriod')}
            value={
              sumInsured.indemnityPeriodMonths == null
                ? '—'
                : `${sumInsured.indemnityPeriodMonths} months`
            }
          />
          <Figure
            label={t('rsFleetVehicles')}
            value={String(sumInsured.fleetVehicleCount)}
          />
        </div>
      </div>

      {assets.length === 0 ? (
        <p style={{ color: 'var(--ink-secondary)', marginTop: '1rem' }}>{t('rpNoAssetsYet')}</p>
      ) : (
        <table style={assetTableStyle}>
          <thead>
            <tr>
              <th style={assetCellStyle}>{t('rsColType')}</th>
              <th style={assetCellStyle}>{t('rsColDescription')}</th>
              <th style={assetCellStyle}>{t('rsColDeclaredValue')}</th>
              <th style={assetCellStyle}>{t('rsColAnnualGrossProfit')}</th>
              <th style={assetCellStyle}>{t('rsColIndemnityMonths')}</th>
              <th style={assetCellStyle}>{t('rsColFleet')}</th>
              {canEdit ? <th style={assetCellStyle}>&nbsp;</th> : null}
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr key={asset.id}>
                <td style={assetCellStyle}>{t(TYPE_LABEL_KEY[asset.assetType])}</td>
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
                      aria-label={t('rsRemoveAssetAria', {
                        type: t(TYPE_LABEL_KEY[asset.assetType]),
                      })}
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
            <label htmlFor="asset-type" style={labelStyle}>{t('rpAssetType')}</label>
            <select
              id="asset-type"
              value={assetType}
              onChange={(e) => setAssetType(e.target.value as AssetType)}
              style={inputStyle}
            >
              {ASSET_TYPES.map((at) => (
                <option key={at} value={at}>
                  {t(TYPE_LABEL_KEY[at])}
                </option>
              ))}
            </select>
          </div>

          <div style={assetFieldStyle}>
            <label htmlFor="asset-description" style={labelStyle}>{t('rpAssetDescription')}</label>
            <input
              id="asset-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={inputStyle}
            />
          </div>

          {isVehicle ? (
            <div style={assetFieldStyle}>
              <label htmlFor="asset-fleet" style={labelStyle}>{t('rpVehicleCount')}</label>
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
                <label htmlFor="asset-declared" style={labelStyle}>{t('rpDeclaredValue')}</label>
                <input
                  id="asset-declared"
                  inputMode="decimal"
                  placeholder={t('rsValuePlaceholder')}
                  value={declaredValue}
                  onChange={(e) => setDeclaredValue(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={assetFieldStyle}>
                <label htmlFor="asset-profit" style={labelStyle}>{t('rpAnnualGrossProfit')}</label>
                <input
                  id="asset-profit"
                  inputMode="decimal"
                  placeholder={t('rsBiBasis')}
                  value={annualGrossProfit}
                  onChange={(e) => setAnnualGrossProfit(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={assetFieldStyle}>
                <label htmlFor="asset-indemnity" style={labelStyle}>{t('rpIndemnityPeriod')}</label>
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
            {saving ? t('rsAdding') : t('rsAddButton')}
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
