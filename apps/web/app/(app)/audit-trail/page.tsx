'use client';

import { Suspense, type CSSProperties, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter, useSearchParams } from 'next/navigation';
import { hasPermission } from '../../../lib/auth/permissions';
import {
  isWorkflowEntityType,
  WORKFLOW_ENTITY_LABEL,
  WORKFLOW_ENTITY_TYPES,
} from '../../../lib/audit-trail/workflow-entity-types';
import { Pagination } from '../../../components/ui/Pagination';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  browseAuditTrail,
  getDocumentHistory,
  getWorkflowHistory,
  type AuditAction,
  type AuditLogEntry,
  type DocumentHistory,
} from '../../../lib/audit-trail/audit-trail-api';
import { ApiError } from '../../../lib/auth/api-client';
import {
  Card,
  ErrorState,
  PageHeader,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { EntitySearch } from '../../../components/ui/EntitySearch';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

/**
 * Every action, ordered as the label map declares them rather than alphabetically.
 *
 * That order is roughly "what happened to a record" before "what happened to a session", which is how
 * somebody scanning the list thinks about it; sorting it would interleave `LOGIN_FAILED` with `EXPORT`.
 */
const AUDIT_ACTION_OPTIONS = Object.keys(
  ENUM_LABEL.AuditAction,
) as AuditAction[];

interface BrowseFilters {
  userId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  from?: string;
  to?: string;
}

/**
 * A `<input type="date">` gives `YYYY-MM-DD`; the API wants an instant.
 *
 * The END of the day matters and is easy to get wrong. A compliance officer asking for "March" types
 * 1 March to 31 March and means the whole of the 31st — but `2026-03-31` as an instant is midnight at the
 * START of it, which silently drops the last day of every range anybody enters. That is a wrong answer
 * that looks like a complete one, so `to` is stretched to the final millisecond and `from` is not.
 */
function startOfDayIso(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toISOString();
}

function endOfDayIso(day: string): string {
  return new Date(`${day}T23:59:59.999Z`).toISOString();
}

const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const formStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
  margin: '0.75rem 0',
};

function messageFor(
  err: unknown,
  noPermission: string,
  fallback: string,
): string {
  return err instanceof ApiError && err.status === 403
    ? noPermission
    : err instanceof ApiError
      ? err.message
      : fallback;
}

function AuditLogTable({ rows }: { rows: AuditLogEntry[] }) {
  const { t } = useLanguage();
  return (
    <Card padded={false}>
            <Table>
        <thead>
          <tr>
            <Th>{t('atColOccurred')}</Th>
            <Th>{t('atColAction')}</Th>
            <Th>{t('atColEntity')}</Th>
            <Th>{t('atColUser')}</Th>
            <Th>{t('atColSensitive')}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <Tr>
              <Td colSpan={5}>
                {t('atNone')}
              </Td>
            </Tr>
          ) : (
            rows.map((r) => (
              <Tr key={r.id}>
                <Td>
                  {r.occurredAt.replace('T', ' ').slice(0, 19)}
                </Td>
                <Td>{t(ENUM_LABEL.AuditAction[r.action])}</Td>
                {/*
                  * OWNER DECISION 49 — THE TYPE IN ARABIC PLUS THE NUMBER, NEVER A NAME.
                  *
                  * `AuditLogEntry.entityType` is a bare `String` with no enum: an OPEN set that
                  * grows with the system. MEASURED — dev holds 32 distinct values and db-test 139,
                  * because this log records every model the product touches, not just the
                  * eighteen that have a workflow. So a NAME here would silently stop appearing
                  * each time a module is added, and the owner's ruling is that an honest number
                  * beats a name that quietly goes missing: the unknown is DECLARED.
                  *
                  * WHERE THE TYPE IS ONE OF THE EIGHTEEN, ITS OWN WORD IS USED — decision 41's
                  * labels — so the reader sees the same word here as in the filter dropdown above
                  * and at the top of the screen they came from. Measured coverage: 11 of dev's 32
                  * distinct types, which is 89.6% of its ROWS; on db-test it is 17 of 139 and only
                  * 14.1% of rows. Both figures are reported to the owner, because which of them
                  * describes a real office changes how often the fallback is seen.
                  *
                  * THE FALLBACK IS VISIBLY A FALLBACK and is not dressed up as a name: the stored
                  * type is rendered as machine text, in a monospace face and under its own label,
                  * so a reader can tell "this is the identifier our system stores" from "this is
                  * what the thing is called".
                  *
                  * THE ID STAYS IN FULL rather than being sliced: it is the only way a reader can
                  * look the record up, and the budget keeps counting it — which the ruling
                  * accepts. What changed is that the reader now knows WHAT KIND of record it is.
                  */}
                <Td>
                  {isWorkflowEntityType(r.entityType) ? (
                    t('atEntityRef', {
                      type: t(WORKFLOW_ENTITY_LABEL[r.entityType]),
                      ref: r.entityId,
                    })
                  ) : (
                    <span
                      title={t('atEntityTypeUnlabelled')}
                      style={{
                        fontFamily: 'var(--font-mono, monospace)',
                        color: 'var(--ink-secondary)',
                      }}
                    >
                      {r.entityType} · {r.entityId}
                    </span>
                  )}
                </Td>
                <Td data-audit-actor={r.userId}>
                  {/*
                    The name, falling back to the id.

                    This column is headed "User" and rendered a raw uuid — unreadable by the person the
                    audit trail exists for, who is being asked to review who did what. The name is
                    resolved per page by the API.

                    ~~The fallback is defence, not a state reachable today~~ — THE FALLBACK IS GONE, and
                    the FK argument in it was only half the story. `userId` is NOT NULL with ON DELETE
                    RESTRICT, so an actor cannot be deleted out from under their rows — true, and it was
                    never the way `actorName` could be null. TWO of the three api paths that build this
                    view (`documentHistory`, `workflowHistory`) passed NO name map at all, so every row
                    they produced had a null name. This comment could say "unreachable" truthfully only
                    because the BROWSE path — the one this table uses — happened to resolve them.

                    All three paths now resolve through one `actorNames()` helper, so the null is
                    structurally impossible rather than accidentally absent, and a `?? id` branch here
                    would be dead code that displays a uuid. See
                    `scripts/measurements/rendered-identifiers.py` on that class.
                  */}
                  <bdi>{r.actorName}</bdi>
                </Td>
                <Td>{r.isSensitiveDataAccess ? t('commonYes') : ''}</Td>
              </Tr>
            ))
          )}
        </tbody>
      </Table>
    </Card>
  );
}

/**
 * OWNER DECISION 41 — the two fields on this screen that a person could not fill.
 *
 * `wfEntityId` and `documentId` were both `required`, so the workflow-history and document-history
 * sections could not be used at all without pasting a uuid from somewhere else. They are no longer
 * required, and the normal way they get filled is NAVIGATION: every screen whose rows are one of the
 * eighteen workflow entities links here with `?entityType=&entityId=`, so the field arrives filled by
 * WHERE THE READER CAME FROM. Typing one by hand still works and is now optional.
 *
 * ## Why lazy `useState` and not an effect
 *
 * The URL is read ONCE, as each field's initial value, so the reader can then edit it. An effect that
 * copied the params into state would be setState-inside-an-effect — which `npm run lint` refuses here
 * and which `EntitySearch` already records paying for twice — and would also fight the reader by
 * resetting what they typed.
 *
 * `useSearchParams` forces this component to sit inside a `Suspense` boundary, which is why the default
 * export below is a wrapper. The same shape `/opportunities` and `/rfqs/new` already use.
 */
function AuditTrailScreen() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const searchParams = useSearchParams();

  const [browseUserId, setBrowseUserId] = useState('');
  const [browseEntityType, setBrowseEntityType] = useState('');
  const [browseEntityId, setBrowseEntityId] = useState('');
  // IMPROVEMENTS § 1.52 — the API has accepted these three all along and no control offered them, so
  // "every DELETE last March" meant asking a developer to build a URL.
  const [browseAction, setBrowseAction] = useState('');
  const [browseFrom, setBrowseFrom] = useState('');
  const [browseToDate, setBrowseToDate] = useState('');
  const [browseRows, setBrowseRows] = useState<AuditLogEntry[] | null>(null);
  // The filters that produced the rows currently on screen — NOT the live
  // input values. Paging has to re-send the query that produced the set being
  // paged, or typing a new filter and then clicking Next would ask for page 2
  // of a search that was never run.
  const [browseApplied, setBrowseApplied] = useState<BrowseFilters>({});
  const [browsePage, setBrowsePage] = useState(0);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browsePageSize, setBrowsePageSize] = useState(0);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [browseBusy, setBrowseBusy] = useState(false);

  const [wfEntityType, setWfEntityType] = useState(
    () => searchParams.get('entityType') ?? '',
  );
  const [wfEntityId, setWfEntityId] = useState(
    () => searchParams.get('entityId') ?? '',
  );
  const [wfRows, setWfRows] = useState<AuditLogEntry[] | null>(null);
  const [wfError, setWfError] = useState<string | null>(null);
  const [wfBusy, setWfBusy] = useState(false);

  const [documentId, setDocumentId] = useState(
    () => searchParams.get('documentId') ?? '',
  );
  const [docHistory, setDocHistory] = useState<DocumentHistory | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [docBusy, setDocBusy] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  async function runBrowse(ev: React.FormEvent) {
    ev.preventDefault();
    const filters: BrowseFilters = {
      userId: browseUserId || undefined,
      entityType: browseEntityType || undefined,
      entityId: browseEntityId || undefined,
      action: browseAction || undefined,
      from: browseFrom ? startOfDayIso(browseFrom) : undefined,
      // `to` DOES DOUBLE DUTY, and the two uses are compatible rather than in conflict.
      //
      // Its original job is the pagination pin: this is the one list whose own reads APPEND to the table
      // they read — each browse records a PDPL access row, which sorts to the top and shifts every later
      // page down by one. Without a pin, clicking Next shows a row the previous page already showed and
      // hides one entirely.
      //
      // A user-supplied upper bound serves that purpose at least as well, because a date in the past
      // cannot admit new rows at all. So an explicit `to` REPLACES the pin, and the pin remains the
      // default when the field is blank. An audit browse reading "as at the moment you searched" is also
      // the more honest thing for it to mean.
      to: browseToDate ? endOfDayIso(browseToDate) : new Date().toISOString(),
    };
    setBrowseApplied(filters);
    await browseTo(0, filters);
  }

  // The audit log is the fastest-growing table here, so it is read a page at a
  // time. A new search restarts at page 0 through the submit above; paging
  // re-sends the filters that produced the set, never the live inputs.
  async function browseTo(
    nextPage: number,
    filters: BrowseFilters = browseApplied,
  ) {
    setBrowseBusy(true);
    setBrowseError(null);
    try {
      const result = await browseAuditTrail({
        ...filters,
        ...(nextPage ? { page: nextPage } : {}),
      });
      setBrowseRows(result.items);
      setBrowseTotal(result.total);
      setBrowsePageSize(result.pageSize);
      setBrowsePage(result.page);
    } catch (err) {
      setBrowseRows(null);
      setBrowseError(
        messageFor(
          err,
          permissionRefusal(t, 'atAuditLogRefusalAct', 'audit-log.read'),
          t('atLogLoadError'),
        ),
      );
    } finally {
      setBrowseBusy(false);
    }
  }

  async function runWorkflowHistory(ev: React.FormEvent) {
    ev.preventDefault();
    setWfBusy(true);
    setWfError(null);
    try {
      setWfRows(await getWorkflowHistory(wfEntityType, wfEntityId));
    } catch (err) {
      setWfRows(null);
      setWfError(
        messageFor(
          err,
          permissionRefusal(t, 'atWorkflowRefusalAct', 'workflow-history.read'),
          t('atWorkflowLoadError'),
        ),
      );
    } finally {
      setWfBusy(false);
    }
  }

  async function runDocumentHistory(ev: React.FormEvent) {
    ev.preventDefault();
    setDocBusy(true);
    setDocError(null);
    try {
      setDocHistory(await getDocumentHistory(documentId));
    } catch (err) {
      setDocHistory(null);
      setDocError(
        messageFor(
          err,
          permissionRefusal(t, 'atDocumentRefusalAct', 'document-history.read'),
          t('atDocumentLoadError'),
        ),
      );
    } finally {
      setDocBusy(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('atHeading')}
        description={t('atIntro')}
      />

      <section style={sectionStyle}>
        <h2>{t('atAuditLogHeading')}</h2>
        <form onSubmit={runBrowse} style={formStyle}>
          {/*
            "What did this person do" is the question an audit trail is read for, and there was no
            control for it — while the API has accepted a `userId` filter all along. Nobody knows a
            uuid, so the filter existed and was unusable, which is the same defect as a form asking for
            an id whose source screen was never built.
          */}
          <EntitySearch
            kind="auditActor"
            value={browseUserId}
            onChange={setBrowseUserId}
            label={t('atActorLabel')}
          />
          <label>
            {t('atEntityTypeLabel')}{' '}
            <input
              aria-label={t('atEntityTypeLabel')}
              value={browseEntityType}
              onChange={(e) => setBrowseEntityType(e.target.value)}
            />
          </label>
          <label>
            {t('atEntityIdLabel')}{' '}
            <input
              aria-label={t('atEntityIdLabel')}
              value={browseEntityId}
              onChange={(e) => setBrowseEntityId(e.target.value)}
            />
          </label>
          {/*
            IMPROVEMENTS § 1.52 — the three filters the API accepted with nothing to drive them. A SELECT
            rather than a text box, because `action` is validated against a closed vocabulary server-side:
            typing it would make a 400 the normal way to discover the spelling. The options are built from
            `ENUM_LABEL.AuditAction`, which is a total map over the union, so a new action appears here
            without an edit — and `audit-action-parity.spec.ts` keeps that union equal to the database's.
          */}
          <label>
            {t('atActionLabel')}{' '}
            <select
              aria-label={t('atActionLabel')}
              value={browseAction}
              onChange={(e) => setBrowseAction(e.target.value)}
            >
              <option value="">{t('atActionAny')}</option>
              {AUDIT_ACTION_OPTIONS.map((action) => (
                <option key={action} value={action}>
                  {t(ENUM_LABEL.AuditAction[action])}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('atFromLabel')}{' '}
            <input
              type="date"
              aria-label={t('atFromLabel')}
              value={browseFrom}
              onChange={(e) => setBrowseFrom(e.target.value)}
            />
          </label>
          <label>
            {t('atToLabel')}{' '}
            <input
              type="date"
              aria-label={t('atToLabel')}
              value={browseToDate}
              onChange={(e) => setBrowseToDate(e.target.value)}
            />
          </label>
          <button type="submit" disabled={browseBusy}>
            {browseBusy ? t('atLoading') : t('atBrowseButton')}
          </button>
        </form>
        {browseError ? (
          <ErrorState title={browseError} />
        ) : null}
        {browseRows ? (
          <>
            <AuditLogTable rows={browseRows} />
            <Pagination
              page={browsePage}
              pageSize={browsePageSize}
              total={browseTotal}
              busy={browseBusy}
              onPageChange={(next) => void browseTo(next)}
            />
          </>
        ) : null}
      </section>

      <section style={sectionStyle}>
        <h2>{t('atWorkflowHistoryHeading')}</h2>
        <form onSubmit={runWorkflowHistory} style={formStyle}>
          {/*
            A SELECT over the eighteen, where this was a free-text box validated server-side against
            `@Length(1, 100)` and against nothing else. The vocabulary IS closed, so a person had to
            guess the exact string the writers store — `CrossSellOpportunity`, not "cross-sell" — and a
            wrong guess returned an empty history that reads exactly like "nothing ever happened to this
            record". The options come from the label map, which is total over the union, so a nineteenth
            member cannot be added without deciding its word.
          */}
          <label>
            {t('atWorkflowEntityTypeLabel')}{' '}
            <select
              aria-label={t('atWorkflowEntityTypeLabel')}
              value={wfEntityType}
              onChange={(e) => setWfEntityType(e.target.value)}
            >
              <option value="">{t('atWorkflowEntityTypeChoose')}</option>
              {WORKFLOW_ENTITY_TYPES.map((type) => {
                const label = WORKFLOW_ENTITY_LABEL[type];
                return (
                  <option key={type} value={type}>
                    {/*
                      `null` means nobody has written a word for this type, and it renders the MEMBER
                      NAME rather than a guess. NONE of the eighteen is null as of 2026-10-23 — three
                      were for a day, and all three turned out to have plurals already rendering
                      elsewhere in the product, so the branch below is now unreachable. It stays
                      because a nineteenth member can arrive unworded, and because an English member
                      name in an Arabic list is obviously unfinished where a plausible invented word is
                      indistinguishable from a decided one and would never be corrected.
                      `audit-trail.spec.ts` asserts that no option renders its own member name, which
                      is this branch's visible signature.
                    */}
                    {label === null ? type : t(label)}
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            {t('atWorkflowEntityIdLabel')}{' '}
            <input
              aria-label={t('atWorkflowEntityIdLabel')}
              value={wfEntityId}
              onChange={(e) => setWfEntityId(e.target.value)}
            />
          </label>
          {/*
            THE ONE CHOOSER, ON CUSTOMER — owner decision 41, and it is one rather than eighteen for a
            measured reason. Thirteen of the eighteen types carry NO human-readable field at all (no
            name, no number, no title), so a chooser over them would search nothing; and of the five
            that do, `policy.read`, `claim.read` and `lead.list.read` reach neither of the two roles
            that stand on this screen, while there is no read code for `IncidentReport` at all. Customer
            is the one entity whose search route BOTH readers of this screen can already reach:
            `GET /customers/search` is gated on ANY OF `customer.read`/`dsr.log`, and `customer.read`
            is held by COMPLIANCE_OFFICER and EXTERNAL_AUDITOR alike. So no new route and no new code.

            It FILLS the id field rather than replacing it. That is what keeps the arriving-from-a-link
            case working: a prefilled uuid is already correct and has no name to display, and
            `EntitySearch` can only show a name it fetched itself.
          */}
          {wfEntityType === 'Customer' ? (
            <EntitySearch
              kind="customer"
              value={wfEntityId}
              onChange={setWfEntityId}
              label={t('customerPickerSearchLabel')}
            />
          ) : null}
          {/*
            Disabled rather than `required` on the inputs. The server needs BOTH halves — the DTO's own
            comment says so — and a screen must not send a request it knows will 400, which is the same
            rule `CombinedDutyReasonField` follows for its ten-character floor.
          */}
          <button
            type="submit"
            disabled={wfBusy || !wfEntityType || !wfEntityId.trim()}
          >
            {wfBusy ? t('atLoading') : t('atLookUpButton')}
          </button>
        </form>
        {wfError ? (
          <ErrorState title={wfError} />
        ) : null}
        {wfRows ? <AuditLogTable rows={wfRows} /> : null}
      </section>

      <section style={sectionStyle}>
        <h2>{t('atDocumentHistoryHeading')}</h2>
        <form onSubmit={runDocumentHistory} style={formStyle}>
          <label>
            {t('atDocumentIdLabel')}{' '}
            <input
              aria-label={t('atDocumentIdLabel')}
              value={documentId}
              onChange={(e) => setDocumentId(e.target.value)}
            />
          </label>
          {/*
            THE DOCUMENT CHOOSER, AND ITS ABSENCE IS PART OF THE DECISION.
            `GET /documents/search` is gated on `document.read` ALONE — owner decision 41, argued in the
            api's `common/picker-search.config.ts`. Measured off the seeded grid, that code reaches
            COMPLIANCE_OFFICER and NOT the EXTERNAL_AUDITOR, so that role sees no chooser here and keeps
            the typed field. NOT an inbound link — `/documents` is gated on `document.read`, so that
            role cannot open the register one would come from; what it has instead is the audit-log
            table above, whose Entity column renders the document ids. That is correct rather than a gap:
            widening the route would hand a read-only auditor a name search over every document in the
            office — every KYC pack, every incident report — when what the role is entitled to is the
            history of a document it already has the id of.
            Rendering the control for a reader who would be refused it is the thing the frontend
            directive forbids, so the condition is on the permission and not on the response.
          */}
          {hasPermission(user, 'document.read') ? (
            <EntitySearch
              kind="document"
              value={documentId}
              onChange={setDocumentId}
              label={t('entitySearchDocumentLabel')}
            />
          ) : null}
          <button type="submit" disabled={docBusy || !documentId.trim()}>
            {docBusy ? t('atLoading') : t('atLookUpButton')}
          </button>
        </form>
        {docError ? (
          <ErrorState title={docError} />
        ) : null}
        {docHistory ? (
          <>
            <h3>{t('atColVersions')}</h3>
            <Card padded={false}>
              <Table data-testid="document-versions">
                <thead>
                  <tr>
                    <Th>{t('atColVersion')}</Th>
                    <Th>{t('atColFile')}</Th>
                    <Th>{t('atColCategory')}</Th>
                    <Th>{t('atColClassification')}</Th>
                    <Th>{t('atColUploadedBy')}</Th>
                    <Th>{t('atColCreated')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {docHistory.versions.map((v) => (
                    <Tr key={v.id}>
                      <Td>
                        v{v.versionNumber}
                        {v.isRequestedVersion ? ` ${t('statusRequestedVersion')}` : ''}
                      </Td>
                      <Td>{v.fileName}</Td>
                      <Td>
                        {t(ENUM_LABEL.DocumentCategory[v.category])}
                      </Td>
                      <Td>
                        {t(ENUM_LABEL.DataClassification[v.classification])}
                      </Td>
                      {/*
                        * RULE 2 — WHO filed this version, by name. It rendered the raw uuid, which
                        * on a document history identifies nobody: the column exists to say which
                        * colleague uploaded it. The em dash is real — that column carries no
                        * foreign key, so the account can be gone.
                        */}
                      <Td>
                        {v.uploadedByName ? <bdi>{v.uploadedByName}</bdi> : '—'}
                      </Td>
                      <Td>{v.createdAt.slice(0, 10)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
            <h3>{t('atHeading')}</h3>
            <AuditLogTable rows={docHistory.auditTrail} />
          </>
        ) : null}
      </section>
    </main>
  );
}

/**
 * `useSearchParams` requires a `Suspense` boundary above it, so the screen is a child.
 *
 * `fallback={null}` matches `/opportunities` and `/rfqs/new`: there is nothing useful to render for the
 * one frame before the params resolve, and a spinner there would flash on every visit.
 */
export default function AuditTrailPage() {
  return (
    <Suspense fallback={null}>
      <AuditTrailScreen />
    </Suspense>
  );
}
