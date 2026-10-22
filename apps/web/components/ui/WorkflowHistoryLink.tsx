'use client';

import Link from 'next/link';
import { useAuth } from '../../lib/auth/auth-context';
import { hasPermission } from '../../lib/auth/permissions';
import { useLanguage } from '../../lib/i18n/language-context';
import type { WorkflowEntityType } from '../../lib/audit-trail/workflow-entity-types';

/**
 * "WHAT HAPPENED TO THIS RECORD" — one link, every screen whose rows carry a workflow state.
 *
 * ## What this closes
 *
 * `/audit-trail`'s workflow-history section asked for the entity TYPE and the entity ID, both
 * `required`, both free text. So the only way to read a record's state-change history was to know the
 * exact string the writers store (`CrossSellOpportunity`, not "cross-sell") and to paste a uuid out of
 * another screen's address bar. Owner decision 41's answer is that the fields are filled by NAVIGATION:
 * the reader is already looking at the record, so the screen showing it carries the link and the query
 * string carries both halves.
 *
 * ## Why the permission check lives HERE and not at the sixteen call sites
 *
 * Because sixteen copies of a condition is sixteen chances to omit one, and the omission fails OPEN —
 * a link rendered for somebody who will be refused. `workflow-history.read` is held by
 * COMPLIANCE_OFFICER and EXTERNAL_AUDITOR (measured off the seeded grid), which is a small set, so on
 * most screens for most readers this renders NOTHING. That is the frontend directive's own rule: a
 * control a role cannot use does not exist on their screen.
 *
 * It is gated on `workflow-history.read` rather than on `audit-log.read` — the code that opens
 * `/audit-trail` at all — deliberately. Those two sets differ: the administrator roles can open the
 * screen and would be refused the workflow lookup, so gating on the nav code would send them to a
 * section that answers 403. The link is gated on the thing it LEADS TO.
 *
 * ## `entityType` is the union, not a string
 *
 * A call site naming a type the engine does not know is a compile error, which is the one half of this
 * that a type can carry. The other half — that the web's copy of the eighteen still equals the api's —
 * is `packages/db/prisma/workflow-entity-type-parity.spec.ts`.
 */
export function WorkflowHistoryLink({
  entityType,
  entityId,
}: {
  entityType: WorkflowEntityType;
  entityId: string;
}) {
  const { user } = useAuth();
  const { t } = useLanguage();

  if (!hasPermission(user, 'workflow-history.read')) return null;

  const href = `/audit-trail?entityType=${encodeURIComponent(
    entityType,
  )}&entityId=${encodeURIComponent(entityId)}`;

  return (
    <Link href={href} data-workflow-history-link={entityType}>
      {t('atWorkflowHistoryHeading')}
    </Link>
  );
}
