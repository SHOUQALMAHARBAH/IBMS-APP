# Row-Level Security — the second isolation layer

Multi-tenancy Phase 2 step 8. Companion to `ibms-system-multitenancy-spec.md` §1.

Tenant isolation here is two independent layers. This document is about the
second one, and specifically about the thing that quietly defeats it.

| Layer | Where | What breaks it |
|---|---|---|
| 1 — application | `apps/api/src/prisma/tenant-scope.extension.ts` injects `organizationId` into every query, and refuses to run one with no Organization in context | a bug in that extension |
| 2 — database | PostgreSQL RLS policies on all 118 tenant-scoped tables, keyed to `app.current_org_id` | connecting as the table **owner** |

Neither layer depends on the other. That is the point: a mistake in the
`where`-injection does not switch off RLS, and a forgotten `SET LOCAL` does not
switch off the `where`-injection.

---

## The one thing that silently defeats all of this

**PostgreSQL exempts a table's OWNER from that table's own RLS policies.**

The tables are owned by `ibms` — the role that runs migrations and the seed. If
the API connects as `ibms`, all 118 policies are still there, still correct, and
completely ineffective. Nothing errors. Nothing warns. `SELECT` just returns
every office's rows.

So the API connects as **`ibms_app`**: a role that owns nothing, holds only
`SELECT`/`INSERT`/`UPDATE`/`DELETE`, and is consequently subject to every policy.

```
DATABASE_URL      -> ibms      — migrations, seed.   NOT row-filtered (by design)
APP_DATABASE_URL  -> ibms_app  — the running API.    Row-filtered by Postgres
```

If `APP_DATABASE_URL` is unset the API still boots, but logs an error saying
layer 2 is inert. That is deliberate: a half-configured environment should be
loud, not silently single-layered.

---

## Setting it up

```bash
# 1. Create the role. Needs CREATEROLE — in CI and a fresh `docker compose`
#    stack the default `ibms` role is the cluster superuser, so this just works.
APP_DB_PASSWORD='<a real password>' npm run db:provision-app-role

# 2. Run the migrations. 20260928100000_row_level_security GRANTs to the role
#    and installs the policies. It REFUSES to run if the role is missing,
#    rather than granting into thin air.
npm run db:migrate:deploy

# 3. Point the API at it.
APP_DATABASE_URL=postgresql://ibms_app:<password>@host:5432/ibms?schema=public
```

If step 1 reports that it cannot create roles, the role it connected as lacks
`CREATEROLE`. Either point `ADMIN_DATABASE_URL` at one that has it, or do it
once by hand:

```bash
docker exec <db-container> psql -U postgres \
  -c "CREATE ROLE ibms_app LOGIN PASSWORD '<password>'"
```

---

## How a query gets its Organization

The policies read a session variable:

```sql
USING      ("organizationId" = current_setting('app.current_org_id', true))
WITH CHECK ("organizationId" = current_setting('app.current_org_id', true))
```

`current_setting(..., true)` returns `NULL` when unset, and `column = NULL` is
`NULL` — not true. **A connection that never sets it sees nothing.** RLS fails
closed on its own, so a bug that forgets to set the variable degrades to "no
rows", never to "every tenant's rows".

`WITH CHECK` mirrors `USING`, so the rule governs writes too: a row cannot be
inserted or updated into another Organization even when its id is named
explicitly.

The variable is set with `SET LOCAL`, so it lives only for the surrounding
transaction, and Postgres clears it when that transaction ends no matter how
the connection is later reused.

**It has to be transaction-scoped, and this is a correctness requirement rather
than tidiness.** A bare session-level `SET` has two failure modes on a pooled
connection, and the second one is a leak:

1. The `SET` and the query that follows it are not guaranteed to land on the
   same physical connection, so the query may run with nothing set. That is
   merely inert — RLS fails closed and returns no rows.
2. Worse: a stale value left on a reused pooled connection **from a previous
   request** can still be in effect when the next request's query runs before
   its own `SET` takes hold. That is a genuine cross-tenant read, not a
   fail-closed one.

`SET LOCAL` inside a transaction has neither problem.

---

### Decision — one transaction per query, not per request (2026-09-11)

Wrapping every individual query in its own transaction costs roughly **+4ms and
~3.7× latency on a trivial query**, measured on this codebase. Operations
already inside an explicit `$transaction` pay it once for the whole block rather
than per query.

The alternative lever is **one transaction per request**, which amortises the
cost across all the queries a request makes — but holds locks for the whole
request, and turns any mid-request failure into a full rollback.

**Decided: keep one transaction per query.** Reasons, in order:

- 4ms is imperceptible in an internal administrative system. This is back-office
  brokerage software used by staff, not a high-throughput public API.
- Transaction-per-request trades a measured, tolerable cost for an *unmeasured*
  risk — longer lock hold times — with no load data to justify it.
- Per-query keeps transaction boundaries where the code already puts them, so
  it changes no existing semantics. Per-request would.

**Do not revisit this pre-emptively.** Change it only if load testing shows the
per-query cost is a real bottleneck — and if it does, that is a deliberate
architectural decision to make with numbers in hand, not a default to slide
into.

---

## Raw SQL

Ten call sites use `$queryRaw`/`$executeRaw` — full-text search, `FOR UPDATE`
row locks, the watchlist containment query. The application layer **cannot**
filter those: it rewrites a Prisma argument object, and raw SQL has none.

They are therefore protected by RLS alone, which is exactly the guarantee spec
§1 describes. `withOrgAwareTransactions` runs them inside the same
session-variable transaction so the policies apply.

This was not theoretical. The moment the policies went live, the four full-text
search e2e tests started returning nothing — they were the only reads in the
system with no Organization pinned to them.

---

## Why authentication uses a second connection

Resolving a session id, a refresh-token hash or a login email is how the
caller's Organization gets discovered in the first place. Those reads cannot
already be scoped to it — spec §3.1's own reasoning for why bearer secrets stay
globally unique.

Layer 1 has always allowed this through the enumerated
`runUnscoped('auth-bootstrap')` bypass. Layer 2 cannot: RLS fails closed, so an
unscoped read on `ibms_app` returns nothing — which showed up as **every request
401ing** the moment the policies went live.

So the bypass also selects the connection. Inside an `auth-bootstrap` block,
queries run on the owner connection, which RLS does not constrain. Everywhere
else they run on `ibms_app` and are constrained. Both are driven by the same
closed `UnscopedReason` union, so widening one means editing the other.

**Phase 4 shrinks this.** Once `GET /orgs/resolve` resolves the Organization
from the subdomain *before* the login form (§4.10), and the JWT carries an
`organizationId` claim, the authenticated path needs no unscoped read at all —
the org is known before the first query. The bypass then narrows to genuinely
anonymous lookups: login by email, refresh, and password reset.

---

## Verifying it is actually on

```sql
-- 118 expected
SELECT count(*) FROM pg_policies WHERE schemaname = 'public';

-- must be false for the API's role
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'ibms_app';
```

And the behavioural check, which is the one that matters — as `ibms_app`, with
no session variable set:

```sql
SELECT count(*) FROM "Customer";   -- 0, not your row count
```

If that returns rows, the connection is the table owner and layer 2 is doing
nothing.

## The acceptance tests (Part V, multi-tenancy)

`apps/api/test/tenant-isolation.e2e-spec.ts` runs the Part V multi-tenancy
checklist as real tests against **two** Organizations, not one. It stands up a
second office (`00000000-0000-0000-0000-0000000000b2`), gives both offices a
customer with the *same* legal name — the case where a leak would be least
obvious — and removes the second office again afterwards.

Eight of the twelve checklist items are covered there:

| # | Item | Covered by |
|---|------|-----------|
| 1 | Neither office can reach the other's customer, including by guessing a real id | 5 tests — direct `GET` is **404 not 403** (a 403 confirms the id exists, which is itself a leak), list, search, and a write |
| 2 | RLS blocks independently of the application layer | 3 tests — an *unfiltered* query on the `ibms_app` role still returns only its own org; the owner connection sees both, which is why the API must not use it |
| 3 | Raw SQL fails closed with no `app.current_org_id` | 2 tests — zero rows, never another org's |
| 4 | `ibms_app` has no `SUPERUSER`, no `BYPASSRLS`, owns no tables | 2 tests — read off the role's own attributes, plus every table having RLS **and** a policy |
| 5 | Cross-org `INSERT` rejected by `WITH CHECK`; cross-org `UPDATE`/`DELETE` by primary key affects zero rows | 3 tests |
| 6 | A write that reports success actually wrote | the deactivation post-condition — see below |
| 9 | Two offices' negotiated commission terms are invisible to each other | 1 test |
| 12 | Audit rows are scoped to the correct Organization only | 2 tests |

The remaining four need surface area that does not exist yet, and are listed
here so they are not mistaken for gaps: a JWT rejected on another office's
subdomain (Phase 4, §4.10), `InsurerFormTemplate` sharing (Phase 3, §5),
per-tenant email sender (Phase 3, §6), and legacy bulk import (Phase 5, §7).

### Why this suite talks to Postgres directly

Items 2, 3, 4 and 5 are *about* the database layer — that RLS blocks what the
application layer would have let through. Asserting them through the API would
only prove the application layer works, which is the other layer. So those
tests open their own connection as `ibms_app`, and as the owner, and compare
what each can see.

### Two things that suite has to work around

**Signup refuses to guess once a second Organization exists.** That is the
deliberate step-7 guard in `OrganizationRepository.soleOrganizationIdOrThrow`;
Phase 4 resolves the office from the subdomain instead. So every account the
suite needs is created *before* office B is stood up, and office B is removed
at the end. It is also removed at the **start**, because a crashed run that
left it behind would break `makeUser` in every later spec file, not just this
one.

**`AuditLogEntry` cannot be deleted.** The Part 10.3 immutability trigger
rejects every `DELETE`, so the audit rows written into office B would otherwise
pin its `Organization` row forever through the foreign key. Cleanup uses
`SET LOCAL session_replication_role = replica` inside a transaction, which
suspends user triggers for that transaction only and reverts on commit. That is
the owner-role bypass the trigger's own migration comment documents as residual
risk — and worth noting: **`ibms_app` cannot do it**, because it is
`NOSUPERUSER`. The runtime role introduced in Phase 2 closes most of that
documented gap as a side effect.

## Affected-row counts on bulk writes (item 6)

The bug class item 6 exists for: RLS silently filters a legitimate same-org
`updateMany`/`deleteMany` to zero rows, the service reads "0 rows changed" as
"already in the target state", and reports success. In Phase 2 step 8 that made
an admin deactivating a user account see a 201 while the account stayed fully
active.

All 88 `updateMany`/`deleteMany` call sites in `apps/api/src` were audited.
79 already capture and act on their count. Of the nine that discarded it:

- **Four are revocations** — role assignments, refresh tokens, password-reset
  tokens, user sessions. These now **return** the count. A legitimate zero
  genuinely exists for each (a user may hold nothing to revoke), so the count
  is reported rather than asserted; what it buys is that a caller or test can
  check the post-condition instead of trusting a `void` return.
- **Five are legitimately count-blind**: three delete-then-recreate the same
  set inside one transaction (`ComparisonMatrixRow`, `InsuranceProgramLine`,
  `SlaPolicy` versioning), one clears a superseded watchlist snapshot during
  sync, one closes PI risk events. Zero is a normal, expected outcome in each,
  and asserting otherwise would fail on first use.

What actually makes the class unreachable is structural rather than per-call:
every tenant-scoped query now runs inside an RLS session pinned to the *same*
`organizationId` the application layer filtered by (`OrgContextService`'s
`scopedTransactionOrg`, which holds the org id rather than a bare "a
transaction is open" boolean). A query for a different office cannot borrow a
connection configured for this one, so a zero-row result is always a true zero.

### The "lock, then do separate work" shape

Step 8's most serious defect came from a transaction opened *only* to hold a
`FOR UPDATE` row lock, whose actual work then ran on the outer client and
inherited the "already scoped" flag. Every lock site in `apps/api/src` was
re-checked for that shape:

- `UserRepository.withRoleLocked` — the original case, fixed with
  `outsideScopedTransaction`.
- `InvoiceRepository`'s instalment lock — does all of its work **inside** the
  transaction, on `tx`, which is the correct shape and needs no change.

There are no others.
