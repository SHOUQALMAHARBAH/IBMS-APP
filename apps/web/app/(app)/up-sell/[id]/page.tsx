'use client';

import { useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../../lib/i18n/enum-labels';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  convertUpSellRecommendation,
  dismissUpSellRecommendation,
  getUpSellRecommendation,
  type UpSellRecommendation,
} from '../../../../lib/up-sell/up-sell-api';
import { ApiError } from '../../../../lib/auth/api-client';
import {
  buttonStyle,
  errorStyle,
} from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import {
  profileFieldLabelStyle,
  profileFieldValueStyle,
} from '../../../../components/prospect/prospect.styles';
import {
  upSellActionsStyle,
  upSellBadgeStyle,
  upSellFigureRowStyle,
} from '../../../../components/up-sell/up-sell.styles';
import { ConsentCaptureWidget } from '../../../../components/pdpl/ConsentCaptureWidget';
import { PrivacyNoticeDisplay } from '../../../../components/pdpl/PrivacyNoticeDisplay';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { formatDateTime } from '../../../../lib/i18n/format';
import { hasPermission } from '../../../../lib/auth/permissions';


export default function UpSellRecommendationDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();
  const { language, t } = useLanguage();

  const [recommendation, setRecommendation] =
    useState<UpSellRecommendation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [dismissing, setDismissing] = useState(false);

  const load = useCallback(async () => {
    try {
      setRecommendation(await getUpSellRecommendation(params.id));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && (err.status === 403 || err.status === 404)
          ? t('upsdNotFound')
          : err instanceof ApiError
            ? err.message
            : t('upsdLoadError'),
      );
    }
  }, [params.id, t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  async function run(
    fn: () => Promise<UpSellRecommendation>,
    fallback: string,
  ) {
    setActionError(null);
    setBusy(true);
    try {
      setRecommendation(await fn());
      setDismissing(false);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  const canConvert = hasPermission(user, 'up-sell.convert');

  return (
    <main style={pageStyle}>
      <button
        type="button"
        onClick={() =>
          router.push(
            recommendation
              ? `/up-sell?customerId=${recommendation.customerId}`
              : '/up-sell',
          )
        }
        style={{ cursor: 'pointer' }}
      >
        {t('upsdBackToList')}
      </button>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {recommendation ? (
        <>
          <h1>{t('upsdHeading')}</h1>
          <p style={{ opacity: 0.8 }}>
            <span style={upSellBadgeStyle}>{t(ENUM_LABEL.UpSellStatus[recommendation.status])}</span>
          </p>

          <ConsentCaptureWidget
            customerId={recommendation.customerId}
            purpose="MARKETING"
            label={t('upsdConsent')}
            defaultConsentTextVersion="privacy-notice-v1.2"
          />
          <PrivacyNoticeDisplay
            touchpoint="renewal_cross_sell"
            canRead={hasPermission(user, 'privacy-notice.read')}
          />

          <div style={upSellFigureRowStyle}>
            <div>
              <div style={profileFieldLabelStyle}>
                {t('upsDesignedSumInsured')}
              </div>
              <div style={profileFieldValueStyle}>
                {recommendation.currentSumInsured}
              </div>
            </div>
            <div>
              <div style={profileFieldLabelStyle}>
                {t('upsCurrentAssetValue')}
              </div>
              <div style={profileFieldValueStyle}>
                {recommendation.currentAssetValue}
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              gap: '2rem',
              flexWrap: 'wrap',
              marginTop: '1rem',
            }}
          >
            <div>
              <div style={profileFieldLabelStyle}>{t('upsdFlagged')}</div>
              <div style={profileFieldValueStyle}>
                {formatDateTime(recommendation.detectedAt, language)}
              </div>
            </div>
            {recommendation.resolvedAt ? (
              <div>
                <div style={profileFieldLabelStyle}>{t('upsdResolved')}</div>
                <div style={profileFieldValueStyle}>
                  {formatDateTime(recommendation.resolvedAt, language)}
                </div>
              </div>
            ) : null}
            {recommendation.dismissReason ? (
              <div>
                <div style={profileFieldLabelStyle}>{t('upsdDismissReason')}</div>
                <div style={profileFieldValueStyle}>
                  {recommendation.dismissReason}
                </div>
              </div>
            ) : null}
          </div>

          {recommendation.status === 'OPEN' && canConvert ? (
            <div style={upSellActionsStyle}>
              <button
                type="button"
                disabled={busy}
                style={{ ...buttonStyle, width: 'auto' }}
                onClick={() =>
                  void run(
                    () => convertUpSellRecommendation(recommendation.id),
                    t('upsConvertError'),
                  )
                }
              >
                {busy ? t('upsWorking') : t('upsConvertButton')}
              </button>
              {dismissing ? (
                <>
                  <input
                    aria-label={t('upsdWhyNotPursued')}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('upsDismissPlaceholder')}
                    style={{ minWidth: '18rem' }}
                  />
                  <button
                    type="button"
                    disabled={busy || reason.trim().length < 3}
                    style={{ ...buttonStyle, width: 'auto' }}
                    onClick={() =>
                      void run(
                        () =>
                          dismissUpSellRecommendation(
                            recommendation.id,
                            reason.trim(),
                          ),
                        t('upsDismissError'),
                      )
                    }
                  >
                    {t('upsConfirmDismiss')}
                  </button>
                  <button
                    type="button"
                    style={{ ...buttonStyle, width: 'auto' }}
                    onClick={() => setDismissing(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  style={{ ...buttonStyle, width: 'auto' }}
                  onClick={() => setDismissing(true)}
                >
                  Dismiss…
                </button>
              )}
            </div>
          ) : null}

          {actionError ? (
            <p role="alert" style={errorStyle}>
              {actionError}
            </p>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
