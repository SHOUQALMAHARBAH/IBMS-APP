# The cross-office insurer directory

Read this before touching anything that reads, writes or renders the directory. The
boundary it enforces is the one thing in the insurer feature that protects offices from
each other, and the reasoning currently lives in a migration header — which is read only by
whoever is already editing the migration, i.e. the one person who has already made up their
mind.

## What it is

A read-only list of the insurance companies **any** office has registered, visible to every
office, one entry per company, searchable by name in either script. Fed automatically by
registrations. Nobody curates it, no vendor supplies it, and there is no admin surface for
it.

Its purpose is a single question: *an office needs cover for a risk nobody on its panel
writes — who else is out there?* Until this existed, the answer came from asking around.

`GET /insurer-directory`, gated on `insurer.directory.read`.

## The boundary — not negotiable

These are **competing brokerages on one platform**. The company is public knowledge; the
panel is not.

**Shown:** legal name in both scripts, structure (conventional / takaful / takaful window),
company-level contact details (phone, email, website, correspondence address), and the lines
of business offered.

**Never shown:** which offices deal with a company; how many do; when any of them registered
it; and nothing whatsoever from the office-scoped relationship — no credit terms, no
financial-strength rating, no commission, no relationship-specific named contacts, no
`isActive`.

### Why it is a view and not a careful `select`

A filtered query would need its `select` clause to stay correct forever. A shared select in
this codebase has already grown a column twice. So the boundary is structural instead:

- `InsurerDirectory` is a **`SECURITY DEFINER` view** — `security_invoker = false`, stated
  explicitly in the migration because it *is* the mechanism. The view executes as its owner,
  who is not subject to the RLS policy on `Insurer`.
- The app role **cannot read another office's `Insurer` row at all**, and the one thing it
  can read **has no office-scoped column in it to leak**.

Measured, not described (as `ibms_app`, no office context):

| | |
|---|---|
| `SELECT count(*) FROM "Insurer"` | `0` — RLS |
| `SELECT count(*) FROM "InsurerDirectory"` | every entry |
| `DELETE FROM "InsurerDirectory"` | refused |

That third row is **incidental, not designed**: an aggregating view is not auto-updatable in
Postgres, and this database's default privileges grant INSERT/UPDATE/DELETE on new
relations, so the `GRANT SELECT` is not what protects it. See IMPROVEMENTS.md § 1.21 for the
condition that attaches to any successor.

### The allow-list

`INSURER_DIRECTORY_COLUMNS` in `insurer-directory.repository.ts` is the **single** definition
of what crosses. The row type, the service's projection and two tests all read it.

The test that carries the weight enumerates the **view's** columns from
`information_schema` and demands they equal the list exactly — because the app role can
query the view directly, so a column present there is reachable by anything that can write
SQL, whatever the service maps. The service's projection is a second line of defence, not
the boundary.

Because the list is **positive**, a leaked column aliased to an innocent name fails as an
unknown name. No case analysis needed.

**If you add a column to that view, a test fails. That is the design.** Add it to the
allow-list only if it is genuinely public company data.

## Aggregation rules

| | |
|---|---|
| **Grouping** | `insurerMasterId`, else the stored `canonicalName`, else the row's own id. A catalogue-linked row groups by the company it links to (so every pre-existing row merges with no backfill); a locally registered row groups by its canonical name (so two offices registering the same company are one entry); a row predating the column is its own entry rather than a guess. |
| **Names, structure, contacts** | first non-null, earliest registration first. A later office filling a blank still helps. |
| **Lines** | the union across offices, deduplicated, with no hint of which office said what. Standard lines carry their code; an office's own addition appears by name with a null code. |
| **Presence** | depends **only** on having been registered. |

### Presence, specifically

There is no filter on `isActive` anywhere in the view, deliberately. A company vanishing
from the directory once the last office stopped dealing with it would be a weakened form of
exactly the disclosure the boundary forbids — **the disappearance is itself a signal about
other offices' behaviour**. The cost is accepted: there is no cleanup path, and a company
registered once is listed forever.

### `Insurer.canonicalName` — the database owns it

A **STORED GENERATED** column over `canonical_name_key("legalName")`, an `IMMUTABLE` SQL
function. The application cannot write it; Postgres refuses, and a test proves the refusal.

That is not tidiness. Before migration `20261013100000` the application computed this key and
the database trusted it, **while registration enforced uniqueness on `lower(legalName)`
instead** — so the directory merged two spellings that registration had accepted as two rows.
Measured: two insurer records, two sets of credit terms, one line on the screen, no error
anywhere. One definition now serves both the view's `GROUP BY` and
`Insurer_one_local_company_per_org`, so **registration refuses exactly what the directory
merges.**

The TypeScript `canonicalNameKey()` survives for one job — suggesting "did you mean…?" before
a row exists — and is pinned to the SQL function by `canonical-name-key-parity.e2e-spec.ts`, a
table of 39 names asserted against both.

NULL for a catalogue-linked row, which groups by `insurerMasterId` instead.

## What the directory deliberately does NOT do

**Everything after the search happens outside the system.** No contract request, no
follow-up workflow, no "we approached them on this date" record. An endpoint that recorded an
approach would be the first step towards the platform knowing which offices are talking to
which companies — the fact this whole boundary exists to keep private.

Do not add one.

## A CONSTRAINT ON THE SEARCH SCREEN

The view re-aggregates **every insurer on the platform** on every query. Measured on
db-test:

```sql
EXPLAIN (ANALYZE, TIMING OFF) SELECT * FROM "InsurerDirectory"
  WHERE "name" ILIKE '%Yarmouk%' ORDER BY "name" LIMIT 50;
-- 6,059 entries · Planning 54.8 ms · Execution 144.1 ms
```

Read that against the scale already stated for this product: a hundred offices at fifty
insurers each is about 5,000 companies. **6,059 is roughly steady state, not a distant
future.** And `LIMIT 50` does not help — the aggregate is computed before the filter applies.

144 ms is fine for a paginated search and **unacceptable for a query issued per keystroke**.
So the screen inherits three requirements rather than rediscovering them:

1. **Server-side search.** Never fetch the directory and filter in the browser — that is
   6,000 rows over the wire and a client-side copy of the boundary.
2. **Debounced input.** Not per keystroke. A trailing debounce, or search on submit.
3. **Paginated**, using the `{ items, total, page, pageSize }` envelope the endpoint already
   returns.

If those three stop being enough, IMPROVEMENTS.md § 1.21 has the ordered options — an index
on the group key, a materialized view, or a real `Company` table — and the read-only
condition that attaches to each.

## Where things are

| | |
|---|---|
| View + column + grants | `packages/db/prisma/migrations/20261012100000_insurer_directory_view/` |
| Allow-list, raw query | `apps/api/src/repositories/insurer-directory.repository.ts` |
| Service (projects through the allow-list) | `apps/api/src/modules/insurer/insurer-directory.service.ts` |
| Route + permission | `apps/api/src/modules/insurer/insurer-directory.controller.ts` |
| Boundary tests, planted leaks | `apps/api/test/insurer-directory.e2e-spec.ts` |
| Name normaliser | `apps/api/src/common/company-name.util.ts` |

## A STATED LIMIT: the directory cannot answer "who writes FLEET motor?"

Variants — fleet vs individual, group vs individual medical, a named sub-peril like
"(Fire)" — will live on `Policy` and `CommissionAgreement`, **not** on an insurer's offered
lines. An insurer offers `MOTOR_COMPREHENSIVE`; nothing records that it writes only fleet
motor.

So the directory answers **"who writes Motor Comprehensive?"** and cannot answer **"who writes
FLEET motor comprehensive?"**. An office searching for fleet cover gets every motor writer and
has to ask them.

That is acceptable and deliberate — the directory is a reference, not an authority, and the
office telephones the company either way (§ "What the directory deliberately does NOT do").
It is written down here because a known limit is cheap and a surprise is not: a broker who
expects the narrower answer and gets the broader one should find it documented rather than
discover it.

The reason it is not a defect: promoting a segment to its own line WOULD let the directory
answer the narrow question, and would stop a fleet-only writer appearing under Motor at all —
which is the opposite of what a discovery surface is for.

## Still open

- **Search by LINE of business is not implemented.** The endpoint searches names only. Since
  finding who writes a given cover is the directory's main purpose, this is the most
  significant gap, and it depends on the insurance-line vocabulary reaching the models that
  currently store a line as free text (IMPROVEMENTS.md § 1.15).
- **No fuzzy matching.** `canonicalNameKey()` folds orthography, the definite article and
  word order; it cannot fold meaning. Two offices can still register one company under
  names that share no words, and the directory will show two entries (§ 1.16).
