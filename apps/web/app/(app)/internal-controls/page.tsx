'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  getCombinedDutyActs,
  getSelfApprovalAudit,
  type CombinedDutyReport,
  type InternalControlsAuditReport,
} from '../../../lib/internal-controls/internal-controls-api';
import { ApiError } from '../../../lib/auth/api-client';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Note,
  PageHeader,
  ReportProvenance,
  SkeletonList,
  Table,
  Td,
  Th,
  Tile,
  Tiles,
  Tr,
} from '../../../components/ui';
import { useLanguage } from '../../../lib/i18n/language-context';
import { formatDateTime, formatNumber } from '../../../lib/i18n/format';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';
import { makerCheckerEntityLabel } from '../../../lib/audit-trail/record-entity-types';

/*
 * WHAT WAS HERE, AND WHY IT IS GONE.
 *
 * `cell` / `head` / `leftCell` / `leftHead` were a table built by hand, THREE times over on one
 * screen — the declared-acts register, the violations list and the by-pair breakdown — each with
 * its own `min-width`, so a governance report an auditor reads scrolled sideways in three
 * independent ways. `Table`/`Th`/`Td` is the one that already existed.
 *
 * `Stat` was a local re-implementation of `Tile`, and it carried three things this product forbids
 * in writing: `opacity: 0.7` to mute its label (globals.css: the rendered colour is one no token
 * declared, and axe measures the blend), a hard-coded `border-radius: 8`, and a `margin`-based
 * section rhythm where the page frame now supplies one gap.
 *
 * `sectionStyle` with its `1.75rem` margins is replaced by `pageStackStyle`'s single gap, which is
 * what makes this screen's four blocks land on the same lines as every other screen's.
 *
 * Every value below is on the five-step spacing scale, and not one of them carries a colour
 * literal — the `#b91c1c` that used to colour the violations heading is gone with it.
 */
const declaredHeaderStyle: CSSProperties = {
  padding: 'var(--space-4)',
  display: 'grid',
  gap: 'var(--space-3)',
};

const loadingWrapStyle: CSSProperties = {
  padding: 'var(--space-4)',
};

/** An empty state inside a card already has the card's own outline, so it drops its dashed one. */
const emptyStateStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
};

const footNoteWrapStyle: CSSProperties = {
  padding: 'var(--space-4)',
};

const accessFlagStyle: CSSProperties = {
  marginInlineEnd: 'var(--space-2)',
};

/** Machine text — a constraint name, a pair key — in the mono face, so nobody reads it as prose. */
const monoStyle: CSSProperties = {
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: 'var(--text-sm)',
};

const unlabelledStyle: CSSProperties = {
  fontFamily: 'var(--font-mono, monospace)',
  color: 'var(--ink-secondary)',
};

const mutedNoteStyle: CSSProperties = {
  color: 'var(--ink-secondary)',
};

export default function InternalControlsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { language, t } = useLanguage();

  const [report, setReport] = useState<InternalControlsAuditReport | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Part 4 step 6 — the DECLARED acts, beside the scan for silent ones. Its own state and its own error,
  // because one failing must not blank the other: they answer different questions and a reviewer needs
  // whichever half still works.
  const [declared, setDeclared] = useState<CombinedDutyReport | null>(null);
  const [declaredError, setDeclaredError] = useState<string | null>(null);

  // Deliberately does not touch `busy` — a `useEffect` below calls this
  // directly on mount, and setting state synchronously at the top of an
  // effect-invoked function trips react-hooks/set-state-in-effect. The
  // "Run audit now" button manages `busy` itself around this call instead.
  const loadDeclared = useCallback(async () => {
    try {
      setDeclared(await getCombinedDutyActs());
      setDeclaredError(null);
    } catch (err) {
      setDeclared(null);
      setDeclaredError(
        err instanceof ApiError ? err.message : t('icDeclaredLoadError'),
      );
    }
  }, [t]);

  const load = useCallback(async () => {
    try {
      setReport(await getSelfApprovalAudit());
      setLoadError(null);
    } catch (err) {
      setReport(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'icRefusalAct', 'internal-controls.view')
          : err instanceof ApiError
            ? err.message
            : t('icRunError'),
      );
    }
  }, [t]);

  async function runAudit() {
    setBusy(true);
    try {
      await load();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await loadDeclared();
    })();
  }, [user, loadDeclared]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  if (isLoading || !user) return null;

  const violationCount = report?.violations.length ?? 0;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('icHeading')}
        description={t('icIntro')}
        actions={
          <Button type="button" variant="primary" loading={busy} onClick={() => void runAudit()}>
            {busy ? t('icRunningButton') : t('icRunButton')}
          </Button>
        }
      />

      {loadError ? <ErrorState title={loadError} /> : null}

      {/*
        THE SELF-APPROVAL REPORT — the shipping gate for COMBINED mode, and the reason a control could be
        weakened at all. Rendered FIRST, above the silent-self-approval scan: the scan should always find
        nothing (the CHECK constraints refuse silent ones), whereas anything here is a real act somebody
        performed, and the more important half should not be below a table of zeroes.
      */}
      <Card
        title={t('icDeclaredHeading')}
        description={t('icDeclaredIntro')}
        padded={false}
        style={{ overflow: 'visible' }}
      >
        <div style={declaredHeaderStyle} data-testid="declared-acts">
          {declaredError ? <ErrorState title={declaredError} /> : null}
          {/*
            THE HOOK IS ON THE SPAN, NOT ON `Note` — and the first version had it on BOTH, which is
            worth a line because nothing would have told me.

            `Note` declares its own props and does not take `data-testid`, so the one on the
            component was SILENTLY DROPPED: TypeScript exempts hyphen-containing JSX attributes
            from excess-property checking, so `data-anything` on any custom component type-checks
            and goes nowhere. The spec passed either way, which is exactly the problem — it passed
            because the span's hook was the only one in the DOM, so a reader of this file would
            have seen two and believed the wrong one was load-bearing.
          */}
          {declared ? (
            <Note tone="neutral" icon="users">
              <span data-testid="declared-office-mode">
                {declared.office.mode === 'COMBINED'
                  ? t('icDeclaredOfficeCombined')
                  : t('icDeclaredOfficeSegregated')}{' '}
                {declared.office.declaredAt
                  ? t('icDeclaredOfficeDeclaredBy', {
                      // `?? declaredByUserId` stood here and rendered A UUID when the
                      // name could not be resolved — the `?? id` fallback decision 48
                      // forbids by name, on the self-approval report. The api already
                      // sends the resolved name; a missing one reports NO NAME.
                      who: declared.office.declaredByName ?? t('commonNameNotResolved'),
                    })
                  : t('icDeclaredOfficeNeverDeclared')}
              </span>
            </Note>
          ) : null}
        </div>

        {declaredError ? null : declared === null ? (
          <div style={loadingWrapStyle}>
            <SkeletonList rows={2} label={t('icLoading')} />
          </div>
        ) : declared.rows.length === 0 ? (
          // "Nobody has done this" is a different claim from "the report could not be read", and the two
          // must not share a blank space.
          <div style={loadingWrapStyle}>
            <EmptyState
              title={t('icDeclaredEmpty')}
              style={emptyStateStyle}
              data-testid="declared-empty"
            />
          </div>
        ) : (
          <>
            <Table>
              <thead>
                <Tr>
                  <Th>{t('icDeclaredColWhen')}</Th>
                  <Th>{t('icDeclaredColWho')}</Th>
                  <Th>{t('icDeclaredColPair')}</Th>
                  <Th>{t('icDeclaredColRoles')}</Th>
                  <Th>{t('icDeclaredColReason')}</Th>
                </Tr>
              </thead>
              <tbody>
                {declared.rows.map((row) => (
                  <Tr
                    key={row.id}
                    data-testid={row.accessSelfReview ? 'declared-row-access' : 'declared-row'}
                  >
                    <Td>
                      {/* FLAGGED, not merely first: a position is something a reader re-sorts away.
                          A warning pill rather than a `<strong>`, because weight alone is the one
                          cue a reader scanning a column does not pick up — and this is the row the
                          whole report exists to put at the top. */}
                      {row.accessSelfReview ? (
                        <Badge tone="warning" style={accessFlagStyle}>
                          <span data-testid="access-flag">{t('icDeclaredAccessFlag')}</span>
                        </Badge>
                      ) : null}
                      {formatDateTime(row.at, language)}
                    </Td>
                    <Td>
                      {/*
                        No `?? id` fallback. `CombinedDutyAct.actor` is a REQUIRED relation, so
                        Prisma's default `onDelete: Restrict` applies and the actor cannot be deleted
                        out from under an act — and the single path that builds this row resolves every
                        distinct actor on the page. So the null branch is structurally impossible, and
                        a fallback for it would be dead code that displays a uuid: it never renders, so
                        nobody reads it, so nobody notices what it shows. Third instance of that class
                        — see `scripts/measurements/rendered-identifiers.py`.
                      */}
                      {row.actorName}
                    </Td>
                    <Td>
                      {row.entity} · <code style={monoStyle}>{row.pair}</code>
                    </Td>
                    <Td>
                      {row.roles.join(', ') || '—'}
                      {row.hatAmbiguous ? ` — ${t('icDeclaredHatAmbiguous')}` : ''}
                    </Td>
                    <Td>{row.reason}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {declared.truncated ? (
              <div style={footNoteWrapStyle}>
                <Note tone="warning" icon="alert">
                  {t('icDeclaredTruncated')}
                </Note>
              </div>
            ) : null}
          </>
        )}
      </Card>

      {loadError ? null : report === null ? (
        <SkeletonList rows={3} label={t('icLoading')} />
      ) : (
        <>
          {/*
            THE SCAN'S OWN FIGURES. `Tile` replaces a local `Stat` that re-implemented it with an
            `opacity: 0.7` label and a hard-coded `border-radius: 8` — and whose violations figure
            read the literal English word **'None'** when the count was zero.
            `hardcoded-ui-english.py` reports 0 undeclared and cannot see it: a ternary of bare
            literals inside a PROP VALUE is excluded from failure mode 8 by design, because the
            identical shape is a `data-*` test hook on other screens. A count of zero is `٠`, which
            is both the honest answer and more informative than the word was.
          */}
          <Tiles>
            <Tile
              icon="layout"
              value={formatNumber(report.pairsScanned, language)}
              label={t('icPairsScanned')}
            />
            <Tile
              icon="checklist"
              value={formatNumber(report.totalRowsChecked, language)}
              label={t('icColRowsChecked')}
            />
            <Tile
              icon={violationCount === 0 ? 'check' : 'alert'}
              tone={violationCount === 0 ? 'plain' : 'alarm'}
              value={formatNumber(violationCount, language)}
              label={t('icColViolations')}
            />
          </Tiles>

          {/*
            THE GENERATED-AT LINE, through `ReportProvenance`.

            It read `Generated {report.generatedAt.replace('T', ' ').slice(0, 16)}.` — an English
            word no dictionary carried, in front of a hand-sliced ISO string, on a governance report
            an auditor reads. Two defects on one line, and the hardcoded-English gate sees neither:
            `PROSE` needs two capitalised words and `BARE_TEXT_LINE`'s character class excludes the
            brace. `ReportProvenance` is the component this product already decided on for exactly
            this line — bilingual, formatted through `formatDateTime`, and `<bdi>`-isolated so the
            full stop does not jump to the wrong end of an Arabic sentence.
          */}
          <ReportProvenance kind="generatedAt" at={report.generatedAt} />

          {violationCount === 0 ? (
            <Note tone="info" icon="check" role="status">
              {t('icClean')}
            </Note>
          ) : (
            <Card title={t('icViolationsHeading')} padded={false}>
              {/*
                THE HEADING'S COLOUR WAS THE LITERAL `#b91c1c`, which is the defect this batch names
                outright: a literal colour is invisible to the dark theme and to the next brand
                change, and on a dark card that red is close to unreadable. The heading takes the
                brand navy like every other heading in the product, and what carries the ALARM is
                the tile above — which is a measured state rather than a colour somebody typed.
              */}
              <Table>
                <thead>
                  <Tr>
                    {/* Decision 53 — the type and the record number are ONE cell now, so
                        the two headings collapse into the one naming the record. */}
                    <Th>{t('icColRecord')}</Th>
                    <Th>{t('icColPair')}</Th>
                    <Th>{t('icColUser')}</Th>
                  </Tr>
                </thead>
                <tbody>
                  {report.violations.map((v) => (
                    <Tr key={`${v.entityType}-${v.entityId}-${v.makerField}`}>
                      {/*
                        * OWNER DECISION 53 — THE RECORD'S TYPE IN ARABIC PLUS ITS NUMBER.
                        *
                        * Decision 49's test is a NAME where the set is CLOSED, and this set is:
                        * fifteen maker/checker entity types, closed by `check:maker-checker-pairs`
                        * rather than by convention. Batch eight stopped here because only six of
                        * the fifteen had a decision-41 word — true of that map, and the wrong
                        * conclusion, because every one of the nine had a source elsewhere in the
                        * product. All fifteen are DERIVED now, none typed.
                        *
                        * THE NUMBER STAYS, which is the half worth reading. A maker/checker
                        * record has no human-readable handle — decision 44 measured that NOTHING
                        * in this product generates one — so the type is named and the id is the
                        * honest answer to WHICH record. That is the same shape `/audit-trail`
                        * uses, and it is why this row still counts against the
                        * rendered-identifier budget rather than coming off it.
                        *
                        * The fallback cannot be reached while the map is total, and
                        * `record-entity-types.test.ts` is what keeps it total — but it is still
                        * rendered rather than omitted, because a sixteenth pair would otherwise
                        * render an empty cell between a green test and a deploy.
                        */}
                      <Td>
                        {makerCheckerEntityLabel(v.entityType) ? (
                          t('atEntityRef', {
                            type: t(makerCheckerEntityLabel(v.entityType)!),
                            ref: v.entityId,
                          })
                        ) : (
                          <span title={t('atEntityTypeUnlabelled')} style={unlabelledStyle}>
                            {v.entityType} · {v.entityId}
                          </span>
                        )}
                      </Td>
                      <Td>{v.pairLabel}</Td>
                      {/* ITEM 1 — the colleague who did both halves, by NAME, resolved by the
                          api through decision 48's resolver. An em dash where the account is
                          gone: that is a real state here (this scan's actor has no protecting
                          foreign key the way the audit trail's does), and "we hold no name" is
                          not "the name is this uuid". */}
                      <Td>{v.userName ? <bdi>{v.userName}</bdi> : t('commonNameNotResolved')}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}

          <Card title={t('icByPair')} padded={false}>
            {/* A hook so a test can scope an assertion to THIS table. The dormant and
                truncation markers live here, and a page-wide `getByText` for either could match
                an unrelated element — which is what `check:absence` exists to refuse. */}
            <Table style={{ minWidth: 0 }}>
              <thead>
                <Tr>
                  <Th>{t('icColEntity')}</Th>
                  <Th>{t('icColPair')}</Th>
                  <Th numeric>{t('icColRowsChecked')}</Th>
                  <Th numeric>{t('icColViolations')}</Th>
                  <Th>{t('icColDbCheck')}</Th>
                </Tr>
              </thead>
              <tbody data-testid="ic-by-pair">
                {report.byPair.map((p) => (
                  <Tr key={`${p.entityType}-${p.pairLabel}`}>
                    <Td>
                      {/* Decision 53 — the TYPE'S WORD, no number: this row is about a PAIR, not
                          one record. Found the same way the SLA dashboard's two were: by this
                          screen's own assertion that the member name is gone. The violations
                          table had been switched and this one had not. */}
                      {makerCheckerEntityLabel(p.entityType)
                        ? t(makerCheckerEntityLabel(p.entityType)!)
                        : p.entityType}
                      {p.dormant ? (
                        <span title={t('icNoWriter')} style={mutedNoteStyle}>
                          {' '}
                          {t('icDormantNote')}
                        </span>
                      ) : null}
                    </Td>
                    <Td>{p.pairLabel}</Td>
                    <Td numeric>
                      {formatNumber(p.rowsChecked, language)}
                      {/* OWNER DECISION 54 — a real sentence in both languages, because this
                          is the one marker on this screen that can make an INCOMPLETE scan
                          read as a clean one. Not a bare word in either language now. */}
                      {p.truncated ? ` ${t('icTruncatedNote')}` : ''}
                    </Td>
                    <Td numeric>{formatNumber(p.violationCount, language)}</Td>
                    <Td>
                      {p.dbCheckConstraint ? (
                        <code style={monoStyle}>{p.dbCheckConstraint}</code>
                      ) : (
                        '—'
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </main>
  );
}
