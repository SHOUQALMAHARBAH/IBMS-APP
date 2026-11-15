import { describe, expect, it, vi } from 'vitest';
import { NotificationService } from './notification.service';
import type { NotificationRepository } from '../../repositories/notification.repository';
import type { PermissionsService } from '../rbac/services/permissions.service';
import type { OrganizationRepository } from '../../repositories/organization.repository';
import type { AuthenticatedUser } from '../auth/auth.types';
import { withDerivedPermissions } from '../../../test/fixtures/authenticated-user';

/*
 * The gating is the thing worth testing. The counts are one-line Prisma calls;
 * WHO is allowed to see each one is the part that would leak if it were wrong,
 * and "a Sales Officer sees an AML count" is not something a type catches.
 */

function makeService(
  over: {
    counts?: Partial<Record<string, number>>;
    granted?: string[];
    /** OWNER DECISION 131 — codes this office has not decided on yet. */
    markedCodes?: string[];
    /** The office row the mark needs. `null` models an office that cannot be read. */
    office?: { createdAt: Date } | null;
  } = {},
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
    markedCodesForOffice: vi.fn().mockResolvedValue(over.markedCodes ?? []),
  };
  const organizations = {
    findById: vi
      .fn()
      .mockResolvedValue(
        over.office === undefined
          ? { createdAt: new Date('2026-01-01T00:00:00Z') }
          : over.office,
      ),
  };
  const service = new NotificationService(
    repo as unknown as NotificationRepository,
    permissions as unknown as PermissionsService,
    organizations as unknown as OrganizationRepository,
  );
  return { service, repo, permissions, organizations };
}

const user = (roles: string[]): AuthenticatedUser =>
  withDerivedPermissions({
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

/*
 * OWNER DECISION 131 — THE NEW-PERMISSION ITEM.
 *
 * «الصلاحية الجديدة بتنزل معلَّمة بالأخضر إنها جديدة ويوصل إشعار للأدمن، وهو بيقرر لمين يعطيها.»
 *
 * The bell is DERIVED, so "notify the administrator" is not a write: each reader's own request
 * asks whether they hold `role.update` and, if so, what their office has not decided on. The set
 * of people who see this item IS the set of active holders, computed one reader at a time.
 */
describe('NotificationService.list — decision 131, a permission the office has not decided on', () => {
  it('reaches a holder of role.update and nobody else', async () => {
    /*
     * The recipient rule, in both directions and in one test because it is ONE rule. `role.update`
     * gates `PUT /roles/:id/permissions` — the matrix — so the people who can act on the mark are
     * exactly the people told about it. A PERMISSION and never a role name, which is decision
     * 131's own requirement and this repository's standing one.
     */
    const withCode = makeService({
      granted: ['role.update'],
      markedCodes: ['legal-value.read'],
    });
    expect(
      kinds(await withCode.service.list(user(['OFFICE_ADMINISTRATOR']))),
    ).toContain('new_permission');

    const without = makeService({
      granted: ['aml.monitor'],
      markedCodes: ['legal-value.read'],
    });
    expect(
      kinds(await without.service.list(user(['COMPLIANCE_OFFICER']))),
      'a reader who cannot edit the matrix is told about a permission they could not grant',
    ).not.toContain('new_permission');
  });

  it('is omitted entirely when the office has decided on everything', async () => {
    // An empty source is omitted rather than reported as "0 things to do" — this file's own rule.
    const { service } = makeService({
      granted: ['role.update'],
      markedCodes: [],
    });
    expect(
      kinds(await service.list(user(['OFFICE_ADMINISTRATOR']))),
    ).not.toContain('new_permission');
  });

  it('names WHICH permissions and what each controls — the sentence has slots', async () => {
    /*
     * 🔴 THE ONE SOURCE THAT NEEDS MORE THAN A COUNT, and the test says why.
     *
     * Decision 133's ratified sentence is «صلاحية جديدة في النظام: [اسمها]. [شرحها]. تتحكّم في:
     * [الشاشة أو الزر]. لم تُعطَ لأحد بعد — قرّر لمن تعطيها من مصفوفة الصلاحيات.» A count alone
     * would tell an administrator that SOMETHING arrived and not what, which is the one thing the
     * notification exists to prevent.
     */
    const { service } = makeService({
      granted: ['role.update'],
      markedCodes: ['legal-value.read', 'legal-value.declare'],
    });
    const result = await service.list(user(['OFFICE_ADMINISTRATOR']));
    const item = result.items.find((i) => i.kind === 'new_permission');

    expect(item?.count).toBe(2);
    expect(
      item?.href,
      'the link goes to the matrix, which is where the decision is made',
    ).toBe('/settings/roles');
    expect(item?.newPermissions?.map((p) => p.code)).toEqual([
      'legal-value.read',
      'legal-value.declare',
    ]);

    /*
     * AND THE PAYLOAD IS STILL KEYS, NEVER A SENTENCE — the boundary the test above draws, held
     * at the one place it bends. A permission code is catalogue metadata and not customer data,
     * so returning it does not reach the concern that keeps every other source to counts; the
     * NAME and the DESCRIPTION still come from the web's own dictionaries, in both languages.
     */
    for (const notice of item?.newPermissions ?? []) {
      expect(Object.keys(notice).sort()).toEqual(['code', 'routes', 'screen']);
    }
  });

  it('says nothing at all when the office row cannot be read', async () => {
    /*
     * Condition 1 is «arrived after this office was created», so with no office row there is no
     * `createdAt` to compare against and the rule cannot be evaluated. SILENCE is the right
     * answer: a missing nudge is a small loss, and marking every code new would be the noise the
     * mark is designed to avoid.
     */
    const { service, permissions } = makeService({
      granted: ['role.update'],
      markedCodes: ['legal-value.read'],
      office: null,
    });
    expect(
      kinds(await service.list(user(['OFFICE_ADMINISTRATOR']))),
    ).not.toContain('new_permission');
    expect(
      permissions.markedCodesForOffice,
      'the mark was computed even though its precondition could not be read',
    ).not.toHaveBeenCalled();
  });
});
