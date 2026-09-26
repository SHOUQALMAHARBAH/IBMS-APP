# Office-scoped custom RBAC — the four constraints, and the Phase 4 hand-off

Phases 1–3 of 5 are built. This document is what someone touching anything
role-related needs before they start, and what Phase 4 inherits.

The whole backlog was built against a fixed catalogue of eleven roles shared by
every office. That is being replaced with roles each office defines for itself —
the same kind of retrofit as multi-tenancy, changing an assumption a lot of files
depend on, so it goes one phase at a time and each phase ships whole.

---

## The four constraints

These are not style preferences. Each one is a bug this rework already had.

### 1. A role NAME is not an identity

`Role.name` was globally `UNIQUE`. It is now `@@unique([organizationId, name])`,
so two offices may each define a "Manager" with entirely different grants. Every
lookup that keys on a name therefore returns **every same-named role across every
office** and hands the caller their union.

That was live, twice, the moment the constraint changed:

| Was | Effect |
|---|---|
| `PermissionRepository.findCodesForRoles` filtered `role: { name: { in } }` | returned both offices' rows — the caller got the UNION of their grants |
| `PermissionsService` cached under `[...roleNames].sort().join(',')` | served one office's answer to the other for up to a minute |

Both now key on `roleId`. Role ids are uuids, unique across every office, so a key
built from them cannot collide across tenants by construction.
`AuthenticatedUser` carries `roleIds` beside the names it keeps for display.

The same rule holds at the API boundary: role assignment is id-addressed
(`{ roleId }` / `{ roleIds }`), and `findRoleByName` / `findRolesByNames` were
**deleted** rather than left dormant — a name-addressed role lookup sitting in the
repository invites name-addressing back.

Two role-name sites remain, deliberately: SLA escalation routing (plus the
bell-notification recipients that follow it) and the Executive nav ORDER. Those
answer *which business function owns this*, which is an organizational fact rather
than an access decision. See the hand-off below.

### 2. An RLS policy is only enforceable on a model carrying `organizationId`

`tenantScopeExtension` derives its scoped set from the DMMF as "every model
carrying an `organizationId`", and sets the `app.current_org_id` session variable
**only for those models**. A policy reading that variable on any other table
matches nothing, forever.

Phase 1 learned this the hard way. `RolePermission`'s first policy was scoped
through a JOIN to `Role`, specifically to avoid denormalizing `organizationId`
where a drifted copy would be the row granting access. That policy could never be
satisfied: `current_setting` was always NULL, every permission read returned
empty, and users authenticated fine and then 403'd everywhere — `/auth/me` showed
`roles: ["SALES_RELATIONSHIP_OFFICER"]` beside `permissions: 0`.

The column is now there, and the drift worry is answered **structurally** instead:
a composite foreign key `(roleId, organizationId)` → `Role(id, organizationId)`
makes a disagreeing grant fail to INSERT. `tenant-scope.extension.spec.ts` guards
the general rule — every RLS-protected model must be in `TENANT_SCOPED_MODELS`.

### 3. `Role.status` has to reach every query that DECIDES access

Retiring is the only removal there is — there is no `DELETE /rbac/roles/:id`,
because the `UserRoleAssignment` and `RolePermission` rows pointing at a role ARE
the record of who held what and when.

That means `INACTIVE` cannot be a screen-level filter. Four queries decide access
and all four filter on it:

| Query | What it decides |
|---|---|
| `PermissionRepository.findCodesForRoles` | the authorization answer itself |
| `UserRepository.getRoleRefs` | the session's roles and MFA attributes |
| `UserRepository.findActiveHoldersOfPermission` | who survives a revoke |
| `UserRepository.roleGrantsPermission` | whether the guard applies at all |

A retired role that still satisfied the last two would let an office retire its
only administrator role and then revoke the grant, with the lockout guard waving
both through because it still saw a "surviving" holder.

Note that these layers mask each other: planting a regression on
`findCodesForRoles` alone leaves the tests green, because `getRoleRefs` also
filters. There is a direct inner-layer test for exactly that reason.

### 3b. There are FOUR routes to the administrator lockout, and all four are guarded

An office that ends up with nobody holding `user.manage` cannot grant it back —
there is no platform-admin surface to rescue it from. Four operations can take the
capability away, and each takes the same per-office advisory lock
(`pg_advisory_xact_lock` on `(organizationId, 'user.manage')`) and asks the same
question: **what survives THIS change**, not what exists now.

| Route | Guarded in |
|---|---|
| revoke a user's role grant | Phase 2 |
| deactivate the user | Phase 2 — `AuthService.login` refuses an inactive account, so this removes a holder as effectively as a revoke |
| retire the role | Phase 3 |
| remove `user.manage` from the role via the permission matrix | Phase 3 |

The fourth is the quiet one, and it was missed on the first pass through this phase
— unchecking a box does not look like an access action, but it takes the capability
away exactly as a revoke does. It is reachable despite every office having an
`isSystem` `OFFICE_ADMINISTRATOR` that the CRUD guards protect: an office with a
second, CUSTOM administrator role can have every administrator grant revoked one at
a time (each allowed, because the custom role's holders survive each check) and
then have the capability removed from that custom role. The role still GRANTS it;
nobody HOLDS it, and nobody can be given it.

A per-route or per-row lock would not do. Two of these operations touch different
rows entirely (retiring role A while revoking a grant on role B), so the lock is
keyed on the OFFICE and the capability, never on the row being written.

There is no fifth route as of Phase 3: there is no role DELETE, `updateRole`
touches only display names, the MFA attributes cannot block a login, and no endpoint
updates a user's `accessValidUntil` after provisioning. Adding any operation that
can remove a grant means adding it to this table.

### 4. `isSystem` grants nothing

It stops the Role screen renaming, retiring or re-granting a row. It is read by
the CRUD guards and by nothing else. Authorization never looks at it.

A flag called "system" on a Role is exactly where an `if (isSystem) allow` bypass
gets smuggled in, so there is a test whose only job is to prove it does not exist:
a user holding an `isSystem` role with **zero** grants gets 403 from every
administration route. Planting `if (user.roles.length > 0) return true` in
`PermissionsGuard` is what proved that test can fail.

---

## What the three phases built

**Phase 1 — roles became per-office data.** `Role` carries `organizationId`,
`nameAr`, `nameEn`; `RolePermission` is tenant-scoped with the composite FK above;
RLS on both. `Permission` stays a single GLOBAL catalogue — it describes what the
software can do, and only the grants are per-office. The legacy eleven survive as
ordinary per-office rows with their old machine names, and the migration's
blocking gate was a per-user effective-permission diff before vs after: empty.

**Phase 2 — no authorization decision reads a role name.** The two controls that
failed OPEN became columns: `Role.requiresMfaAlways` and
`requiresHardwareToken`, defaulting to the STRICT value. They are security
ATTRIBUTES rather than permissions, because a permission could be granted away
from the very Role screen Phase 3 adds. Cross-owner visibility became seven
`<family>.all-owners.read` codes; `@RequireRoles` and `RolesGuard` were deleted
outright; the segregation signal keys on thirteen checker PERMISSIONS and stays
DETECTIVE; the last-administrator guard keys on `user.manage` under a
transaction-scoped advisory lock, because several roles can now hold the
capability and a Role-row lock no longer serialises it.

**Phase 3 — an office defines its own roles.** `/settings/roles`, `Role.status`
and `isSystem`, an `OFFICE_ADMINISTRATOR` in every office, and the two
national-ID reveals split off the permissions that let you read the record.

---

## Things that will bite

**The seed grants to the DEFAULT office only.** `seed.ts` upserts the grid against
the default organization's roles. Any code added after another office was created
never reaches that office's roles. This was measured, not theorised: the demo
office's `SYSTEM_SECURITY_ADMINISTRATOR` was three codes behind the grid, and its
eight roles were 25 grants behind in total. `seed-demo.script.ts` now mirrors the
default office's grants for every role it installs; a future org-provisioning path
must do the same or its offices drift silently.

**The seed never REMOVES a grant.** Narrowing a permission in the grid does not
revoke it anywhere — a reseed only upserts. Withdrawing a grant needs a migration
(see `20261004120000_incident_classify_split`). The seed is deliberately NOT made
to prune, because under custom roles an office's own grants are precisely the rows
absent from the grid.

**The permission cache is per-process.** `invalidateCache()` clears one process's
60-second cache. Correct today — the API runs as a single instance — and it now
matters more than it did, because editing a role used to mean editing the seed and
redeploying and is now a button on a screen. The fix when a second instance
arrives is a shared invalidation channel (Redis pub/sub, or a `Role.updatedAt` the
cache compares against), **not** a shorter TTL: that narrows the window without
closing it and costs a join on every guarded request.

**A new office gets the administrator role and nothing else.** Nothing in the
application creates an Organization — the only two writers are `seed.ts` and
`seed-demo.script.ts`. The rule lives in both, plus
`office-administrator.e2e-spec.ts` asserting that an Organization with no ACTIVE
role granting `user.manage` is a defect. Whenever real org provisioning lands it
cannot ship without one.

**One grantable code's effect CROSSES offices, and the matrix does not stop it.**
`insurer.form.map` maps an insurer's official submission form for a product line,
and `InsurerFormTemplate` carries no `organizationId` — the grid's own description
says the mapping "becomes the form every other office submits against". The
permission matrix offers all 182 codes, so an office can grant itself that code
and change what every other office submits.

This is a real gap, not a hypothetical, and it is NOT closed in Phase 3. Closing it
needs a "not office-grantable" concept the model does not have, and that concept
needs an answer to the question it implies — if an office may not grant it, who
may? There is no platform-level admin surface anywhere in this codebase. The
Phase 3 plan assumed no such code existed in the catalogue; it does, and
`insurer.form.map` is the one. `OFFICE_ADMINISTRATOR` deliberately does not hold
it, which limits the blast radius to an office that deliberately builds a role
around it, but does not eliminate it.

Note `insurer.master.manage` does **not** exist — only `insurer.master.read`.
Nothing writes the global registry through a permission today, which is the reason
the matrix cannot grant that write. The moment insurer CRUD lands (Phase 4 item 4),
that changes and this gap needs closing with it.

**The web e2e holds a THIRD copy of the permission grid**
(`apps/web/e2e/fixtures/role-permissions.ts`). Its header says regenerate, not
hand-edit. Regenerate it from the seeded database whenever a grant moves.

**Maker/checker is unaffected and needs no work.** It compares user IDs at 19 call
sites, backed by 15 database `*_maker_checker_distinct` CHECK constraints, so holding
several roles cannot weaken separation of duties. The permission matrix warns when one role both
classifies an incident and co-signs that classification, but it saves: a small
office may legitimately want that, and `assertDifferentActors` still refuses a
co-sign by whoever recorded the classification.

Both figures above are corrected from what this repo's notes have repeated since
Phase 1 ("62 call sites, 17 CHECK constraints"); both were measured here rather than
carried forward.

The call sites are **19**, not 62. 63 is how many LINES in non-spec source mention
`assertDifferentActors` at all — imports and comments included — which is what the
older figure appears to have counted. Measured by grepping for the call with its
opening parenthesis, excluding specs and the utility's own file.

The constraints are **15**, not 17. 17 is how many CHECK constraints mention a user
column; two of those —
`SalesTarget_owner_xor_branch` and `ScreeningMatch_assigned_has_assignee` — are not
maker/checker constraints at all. Measured with
`SELECT conname FROM pg_constraint WHERE contype='c' AND conname LIKE '%maker_checker_distinct'`.
Phase 3 added and removed none of them; the correction is to the count, not to the
control.

---

## Phase 4 hand-off

Four items, in the order they depend on each other.

### 1. The business-function routing table

This is the one that closes the last role-name sites, and it is the reason those
sites were left alone rather than converted.

`sla-registry.config.ts` and `sla-policies.ts` escalate to a role NAME, and the
bell-notification recipients follow the same table. The Executive nav ORDER is a
third. All three answer *which business function owns this* — converting them to
permissions would replace a clear statement with a misleading one ("whoever can
approve a refund" is not the same set as "the Branch Manager this escalation goes
to"), and a custom-role-only office currently matches none of them.

What is needed is a per-office mapping from a business function to the role (or
roles) that fills it, which is an org-structure question — which is why it belongs
here rather than in Phase 3.

### 2. The unified screen's org-structure half

Phase 3 built the person half of `/settings/users`: one row per person, the HR-record
link, the no-roles badge. The org-structure half — Branch and Department as
first-class editable structure rather than two dropdowns whose options come from
`POST /admin/branches` — is Phase 4. Note `EmployeeRepository.linkUser` already
reconciles the two `departmentId` columns (`Employee.departmentId` from the org
chart, `User.departmentId` from provisioning) in one transaction; that reconciliation
is the seam to build on.

### 3. Subdomain resolution

`POST /auth/signup` resolves the platform's SOLE Organization and **refuses** when
there is more than one, deliberately: it makes onboarding a second office
impossible until the org is resolved from the request subdomain BEFORE the sign-in
form. `Organization.subdomain` already exists and is already unique. Two practical
notes: the refusal is a bare `Error` (a 500, as a platform misconfiguration rather
than a client error), and a leaked e2e fixture Organization therefore breaks signup
for every spec — which is why the fixture specs clean up in `beforeAll` as well as
`afterAll`.

### 4. Insurer CRUD, and why it was deferred

An Office Administrator must be able to create an insurer absent from the global
`InsurerMaster`, office-scoped, enforced in RLS and backend authorization rather
than by frontend filtering. The proposed code is `insurer.relationship.manage`,
never `insurer.master.manage`.

It was deferred from Phase 3 for a reason worth keeping: including that code in the
administrator role would have broken the **strict-subset** property its migration's
empty diff depends on. `permissions.spec.ts` asserts that subset, so adding the
code to `OFFICE_ADMINISTRATOR` will fail there until the migration story is redone.

The Phase 2 plan's §13 holds the data-model detail: the nullable master reference,
the partial unique index, and the `invoice.repository.ts` INNER JOIN that would
otherwise drop an office-local insurer's invoices out of a financial report.

**Close the cross-office grant gap with it.** See "Things that will bite" above:
`insurer.form.map` is already grantable from the matrix and already changes what
every other office submits. Adding a write permission on the global registry
alongside it without a "not office-grantable" marker would turn one gap into two.

### Phase 5

Migration rehearsal, then dropping the `RoleName` enum TYPE and the pre-migration
global role rows. Both are deliberately kept for at least one release so rollback
stays cheap; nothing in the schema references the enum any more.

---

## Where to look

| File | Why |
|---|---|
| `apps/api/src/repositories/permission.repository.ts` | the authorization read — ids and `status` |
| `apps/api/src/modules/rbac/services/permissions.service.ts` | the cache, its key, and the per-process note |
| `apps/api/src/modules/rbac/services/role-admin.service.ts` | Role CRUD, `isSystem` refusals, the third lockout route |
| `apps/api/src/modules/rbac/checker-roles.config.ts` | the thirteen checker permissions and the detective signal |
| `apps/api/src/common/rbac-visibility.util.ts` | the seven cross-owner permissions |
| `packages/db/prisma/seed-data/roles.ts` | the legacy eleven and `OFFICE_ADMINISTRATOR` |
| `packages/db/prisma/seed-data/permissions.ts` | the permission grid — **211 codes as of 2026-09-26** (182 at Phase 3; +4 insurer, +12 four-action Phase 1, +4 discard, +1 duty-segregation mode, +8 others). Do not quote a figure from here: `apps/web/lib/admin/permission-matrix.test.ts` pins the live count and is what moves when a code is added |
| `apps/api/test/office-administrator.e2e-spec.ts` | the every-office rule and the `isSystem` bypass test |
| `apps/api/test/national-id-reveal-split.e2e-spec.ts` | why one split is per route and the other per field |
| `apps/api/test/last-administrator-lock.e2e-spec.ts` | the advisory lock and its serialisation proof |
