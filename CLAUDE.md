@ibms-brain/CLAUDE.md

<!-- The import above pulls in ibms-brain's full rule set (meta/lex/, meta/context/,
     meta/designs/) via the ibms-brain/ git submodule. If that directory is empty, run
     `git submodule update --init --recursive` — see "Cloning this repo" below. Keep
     the import on line 1, same reason ibms-brain's own CLAUDE.md keeps @AGENTS.md on
     line 1: without it this content is dead weight while still read by other tools. -->

# CLAUDE.md — ibms-app

This is the first IBMS engineering repo. **Standards, mandatory rules, domain
knowledge, and architecture decisions live in `ibms-brain` (imported above via git
submodule at `ibms-brain/`), not here** — `ibms-brain/meta/lex/` (mandatory),
`ibms-brain/meta/context/` (domain knowledge), `ibms-brain/meta/designs/` (why decisions
were made). Read the relevant `meta/context/` file before touching an area, and the
`meta/lex/` rules before any non-trivial change — most of them (money-decimal-jod,
workflow-state-transitions, maker-checker-segregation, sensitive-data-handling,
pdpl-sla-timers) apply the moment real domain code lands here, which it has not yet.

## What's New

| Date | Change | Action required |
|------|--------|-----------------|
| 2026-08-26 | Generic SLA timer engine + escalation sweep landed (backlog A.8, `apps/api/src/modules/sla/`), covering all 14 SLA types in `ibms-brain/meta/lex/pdpl-sla-timers.md`'s registry. New migration adds `SLA_ESCALATED` to the `AuditAction` enum. New shared `apps/api/src/common/business-days.util.ts` (Jordan's Friday/Saturday weekend) — also fixed `AccessRecertificationScheduler`/`AccessRecertificationController`, which had been computing their "15 business days" default as 15 calendar days. See README.md § Known gaps, A.8, for which of the 14 workflows still have no real call site. | Run `npm run db:migrate:dev` (or `db:test:migrate:dev`) to pick up the new `SLA_ESCALATED` audit action before relying on the SLA sweep locally |
| 2026-08-26 | Data masking & leakage prevention (backlog A.9) and infrastructure/DevOps hardening (A.10) landed. A.9: masking + justified drill-down (`SensitiveFieldRevealService`), secure data-sharing channel enforcement (`DataSharingApproval` gained required `classification`/`channel` columns — migration `20260826140000_...`), watermark/export-restriction guard, privacy-by-default form guard. A.10: CodeQL SAST (`.github/workflows/codeql.yml`) + an informational OWASP ZAP DAST step in the backend CI job, an encrypted backup/restore drill (`scripts/backup-restore-drill.sh`, weekly `.github/workflows/backup-drill.yml`, new `ibms-brain/meta/lex/backup-rpo-rto.md`), a `db-uat` docker-compose service + `.env.uat.example`, and `synthesizeEntityFields()` for non-prod seeding. Independent penetration testing is explicitly **not** implemented — see README § Known gaps, A.10, for why that one can't be a code change. See README § Known gaps, A.9/A.10, for the rest of what's built-ahead-of-consumer vs. genuinely unimplemented. | Re-copy `.env.uat.example` if standing up a local UAT database; set a `BACKUP_DRILL_ENCRYPTION_KEY` repo secret before the scheduled backup-drill workflow's first run; run `npm run db:migrate:dev` (or `db:test:migrate:dev`) to pick up `DataSharingApproval`'s new required columns |
| 2026-08-26 | Part B (Database) closed out: `prisma validate`/`prisma migrate status` both verified clean against the real dev/test DBs (the backlog item's "could not run in this sandbox" note no longer holds here); the A.5 `CHECK` constraints already satisfied Part B's own ask; `prisma/seed.ts` gained `DOCUMENT_TEMPLATES` (4 proposal-form skeletons, motor/general/health/life — seeded in every environment) plus `SAMPLE_INSURERS`/`SAMPLE_USERS` (3 fictional insurers, 11 login-capable accounts, one per role — gated `NODE_ENV !== 'production'`, same convention as `ENABLE_DEV_RESET_TOKEN`). Additional performance indexes stay explicitly blocked — no load test has run yet. See README § Known gaps, Part B. | Re-run `npm run db:seed` (or `db:test:seed`) to pick up the new document templates/sample data; sample-user login is `sample.<role-slug>@ibms.internal` / the shared password in `packages/db/prisma/seed-data/sample-users.ts`, dev/test only |
| 2026-08-26 | Part C #1 (Lead Management) landed — the first real business module, not infrastructure. `apps/api/src/modules/lead/`: create/list-filter/transition endpoints on the existing seeded `lead.*` permissions, `Lead` added as a 12th entity to the A.6 `WorkflowTransitionService` (`LeadStatus` transitions, never a direct field write). `apps/web/app/(app)/leads/page.tsx`: intake form + Kanban pipeline board. New migration `20260826150000_add_lead_filter_indexes` adds 3 `@@index`es Lead's list/filter needs. See README § Known gaps, Part C #1, for what's deferred (Prospect conversion, reassignment, Domain A Processes 3-10). | Re-run `npm run db:migrate:dev` (or `db:test:migrate:dev`) to pick up the new indexes if your local DB predates this row |
| 2026-08-26 | Part C #2 (Prospect Management) landed. `apps/api/src/modules/prospect/`: `POST /prospects` (converts a Lead into a Prospect and captures the qualification profile — sector/activity/employee count/business size/location/contact person/products of interest/expected premium), `GET /prospects` (list, same owner-scoping as Lead), `GET /prospects/:id` (profile). Reuses `WorkflowTransitionService` for the Lead's `CONVERTED_TO_PROSPECT` move rather than a second write path — `POST /leads/:id/transition` now rejects that target directly (`UnprocessableEntityException`), so `POST /prospects` is the only legal path. New seeded permission `prospect.read`; new migration `20260826160000_add_prospect_owner_index`. `apps/web/app/(app)/prospects/`: qualification form (reached from a "Convert to prospect" action on a `QUALIFIED` lead in the pipeline board) + list + profile screens. See README § Known gaps, Part C #2, for what's deferred (`Prospect.status` progression, reassignment, Domain A Processes 3-10). | Re-run `npm run db:seed` (or `db:test:seed`) to pick up the new `prospect.read` permission, and `npm run db:migrate:dev` (or `db:test:migrate:dev`) for the new index, if your local DB/permission grid predate this row |

Drop the oldest row once this table exceeds 5 entries (ibms-brain/meta/lex/workspace-updates.md).

## Cloning this repo

```bash
git clone --recurse-submodules https://github.com/SHOUQALMAHARBAH/IBMS-APP.git
# already cloned without it?
git submodule update --init --recursive
```

The submodule pins a specific `ibms-brain` commit — it does not auto-track `main`. Pull
in newer brain rules deliberately:

```bash
cd ibms-brain && git pull origin main && cd ..
git add ibms-brain && git commit -m "ibms-brain: sync to latest"
```

## What's here today

Infrastructure, plus the first two Part C business modules (Lead Management and Prospect
Management, Domain A #1-2) — see root `README.md`. Policy, claims, and the rest of
CRM/finance don't exist yet.

## Common commands

```bash
npm install
cp .env.example .env
docker compose up -d db
npm run db:migrate:dev
npm run db:seed       # 11 roles + full permission grid — RBAC needs these to exist
npm run dev          # web:3000, api:4000
npm run lint
npm run typecheck
npm run test          # vitest, web + api

# api e2e — separate test DB (db-test), never the dev DB above. See README
# § Dev DB vs. test DB.
cp .env.test.example .env.test
docker compose up -d db-test
npm run db:test:migrate:dev
npm run test:e2e

npm run e2e           # playwright + axe-core, web
```

## Environment

- Node `20.19.0` — see `.nvmrc`. This satisfies Prisma 7's Node floor (≥20.19/22.12/24)
  but Prisma itself stays pinned at `6.19.3` in `package.json` — Node version no longer
  blocks a Prisma 7 install, so don't bump `prisma`/`@prisma/client` past 6.x without
  doing the driver-adapter (`@prisma/adapter-pg`) + `prisma.config.ts` migration first.
  See the Prisma note in root `README.md`.
- Docker required for Postgres locally and for building `apps/api`/`apps/web` images.

## Repo map

```
apps/web/     Next.js frontend
apps/api/     NestJS backend
packages/db/  Shared Prisma schema + client (@ibms/db)
ibms-brain/   Submodule — standards/rules/context (loaded via the import above)
.claude/      Agents/commands mirrored from ibms-brain + a subset of its hooks — see
              README.md § .claude/ — agents, commands, hooks
```

`@code-reviewer` and `@software-developer` (defined in `ibms-brain/meta/agents/`) and
`/brain-gap` are available in this repo via `.claude/`. Not yet wired here: the `git push`
evidence-gate hook (`enforce-evidence.sh`) and the domain-code hooks — see README.md for why.

## Before you write code

Same rule as ibms-brain: read `meta/context/` for the area, `meta/lex/` for what's
mandatory, cite the source document (PDPL / CBJ / ISO 27001/27701 / a specific
`PRIV-STD-*`/`PRIV-SOP-*`) in the PR when the change touches a regulatory obligation.
