'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  createPaymentChannel,
  disablePaymentChannel,
  listPaymentChannels,
  type PaymentChannel,
} from '../../../lib/finance/payment-channel-api';
import { ApiError } from '../../../lib/auth/api-client';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { formatNumber } from '../../../lib/i18n/format';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';
import { EntitySearch } from '../../../components/ui/EntitySearch';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Select,
  SkeletonList,
  Table,
  Td,
  Th,
  TextInput,
  Tile,
  Tiles,
  Tr,
} from '../../../components/ui';

/*
 * WHERE CLIENT MONEY IS SENT — the design pass's plain-list screen.
 *
 * FOUR DEFECTS THE PASS FOUND HERE, and the second is the one worth reading.
 *
 * (1) THE TABLE RENDERED TWO VOCABULARIES RAW. `{r.ownerType}` printed `customer` and
 *     `{r.channelType}` printed `bank_transfer` — at an Arabic reader, on the screen that records
 *     where a client's premium goes. The labels have existed all along: `ENUM_LABEL
 *     .PaymentChannelType` carries all four channel types in both languages, and `pcCustomer` /
 *     `pcInsurer` carry the two owner kinds — and THIS SCREEN ALREADY USED THEM, in the create
 *     form's own `<option>` list, four lines above the table that did not. No new word was needed.
 *
 * (2) AND `check:raw-values` IS STRUCTURALLY BLIND TO BOTH. Measured: that gate keys on field
 *     names typed as a PRISMA ENUM, and `PaymentChannel.ownerType` and `.channelType` are free
 *     `String` columns whose vocabulary lives in a schema doc comment — `// customer | insurer`
 *     and `// bank_transfer | cheque | card | cash`. So the gate reported *5 shape-A renders, all
 *     declared, 0 undeclared* while two undeclared ones sat here. It is the `patternType` class it
 *     already reports as unresolvable, one step further out: `patternType` at least shares a name
 *     with something the script can see. Recorded in the design register rather than fixed in the
 *     gate — widening it to every `String` column whose comment looks like a vocabulary is a
 *     matcher change with its own blast radius, and this batch is not where that gets decided.
 *
 * (3) THE INTRO WAS MUTED WITH `opacity: 0.75`, which globals.css forbids in as many words: it
 *     composites toward whatever is behind the element, so the rendered colour is one no token
 *     declared and axe measures the blend rather than the token.
 *
 * (4) THE LOADING STATE WAS A BARE `<p>` with the word "loading" and no shape, so the page jumped
 *     when the rows arrived. `SkeletonList` is the primitive that already existed for it.
 *
 * THE THREE EM DASHES ARE LEFT ALONE, DELIBERATELY. An em dash stands in for three different
 * facts — a value that does not exist yet, one that does not apply, and one withheld from this
 * reader — and which of them each cell means is a wording decision rather than a render. Measured
 * before leaving them: the i18n tree holds no general "not recorded" phrase to slice (the nearest,
 * `rcNoRenewalRequest`, is a whole sentence about a renewal request), and `bankName` on a CASH
 * channel genuinely DOES NOT APPLY while on a bank transfer it is NOT RECORDED — two different
 * sentences the screen cannot currently tell apart. They are in the register with that reading.
 *
 * WHY TWO TILES AND NOT FOUR. A tile shows something this screen's own read already returns, and
 * what it returns is the list — so the only honest figures are counts over it. Active and disabled
 * PARTITION that list and the list itself is immediately below, which is why neither tile needs a
 * denominator clause: the whole is on the screen. A third tile would have to be invented.
 */

const CHANNEL_TYPES = ['bank_transfer', 'cheque', 'card', 'cash'] as const;

export default function PaymentChannelsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t, language } = useLanguage();
  // Four-action Phase 4 — three codes, because adding a destination for client money and disabling one
  // are not one capability. A Finance officer can be given the LIST (which recording a receipt needs)
  // without either.
  const canCreate = hasPermission(user, 'payment-channel.create');
  const canDeactivate = hasPermission(user, 'payment-channel.deactivate');

  const [rows, setRows] = useState<PaymentChannel[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [ownerType, setOwnerType] = useState('customer');
  const [ownerId, setOwnerId] = useState('');
  const [channelType, setChannelType] = useState('bank_transfer');
  const [label, setLabel] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountLast4, setAccountLast4] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await listPaymentChannels());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'pcRefusalAct', 'payment-channel.read')
          : err instanceof ApiError
            ? err.message
            : t('pcLoadError'),
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

  const counts = useMemo(() => {
    const active = (rows ?? []).filter((r) => r.isActive).length;
    return { active, disabled: (rows ?? []).length - active };
  }, [rows]);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await createPaymentChannel({
        ownerType,
        ...(ownerType === 'customer'
          ? { customerId: ownerId.trim() }
          : { insurerId: ownerId.trim() }),
        channelType,
        label: label.trim(),
        ...(bankName.trim() ? { bankName: bankName.trim() } : {}),
        ...(accountLast4.trim() ? { accountLast4: accountLast4.trim() } : {}),
      });
      setOwnerId('');
      setLabel('');
      setBankName('');
      setAccountLast4('');
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('pcAddError'));
    } finally {
      setBusy(false);
    }
  }

  async function disable(id: string) {
    setBusy(true);
    setFormError(null);
    try {
      await disablePaymentChannel(id);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('pcDisableError'));
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  /*
   * THE OWNER KIND, IN WORDS. A two-value vocabulary stored as a free string, so this resolves it
   * explicitly rather than through a label map: an unrecognised third value renders AS STORED
   * rather than as `undefined`, which is the notification-bell defect and the reason
   * `ENUM_LABEL` maps are `satisfies Labels<Union>` wherever the union is real.
   */
  const ownerKindLabel = (kind: string) =>
    kind === 'customer' ? t('pcCustomer') : kind === 'insurer' ? t('pcInsurer') : kind;

  const channelTypeLabel = (kind: string) =>
    kind in ENUM_LABEL.PaymentChannelType
      ? t(ENUM_LABEL.PaymentChannelType[kind as (typeof CHANNEL_TYPES)[number]])
      : kind;

  return (
    <main style={pageStackStyle}>
      <PageHeader title={t('pcHeading')} description={t('pcIntro')} />

      {rows && rows.length > 0 ? (
        <Tiles>
          <Tile icon="coins" value={formatNumber(counts.active, language)} label={t('pcActive')} />
          <Tile
            icon="clock"
            value={formatNumber(counts.disabled, language)}
            label={t('pcDisabled')}
          />
        </Tiles>
      ) : null}

      {canCreate ? (
        <Card title={t('pcAddButton')}>
          <form
            onSubmit={submit}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))',
              gap: 'var(--space-3)',
              alignItems: 'end',
            }}
          >
            <Field label={t('pcOwnerFieldLabel')}>
              {(p) => (
                <Select {...p} value={ownerType} onChange={(e) => setOwnerType(e.target.value)}>
                  <option value="customer">{t('pcCustomer')}</option>
                  <option value="insurer">{t('pcInsurer')}</option>
                </Select>
              )}
            </Field>
            {/* ONE FIELD ON EITHER BRANCH, as of 2026-10-02. This used to say the insurer branch keeps a
                raw id field because "insurers are a different list with a different search" — true when
                written and false now that `GET /insurers/search` exists. The two branches point at
                different SOURCES, which is exactly what a source is for; neither is a uuid box. */}
            {ownerType === 'customer' ? (
              <EntitySearch
                kind="customer"
                value={ownerId}
                onChange={setOwnerId}
                label={t('pcCustomerIdLabel')}
                required
              />
            ) : (
              <EntitySearch
                kind="insurer"
                value={ownerId}
                onChange={setOwnerId}
                label={t('pcInsurerIdLabel')}
                required
              />
            )}
            <Field label={t('pcChannelTypeLabel')}>
              {(p) => (
                <Select
                  {...p}
                  value={channelType}
                  onChange={(e) => setChannelType(e.target.value)}
                >
                  {CHANNEL_TYPES.map((opt) => (
                    <option key={opt} value={opt}>
                      {t(ENUM_LABEL.PaymentChannelType[opt])}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('pcLabelLabel')} required>
              {(p) => (
                <TextInput
                  {...p}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={t('pcBankPlaceholder')}
                  required
                />
              )}
            </Field>
            <Field label={t('pcBankNameLabel')}>
              {(p) => (
                <TextInput {...p} value={bankName} onChange={(e) => setBankName(e.target.value)} />
              )}
            </Field>
            {/*
              TWO ARIA-LABEL KEYS WERE WITHDRAWN HERE, AND ONE OF THEM WAS LESS ACCURATE THAN THE
              VISIBLE LABEL IT OVERRODE.

              This input carried `aria-label={t('pcAccountAria')}` — "Account last 4" — over a
              visible label reading "Account (last 2–4 digits)". An `aria-label` REPLACES the
              accessible name, so a screen-reader user was told the field wants four digits while a
              sighted reader was told two to four, and the sighted one was right. The select above
              carried `pcOwnerTypeAria`, whose value is character-for-character `pcColOwnerType` —
              a second home for one string.

              Both keys are gone in both languages and `Field` supplies the association through
              `htmlFor`, so the accessible name IS the visible words. That is the general rule: an
              `aria-label` on a control that already has a visible label is a second answer to what
              the control is called, and the copy nobody proof-reads is the one that drifts.
            */}
            <Field label={t('pcAccountLabel')}>
              {(p) => (
                <TextInput
                  {...p}
                  value={accountLast4}
                  onChange={(e) => setAccountLast4(e.target.value)}
                  inputMode="numeric"
                  maxLength={4}
                />
              )}
            </Field>
            <Button type="submit" variant="primary" loading={busy}>
              {busy ? t('pcSavingButton') : t('pcAddButton')}
            </Button>
          </form>
        </Card>
      ) : null}

      {formError ? <ErrorState title={formError} /> : null}

      {loadError ? (
        <ErrorState title={loadError} />
      ) : rows === null ? (
        <SkeletonList rows={4} label={t('pcLoading')} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('pcNone')} />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <Tr>
                {/* Item 1 — the second column holds the owner's NAME now, so the headings
                    swap roles: the first says what KIND of owner, the second says who. */}
                <Th>{t('pcColOwnerType')}</Th>
                <Th>{t('pcOwnerLabel')}</Th>
                <Th>{t('pcColType')}</Th>
                <Th>{t('pcLabelLabel')}</Th>
                <Th>{t('pcColBank')}</Th>
                <Th>{t('pcColAccount')}</Th>
                <Th>{t('pcColStatus')}</Th>
                <Th />
              </Tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>{ownerKindLabel(r.ownerType)}</Td>
                  {/* ITEM 1 — the owner's name, whichever kind of owner it is, resolved by
                      the api through each entity's own resolver. An em dash where the owning row
                      is gone: `PaymentChannel` carries no FK to either, so that is a real state,
                      and "we hold no name" is not "the name is this uuid". */}
                  <Td>{r.ownerName ? <bdi>{r.ownerName}</bdi> : '—'}</Td>
                  <Td>{channelTypeLabel(r.channelType)}</Td>
                  <Td>{r.label}</Td>
                  <Td>{r.bankName ?? '—'}</Td>
                  <Td>{r.accountLast4 ? `••••${r.accountLast4}` : '—'}</Td>
                  <Td>
                    {/*
                      A STATE READ BY ITS SHAPE BEFORE ITS COLOUR. `<strong>Active</strong>` beside
                      plain `Disabled` distinguished the two by weight alone, which is the one cue a
                      reader scanning a column does not pick up. A pill with a tone does it in both
                      themes, and the tone is chosen by MEANING: a disabled destination for client
                      money is not an error, it is retired.
                    */}
                    <Badge tone={r.isActive ? 'success' : 'neutral'}>
                      {r.isActive ? t('pcActive') : t('pcDisabled')}
                    </Badge>
                  </Td>
                  <Td>
                    {canDeactivate && r.isActive ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => void disable(r.id)}
                      >
                        {t('pcDisableButton')}
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </main>
  );
}
