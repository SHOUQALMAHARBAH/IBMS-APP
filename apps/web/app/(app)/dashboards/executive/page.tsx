'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getExecutiveDashboard,
  type ExecutiveDashboardSummary,
} from '../../../../lib/management-reporting/executive-dashboard-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../../components/lead/lead.styles';
import { useLanguage } from '../../../../lib/i18n/language-context';

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const statStyle: CSSProperties = { fontSize: '1.4rem', fontWeight: 600 };
const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
  gap: '1.25rem',
};

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div>
      <div style={statStyle}>{value}</div>
      <div style={{ opacity: 0.75 }}>{label}</div>
    </div>
  );
}

export default function ExecutiveDashboardPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { language } = useLanguage();
  const isArabic = language === 'AR';

  const [summary, setSummary] = useState<ExecutiveDashboardSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [branchId, setBranchId] = useState('');
  const [insuranceLine, setInsuranceLine] = useState('');
  const [asOf, setAsOf] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  const load = useCallback(async () => {
    try {
      setSummary(
        await getExecutiveDashboard({
          branchId: branchId.trim() || undefined,
          insuranceLine: insuranceLine.trim() || undefined,
          asOf: asOf.trim() || undefined,
        }),
      );
      setLoadError(null);
    } catch (err) {
      setSummary(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? isArabic
            ? 'لا تملك صلاحية dashboard.executive.view.'
            : "You don't hold the dashboard.executive.view permission."
          : err instanceof ApiError
            ? err.message
            : isArabic
              ? 'تعذّر تحميل لوحة الإدارة التنفيذية — حاول مرة أخرى.'
              : 'Could not load the Executive Dashboard — try again.',
      );
    }
  }, [branchId, insuranceLine, asOf, isArabic]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
    // Filters apply on explicit submit only — same as the sibling dashboards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function applyFilters(ev: React.FormEvent) {
    ev.preventDefault();
    void load();
  }

  if (isLoading || !user) return null;

  const h = summary?.headlines;

  return (
    <main style={pageStyle}>
      <h1>
        {isArabic ? 'لوحة الإدارة التنفيذية' : 'Executive Dashboard'}
      </h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {isArabic
          ? 'ملخّص تنفيذي يجمع لوحات المبيعات والوثائق والمطالبات والمالية والامتثال. كل رقم مأخوذ كما هو من لوحته الأصلية — لا يُعاد احتسابه هنا، حتى لا يختلف الملخّص عمّا يلخّصه.'
          : 'The Sales, Policy, Claims, Financial and Compliance dashboards rolled up. Every figure is lifted verbatim from the dashboard that produced it — nothing is recalculated here, so the summary can never disagree with what it summarises.'}
      </p>

      <form
        onSubmit={applyFilters}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          alignItems: 'flex-end',
          margin: '0.75rem 0',
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {isArabic ? 'رقم الفرع' : 'Branch ID'}
          <input
            aria-label="Branch ID filter"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {isArabic ? 'فرع التأمين' : 'Insurance line'}
          <input
            aria-label="Insurance line filter"
            value={insuranceLine}
            onChange={(e) => setInsuranceLine(e.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {isArabic ? 'كما في تاريخ' : 'As of'}
          <input
            aria-label="As of date"
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </label>
        <button type="submit">
          {isArabic ? 'تطبيق المرشّحات' : 'Apply filters'}
        </button>
      </form>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {summary && h ? (
        <>
          <p style={{ opacity: 0.6 }}>
            {isArabic
              ? `الفترة ${summary.periodLabel} · كما في ${summary.asOf.slice(0, 10)}`
              : `Period ${summary.periodLabel} · as of ${summary.asOf.slice(0, 10)}`}
          </p>

          <section style={sectionStyle}>
            <h2>{isArabic ? 'المبيعات' : 'Sales'}</h2>
            <div style={gridStyle}>
              <Stat
                value={h.newLeadsCount}
                label={isArabic ? 'عملاء محتملون جدد' : 'New leads'}
              />
              <Stat
                value={`${h.leadConversionRatePercent}%`}
                label={isArabic ? 'معدّل التحويل' : 'Conversion rate'}
              />
              <Stat
                value={h.commissionIncomeJod}
                label={isArabic ? 'دخل العمولات (د.أ)' : 'Commission income (JOD)'}
              />
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{isArabic ? 'الوثائق' : 'Policy'}</h2>
            <div style={gridStyle}>
              <Stat
                value={h.activePoliciesCount}
                label={isArabic ? 'وثائق سارية' : 'Active policies'}
              />
              <Stat
                value={h.expiringPoliciesCount}
                label={isArabic ? 'وثائق تقترب من الانتهاء' : 'Expiring soon'}
              />
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{isArabic ? 'المطالبات' : 'Claims'}</h2>
            <div style={gridStyle}>
              <Stat
                value={h.openClaimsCount}
                label={isArabic ? 'مطالبات مفتوحة' : 'Open claims'}
              />
              <Stat
                value={h.outstandingClaimsValueJod}
                label={
                  isArabic
                    ? 'قيمة المطالبات القائمة (د.أ)'
                    : 'Outstanding claims value (JOD)'
                }
              />
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{isArabic ? 'المالية' : 'Financial'}</h2>
            <div style={gridStyle}>
              <Stat
                value={h.receivablesOutstandingJod}
                label={
                  isArabic ? 'ذمم مدينة قائمة (د.أ)' : 'Receivables outstanding (JOD)'
                }
              />
              <Stat
                value={h.payablesOutstandingJod}
                label={
                  isArabic
                    ? 'مستحقات للمؤمِّنين (د.أ)'
                    : 'Payables to insurers (JOD)'
                }
              />
            </div>
          </section>

          <section style={sectionStyle}>
            <h2>{isArabic ? 'الامتثال' : 'Compliance'}</h2>
            <div style={gridStyle}>
              <Stat
                value={h.openDsrCount}
                label={
                  isArabic
                    ? 'طلبات أصحاب البيانات المفتوحة'
                    : 'Open data-subject requests'
                }
              />
              <Stat
                value={h.openComplianceExceptionsCount}
                label={
                  isArabic
                    ? 'استثناءات امتثال مفتوحة'
                    : 'Open compliance exceptions'
                }
              />
            </div>
            <p style={{ opacity: 0.6, marginTop: '0.5rem' }}>
              {isArabic
                ? 'الاستثناءات = تنبيهات غسل الأموال المفتوحة + سجل الاختراقات المفتوح.'
                : 'Exceptions = open AML/CFT alerts + open breach-register entries.'}
            </p>
          </section>
        </>
      ) : null}
    </main>
  );
}
