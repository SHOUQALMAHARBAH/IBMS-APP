'use client';

import { Suspense, useEffect, useState } from 'react';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { SentenceWithLink } from '../../../../components/ui/SentenceWithLink';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { type Prospect } from '../../../../lib/prospect/prospect-api';
import { getLead } from '../../../../lib/lead/lead-api';
import { ProspectConversionForm } from '../../../../components/prospect/ProspectConversionForm';
import {
  PageHeader,
} from '../../../../components/ui';
import { pageStackStyle } from '../../../../components/lead/lead.styles';
import { hasPermission } from '../../../../lib/auth/permissions';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../../lib/i18n/permission-refusal';

// Roles the seeded permission grid grants `prospect.capture` to
// (packages/db/prisma/seed-data/permissions.ts) — a client-side hint only,
// same convention as leads/page.tsx's CAN_CREATE_LEAD_ROLES. The backend
// independently enforces this on POST /prospects regardless.

function ConvertProspectForm() {
  const router = useRouter();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  /*
   * 🔴 THE FULL WALK §A ITEM 8 — THE NAME IS READ FROM THE RECORD, NOT FROM THE URL.
   *
   * This took `?leadFullName=<the person's name>` as a display prefill, passed by the pipeline
   * board. A URL is the least private place a name can sit — the address bar of a screen a broker
   * demonstrates to an audience, the browser history, and the referrer header of everything the
   * next page loads. The backend never trusted it (`ProspectService.convert` looks the Lead up
   * from `leadId`), so it was a convenience paid for in exposure.
   *
   * `GET /leads/:id` is gated on `lead.list.read`, the SAME code the board that linked here holds,
   * so ⛔ no code was minted and no gate widened.
   *
   * ⚠️ AND A FAILED READ IS NOT AN ERROR ON THIS SCREEN. The prefill is a convenience: a reader
   * who holds `prospect.create` and not `lead.list.read` reaches a form that works and types the
   * name, which is what they did before the prefill existed. ⛔ An error banner here would report
   * the screen as broken over a field the form does not require.
   */
  const leadId = searchParams.get('leadId') ?? '';
  /*
   * 🔴 A SETTLED STATE, NOT JUST A NAME — AND MY FIRST VERSION OF THIS DID NOT WORK.
   *
   * `ProspectConversionForm` takes the prefill as `useState(defaultCompanyName ?? '')`, so the prop
   * is captured AT MOUNT. A name that arrives from an async read afterwards never reaches the
   * field, and the test said so: the company name stayed empty.
   *
   * ⛔ AND THE FORM IS NOT MADE TO RE-SYNC A PROP INTO ITS STATE, which was the other available
   * fix. A controlled field that reassigns itself when a prop lands is a field that can jump under
   * somebody already typing in it — and that read would land late precisely when the network is
   * slow, which is exactly when a person has started typing.
   *
   * ⟶ So the form MOUNTS ONCE, after the question is settled either way. `'loading'` is a third
   *   state rather than a missing name, which is what lets the no-prefill branch be a real branch.
   */
  const [prefill, setPrefill] = useState<
    { state: 'loading' } | { state: 'settled'; companyName?: string }
  >({ state: 'loading' });

  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    void (async () => {
      try {
        const lead = await getLead(leadId);
        if (!cancelled)
          setPrefill({ state: 'settled', companyName: lead.fullName });
      } catch {
        /*
         * SETTLED WITH NO NAME — deliberately not an error. The prefill is a convenience: a reader
         * who holds `prospect.create` and not `lead.list.read` reaches a working form and types the
         * name, which is what they did before the prefill existed. ⛔ An error banner here would
         * report the screen as broken over a field the form does not require.
         */
        if (!cancelled) setPrefill({ state: 'settled' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  function handleProspectCreated(prospect: Prospect) {
    router.push(`/prospects/${prospect.id}`);
  }

  if (!leadId) {
    return (
      <p role="alert" style={errorStyle}>
        <SentenceWithLink
          sentence={t('prospnNoLeadSelected')}
          linkLabel={t('prospnPipelineLink')}
          onLinkClick={() => router.push('/leads')}
        />
      </p>
    );
  }

  if (prefill.state === 'loading') return <p>{t('commonLoading')}</p>;

  return (
    <ProspectConversionForm
      leadId={leadId}
      defaultCompanyName={prefill.companyName}
      onProspectCreated={handleProspectCreated}
    />
  );
}

export default function NewProspectPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  if (isLoading || !user) return null;

  const canCaptureProspect = hasPermission(user, 'prospect.capture');

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('prosnHeading')}
        description={t('prosnIntro')}
      />
      {canCaptureProspect ? (
        <Suspense fallback={null}>
          <ConvertProspectForm />
        </Suspense>
      ) : (
        <p role="alert" style={errorStyle}>
          {permissionRefusal(t, 'prosnRefusalAct', 'prospect.capture')}
        </p>
      )}
    </main>
  );
}
