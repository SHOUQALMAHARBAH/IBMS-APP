# The «جديدة» mark and its notification — the smallest shape, sized

**Written 2026-11-12, message 37 §1.4 and §1.5.** OWNER DECISION 131: we grant nothing. Every
permission appears in every office's matrix, a new one lands marked **«جديدة»** in green, the
administrator is notified, and the office decides — «احنا ما النا دخل».

**Nothing in this document is built.** §1.4 asked for a size and a proposal; §1.5's buildable half
turned out to already exist, and its unbuildable half is explained below rather than guessed at.

---

## ✅ BUILT — 2026-11-14, message 38 §2. The design below is unchanged; this records what landed.

Migration `20261219100000_new_permission_mark`: `Permission.introducedAt` (nullable, global) and
`OfficePermissionDismissal` (tenant-scoped, RLS **ENABLED and FORCED**, one policy, unique on
`(organizationId, permissionId)`), with seven assertions in its own DO block — including that it
stamps **no** existing code and writes **no** grant.

| piece | where |
|---|---|
| the rule, pure | `apps/api/src/modules/rbac/new-permission-mark.config.ts` — `isMarkedNew`, three conditions, each tested in both directions |
| the three facts, per office | `PermissionRepository.findMarkStateForOffice` |
| the grid, marked | `GET /rbac/permissions` now returns `isNew` per code, computed against the caller's own office |
| the ruling | `POST /rbac/permissions/:code/dismiss`, gated on `role.update` |
| the bell | `notification.service.ts`, kind `new_permission`, gated on `role.update` |
| the mark | `PermissionMatrix.tsx` — «جديدة», green (`matrixNewBadgeStyle`, the declared `--success-*` trio) |
| the sentence | `apps/web/lib/notification/new-permission-sentence.ts`, from decision 133 |
| criteria 3 and 4 | `apps/api/test/new-permission-mark.e2e-spec.ts`, 7/7, each named by its number |

**And `introducedAt` is NOT back-filled.** The 230 codes that existed keep NULL — «predates the
mark» — so no office meets its catalogue as new. The two `legal-value.*` codes carry **2026-11-11**,
measured from migration `20261216100000`'s own commit, and every brokerage office on dev was created
before that day: **so those two are the first codes in this product's life to be marked in a real
office.**

⛔ **AND THE BACKFILL IS NOW A GATE.** `npm run check:permission-migrations` refuses a migration
that adds a permission and writes `RolePermission` for it. The eight that did are declared as
history and asserted, so a stale declaration fails too. Self-test 6/6, in `check:guards`, so in CI.

🔴 **ONE THING IS NOT FINISHED AND IT IS THE OWNER'S.** Decision 133's sentence opens with the
permission's NAME, and decision 127 forbids ever showing a user the CODE. The names are a
derivation table over all 232 codes that is **not built** (message 38 §4 defers it), and exactly
**one** name exists — hers, for `retention.archive.retrieve`, which cannot be marked. So where no
name exists the sentence renders **without that clause**: showing the code breaks 127, and
inventing a name breaks the standing rule. Reported rather than quietly shipped.

---

## Why `Permission.introducedAt` alone cannot carry it — the question §1.4 asks

The mark clears **when that office's administrator has decided**, not by elapsed time, and **per
office**: one office deciding must not clear another's mark (criterion 5). A single date on the
global `Permission` row has one value for every office, so it can answer *when did this code
arrive* and can never answer *has THIS office dealt with it*.

## The smallest shape that can — one column and one small table

```
Permission.introducedAt   DateTime?   -- provider-owned, one value, global
OfficePermissionDismissal(organizationId, permissionId, dismissedByUserId, dismissedAt)
```

A code is **marked for an office** iff all three hold:

1. `Permission.introducedAt` is later than that office's own `createdAt` — so a newly-registered
   office does not meet its entire 232-code catalogue as "new", which would make the mark noise on
   day one and teach the first administrator to ignore it;
2. **no `RolePermission` row** for that code in that office — *granting it to a role* is one of the
   two ways the owner named to decide, and it is already recorded, so it needs no second record;
3. **no dismissal row** — the other way she named, «أو يقرّر فيها»: the administrator looked and
   chose not to grant it.

### Why a DISMISSAL table and not a decision table

The obvious shape is one row per (office, code) carrying the decision. It is bigger and weaker:

- **Bigger:** it needs a row for every office × every code the office granted — duplicating what
  `RolePermission` already says. 232 codes × every office, to record what one join answers.
- **Weaker:** two sources would then say whether a code is granted, and they could disagree. The
  grant is the authority; the dismissal is the only fact not already recorded anywhere.

So the table holds only the one state nothing else can express. For 232 codes and four offices on
dev it would hold a handful of rows rather than ~930.

### Criterion 5 is satisfied by construction, not by a filter

`OfficePermissionDismissal` is tenant-scoped with the usual
`DEFAULT current_setting('app.current_org_id', true)` and an `ENABLE`d + `FORCE`d tenant policy. So
one office cannot read, write or clear another's state — **not because a query filters it, but
because the row is invisible.** That is the distinction message 36 §1 measured the hard way: an
application-layer filter proves layer 1, and only a policy proves layer 2.

⚠️ **And `Permission` itself must stay a global catalogue with NO tenant column.** It is read by
every office, `RoleAdminService.setPermissions` validates against it, and `permissions.ts` is the
one home. The per-office state goes beside it, never on it.

---

## The notification — §1.5, and the buildable half is already built

### The recipient set: `role.update`, and it exists today

`PUT /roles/:id/permissions` is gated by **`role.update`** (`rbac.controller.ts:125`), so the
holder of the role-editing permission is the holder of that code. **A permission, never a role
name**, as decision 131 requires.

`UserRepository.findActiveHoldersOfPermission(code)` is exactly that query and is already correct:

- it excludes a **RETIRED** role — its own comment records why, and it is the lockout a
  last-administrator guard exists to prevent;
- it excludes an assignment that has been revoked, and an account that **cannot act today**
  (`canActToday`, extracted precisely so a picker and a guard cannot drift);
- it is **scoped to the caller's own office** by `tenantScopeExtension`.

⟶ **So the recipient set needs no new code.** What it needs is `role.update` passed to it.

### 🔴 The "trigger" is NOT a write, and that is an architectural fact rather than a choice

**There is no `Notification` table and nothing writes one.** `notification.service.ts`'s own
docstring is explicit: the bell is **derived**, every item a live count taken at read time from the
rows that already record the work, and it states the consequences it accepts (no history, no
cross-device read state, no event granularity).

So "when a code lands, notify every holder in each office" cannot be a fan-out write. **It does not
need to be, and the derived model is better here:**

- each office's bell derives its own item at read time from **its own** marked codes — the three
  conditions above;
- no cross-office enumeration happens at all, so nothing has to leave the tenant scope.

### And that last point is why the obvious alternative is refused

A fan-out at the moment a code lands would have to enumerate holders **across every office**, from
a context with no caller and no office — which means leaving the tenancy model. The only mechanism
in this codebase that reads across offices is a `security_invoker = false` view, and
`provider-office-state.e2e-spec.ts` asserts that **the set of such views is exactly two**, with its
own message: *a new member is a new cross-office channel*.

⛔ **Adding a third to deliver a notification is not a call to make while implementing one.** The
derived route needs no such channel, which is the strongest argument for it.

---

## What each of decision 131's five criteria needs

| # | criterion | where it stands |
|---|---|---|
| 1 | a new code with no role — the seed accepts it, the check does not refuse | **BUILT** (message 37 §1.1), with both plants. Its test lives with the catalogue: `permissions.spec.ts`, "DECISION 131 CRITERION 1" |
| 2 | a new office gets ONE role and no business capability | **ALREADY TRUE** — measured on dev: the two registered offices hold 47 codes on one `OFFICE_ADMINISTRATOR` role, zero business capabilities. **Now also GUARDED**: criterion 2's test refuses a business-entity code in `OFFICE_ADMINISTRATOR_GRANTS` by name |
| 3 | «جديدة» in every office's matrix + a notification to the `role.update` holders | needs the shape above (not built) + the screen; the recipient query exists. **The recipient CODE is pinned**: criterion 3's test reads the matrix route's own decorator, so moving that route to another permission fails rather than redirecting the notification silently |
| 4 | the admin grants it ⟶ the mark clears **in their office only** | falls out of condition 2 above: the `RolePermission` row IS the clearing, and it is tenant-scoped. Criterion 4's test **pins the pointer** rather than restating — those three assertions have one home, `tenant-scope.extension.spec.ts`, and deleting one there fails here by name |
| 5 | another office does not see one office's decision | falls out of RLS on the dismissal table — invisible, not filtered. Criterion 5's test reads the DMMF: while `OfficePermissionDismissal` is absent — measured 2026-11-12 — it records that, and **the day the model lands it demands the tenant column** — there is no window in which the table exists and nothing checks its isolation |

**The four tests are `apps/api/src/modules/provider/decision-131-criteria.spec.ts`, each named by
its criterion number, each planted separately and each killing exactly one.** ⚠️ Criteria 4 and 5
assert the property their criterion RESTS on rather than the behaviour, because the mark is not
built as at 2026-11-12 and a test driving a mark that does not exist would pass vacuously — which reads as coverage
and is worse than no test.

## ⚠️ And one thing the notification must say, because of what §1.6 measured

Decision 131 §5: a new code guarding a formerly-open button **hides it from an office's staff until
the administrator acts**, and the notification is what solves that — by naming the screen or button.

**Measured 2026-11-12: there is no such code today, and the reason is the mechanism decision 131
removes.** Every migration that has ever added a permission — **8 of 8** — also backfilled its
grant to the roles that already held the broader code, so no button has ever closed. Decision 131
ends the backfill, so **the next such code is the first one that will actually close a button**, and
the notification's "which button" line stops being a nicety at that moment rather than later.

⟶ Which means the mapping *code → the screen or button it guards* is a prerequisite for the
notification, not an enhancement.

**And the mapping is derivable rather than something to author.**
`scripts/measurements/screen-route-permission-fit.py` does not hold a static table — it **derives**
route↔permission pairs by reading the controllers (`api_routes()`, then matching each screen's
declared `permissions: [...]`). That is the better property and the reason to read from there:
a static map would go stale the first time a decorator moved, and this one cannot.

⚠️ Its unit is a ROUTE, though, and the notification's unit is a **screen or button** — decision
131 §5 says «أيّ شاشة أو زرّ». For a code that gates a whole screen those coincide; for one that
gates a control INSIDE a screen (`diagnostics.view` hiding raw error detail on `/settings/email` is
the shipped example) they do not, and the route-derived answer would name the screen while the
thing that disappeared is a panel on it. **That gap is named here rather than papered over**, and
it is a question for the screen's own batch.

### ✅ HOW IT WAS BUILT, AND WHICH CODES FALL IN THE GAP — 2026-11-14

Neither source is readable at RUNTIME: the api image does not contain `apps/web`, and a Nest
decorator is not a route table without booting the app. So `PERMISSION_CONTROLS` is **declared** in
`new-permission-mark.config.ts` and **proven** against both sources by its spec, which re-derives
the controller's decorators and reads the nav map — the arrangement
`permission-catalogue-parity.spec.ts` already uses to stop the web fixture drifting from the seed.
Move a decorator and it fails by name; the plant that proved it named the code and the file.

It covers **exactly** the codes that carry an `introducedAt`, asserted in both directions — a code
with no date is never shown in the sentence, so an entry for it would be an unread line somebody
still has to maintain.

🔴 **AND BOTH CODES THAT CAN BE MARKED TODAY FALL IN THE GAP — neither has a screen at all.**
Measured 2026-11-14: `legal-value.read` and `legal-value.declare` appear **nowhere** in
`destinations.ts`, because module 1 built the legal-values API and `/legal-values` is not built. So
the first two marks this product shows both say a ROUTE:

| code | what the notification says |
|---|---|
| `legal-value.read` | `GET /legal-values` · `GET /legal-values/:code/history` |
| `legal-value.declare` | `POST /legal-values` |

A route is weaker than a screen name and it is the honest answer: naming a screen that is not
built would be a guess, in the one sentence an administrator reads before deciding who may do
something. **The spec fails the day either code enters the nav map**, demanding the entry gain its
screen — so this cannot silently stay the weaker answer after the screen ships.
