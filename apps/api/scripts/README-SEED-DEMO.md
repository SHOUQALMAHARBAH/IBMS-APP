# Demo data seed script

Adds realistic demo data to the **DEV** database (never `.env.test`) through
the real HTTP API — the same path the frontend and the e2e suite use. Nothing
here is a shortcut around business validation: every row it creates passed
the same DTO checks, permission checks and workflow rules a real user's click
would trigger.

## What it creates

- A second Organization ("Office B") alongside the default one.
- 8 login accounts per Organization (one per RBAC role needed below).
- A shared pool of insurers, with a commercial relationship per office.
- Employee HR records.
- Leads at every funnel stage (some fully converted to customers, some
  stopped partway — a real pipeline never converts 100%).
- Customers (individual + corporate).
- For a subset of customers, the FULL sales-to-active-policy chain: risk
  profile, needs assessment, insurance program, opportunity, RFQ, quotation,
  comparison, recommendation, client decision, and a policy taken all the way
  to ACTIVE (placed, issued, checked by a different officer, delivered,
  acknowledged) — then an invoice and/or a claim on top of it.
- A handful of complaints, incidents and vendors.

## Before running it — once

The DEV database needs its base seed and RBAC data already in place, and the
`ibms_app` Postgres role's password needs to match `.env`'s
`APP_DATABASE_URL`. Both are almost certainly already true if you've been
running the app locally, but if the script's preflight check stops with
"Default organization not found" or "No RBAC permissions found", run:

```
npm run db:seed
```

from the repo root first (this is the ordinary reference-data seed, safe and
idempotent — it will not touch or duplicate anything if already run).

## Running it

From `apps/api/`:

```
npm run seed:demo
```

**It has now been run end-to-end** against the dev database: a full-scale run
completed in ~3.5 minutes with **1,292 rows and zero failed attempts**, and all
30 pipeline policies reached `ACTIVE`. Five defects found on the way are fixed
(see *Fixed after first execution* at the end).

**Still smoke-test small first** whenever you change the script or the DTOs it
calls — it is much faster to read 200 rows of output than 1,300:

```
DEMO_EMPLOYEES_PER_ORG=2 DEMO_CUSTOMERS_PER_ORG=5 DEMO_LEADS_PER_ORG=4 DEMO_FULL_PIPELINE_PER_ORG=2 DEMO_COMPLAINTS_PER_ORG=1 DEMO_INCIDENTS_PER_ORG=1 DEMO_VENDORS_PER_ORG=1 npm run seed:demo
```

(PowerShell doesn't support that inline `VAR=value cmd` syntax — set them
first instead:)

```powershell
$env:DEMO_EMPLOYEES_PER_ORG="2"
$env:DEMO_CUSTOMERS_PER_ORG="5"
$env:DEMO_LEADS_PER_ORG="4"
$env:DEMO_FULL_PIPELINE_PER_ORG="2"
$env:DEMO_COMPLAINTS_PER_ORG="1"
$env:DEMO_INCIDENTS_PER_ORG="1"
$env:DEMO_VENDORS_PER_ORG="1"
npm run seed:demo
```

Watch the console output. It prints progress per stage and, at the end, a
summary with the count of rows created vs. failed attempts, plus the first 20
error messages if anything failed. A full JSON report (every login the
script created, exact counts, every error) is written to
`apps/api/scripts/seed-demo-report.json`.

**If the smoke test looks clean**, clear the env vars (`Remove-Item Env:DEMO_*`
in PowerShell, or just open a fresh terminal) and run `npm run seed:demo`
again for the full default scale (~500 customers, 20 employees, 30 full
policies, across both offices — expect this to take several minutes, it is
several hundred real HTTP + Postgres round trips, not a bulk insert).

**If something fails partway**, it is safe to just run `npm run seed:demo`
again — every unique field (emails, national IDs, policy numbers, ...) is
randomized per run, so a re-run adds more data rather than colliding with
what's already there. The 8 actor accounts per office are the one exception:
they're looked up by a fixed email and reused, so credentials stay stable
across runs.

## Logging in to see it

**MFA on first sign-in.** The script leaves every demo account with MFA
switched OFF, so you sign in with the password alone. The app will then refuse
every screen until you enrol an authenticator — that is Part II §4.3.2's forced
enrolment working as designed, not a fault. Go to **Settings → Security**,
scan the QR with any TOTP app, and enter one code; after that the account works
normally. (`/auth/me` and the two enrolment endpoints are the only routes
reachable before you do, which is what makes this possible.)

Do NOT leave an account with MFA enabled but no authenticator paired — it
locks the account out permanently, because the TOTP secret the script
generated for its own API calls is never shown to anyone.

**This went wrong once, and the guardrails below exist because of it.** The
first full run finished about an hour before `releaseActorsForHumanLogin` was
written, so all sixteen accounts were handed back enrolled and unusable while
the report read `0 failures`. Three things now make that hard to repeat:

- The release runs **after the whole seed**, not at the end of each office's
  happy path. An actor is locked from the moment its enrolment returns, so
  every line between there and the release is a window in which one throw
  strands eight real accounts — and an office-level failure is caught and
  logged as a single line, which would never read "and nobody can sign in".
- It finds the accounts **by email**, not from the in-memory actor map. That
  map holds only actors whose whole create-login-enrol attempt succeeded, and
  enrolment is two HTTP calls: an actor that enrolled and then failed to
  verify owns a credential the map never recorded.
- The run **ends by re-reading the database** and fails, naming names, if any
  demo account is still `mfaEnabled` or still owns a credential. Without that
  the damage is silent, which is exactly how it shipped.

The report (and the console output) lists one login per RBAC role per
office, all sharing the password `DemoPass#2026!` — for example
`demo.sales@office-a.ibms.internal` / `demo.placement@office-a.ibms.internal`
/ `demo.manager@office-b.ibms.internal`, etc. Log in as whichever role's
screens you want to demo; a Sales officer's login will show the leads,
prospects and customers it created, a Placement officer's the
opportunities/RFQs/policies, and so on.

## Verifying tenant isolation

Log in as an Office A actor and an Office B actor (two different browser
profiles / incognito windows, since sessions are cookie/token based) and
confirm neither can see the other's customers, policies, etc. — this is the
same check `apps/api/test/tenant-isolation.e2e-spec.ts` already automates,
just eyeballed through the UI this time.

## Scope note

This intentionally does not touch every one of the ~185 database models —
KYC document capture/UBOs, the claims assessment/settlement stages beyond
registration, and several back-office modules (BCP/DR plans, information
assets, internal audit findings, DSR/consent records, and others) are not
seeded. What's here covers the primary sales → policy → claims/finance
journey plus HR, leads and back-office basics, which is what most of the
frontend's dashboards and list screens read from.

## Fixed after first execution

Found by actually running it; recorded so the same mistakes are recognisable
if the script is extended:

1. **Every call 403'd `MFA_REQUIRED`.** `MfaRequiredGuard` is a global
   `APP_GUARD` that rejects any request whose user has `mfaEnabled = false` —
   for *every* role, not just the three always-MFA ones. But login returns an
   MFA *challenge* instead of a session when `mfaEnabled = true`. There is
   therefore no single value that works: the account must log in without MFA
   and enrol over that session, which is what every e2e spec's `makeUser` does.
2. **Demo accounts were left locked out.** Consequence of the fix above: the
   enrolment secret is generated in-process and discarded, so MFA is now
   switched back off at the end of the run. The first version of that release
   was written after the full run had already happened and was never applied
   to it — see "MFA on first sign-in" above for what that cost and what now
   prevents it.
3. **~1 pipeline in 3 died at the RFQ.** The line was picked from the
   *insurer's* list, but an RFQ's `insuranceLine` is validated against the
   lines the Opportunity's Insurance Programme designed — which come from the
   randomised needs assessment. Now picked from the intersection.
4. **`'Property All Risks (Fire)'` is not a coverage line.** The canonical set
   is `COVERAGE_LINES` in `insurance-program.config.ts`; a near-miss name is a
   line that does not exist, and every RFQ naming it 422s.
5. **Every claim 422'd.** Policies incepted in the *future* while losses were
   dated in the *past*, so no loss could fall inside cover. Inception is now
   back-dated and the loss date derived from it.
6. **Re-runs 409'd on employees.** The actor→Employee link is one-to-one, so
   the second run tried to re-link accounts that were already linked. Now it
   only links actors that are not linked yet.

`SCHEDULED_JOBS=disabled` is also set by the script itself before the app
boots: `.env` (unlike `.env.test`) does not carry it, so all 19 cron jobs would
otherwise register and fire mid-run — including a real multi-megabyte sanctions
download and the 4-hourly re-screen batch running over customers the script is
still creating.
