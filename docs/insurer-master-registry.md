# The insurer registry — global master data vs. per-office relationship

Multi-tenancy Part I §5. Before this, `Insurer` was one table holding both the
company's identity and one office's commercial relationship with it. Those are
two different things with opposite sharing rules, and keeping them in one row
forced a bad choice: share everything, or duplicate everything.

| | Shared platform-wide | Private to one office |
|---|---|---|
| Who the company is | `InsurerMaster.legalName` / `legalNameAr` / `linesOffered` | |
| Their official submission form | `InsurerFormTemplate` + `InsurerFormField` | |
| Negotiated commission | | `CommissionAgreement` |
| Named contacts, credit terms, financial-strength rating | | `Insurer` |
| Products actually placed, agreed SLAs | | `InsurerProduct`, `InsurerSlaAgreement` |

Two offices dealing with the same real insurer now converge on one
`InsurerMaster` and reuse the same mapped form, while neither can see the
other's commission rate. `Insurer` keeps its `organizationId`, so it is
filtered by the tenant extension and governed by an RLS policy exactly as
before.

## The three global tables carry no `organizationId`, deliberately

`InsurerMaster`, `InsurerFormTemplate` and `InsurerFormField` are §3.1 global
models, like `Role`/`Permission` and the watchlist cache. They have no
`organizationId`, so `tenantScopeExtension` leaves them unfiltered and
migration `20260929100000` installs **no** RLS policy on them. A policy keyed
to `app.current_org_id` would make the shared data invisible to everyone —
the opposite of what §5 asks for.

That inversion is worth stating plainly because every other tenancy rule in
this codebase points the other way: **adding `organizationId` to
`InsurerFormTemplate` would pass every isolation test in the suite and
silently destroy the sharing this model exists for.** The Part V item-8 test in
`tenant-isolation.e2e-spec.ts` is what pins it — it asserts a row IS visible
across offices, the only test in that file that does.

## Mapping a form

§5's workflow: the first person on the platform to deal with a given
insurer+line maps that insurer's PDF/Word form once, and every submission
afterwards — from any office — reuses the mapping.

```
GET  /insurer-masters                                  insurer.master.read
GET  /insurer-masters/:id
GET  /insurer-masters/:id/form-templates?insuranceLine=
GET  /insurer-masters/:id/form-templates/current?insuranceLine=
POST /insurer-masters/:id/form-templates               insurer.form.map
```

`insurer.master.read` goes to Sales, Placement, Manager, Executive and the
external auditor. `insurer.form.map` goes only to Placement and the system
administrator: a mapping becomes the form every other office submits against,
so it is not granted to the roles that merely consume it.

**`/current` returns `null`, not 404, when nobody has mapped that insurer+line
yet.** That is a real answer the caller acts on — §5 is explicit that an
unmapped form falls back to the generic structured fields already collected at
Needs Assessment/RFQ, so there is never a case where data has nowhere to go.

**A re-map is a new version, never an edit.** Other offices may already have
submitted against version 1, so it has to survive. Versions are per
insurer+line, and `@@unique([insurerMasterId, insuranceLine, version])` is what
actually allocates them: the repository reads the current maximum, attempts the
insert, and retries against the new maximum if it loses the race. Reading the
maximum and trusting it would be a check-then-act
(`ibms-brain/meta/lex/race-safe-invariants.md`).

There is no mapping **screen** yet — API and tests only, deliberately. Screens
belong with the Phase 4 UI work, and every new screen needs Arabic alongside
English.

## What the migration did to existing data

`20260929100000_insurer_master_split`, hand-authored rather than generated.
Prisma's own diff for this change wanted to drop eight raw-SQL indexes and four
generated-column defaults (pre-existing drift it cannot model — the same audit
Phase 1's migration records), and to `ADD COLUMN "insurerMasterId" TEXT NOT
NULL` in the same statement that `DROP`s `name`, which would both fail against
existing rows and destroy the data the masters are built from.

The real ordering is: add the new columns nullable → build one master per
distinct legal name → point each relationship row at its master and move the
contacts across → refuse to continue if anything is unmapped → only then set
`NOT NULL` and drop the old columns.

Column by column:

| Was | Is now |
|---|---|
| `Insurer.name` | `InsurerMaster.legalName` (globally unique) |
| `Insurer.nameAr` | `InsurerMaster.legalNameAr` |
| `Insurer.contactEmail` | `Insurer.rfqContactEmail` |
| `Insurer.contactPhone` | `Insurer.rfqContactPhone` |
| `Insurer.claimsContact` | `claimsContactEmail` if it looks like an address, else `claimsContactName` |
| `Insurer.underwriterContact` | unchanged |
| — | `Insurer.isActive`, new, defaults true |

`rfqContactPhone` is **not** in §5's model. It exists so the migration does not
silently drop the data in the existing `contactPhone` column; §10.2's contact
list is a minimum, and step 10 is explicitly a column-by-column migration.

Masters were grouped by name **platform-wide**, not per office, because
converging two offices on one company is the entire point. It was verified
first that no `(organizationId, name)` pair was duplicated in either database,
so no office could end up with two relationship rows against one master —
which `@@unique([organizationId, insurerMasterId])` now prevents outright.

## The trap this change set off

`typecheck` cannot see inside `$queryRaw`. Every TypeScript read of
`insurer.name` failed the build and was fixed; one **raw SQL** reference —
`ins.name` in `InvoiceRepository.loadInsurerObligations`, the insurer-payables
report — compiled cleanly and failed at runtime with `42703 column ins.name
does not exist`. Only the e2e suite caught it.

This is the same blind spot the RLS work hit from the other direction (raw SQL
is invisible to the tenant-scoping extension too). **Any future change to a
column on a table that raw SQL touches has to be greped for as SQL, not only as
a TypeScript property.** `grep -rn '"Insurer"'` across `apps`/`packages` is the
sweep that finds them; there is exactly one raw query against this table today.

A second, smaller trap in the same fix: a SQL comment inside a
`Prisma.sql` template literal cannot contain backticks — they open a nested
template expression and the file stops parsing.

## Five near-identical copies became one

Reading an insurer's name now needs a join, and five repositories
(comparison, policy, quotation, recommendation, rfq) each had their own private
`INSURER_IDENTITY_SELECT` naming `name`/`nameAr`. When the shape changed under
them, a stale `name: true` **did not fail the build** — Prisma's `Exact`
resolves an unknown key in a `select` to `never`, so the copies silently typed
`insurer.name` as `never` and surfaced only further downstream, if at all.

They are now one definition in `apps/api/src/repositories/insurer-identity.ts`,
alongside `insurerIdentity()` / `insurerName()`, which flatten the join back to
the `{ id, name, nameAr }` shape the API has always returned. **The wire format
is unchanged by the split** (policy's insurer object gains
`financialStrengthRating`, which is additive), so the web app needed no changes.
