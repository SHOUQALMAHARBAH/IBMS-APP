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
| 2026-09-08 | **Part F item #7 — quotation comparison, the 2nd of 6 document types (after complaint acknowledgement)**, chosen by the user next. Reuses the first slice's shared rendering infrastructure (`PdfRendererService`, `DocumentTemplateRepository`, `DocumentGenerationModule`, `playwright-core`) unchanged — no new production dependency, no CI/Dockerfile change. Promoted `escapeHtml`/date+money formatting/base CSS/the language-query DTO out of the complaint template into a genuinely shared `document-html.util.ts` (a `@code-reviewer` MINOR finding on the first slice, acted on proactively). New, security-relevant: `ComparisonService.getByIdWithCustomer()` — unlike `Complaint` (flat `complaint.log` permission, no ownership scoping), `ComparisonMatrix` already enforces real per-customer visibility (a Sales Officer only reaches a comparison for a customer they own, unless cross-owner); the new method reuses the SAME private `loadVisibleRfq()` visibility check `getById()` already used, so the document endpoint cannot be used to bypass it — verified directly via e2e, not just by reading the code (a non-owning Sales Officer holding `comparison.read` still gets 404; a cross-owner Manager gets 200). Table columns deliberately mirror `apps/web/components/comparison/ComparisonSection.tsx`'s own existing display exactly (Insurer/Premium/Deductible/Liability limit/BI period/Commission %/Quality/Service/Exclusions&conditions, plus missing/declined insurer callouts) — a printable rendering of the same data, not a second independently-chosen column set. `GET /comparison-matrices/:id/document?language=AR\|EN\|DUAL`, same generate-on-demand/no-persistence shape as the first slice. Web: the RFQ detail page's Comparison section gained a "Download comparison (PDF)" button. **A second `@code-reviewer` pass (0 BLOCKERs, 3 MINORs, all fixed)**: `formatDocumentMoney()`'s non-finite branch wasn't escaping its arguments (not currently exploitable — real amounts are regex-validated upstream — but shared infrastructure, so fixed with a new test); a doc comment went stale in the same commit that invalidated it (removed); `getByIdWithCustomer()` fetched the same Customer row twice (fixed — the visibility check now returns the row instead of re-fetching). **Verification**: +18 new api unit tests → api unit **2361/2361** (from 2343); +1 new api e2e test (`comparison.e2e-spec.ts`, the FIRST e2e coverage Process 14 has ever had, including the visibility-scoping proof, every PDF case `%PDF-`-byte-verified) → full 63-file api e2e suite **313/313** (from 312; 6 tests hit this session's own sustained resource pressure across a long day of repeated full-suite runs — files entirely unrelated to this change — all re-confirmed clean in isolation); +1 new Playwright test → full web suite **299/299** (from 298, 233 non-`@a11y` + 66 `@a11y`). `npm run typecheck`/`lint`/`build`/`test` (api + web) OK. | No migration (one new `quotation_comparison` `DocumentTemplate` seed row). Read `ibms-brain/meta/context/bilingual-ui.md`'s "What item #7 does NOT cover" before assuming item #7 is fully closed — it is NOT: 4 document types (recommendation report, policy schedule summary, invoice, certificate) and real persistence both remain open, documented future work. Before building any of the remaining 4: check whether the underlying entity already enforces per-customer visibility beyond a flat permission (as `ComparisonMatrix` does but `Complaint` does not) — the document endpoint must inherit that check via the entity's own service, never its repository directly. |
| 2026-09-08 | **Part F item #7 — system-generated bilingual documents — PARTIALLY built: complaint acknowledgement only**, the vertical slice chosen (via `AskUserQuestion`, after a research spike into rendering-engine options) to prove the FIRST document-generation infrastructure this app has ever had. Rendering mechanism empirically verified before building: a real bilingual Arabic+English HTML page was rendered to PDF via headless Chromium (`playwright-core`, reusing the browser `apps/web`'s own Playwright e2e install already caches) and visually inspected — correct Arabic shaping, RTL layout, embedded LTR numbers; a JS-native PDF library was rejected for having no reshaping story for Arabic. Activates the previously-dormant `DocumentTemplate` model (Part 11.2, schema-only until now) for its EDITABLE bilingual boilerplate prose; structured per-instance facts (reference, dates, category, SLA due date) are real domain data merged in by code, never stored in the template. `GET /complaints/:id/acknowledgement?language=AR\|EN\|DUAL` generates on demand and streams back (no persistence — this app has no real object storage anywhere); DUAL renders Arabic first, English second. Web gained the app's first binary-download primitive (`apiFetchBlob`) and a download button on `/complaints`. **A mandatory `@code-reviewer` pass caught 2 real BLOCKERs before this was done**: (1) the feature wasn't actually deployable — no Chromium install step in CI's `backend` job, and the production Dockerfile's Alpine base doesn't support Playwright's Chromium (musl vs. glibc) — fixed (CI step added; Dockerfile's runtime stage switched to `node:20.19.0-slim`); (2) `PdfRendererService` had no recovery path after a browser launch failure/crash, wedging every future request — fixed (resets and retries on failure/disconnect). 4 MINORs also fixed: `escapeHtml()` missing a single-quote case, a duplicated fetch-retry block extracted into a shared helper, a dead conditional simplified, and `page.route()` SSRF-hardening added against a future template introducing an external reference. **Verification**: +8 new api unit tests → api unit **2343/2343** (from 2335); +1 new api e2e test (real `%PDF-`-byte-verified AR/EN/DUAL/override/permission/404/400 cases) → full 62-file api e2e suite **312/312** (from 311; 5 tests hit this session's own severe memory pressure — as low as ~350MB free RAM — and were re-confirmed clean in isolation); +1 new Playwright test → full web suite **298/298** (from 297, 232 non-`@a11y` + 66 `@a11y`). `npm run typecheck`/`lint`/`build`/`test` (api + web) OK. **The Docker fix was independently verified end-to-end, and that verification caught a THIRD real bug**: a successful `docker build` still failed to LAUNCH Chromium as the unprivileged `nestjs` runtime user (`Executable doesn't exist at /nonexistent/.cache/ms-playwright/...`) — Playwright resolves its browser cache under `$HOME`, which differs between the root user that installs it during the build and the `adduser --system` runtime user (no real home directory). Fixed with `ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` + a `chown` to the runtime user; re-verified by rebuilding and directly launching Chromium inside the running container, rendering a real `%PDF-`-verified bilingual PDF as `nestjs`. | No migration (seed data only). Read `ibms-brain/meta/context/bilingual-ui.md`'s "What item #7 does NOT cover" before assuming item #7 is fully closed — it is NOT: the other 5 document types (quotation comparison, recommendation report, policy schedule summary, invoice, certificate) and real persistence both remain open, documented future work. |
| 2026-09-08 | **Part F item #6 remainder — fuzzy transliteration matching — PARTIALLY built: a curated synonym table only**, after presenting the user with empirical evidence from a research spike that REJECTED a distance-based fuzzy matcher (a real npm transliteration library + `pg_trgm`/`fuzzystrmatch` similarity, tested against `db-test` then fully reverted before any code was written): true-positive pairs like "Yousef"/"يوسف" (Levenshtein 1, trigram 0.29) scored in the SAME range as a genuine false positive — "Khaled" matching a stored "Khalil," a different person (Levenshtein 1, trigram 0.43) — an inherent short-alphabet phonetic-key collision (the same Soundex/Metaphone limitation), not an implementation defect. Built instead: `apps/api/src/common/name-transliteration.config.ts` — ~50 curated groups of KNOWN equivalent Latin/Arabic spellings for common Jordanian/Arab given names (hamza-dropped Arabic variants included, e.g. `أحمد`/`احمد`); `expandSearchTerms()` ORs every known variant into the SAME `Customer`/`Prospect`/`Vendor` `searchIds()` query item #6 already built, via Prisma's parameterized `Prisma.sql`/`Prisma.join` (no string concatenation, no new column, no migration). Zero false-positive risk (exact/stemmed match on a literal known term); coverage bounded to the table's ~50 groups — same-script typo tolerance and `Insurer` search remain deferred, unchanged from item #6's own scope. **Verification**: +9 new api unit tests → api unit **2335/2335** (from 2326); +6 new api e2e tests (2 per entity, each proving the base bilingual tsvector query alone could NOT have found the match — the two scripts share no tokens) → full 62-file api e2e suite **311/311** (from 305; 4 tests hit this suite's own documented full-suite-load timeout flake, all re-confirmed clean in isolation with the established longer timeout). `npm run typecheck`/`lint`/`build`/`test` (api) OK. No web files touched, confirmed via `git diff --stat`. | No migration, no seed change. Read `ibms-brain/meta/context/bilingual-ui.md`'s "What item #6 remainder does NOT cover" before assuming item #6 is fully closed — it is NOT: same-script typo tolerance and `Insurer` search remain open future work, and a distance-based fuzzy matcher was deliberately REJECTED (not merely deferred) — re-read that finding before re-attempting one. |
| 2026-09-08 | **Part F item #6 — bilingual full-text search — PARTIALLY built: full-text search only (Arabic + English), on `Customer`/`Prospect`/`Vendor`**, an explicit user scoping decision (fuzzy transliteration matching and same-script typo tolerance both deferred as future work). Entity scope also user-confirmed: `Insurer` excluded — no dedicated module or web list page exists for it anywhere (the same class of gap item #4 hit with `InsuredPerson`). Mechanism empirically verified against the actual running Postgres (18-alpine): a real built-in `'arabic'` text-search config ships alongside `'english'` (genuine stemming); bilingual documents concatenate both configs' tsvectors; query side uses `websearch_to_tsquery` OR'd across both, safely parameterized via Prisma's tagged-template `$queryRaw` (never `$queryRawUnsafe`) — the first real use of `$queryRaw` with user input anywhere in this codebase. One `GENERATED ALWAYS ... STORED` tsvector column + GIN index per model (`Customer` from `legalName` only — encrypted contact fields never indexed in plaintext; `Prospect` from `companyName`+`contactPerson`; `Vendor` from `name`); each repository gained a `searchIds(term)` method feeding the existing `findMany()` via `id: { in: ids }`. Web: all 3 list pages gained a submit-triggered search input (none had any filter UI before). **Verification**: +12 new api e2e tests (4 per entity, each proving REAL stemming — English "trade" finds "Trading", Arabic singular finds a stored plural — not substring luck) → full 62-file api e2e suite **305/305** (from 293); +3 new Playwright wiring tests → full web suite **297/297** (from 294, 231 non-`@a11y` + 66 `@a11y`). `npm run typecheck`/`lint`/`build`/`test` (api + web) OK. | No seed change. Read `ibms-brain/meta/context/bilingual-ui.md`'s "What item #6 covers/does NOT cover" before assuming item #6 is fully closed — it is NOT: fuzzy transliteration, same-script typo tolerance, and `Insurer` search all remain open future work. |
| 2026-09-07 | **CLOSES Part F item #4** ("Arabic-first input") — resumed its two deferred sub-problems by explicit user go-ahead. **Arabic keyboards confirmed CLEAR, no code change needed**: grepped all 67 `@Matches` validators across every api DTO (none restrict a name field to Latin-only characters), every web `pattern=` attribute (only 3, all 6-digit MFA codes), and `@Length`/`@MinLength` on name fields (correct for Arabic script, no surrogate-pair miscount). **National-ID-convention name-splitting built**: a real schema migration (`givenName`/`fatherName`/`grandfatherName`/`familyName`, all nullable) on `Customer` (INDIVIDUAL only), `Employee`, `UltimateBeneficialOwner` — the 3 models with both real CRUD and an existing `nationalIdEnc`; `InsuredPerson` deliberately excluded (zero CRUD anywhere yet). The flat field (`legalName`/`fullName`) stays computed, auto-joined from the 4 parts by one new shared `apps/api/src/common/person-name.util.ts` helper — every existing consumer (sorting, `<bdi>` display, search, audit, exports) keeps working unchanged. `givenName`/`familyName` required, `fatherName`/`grandfatherName` optional (a flagged judgment call). No backfill. Web forms (`CustomerOnboardingWizard.tsx`, `employees/page.tsx`) gained the 4-input treatment; 3 pre-existing item #3 `<bdi>` gaps found and fixed along the way. **A real migration-tooling blocker**: Docker Desktop's engine was unresponsive for a large stretch of this session (root-caused via its own log to a stuck background update — the backend process hadn't actually restarted despite an app relaunch, until a full quit from the tray); once genuinely restarted, the migration applied via this repo's established hand-authored-migration-plus-`migrate resolve` workaround (a pre-existing, unrelated checksum-drift issue blocks plain `migrate dev`). **Verification**: +5 unit tests → api unit **2326/2326** (from 2321); full 62-file api e2e suite **293/293** (1 transient MFA/TOTP-timing flake, unrelated, re-confirmed clean in isolation); full web suite **228/228** non-`@a11y` + **66/66** `@a11y`. `npm run typecheck`/`lint`/`build`/`test` (api + web) OK. | No seed change. Read `ibms-brain/meta/context/bilingual-ui.md`'s "What item #4 covers/does NOT cover" — `InsuredPerson` name-splitting remains open, deferred until that model has real CRUD. Item #5 remains PARTIALLY built — do not self-select resuming it or starting item #6. |
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

Infrastructure (Part A + Part B), plus Part C **Domain A, Processes 1–10** — Lead
Management (#1), Prospect Management (#2), Customer Acquisition/Onboarding (#3-4, with
*simulated* screening), Needs Assessment (#5), Risk Assessment (#6), Product
Recommendation / Program Design (#7), Cross-Selling (#8, a no-op until the Policy module
lands), Up-Selling (#9, flags a survey that outgrew the designed property Sum Insured),
Relationship Management / CRM (#10, logs every touchpoint as an `Interaction` and serves
the aggregated 360° customer timeline — policies/claims/complaints empty until Domains
B/C/E land). **Domain A is complete.** Part C **Domain B** has begun with RFQ / Market
Submission (#11) — a minimal `Opportunity` parent (created from a FINALIZED Insurance
Program) plus `RFQ`/`RFQInsurer` (one RFQ per line, insurer shortlist, per-insurer
response tracking, a nightly business-day follow-up alert sweep). Everything else —
Domain B #12–22, Domains C–H, and Parts D–G (PDPL, dashboards, bilingual UI, final
verification) — is not started. See root `README.md` § Scope status for the full picture
and § Known gaps for each built item's deferred edges.

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
