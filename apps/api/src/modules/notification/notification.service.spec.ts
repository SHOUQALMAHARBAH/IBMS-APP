import { describe, expect, it, vi } from 'vitest';
import { NotificationService } from './notification.service';
import type { NotificationRepository } from '../../repositories/notification.repository';
import type { PermissionsService } from '../rbac/services/permissions.service';
import type { AuthenticatedUser } from '../auth/auth.types';

/*
 * The gating is the thing worth testing. The counts are one-line Prisma calls;
 * WHO is allowed to see each one is the part that would leak if it were wrong,
 * and "a Sales Officer sees an AML count" is not something a type catches.
 */

function makeService(
  over: { counts?: Partial<Record<string, number>>; granted?: string[] } = {},
) {
  const counts = {
    sla: 4,
    claimFollowUp: 3,
    aml: 2,
    screening: 5,
    assigned: 1,
    pendingKyc: 6,
    ...over.counts,
  };
  const repo = {
    countOverdueSlaTimers: vi.fn().mockResolvedValue(counts.sla),
    countOpenClaimFollowUps: vi.fn().mockResolvedValue(counts.claimFollowUp),
    countOpenTransactionMonitoringAlerts: vi.fn().mockResolvedValue(counts.aml),
    countPendingScreeningMatches: vi.fn().mockResolvedValue(counts.screening),
    countOpenServiceRequestsAssignedTo: vi
      .fn()
      .mockResolvedValue(counts.assigned),
    countOwnedCustomersPendingKyc: vi.fn().mockResolvedValue(counts.pendingKyc),
  };
  const permissions = {
    getCodesForRoles: vi.fn().mockResolvedValue(new Set(over.granted ?? [])),
  };
  const service = new NotificationService(
    repo as unknown as NotificationRepository,
    permissions as unknown as PermissionsService,
  );
  return { service, repo, permissions };
}

const user = (roles: string[]): AuthenticatedUser => ({
  id: 'user-1',
  organizationId: 'org-1',
  email: 'a@b.test',
  roleIds: roles.map((r) => `id-${r}`),
  roles,
  sessionId: 'sess-1',
});

const kinds = (r: { items: { kind: string }[] }) => r.items.map((i) => i.kind);

describe('NotificationService.list', () => {
  it('tells a reader nothing about work they could not already open', async () => {
    // No permissions at all: the two own-desk sources still appear, because
    // they are scoped to this user's own id. Nothing book-wide does.
    const { service, repo } = makeService({ granted: [] });
    const result = await service.list(user(['SALES_RELATIONSHIP_OFFICER']));

    expect(kinds(result)).toEqual([
      'service_request_assigned',
      'customer_pending_kyc',
    ]);
    // Not merely absent from the output — never counted at all. A count of
    // open AML alerts is itself a signal about the book.
    expect(repo.countOpenTransactionMonitoringAlerts).not.toHaveBeenCalled();
    expect(repo.countPendingScreeningMatches).not.toHaveBeenCalled();
    expect(repo.countOpenClaimFollowUps).not.toHaveBeenCalled();
  });

  it('includes a book-wide source only with the permission guarding its screen', async () => {
    const { service, repo } = makeService({ granted: ['aml.monitor'] });
    const result = await service.list(user(['COMPLIANCE_OFFICER']));

    expect(kinds(result)).toContain('aml_alert');
    expect(kinds(result)).not.toContain('screening_match');
    expect(repo.countOpenTransactionMonitoringAlerts).toHaveBeenCalled();
    expect(repo.countPendingScreeningMatches).not.toHaveBeenCalled();
  });

  it('counts SLA escalations only for targets that name a role the reader holds', async () => {
    const { service, repo } = makeService({
      granted: ['sla-dashboard.view'],
    });
    await service.list(user(['CLAIMS_OFFICER']));

    // Scoped to the reader's own role, not every overdue timer on the book.
    expect(repo.countOverdueSlaTimers).toHaveBeenCalledWith(expect.any(Date), [
      'CLAIMS_OFFICER',
    ]);
  });

  it('skips the SLA source entirely for a role no escalation target names', async () => {
    // EXECUTIVE_MANAGEMENT holds sla-dashboard.view but is not an escalation
    // target, so there is no "your" overdue timer to report. The dashboard
    // still shows them everything — the bell is not the access control.
    const { service, repo } = makeService({ granted: ['sla-dashboard.view'] });
    const result = await service.list(user(['EXECUTIVE_MANAGEMENT']));

    expect(kinds(result)).not.toContain('sla_overdue');
    expect(repo.countOverdueSlaTimers).not.toHaveBeenCalled();
  });

  it('omits a source with nothing in it rather than reporting zero', async () => {
    const { service } = makeService({
      granted: ['aml.monitor'],
      counts: { aml: 0, assigned: 0, pendingKyc: 0 },
    });
    const result = await service.list(user(['COMPLIANCE_OFFICER']));

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('totals the work, not the sources — the badge reads 7, not 3', async () => {
    const { service } = makeService({
      granted: ['aml.monitor', 'claim.followup.manage'],
      counts: { aml: 2, claimFollowUp: 3, assigned: 2, pendingKyc: 0 },
    });
    const result = await service.list(user(['COMPLIANCE_OFFICER']));

    expect(result.items).toHaveLength(3);
    expect(result.total).toBe(7);
  });

  it('never returns anything but a kind, a count, a severity and a link', async () => {
    // The payload deliberately carries no names, no narrative and no ids:
    // reading those rows is a sensitive-data-access event, and a bell that
    // renders on every page load must not be one.
    const { service } = makeService({ granted: ['sanctions-pep.screen'] });
    const result = await service.list(user(['COMPLIANCE_OFFICER']));

    for (const item of result.items) {
      expect(Object.keys(item).sort()).toEqual([
        'count',
        'href',
        'kind',
        'severity',
      ]);
    }
  });
});
