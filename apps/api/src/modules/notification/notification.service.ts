import { Injectable } from '@nestjs/common';
import { NotificationRepository } from '../../repositories/notification.repository';
import { OrganizationRepository } from '../../repositories/organization.repository';
import { PermissionsService } from '../rbac/services/permissions.service';
import { noticeFor } from '../rbac/new-permission-mark.config';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  BOOK_WIDE_SOURCES,
  slaTargetsFor,
  type NotificationItem,
} from './notification.config';

/**
 * The notification bell, derived rather than stored.
 *
 * There is no `Notification` table and nothing writes one. Every item is a
 * live count taken at read time from the rows that already record the work:
 * SLA timers past their deadline, unresolved claim follow-ups, open AML
 * alerts, pending screening matches, and the reader's own assigned service
 * requests and un-onboarded customers.
 *
 * That choice has consequences worth stating plainly, because they are what a
 * stored table would buy: there is no history (an item vanishes the moment the
 * work is done, and no record says it was ever shown), no cross-device
 * read/unread state, and no event granularity — this says "3 claims are
 * awaiting an insurer response", never "claim CL-41 moved to APPROVED at
 * 14:02", because status CHANGES are not recorded as notifiable events
 * anywhere in this system. See README § Known gaps.
 *
 * Counts, never rows. Reading a screening match or a claim is an
 * `isSensitiveDataAccess` audit event here; a bell rendered on every page load
 * would write one per navigation per user and put customer names into a
 * payload whose only job is to say how many things need attention. The
 * screening module already separates a count endpoint from its list for
 * exactly this reason.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly repo: NotificationRepository,
    private readonly permissions: PermissionsService,
    private readonly organizations: OrganizationRepository,
  ) {}

  async list(user: AuthenticatedUser): Promise<{
    items: NotificationItem[];
    total: number;
  }> {
    // Role IDS — resolving by name would union every same-named role's grants
    // across offices. See `PermissionRepository.findCodesForRoles`.
    const granted = await this.permissions.getCodesForRoles(user.roleIds);
    const now = new Date();
    const items: NotificationItem[] = [];

    // --- book-wide sources, each gated on the permission that guards its own
    // screen: you are only notified about work you could already open.
    const bookWide = BOOK_WIDE_SOURCES.filter((s) => granted.has(s.permission));
    const counts = await Promise.all(
      bookWide.map((s) => this.countFor(s.kind)),
    );
    bookWide.forEach((source, i) => {
      if (counts[i] > 0) {
        items.push({
          kind: source.kind,
          count: counts[i],
          severity: source.severity,
          href: source.href,
        });
      }
    });

    // --- SLA escalations addressed to a role this reader actually holds.
    // Four of the eight escalation targets name a function with no RBAC role
    // (see notification.config.ts); those reach nobody here by design.
    if (granted.has('sla-dashboard.view')) {
      const targets = slaTargetsFor(user);
      if (targets.length > 0) {
        const overdue = await this.repo.countOverdueSlaTimers(now, targets);
        if (overdue > 0) {
          items.push({
            kind: 'sla_overdue',
            count: overdue,
            severity: 'warning',
            href: '/sla-dashboard',
          });
        }
      }
    }

    /*
     * --- OWNER DECISION 131: a permission arrived and this office has not decided on it.
     *
     * GATED ON `role.update`, which is the permission that gates `PUT /roles/:id/permissions` —
     * the matrix itself. So the recipients are exactly the people who can act on it, which is
     * this file's own rule («you are only notified about work you could already open») and also
     * decision 131's requirement that the recipient set be a PERMISSION and never a role name.
     *
     * ⚠️ `findActiveHoldersOfPermission` is NOT called, and that is the shape rather than an
     * omission. The bell is DERIVED: each reader's own request asks whether THEY hold the code,
     * so the set of people who see this item IS the set of active holders, computed one reader
     * at a time. A fan-out would have to enumerate holders across every office from a context
     * with no caller — leaving the tenancy model to deliver a notification. See
     * `docs/module-1-new-permission-mark.md`.
     */
    if (granted.has('role.update')) {
      const office = await this.organizations.findById(user.organizationId);
      if (office) {
        const marked = await this.permissions.markedCodesForOffice(
          user.organizationId,
          office.createdAt,
        );
        if (marked.length > 0) {
          items.push({
            kind: 'new_permission',
            count: marked.length,
            severity: 'action',
            href: '/settings/roles',
            newPermissions: marked.map((code) => noticeFor(code)),
          });
        }
      }
    }

    // --- the reader's own desk. No permission check: these are scoped to
    // their own user id, so there is nothing here they could not already see.
    const [assigned, pendingKyc] = await Promise.all([
      this.repo.countOpenServiceRequestsAssignedTo(user.id),
      this.repo.countOwnedCustomersPendingKyc(user.id),
    ]);
    if (assigned > 0) {
      items.push({
        kind: 'service_request_assigned',
        count: assigned,
        severity: 'action',
        href: '/service-requests',
      });
    }
    if (pendingKyc > 0) {
      items.push({
        kind: 'customer_pending_kyc',
        count: pendingKyc,
        severity: 'action',
        href: '/customers/kyc-queue',
      });
    }

    // `total` is the number of THINGS needing attention, not the number of
    // rows in `items` — the badge should read 7, not 3, when three sources
    // hold seven pieces of work between them.
    return { items, total: items.reduce((sum, i) => sum + i.count, 0) };
  }

  private countFor(kind: NotificationItem['kind']): Promise<number> {
    switch (kind) {
      case 'claim_followup':
        return this.repo.countOpenClaimFollowUps();
      case 'aml_alert':
        return this.repo.countOpenTransactionMonitoringAlerts();
      case 'screening_match':
        return this.repo.countPendingScreeningMatches();
      case 'kyc_awaiting_decision':
        return this.repo.countKycRecordsAwaitingDecision();
      default:
        return Promise.resolve(0);
    }
  }
}
