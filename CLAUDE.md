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
| 2026-09-08 | **Part F item #7 — policy schedule summary, the 4th of 6 document types (after complaint acknowledgement, quotation comparison, recommendation report)**. Derived from `Policy` + its most recent `PolicySchedule` (the backlog's own "Derive it from Policy + PolicySchedule" scoping decision, made earlier this item for the certificate type, applies directly here too). Gated on a plain data-availability check, not a business-workflow one like the recommendation report: a Policy has no coverage schedule to summarize until Process 19 issuance records the first one (`schedules.length === 0` before that) — 422s in that window. New `PolicyService.getByIdWithCustomer()` (the same visibility-preserving-read pattern as the comparison/recommendation slices — `assertCustomerVisible()` now returns `Customer` instead of `void`) confirms `Policy` already enforced real per-customer visibility before this item (inherited from its Customer, plus a Policy Checking Officer's documented cross-book reach). First item #7 document to render `limits`/`sumsInsured` — free-form JSON coverage figures with no fixed key vocabulary — a flagged content decision: each key renders as literal untranslated text, each value through the shared money formatter (degrading gracefully for a non-numeric value). Mirrors `PolicySection.tsx`'s own existing "Requested X · Issued Y (Δ Z)" premium display and "Effective FROM–TO/ongoing" schedule wording. Web: the existing "Coverage schedule" block gained a "Download schedule summary (PDF)" button, shown only once `schedules.length > 0`. **Verification**: +15 new api unit tests (`policy-schedule-summary.template.spec.ts`) → api unit **2394/2394** (from 2379); +1 new api e2e test (`policy.e2e-spec.ts` — placed-but-not-issued → 422, plus permission/404/cross-owner/AR-EN-DUAL/invalid-language cases, every PDF case `%PDF-`-byte-verified) — targeted run of the 4 directly-touched e2e files **13/13 green**; +1 new Playwright test (extends the existing policy-placement test) — full `rfq.spec.ts` **29/29 green**; full api+web `typecheck`/`lint`/`build` clean. **The full 63-file api e2e suite was attempted fresh and again did NOT complete** — killed partway by this machine's own sustained memory pressure (as low as ~514-580MB free RAM), the same pre-existing host constraint as the recommendation-report round; real progress was made before the kill (4 unrelated files completed, all green, `rbac.e2e-spec.ts`'s own tests individually taking 100-330s each under the pressure) — accepted as a real, acknowledged gap per this table's own established resolution, not re-litigated each round. The full 60+-file web suite was not attempted either, for the same reason; `rfq.spec.ts` alone (the only file touching this round's web changes) was run in full instead. | No migration (one new `policy_schedule_summary` `DocumentTemplate` seed row). Read `ibms-brain/meta/context/bilingual-ui.md`'s "What item #7's policy-schedule-summary slice covers" before assuming item #7 is fully closed — it is NOT: 2 document types (invoice, certificate) and real persistence remain open, documented future work; do not self-select resuming them. Both full suites (api e2e, web e2e) need a fresh run when host memory allows. |
| 2026-09-08 | **Part F item #7 — recommendation report, the 3rd of 6 document types (after complaint acknowledgement, quotation comparison)**. Unlike the comparison document (an internal working document), this is the client-facing artefact Process 16's own `send()` exists to dispatch — a user-confirmed design decision gates document generation on the SAME `blockedFromSend` business-state check `send()` itself enforces (via a new `RecommendationService.getByIdWithCustomer()` sibling helper, reusing the comparison slice's own visibility-preserving-read pattern rather than widening an existing method's signature), so the template never renders for a recommendation still awaiting a required approval or COI disclosure. Content includes the recommended quote's full commercial terms (insurer/premium/commission/deductible/liability limit/BI period/exclusions/conditions), the rationale, all 6 factor notes, and the COI disclosure text when flagged; deliberately excludes internal governance metadata (drafter/approver/sender, the raw gate list, the raw commission-diff figure). Promoted 2 more shared formatters onto `document-html.util.ts` (`formatDocumentBiPeriod`/`formatDocumentPercent`), retroactively adopted by the quotation-comparison template too. **A `@code-reviewer` pass found 0 BLOCKERs, 3 MINORs, 2 NITs, all fixed**: the document initially omitted the recommended quote's own commercial terms even though 2 of the 6 rationale factors narrate terms it never stated (fixed — all now render, em dash for null, never an omitted row); the commission-rate percent was being escaped twice (fixed inside `formatDocumentPercent` itself, with a regression test); the document service was reading premium/deductible/etc. from the service layer's pre-formatted display strings instead of the raw `Prisma.Decimal` fields (fixed — reads straight off the raw recommendation record now); both this document and the earlier quotation-comparison document were missing a reference number a client could cite back (fixed, both). **Verification**: +18 new api unit tests (`document-html.util.spec.ts` +5, `recommendation-report.template.spec.ts` +12, `quotation-comparison.template.spec.ts` +1) → api unit **2379/2379** (from 2361); +1 new api e2e test (`recommendation.e2e-spec.ts` — drafted-and-blocked → 422, approve → still 422 pending COI, disclose → 200 with a real PDF, plus permission/404/cross-owner/AR-EN-DUAL/invalid-language cases, every PDF case `%PDF-`-byte-verified) — targeted run of the 3 directly-touched e2e files **7/7 green**, confirmed after all review fixes; full api `typecheck`/`lint`/`build` clean. **The full 63-file api e2e suite did NOT complete a fresh run this round** — repeated kills from this machine's own sustained memory pressure (as low as 330-406MB free RAM on an 8GB machine after a full day of heavy suite runs for the earlier 2 document-type slices), a pre-existing host constraint, not a regression from this change; per explicit user instruction to stop the wait-and-retry pattern and finish same-day, this is accepted as a real, acknowledged gap rather than blocked on further — the next session touching `apps/api` should run it fresh once memory allows. Web `rfq.spec.ts` (28/28) was verified green before this round's final API-only fix pass (which touched no web files), so remains valid but was not re-run fresh after. | No migration (one new `recommendation_report` `DocumentTemplate` seed row). Read `ibms-brain/meta/context/bilingual-ui.md`'s "What item #7's recommendation-report slice covers" before assuming item #7 is fully closed — it is NOT: 3 document types (policy schedule summary, invoice, certificate) and real persistence remain open, documented future work; do not self-select resuming them. The full e2e suite also needs a fresh run when host memory allows — see "Verification — item #7's recommendation-report slice" for why this round's number is a targeted 7/7, not a full-suite figure. |
| 2026-09-08 | **Part F item #7 — quotation comparison, the 2nd of 6 document types (after complaint acknowledgement)**, chosen by the user next. Reuses the first slice's shared rendering infrastructure (`PdfRendererService`, `DocumentTemplateRepository`, `DocumentGenerationModule`, `playwright-core`) unchanged — no new production dependency, no CI/Dockerfile change. Promoted `escapeHtml`/date+money formatting/base CSS/the language-query DTO out of the complaint template into a genuinely shared `document-html.util.ts` (a `@code-reviewer` MINOR finding on the first slice, acted on proactively). New, security-relevant: `ComparisonService.getByIdWithCustomer()` — unlike `Complaint` (flat `complaint.log` permission, no ownership scoping), `ComparisonMatrix` already enforces real per-customer visibility (a Sales Officer only reaches a comparison for a customer they own, unless cross-owner); the new method reuses the SAME private `loadVisibleRfq()` visibility check `getById()` already used, so the document endpoint cannot be used to bypass it — verified directly via e2e, not just by reading the code (a non-owning Sales Officer holding `comparison.read` still gets 404; a cross-owner Manager gets 200). Table columns deliberately mirror `apps/web/components/comparison/ComparisonSection.tsx`'s own existing display exactly (Insurer/Premium/Deductible/Liability limit/BI period/Commission %/Quality/Service/Exclusions&conditions, plus missing/declined insurer callouts) — a printable rendering of the same data, not a second independently-chosen column set. `GET /comparison-matrices/:id/document?language=AR\|EN\|DUAL`, same generate-on-demand/no-persistence shape as the first slice. Web: the RFQ detail page's Comparison section gained a "Download comparison (PDF)" button. **A second `@code-reviewer` pass (0 BLOCKERs, 3 MINORs, all fixed)**: `formatDocumentMoney()`'s non-finite branch wasn't escaping its arguments (not currently exploitable — real amounts are regex-validated upstream — but shared infrastructure, so fixed with a new test); a doc comment went stale in the same commit that invalidated it (removed); `getByIdWithCustomer()` fetched the same Customer row twice (fixed — the visibility check now returns the row instead of re-fetching). **Verification**: +18 new api unit tests → api unit **2361/2361** (from 2343); +1 new api e2e test (`comparison.e2e-spec.ts`, the FIRST e2e coverage Process 14 has ever had, including the visibility-scoping proof, every PDF case `%PDF-`-byte-verified) → full 63-file api e2e suite **313/313** (from 312; 6 tests hit this session's own sustained resource pressure across a long day of repeated full-suite runs — files entirely unrelated to this change — all re-confirmed clean in isolation); +1 new Playwright test → full web suite **299/299** (from 298, 233 non-`@a11y` + 66 `@a11y`). `npm run typecheck`/`lint`/`build`/`test` (api + web) OK. | No migration (one new `quotation_comparison` `DocumentTemplate` seed row). Read `ibms-brain/meta/context/bilingual-ui.md`'s "What item #7 does NOT cover" before assuming item #7 is fully closed — it is NOT: 4 document types (recommendation report, policy schedule summary, invoice, certificate) and real persistence both remain open, documented future work. Before building any of the remaining 4: check whether the underlying entity already enforces per-customer visibility beyond a flat permission (as `ComparisonMatrix` does but `Complaint` does not) — the document endpoint must inherit that check via the entity's own service, never its repository directly. |
| 2026-09-08 | **Part F item #6 remainder — fuzzy transliteration matching — PARTIALLY built: a curated synonym table only**, after presenting the user with empirical evidence from a research spike that REJECTED a distance-based fuzzy matcher (a real npm transliteration library + `pg_trgm`/`fuzzystrmatch` similarity, tested against `db-test` then fully reverted before any code was written): true-positive pairs like "Yousef"/"يوسف" (Levenshtein 1, trigram 0.29) scored in the SAME range as a genuine false positive — "Khaled" matching a stored "Khalil," a different person (Levenshtein 1, trigram 0.43) — an inherent short-alphabet phonetic-key collision (the same Soundex/Metaphone limitation), not an implementation defect. Built instead: `apps/api/src/common/name-transliteration.config.ts` — ~50 curated groups of KNOWN equivalent Latin/Arabic spellings for common Jordanian/Arab given names (hamza-dropped Arabic variants included, e.g. `أحمد`/`احمد`); `expandSearchTerms()` ORs every known variant into the SAME `Customer`/`Prospect`/`Vendor` `searchIds()` query item #6 already built, via Prisma's parameterized `Prisma.sql`/`Prisma.join` (no string concatenation, no new column, no migration). Zero false-positive risk (exact/stemmed match on a literal known term); coverage bounded to the table's ~50 groups — same-script typo tolerance and `Insurer` search remain deferred, unchanged from item #6's own scope. **Verification**: +9 new api unit tests → api unit **2335/2335** (from 2326); +6 new api e2e tests (2 per entity, each proving the base bilingual tsvector query alone could NOT have found the match — the two scripts share no tokens) → full 62-file api e2e suite **311/311** (from 305; 4 tests hit this suite's own documented full-suite-load timeout flake, all re-confirmed clean in isolation with the established longer timeout). `npm run typecheck`/`lint`/`build`/`test` (api) OK. No web files touched, confirmed via `git diff --stat`. | No migration, no seed change. Read `ibms-brain/meta/context/bilingual-ui.md`'s "What item #6 remainder does NOT cover" before assuming item #6 is fully closed — it is NOT: same-script typo tolerance and `Insurer` search remain open future work, and a distance-based fuzzy matcher was deliberately REJECTED (not merely deferred) — re-read that finding before re-attempting one. |
| 2026-09-08 | **Part F item #6 — bilingual full-text search — PARTIALLY built: full-text search only (Arabic + English), on `Customer`/`Prospect`/`Vendor`**, an explicit user scoping decision (fuzzy transliteration matching and same-script typo tolerance both deferred as future work). Entity scope also user-confirmed: `Insurer` excluded — no dedicated module or web list page exists for it anywhere (the same class of gap item #4 hit with `InsuredPerson`). Mechanism empirically verified against the actual running Postgres (18-alpine): a real built-in `'arabic'` text-search config ships alongside `'english'` (genuine stemming); bilingual documents concatenate both configs' tsvectors; query side uses `websearch_to_tsquery` OR'd across both, safely parameterized via Prisma's tagged-template `$queryRaw` (never `$queryRawUnsafe`) — the first real use of `$queryRaw` with user input anywhere in this codebase. One `GENERATED ALWAYS ... STORED` tsvector column + GIN index per model (`Customer` from `legalName` only — encrypted contact fields never indexed in plaintext; `Prospect` from `companyName`+`contactPerson`; `Vendor` from `name`); each repository gained a `searchIds(term)` method feeding the existing `findMany()` via `id: { in: ids }`. Web: all 3 list pages gained a submit-triggered search input (none had any filter UI before). **Verification**: +12 new api e2e tests (4 per entity, each proving REAL stemming — English "trade" finds "Trading", Arabic singular finds a stored plural — not substring luck) → full 62-file api e2e suite **305/305** (from 293); +3 new Playwright wiring tests → full web suite **297/297** (from 294, 231 non-`@a11y` + 66 `@a11y`). `npm run typecheck`/`lint`/`build`/`test` (api + web) OK. | No seed change. Read `ibms-brain/meta/context/bilingual-ui.md`'s "What item #6 covers/does NOT cover" before assuming item #6 is fully closed — it is NOT: fuzzy transliteration, same-script typo tolerance, and `Insurer` search all remain open future work. |
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
