# ibms-app

Engineering codebase for **IBMS** (Insurance Brokerage Management System). This is the
first engineering repo for the IBMS build program — a standards-taker from the
`ibms-brain` repo (rules in `meta/lex/`, domain knowledge in `meta/context/`,
architecture decisions in `meta/designs/`), pulled in here as a git submodule at
`ibms-brain/` so both a human and an agent working in this repo actually have it, not
just a note saying to go read it elsewhere. This repo does not restate those rules; it
implements against them. Compliance/PDPL/CBJ obligations still cite the source document
in `ibms-brain/`, not this README.

**Status:** infrastructure scaffold only. No business features (policy, claims, CRM, …)
are implemented yet — see `meta/context/data-model.md` in ibms-brain for the logical
data model this will eventually be built against.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router) + TypeScript |
| Backend | NestJS + TypeScript |
| Frontend/backend unit tests | Vitest + Testing Library |
| E2E / accessibility | Playwright + axe-core |
| Database | PostgreSQL + Prisma (`6.19.3` — see note below) |
| Monorepo | npm workspaces + Turborepo |
| Containers | Docker (multi-stage, `turbo prune`-based) |
| CI | GitHub Actions |
| Preview deploys | Vercel (web app only) |
| Production deployment target | **TBD** — not decided yet, do not assume one |

**Why Prisma 6, not 7:** Prisma 7 requires Node ≥20.19/22.12/24 and mandates a driver
adapter (`@prisma/adapter-pg`) plus a `prisma.config.ts`. Node here is pinned at `20.19.0`
(see `.nvmrc`) — high enough to satisfy tooling engine requirements (e.g.
`typescript-eslint`), but Prisma itself stays pinned at `6.19.3` in `package.json`
deliberately: Node ≥20.19 makes Prisma 7 *installable*, not required. Don't bump the
`prisma`/`@prisma/client` versions past 6.x without doing the driver-adapter + config
migration first. Revisit deliberately when the team moves to Node 22 LTS.

## Layout

```
ibms-app/
  apps/
    web/                Next.js frontend (port 3000)
      app/              Routes (App Router)
      components/       Shared/presentational UI components
      features/         Feature-scoped UI + client logic
      lib/              Client-side utilities, API client, helpers
    api/                NestJS backend (port 4000)
      src/
        modules/         Feature modules (each wires its own controller/service)
        controllers/      Route handlers not yet owned by a feature module
        services/         Business logic not yet owned by a feature module
        repositories/     Data-access layer (wraps @ibms/db)
        middleware/       Cross-cutting request handling (auth, logging, ...)
  packages/
    db/              Shared Prisma schema + generated client (@ibms/db)
  ibms-brain/         Standards/rules/context — git submodule, not this repo's code
  docker-compose.yml Postgres + api + web for local/integration use
  turbo.json         Task graph (build/lint/typecheck/test/e2e)
  .github/workflows/ CI
```

`components/`, `features/`, `lib/` (web) and `modules/`, `controllers/`, `services/`,
`repositories/`, `middleware/` (api) are currently empty scaffolding — no business
features exist yet (see Status above). They establish where feature work lands once it
starts, per `meta/context/policy-lifecycle.md` and `meta/context/claims-lifecycle.md` in
`ibms-brain`.

## Prerequisites

- Node `20.19.0` (`nvm use`, or match `.nvmrc`)
- Docker (for Postgres locally, and for building the app images)

## Getting started

```bash
# Clone with the ibms-brain submodule included:
git clone --recurse-submodules https://github.com/SHOUQALMAHARBAH/IBMS-APP.git
# already cloned without it?
git submodule update --init --recursive

cp .env.example .env
npm install

# Postgres only, for local (non-Docker) app dev:
docker compose up -d db
npm run db:migrate:dev
npm run db:seed   # 11 roles + full permission grid — RBAC needs these to exist

# Everything else, run natively:
npm run dev
```

### Dev DB vs. test DB

Two separate local Postgres instances, never the same database:

- **`db`** (dev) — `docker compose up -d db`, driven by `.env`. Only changes when you
  explicitly run a migrate command against it. This is the database `npm run dev` talks to.
- **`db-test`** — `docker compose up -d db-test`, driven by `.env.test` (copy from
  `.env.test.example`). Everything exploratory happens here first: schema changes and
  `npm run test:e2e` run against this database, never against `db`.

```bash
cp .env.test.example .env.test
docker compose up -d db-test

# Iterate on a schema change and run the integration suite against db-test:
npm run db:test:migrate:dev
npm run db:test:seed
npm run test:e2e

# Once you're satisfied, promote the same migration files to the dev DB:
npm run db:migrate:deploy
```

`db:test:migrate:dev` and `db:migrate:deploy` apply the same migration files under
`packages/db/prisma/migrations/` to different databases — nothing is copied or
regenerated between them, only re-applied. CI (`.github/workflows/ci.yml`) does the
equivalent against its own ephemeral `ibms_test` container, which is destroyed with the
runner at the end of the job — it never touches either local database.

- `web` → http://localhost:3000
- `api` → http://localhost:4000 (`/health` liveness, `/health/db` readiness)

Next.js reads `NEXT_PUBLIC_*` vars from its own env file for local (non-Docker) dev —
also copy the relevant lines into `apps/web/.env.local` if you're not using
`docker compose` for the whole stack.

### Run the whole stack in Docker

```bash
docker compose up --build
```

## `ibms-brain` submodule

`ibms-brain/` is a git submodule, pinned to a specific commit of
[SHOUQALMAHARBAH/IBM-System](https://github.com/SHOUQALMAHARBAH/IBM-System) — it does
not auto-track that repo's `main`. Claude Code (or any agent) working in this repo reads
it automatically via the `@ibms-brain/CLAUDE.md` import at the top of this repo's own
`CLAUDE.md`. To pull in newer brain rules:

```bash
cd ibms-brain && git pull origin main && cd ..
git add ibms-brain && git commit -m "ibms-brain: sync to latest"
```

### `.claude/` — agents, commands, hooks

Claude Code only discovers `.claude/agents/`, `.claude/commands/`, and `.claude/settings.json`
at a session's own project root — not inside a nested git submodule — so this repo carries
its own `.claude/` rather than relying on `ibms-brain/.claude/`:

- `.claude/agents/{code-reviewer,software-developer}.md`, `.claude/commands/brain-gap.md` —
  mirrored from `ibms-brain/.claude/{agents,commands}/` by
  `.claude/hooks/mirror-brain-agents.sh` (a `PostToolUse` hook on Write/Edit). Don't hand-edit
  these files — the hook overwrites drift on the next Write/Edit.
- `.claude/settings.json` wires two of `ibms-brain`'s `PreToolUse` hooks directly against the
  submodule path (`enforce-credential-safety.sh`, `enforce-workspace-updates.sh`).
  `enforce-evidence.sh` (the `git push` evidence gate) is deliberately **not** wired yet —
  `scripts/verify.sh` doesn't write `artifacts/<sha>/gates.json`, so turning that hook on
  today would block every push with no way to satisfy it. The domain-code hooks
  (`enforce-money-decimal.sh`, `enforce-state-transitions.sh`, `enforce-sensitive-data.sh`)
  are also not wired — moot until real domain code lands (see `CLAUDE.md`).
- **Known gap:** both wired hooks parse the tool-call JSON via `python3`. On a machine where
  `python3` resolves to a stub (e.g. the Windows Store alias, with a real interpreter only at
  `python`), they silently no-op instead of blocking — verified during setup. This is a
  pre-existing issue in `ibms-brain`'s hook scripts, not something this repo can fix on its
  own.

## Scripts (run from repo root; Turborepo fans them out per workspace)

| Command | Does |
|---|---|
| `npm run dev` | `next dev` + `nest start --watch`, in parallel |
| `npm run build` | Production build of every workspace (`@ibms/db` generates the Prisma client first) |
| `npm run lint` | ESLint, per workspace |
| `npm run typecheck` | `tsc --noEmit`, per workspace |
| `npm run test` | Vitest unit tests (web + api) |
| `npm run test:e2e` | API integration tests (Vitest + Supertest) — needs a reachable `DATABASE_URL` |
| `npm run test:contract` | API contract tests — validates real responses against the OpenAPI schema generated from `@nestjs/swagger` decorators (`apps/api/test/contract.contract-spec.ts`) — needs a reachable `DATABASE_URL` |
| `npm run test:security` | Dependency audit (`npm audit --audit-level=high`), repo-wide |
| `npm run test:smoke` | `bash scripts/smoke.sh api` — dispatches to the api service's smoke test (see below) |
| `npm run e2e` | Playwright functional e2e (web) — excludes `@a11y`-tagged specs |
| `npm run test:a11y` | Playwright + axe-core accessibility checks (web) — only `@a11y`-tagged specs |
| `npm run db:validate` | `prisma validate` — schema is internally valid (not a drift check; that's `db:migrate:status`) |
| `npm run db:migrate:dev` | Create/apply a migration against the dev DB (`packages/db`) |
| `npm run db:migrate:deploy` | Apply existing migrations to the dev DB, no schema drift (also used for CI/prod) |
| `npm run db:migrate:status` | Check dev DB migration history against `schema.prisma` for drift |
| `npm run db:test:migrate:dev` | Create/apply a migration against `db-test` — where schema iteration happens |
| `npm run db:test:migrate:deploy` | Apply existing migrations to `db-test`, no schema drift |
| `npm run db:test:migrate:status` | Check `db-test` migration history against `schema.prisma` for drift |
| `npm run db:studio` | Prisma Studio (dev DB) |
| `npm run db:seed` | Seed the dev DB — the 11 roles + full permission grid (`packages/db/prisma/seed.ts`), idempotent |
| `npm run db:test:seed` | Same seed, against `db-test` |

## `scripts/`

- **`scripts/smoke.sh <service>`** — dispatches to a single backend service's smoke
  test. Today that's just `api` (`bash scripts/smoke.sh api`), which boots the real
  service via `npm run start` and calls `/health` and `/health/db` — proving it can
  reach Postgres, not just that the process started. Add a `case` for a second service
  the day one exists; see `apps/api/scripts/smoke.sh` for what a real per-service smoke
  test looks like.
- **`scripts/verify.sh`** — runs every gate in `ibms-brain/meta/context/verification-contract.md`
  § Backend/frontend gate commands against `db-test` and prints each gate's real evidence
  (exit code, and a test count where the tool reports one), ending in a summary block.
  Precondition: `.env.test` exists (`cp .env.test.example .env.test`) and `db-test` has
  been migrated at least once (`npm run db:test:migrate:dev`). Run it before opening a PR
  to get the evidence block for the PR description in one shot — claims aren't evidence,
  this is.
- **`scripts/backup-restore-drill.sh`** (A.10, Part 10.4/10.5) — dumps a database
  (`db-test` by default — never dev/prod automatically), encrypts the dump
  (AES-256-CBC), decrypts and restores it into a throwaway database, verifies the
  restored row count matches the original, and fails if the whole cycle exceeds the RTO
  target (`RTO_TARGET_SECONDS`, default 900s). Requires `BACKUP_ENCRYPTION_KEY` in the
  environment. `npm run db:backup:drill` runs it. See
  `ibms-brain/meta/lex/backup-rpo-rto.md` for the RPO/RTO targets this is testing.

## CI

`.github/workflows/ci.yml`, three jobs, plus two standalone workflows:

1. **frontend** — installs, then: typecheck → lint → unit/component tests (Vitest +
   Testing Library) → installs Playwright's Chromium → accessibility (`test:a11y`,
   axe-core, `@a11y`-tagged specs, evidence is 0 serious/critical violations) → e2e
   (`e2e`, functional Playwright flows) → build. Uploads the Playwright HTML report as an
   artifact on every run (including failures).
2. **backend** — installs, then: typecheck → lint → unit tests → security (`test:security`
   — dependency audit) → spins up an ephemeral `postgres:18-alpine` service container
   (database `ibms_test`, ports/network scoped to the job — distinct from both local
   `db` and `db-test`, and destroyed with the runner when the job ends) → database schema
   (`db:validate` — `prisma validate`, schema is internally valid) → migrate deploy →
   schema-drift check (`db:migrate:status`, fails on drift) → integration tests
   (`test:e2e`) → contract tests (`test:contract`, OpenAPI-validated responses) → smoke
   tests (`bash scripts/smoke.sh api` — boots the real service and hits `/health` +
   `/health/db`) → build → boots the built service again and runs an OWASP ZAP baseline
   scan against it (DAST, A.10/Part 10.4-10.5) — passive-only, informational
   (`fail_action: false`) for now, see § Known gaps, A.10.
3. **docker** — builds (does not push) the `api` and `web` images, to catch Dockerfile
   regressions. No registry/push step exists yet — the production deployment target is
   still TBD, so there's nowhere authorized to push to.

**`.github/workflows/codeql.yml`** (A.10, SAST) — GitHub CodeQL static analysis over
`apps/web`/`apps/api` TypeScript source, on every push/PR to `main` plus a weekly
schedule (catches a newly-published query matching old code no PR touched). Separate
from `test:security` in the backend job above, which is SCA (known-CVE dependency
scanning), not SAST (this repo's own code).

**`.github/workflows/backup-drill.yml`** (A.10, Part 10.4/10.5) — runs
`scripts/backup-restore-drill.sh` against `db-test` weekly and on manual dispatch.
Needs a `BACKUP_DRILL_ENCRYPTION_KEY` repository secret to run — see
`ibms-brain/meta/lex/backup-rpo-rto.md`.

### First end-to-end verification

Confirmed 2026-08-25 via `chore/initial-ci`, the repo's first real PR: every gate above
runs and passes on a clean diff, and a deliberately broken unit test correctly blocks
the PR (red ❌) until reverted. This is what makes `definition-of-done.md` mechanically
enforced rather than documentation.

## Vercel preview

Not yet connected to a live Vercel project. To wire it up: create a Vercel project from
this repo with **Root Directory = `apps/web`** — `apps/web/vercel.json` already tells
Vercel to install and build from the monorepo root via Turborepo. Set
`NEXT_PUBLIC_API_URL` in the Vercel project's environment variables to wherever the API
is reachable from that preview (there is no hosted API yet, so this is a placeholder
until one exists). The `ibms-brain` submodule isn't needed for the build (it's not an
npm workspace member) and both repos are public, so no submodule-auth setup is required.

## Security — encryption & key management (Part 10.2)

Field-level encryption, TLS enforcement, and key management live in
`apps/api/src/modules/security/` (`EncryptionService`, `KeyRegistryService`,
`encrypted-fields.ts`). Design rationale:
`ibms-brain/meta/designs/2026-08-a3-encryption-key-management.md`.

- **Field-level encryption.** Every `-- ENCRYPT` schema field
  (`Customer.nationalIdEnc/contactPhoneEnc/contactEmailEnc`,
  `UltimateBeneficialOwner.nationalIdEnc`, `InsuredPerson.nationalIdEnc`,
  `Employee.nationalIdEnc`, `ThirdPartyClaimant.contactDetailsEnc`) is covered by
  `encryptEntityFields`/`decryptEntityFields` in `encrypted-fields.ts`, AES-256-GCM via
  `EncryptionService`. `MfaCredential.secretEnc`/`webauthnPublicKeyEnc` keep their own,
  separate encryption path (`apps/api/src/common/crypto.util.ts`,
  `MFA_ENCRYPTION_KEY`) — a deliberate second key pool, not an oversight; see the design
  doc.
- **Key management.** `PII_ENCRYPTION_KEYS` (`keyId:base64key,...`) and
  `PII_ENCRYPTION_ACTIVE_KEY_ID` — see `.env.example` for the exact format and a
  rotation walkthrough. `GET /security/encryption-keys` (SYSTEM_SECURITY_ADMINISTRATOR
  only — the key-custodian role) returns key ids and active/retired status, never key
  material. Every encrypt/decrypt call writes an `AuditLogEntry`
  (`AuditAction.ENCRYPTION_KEY_USED`) recording which key/field/operation was used —
  never the plaintext or ciphertext.
- **TLS.** `securityHeaders()` middleware (`apps/api/src/common/`) sets HSTS and rejects
  any request that didn't arrive over HTTPS; `main.ts` refuses to boot if
  `DATABASE_URL` lacks `sslmode=require`/`verify-ca`/`verify-full`. Both gate on
  `NODE_ENV=production` only — local dev and CI have no TLS termination in front of
  them.
- **Encryption at rest (database + document store).** Not yet configurable — this repo
  has no chosen deployment platform (see § Deployment below) and no document-upload
  service behind `Document.storageRef` yet. Tracked as a deferred requirement in the
  design doc above: whichever managed Postgres/object-store this project deploys to
  must have encryption at rest enabled as part of that provisioning decision.

## Data masking, secure sharing & environment separation (Part 10.4-10.6)

- **Masking + justified drill-down.** `maskTrailing()` (`apps/api/src/common/masking.util.ts`)
  produces a last-4-visible masked string for list-view display.
  `SensitiveFieldRevealService` (`apps/api/src/modules/security/`) wraps that together
  with `EncryptionService.decrypt()` and a required, audited justification (`READ`
  `AuditLogEntry`, `isSensitiveDataAccess: true`, reason recorded — never the plaintext)
  — the only sanctioned way to get a real (unmasked) value back.
- **Secure data-sharing channel.** `DataSharingApproval.classification`/`channel`
  (new columns, migration `20260826140000_...`) plus `assertSecureChannel()`
  (`apps/api/src/modules/security/secure-channel.util.ts`) reject a CONFIDENTIAL/
  HIGHLY_CONFIDENTIAL share picked over `UNENCRYPTED_EMAIL`/`POSTAL_MAIL`/
  `OTHER_UNSECURED`.
- **Watermarking + export/print restriction.** `assertExportAllowed()`/
  `buildWatermarkText()` (`apps/api/src/modules/security/document-export.util.ts`)
  enforce that a HIGHLY_CONFIDENTIAL `Document` export/print carries a watermark, using
  the existing `AuditAction.EXPORT`/`PRINT` values.
- **Privacy-by-default forms.** `assertNoPresetSensitiveDefaults()`
  (`apps/web/lib/forms/privacy-by-default.ts`) throws if a form's initial values
  pre-populate a listed sensitive field.
- **Non-production data.** `synthesizeEntityFields()`/`synthesizeSensitiveValue()`
  (`apps/api/src/modules/security/synthetic-data.util.ts`) replace `-- ENCRYPT` field
  values with same-shape random data, for seeding Dev/Test/UAT without real PII.
  `.env.uat.example` + docker-compose's `db-uat` service give UAT its own local
  database, separate from `db`/`db-test`.

## Known gaps (per completed backlog item)

This repo's backlog (A.x/B.x/C.x task IDs) lives outside this repo, so this list only
tracks what's genuinely incomplete **within an item that has actually been built** — not
a project-wide roadmap. Updated in the same change that closes or narrows a gap.

**A.1 — Authentication & Session Management (Part 10.1)**

- **Hardware-token MFA (WebAuthn) is not implemented — and Part 10.1's requirement that
  privileged roles (SYSTEM_SECURITY_ADMINISTRATOR, EXECUTIVE_MANAGEMENT,
  BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER) use a hardware
  token is currently unenforced as a result.** `MfaCredentialType.WEBAUTHN` is
  schema-reserved only; `AuthService.mfaPolicySatisfied()` computes
  `requiresHardwareToken(roles)` but only uses it to surface a frontend banner, never to
  block login — a privileged user with TOTP-only MFA logs in normally today. This is the
  most compliance-significant gap in what's built so far.
- No email/notification provider exists, so `POST /auth/forgot-password` cannot deliver
  a real reset link in any deployed environment. `ENABLE_DEV_RESET_TOKEN` returns the raw
  token in the response body instead, hard-blocked by `NODE_ENV=production` regardless of
  the flag — a dev/e2e-only workaround, not a substitute for a real provider.
- SSO has no identity provider wired — `POST /auth/sso/:provider/callback` returns 501 by
  design (`SsoController`); `SsoProviderStrategy` is a strategy interface with nothing
  implementing it yet, since no broker-specific IdP (SAML/OIDC/Azure AD/Okta) has been
  chosen. This one is a correctly-built stub, not an oversight — Part 10.1 marks SSO
  "optional per broker."
- `RequireStepUp` (recent-reauthentication gate for refund approval/data export/disposal,
  Part 10.1) exists as a decorator + guard but is not applied to any route — there is no
  business endpoint yet for it to protect. Same "built ahead of the consumer" pattern as
  the RBAC permission grid and the field-encryption service.
- Minor: `auth.types.ts`'s `requiresHardwareToken` doc comment points to "the auth module
  README" — no such file exists in this repo (`apps/api/src/modules/auth/` has no
  `README.md`). Dangling reference, not a functional gap.

**A.2 — Roles & Permissions / access recertification**

- Instance-level maker≠checker self-check (e.g. one user placing *and* checking the
  *same* policy) is backlog item A.5 (`assertDifferentActors`) — its own call site here
  (`AccessRecertificationService.decide()`) now uses it. A.2 only enforces the
  role-permission-grid level.
- `AccessRecertificationItem` has no per-`UserRoleAssignment` foreign key — one item is
  generated per *user* holding any active role, not per role grant, so a "revoked"
  decision revokes all of that user's active roles, not one.
- Reviewer-pool assignment always picks the first eligible (≠ subject) member of the
  COMPLIANCE_OFFICER/BRANCH_DEPARTMENT_MANAGER/EXECUTIVE_MANAGEMENT pool, not
  round-robin — acceptable for now since there's no manager-hierarchy field on
  `User`/`Employee` yet.
- `startCycle` skips (logs a warning on) a subject with no eligible reviewer rather than
  blocking the whole cycle.

**A.3 — Encryption & Key Management (Part 10.2)**

- Encryption at rest for the database and document store is not configured — no
  deployment platform is chosen yet and no document-upload service exists behind
  `Document.storageRef`. See § Security above.
- No automated re-encryption sweep on key rotation — an operator must re-encrypt
  existing rows by hand before retiring an old key id. Deferred until real production
  data and a real rotation event exist to size the sweep against.
- Key material is env-var-backed, not a real KMS/HSM (AWS KMS, Azure Key Vault, Vault) —
  `KeyRegistryService`'s interface is deliberately shaped so swapping in a real KMS
  client later is a contained change, not a redesign.
- `encryptEntityFields`/`decryptEntityFields` are not wired into any repository yet —
  `Customer`/`UltimateBeneficialOwner`/`InsuredPerson`/`Employee`/`ThirdPartyClaimant`
  have no CRUD module (Part C business modules aren't built). The encryption is ready;
  nothing calls it yet.
- TLS enforcement covers client-server traffic and the database connection only —
  there's no third-party/server-to-server HTTP client (Insurer/vendor integration) in
  the codebase yet to enforce TLS on.
- `MfaCredential` encryption (`crypto.util.ts`) remains a separate, unrotated key pool
  from the new PII registry — a deliberate isolation choice, not an oversight; see the
  design doc's Alternatives table.

**A.4 — Immutable Audit Trail (Part 10.3)**

- Write-on-every-action (`AuditService.record()`), the DB-level immutability trigger
  (`packages/db/prisma/migrations/20260826083942_add_audit_log_entry_immutability_trigger/`),
  and anomaly detection (bulk export / off-hours / repeated access,
  `AuditAnomalyDetectionService`) are all real and e2e-verified — Postgres itself rejects
  `UPDATE`/`DELETE` on `AuditLogEntry`, not just an app-layer convention.
- **Not yet done: READ access to Highly Confidential data is not actually logged.** The
  mechanism exists (`AuditAction.READ`, `AuditLogEntry.isSensitiveDataAccess`, and
  `AuditAnomalyDetectionService` keys its "repeated unjustified access" pattern off it),
  but no code path in the app calls `audit.record({ action: 'READ', ... })` for a real
  business-entity read today — only test fixtures use it. The only live producer of
  `isSensitiveDataAccess: true` is `EncryptionService.decrypt()`, logged as
  `ENCRYPTION_KEY_USED`, not `READ`. Same root cause as A.5's gap (no Part C business
  modules — the entities that would actually be read — exist yet); call `audit.record()`
  with `action: 'READ'` from each entity's read path as its service layer is built.
- `AuditService`'s retention-cutoff lookup (`getRetentionCutoffDate`) depends on a
  `RetentionScheduleItem` seed row for `"AuditLogEntry"` — a fresh dev DB without
  `npm run db:seed` logs a warning and falls back rather than failing, but the log
  retention SLA isn't actually enforced until that seed exists.

**A.5 — Maker/Checker Rule enforced, not just documented (Part 5.2)**

- `assertDifferentActors(makerId, checkerId, context)` (`apps/api/src/common/`) is the
  shared application-layer guard; a `CHECK` constraint per table
  (`packages/db/prisma/migrations/20260826091424_add_maker_checker_check_constraints/`)
  is the DB-layer backstop, covering all 9 entities in the Part 5.2 table
  (`KYCRecord`, `PolicyChecking`, `Refund`, `DisposalBatch`, `DataSharingApproval`,
  `DataProcessingAgreement`, `Settlement`, `CommissionLedgerEntry`, `Recommendation`)
  plus `AccessRecertificationItem`.
- Only one of those 10 has a real call site today —
  `AccessRecertificationService.decide()` calls `assertDifferentActors()` before
  recording a reviewer decision. The other 9 have no repository/service layer yet (Part
  C business modules aren't built — see `CLAUDE.md`), so the helper isn't wired into an
  approval write-path for them; the DB `CHECK` constraint is what actually enforces the
  invariant for those tables today. Wire `assertDifferentActors()` into each one's
  approve/check/DPO-approve write path as its service layer is built.
- `DataProcessingAgreement.assessedByUserId` and
  `CommissionLedgerEntry.overrideRequestedByUserId` are new maker-side columns added to
  give those two entities' pre-existing checker fields something to be checked against
  — neither previously had a maker field in the schema. Both are nullable, so — same as
  `Settlement`/`CommissionLedgerEntry`'s existing approver pairs — a row can reach a
  checked state with no maker recorded at all; the `CHECK` constraint only rejects an
  actual maker==checker match, it doesn't require both to be populated.

**A.6 — Workflow Transition Engine (Part 2 "Workflow & Notifications")**

- `WorkflowTransitionService.transition()` (`apps/api/src/modules/workflow/`) and the
  `WORKFLOW_TRANSITIONS` map covering all 11 workflow status enums are built and
  unit-tested, but nothing calls `transition()` yet — same root cause as A.5's gap: no
  Part C business modules (`PolicyService`, `ClaimService`, etc.) exist to call it from.
  Wire each one's status-changing write path through `transition()` as it's built.
- Two entities' transition maps (`RFQInsurer`, `Invoice`) are inferred from schema field
  semantics rather than transcribed from an explicit lifecycle document — flagged inline
  in `workflow-transitions.config.ts`, candidates for a `/brain-gap` confirmation.
- The `sideEffect` extension point (for a linked SLA timer/notification/recompute) has no
  registered consumer yet — no timer/notification service exists in this repo.

**A.7 — Fils-Precision Money Arithmetic (Part 3.6 Controls)**

- `money.util.ts` (`apps/api/src/common/`) fixes `Decimal(18,3)` + `ROUND_HALF_UP` as the
  only sanctioned way to add/subtract/apply a percentage to a JOD amount, and
  `money-fields.inventory.ts` classifies all 54 `Decimal` fields in `schema.prisma` as
  money vs. rate/ratio, self-checked against the live schema. Both are unit-tested, but —
  same root cause as A.6 — nothing in the codebase actually calls these helpers yet, since
  no service layer does premium/commission/claim arithmetic. Any future service touching a
  `MONEY_DECIMAL_FIELDS` entry must go through this helper, never a raw `Prisma.Decimal`
  method call or a JS `number`.
  `CommissionLedgerEntry.overrideRequestedByUserId` are new maker-side columns added to
  give those two entities' pre-existing checker fields something to be checked against
  — neither previously had a maker field in the schema. Both are nullable, so — same as
  `Settlement`/`CommissionLedgerEntry`'s existing approver pairs — a row can reach a
  checked state with no maker recorded at all; the `CHECK` constraint only rejects an
  actual maker==checker match, it doesn't require both to be populated.

**A.8 — SLA Timers & Automated Escalation (Part 6.2, 7, 3.x)**

- `SlaTimerService` + `SlaTimerScheduler` (`apps/api/src/modules/sla/`) are the generic,
  polymorphic engine `ibms-brain/meta/lex/pdpl-sla-timers.md` asks for, backing the
  `SlaTimer` model that's been in the schema since the initial domain-model migration.
  `SLA_REGISTRY` (`sla-registry.config.ts`) is the machine-readable registry that lex file
  itself calls for ("this table should be generated from it, not maintained by hand in two
  places") — one entry per each of its 14 SLA types, self-checked for completeness in
  `sla-registry.config.spec.ts`. A `*/15 * * * *` cron sweep escalates any overdue,
  unresolved timer and writes a new `SLA_ESCALATED` audit action.
- **One `SlaTimer` row per escalation stage, not per workflow** — a row is one deadline
  plus the one target it escalates to; a multi-stage workflow (only the two DSR types:
  an early T-3-business-day DPO warning, then a General-Manager escalation at the SLA
  due date itself) gets one row per stage, distinguished by a `::`-suffixed
  `workflowName`, to avoid another schema migration for a stage column.
- `business-days.util.ts` (`apps/api/src/common/`) is a new shared Friday/Saturday
  (Jordan's real weekend, not Saturday/Sunday) business-day calculator — no gazetted
  public-holiday calendar exists yet (same gap as A.6's retention-period table), so a
  computed business-day deadline is a lower bound, not an exact one.
- **One real call site**: `AccessRecertificationService.startCycle()` now starts a
  `quarterly_access_review` timer (best-effort — a timer-bookkeeping failure never rolls
  back or blocks the cycle itself). Fixed in the same change:
  `AccessRecertificationScheduler`/`AccessRecertificationController` both previously
  computed their default due date as 15 *calendar* days despite citing "15 business days"
  in their own comments/DTO doc — both now use `addBusinessDays()`.
- **The other 13 registry entries have no real call site** — same root cause as A.6/A.7:
  no Part C business module (`DataSubjectRequestService`, `IncidentService`,
  `DisposalBatchService`, etc.) exists yet to call `startTimer()`/`resolve()` from. Several
  of those entities already carry their *own* inline due-date field
  (`DataSubjectRequest.slaDueAt`, `DisposalBatch.slaDueAt`, `LegalHold.nextReviewDueAt`,
  `Vendor.annualReviewDueAt`, `DataSharingApproval.slaDueAt`,
  `DpiaScreening.dpoReviewDueAt`) with no generic `SlaTimer` row alongside it yet — wire
  `startTimer()`/`resolve()` into each one's create/close write path as its service layer
  is built, using that field as `dueAt` rather than `computeDueAt()`'s registry default.
- `escalatedTo` is populated at `startTimer()` time (the stage's *planned* target), not at
  escalation time — the sweep only ever flips `escalatedAt`. See `SlaTimerService`'s header
  comment for why; a reader expecting `escalatedTo` to mean "already escalated to" should
  check `escalatedAt` instead.
- Every non-DPO escalation target (`GENERAL_MANAGER`, `IT_MANAGEMENT`,
  `CUSTOMER_RETENTION`, `DPO_AND_LEGAL_COUNSEL`) is free text, not a real RBAC role —
  `ibms-brain/meta/context/roles-and-segregation-of-duties.md` doesn't name any of them.
  Resolving a free-text target to an actual notified person is a notification-system
  concern this repo doesn't have yet (same gap as A.1's "no email provider").

**A.9 — Data Masking & Leakage Prevention (Part 10.6)**

- `maskTrailing()`, `SensitiveFieldRevealService`, `assertSecureChannel()`,
  `assertExportAllowed()`/`buildWatermarkText()`, and
  `assertNoPresetSensitiveDefaults()` are all real and unit-tested (see § Data masking
  above), but — same root cause as A.5/A.6/A.7/A.8 — nothing in the codebase calls any
  of them from a real business write/read path yet, since no Part C business module
  (`CustomerService`, `DocumentService`, a `DataSharingApproval` create/decide
  endpoint) exists. Wire `SensitiveFieldRevealService.mask()`/`reveal()` into each
  entity's list/detail read path, `assertSecureChannel()` into
  `DataSharingApproval`'s create/decide write path, and `assertExportAllowed()` into
  whatever export/print/download endpoint is built, as each is built.
- `assertExportAllowed()`/`buildWatermarkText()` enforce the business rule and produce
  the watermark text, but don't themselves stamp a PDF/image — no document-rendering or
  object-storage pipeline exists yet behind `Document.storageRef` (same gap as A.3).
- `assertNoPresetSensitiveDefaults()` has no form to call it from yet — `apps/web` has
  no business forms (Part C isn't built). It's a guard for a future form's
  initial-values builder to call, not something with a UI to verify today.
- `DataSharingApproval.classification`/`channel` are new required (non-nullable)
  columns added in this change — safe because the table is empty in every environment
  today (no Part C module writes to it yet); a schema with real rows would have needed
  a backfill migration instead.

**A.10 — Infrastructure & Deployment (Part 10.4/10.5)**

- **Independent penetration testing before go-live and periodically after is not
  implemented, and can't be — by definition it requires an external, unaffiliated
  party, not code written by the same agent building the system under test.** Nothing
  in this change simulates, schedules, or claims to satisfy this item; it needs to be
  engaged and tracked as an organizational/procurement task (candidate home: M11
  Compliance & Audit Toolkit's corrective-action register once that module exists —
  `ibms-brain/meta/context/pcms-privacy-modules.md`), not a repo change.
- SAST (`.github/workflows/codeql.yml`) and DAST (the backend CI job's ZAP baseline
  step) are both real and run in CI, but DAST is informational only
  (`cmd_options: -I`, `fail_action: false`) — this app has almost no exposed business
  surface yet (Part C isn't built), so failing the pipeline on ZAP's generic ruleset
  today would train everyone to ignore it. Turn it into a hard gate, with a documented
  allowlist for accepted alerts, once there's real endpoint surface to scan
  meaningfully.
- The backup/restore drill (`scripts/backup-restore-drill.sh`,
  `.github/workflows/backup-drill.yml`) is real, runs against `db-test`, and has been
  executed locally (dump → encrypt → decrypt → restore → row-count verify, ~14s against
  a 900s RTO target — see `ibms-brain/meta/lex/backup-rpo-rto.md`). It has never run
  against a production database, because none exists. The scheduled workflow needs a
  `BACKUP_DRILL_ENCRYPTION_KEY` repository secret set before its first scheduled run
  will succeed rather than fail on the missing-secret check.
- RPO (24h)/RTO (15min) in `backup-rpo-rto.md` are drafts this repo picked to have a
  real number to test against — not yet reviewed or signed off by whoever owns
  business continuity (Part 10.4/10.5 names that role, this repo doesn't have a named
  person yet). Confirm and update both the lex file and `RTO_TARGET_SECONDS`'s default
  the day someone with that authority sets a real target.
- **Dev/Test/UAT/Prod separation is scaffolded, not achieved.** `db`/`db-test`/`db-uat`
  are three separate local docker-compose Postgres instances with their own env files
  (`.env`/`.env.test`/`.env.uat.example`) — but there is no UAT or Prod *deployment*
  target (see § Deployment below), so "UAT" today means "a fourth local database," not
  a real separate environment reachable by anyone but the developer running it.
  `synthesizeEntityFields()` exists so that whenever a real non-prod environment is
  seeded from a production export, PII doesn't have to travel there unmasked — but
  nothing calls it yet, since there's no production data to synthesize from and no
  seed pipeline beyond `prisma/seed.ts`'s roles/permissions.

## Deployment

**Not decided.** Docker images build correctly and can run anywhere that accepts a
container; nothing here assumes AWS, Azure, Fly, Render, or any other target. Record the
decision in `ibms-brain/meta/designs/` the day it's made, and update this section in the
same change — including enabling encryption at rest on whatever managed database/object
storage is chosen (see § Security above).
