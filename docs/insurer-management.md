# Insurer management

Read this before touching anything under `apps/api/src/modules/insurer/`, the four models that
carry a line FK, or the insurer screens. It carries the constraints that will bite, not a tour
of the feature — the endpoint lists live in `README.md` § Scope status, and two sibling docs go
deeper on their own halves:

- **`docs/insurer-master-registry.md`** — the GLOBAL catalogue, the shared form templates, and
  Q9's office-scoped twin.
- **`docs/insurer-directory.md`** — the cross-office directory, its boundary, and its search.

Everything below is a property something else depends on. Each one has a test, and most were
found by breaking them.

---

## 1. An office's insurer row is TWO kinds of fact, and only one may leave the office

| | Examples | Who may see it |
|---|---|---|
| **COMPANY-level** | legal name, structure, switchboard, general mailbox, website, correspondence address, lines written | Every office, through the directory |
| **RELATIONSHIP-level** | credit terms, financial-strength rating, named RFQ/claims/underwriter contacts | This office only, ever |

`insurer.service.ts` has **two extractors** rather than one that returns everything, and the
detail screen has two headed sections. Both are deliberate: a field added to the wrong
extractor is a cross-office disclosure, not a typo, and the mistake has to be made twice to
land.

**What this means for you:** when you add a column, choose a group first. If you cannot say
which, it is relationship-level — the safe default is the one that does not cross a boundary.

## 2. `Insurer.insurerMasterId` is NULLABLE, and that is the whole feature

An office can register a company no global catalogue lists. So:

- **Never assume a master exists.** `insurer-identity.ts` coalesces the name (catalogue's when
  linked, the office's own otherwise) and is the single definition of "what is this company
  called". Do not join to `InsurerMaster` for a name.
- `isOfficeLocal` on the view is how a screen knows whether the NAME is editable — a
  catalogue-linked row's name is not the office's to correct.
- Registration has **two paths through one endpoint**, and exactly one must be used: a master id,
  or both legal names. Both-or-neither is a 422 naming which. The web DTO is a discriminated
  union and the form is a radio, so the invalid combination cannot be constructed client-side
  either.

## 3. ONE canonical name key, and it lives in the DATABASE

`canonical_name_key(text)` — an `IMMUTABLE` SQL function — backs three things at once: the
`STORED GENERATED` column `Insurer.canonicalName`, the directory view's `GROUP BY`, and the
per-office unique index. That is why they cannot disagree.

**Measured before the fix:** `"Al-Yarmouk Insurance"` and `"al yarmouk   insurance"` registered
into ONE office as two rows while the directory showed one entry, because two places decided
"are these the same company" and only one folded word order.

The TypeScript mirror (`company-name.util.ts`) survives for **mid-registration suggestions
only**, pinned by a 39-name parity test. **Do not add a third normaliser, and do not use the
TypeScript one on a matching path.**

**Do not "simplify" the SQL.** It contains no `lower()` and no `[:alnum:]` on purpose: under a C
ctype every Arabic letter is punctuation, so every Arabic name keyed to the EMPTY STRING and an
Arabic-primary office could register exactly one local insurer, ever. The folds are enumerated
ranges, Arabic-Indic digits are folded from both blocks, and NFKC runs innermost. The migration
asserts the property at deploy time and it caught the author twice.

## 4. The directory boundary is STRUCTURAL, not a careful `select`

`InsurerDirectory` is a `SECURITY DEFINER` view (`security_invoker = false`) whose columns are
an allow-list — `INSURER_DIRECTORY_COLUMNS`, one definition, asserted both against the API
response and against `information_schema`. The app role cannot read another office's `Insurer`
row at all; the view can, and the view has no office-scoped column in it to leak.

So **there is nothing to filter in application code**, which is the point: a service that had to
remember to drop a credit term would be one refactor away from not dropping it.

`insurer.directory.read` is a SEPARATE permission from `insurer.read`. They answer opposite
questions — "which companies exist" vs "who does my office deal with, on what terms" — so an
office can be given the market without being given its own panel. Never fold them.

## 5. Deactivation is ALLOW AND RECORD, and reports TWO policy counts

It never refuses on account of an existing obligation, because refusing would not settle one.

Two separately-named constants, and they must stay separate:

- `IN_FORCE_POLICY_STATUSES` — cover that is RUNNING. It expires on its own.
- `OPEN_OBLIGATION_POLICY_STATUSES` — the insurer STILL OWES AN ACTION.

One definition serves the confirmation screen and the audit row, so they cannot drift. **Do not
sum them.** The second is the one that should give an administrator pause, and a single total
hides exactly that half. The screen asserts each count by its own hook for this reason.

## 6. Two line catalogues, and a CODE is the identity

- `InsuranceLine` — the managed 32, each with a platform-wide `code`. Seeded.
- `OfficeInsuranceLine` — an office's own additions. **No code, by design**: two offices
  inventing `PET` for different things would make the code meaningless.

Consequences that trip people up:

- A caller naming a line ACROSS a boundary (a URL, a saved filter, the directory's `lineCode`,
  a commission rate) must name it by CODE. An office line therefore cannot be named that way,
  and an API that accepts a code must refuse anything else rather than guess.
- `code === null` is how every view says "this is local vocabulary". The directory relies on it
  and carries no hint of WHICH office added the line.
- An office-added line that canonically MEANS a catalogue line is refused on both write paths,
  and `insurer-schema-constraints.e2e-spec.ts` asserts the colliding set is empty. **Assert the
  invariant; do not compensate for its absence at read time** — a read-side name fallback was
  written, measured to cover nothing, and deleted.

## 7. Four models must AGREE about a line, and identity flows by COPY

`InsuranceProgramLine`, `RFQ`, `Policy`, `CommissionAgreement` — a programme line becomes an
RFQ, an RFQ becomes a Policy, a commission agreement is applied to a Policy by line. Four
independently-typed strings cannot be matched; four FKs to one catalogue can.

    programme line  --inherits-->  RFQ  --inherits-->  Policy

**Only the programme line RESOLVES a line** (from `COVERAGE_LINE_MAPPINGS`' catalogue code).
Downstream writers **copy the parent's FK**. Resolving the string again at any step would be a
second lookup that has to agree with the first forever, which is the defect the FK removes.

`CommissionAgreement` is the exception and REFUSES rather than writing NULL: a rate on a line
nothing can match is a rate that will never be applied, and this is the table that decides what
the broker is paid.

**The trap this closed, and the one to watch for elsewhere:** migration `20261019100000`
backfilled every existing row and changed no writer, so for three days every NEW row was
unmapped — 6 and 4 on two models it had mapped 100%. Nothing failed, because nothing read the
column. A migration that converts rows and leaves the writers behind decays monotonically. See
`IMPROVEMENTS.md` § 1.40.

All four carry **both** a simple FK (what Prisma's client and referential actions are built
against) and a composite `(lineId, organizationId)` tenant FK (what makes a cross-office
reference fail to INSERT). **Dropping either loses something** — the first the schema's honesty,
the second tenant isolation — and they look like duplicates, which is how one gets tidied away.

## 8. The commission VARIANT axis, and why its unique index needs `NULLS NOT DISTINCT`

The 32 lines cannot express a crossing: fleet-vs-individual motor, group-vs-individual medical,
a named sub-peril. Measured, not argued — six insurers each carry two simultaneously-open
agreements, every one the pair `Property All Risks` + `Property All Risks (Fire)`.

`UNIQUE (insurerId, insuranceLineId, variantKey)` does **not** constrain two rows whose variant
is NULL, because Postgres treats NULLs as distinct — so the plain-line case, the COMMON case, is
exactly the one a naive constraint misses. `NULLS NOT DISTINCT` fixes it, and the migration
asserts `pg_index.indnullsnotdistinct` rather than trusting the DDL.

## 9. Q9's office form templates are a SECOND model, not a column

`InsurerFormTemplate` is global on purpose — one mapping readable by every office is Part I § 5's
promise. `applyTenantScope` adds `where: { organizationId }` to every query on any model carrying
that column, and the scoped set is derived from the DMMF, so **a row visible to every office and
a table the extension scopes are mutually exclusive.** Adding the column there would withdraw
§ 5 silently.

`OfficeInsurerFormTemplate` hangs off the office-scoped `Insurer` instead. Full reasoning, and
the precedence rule for "which form do I submit against", in
`docs/insurer-master-registry.md`.

## 10. Things that will bite, in one list

- **`schema.prisma` deliberately holds LESS than the database.** `migrate dev` would generate a
  migration dropping GIN indexes and un-generating columns. Hand-write the migration, apply it,
  `migrate resolve`, then run `db:checksums`.
- **`db:divergence` cannot see PARTIAL indexes or CHECK constraints.** Measured. Where a partial
  index carries a real invariant, assert it in its own migration's `DO` block or in a test.
- **Six database gates exist** (`db:checksums`, `db:divergence`, `db:privileges` and their
  `db:test:` variants). Run them; `verify.sh` does.
- **A nav entry must sit in a group every holder of its gating permission can see.** `insurer.read`
  is broad, so the insurer screens are in New business, not Operations — an Executive holds
  `insurer.read` and deliberately sees no Operations group. The rule is not what kind of thing a
  screen is; it is who holds its permission.
- **`insurer.form.map` is still office-grantable and its effect crosses offices.** The office
  administrator deliberately does not hold it, and Q9 means nobody now needs it. See
  `README.md` § Known gaps.

## 11. Not built, deliberately

- No screens for the insurance-line vocabulary, Q9's form templates, or the read-only master
  registry. `IMPROVEMENTS.md` § 1.44 has the measured list of every API surface with no UI.
- The commission rate DTO takes a line as a STRING resolved at the boundary, not a line ID — so
  an office's own added line is not yet reachable on the rate table. Closing it means the DTO
  taking `lineId`; the picker already has the ids.
- `InsurerProduct`'s free-text line is unconverted: nothing compares it to another model's line,
  so it converts the moment anything does.
- The `insuranceLine` STRING columns stay until a test measures zero unmapped rows **on a
  database with real volume**. On a freshly reset test database that count reads zero because the
  rows are gone, not because they mapped — § 1.40 carries the warning.
