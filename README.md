# ibms-app

Engineering codebase for **IBMS** (Insurance Brokerage Management System). This is the
first engineering repo for the IBMS build program — a standards-taker from the
`ibms-brain` repo (rules in `meta/lex/`, domain knowledge in `meta/context/`,
architecture decisions in `meta/designs/`), pulled in here as a git submodule at
`ibms-brain/` so both a human and an agent working in this repo actually have it, not
just a note saying to go read it elsewhere. This repo does not restate those rules; it
implements against them. Compliance/PDPL/CBJ obligations still cite the source document
in `ibms-brain/`, not this README.

**Status:** infrastructure scaffold (Part A + Part B), plus the first Part C business
modules — **Domain A, Processes 1–10**: Lead Management (#1 — create/list/filter,
`LeadStatus` transition, an intake-form + pipeline-board screen), Prospect Management (#2
— convert a qualified Lead, capture its qualification profile, a profile screen), Customer
Acquisition/Onboarding (#3-4 — individual/corporate Customer creation, UBO capture, KYC
lifecycle with sanctions screening (real lists; PEP and pre-transaction screening are
NOT implemented — see § Known gaps) and maker/checker approval, a
step-by-step wizard + Compliance queue), Needs Assessment (#5 — a structured risk
questionnaire that derives a recommended coverage list, with a review + approval gate),
Risk Assessment (#6 — a per-site asset survey deriving Sum Insured + indemnity period,
consolidated across a multi-site client), Product Recommendation / Program Design (#7
— a multi-line `InsuranceProgram` assembled deterministically from an approved Needs
Assessment's coverage list + the Risk Profile's derived Sum Insured, DRAFT → FINALIZED),
Cross-Selling (#8 — a nightly job + on-demand scan flag each benchmark insurance line
a customer holds no in-force policy for as a `CrossSellOpportunity` to convert or dismiss;
`Policy` is empty until Domain B, so it is a correct no-op for now), and Up-Selling (#9 —
a nightly job + on-demand scan raise an `UpSellRecommendation` when a customer's surveyed
asset value has grown materially past the property Sum Insured designed into their live
`InsuranceProgram`), and Relationship Management / CRM (#10 — log every customer
touchpoint as an `Interaction` and serve the aggregated 360° customer view: interactions
plus policies, claims and complaints merged into one timeline; the latter three are empty
until Domains B/C/E land).
This paragraph predates Domains B–H (policy,
claims, finance, service, compliance/risk, management, supporting ops) and Parts D–F
(PDPL/DSR/retention, dashboards, bilingual/RTL UI), all of which have since been built —
**§ Scope status below is the authority, not this summary.** Part G's final verification
checklist is **complete** — all seven items closed, each guarded by a test that fails when
the property stops holding. See § Scope status
for the full picture and § Known gaps for the
deferred edges of each built item; `meta/context/data-model.md` in ibms-brain is the
logical data model this is built against. A minimal signed-in navigation shell (a sidebar
plus a `Welcome` landing at `/`) ties the built screens together; the original `/`
scaffold placeholder is gone, and login now lands on the home page.

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
        common/          Cross-cutting utilities (money, masking, logging, ...)
        controllers/      Route handlers not yet owned by a feature module
        services/         Business logic not yet owned by a feature module
        repositories/     Data-access layer (wraps @ibms/db)
        middleware/       Cross-cutting request handling (auth, logging, ...)
  packages/
    db/              Shared Prisma schema + generated client (@ibms/db)
  logs/              Runtime operational logs (pino) — gitignored; see logs/README.md
  ibms-brain/         Standards/rules/context — git submodule, not this repo's code
  docker-compose.yml Postgres + api + web for local/integration use
  turbo.json         Task graph (build/lint/typecheck/test/e2e)
  .github/workflows/ CI
```

### Frontend design system (web)

`apps/web` styles with **CSS custom properties + inline `style` objects** — there is no
Tailwind, no CSS modules and no third-party component library, and adding one was
considered and deliberately rejected (retrofitting across 1,116 inline style objects and
92 pages is a mechanical rewrite with real regression risk for no gain tokens do not
already give).

* **`app/globals.css`** holds every token: colour, spacing, type scale, radii, elevation,
  focus ring, light + dark themes, RTL conventions, reduced-motion. The palette is
  **sampled from the approved login design**, not invented — brand `#3b6790`, hero
  gradient `#273a4e -> #33516d`, page surface `#f4f6fa`, ink ramp `#26303e / #525e6f`.
  Re-sample rather than approximate if it is revisited. **One deliberate departure:**
  `--ink-muted` was sampled at `#828c9a`, which fails WCAG AA on every surface in the
  file (3.41:1 on a white card, and a card is as light as a background gets, so there
  was nothing to darken but the ink). It is `#656d7b` — 5.22 / 4.82 / 4.61 on
  card / page / sunken; dark is `#8b95a4`, worst case 4.98. Primary and secondary are
  untouched.
* **A PYTHON EDIT ON WINDOWS SILENTLY REWRITES AN LF FILE AS CRLF, and git then reports the WHOLE FILE as changed.** `pathlib.Path.write_text` translates `
` to `os.linesep`, so one commit here came to **23,052 insertions over 22,811 deletions across 56 files** when the real change was a fraction of that. Nothing in the build can see it — every gate passes and the bytes are semantically identical — and the only thing that says anything is `git diff --stat`, to somebody who asks whether the number is plausible. **A whole-file diff is an unreviewable diff, and it is read as the size of the work.** Run `python scripts/measurements/normalise-line-endings.py` on the staged set before committing; it decides PER FILE from that file's own blob rather than imposing LF on the tree, because there is no `.gitattributes` here and `core.autocrlf` is `false`, so the stored form IS the convention and it is per file.
* **Never mute text with `opacity` — and `npm run check:opacity-muting` is the gate.** **IT RUNS IN CI, confirmed 2026-10-30 from the run rather than the file**: `960d236`, run `41014740507`, `frontend` step 14 *Opacity used to mute text may only fall*, `success`. Two pushes of it were refused naming `workflow` scope, and the diagnosis matters because the token dance was never going to work: **the push authenticates as an OAuth App** (`gist, read:org, repo`), which is what the refusal said and what a fine-grained PAT would never say — so a correctly-scoped personal token was never on that path. The step landed by being edited in the browser instead, where account permissions apply and no credential is involved. Both held branches are deleted.
  It composites toward whatever is behind the element, so the rendered colour is one no
  token declares: `opacity: 0.6` on `--ink-primary` reads as `#787f89` over the page
  surface, 3.73:1. That pattern was 20 of the 51 contrast violations the first full
  `test:a11y` run found. Use `--ink-secondary` (6.09:1) or `--ink-muted`. `opacity` on a
  *disabled control* is fine — axe exempts those, and `components/ui/Button.tsx` still
  uses it.
  **THIS RULE WAS WRITTEN HERE AND ENFORCED BY NOTHING, AND 130 SITES ACROSS 69 FILES
  BROKE IT** (measured 2026-10-29, now 108 — `/customers/[id]`, its two correction components and `/screening-health`). `--ink-secondary` on `--surface-card` is
  6.58 at full strength and **4.10 at `opacity: 0.8`** — below AA; on `--surface-page`
  it fails from 0.85, and `--ink-muted` fails at every value this tree uses. The full
  table is in `scripts/measurements/opacity-as-muting.py`'s own header.
  **THE a11y SUITE CANNOT SEE IT**, which is why the gate is separate: axe composites
  the colours it can resolve and reports the rest as INCOMPLETE, while `test:a11y` reads
  serious/critical VIOLATIONS — so 85/85 green says nothing at all about this class. The
  gate is a RATCHET rather than a ban, because a reduced opacity on an icon, a divider
  or a disabled control is legitimate and is not a contrast question; its rows are
  candidates to read, and **the budget may only fall**.
* **The `(auth)` screens carry the comp's hero gradient**, via `authPageStyle` /
  `authCardStyle` in `components/auth/auth-form.styles.ts`. Both are **additive**:
  `pageStyle` and `cardStyle` in that same file are imported by **86 authenticated
  screens**, so editing them would repaint the whole app. The gradient is vertical
  (`180deg`, matching the sidebar) because a diagonal would need mirroring for RTL.
  **Three dark-mode contrast gaps are tracked, none of them visible to axe** — its
  contrast rule covers text only, so WCAG 1.4.11 non-text contrast is unchecked:
  (1) input borders sit at **1.35:1 light / 1.37:1 dark** against the card
  (`--border-default` on `--surface-card`) — pre-existing, app-wide, and the strongest
  candidate of the three because those are real controls; (2) `--ink-muted` on
  `--surface-hover` (4.34) — that token has zero consumers; (3) `--nav-ink-muted` on
  `--nav-item-active` (2.91) — muted nav ink only ever sits on the nav ground. None is
  addressed; do not self-select them.
* **`components/ui/`** is the primitive set — `Button`, `Card`/`PageHeader`, `Table`,
  `Field` (+ `TextInput`/`Select`/`TextArea`), `Badge`, `EmptyState`, `ErrorState`,
  `Skeleton`/`SkeletonList`. New screens compose these; they cover the four states
  (loading / empty / error / populated) every data screen owes.
* **Two `.styles.ts` modules are the app's chokepoints** — `components/lead/lead.styles.ts`
  (imported by 83 pages) and `components/auth/auth-form.styles.ts` (87). They became the
  de-facto design system by accident, so a customers page importing `cardStyle` from a
  *lead* folder is normal here. Both now read tokens only, and their **export names and
  shapes must stay stable** — changing one restyles (or breaks) dozens of pages at once.
* **The sidebar renders from permissions, not roles.** `components/app/AppNav.tsx` gates
  each of its 69 links on `user.permissions` from `/auth/me`, grouped under 9 bilingual
  headings, with codes taken from each destination route's own `@RequirePermissions`.
  **`/settings/security` is deliberately ungated**: it is self-service MFA enrolment, and
  `MfaRequiredGuard` 403s every other screen until a user enrols, so gating it on the
  admin-only `security-config.read` would lock out ten of the eleven roles.
* **A status enum becomes readable text in exactly one place.**
  `lib/policy/policy-status.ts` exports a `Record<PolicyStatus, TranslationKey>`,
  so adding a status is a compile error rather than a raw token on a screen.
  The policy list and policy detail pages both read it. They previously did
  not: the detail page carried its own `Record<string, string>` pair listing
  two statuses that do not exist (`PLACEMENT_REQUESTED`, `CHECKED`) and missing
  four that do — including `ACTIVE`, the state every completed policy ends in,
  which therefore rendered as the literal token in both languages.
  `lib/lead/lead-status.ts` is the same fix for `LeadStatus`, whose detail page
  listed four of five statuses and rendered `DISQUALIFIED` raw. Sixteen
  `Record<Enum, TranslationKey>` maps now cover the enums a user reads. Follow
  the same shape for any other one.
* **Every screen is bilingual — 93 of 93**, the 89 under `app/(app)/` plus the four
  `(auth)` screens that render before anyone is signed in. Copy lives in
  `lib/i18n/translations/`, one namespaced dictionary per domain (`auth`, `nav`,
  `leads`, `customers`, `rfq`, `policy`, `complaints`, `customer-service`, `pdpl`,
  `finance`, `compliance-screening`, `compliance-risk`, `dashboards`, `operations`,
  `detail-pages`, plus `common`), merged into one flat `TranslationKey` union by
  `lib/i18n/translations.ts`. **2,705 keys per language, AR and EN in exact parity.**
  Key names are semantic and per-domain prefixed (`leadsAddButton`, never the English
  phrase); Arabic is written as Arabic, not translated from the English, and an
  unsourced term is marked `TODO(arabic-terminology)` in place rather than guessed.
  Add a new screen's copy to the dictionary its domain already owns — a page-local
  `Record<string, string>` of labels is the exact defect the status modules above
  exist to prevent, and `tsc` cannot see it.
  **The 403 permission-denied branch is wired**, at 86 `t('*NoPermission*')` call
  sites across 74 files; no `*NoPermission` key is left unreferenced. The shape is
  always `err.status === 403 ? t('<screen>NoPermission') : err.message`, so the
  translated string is reached only for a permission denial and a real API error
  still surfaces its own message.
  **The merged namespace is now tested, not assumed.** `translations.test.ts` asserts
  three things the prefix convention only promised: every dictionary file on disk is
  covered, every key is declared in exactly one file, and every file is at exact AR/EN
  parity. It was written because four `commChannel*` keys were declared in **both**
  `rfq.ts` and `customer-service.ts` — the later spread won, so `rfqs/[id]` rendered
  the communications screen's "Phone call"/"Customer portal" instead of its own
  "Call"/"Portal". `tsc` cannot see a collision: both sides are `string`, and the
  merged object is simply the last writer's value. The RFQ set is renamed `rfqComm*`.
  **Hint text and accessible names are covered too.** The app holds **27**
  `placeholder` literals: **13 carried English prose and now read from the dictionary**;
  the other **14 are format examples** (`"17500.000"`, `"+962-7-..."`, a UUID sample)
  and are deliberately left alone — `lib/i18n/format.ts` pins Arabic to `'ar'`, not
  `'ar-JO'`, precisely so numerals stay Western, so an AR key would be byte-identical
  to its EN twin. Separately, **30 template-literal `aria-label`s were English**
  (`` `Confirm access for ${name}` ``) and now interpolate through `t()`'s `params`
  argument; these are screen-reader-only, so axe never caught them — it checks that an
  accessible name *exists*, not what language it is in. Keep an `aria-label` and the
  visible label of the same control in the same language: a screen reader and the
  screen disagreeing is the defect this closed. Four `label=` props on
  `/financial-report` (`"1–30 days"` and its siblings) were the last on-screen
  literals, sitting between two `Figure`s that already read from the dictionary.
  English interleaved with interpolations was the last category — **32 sites across
  17 files**, invisible to a bare-JSX-text scan because the text node itself contains
  `{`. All are wired; the app now has **no English left outside the dictionaries**.
* **Count-dependent copy goes through `tPlural()`, never a ternary.**
  `count === 1 ? '' : 's'` cannot express Arabic: `Intl.PluralRules('ar')` selects
  between **six** categories (zero / one / two / few / many / other) where English
  selects between two, so a ternary is a wrong answer for four of Arabic's six cases.
  `lib/i18n/plurals.ts` holds `PLURALS` — an object of CLDR-category forms per key —
  with its own `PluralKey` union and its own resolver, deliberately **separate from
  the flat `TranslationKey` dictionary**: a dictionary value is a `string`, a plural
  value is an object, and keeping the unions apart means `t()` cannot resolve a plural
  key to `[object Object]` and `tPlural()` cannot take a key with no forms — both are
  compile errors. `other` is the only mandatory form (CLDR guarantees it for every
  locale and count) and a missing category falls back **straight to `other`, never to
  a neighbour**: borrowing `few` for a missing `many` would hide the gap behind a form
  that is grammatically wrong for that count anyway. The category always comes from
  `Intl`, never from hand-rolled arithmetic. `plurals.test.ts` pins the Arabic
  boundaries (0, 1, 2, **3–10**, **11–99**, 100+) and that six counts produce six
  genuinely distinct strings.
* **Money renders through `formatMoney`, everywhere.** Four dashboards were printing
  `{rawValue} JOD` — an ungrouped, unformatted number with a hand-written suffix,
  bypassing the shared formatter entirely. They now read `JOD 37,500.000` like every
  other figure in the app.
* **An unreferenced dictionary key is a question, not a verdict.** `policy.ts`'s 98
  orphans were audited one by one rather than deleted as debt: **15 were missing
  wiring** — the string they were written for was still hard-coded in the component
  that owns them — and **83 were genuinely dead**, superseded (`policyStatus*` by
  `policyState*`) or written for a UI that was never built. `policy.ts` is now at
  **zero** unreferenced; app-wide the count is **61, down from 159**. Audit before you
  delete: the cheapest way to lose a translation is to bin the key because nothing
  references it yet.
* **Enum values render through a `Record<Enum, TranslationKey>` map, never raw.**
  `POLICY_STATUS_LABEL_KEY` was the first; `INVOICE_STATUS_LABEL_KEY` and
  `RECEIPT_METHOD_LABEL_KEY` (`components/policy/FinanceSection.tsx`) and
  `DELIVERY_METHOD_LABEL_KEY` (`PolicySection.tsx`) now cover the three that were
  still printing their own tokens — `INVOICED`, `bank_transfer` — on screen, in Arabic
  too. A new enum member is then a compile error, not a token a user reads.
* **`GET /policies` answers three questions.** With `opportunityId`, the one
  policy placed from it; with `customerId`, that customer's policies; with
  neither, the book-wide list behind `/policies` — filtered **in the query** to
  what the caller may see (whole book for Placement / Manager / Executive /
  Policy Checking, own-customers-only for everyone else) and capped at
  `POLICY_LIST_TAKE`. The cap is only safe because the filtering happens in
  SQL; filtering a capped read afterwards lets the cap decide what the caller
  cannot see. Supplying both scopes is still refused.
* **`e2e/fixtures/role-permissions.ts` is generated** from
  `packages/db/prisma/seed-data/permissions.ts`. 71 of 74 Playwright specs mock
  `/auth/me`, and the UI renders off `permissions`, so each spec returns a realistic set
  via `permissionsForRoles(roles)`. Regenerate it when the seed grid changes.

`features/` (web) and `controllers/`, `services/` (api) are still empty scaffolding — no
feature has needed them over its own `modules/` subfolder yet. `modules/`/`repositories/`
(api) and `lib/`/`components/` (web) now also carry the first real business features (Lead
Management — `apps/api/src/modules/lead/`, `apps/web/app/(app)/leads/`; Prospect
Management — `apps/api/src/modules/prospect/`, `apps/web/app/(app)/prospects/`; Customer
Acquisition/Onboarding — `apps/api/src/modules/customer/`,
`apps/web/app/(app)/customers/`; Needs Assessment + minimal Risk Profile —
`apps/api/src/modules/needs-assessment/` + `apps/api/src/modules/risk-profile/`,
`apps/web/app/(app)/needs-assessments/`), alongside the infrastructure modules (auth,
RBAC, audit, SLA, workflow, security) built first. They establish where feature work
lands, per `meta/context/policy-lifecycle.md` and `meta/context/claims-lifecycle.md` in
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

# ON A CLUSTER THIS PRODUCT HAS NOT RUN ON BEFORE, THIS LINE COMES FIRST OR THE
# MIGRATIONS FAIL. No migration CREATEs the `ibms_app` role — they only GRANT to it
# by name — and a Postgres role is a CLUSTER object, so it survives the database
# being dropped and recreated. Every machine this has ever run on already had it,
# which is exactly why the gap stayed invisible. On a fresh one the first granting
# migration stops `migrate deploy` dead. Needs `APP_DB_PASSWORD` in the environment.
npm run db:provision-app-role

npm run db:migrate:dev
npm run db:seed   # per-office roles + the global permission catalogue — RBAC needs these

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

**The two databases must never share a name, and that is a control rather than a convention.** `db` holds
`ibms` on host port 5433; `db-test` holds `ibms_test` on 5434. On 2026-09-26 both containers restarted on
their own and came back with those host ports **crossed** — 5433 answering the db-test instance. Because the
database names differ, every connection failed immediately with `Database "ibms" does not exist`. Had both
been called `ibms`, the api e2e suite would have run its 105 spec files against the DEV database and passed,
because nothing in the suite knows which database it reached. So "simplify both to `ibms`" is a change that
looks like tidying and removes the only thing standing between a crossed port mapping and a test run
rewriting development data (IMPROVEMENTS § 1.56).

Diagnosing it: `docker exec <container> psql` bypasses the port mapping and looks healthy, and `docker
inspect` reports the mapping as correct. Connect over the PORT and ask the instance what it holds — 5433 must
list `ibms`, 5434 must list `ibms_test`. `docker compose restart db db-test` re-binds them.

### Scheduled jobs are switched OFF in the test environment

`.env.test.example` sets `SCHEDULED_JOBS=disabled`, and `ScheduledJobsGuard`
removes every `@Cron` job at boot when it sees exactly that value. **Keep it
set.**

The e2e suite boots the real `AppModule`, so without it all 19 cron jobs fire
during a run, on wall-clock time, against shared `db-test` state — and the
watchlist sync downloads the real OFAC and UN sanctions lists while it is at
it. A full run starting at 11:59:40 was broken by exactly that: the twice-daily
watchlist cron fired at 12:00:00, published a real ~1011-record generation, and
`watchlist-sync.e2e-spec.ts`'s 10-record fixture was then correctly refused by
the plausibility floor several minutes later. The SLA escalation sweep runs
every fifteen minutes, so it lands inside any run longer than that.

A suite whose result depends on what time of day it started is not telling you
about your code. `watchlist-sync.e2e-spec.ts` asserts the scheduler registry is
empty, so if the variable ever stops reaching the test process you get one
legible failure instead of confusing ones in unrelated specs.

Any value other than the exact word `disabled` — unset, misspelt, `false`,
`0` — leaves the jobs **running**. That direction is deliberate: a deployment
that silently stopped re-screening customers against sanctions lists would be a
compliance failure, not an inconvenience.

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
| `npm run test:security` | Dependency audit. **Fails on advisories in what SHIPS** (`npm audit --omit=dev`), and **reports** dev-only ones without failing. Takes npm flags: CI passes `-- --workspace api` / `-- --workspace web` so each job audits what it is named for. See `scripts/audit-check.mjs` for the rule and its stated cost |
| `npm run test:smoke` | `bash scripts/smoke.sh api` — dispatches to the api service's smoke test (see below) |
| `npm run e2e` | Playwright functional e2e (web) — **excludes** `@a11y`-tagged specs (`--grep-invert @a11y`) |
| `npm run test:a11y` | Playwright + axe-core accessibility checks (web) — **only** `@a11y`-tagged specs. A separate gate: a green `npm run e2e` says nothing about accessibility, so run both and report both counts |
| `npm run db:validate` | `prisma validate` — schema is internally valid. **Not** a drift check, and `db:migrate:status` is not one either — see the two rows below, which are |
| `npm run db:migrate:dev` | Create/apply a migration against the dev DB (`packages/db`) |
| `npm run db:migrate:deploy` | Apply existing migrations to the dev DB, no schema drift (also used for CI/prod) |
| `npm run db:migrate:status` | Whether every migration has been APPLIED to the dev DB. It does **not** read `schema.prisma` and does **not** compare checksums — measured: with a drifted migration present it prints "Database schema is up to date!" and exits 0 |
| `npm run db:checksums` | Every applied migration's stored checksum vs its file, WHOLE SET. Catches a migration edited after being applied — which `migrate resolve` makes easy, since it stamps the hash of the file as it is at resolve time |
| `npm run db:divergence` | Whether `schema.prisma` still describes what the database enforces. Asserts the diff is exactly 20 NAMED statements (generated columns, GIN-on-tsvector, ten composite tenant FKs, one identifier-truncation rename) — the number grows only when a migration adds an object Prisma genuinely cannot express, and each entry carries its reason and fails in **both** directions. This is what caught a `SetNull` declared over an enforced `RESTRICT`, and six real indexes the schema never declared |
| `npm run db:test:migrate:dev` | Create/apply a migration against `db-test` — where schema iteration happens |
| `npm run db:test:migrate:deploy` | Apply existing migrations to `db-test`, no schema drift |
| `npm run db:divergence` note | It does **not** see partial indexes, CHECK constraints or ROW-LEVEL SECURITY — the RLS half verified 2026-09-27, when adding a table with a policy left the gate at "20 statements, 20 expected" — measured: two live UNIQUE partial indexes on `CommissionAgreement` have never appeared in its output. Where a partial index carries a real invariant, assert it in its own migration's `DO` block (as `20261020100000` does, reading `pg_index.indnullsnotdistinct`) or in a test |
| `npm run db:privileges` | Whether the runtime role can read past row-level security: five attributes (SUPERUSER, BYPASSRLS, REPLICATION, CREATEROLE, CREATEDB) **and membership in no role at all**. The membership half is the one that matters — `GRANT ibms TO ibms_app` leaves `rolsuper` FALSE and hands the runtime role the owner's privileges, and Postgres exempts a table's owner from its own RLS policies. Measured on a planted grant: an unfiltered cross-office read returned 13,774 rows where 1 was expected. Migration `20261018100000` carries the same assertion, because a migration runs on the database being DEPLOYED to; the script is the recurring half, since a migration runs once |
| `npm run db:test:migrate:status` | As above, against `db-test` |
| `npm run db:test:checksums` / `db:test:divergence` / `db:test:privileges` | The two real checks above, against `db-test`. `scripts/verify.sh` runs the `db-test` variants; CI runs the dev ones against its own service container |
| `node scripts/plant.mjs <plants.json> <name>` | **Plant a deliberate regression, run the suite, watch the named test die, revert.** This is how a guard in this repo is shown to be non-vacuous, and it is not optional discipline: a test that passes is evidence only once its failure has been observed. The tool refuses a missing or unknown name, an anchor that is absent (the code moved — the plant is STALE), an anchor matching more than once (ambiguous site — it cannot say which guard it is testing), and a no-op replacement; then it RE-READS the file and will not print `PLANTED` unless the bytes changed. `--revert` restores from the backup taken at apply time. Plant definitions live in `scripts/plants/*.json`, one file per feature |
| `npm run test -w web` → `permission-descriptions.test.ts` | **THE COVERAGE OF THE PERMISSION DESCRIPTIONS, both directions, and a RATCHET rather than a fail-on-any.** The office manager decides a grant by reading the line under each checkbox; 214 of 219 codes have none yet. So the budget fails if the gap GROWS and fails if it SHRINKS without `MISSING_DESCRIPTION_BUDGET` coming down — at 0 it becomes fail-on-any-gap with no switch to throw. The reverse check (a line for a code the catalogue lacks) is fail-on-any today. **The text lives in `lib/i18n/translations/permissions.ts` under `perm:<code>` keys**, the code VERBATIM, because every transformation is lossy — strip separators and `customer.360-view.read` collides with `customer.360.view.read` — and verbatim also makes a RENAME loud in both directions instead of silently serving a stale sentence. Four plants in `scripts/plants/permission-descriptions.json`, including both halves of the ratchet separately |
| `node scripts/plant.mjs --self-test` | A plant ON the plant mechanism — 11 cases, including the original defect where `process.argv[2]` was empty under `node -e` so three plants reported PASSING having touched nothing. **It also verifies that every plant in `scripts/plants/` STILL APPLIES**, which is what makes a committed proof evidence rather than a claim: on the run that added the check, **11 of 115 had silently expired** — 9 long before, 2 that same day. Most of that rot is the FORMATTER rather than the code (three anchors broke on prettier quote style, two on a reflow), so anchor a plant on a short distinctive fragment of the thing it is about, never on prose beside it or on a multi-line span. Gated by `verify.sh`, because every other proof in this repo rests on this tool being honest. See `IMPROVEMENTS.md` § 1.51 for the six ways a guard can fail to be worth its cost |
| `python scripts/measurements/server-message-identifiers.py` | **A REPORT, NOT A GATE** — every server refusal that puts an INTERNAL IDENTIFIER or a RAW ENUM MEMBER in front of a reader. The screens render the SERVER'S own sentence rather than a generic one (decision 90), which is right — so an api message carrying a uuid is a uuid ON A SCREEN, and none of the web's gates can see it, because `rendered-identifiers.py` reads `.tsx` and this text lives in the api. Three classes: **IDENTIFIER** (a reader handed a value they cannot act on, at the moment they are already stuck), **ENUM** (a machine word where the product mostly has an Arabic one), and **VOCABULARY** (a field, a permission code or a route — mostly DELIBERATE and mostly correct, reported so the other two are not inflated). Measured 2026-10-29 over 877 call sites: **424 / 43 / 142** of 609 readable messages across 129 files. **READ THE ROWS, NEVER THE COUNTS**: the matcher reads TEXT, so a message interpolating a `reference` may be carrying a human-readable receipt reference (correct) or a surrogate key (not), and nothing tells those apart without reading it. Rows go to a gitignored UTF-8 file because this host's console is cp1252 and the first run died on a single arrow |
| `python scripts/measurements/em-dash-placeholder.py` | **A REPORT, NOT A GATE** — every place that renders an em dash where a fact would go. **145 sites** (measured 2026-10-29), and the number is a list of CANDIDATES TO READ rather than a count to drive to zero: owner decision 60 gives a word to exactly three cases — «لم يُقيَّم بعد» (not done yet), «لا ينطبق» (does not apply at all), «غير متوفّر» (held, unresolvable) — **and her instruction with them was that a site which does not fall cleanly into one of the three KEEPS ITS DASH and is recorded**. A count cleared by stretching a word onto a site it does not fit is worse than a count that stands. **ONE CLASS IS MECHANICALLY RECOGNISABLE and the script marks it `NAME?`**: decision 48 settled that `displayNamesForUserIds` and its three siblings take IDS and return a Map where a MISSING KEY MEANS NO NAME AND NEVER THE UUID, so a `<something>Name` falling back to a dash is exactly *held and does not resolve*. 16 such sites converted; still a candidate list, because `titleAr` is a name and is not this case. **AND THIS SCRIPT IS THE ONE HOME** — a second one (`em-dash-sites.py`) was written in the design batch without finding it, the two disagreed **145 against 91**, and the second was deleted with its one contribution folded in. Do not write a third |
| `python scripts/measurements/b7-survey.py <out.json>` | **A MEASUREMENT, NOT A GATE.** B.7's seven consistency rules across all **102** screens (not 103 — measured), for the three a script can decide — create form above the table, the four non-data states, and the glossary's forbidden synonyms. **Its rule 1 result of "0 violations" was wrong and is corrected in the record**: batch 6 found two, and this script cannot see them BECAUSE it correctly stopped counting a filter form as a create form — once it does, a filter form above the list satisfies the check and the create form below is never examined. Use `four-states.py` below for rule 1 now. The other four (identifiers, refusal wording, AR/EN MEANING parity, one-name-per-action) are declared UNMEASURED rather than guessed at, which is the first result of the pass. See `docs/b7-consistency-record.md` § THE FORMAL PASS for the triage, and read rule 1's output per (form, table) PAIR before calling anything a violation: a multi-section screen has several, and two correct screens were flagged by comparing the wrong two |
| `npm run check:absence` | **A RATCHET ON THE ONE ABSENCE SHAPE THAT CAN MATCH AN UNRELATED ELEMENT** (exits non-zero; a CI step in the `frontend` job). A page-wide `expect(page.getByText(x)).toHaveCount(0)` matches any text anywhere: a role-name absence loop on one notice matched "Compliance" in the NAV SIDEBAR and failed on a correct tree — the FOURTH time that trap was paid for, one commit after the rule forbidding it was written down. Measured: **191 page-wide absence assertions**, so a flat ban is a red build across 54 files, and `getByTestId`'s 58 are unique by construction and not the trap. The ratchet is the TEXT class alone — **42 across 23 files** — failing in BOTH directions so the budget cannot become a ceiling. Use `expectAbsentWithin(scope, build)` from `apps/web/e2e/support/anchored.ts`: `scope` is a `Locator`, so passing `page` is a COMPILE error, and it asserts the scope VISIBLE first — scoping fixes the wrong-element failure and NOT the not-yet-rendered one, because `toHaveCount(0)` passes on its first poll. **Do not raise `TEXT_LOCATOR_BUDGET`**; lower it as sites convert |
| `npm run check:docs` | **THE TWO DOCUMENTATION GATES** (exits non-zero; **runs LOCALLY only — no CI step, see below**). Runs the two below. It deliberately does NOT include `markdown-table-columns.py`, which exits non-zero on 3 DECLARED pre-existing malformed rows — bundling it would make a gate that can never pass, and a permanently red gate is one everybody learns to ignore. Run that one by hand. |
| `npm run check:undated-absence-claims` | **EVERY ABSENCE CLAIM IN THE DOCUMENTATION MUST CARRY THE DATE IT WAS MEASURED** (exits non-zero). **AN ABSENCE ROTS AND A PRESENCE DOES NOT**: *"X is not built"* goes false the day somebody builds X, silently, with nothing failing, while *"X is built"* stays true — so the script reads only the negative direction. **THE PATTERN IS DECLARED IN THE SCRIPT AND THE FIGURE IT PRINTS IS THE ONLY ONE TO QUOTE**: two greps a week apart gave 36 and 62 over the same file, and a count whose method is not written down is the defect this gate exists to remove. Measured 2026-10-30: **167 undated of 385 matched, 13 declared shapes.** `never` (1,399 hits) and `cannot` (1,019) are deliberately EXCLUDED, measured before being excluded — both are overwhelmingly instructions and invariants, which do not rot; so is a claim inside QUOTATION MARKS, because it is being quoted rather than made (9 instances, each one checked). **A REPORT WITH A RATCHET, NOT A GATE AT ZERO** — a gate at zero forces a rushed sweep over 11,000 lines of register, which is how the wrong sentences got written. The budget MAY ONLY FALL, and it fails if it is left ABOVE the real figure. |
| `npm run check:whats-new-cap` | **`CLAUDE.md`'s What's New table is capped at 12 ROWS** (exits non-zero). It reached 136 rows in 923 KB — about 7 KB a row, which is the right length for a row and the wrong container for 136 of them in the one file loaded into every session, and it grew by 5 rows and 38 KB in the six days before this cleanup started. When the table passes 12 the OLDEST row moves to `docs/whats-new-history.md`, unchanged, **in the same commit**. It counts rows and reads nothing — it cannot tell whether a row is TRUE, which is what the gate above is for. |
| `npm run check:maker-checker-pairs` | **THE PAIR COUNT IS DERIVED, NOT PINNED** (exits non-zero; a CI step in the `backend` job). Compares `MAKER_CHECKER_REGISTRY` to the `*_maker_checker_distinct` CHECK constraints the migrations create, BY NAME and in BOTH directions — so a pair registered without its constraint fails, a constraint no entry claims fails, and a seventeenth pair properly built moves both sides together and the gate stays quiet. It replaced `assert pairs == 15`, which had been exiting 1 before it measured anything since the sixteenth pair landed, in a script nothing ran. Running it also prints the ordinary report, which is how the one pair WRITING the act and showing nobody was found. **Its declared limit:** the projection figure is a REPORTED column, not a gate — a pair that stops projecting is caught by the e2e wire assertion, and both plants are committed. |
| `npm run check:seed-sweeps` | **EVERY PER-ORGANIZATION SEED SWEEP MUST BE CLEARED BY THE FIXTURE CASCADE HELPER** (exits non-zero; a CI step in the `backend` job, before the migrations). `seed.ts` has functions that walk `organization.findMany()` and write a row into EVERY organization. A disposable e2e fixture organization is one of those rows, every FK involved is RESTRICT, and one `db:test:seed` run after a leak makes that fixture **permanently undeletable** — which takes down every later spec at `createTestApp` with a fault that looks like its own. **This happened twice**: once when decision 25's `PasswordResetToken` broke two teardowns (CI red, eleven leaked organizations), and again when the comment written to prevent it listed the sweeps as "branches, departments and holidays" — two sweeps counted as three models, missing `ensureBrokerLicenseTerms` and its certificate `Document` entirely. It did not fire only because eleven of the twelve leaks were `INSURANCE_COMPANY` and that sweep filters on `BROKERAGE_OFFICE`: **the type spared us, not the code.** So it is a **DERIVATION, not a list** — it reads the sweeps out of `seed.ts` and the cleared models out of `tenant-prisma.ts`, and **derives the denominator too**: every occurrence of the sweep shape is ATTRIBUTED to the top-level `async function` containing it, and an unattributable one **fails by line**, because a fourth sweep written as an arrow function would otherwise clear a count-based floor and pass. **ITS LIMIT IS DECLARED**: it proves a model is cleared SOMEWHERE in the helper, not that the rows go — `apps/api/test/fixture-cascade.e2e-spec.ts` is the other half, and a committed plant that mentions a model while clearing nothing passes the gate on purpose and dies in that test |
| `npm run check:labels` | **A FLAT BAN ON A LABEL THAT NAMES A COLUMN INSTEAD OF SAYING WHAT THE FIELD IS FOR** (exits non-zero; a CI step in the `frontend` job). The owner's decision 21: the hiding of displayed ids became a BUILD RULE rather than a backlog row — every new screen from module 1 onward shows a NAME, not an id — and this is the half a script can police. "Branch ID" tells a person the column's name; *"Show one branch only"* tells them what the field does. **Classified by USAGE, not by key name**, because a text matcher over-reached twice: a key rendered inside `<th>` is a table HEADING (which names the column by design), inside `<label>` is a PROMPT, and one rendered by no screen at all is DEAD. The PROMPT budget is **0** — a flat ban with no switch to throw — and the other kinds are **PRINTED rather than filtered**, since an exclusion nobody can see is one nobody can argue with. **A real-world identifier is NOT the defect**: "National ID" says exactly what data will be in the field, because a national ID is a document in somebody's hand; "Owner user ID" names our surrogate key and says neither whose nor what for. `/audit-trail`'s two required fields and its browse filter are POLYMORPHIC (`wfEntityId` addresses any of fifteen workflow entities, `documentId` a `Document` with no search route), so they are declared BY NAME in `DECLARED_POLYMORPHIC` — **adding a row there needs the owner's decision, and must never be used to absorb an ordinary prompt** |
| `npm run check:css-properties` | **EVERY `--custom-property` A SCREEN REFERENCES MUST BE DEFINED IN THE STYLESHEET** (exits non-zero; a CI step in the `frontend` job). `--surface-raised` was referenced at three sites and defined NOWHERE, and a bare `var()` on an undefined property is invalid at computed-value time — the browser drops the WHOLE declaration, so all three blocks rendered with no background at all. One of them is the DPO assignment section, carrying the owner's own Arabic notice. **Nothing else in this repository could see it**: no compiler reads a stylesheet against a `.tsx` string, the CSS was never invalid, every Playwright assertion passed because the text still rendered, and axe passed because a missing background is not a contrast failure but a contrast ACCIDENT. This is a text-level join, like the AR/EN parity guards. **IT KEEPS TWO CLASSES APART**: a reference WITH a fallback (`var(--x, y)`) renders the fallback by design — 5 of those exist and are REPORTED, never gated — while a BARE one is the defect; merging them would bury thirteen real findings under six deliberate ones. **A DECLARED SET, not a count**, because a count survives a substitution: it fails by name on a bare reference nobody declared AND on a declared row that no longer occurs, so a fix is recorded by deleting its row rather than left to cover the next regression. **`DECLARED_BARE` IS EMPTY — a FLAT BAN with no switch to throw.** It held three rows for one batch (`--border` at 5 sites, `--line` at 4, `--shadow-raised` at 1) and all three were closed on the owner's ruling, each resolved to a property that ALREADY EXISTED rather than by inventing one: `--border-default` for a panel outline or a table header rule and `--border-subtle` for a row separator, which is this repository's own measured convention; and `--shadow-md` for the `EntitySearch` dropdown, decided one component over — `NotificationBell`'s panel is the app's only other floating overlay and is the exact comparable, so the two now look like one product. Re-populating the set needs a reason beside the name, because a row there means shipping an element with no background, border or shadow — register entry 128 |
| `npm run check:literal-colours` | **NO HAND-WRITTEN COLOUR OUTSIDE THE TOKEN SET** (exits non-zero; part of `npm run check:screen-pass`). **IT RUNS IN CI, confirmed 2026-10-30 from the run and not the file** — `960d236`, run `41014740507`, `frontend` step 15 *No hand-written colour outside the token set*, `success`. Two pushes of it were refused naming `workflow` scope; the step landed by being edited in the browser, because **the push authenticates as an OAuth App** and no personal token, however scoped, was ever on that path. §4 of the design pass said in its own words that a literal colour in a screen is a defect, and named `#b91c1c` BY NAME — and for months **nothing could see one**: `check:inline-styles` counts style SITES rather than what is in them, `check:css-properties` resolves bare custom-property references, and `check:token-contrast` reads hex only for the 32 pairings it is handed. **THE DEFECT IS ARITHMETIC RATHER THAN TASTE.** Measured against the two card surfaces when the sweep ran: `#b91c1c` is 6.47:1 on light and **2.33:1 on DARK**, where `--danger-ink` is 6.76; `#15803d` 3.01; `#b45309` 3.00; `#c00` 2.56 — and **`#2a7` fails the OTHER way round at 2.96:1 in LIGHT**, so a policy that passed its QC check rendered its own *no discrepancy* marker below AA for every light-theme reader. **The a11y suite is structurally silent**: axe reads RENDERED contrast and Playwright runs one theme, the same hole `check:opacity-muting` exists for. **THE WORST SITE WAS FOUND ONLY BY WIDENING THE MATCHER FROM `.tsx` TO `.ts`** — every `*.styles.ts` chokepoint was invisible — and it was the SIGN-IN button's own label at **2.34:1** in dark against `--on-brand`'s 7.70, on the first screen this product shows anybody, with `Button`'s own `primary` variant already carrying a comment naming that exact defect. **IT FAILS IN BOTH DIRECTIONS** — an undeclared literal, and a DECLARED exception that no longer occurs, so the list cannot become a ceiling. **NINE ARE DECLARED WITH WHAT EACH IS FOR**, because `rgba()` is not automatically a defect: a solid badge the semantic set has no step for, a modal scrim that must NOT follow the theme, two decorative gradients needing a colour at ALPHA, and white at alpha on the one surface that stays dark in both themes. **DO NOT ADD A TOKEN TO EMPTY THE LIST** — `--danger-solid` is owed and needs a light value and two dark ones. **AND ITS FLOOR IS A `--self-test`, NOT A COUNT**: `FLOOR = 10` guarded a real 26 and then REFUSED A CORRECT TREE AT 9, because a count floor goes stale every time the work it guards gets done |
| `npm run check:token-contrast` | **EVERY DECLARED TOKEN PAIRING CLEARS ITS WCAG FLOOR, IN BOTH THEMES** (exits non-zero; a CI step in the `frontend` job, and part of `npm run check:screen-pass`). 32 declared pairings. **It exists because the a11y suite is structurally blind to a ramp step no screen has reached**: axe runs over 84 Playwright specs and reads RENDERED contrast, so a palette change that breaks a token nothing currently paints is invisible to it until somebody uses that token — which is exactly the hole a brand re-anchor falls into. This gate measures at the TOKEN layer instead, resolving each `var()` chain in `globals.css` for both themes and computing the ratio. **THREE CLASSES, NOT ONE, AND THE SPLIT IS WHAT MAKES IT CREDIBLE**: `TEXT` at 4.5, `UI` at 3.0, and `SEPARATOR` REPORTED rather than gated — the first version held every border to 3.0 and produced SIX reds on a palette whose whole a11y suite is green, which is the cry-wolf direction that gets a gate ignored within a week. A decorative hairline is neither 1.4.3 text nor a 1.4.11 UI component. **Non-vacuity floors on both the token count and the pairing count**, so a parser that stops parsing refuses rather than reporting a clean nothing; and it fails in BOTH directions — an undeclared pairing and a declared one that no longer resolves. **RUN IT AFTER ANY PALETTE CHANGE** |
| `npm run check:inline-styles` | **INLINE STYLING MAY ONLY FALL** (exits non-zero; a CI step in the `frontend` job, and part of `npm run check:screen-pass`). **TWO BUDGETS, NOT ONE, and the split earned itself in the commit that added it**: `SCREEN_BUDGET` counts improvisation — everything outside `components/ui/` — and `UI_BUDGET` counts the primitive set, where a style is SUPPOSED to live. A single total would let the migration itself look like a regression, because moving a screen's styling into a primitive moves the site rather than removing it; it is the same argument `typed-identifier-inputs.py` already records, that one total lets a class be traded for another behind a green gate. **MEASURED AT THE START OF THE DESIGN BATCH: 1,511 sites across 169 files, against 18 unused primitives and 140 unused tokens** — which is the whole diagnosis in one line. **IT FIRED ON ITS OWN AUTHOR**: `AuthFrame` and `IconField` were first written into `components/auth/`, where the gate counted their 14 sites as a screen REGRESSION — correctly, by its own rule — and what it refused was leaving a shared frame in the bucket that measures improvisation. **MEASURED AT THE END OF THE DESIGN BATCH: 1,132 — down from 1,455, with every one of the 111 screens off `pageStyle` and 101 of them composing from `components/ui`.** **CORRECTED 2026-10-29: 106 authenticated screens, 104 composing.** The 111 counted every `page.tsx` under `apps/web/app`, which includes the five `(auth)` screens that render before sign-in; the two authenticated screens that compose from nothing are the home launcher (a grid of destination cards) and `/settings/security` (the one screen that must stay reachable before MFA enrolment), and both are correct as they are. **CORRECTED 2026-10-29: 1,100.** The screenshot batch took it further — `/customers/[id]` and its two correction components (the record shape, which had kept its own markup and which `design-pass-sections.py` had REFUSED with *nothing changed*) and then `/screening-health`, which carried a local `card` style with its own `1px solid` border and a `6px` radius off the scale. **Both moves were produced BY the ratchet rather than reported to it**: it refuses a budget left ABOVE the real figure, because a ceiling that absorbs the next regression silently is worse than no gate. 1,132 -> 1,115 -> 1,100 -> **1,083**, the last fall being the sixteen redundant table scrollers — one site per wrapper, which is what made it reconcile — and the ratchet refused the stale budget first, as it is built to. **`SCREEN_BUDGET` MAY ONLY FALL. `UI_BUDGET` RISES ONLY FOR A GENUINE NEW PRIMITIVE**, in the commit that adds it, with the reason written beside the number — never to absorb a screen's own styling |

> **2026-10-29 — TWO GATES WERE WIDENED TO SEE THE PRIMITIVES, and the reason is worth more than the change.** `typed-identifier-inputs.py` matched `<input` on the line carrying `value={…Id}`; a screen converted onto `Field` + `TextInput` no longer contains `<input`, so a field STILL asking a person to type a record id by hand went invisible and the budget fell 12 → 11, reporting the blindness as progress. `four-states.py` had the same exposure on `<table` for its rule 1. Both now match the primitive AS WELL AS the raw element. **A FALLING RATCHET IS NOT AUTOMATICALLY PROGRESS**: any gate keying on `<input`, `<select>`, `<table` or `<p role="alert">` has this exposure while the design pass converts more screens, and the failure is silent because it is indistinguishable from the work being done.

| `python scripts/measurements/design-pass-convert.py <screen>…` | **THE MECHANICAL HALF OF A SCREEN'S DESIGN PASS, APPLIED WITH REFUSAL RATHER THAN TOLERANCE** (exits non-zero; NOT a CI gate — it is a tool you run deliberately). It converts the shape 99 of 106 screens share: `<main style={pageStyle}>`, an `<h1>` over a `<p style={{ opacity: 0.75 }}>`, a hand-rolled `<table>` with its own borders and minimum width, `<p role="alert" style={errorStyle}>`, and a bare `<p>` for loading. **EVERY TRANSFORM IS A REAL DEFECT RATHER THAN A RENAME** — `opacity` as muting is what `globals.css` itself bans and is the cause of this product's recorded contrast regression; a hand-rolled table carries its own `minWidth`, so no two screens agreed when one starts scrolling and some had NO scroll container at all; the raw spacing values are off the owner's five-step scale. **IT IS EXACT-MATCH AND IT REFUSES**: a file where a transform it was told to apply does not match is handed back WHOLE rather than half-converted. **WHEN IT REFUSES A SCREEN, CONVERT THAT SCREEN BY HAND — do not loosen a transform to make it land.** Every one of its five recorded defects was a pattern crossing a boundary it should not have: a non-greedy DOTALL body that ate three neighbouring declarations, a quote style taken from the file's JS when JSX attributes use double quotes whatever the surrounding code does, two table shapes that could both partially fire, a cell pattern that skipped every ATTRIBUTED cell while still converting its closing tag, and a row closer that assumed the line above it. **It does NOT do the judgement half** — what a screen is for, what belongs in which group, which badge carries a meaning — and must not grow to. **DRIVE A GROUP WITH REVERT-ON-FAILURE**: convert, typecheck ONCE, revert exactly the screens `tsc` names, repeat until it is quiet. That covers the half refusal cannot — a file the converter RECOGNISES and gets wrong — and leaves it untouched for hand work rather than half-converted |
| `python scripts/measurements/design-pass-sections.py <screen>…` | **A SCREEN'S `<section>` BECOMES A `Card` WITH A TITLE, AND ITS TABLES BECOME `Table`** (exits non-zero; a tool, not a gate). The crowded screens are a different shape from the list screens its sibling handles: SIX sections on one page, each a bare `<h2>` over a table that brought its own borders and its own minimum width, so a reader met three different horizontal behaviours on one page. **BOTH CLOSING TAGS ARE FOUND BY PAIRING WITH A DEPTH COUNT, never by a blanket replace** — `</section>` and `</tr>` both nest, and a screen where one converts and another does not would get a `</Card>` closing a `<section>`; it REFUSES if the number closed does not equal the number opened. **It does not touch imports** — run `design-pass-imports.py` after it. **THE ORDER IS `convert` → `sections` → `imports`**: the first two each add their own `components/ui` block and neither is idempotent, while the third MERGES and is |
| `python scripts/measurements/design-pass-imports.py <screen>…` | **ADDS WHAT A CONVERTED SCREEN NOW NEEDS AND DROPS WHAT IT NO LONGER DOES** (exits non-zero). Separate from the converter deliberately: a tool that rewrites markup AND imports has two ways to go wrong per file and only one of them is visible, because an unused import is a lint WARNING while a missing one is a compile ERROR. What it adds is measured from the file's own markup, so a screen with no empty state does not acquire an unused `EmptyState`. **THE REMOVAL SWEEP ITERATES**, because these declarations depend on each other — removing `head` is what MAKES `cell` unread, so a single pass clears one and leaves the other. Comments are stripped before counting |
| `python scripts/measurements/design-pass-dead-consts.py` | **STYLE CONSTANTS NOTHING READS ANY MORE** (exits non-zero if it matches nothing). Once a screen's cells become components, its local `const cell: CSSProperties = {…}` has no reader — and an unread constant is a lint WARNING rather than an error, so it ships quietly and tells the next reader the screen still hand-rolls its table. **REMOVAL IS CONDITIONAL ON A MEASUREMENT, never on the name**: the identifier must appear exactly once in the file, which is its own declaration, so a constant another constant spreads into is never touched. **COMMENTS ARE STRIPPED BEFORE COUNTING** — a comment quoting the name defeated the first version, which is `check:css-properties`'s own recorded limit recurring in a second tool |
| `node scripts/playwright-specs.mjs <filter>…` | **A GUARD ON YOUR OWN TEST COMMAND** (exits non-zero). Resolves Playwright spec filters and refuses any that matches no file. `npx playwright test a.spec.ts settings` runs `a.spec.ts` and SILENTLY IGNORES `settings` — the screens are at `app/(app)/settings/…` but the specs are `roles.spec.ts`, `users.spec.ts`, `org-units.spec.ts`… Playwright does not warn, the run passes, and the coverage claim is false. That happened in three reported runs before CI caught the one real regression hiding behind it (IMPROVEMENTS § 1.85). Feed it to Playwright: `cd apps/web && CI=1 npx playwright test $(node ../../scripts/playwright-specs.mjs roles users org-units)` |
| `npm run db:permission-catalogue` | **A GENERATED DOCUMENT, not a gate.** Writes `docs/permission-catalogue.md` — all 219 codes with the stored English description and **the roles that hold each one**, read from the seeded database. Built for the owner, who writes the Arabic descriptions and has no repository access: a hand-listed catalogue drifts the first time a code is added, which happened twice in one week (`customer.read`, `diagnostics.view`). The roles column is the point — a code held by one role is described differently from one held by ten. Its sibling `docs/permission-catalogue-for-descriptions.txt` is the file to TYPE INTO; this one is for reading |
| `python scripts/measurements/b7-coverage.py` | **A GATE-SHAPED MEASUREMENT** (exits non-zero). Every screen under `app/(app)` against the screens `docs/b7-consistency-record.md` NAMES in a batch — currently 102 of 102, batches 4-9. It exists because batches 1-3 reported coverage in conversation and never wrote it down, producing a "76 of 102 remain" figure that could not be substantiated: files TOUCHED is recoverable from git, screens READ is not, because a screen read and found correct touches nothing. Its own first version could not match `(home)` and reported 101 — a verification instrument with a false negative is worse than none, because the number it produces looks like a finding |
| `python scripts/measurements/four-states.py [<screen>…]` | **A MEASUREMENT, NOT A GATE.** Rules 1 and 3 per screen: which of the four non-data states each has, and every form/table offset so rule 1 can be read per PAIR. **Supersedes `b7-survey.py` for rule 1**, because it tells a CREATE form from a FILTER form and compares them separately — the distinction that hid two real violations. Its header carries four false-positive classes, every one found by READING rather than by the script: a table inside a rendering helper above `export default`, an error state not named `loadError`, a state living in a child component, and the filter-masks-create case. It follows local component imports one level deep, which fixes the empty-state count without making it reliable — a state two components down is still invisible |
| `python scripts/measurements/load-error-way-forward.py` | **GATED** (via `apps/web/test/screen-copy.test.ts`). Rule 3's fourth state is TWO things — "something went wrong" AND the way to retry — and only the first half had ever been measured. Every load-error message must name a way forward in BOTH languages; 109 of 109 do. **Zero screens in the app have a retry CONTROL**, so the sentence is the only way forward there is. Its first version keyed on the shared `commonTryAgain` and reported 4 of 102 — true and useless, because 98 screens use a screen-specific key and almost all say "try again" in their own words |
| `python scripts/measurements/unreachable-routes.py <out.json>` | **A MEASUREMENT, NOT A GATE — nothing runs it automatically.** Every api route (480) against every web client path shape (345), reporting routes no web code addresses. This is the finer grain of `IMPROVEMENTS.md` § 1.44, which measured by controller prefix and therefore could not see a route hiding behind a called sibling. Re-run it deliberately and **read the output rather than the count**: it needed four corrections before it stopped reporting live screens as unreachable (nested template literals put all six dashboards in the list), and its own header records those failure modes so the next run starts ahead. Not gated precisely because of that history — a matcher with four corrections behind it does not belong behind a red build |
| `npm run db:studio` | Prisma Studio (dev DB) |
| `npm run db:seed` | **It also gives EVERY organization a default branch and a default department (item 1 half b), by sweeping `organization.findMany()` rather than naming ids — the call that named ids sat inside an `if (!existing)` branch, was unreachable on every seeded database, and produced nothing for days. `from-empty.sh` asserts it as a ZERO: organizations with no branch = 0. Re-run after changing seeded data and MEASURE THE DELTA — the last two runs touched only Branch +3, Department +3 and SlaHoliday +8, leaving users, customers, policies, audit rows and the one paired authenticator untouched.** Seed the dev DB — the default office's roles + the global permission catalogue (`packages/db/prisma/seed.ts`), idempotent. Roles are OFFICE-SCOPED as of 2026-09-18; a role name is unique per `Organization`, not globally |
| `npm run db:test:seed` | Same seed, against `db-test` |
| `npm run db:fixture:permissions` | Regenerates `apps/web/e2e/fixtures/role-permissions.ts` — the THIRD copy of the role→permission grid, which Playwright mocks `/auth/me` from — by reading the **seeded database** rather than `permissions.ts`. The database is what `/auth/me` answers from, and the two differ exactly when something has gone wrong (a code added after an office was created; a grant the seed upserts but never removes). The fixture header claimed to be generated for months while no generator existed |
| `npm run db:fixture:permissions:check` | The same, writing nothing and failing if the fixture is stale — a `verify.sh` gate (the `db:test:` variant, run straight after the seed gate). A stale copy renders an empty nav, because the sidebar helpers fail CLOSED, and has already broken four Playwright tests in three unrelated files. **Read the first `git diff` of any regeneration:** this generator's own first run silently dropped `permissionsForRoles()`, an export 86 spec files import, and passed `tsc` doing it |
| `npm run seed:demo -w api` | Demo data for two Organizations — employees, leads, ~500 customers, full sales-to-policy pipelines, insurers registered BOTH ways (catalogue-linked and office-local), and one insurer deactivated while holding live commitments — created through the real HTTP API, **dev DB only** (never `.env.test`). **`DEMO_PASSWORD` is required and has no default**; the run refuses to start without it and no longer writes it into `seed-demo-report.json`. Scale is env-configurable; accounts come back with MFA off, so sign in with the password and pair an authenticator at Settings → Security — the run **fails, naming accounts**, if any is left enrolled with a secret nobody holds. It also re-asserts the duplicate-spelling refusal that `docs/first-run.md` § 9 asks a reader to try. See `apps/api/scripts/README-SEED-DEMO.md` |
| `npm run demo:release -w api` | Clears `MfaCredential` rows and `mfaEnabled` for `demo.*@*.ibms.internal` accounts, so the next sign-in takes the ordinary forced-enrolment path. The repair for *"I entered the correct code and it says the code is wrong"* — an account the seed enrolled with a TOTP secret that lived only inside that process. Refuses to run against `ibms_test`, and deliberately does NOT touch passwords |
| `npm run sample:release -w api` | **MEASURED 2026-10-19: NOTHING IS LOCKED ON DEV — all eleven `sample.*` accounts hold ZERO `MfaCredential` rows with `mfaEnabled=false`, so this is a no-op there. What makes them cost TWO steps is `mustChangePassword=true` — the schema default this script deliberately does not touch: login answers `MUST_CHANGE_PASSWORD` with an onboarding token and no session, and `POST /auth/password/force-change` is the second step, proven 28/28 over HTTP. The EIGHTEEN `demo.*` accounts cost ONE step.** The same repair for `sample.*@ibms.internal`, which `demo:release` **cannot touch** — its `where` clause matches the `demo.` prefix only, so against a database where only `sample.*` is locked it reports *"No demo account is locked"* and changes nothing. Different cause, same symptom: these credentials came from real enrolments during the build (`UserSession` shows Chrome 151/152 sessions 2026-08-26 → 2026-09-09), not from the seed — `sample-users.ts` sets no MFA at all. Matches on the email SHAPE so it is repeatable; refuses `ibms_test`; does not touch passwords or `mustChangePassword` |

**`migrate dev` is still not the way to add a migration here, and the reason has changed.**
It used to be blocked by checksum drift (five drifted migrations, now normalised — IMPROVEMENTS.md
§ 1.29), so "the drift is fixed" reads like an invitation to go back to it. It is not:
`schema.prisma` deliberately describes LESS than this database enforces, because Prisma's schema
language cannot express a STORED generated column, a GIN index on an `Unsupported("tsvector")`
field, or a composite tenant foreign key. `migrate dev` would generate a migration containing
exactly the statements `db:divergence` enumerates — dropping four GIN indexes and un-generating
five columns, `Insurer.canonicalName` among them. Hand-write the migration, apply it, then
`prisma migrate resolve --applied`; run `db:checksums` afterwards, because resolve stamps the
file's hash at that moment and any later edit to it drifts.

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
- **`scripts/provision-app-role.mjs`** (multi-tenancy Phase 2 step 8) — creates
  `ibms_app`, the NON-OWNER database role the running API connects as. Postgres
  exempts a table's owner from that table's own row-level security policies, so
  connecting the API as the migration role would leave all 118 policies silently
  inert; this role owns nothing and is therefore subject to every one of them.
  Deliberately a script rather than a migration: a Postgres role is
  cluster-level, creating one needs `CREATEROLE`, and its password is a
  credential that must come from the environment.
  `APP_DB_PASSWORD=... npm run db:provision-app-role`. Idempotent — re-running
  updates the password. Must run BEFORE the migrations, which GRANT to the role
  and refuse to run without it. See `docs/multi-tenancy-rls.md`.
- **`scripts/generate-sla-policy-seed.ts`** — regenerates
  `packages/db/prisma/seed-data/sla-policies.ts` from `sla-policy-source.config.ts`, so
  the seeded SLA baseline and the governing-source table it is derived from cannot drift
  apart by hand-editing one of them. Arrived with the configurable SLA engine.
- **`scripts/backup-restore-drill.sh`** (A.10, Part 10.4/10.5) — dumps a database
  (`db-test` by default — never dev/prod automatically), encrypts the dump
  (AES-256-CBC), decrypts and restores it into a throwaway database, verifies the
  restored row count matches the original, and fails if the whole cycle exceeds the RTO
  target (`RTO_TARGET_SECONDS`, default 900s). Requires `BACKUP_ENCRYPTION_KEY` in the
  environment. `npm run db:backup:drill` runs it. See
  `ibms-brain/meta/lex/backup-rpo-rto.md` for the RPO/RTO targets this is testing.
  The row-count check counts **every row per table** (`query_to_xml` + `count(*)`).
  It used to sum `pg_stat_user_tables.n_live_tup` after an `ANALYZE`, on the stated
  grounds that this made the comparison exact — it does not. `ANALYZE` samples, so
  that number stays an estimate, and the drill was comparing two estimates and
  reporting any drift as data loss. Measured on a single database with no restore
  involved: the estimate said 4,142,466 rows and the true count was 4,141,630. The
  exact count runs after the RTO clock stops, so verification time is never charged
  against the restore target.

## CI

`.github/workflows/ci.yml`, three jobs, plus two standalone workflows:

1. **frontend** — installs, then: typecheck → lint → unit/component tests (Vitest +
   Testing Library) → installs Playwright's Chromium → accessibility (`test:a11y`,
   axe-core, `@a11y`-tagged specs, evidence is 0 serious/critical violations) → e2e
   (`e2e`, functional Playwright flows) → build → security (`test:security --workspace web`
   — dependency audit, LAST in the job and `!cancelled()`, so it can neither hide a gate nor
   be hidden by one). Uploads the Playwright HTML report as an artifact on every run
   (including failures).
2. **backend** — installs, then: typecheck → lint → unit tests → security
   (`test:security --workspace api` — dependency audit, SCOPED to this job's own workspace
   since 2026-10-11; unfiltered it audited the whole monorepo, so a front-end dev
   dependency's advisory failed a check named `backend` while the `frontend` job audited
   nothing) → spins up an ephemeral `postgres:18-alpine` service container
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

It generates an **ephemeral per-run passphrase** when no
`BACKUP_DRILL_ENCRYPTION_KEY` repository secret is set, which is the normal case
and the right one: the drill proves the round trip (dump → encrypt → decrypt →
restore → exact row-count parity, inside the RTO target) against a throwaway
database holding nothing but the seeded role/permission grid. A long-lived repo
secret would add a credential to a job with no real data to protect and still
would not exercise the production key-management path. Setting the secret
overrides the ephemeral passphrase if you want that path exercised too. See
`ibms-brain/meta/lex/backup-rpo-rto.md`.

**This drill failed every scheduled run from 2026-08-31 to 2026-09-14** — three
stacked, independent faults, each hidden behind the one before it:

1. **The seed crashed.** Nothing in this job ever ran `prisma generate`: `npm ci`
   has no postinstall hook, and unlike `ci.yml` this workflow runs no turbo task
   (turbo's graph builds `@ibms/db`, which is where `ci.yml` quietly gets its
   client). `RoleName` was `undefined` and the seed died on
   `Cannot read properties of undefined (reading 'SALES_RELATIONSHIP_OFFICER')`.
2. **No passphrase existed.** `BACKUP_DRILL_ENCRYPTION_KEY` was never set on this
   repository, so the drill step would have exited 1 even once the seed was
   fixed.
3. **The verification compared estimates**, not counts — see the
   `backup-restore-drill.sh` entry above. This one only became visible once the
   first two were fixed and the drill could reach its own summary.

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

## Logging (Part 10.3/10.4)

`apps/api` uses **pino** (`nestjs-pino`) for structured operational logs — request
traces, debug output, error stacks. Config is one pure, unit-tested function,
`buildLoggerParams()` in `apps/api/src/common/logging/logger.options.ts`
(wired by `LoggingModule`, and `app.useLogger()` in `main.ts` so every
`@nestjs/common` `Logger` call routes through it too).

- **This is not the audit trail.** The immutable business `AuditLogEntry`
  (`apps/api/src/modules/audit`, Postgres, DB-level immutability trigger) is the
  legal/compliance record. These logs are for engineering incident triage.
- **Bodies are never logged.** The custom `req`/`res` serializers emit only
  `id` / `method` / `url` / `remoteAddress` / `user-agent` and `statusCode` — no
  headers, no request/response body, ever. On top of that, `redact` scrubs
  `Authorization`/`Cookie` and known secret/national-ID/contact-field keys to
  `[redacted]`. This is the mandatory `ibms-brain/meta/lex/sensitive-data-handling.md`
  rule ("a logging pipeline is exactly such an unencrypted, wide-retention,
  wide-access channel").
- **Correlation.** Every request gets an `x-request-id` (reused from the inbound
  header if present, else generated) echoed on the response and attached to every
  log line for that request, plus `userId` (id only, never email) once
  authenticated. `/health*` probes are not logged.
- **Where it goes.** Console only in local dev (pretty-printed). `NODE_ENV=production`
  — or `LOG_TO_FILE=true` anywhere — also writes daily-rolling JSON to
  `LOG_DIR` (default `<repo>/logs`): `api.<date>.<n>.log` (all levels, ~14 kept)
  and `api-error.<date>.<n>.log` (errors, ~30 kept). `LOG_LEVEL` (default
  `debug` dev / `info` prod) sets the floor. Under vitest the logger is forced
  silent with no transports or files. See `logs/README.md`.

## Scope status & known gaps

**Both sections moved to [`docs/scope-and-gaps.md`](docs/scope-and-gaps.md) on 2026-10-30** — 11,434 lines, 94% of this file, which a person who had just cloned the repository had to scroll past to reach anything useful.

Read it before assuming anything is or is not built, and read its opening box first: **every absence claim there carries the date it was measured, and one older than the current module is re-measured rather than believed.** This file once said the Policy module was not built while it shipped twelve routes.

## Deployment

**Not decided.** Docker images build correctly and can run anywhere that accepts a
container; nothing here assumes AWS, Azure, Fly, Render, or any other target. Record the
decision in `ibms-brain/meta/designs/` the day it's made, and update this section in the
same change — including enabling encryption at rest on whatever managed database/object
storage is chosen (see § Security above).
