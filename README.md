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
NOT implemented — see `docs/scope-and-gaps.md` § Known gaps) and maker/checker approval, a
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
**`docs/scope-and-gaps.md` § Scope status is the authority, not this summary.** Part G's final verification
checklist is **complete** — all seven items closed, each guarded by a test that fails when
the property stops holding. See `docs/scope-and-gaps.md` § Scope status
for the full picture and its § Known gaps for the
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

# `deploy`, NOT `dev` — CORRECTED 2026-11-04 after walking this on a genuinely fresh cluster.
# This line said `npm run db:migrate:dev`, and that command APPLIES all 164 migrations correctly
# and then asks «Enter a name for the new migration» — because `schema.prisma` cannot express
# several things the migrations create, so `migrate dev` reads them as drift to be undone. The
# migration it offers to write DROPS 16 foreign keys (15 of them the cross-tenant
# `*_same_org_fkey` integrity constraints), the 3 GIN full-text indexes, and 6 generated-column
# definitions. Type a name, press enter, and tenant isolation is quietly weakened on your machine.
# `migrate deploy` only applies what is pending: it never prompts and never diffs against
# `schema.prisma`. Verified on a fresh cluster — 164 applied, 138 tables with RLS (12 FORCEd),
# all 15 `same_org` FKs present.
npm run db:migrate:deploy

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

### The decision register — what an `OWNER DECISION <n>` comment means

**`docs/decision-<n>-<slug>.md` says what each one is; `ibms-brain/meta/decision-index.md`
indexes all of them.** Landed 2026-11-08, **48 files and 48 rows** — 47 of each on the day it landed, and decision 33's closed the same day (see below).

It exists because `OWNER DECISION 48` is cited **74 times across 57 files** and, until that
date, there was no file anywhere saying what decision 48 was — so the only way to learn one
was to ask the owner, whose standing instruction is that nobody should have to. Each file is
five sections: the decision in one sentence, a worked example, **the rejected alternative and
why**, where it is live today, and what somebody changing it must know. The index carries each
decision's own sentence beside its number, so a reader who only needs the gist never opens a
file, and a «قُرِّر ولم يُبنَ» column marks the four that are decided-but-not-built —
decisions **9, 20, 46 and 122**.

**The split is deliberate and it is one home per fact: the texts are here, the index is in the
brain, and the index links rather than restating.** `docs/` is where the precedent already
lived (eight `decision-*.md` files predate this); the brain is what gets read first.

Three things worth knowing before touching any of it:

- **`npm run check:decision-index` gates it in both directions** and is part of
  `npm run check:docs`, so it runs in CI. A number cited with no file is a defect, not a
  backlog item.
- **Decision 33 had no file for the whole life of the register, and the reason was a matcher's shape rather than anybody's oversight.** It is cited in **ten places** and appears ONLY inside the phrase `decisions 32 and 33`, never once on its own — so every matcher anchored on the word `decision` immediately before a number read the `32` and was blind to the `33`. **Never narrow `CITE_TAIL` back to the first number.** Its file landed 2026-11-08 (the owner's words; it is register content, not engineering), and the gate then went red naming its own `KNOWN_MISSING` declaration as stale, which is the one proof a declaration list cannot rot. **And one of those ten sites hid the same way, one level down**: `retention-notice.config.ts` breaks the citation across a line inside a block comment, so every literal search finds nine. **Its file's figure of ٩ is therefore CORRECT and not a typo** — nine is what the method it declares finds — and
  `WRAPPED_CITATIONS` declares the tenth site and asserts it, so joining that line makes
  the ٩ a real error and the gate names it. `CITED_ONLY_JOINTLY` carries the method itself,
  needed because the narrow `decision 33` measures zero.
- **Decision 98 has a file and deliberately no row** —
  `docs/decision-98-widened-and-concentration.md` is a 288-line English measurement record
  rather than a five-section decision file. It is the one place the index's own *every number
  has a row* sentence covers **48 of 49**. Whether 98 gets a five-section file and a row or
  the sentence names it as the exception is the owner's — both answers need Arabic written.

**A citation count stated inside a decision file is gated, so correct the digit and never
re-word the noun around it.** **Twenty** files declare their own counting method and close
it with «ورقمُ من يُعيدُه يغلب رقمي» — *the figure of whoever re-runs it beats mine* — which
is the authority for changing one. But crossing 10 → 11 changes «مواضع» to «موضعاً», and
that is Arabic morphology, which is the one operation nobody here may perform on the
owner's behalf.

Two things about that gate are worth knowing before you trust a figure it passed:

- **It was blind to every count below 11 until 2026-11-08.** `CLAIM_FOOTER` hardcoded the
  singular accusative «موضعاً», which only the 11–99 band takes, so a correct figure of 3 to
  10 — which takes the genitive plural «مواضع» — was never checked at all. Every figure
  corrected in the batch that built the gate happened to be ≥ 11, so the gap never showed;
  decision 33's was the register's first count in the lower band. **The gate whose own error
  message says *correct the digit and never re-word the noun* could not see the other noun
  form.** Both are read now and `--self-test` plants the plural shape.
- **«٢ موضعاً» in decision 52 is WRONG AND KEPT, by the owner, 2026-11-08.** Two takes a
  DUAL. It was reported rather than corrected because correcting it is morphology, and her
  answer was *«ما بيفرق، خليه زي ما هو»* — leave it. **So it is a recorded decision, not an
  uncorrected error: do not "fix" it.** The gate does not and must not check grammar — it
  checks that a stated figure equals the measurement — so nothing flags it, deliberately.

### The module papers — what gets built, module by module

**`docs/modules/` holds 22 papers: one index plus one per module** — م١–م١٩ plus two
cross-cutting ones, م-أ (validation, Arabic refusals, UI) and م-ب (currencies and reference
lists). Landed 2026-11-08. Each paper is seven sections in the same order: what the module is
with a worked example, where it sits in the dependency order and why, **its open questions with
who answers each and whether it blocks the module or one item**, what gets built item by item,
its screens, what "done" means and what must fail if the fix is removed, and what is forbidden
in it.

**Filenames are English kebab-case; each paper's title inside is Arabic with an English line
under it.** `00-index-order-assignment-and-questions.md` carries the filename-to-module map, so
start there rather than guessing which file is which module.

Three things to know before you use them:

- **They are register content. Report an error; do not correct it.** The papers are the owner's
  and are byte-identical to the archive they arrived in. A measurement in them that disagrees
  with the code is reported with the counting method beside it, which is why § 2-ب of the index
  carries a *measured from the code* table at all.
- **No gate reads them, and none needs to.** `check:decision-index` cannot see them:
  its file discovery is a non-recursive `os.listdir(docs)` filtered on `startswith("decision")`,
  and its citation scan is `git ls-files apps packages`, so `docs/` is never read. Verified
  2026-11-08 — the gate's figures are unchanged by these papers (it reads **49 cited / 49 files /
  49 rows** as of 2026-11-08, once decision 98 gained its row). Do not add an exclusion for them;
  there is nothing to exclude.
- **Six rows of the index's measured table were re-derived, disagreed, and are now CORRECTED IN
  THE PAPERS** — with what each row said before and what it says now, each beside its command, in
  the index's own dated block. The two worth knowing before you plan from the table: **module 15's
  screening has run** (six succeeded watchlist syncs, 61,434 entries, one screened KYC record with
  an OFAC hit, measured on the dev database 2026-11-08), and **`RFQ` is a built entity** at
  `packages/db/prisma/schema.prisma:2481` with 89 rows on dev, not a gap. Re-measured 2026-11-08
  and both reproduce.
- **Every paper names its holder in an empty table at the top, and an empty one is a signal**
  rather than an oversight. Until a name is written there, that module has nobody accountable for
  its decisions — and the module holder is the person who asks the outside questions (a practising
  broker, a lawyer, the Central Bank) and writes each answer up as a decision file, rather than
  waiting for management to answer an operational question.
- **`docs/modules/` holds 26 `.md` files, of which 22 are the module papers** (the index plus one
  per module). **Corrected 2026-11-10: this said 24, which was stale by one before this batch and
  by two after it** — `ls docs/modules/*.md | wc -l` is the figure. The other four are
  `00a-day-one-setup-and-verification.md` and `00b-start-here-from-zero.md` (both below),
  `module-walkthrough-provider-to-first-policy.md`, a 3,001-line field-by-field walkthrough of the
  built system measured on 2026-11-03, and `module-01-opening-measurement.md` (next bullet).
  **That walkthrough is the fastest-rotting document here** — it names specific Arabic labels, and
  one had already changed before it landed — so whoever closes module م-أ re-measures it as part of
  that delivery.
- **A module's FIRST delivery is a measurement paper, not code, and module 1's has landed:
  `module-01-opening-measurement.md` (2026-11-10).** The module's own rule is
  «كل مديول يفتح بقياس، والقياس أول تسليم», and the template is `00a` § 5 قالب ١. **Read it beside
  `module-01-declared-action-and-legal-values.md`, never instead of it** — it re-measured that
  paper and three of its items came out differently: **§4.5's declared duty-segregation mode is
  fully built and guarded in CI** (16 CHECK constraints each with one escape disjunct, a trigger on
  `CombinedDutyAct`, a 713-line design doc), **~~half the legal-values table already exists as
  `SlaPolicy`~~ — CORRECTED 2026-11-11, and the correction is the whole of module 1's first build:
  `SlaPolicy` has all four of the columns §4.2 asks for and still CANNOT hold a legal value.** It is
  tenant-scoped NOT NULL, so a PROVIDER row cannot exist in it, and decision 123's subject is whose
  row this is; its `@@unique([organizationId, policyCode])` stops a superseded value sitting beside
  its replacement, which is precisely what criterion 3 needs. So the table is `LegalValue`
  (migration `20261216100000`), with `organizationId` NULLABLE and NULL meaning provider-owned —
  **13 provider rows seeded, each carrying its article AND the printed page it was read on**, and
  three office-owned codes with their shape, their guards and NO VALUE. The departure from the
  12-October intention («التاسع من عائلة الجداول المرجعية، لا نمطاً ثانياً») is recorded in the
  module-1 paper with its three measured reasons. And **the geographic partial
  suspension of art. 21/b/6 is not expressible at all** because `branchId` is carried by
  `Employee`, `SalesTarget` and `User` only and `Branch` has no country. **The papers stay the
  owner's to correct** — the measurement reports against them and changes none of their text, which
  is why the corrections live in that file rather than in theirs.

### Day one — `docs/modules/00a-day-one-setup-and-verification.md`

**Read it before installing anything.** It routes to this README for setup rather than restating
it, and spells out in full only the two steps where a wrong move is silent: `db:provision-app-role`
before the first migration, and `migrate deploy` rather than `migrate dev`. Every figure in it
carries the command that produces it, so a figure that disagrees with your machine is the paper
being wrong, not you. Re-run its commands rather than quoting it.

### The source documents — `docs/legal/`, `docs/forms/`, `docs/answers/`

**Every law, instruction, form, dictionary and verbatim answer this product was built from.**
23 files, landed 2026-11-08; until then they lived outside the repository, where nothing in CI
could see them and nothing could tell you one had gone stale. `docs/legal/00-index-sources.md` is
the map — what each paper is, which module needs it, and the standing rules.

- **They are SOURCE TEXTS. Report an error; never correct one in place.** Editing a source makes
  it lie to the next reader while still looking original. OCR garbling, typos and spoken dialect
  are preserved deliberately — they are the record.
- **Three gaps bound what can be built, and all three are stated up front in the index.** Eight
  numbers in Instructions No. 9 of 2026 are unreadable in the extraction — including the
  instrument's own effective date, on which every Article 23 transition deadline is computed, so
  **an unreadable number is built configurable and never hard-coded**. Article 15(e)(2) is missing
  from the extraction entirely, and 15(e) is the mandate rule, so nothing may be built on it until
  a text copy is obtained. And **14 provisions are referred by the instrument itself to a later
  decision of the Central Bank** — commission bases and caps, professional-indemnity terms, every
  application form, the periodic-return dates — which belong in configuration, because
  hard-coding them builds something that will be rebuilt.
- **`check:markdown-tables` declares two of them** in `SOURCE_TRANSCRIPTIONS` with their measured
  malformed-row counts, because their commentary cells quote scanner output containing literal
  pipes. The declaration is checked in both directions, so it cannot go stale — and a bare
  path-prefix skip was deliberately not used, since it would have swallowed every future table
  anybody writes in `docs/legal/`.

### `.claude/` — agents, commands, hooks

Claude Code only discovers `.claude/agents/`, `.claude/commands/`, and `.claude/settings.json`
at a session's own project root — not inside a nested git submodule — so this repo carries
its own `.claude/` rather than relying on `ibms-brain/.claude/`:

- `.claude/agents/{code-reviewer,software-developer}.md`, `.claude/commands/brain-gap.md` —
  mirrored from `ibms-brain/.claude/{agents,commands}/` by
  `.claude/hooks/mirror-brain-agents.sh` (a `PostToolUse` hook on Write/Edit). Don't hand-edit
  these files — the hook overwrites drift on the next Write/Edit.
- `.claude/settings.json` wires **four** of `ibms-brain`'s six `PreToolUse` hooks directly
  against the submodule path. **Run `npm run check:hook-registration` rather than reading this
  paragraph** — it is the authority, it fails in both directions, and it carries the measured
  reason for every hook that is *not* wired along with the command that proves the claim.
  As at 2026-11-07:

  | Hook | Here? | Measured before the decision |
  |---|---|---|
  | `enforce-credential-safety.sh` | **runs** | `PreToolUse/Bash`. Untouched by owner instruction — nobody reads credential values and nothing may weaken it. |
  | `enforce-workspace-updates.sh` | **runs** | `PreToolUse/Bash`. Blocks a commit staging developer-facing files without `CLAUDE.md` + `README.md`. |
  | `enforce-money-decimal.sh` | **runs** (new) | Blocks **0 of 1,712** tracked `.ts`/`.tsx` files, so it refuses nothing already correct. Wired only after `tax` and `fees` were added to its word list. |
  | `enforce-sensitive-data.sh` | **runs** (new) | Blocks **0 lines in 1,861** tracked files, raw or tokenised. No CI gate answers this question. |
  | `enforce-state-transitions.sh` | **no** | Would block **63 of 1,861** files, none of them a violation: ~40 test fixtures, 2 filter builders (`where.status = filter.status`), the rest writing `status` on entities the lex does not govern. Structural — the lex names the governed entities and a hook seeing one edit cannot resolve that list. Gated properly in CI by `apps/api/src/modules/workflow/status-writes.inventory.spec.ts`. |
  | `enforce-evidence.sh` | **no** | Blocks `git push` unless `artifacts/<sha>/gates.json` exists; `scripts/verify.sh` never writes it and there is no `artifacts/` directory, so it would block every push with no way to satisfy it. |

- **A configured guard that is missing now FAILS the action rather than passing it.** Every
  registration used to end `[ -f "$script" ] && exec bash "$script" \|\| true` — so a deleted or
  renamed hook exited 0, indistinguishable from a clean pass. They now exit **2** with a named
  message. The one deliberate exception, decided 2026-11-07, is an **uninitialised submodule**:
  if `ibms-brain/.claude/hooks/` is absent entirely (measured 2026-11-07 — the directory is the
  signal, not the individual file) the wrapper warns and exits 0, because exiting 2 there would
  block the very `git submodule update --init --recursive` that fixes it.
- **And they run through `bash "$script"`, never `exec "$script"`.** Every hook in the brain was
  recorded in git as `100644` until 2026-11-07 — `core.filemode` is `false` here, so the local
  `rwxr-xr-x` is not what a fresh clone gets. The brain's own registrations tested `[ -x ]` and
  fell through to `\|\| true`, which means **on CI or a colleague's machine all six of its guards
  would have silently done nothing.** The modes are recorded `100755` now and
  `check:hook-registration` fails if one regresses.
- **Known gap, narrowed:** `enforce-credential-safety.sh` still parses the tool-call JSON with
  an inline `python3` whose failure path is `2>/dev/null`, so on a machine where `python3` is a
  stub and no real `python` exists it no-ops instead of blocking. The other three wired hooks
  now refuse to run without an interpreter. That one is left exactly as it is **by owner
  instruction** — it is one of the two guards that has always run, and this batch may not
  weaken it; changing how it parses is a separate, deliberate decision.

## Scripts (run from repo root; Turborepo fans them out per workspace)

| Command | Does |
|---|---|
| `npm run dev` | `next dev` + `nest start --watch`, in parallel |
| `npm run build` | Production build of every workspace (`@ibms/db` generates the Prisma client first) |
| `npm run lint` | ESLint, per workspace |
| `npm run typecheck` | `tsc --noEmit`, per workspace. **RUN IT ON A SPEC FILE TOO — NEITHER VITEST NOR ESLINT TYPECHECKS, and this repository has paid for that twice.** Batch 1's first red CI run was a `TS2339` in a spec whose local body type was missing a field, with the suite green and lint clean. Measured again 2026-11-05: `cookies.util.spec.ts` compiled to **three `TS2307` errors** while 13/13 tests passed and eslint reported nothing. **The cause is worth knowing because it is invisible by inspection**: `apps/api` sets `module`/`moduleResolution` to `nodenext`, which applies **ESM resolution rules to a DYNAMIC import only** — so `await import('./x')` demands the `./x.js` extension while the `import … from './x'` at the top of the same file resolves fine. In a test, prefer **`vi.importActual<T>('./x')`**: TypeScript performs no module resolution on its string argument, its generic gives the result a real type (removing the `any` the type-aware lint rules object to), and *load the real module bypassing mocks* is the right semantics for re-reading a constant frozen at module load. **And plant it** — three passing re-import tests prove nothing if the module was cached; dropping `vi.resetModules()` must kill one of them |
| `npm run test` | Vitest unit tests (web + api). **RUN THE WEB UNIT SUITE LAST, AFTER ANY PLAYWRIGHT SPEC YOU WROTE — IT IS WHAT STATICALLY GOVERNS EVERY `e2e/*.spec.ts` IN THIS REPOSITORY.** `apps/web/test/` holds static guards that READ the e2e specs as text rather than running them: `e2e-anchored-reads.test.ts` (an absence assertion must have a positive anchor before it, in the SAME test block), `negative-nav-assertions`, `page-wide-absence`, `status-code-only-assertions`, `data-attributes.test.ts`. **So the web unit suite is a gate on test code, and running it before you write a spec answers a different question from running it after.** Measured 2026-11-05: CI went red at `frontend` step 22 on a new Playwright test whose anchor sat inside a helper — invisible to a block-scoped guard — after a local run of the same suite had passed because it was taken BEFORE the spec was written. **For an absence, use `expectNone(target, anchor)` from `e2e/support/anchored`, and take the anchor FROM THE SAME RENDER as the absent thing** (for a conditional swap, the element that appears is the anchor for the element that goes) — that is the rule that helper's own comment states and explicitly cannot enforce for itself. An anchor hidden in a helper also disappears silently the day the helper is edited |
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
| `npm run check:absence` | **A RATCHET ON THE ONE ABSENCE SHAPE THAT CAN MATCH AN UNRELATED ELEMENT** (exits non-zero; a CI step in the `frontend` job). A page-wide `expect(page.getByText(x)).toHaveCount(0)` matches any text anywhere: a role-name absence loop on one notice matched "Compliance" in the NAV SIDEBAR and failed on a correct tree — the FOURTH time that trap was paid for, one commit after the rule forbidding it was written down. Measured: **191 page-wide absence assertions**, so a flat ban is a red build across 54 files, and `getByTestId`'s 58 are unique by construction and not the trap. The ratchet is the TEXT class alone — **42 across 23 files** — failing in BOTH directions so the budget cannot become a ceiling. **COMMENTS ARE BLANKED BEFORE MATCHING as of 2026-11-07 (module 0-c batch 6b), because a comment that QUOTES a page-wide absence was counted as one** — found by tripping the gate: a comment explaining an `expectAbsentWithin` fix, written beside the fix, took the class to 43, so the only way to satisfy the gate was to stop explaining the fix. Same blindness already recorded against a JSX depth counter and a `$queryRaw` call-site count, and `literal-colours.py` already had the treatment. **AND A CORRECTION OF MY OWN, THE SAME DAY: this briefly read 38, with a claim that the ratchet had carried four units of slack. Both were wrong.** The first stripper was two regex substitutions and the line-comment one ate `//` inside STRING LITERALS — `rfq.spec.ts` is full of `"http://localhost:4000/..."` — so it truncated real code at every URL and the four "false positives" it seemed to remove were four real assertions it had destroyed. With a tokeniser the class reads 42, which is the figure that was there before anything was touched. The diagnosis about the quoting comment stands; the arithmetic around it did not. Use `expectAbsentWithin(scope, build)` from `apps/web/e2e/support/anchored.ts`: `scope` is a `Locator`, so passing `page` is a COMPILE error, and it asserts the scope VISIBLE first — scoping fixes the wrong-element failure and NOT the not-yet-rendered one, because `toHaveCount(0)` passes on its first poll. **Do not raise `TEXT_LOCATOR_BUDGET`**; lower it as sites convert |
| `npm run check:docs` | **THE DOCUMENTATION GATE CHAIN — FIVE OF THEM, AND IT IS A CI STEP** (exits non-zero). Runs `check:undated-absence-claims`, `check:whats-new-cap`, `check:markdown-tables`, `check:hook-registration` and `check:decision-index`. **CORRECTED 2026-11-08 ON TWO COUNTS, both the doc rot this chain exists to catch.** It said *runs LOCALLY only — no CI step*: it has run in CI since the owner landed `ci.yml:382` (`backend`, *Every document gate runs*), between the maker/checker step and `prisma validate`, and it passed on both commits of batch 8 — its first runs for anybody. And it said **THE TWO** documentation gates and *runs the two below*, which stopped being true when batch 7 added `check:hook-registration` to the chain and is now five. It deliberately does NOT include `markdown-table-columns.py`, which exits non-zero on 3 DECLARED pre-existing malformed rows — bundling it would make a gate that can never pass, and a permanently red gate is one everybody learns to ignore. Run that one by hand. |
| `npm run check:undated-absence-claims` | **EVERY ABSENCE CLAIM IN THE DOCUMENTATION MUST CARRY THE DATE IT WAS MEASURED** (exits non-zero). **AN ABSENCE ROTS AND A PRESENCE DOES NOT**: *"X is not built"* goes false the day somebody builds X, silently, with nothing failing, while *"X is built"* stays true — so the script reads only the negative direction. **THE PATTERN IS DECLARED IN THE SCRIPT AND THE FIGURE IT PRINTS IS THE ONLY ONE TO QUOTE**: two greps a week apart gave 36 and 62 over the same file, and a count whose method is not written down is the defect this gate exists to remove. Measured 2026-10-30: **167 undated of 385 matched, 13 declared shapes.** `never` (1,399 hits) and `cannot` (1,019) are deliberately EXCLUDED, measured before being excluded — both are overwhelmingly instructions and invariants, which do not rot; so is a claim inside QUOTATION MARKS, because it is being quoted rather than made (9 instances, each one checked). **A REPORT WITH A RATCHET, NOT A GATE AT ZERO** — a gate at zero forces a rushed sweep over 11,000 lines of register, which is how the wrong sentences got written. The budget MAY ONLY FALL, and it fails if it is left ABOVE the real figure. |
| `npm run check:whats-new-cap` | **`CLAUDE.md`'s What's New table is capped at 12 ROWS** (exits non-zero). It reached 136 rows in 923 KB — about 7 KB a row, which is the right length for a row and the wrong container for 136 of them in the one file loaded into every session, and it grew by 5 rows and 38 KB in the six days before this cleanup started. When the table passes 12 the OLDEST row moves to `docs/whats-new-history.md`, unchanged, **in the same commit**. It counts rows and reads nothing — it cannot tell whether a row is TRUE, which is what the gate above is for. |
| `npm run check:guards` | **ONE COMMAND FOR THE TWO GATES THE GUARDS BATCH ADDED, AND IT IS A CI STEP** (exits non-zero). Runs `check:hook-registration`, `check:declaration-floor`, then **`check:legal-numbers`** (added 2026-11-10 — it reads source only, so it inherits this chain's CI step at `ci.yml:378` without a workflow edit, which is how module 1's first quality criterion reached CI at all). **CORRECTED 2026-11-08: this said *LOCAL ONLY — neither has a CI step yet, and that is owed*, and the owner landed it** at `ci.yml:378` (`backend`, *Every brain guard is present, registered where the code lives, and executable*), beside `check:docs` and ahead of `prisma validate` — it reads source and needs no database, so a cheap refusal sits in front of a twenty-minute suite. Green on both commits of batch 8. **A `ci.yml` step for each is the owner's to land**, for the recorded reason: the push authenticates as an OAuth App without `workflow` scope, which is why the two steps that landed on 2026-10-30 were edited in the browser. Until then this is the unwired-script state this repository already records against itself — stated rather than left to look like coverage. |
| `npm run check:hook-registration` | **WHICH `ibms-brain` GUARDS ACTUALLY RUN HERE, AND WHICH DELIBERATELY DO NOT** (exits non-zero; also part of `npm run check:docs`). **The brain ships six enforcement hooks and this repo registered TWO**, so four guards — including the money-arithmetic and sensitive-data ones — did not run while anybody worked on the system. The absence WAS recorded, in prose, in § `.claude/` above, and it was correct; **prose does not fail a build**. **AND THE REGISTRATION SHAPE MADE ABSENCE LOOK LIKE SUCCESS**: every entry ended `[ -f "$script" ] && exec bash "$script" \|\| true` — `\|\| true` on the line that DECIDES whether the guard runs, so a deleted or renamed hook exited 0, indistinguishable from a clean pass. Same family as the missing `jq` binary that turned two CI watches into silence while the build was red. **FIVE ASSERTIONS, AND THE DECLARED SET FAILS IN BOTH DIRECTIONS** — a guard APPEARING is as much a finding as one disappearing, because it means somebody wired a hook without measuring what it refuses. It also checks the git-recorded file mode: **all seven brain hooks were `100644` until 2026-11-07**, and with `core.filemode=false` the local `rwxr-xr-x` is not what a fresh clone gets, so the brain's own `[ -x ]` registrations would have skipped every guard on CI in silence. **EVERY UNREGISTERED HOOK CARRIES THE COMMAND THAT PROVES THE CLAIM**, because an item recorded as not-built must carry its own disproof — a deferred row once called a gate *"sized, not attempted"* when it was built and already running in CI. `--self-test` plants all five conditions |
| `npm run check:declaration-floor` | **ONE MINIMUM FOR A DECLARATION'S WRITTEN REASON, AND EVERY PLACE THAT ENFORCES IT MUST AGREE** (exits non-zero; part of `npm run check:guards`). `apps/api/src/common/declaration-reason.ts` holds `DECLARATION_REASON_MIN_LENGTH = 10` and calls itself the one home, quoting the owner: *"Two different minimums for one concept is the drift we keep paying for."* Nine files import it. **What nothing checked is the two places the same number is enforced in SQL** — `CombinedDutyAct.reason` and `IncidentContainmentAction.description` both `CHECK (length(btrim(...)) >= 10)`, where no importer can reach, and the second migration's own comment names the constant by path. **A COMMENT INSIDE A MIGRATION IS WHERE AN ENFORCED RULE GOES TO NOT BE READ** — in the owner's words, *"nobody reads it except whoever already decided to change it"* — and the symptom of drift is a **500 from a CHECK violation where a 400 belongs**, because the DTO would accept what the database then refuses. **AND THE FILE'S OWN CITED EVIDENCE DID NOT READ FROM IT**: it names *"the commission override's `reason`"* as one of its two homes, and that DTO wrote a literal `@MinLength(10)` — so the file that exists to stop a third `10` cited, as proof of its rule, a second one. Now pointed at the constant. **THE GATE FOUND A FOURTH LITERAL THAT A HAND-READ MISSED**: `draft-recommendation.dto.ts`'s `rationale`, invisible to the constant's own sweep because that sweep was scoped to fields named `reason`. Three literal sites remain in `UNCLASSIFIED` with the question recorded — **whether a complaint resolution, a reconciliation resolution and a recommendation rationale are declarations is the owner's call, not a refactor.** Both passes TOKENISE; the SQL reader has its own `--self-test` and the TypeScript one is `blank_comments`, imported from the absence gate rather than copied. **EXTENDED 2026-11-12, AND THE EXTENSION WAS THE GATE'S OWN IDEA.** Module 1's declared-act record added a THIRD SQL home of the ten (`DeclaredAct.reason`, now in `DB_FLOORS`) and also three floors that are deliberately NOT ten — the shown article text, acknowledgement and responsibility sentence, which must be PROSE rather than the word «نعم». The gate refused them with its own message, *«a second number for a different concept needs its own home»*, and it was right twice: the first version used 40 for the long texts and 20 for the short one, and **the owner's responsibility sentence is 32 characters — so applying the longer floor to all three by symmetry would have refused her own sentence.** `OTHER_LENGTH_FLOORS` now declares such a floor as (table, column) -> (the TypeScript constant that is its one home, the reason), checks the SQL against **that constant's value read out of the source** so the list cannot become a second copy of the number, and fails in BOTH directions. **AND IT FORCED A SECOND IMPROVEMENT TO THE MIGRATION**: its SQL reader attributes one column per CHECK, so a single constraint naming three columns was visible as ONE floor — the constraint is three now, which is better regardless, because a failure names WHICH text was short |
| `bash scripts/from-empty.sh` | **THE ONLY GATE THAT SEES THE SHAPE A DATABASE REACHES FROM NOTHING** (exits non-zero; a CI step in the `backend` job, *Database from empty*). **RUN IT BEFORE PUSHING ANY MIGRATION.** It creates a throwaway database, runs all 165 migrations from empty, seeds, checks twenty-odd pins and drops it — it does NOT touch the dev or db-test databases and never runs `prisma migrate reset`. **`db:divergence` cannot answer its question**, by construction: a composite tenant FK is a DECLARED expected statement there, so that gate says nothing about the COUNT, and only this pin notices the shape has moved. **It has now fired in CI twice for the same reason — somebody ran the six database gates and not this script** — the second time on 2026-11-10 with art. 21/b/5's scope-line FK, after `db:validate`, `db:divergence`, three unit suites and six targeted e2e specs were all green. The pin's own comment had recorded that failure mode and it did not prevent the repeat, which is why the instruction is here too. |
| `npm run check:legal-numbers` | **A LEGAL NUMBER MUST NOT BE HARD-CODED, AND THIS IS THE GATE THAT SAYS WHEN A NEW ONE IS** (exits non-zero; part of `npm run check:guards`, so it runs in CI). Module 1's first quality criterion. The unit is a **numeric constant DECLARATION whose OWN comment cites a legal source** — never *numeric literal* — so a page size of 50 is not flagged (nothing cites it) and a `LEGAL_VALUES.x` lookup is not flagged (not a literal). **It reads the declaration's own comment BLOCK, not a window**, which is the measured fix for its one false positive: a 12-line lookback dragged in a NEIGHBOUR's art. 11 citation and flagged `SECOND_NOTICE_DAYS_BEFORE_EXPIRY = 30`, whose own comment says *«NO ARTICLE — stated plainly»*. A gate that reads somebody else's citation is attributing a legal source to a number nobody claimed one for — the exact defect it exists to prevent, committed by the gate. **Its declared list is a LIST, not a count**, each entry carrying why the figure is still a literal, and it fails in BOTH directions: a new cited literal fails, and a declared one that is gone fails until its line is deleted. **It caught its own author on the first run** — a third entry written from memory named a constant that does not exist, and the gate refused as declared-but-not-found. `--self-test` plants 10 cases including the CAPITALISED `Art.` that took the first version to 5/7, and the `Part.` word-boundary case. Reads 149 declarations / 2 cited / 2 declared. **CORRECTED AND WIDENED 2026-11-10: it read `149 scanned / 2 cited / 2 declared / ok` over a population that could not contain its subject.** `CAPITAL_BANDS` carries art. 4/a's FIVE figures and was invisible twice over — the three amounts are STRINGS (because `money-decimal-jod.md` forbids a JOD figure as a JS number, so **the right rule for money hid the figures from the right rule for legal numbers**), and the `ART. 4/a's BANDS` comment was stacked above the WRONG declaration, two above the figures. **It reads STRUCTURED literals now** — an array or object whose values carry figures, with its type annotation allowed to span lines — and `DECLARED_FIGURES` pins each declared structured literal's figure SET, because a seventh band added to an already-declared array **changes no key** and a name-only declaration would have passed the plant. **`NOT_A_LEGAL_NUMBER` is the third list**: a declaration whose comment cites an article ABOUT ANOTHER FIGURE, each with its reason, checked in both directions — added because the alternative was to delete a citation and make the documentation worse, which is the recorded *stop explaining the fix* shape. `--self-test` is **19** cases and keeps the stacked-comment shape, the CAPITALISED `Art.`, the `Part.` word boundary, and **a lex FILENAME not being a citation** (`pdpl-sla-timers.md` had made a drafted dashboard heuristic read as a legal figure). **AND AS OF 2026-11-11 IT READS ZERO LITERALS AWAITING THE TABLE**, which is what OWNER DECISION 123's build earned: art. 4/a's five figures, art. 11's 45 days and art. 14/c's two years are `LegalValue` rows, and the gate REFUSED when they were deleted from source and left in `DECLARED` — the half of the ratchet that makes progress stick. A fourth list, **`SEEDS_THE_TABLE`**, now holds the two declarations that are the table's own SOURCE (the seed catalogue, and the api's test double pinned to it by `legal-values-parity.spec.ts`) — a DIFFERENT claim from *still a literal*, named rather than skipped by path, and the three lists are asserted disjoint. `--self-test` is **21**. Reads 147 declarations / 1 cited bare / 2 structured / **0 declared** / 2 the table's own source / 1 not-a-legal-number. **Its stated weakness: an UNCITED legal number is invisible to it**, so it rides on the standing rule that a regulatory obligation cites its source — and a figure in PROSE is deliberately out of scope (measured 2026-11-10: 101 citations in `.prisma`/`.sql` and 18 in `apps/web/app`+`components`, all prose or provenance, none a figure a program reads). |
| `npm run check:rls-proof-shape` | **A SPEC THAT CLAIMS ROW-LEVEL SECURITY REFUSES SOMETHING MUST PROVE IT ON A CONNECTION RLS APPLIES TO** (exits non-zero; part of `npm run check:guards`, so it runs in CI at `ci.yml:378` with no workflow edit). **MEASURED 2026-11-11: on db-test the e2e suite's own role `ibms` is `rolsuper = t, rolbypassrls = t`, and on dev the same role NAME is `f, f`.** A superuser bypasses RLS entirely — **even `FORCE ROW LEVEL SECURITY`** — so a refusal asserted through `prisma`/`rawPrisma` passes with every policy dropped. The PRODUCT was never in doubt: `ci.yml`'s *Verify privileges* step has always checked the runtime role and stays exactly as it is. **The TESTS' proof of it was.** **THE UNIT IS THE FILE, AND THAT IS A CORRECTION MEASUREMENT MADE.** The first version asked, per `expect()`, whether the subject came from the suite's own client — and named **nine assertions in `tenant-isolation.e2e-spec.ts` where every one was correct code**. Asserting *office A's activity never wrote an audit row against office B* REQUIRES a client that can see office B's rows; through a filtered connection that query returns empty whatever the application did, and the test would pass against the very defect it exists to catch. **For an ORACLE the bypassing client is the point, and for a REFUSAL it is the flaw** — a difference no per-`expect` rule can read. So it asks whether a spec CLAIMS RLS refuses something (the mechanism and a refusal word in ONE sentence, read from comments AND from assertion failure messages, which are prose a reader meets at 3am) and, if so, requires a connection opened on `APP_DATABASE_URL`. **Otherwise the spec is DECLARED with what it actually proves**, which is a more useful artefact than a pass: five of the six specs measured claimed RLS and proved the application layer. **ITS SECOND CHECK IS THE ONE THE PLANTS FOUND**: a spec that opens that connection must assert `rolsuper`, `rolbypassrls` AND table OWNERSHIP are clear for **`current_user`** — of the CONNECTION, never of a role looked up by name. `tenant-isolation` already asserted all of that for the role NAMED `ibms_app`, correctly, and **that is a different claim**: point `APP_DATABASE_URL` at the owner and every one of those assertions still passes while every refusal below it goes hollow. Three of the four app-role specs had no such assertion and now do. **IT CORRECTED ITSELF THREE TIMES, EACH A RECORDED BLINDNESS** — its own self-test found the 17 real policy NAMES missing from the vocabulary (so *«the `tenant_isolation` policy refuses a cross-office read»* went undetected); the sentence splitter broke on `:`, which split one spec's claim into a mechanism half and a refusal half so the file read as claiming nothing; and **the sentence written to explain one of these fixes put both halves in one sentence and read as a claim**, which is this repository's comment-quotes-the-pattern blindness committed inside the correction. It is DECLARED with that account rather than reworded, because dodging the words would satisfy the gate by making the documentation worse. **`--self-test` plants 11 conditions** including a `//` inside a URL not blinding the scanner, a `prisma.` inside a string literal not counting as a call, and both stale directions of the declared list. **AND THE THING IT CANNOT ASK FOR, recorded so nobody adds it by reflex: an HTTP assertion cannot prove RLS and no rewrite makes it able to.** `tenantScopeExtension` adds `organizationId` before the query leaves the application, so the database is never asked a question it could refuse — measured by replacing a policy with `USING (true)`, which left `provider-self-administration.e2e-spec.ts` at 10/10. |
| `npm run check:unguarded-routes` | **A ROUTE HANDLER WITH NEITHER A PERMISSION NOR `@Public()` IS COUNTED, AND THERE ARE FOURTEEN** (exits non-zero; part of `npm run check:guards`, so it runs in CI at `ci.yml:378` with no workflow edit). `docs/module-1-design-reports.md` §6.3 measured the api's **531 route handlers: 505 permission-guarded, 12 `@Public()`, 14 neither** — eleven in `auth.controller.ts` plus `company-record`, `conflict-of-interest` and `notification` — and closed with the sentence this gate answers: *a fifteenth unguarded route that is NOT self-service is the defect, and nothing counts them today.* Nothing did, so a handler written with no decorator at all — the easiest mistake in a Nest controller, because it compiles, serves and looks finished — joined the fourteen in silence. **Every one of the fourteen is by decision, on ONE principle: it acts on `@CurrentUser()`'s OWN row** — your own password, your own trusted devices, your own TOTP enrolment, your own notifications, your own conflict-of-interest disclosure, your own company's registry record. A permission answers *may you act on the OFFICE's data*, and none of these touches it; gating them would let a role be configured to hide a person's own alerts from them, or lock them out of enrolling MFA. The declaration is BY NAME with each one's reason, never a count: a bare count passes the day somebody guards one of the fourteen and adds a new unguarded one. **It fails in BOTH directions** — an undeclared unguarded route fails, and a DECLARED route that has since been guarded, deleted or made public ALSO fails, demanding its line be deleted, because a stale amnesty is where the next unguarded route hides. **`@RequireStepUp` is deliberately NOT a guard here**: `StepUpGuard` asks *did this person re-authenticate*, never *may this person act*, and the two refuse with the same 403 — the recorded 2026-11-07 guard-order finding. A class-level `@RequirePermissions` DOES count, because Nest applies it to every route in the class. **IT CAUGHT ITS OWN AUTHOR ON THE FIRST RUN**: six of the fourteen declared method names were written from memory and wrong, and the second direction named every one — `enrollMfa`, `disableMfa`, `setLanguage`, `verifyMfaEnrollment` and `getOwnRecord` do not exist, and `revokeAllTrustedDevices` is not a route at all. `--self-test` is **15** cases and keeps the ones that matter permanently: a block comment QUOTING `@RequirePermissions` must not guard the handler below it (this repository's comments quote decorators constantly), a decorator inside a string literal must not count, and a guard on one handler must not leak to the next. **Plants: a new unguarded route → exit 1 naming file, line and method; guarding a declared one → exit 1 demanding the declaration be deleted.** |
| `npm run check:decision-index` | **59 ROWS AS AT 2026-11-12** (123 replaced by its third form; 125, 126 and 127 added; decision **60 marked STRUCK**, its row kept because a struck decision is marked and never erased). **EVERY OWNER-DECISION NUMBER CITED IN THE CODE HAS A FILE THAT SAYS WHAT IT MEANS, AND A ROW THAT POINTS AT IT** (exits non-zero; part of `npm run check:docs`, so it is a CI step). `OWNER DECISION 48` is cited **74 times across 57 files** and until 2026-11-08 nothing anywhere said what decision 48 was — the only way to learn one was to ask the owner, whose standing instruction is that nobody should have to. The texts are `docs/decision-<n>-<slug>.md`; the index is `ibms-brain/meta/decision-index.md`. **It fails in BOTH directions**, because the two failures have different fixes: a number cited with no file means somebody cited a decision nobody wrote down, and a file with no citation means the decision left the code and the file is stale. It also checks that **every index row repeats its own file's first sentence** — an index that drifts from its files answers wrongly instead of not answering — and that **every citation figure a file states is the measured one**, since 20 of the 48 files declare their own counting method and close it with *the figure of whoever re-runs it beats mine*. **IT WALKS A MULTI-NUMBER CITATION ON PURPOSE AND THAT IS NOT AN EMBELLISHMENT**: decision 33 is cited in TEN places and appears ONLY inside `decisions 32 and 33`, never once alone, so every matcher anchored on the word before a number read the 32 and was blind to the 33 — it had no file and no row for the whole life of the register, and ONE OF THOSE TEN SITES hid the same way one level down, because the citation breaks across a line inside a block comment, which is why the file's own figure of nine is correct under the literal method it declares and `WRAPPED_CITATIONS` has to carry the tenth. **Never narrow that matcher back to the first number.** Six matcher phantoms are DECLARED and each is ASSERTED, so one becoming real raises rather than reporting a missing file; `KNOWN_MISSING` HOLDS **DECISION 87** AS AT 2026-11-11, and it was emptied once by the gate doing exactly what that list is for — decision 33 was declared there on 2026-11-08 and the gate went red the day its file landed. **TWO REAL OWNER DECISIONS ARE CITED IN THIS CODEBASE AND HAVE NO FILE: 82 and 87.** 82 is cited only inside decision 128's own section 8; 87 is cited where the declaration floor is recorded as struck on its 15-character point. Both are REPORTED rather than invented — a decision file is the owner's text, and writing one on her behalf is the one thing this gate must never provoke. A decision cited only jointly declares its own wrap-tolerant method in `CITED_ONLY_JOINTLY`, asserted stale the day the narrow form appears. **🔴 AND IT IS BLIND TO AN UNTRACKED FILE, MEASURED 2026-11-12 WITH A PLANT.** Its citation scan is `git ls-files apps packages` — TRACKED files only — so a brand-new file's decision citations are invisible until it is staged: a new `apps/api/src` file citing a decision number with no file left the gate GREEN while untracked, went RED on `git add`, and green again when removed. **So `git add` comes BEFORE `check:docs`**, and *«I ran it after my last edit»* is not sufficient — the gate's unit is the INDEX, not the working tree, and those differ for exactly the files most likely to carry a new citation. ⛔ It is deliberately NOT changed to scan the working tree, which would make it fail on scratch files and throwaway plants. **AND IT WAS WIDENED TWICE ON 2026-11-12, BOTH TIMES BECAUSE THE OWNER'S TEXT IS THE AUTHORITY.** Decision 132 is headed «القرار بجملتين» — the DUAL, *in two sentences* — which the one-sentence matcher did not accept; and `_norm` stripped `*` and backticks but **not the blockquote `>`**, so a sentence she wrote across a two-line quote normalised to `> one > > two` and could never equal a one-line table cell. ⛔ **The alternative in both cases was editing her heading or reformatting her file so the matcher would match, and that is the one thing this repository never does** — a matcher is a tool. `--self-test` plants **15** conditions, and `check:decision-index` runs it BEFORE the gate so a broken gate says so rather than printing a plausible pass |
| `npm run check:maker-checker-pairs` | **THE PAIR COUNT IS DERIVED, NOT PINNED** (exits non-zero; a CI step in the `backend` job). Compares `MAKER_CHECKER_REGISTRY` to the `*_maker_checker_distinct` CHECK constraints the migrations create, BY NAME and in BOTH directions — so a pair registered without its constraint fails, a constraint no entry claims fails, and a seventeenth pair properly built moves both sides together and the gate stays quiet. It replaced `assert pairs == 15`, which had been exiting 1 before it measured anything since the sixteenth pair landed, in a script nothing ran. Running it also prints the ordinary report, which is how the one pair WRITING the act and showing nobody was found. **Its declared limit:** the projection figure is a REPORTED column, not a gate — a pair that stops projecting is caught by the e2e wire assertion, and both plants are committed. |
| `npm run check:seed-sweeps` | **EVERY PER-ORGANIZATION SEED SWEEP MUST BE CLEARED BY THE FIXTURE CASCADE HELPER** (exits non-zero; a CI step in the `backend` job, before the migrations). `seed.ts` has functions that walk `organization.findMany()` and write a row into EVERY organization. A disposable e2e fixture organization is one of those rows, every FK involved is RESTRICT, and one `db:test:seed` run after a leak makes that fixture **permanently undeletable** — which takes down every later spec at `createTestApp` with a fault that looks like its own. **This happened twice**: once when decision 25's `PasswordResetToken` broke two teardowns (CI red, eleven leaked organizations), and again when the comment written to prevent it listed the sweeps as "branches, departments and holidays" — two sweeps counted as three models, missing `ensureBrokerLicenseTerms` and its certificate `Document` entirely. It did not fire only because eleven of the twelve leaks were `INSURANCE_COMPANY` and that sweep filters on `BROKERAGE_OFFICE`: **the type spared us, not the code.** So it is a **DERIVATION, not a list** — it reads the sweeps out of `seed.ts` and the cleared models out of `tenant-prisma.ts`, and **derives the denominator too**: every occurrence of the sweep shape is ATTRIBUTED to the top-level `async function` containing it, and an unattributable one **fails by line**, because a fourth sweep written as an arrow function would otherwise clear a count-based floor and pass. **ITS LIMIT IS DECLARED**: it proves a model is cleared SOMEWHERE in the helper, not that the rows go — `apps/api/test/fixture-cascade.e2e-spec.ts` is the other half, and a committed plant that mentions a model while clearing nothing passes the gate on purpose and dies in that test |
| `npm run check:labels` | **A FLAT BAN ON A LABEL THAT NAMES A COLUMN INSTEAD OF SAYING WHAT THE FIELD IS FOR** (exits non-zero; a CI step in the `frontend` job). The owner's decision 21: the hiding of displayed ids became a BUILD RULE rather than a backlog row — every new screen from module 1 onward shows a NAME, not an id — and this is the half a script can police. "Branch ID" tells a person the column's name; *"Show one branch only"* tells them what the field does. **Classified by USAGE, not by key name**, because a text matcher over-reached twice: a key rendered inside `<th>` is a table HEADING (which names the column by design), inside `<label>` is a PROMPT, and one rendered by no screen at all is DEAD. The PROMPT budget is **0** — a flat ban with no switch to throw — and the other kinds are **PRINTED rather than filtered**, since an exclusion nobody can see is one nobody can argue with. **A real-world identifier is NOT the defect**: "National ID" says exactly what data will be in the field, because a national ID is a document in somebody's hand; "Owner user ID" names our surrogate key and says neither whose nor what for. `/audit-trail`'s two required fields and its browse filter are POLYMORPHIC (`wfEntityId` addresses any of fifteen workflow entities, `documentId` a `Document` with no search route), so they are declared BY NAME in `DECLARED_POLYMORPHIC` — **adding a row there needs the owner's decision, and must never be used to absorb an ordinary prompt** |
| `npm run check:css-properties` | **EVERY `--custom-property` A SCREEN REFERENCES MUST BE DEFINED IN THE STYLESHEET** (exits non-zero; a CI step in the `frontend` job). `--surface-raised` was referenced at three sites and defined NOWHERE, and a bare `var()` on an undefined property is invalid at computed-value time — the browser drops the WHOLE declaration, so all three blocks rendered with no background at all. One of them is the DPO assignment section, carrying the owner's own Arabic notice. **Nothing else in this repository could see it**: no compiler reads a stylesheet against a `.tsx` string, the CSS was never invalid, every Playwright assertion passed because the text still rendered, and axe passed because a missing background is not a contrast failure but a contrast ACCIDENT. This is a text-level join, like the AR/EN parity guards. **IT KEEPS TWO CLASSES APART**: a reference WITH a fallback (`var(--x, y)`) renders the fallback by design — 5 of those exist and are REPORTED, never gated — while a BARE one is the defect; merging them would bury thirteen real findings under six deliberate ones. **A DECLARED SET, not a count**, because a count survives a substitution: it fails by name on a bare reference nobody declared AND on a declared row that no longer occurs, so a fix is recorded by deleting its row rather than left to cover the next regression. **`DECLARED_BARE` IS EMPTY — a FLAT BAN with no switch to throw.** It held three rows for one batch (`--border` at 5 sites, `--line` at 4, `--shadow-raised` at 1) and all three were closed on the owner's ruling, each resolved to a property that ALREADY EXISTED rather than by inventing one: `--border-default` for a panel outline or a table header rule and `--border-subtle` for a row separator, which is this repository's own measured convention; and `--shadow-md` for the `EntitySearch` dropdown, decided one component over — `NotificationBell`'s panel is the app's only other floating overlay and is the exact comparable, so the two now look like one product. Re-populating the set needs a reason beside the name, because a row there means shipping an element with no background, border or shadow — register entry 128 |
| `npm run check:literal-colours` | **NO HAND-WRITTEN COLOUR OUTSIDE THE TOKEN SET** (exits non-zero; part of `npm run check:screen-pass`). **IT RUNS IN CI, confirmed 2026-10-30 from the run and not the file** — `960d236`, run `41014740507`, `frontend` step 15 *No hand-written colour outside the token set*, `success`. Two pushes of it were refused naming `workflow` scope; the step landed by being edited in the browser, because **the push authenticates as an OAuth App** and no personal token, however scoped, was ever on that path. §4 of the design pass said in its own words that a literal colour in a screen is a defect, and named `#b91c1c` BY NAME — and for months **nothing could see one**: `check:inline-styles` counts style SITES rather than what is in them, `check:css-properties` resolves bare custom-property references, and `check:token-contrast` reads hex only for the 32 pairings it is handed. **THE DEFECT IS ARITHMETIC RATHER THAN TASTE.** Measured against the two card surfaces when the sweep ran: `#b91c1c` is 6.47:1 on light and **2.33:1 on DARK**, where `--danger-ink` is 6.76; `#15803d` 3.01; `#b45309` 3.00; `#c00` 2.56 — and **`#2a7` fails the OTHER way round at 2.96:1 in LIGHT**, so a policy that passed its QC check rendered its own *no discrepancy* marker below AA for every light-theme reader. **The a11y suite is structurally silent**: axe reads RENDERED contrast and Playwright runs one theme, the same hole `check:opacity-muting` exists for. **THE WORST SITE WAS FOUND ONLY BY WIDENING THE MATCHER FROM `.tsx` TO `.ts`** — every `*.styles.ts` chokepoint was invisible — and it was the SIGN-IN button's own label at **2.34:1** in dark against `--on-brand`'s 7.70, on the first screen this product shows anybody, with `Button`'s own `primary` variant already carrying a comment naming that exact defect. **IT FAILS IN BOTH DIRECTIONS** — an undeclared literal, and a DECLARED exception that no longer occurs, so the list cannot become a ceiling. **NINE ARE DECLARED WITH WHAT EACH IS FOR**, because `rgba()` is not automatically a defect: a solid badge the semantic set has no step for, a modal scrim that must NOT follow the theme, two decorative gradients needing a colour at ALPHA, and white at alpha on the one surface that stays dark in both themes. **DO NOT ADD A TOKEN TO EMPTY THE LIST** — `--danger-solid` is owed and needs a light value and two dark ones. **AND ITS FLOOR IS A `--self-test`, NOT A COUNT**: `FLOOR = 10` guarded a real 26 and then REFUSED A CORRECT TREE AT 9, because a count floor goes stale every time the work it guards gets done |
| `npm run check:token-contrast` | **EVERY DECLARED TOKEN PAIRING CLEARS ITS WCAG FLOOR, IN BOTH THEMES** (exits non-zero; a CI step in the `frontend` job, and part of `npm run check:screen-pass`). 32 declared pairings. **It exists because the a11y suite is structurally blind to a ramp step no screen has reached**: axe runs over 84 Playwright specs and reads RENDERED contrast, so a palette change that breaks a token nothing currently paints is invisible to it until somebody uses that token — which is exactly the hole a brand re-anchor falls into. This gate measures at the TOKEN layer instead, resolving each `var()` chain in `globals.css` for both themes and computing the ratio. **THREE CLASSES, NOT ONE, AND THE SPLIT IS WHAT MAKES IT CREDIBLE**: `TEXT` at 4.5, `UI` at 3.0, and `SEPARATOR` REPORTED rather than gated — the first version held every border to 3.0 and produced SIX reds on a palette whose whole a11y suite is green, which is the cry-wolf direction that gets a gate ignored within a week. A decorative hairline is neither 1.4.3 text nor a 1.4.11 UI component. **Non-vacuity floors on both the token count and the pairing count**, so a parser that stops parsing refuses rather than reporting a clean nothing; and it fails in BOTH directions — an undeclared pairing and a declared one that no longer resolves. **RUN IT AFTER ANY PALETTE CHANGE** |
| `npm run check:inline-styles` | **INLINE STYLING MAY ONLY FALL** (exits non-zero; a CI step in the `frontend` job, and part of `npm run check:screen-pass`). **TWO BUDGETS, NOT ONE, and the split earned itself in the commit that added it**: `SCREEN_BUDGET` counts improvisation — everything outside `components/ui/` — and `UI_BUDGET` counts the primitive set, where a style is SUPPOSED to live. A single total would let the migration itself look like a regression, because moving a screen's styling into a primitive moves the site rather than removing it; it is the same argument `typed-identifier-inputs.py` already records, that one total lets a class be traded for another behind a green gate. **MEASURED AT THE START OF THE DESIGN BATCH: 1,511 sites across 169 files, against 18 unused primitives and 140 unused tokens** — which is the whole diagnosis in one line. **IT FIRED ON ITS OWN AUTHOR**: `AuthFrame` and `IconField` were first written into `components/auth/`, where the gate counted their 14 sites as a screen REGRESSION — correctly, by its own rule — and what it refused was leaving a shared frame in the bucket that measures improvisation. **MEASURED AT THE END OF THE DESIGN BATCH: 1,132 — down from 1,455, with every one of the 111 screens off `pageStyle` and 101 of them composing from `components/ui`.** **CORRECTED 2026-10-29: 106 authenticated screens, 104 composing.** The 111 counted every `page.tsx` under `apps/web/app`, which includes the five `(auth)` screens that render before sign-in; the two authenticated screens that compose from nothing are the home launcher (a grid of destination cards) and `/settings/security` (the one screen that must stay reachable before MFA enrolment), and both are correct as they are. **CORRECTED 2026-10-29: 1,100.** The screenshot batch took it further — `/customers/[id]` and its two correction components (the record shape, which had kept its own markup and which `design-pass-sections.py` had REFUSED with *nothing changed*) and then `/screening-health`, which carried a local `card` style with its own `1px solid` border and a `6px` radius off the scale. **Both moves were produced BY the ratchet rather than reported to it**: it refuses a budget left ABOVE the real figure, because a ceiling that absorbs the next regression silently is worse than no gate. 1,132 -> 1,115 -> 1,100 -> **1,083**, the last fall being the sixteen redundant table scrollers — one site per wrapper, which is what made it reconcile — and the ratchet refused the stale budget first, as it is built to. **`SCREEN_BUDGET` MAY ONLY FALL. `UI_BUDGET` RISES ONLY FOR A GENUINE NEW PRIMITIVE**, in the commit that adds it, with the reason written beside the number — never to absorb a screen's own styling |

> **2026-10-29 — TWO GATES WERE WIDENED TO SEE THE PRIMITIVES, and the reason is worth more than the change.** `typed-identifier-inputs.py` matched `<input` on the line carrying `value={…Id}`; a screen converted onto `Field` + `TextInput` no longer contains `<input`, so a field STILL asking a person to type a record id by hand went invisible and the budget fell 12 → 11, reporting the blindness as progress. `four-states.py` had the same exposure on `<table` for its rule 1. Both now match the primitive AS WELL AS the raw element. **A FALLING RATCHET IS NOT AUTOMATICALLY PROGRESS**: any gate keying on `<input`, `<select>`, `<table` or `<p role="alert">` has this exposure while the design pass converts more screens, and the failure is silent because it is indistinguishable from the work being done.
>
> **2026-11-06 (module 0-c batch 6) — `RENDERED_IDENTIFIER_BUDGET` FELL 12 → 11, and the note above
> is why the fall is recorded with its cause rather than merely lowered.** The cause is a real
> removal rather than a blinded matcher: rows 16, 69 and 71 routed three screens' money through
> `formatMoney`, and one of the values that had been printed raw was identifier-shaped. **Lowered in
> BOTH places — `scripts/measurements/rendered-identifiers.py` and
> `apps/web/test/screen-copy.test.ts`, which carry the figure independently** — so a later reader
> comparing them does not find two answers. The web unit test is what caught it, in its own words:
> *"The budget is stale — only 11 identifiers remain … A budget that stays above the real count stops
> being a ratchet."*

| `python scripts/measurements/design-pass-convert.py <screen>…` | **THE MECHANICAL HALF OF A SCREEN'S DESIGN PASS, APPLIED WITH REFUSAL RATHER THAN TOLERANCE** (exits non-zero; NOT a CI gate — it is a tool you run deliberately). It converts the shape 99 of 106 screens share: `<main style={pageStyle}>`, an `<h1>` over a `<p style={{ opacity: 0.75 }}>`, a hand-rolled `<table>` with its own borders and minimum width, `<p role="alert" style={errorStyle}>`, and a bare `<p>` for loading. **EVERY TRANSFORM IS A REAL DEFECT RATHER THAN A RENAME** — `opacity` as muting is what `globals.css` itself bans and is the cause of this product's recorded contrast regression; a hand-rolled table carries its own `minWidth`, so no two screens agreed when one starts scrolling and some had NO scroll container at all; the raw spacing values are off the owner's five-step scale. **IT IS EXACT-MATCH AND IT REFUSES**: a file where a transform it was told to apply does not match is handed back WHOLE rather than half-converted. **WHEN IT REFUSES A SCREEN, CONVERT THAT SCREEN BY HAND — do not loosen a transform to make it land.** Every one of its five recorded defects was a pattern crossing a boundary it should not have: a non-greedy DOTALL body that ate three neighbouring declarations, a quote style taken from the file's JS when JSX attributes use double quotes whatever the surrounding code does, two table shapes that could both partially fire, a cell pattern that skipped every ATTRIBUTED cell while still converting its closing tag, and a row closer that assumed the line above it. **It does NOT do the judgement half** — what a screen is for, what belongs in which group, which badge carries a meaning — and must not grow to. **DRIVE A GROUP WITH REVERT-ON-FAILURE**: convert, typecheck ONCE, revert exactly the screens `tsc` names, repeat until it is quiet. That covers the half refusal cannot — a file the converter RECOGNISES and gets wrong — and leaves it untouched for hand work rather than half-converted |
| `python scripts/measurements/design-pass-sections.py <screen>…` | **A SCREEN'S `<section>` BECOMES A `Card` WITH A TITLE, AND ITS TABLES BECOME `Table`** (exits non-zero; a tool, not a gate). The crowded screens are a different shape from the list screens its sibling handles: SIX sections on one page, each a bare `<h2>` over a table that brought its own borders and its own minimum width, so a reader met three different horizontal behaviours on one page. **BOTH CLOSING TAGS ARE FOUND BY PAIRING WITH A DEPTH COUNT, never by a blanket replace** — `</section>` and `</tr>` both nest, and a screen where one converts and another does not would get a `</Card>` closing a `<section>`; it REFUSES if the number closed does not equal the number opened. **It does not touch imports** — run `design-pass-imports.py` after it. **THE ORDER IS `convert` → `sections` → `imports`**: the first two each add their own `components/ui` block and neither is idempotent, while the third MERGES and is |
| `python scripts/measurements/design-pass-imports.py <screen>…` | **ADDS WHAT A CONVERTED SCREEN NOW NEEDS AND DROPS WHAT IT NO LONGER DOES** (exits non-zero). Separate from the converter deliberately: a tool that rewrites markup AND imports has two ways to go wrong per file and only one of them is visible, because an unused import is a lint WARNING while a missing one is a compile ERROR. What it adds is measured from the file's own markup, so a screen with no empty state does not acquire an unused `EmptyState`. **THE REMOVAL SWEEP ITERATES**, because these declarations depend on each other — removing `head` is what MAKES `cell` unread, so a single pass clears one and leaves the other. Comments are stripped before counting |
| `python scripts/measurements/design-pass-dead-consts.py` | **STYLE CONSTANTS NOTHING READS ANY MORE** (exits non-zero if it matches nothing). **Run 2026-11-07: it REFUSES — *nothing matched, the declaration shape has changed* — so it currently measures nothing and reports no dead constant.** That date is here because the claim became UNDATED by accident: the note above this table grew by ten lines in module 0-c batch 6, which pushed this row outside `undated-absence-claims.py`'s twelve-line dating window and took the repo-wide figure 167 → 168 — **a gate going red because dated text was inserted ABOVE a claim, not because anybody wrote one.** The honest repair is to answer the question the gate was asking, which is what the run above does. Once a screen's cells become components, its local `const cell: CSSProperties = {…}` has no reader — and an unread constant is a lint WARNING rather than an error, so it ships quietly and tells the next reader the screen still hand-rolls its table. **REMOVAL IS CONDITIONAL ON A MEASUREMENT, never on the name**: the identifier must appear exactly once in the file, which is its own declaration, so a constant another constant spreads into is never touched. **COMMENTS ARE STRIPPED BEFORE COUNTING** — a comment quoting the name defeated the first version, which is `check:css-properties`'s own recorded limit recurring in a second tool |
| `node scripts/playwright-specs.mjs <filter>…` | **A GUARD ON YOUR OWN TEST COMMAND** (exits non-zero). Resolves Playwright spec filters and refuses any that matches no file. `npx playwright test a.spec.ts settings` runs `a.spec.ts` and SILENTLY IGNORES `settings` — the screens are at `app/(app)/settings/…` but the specs are `roles.spec.ts`, `users.spec.ts`, `org-units.spec.ts`… Playwright does not warn, the run passes, and the coverage claim is false. That happened in three reported runs before CI caught the one real regression hiding behind it (IMPROVEMENTS § 1.85). Feed it to Playwright: `cd apps/web && CI=1 npx playwright test $(node ../../scripts/playwright-specs.mjs roles users org-units)` |
| `npm run db:permission-catalogue` | **A GENERATED DOCUMENT, not a gate.** Writes `docs/permission-catalogue.md` — all 219 codes with the stored English description and **the roles that hold each one**, read from the seeded database. Built for the owner, who writes the Arabic descriptions and has no repository access: a hand-listed catalogue drifts the first time a code is added, which happened twice in one week (`customer.read`, `diagnostics.view`). The roles column is the point — a code held by one role is described differently from one held by ten. Its sibling `docs/permission-catalogue-for-descriptions.txt` is the file to TYPE INTO; this one is for reading |
| `python scripts/measurements/b7-coverage.py` | **A GATE-SHAPED MEASUREMENT** (exits non-zero). Every screen under `app/(app)` against the screens `docs/b7-consistency-record.md` NAMES in a batch — currently 102 of 102, batches 4-9. It exists because batches 1-3 reported coverage in conversation and never wrote it down, producing a "76 of 102 remain" figure that could not be substantiated: files TOUCHED is recoverable from git, screens READ is not, because a screen read and found correct touches nothing. Its own first version could not match `(home)` and reported 101 — a verification instrument with a false negative is worse than none, because the number it produces looks like a finding |
| `python scripts/measurements/four-states.py [<screen>…]` | **A MEASUREMENT, NOT A GATE.** Rules 1 and 3 per screen: which of the four non-data states each has, and every form/table offset so rule 1 can be read per PAIR. **Supersedes `b7-survey.py` for rule 1**, because it tells a CREATE form from a FILTER form and compares them separately — the distinction that hid two real violations. Its header carries four false-positive classes, every one found by READING rather than by the script: a table inside a rendering helper above `export default`, an error state not named `loadError`, a state living in a child component, and the filter-masks-create case. It follows local component imports one level deep, which fixes the empty-state count without making it reliable — a state two components down is still invisible |
| `python scripts/measurements/load-error-way-forward.py` | **GATED** (via `apps/web/test/screen-copy.test.ts`). Rule 3's fourth state is TWO things — "something went wrong" AND the way to retry — and only the first half had ever been measured. Every load-error message must name a way forward in BOTH languages; 109 of 109 do. **Zero screens in the app have a retry CONTROL**, so the sentence is the only way forward there is. Its first version keyed on the shared `commonTryAgain` and reported 4 of 102 — true and useless, because 98 screens use a screen-specific key and almost all say "try again" in their own words |
| `npm run check:unreachable-routes` · `npm run check:unreachable-routes-by-verb` | **BOTH ARE CI GATES** (exit non-zero). `ci.yml` runs each script's `--check` DIRECTLY, as the `frontend` steps *Screen pass — no route unreachable by path* and *… by method*. **NOT through `npm run check:screen-pass`** — that is the LOCAL chain, and `ci.yml` names the scripts itself, so the two lists must be kept in step by hand. **CORRECTED 2026-11-05, AND THE CLAIM THAT STOOD HERE WAS IN THREE PLACES.** This row said *"A MEASUREMENT, NOT A GATE — nothing runs it automatically"*, and both scripts opened with the same sentence. All three were true when written and became false when the scripts were wired into `check:screen-pass`. A file — or a README row — telling its reader a check is harmless while CI fails on it is the worst version of a stale claim, because these are exactly what somebody opens to find out why a build went red. The reasoning behind the old sentence was sound and is kept where it belongs: it needed **four corrections** before it stopped reporting live screens as unreachable (nested template literals put all six dashboards in the list), so **read the OUTPUT rather than the count**, and the protection against that history is the non-vacuity FLOORS on both sides plus budgets gated in BOTH directions — not the absence of a gate. **FOUR FIGURES, NOT TWO.** By path: **16 routes across 8 controllers** addressed by no web code at all — **13 across 7 until 2026-11-11, when module 1's three `/legal-values` routes landed with no screen above them.** That rise is DELIBERATE and the budget moved WITH its reason and its owed-back condition: the legal-values screens ship only once the owner has ratified every Arabic string on them, and the budget returns to 13 and 7 in the commit that lands them. **The DOWN direction failing is what makes that a debt rather than a hope** — wire the screens and leave the budget at 16 and the gate names it. By verb: **9** addressed by path but not by method — the half the by-path pass is structurally blind to, because it is verb-agnostic. And, new on 2026-11-05, **9 by path and 18 by verb addressed ONLY from inside a client helper nothing calls**. **THAT THIRD CLASS WAS A BLIND SPOT DECLARED IN PROSE FOR WEEKS**: both scripts read the path and verb out of every resolvable call site INCLUDING the one inside a helper's own declaration, so a route counted as REACHED the moment a helper addressed it — measured, writing `clearFinancialStrengthRating` and nothing else took the by-path count 14 → 13 before any screen called it. The blind spot was written down in a comment in each file, which a reader of `--check` output never sees, while the gate printed *at its declared budget* and stopped. **`PATCH /insurers/:id` IS THE PROVEN CASE AND IT LANDS IN THE VERB-AWARE PASS ONLY** — `insurers/*` reads as addressed by path because `GET /insurers/:id` genuinely is — which is why fixing the by-path pass alone would have left it invisible, and why the verb-aware figure is the one to read first. A rise in that bucket is a client function written with no control; a fall is one wired or deleted, and the two are different facts from *nobody wrote a client*, which is why they are four budgets rather than one total |
| `npm run check:dead-helpers` | **THE DEAD-HELPER MATCHER STILL BEHAVES AS DECLARED** (exits non-zero; part of `npm run check:screen-pass`, **ordered BEFORE the two reachability gates that consume it**, so a broken module says so rather than letting them print a plausible wrong number). **IT IS NOT IN `ci.yml` AND THAT IS SAID RATHER THAN IMPLIED**: measured 2026-11-05, `ci.yml` does not call `check:screen-pass` at all — it names six `npm run check:*` scripts plus a handful of measurement scripts directly — so the two consumers are CI gates and this self-test is local only. **A `ci.yml` step is OWED and is the owner's to land**: the push authenticates as an OAuth App without `workflow` scope, which is why the two steps that landed on 2026-10-30 were edited in the browser. Until then this is the unwired-script state this repository already records against itself. `scripts/measurements/dead_helpers.py` answers one question — *is this exported client helper's name referenced anywhere outside its own declaration, under any name it can be imported as?* — and **that needs no call graph**, which is the measurement that decided the approach. Both reachability scripts decline cross-file resolution because it *"would need a real import graph"*, and they are right for THEIR question: resolving what a path IS means following values across modules. This one is name-reachability, and in ES modules a name can be renamed in exactly three textual places — `import { X as Y }`, `export { X as Y }`, and `import * as ns`. **All three were MEASURED rather than assumed**: across `app`/`components`/`lib` there are **0 namespace imports**, **0 `lib/**` re-exports** (the one barrel re-exports sibling components), and **exactly 2 aliased imports**. So one mechanism is live and resolving it is ten lines — and the module **ASSERTS the two absent ones**, raising the day either appears, because the alternative is reading a live helper as dead, which in a gate is a red build on a correct tree. **ITS BIAS IS STATED AND IS NOT TASTE**: LIVE when in doubt. Under-reporting leaves the gates where they already were — an upper bound — while over-reporting invents a failure, and those costs are not symmetric. **THE GUARD IS A `--self-test` OVER 6 PLANTED INPUTS, NOT A COUNT FLOOR**, because a count floor goes stale the moment the work it guards gets done: `FLOOR = 10` once guarded a real 26 and then refused a correct tree at 9. The planted set covers both directions including the one real false positive a hand triage of all 21 rows actually found — a helper called under an alias — and the case a comment creates, since a name in a comment is not a call. **ALL 21 ROWS WERE READ BY HAND on 2026-11-05: 1 CALLED, 1 MENTIONED-ONLY, 19 ABSENT.** The MENTIONED-ONLY row is `updateInsurer`, whose only two occurrences in `apps/web` were the comments recording its absence — so the file documenting the defect is what made a name-counting matcher read it as used. **AND THE FIRST RUN DISPROVED A SPOT-CHECK THE OLD INSTRUMENT HAD RECORDED ABOUT ITSELF**: `listSlaHolidays` was written down as dead code whose route *"is still perfectly reachable, through that other helper"*. It is not — `getHolidayYear` addresses `GET /sla/holidays/year/:year`, a different route — because the spot-check compared helper NAMES rather than the paths they address. `dead-client-helpers.py` is the hand-triage view and **carries no matcher of its own any more**: a question measured twice is this repository's own recorded defect, the em-dash script having been written twice and the two copies answering 145 against 91 |
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
   (`fail_action: false`) for now, see `docs/scope-and-gaps.md` § Known gaps, A.10.
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
