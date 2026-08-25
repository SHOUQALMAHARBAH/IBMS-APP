# CLAUDE.md — ibms-app

This is the first IBMS engineering repo. **Standards, mandatory rules, domain
knowledge, and architecture decisions live in the `ibms-brain` repo, not here** —
`meta/lex/` (mandatory), `meta/context/` (domain knowledge), `meta/designs/` (why
decisions were made). Read the relevant `ibms-brain/meta/context/` file before touching
an area, and the `ibms-brain/meta/lex/` rules before any non-trivial change — most of
them (money-decimal-jod, workflow-state-transitions, maker-checker-segregation,
sensitive-data-handling, pdpl-sla-timers) apply the moment real domain code lands here,
which it has not yet.

There is currently no automated sync between the two repos (no submodule, no copy
script) — that mechanism is undecided. Until it exists, open `ibms-brain` alongside this
repo and read it directly.

## What's here today

Infrastructure only — see root `README.md`. No business logic (policy, claims, CRM,
finance) exists yet.

## Common commands

```bash
npm install
cp .env.example .env
docker compose up -d db
npm run db:migrate:dev
npm run dev          # web:3000, api:4000
npm run lint
npm run typecheck
npm run test          # vitest, web + api
npm run test:e2e      # api e2e (needs DATABASE_URL reachable)
npm run e2e           # playwright + axe-core, web
```

## Environment

- Node `20.13.0` — see `.nvmrc`. Pinned because Prisma 7 requires Node ≥20.19/22.12/24;
  see the Prisma note in root `README.md` before bumping either.
- Docker required for Postgres locally and for building `apps/api`/`apps/web` images.

## Repo map

```
apps/web/     Next.js frontend
apps/api/     NestJS backend
packages/db/  Shared Prisma schema + client (@ibms/db)
```

## Before you write code

Same rule as ibms-brain: read `meta/context/` for the area, `meta/lex/` for what's
mandatory, cite the source document (PDPL / CBJ / ISO 27001/27701 / a specific
`PRIV-STD-*`/`PRIV-SOP-*`) in the PR when the change touches a regulatory obligation.
