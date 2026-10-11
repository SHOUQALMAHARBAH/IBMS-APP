# Module 0 item (h) — role scope: where it enters the authorization path

**Status:** design note, written before the implementation, as instructed.
**Item:** (h) — "a role gains insurance type plus branches; every permission granted inside applies
within that scope only; permission codes are not duplicated per type."

Everything below that is a count or a shape was **measured**, and the command is named beside it.

---

## 1. What the authorization path actually is

Measured by reading the four files that compute an answer (there is no fifth — see
`employee-cbj-approval.guard.spec.ts`, which already names this set for a different reason):

```
POST /anything
  └── JwtStrategy / SessionService.validateAndTouch
        → builds AuthenticatedUser { id, organizationId, roleIds, roles, permissions }
        → OrgContextService.adopt(organizationId) + adoptActorRoles(ids, names)
  └── PermissionsGuard.canActivate                    ← THE ONLY ROUTE-LEVEL DECISION
        → PermissionsService.getCodesForRoles(roleIds) ← 60s per-process cache, keyed on role ids
        → PermissionRepository.findCodesForRoles       ← flat Set<string>
        → required.some(code => granted.has(code))     ← OR semantics
  └── the handler, then the service, then the repository
```

`grep -c '@RequirePermissions' apps/api/src --include=*.ts -r` is in the hundreds; those are
**declarations**, not decisions. The decision is `required.some(...)` and nothing else.

## 2. The constraint that decides the whole design

**`PermissionsGuard` cannot decide scope, and no amount of care makes it able to.**

It runs *before* the handler. It has the route, the caller and the required codes — and **no
resource**. "May this user place a policy?" is answerable there. "May this user place a policy **in
the life line**?" is not, because the line arrives in the request body or is reached through an id
the guard has not loaded.

So scope cannot be a thing the guard checks. It has to be decided where the resource's insurance
line is known, which is the service.

That is not a weakening. It is the same shape the fifteen maker/checker pairs already have: the
route guard answers "may you act at all", and the act itself answers "may you act on *this*".

## 3. Where scope is CARRIED

On `AuthenticatedUser`, resolved in the same session read that already builds `roleIds` and
`permissions` — so it costs no extra query, which is the same argument that put `permissions` there
in Phase 2.

```ts
interface RoleScope {
  roleId: string;
  /** NULL = every insurance type. See § 5. */
  category: InsuranceLineCategory | null;
  /** Empty = every branch within `category`. See § 5. */
  lineIds: string[];
}
```

A user holding several roles holds several scopes, and the answer for a given act is the **UNION**:
if any role that grants the code covers the resource's line, the act is permitted. Intersection
would be wrong — a Manager role scoped to GENERAL plus an unscoped Compliance role would leave the
person able to act on nothing, which is not what either grant says.

## 4. Where scope is DECIDED — and the thing deliberately NOT done

### 4.1 One function, called where the resource is known

`common/role-scope.ts` exports exactly one decision:

```ts
assertWithinRoleScope(user, { category, lineId }, code): void   // throws Forbidden, naming the scope
```

It is called at the write surfaces that create or advance a row carrying an insurance line.
Measured (`grep -rl 'insuranceLineId\|officeInsuranceLineId' apps/api/src --include=*.ts | grep -v spec`):
**nine models carry a line FK**, of which four are the business write surfaces —
`InsuranceProgramLine`, `RFQ`, `Policy`, `CommissionAgreement` — and five are catalogue/registry
rows (`InsurerFormTemplate`, `OfficeInsurerFormTemplate`, `InsurerOfferedLine`,
`BrokerLicenseScopeLine`, `EmployeeCbjApprovalBranch`), which describe what the OFFICE or a PERSON
is licensed for rather than business placed in a line.

### 4.2 SCOPE DOES NOT SILENTLY FILTER READS, and that is a decision with a reason

The structurally tempting answer is a Prisma extension mirroring `tenantScopeExtension`: derive the
line-bearing models from the DMMF and filter every query. It would cover reads and writes in one
place and could not be forgotten. `OrgContextService` already carries per-request identity through
`AsyncLocalStorage`, so the mechanism exists.

**It is not built, because on this data a silent read filter is worse than no filter.**

`prisma.policy` is reached from **31 non-spec files** (measured). Most are reads: dashboards, the
finance report, commission calculation, the ageing reports. A scoped Finance Officer opening the
finance dashboard would get the office's totals **silently narrowed to their own insurance type** —
earned commission, VAT, outstanding, net remittance — and the screen would present them as the
office's figures. That is a confidently wrong number on a money report, which this repository has
already been bitten by three times (the empty holiday calendar, the paused-timer breach rate, the
inflated `overdueDays`), and every time the lesson was the same: **a wrong figure that looks right
is a worse failure than a refusal.**

A refusal is loud and names the scope. A filtered aggregate is silent and names nothing.

So:

| | behaviour |
|---|---|
| **Writing** a row carrying an insurance line | REFUSED if outside scope, naming the scope and the line |
| **Reading** anything | unchanged |

If a scoped READ is wanted later, the mechanism already exists and is explicit:
`common/rbac-visibility.util.ts`, which is how the `*.all-owners.read` family already narrows what a
reader sees — a per-role visibility decision made at a named call site, not an invisible global
filter. That is where a future read scope belongs, and it is a product decision about each screen's
numbers rather than an extension.

## 5. NULL means EVERY type, not NO types

`Role.insuranceLineCategory` is nullable and every existing role reads NULL after the migration.

This is the opposite call to items (a) and (b), and for a reason that is stated rather than inherited:

* Item (a) gave `Organization.type` **no default**, because neither value is stricter and a default
  would silently decide a fact somebody forgot to state.
* Item (b) backfilled `brokerKind = CORPORATE` because that is the **non-restricting** value.

Here the same test applies and gives the same answer as (b): a migration must not retroactively
narrow anybody's access. Twelve seeded roles and every custom role an office has already created
hold no scope, and reading that as "scoped to nothing" would refuse every write in the system on the
first deploy. So **NULL = unrestricted**, and the branch list being empty likewise means "every
branch within the type".

The cost of that choice, stated rather than discovered: a role an office *means* to scope but leaves
blank is unrestricted, and nothing warns. The Role screen states the scope in words for exactly that
reason — "this role may act in every insurance type" is a sentence an administrator can disagree
with, where a blank field is not.

## 6. "Permission codes are not duplicated per type" — satisfied by construction

Scope is a second dimension **on the role**, not a prefix on the code. There is no
`policy.place.general`; there is `policy.place`, held by a role whose scope is GENERAL.

The catalogue stays at its current size and the five regenerations a new permission requires are not
triggered at all. The guard test asserts the negative as well: no permission code may contain a type
name, so the duplication cannot creep back one code at a time.

## 7. The guard test

`role-scope.inventory.spec.ts`, in the shape of the existing
`permission-enforcement.inventory.spec.ts` (which already guards "a declared code is read by
something"):

1. **Every service that WRITES a row carrying an insurance line calls `assertWithinRoleScope`**, or
   is named in an `UNSCOPED` list with a reason. Measured from the source, so a new write surface is
   covered without anybody remembering to extend a list.
2. **The decision exists in exactly ONE place** — no second copy of the comparison, which is how one
   of two copies comes back looser than it went in.
3. **No permission code names an insurance type** (§ 6).
4. **Non-vacuity**: the matcher must find the write surfaces it claims to check, so a rename makes
   the guard fail rather than silently pass over nothing.

What that test does **not** claim, written here so nobody reads more into a green run: it proves the
scope decision is REACHED at every write surface it can see. It does not prove reads are scoped —
they deliberately are not (§ 4.2) — and it cannot prove a service reaches its repository without
passing through its own service method, which is what the repository layer's narrow signatures are
for.

## 8. What is left out, and why

* **Read scoping** — § 4.2. A decision about each screen's numbers, not a filter.
* **Scoping the five catalogue/registry models** — `BrokerLicenseScopeLine` and
  `EmployeeCbjApprovalBranch` record what the office and its people are LICENSED for, which is the
  input to scope rather than a thing scope governs. Scoping them would mean a GENERAL-scoped
  administrator could not record the office's own life licence, which inverts the relationship.
* **A warning when a role is saved unscoped** — § 5 states the cost. Item (i) adds a reachability
  warning on role save and is the natural place for a second one, if it is wanted.
