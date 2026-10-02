# Should e2e fixtures write through the API instead of Prisma?

**Measured 2026-10-02.** Re-run rather than quote:

```bash
python scripts/measurements/e2e-prisma-fixtures.py
```

The owner asked this as "the 564-fixtures report". **The number is now 620, not 564** — the figure moved
because this session added fixtures of its own (the import report, the employee rehire, the duplicate
warning, the picker gates). That drift is the first thing to say about it: a count of test-suite
internals changes every working day, so this document records what the SPLIT is and the script records
the number.

---

## The answer, in one line

**No — not as a blanket convention. 93 of the 620 could not go through the API at all, 42 exist
precisely to reach a state the API cannot produce, and of the 485 creates the conversion is *possible*
for all but 9.** Possible is not the same as wanted, and the cost falls unevenly. What is worth adopting
is a narrower rule, stated at the end.

---

## The split

| | count | what it is |
|---|---:|---|
| `create` | 471 | |
| `createMany` | 12 | |
| `upsert` | 2 | |
| **creates — the only ones in question** | **485** | |
| `deleteMany` | 89 | |
| `delete` | 4 | |
| **teardown — no HTTP equivalent for most models** | **93** | |
| `update` | 37 | |
| `updateMany` | 5 | |
| **state mutations — often the whole point** | **42** | |
| **total** | **620** | across 109 spec files |

### Why teardown is not in scope

There is no `DELETE /sla-holidays/:id`, no `DELETE /audit-log-entries` (the table has an immutability
trigger, deliberately), and no delete route for most of what a test creates. `db-test` is **cumulative
and shared across the whole run**, so a spec that cannot clean up changes the answers of every later
spec — which this repo has already paid for twice: a holiday left behind moved business-day arithmetic
for every subsequent spec, and leaked roles made the permission-fixture generator read test roles as the
seeded grid. Teardown through Prisma is not a shortcut; it is the only mechanism.

### Why state mutations are usually right

A paused SLA timer, a retention window that expired last year, an employee terminated and rehired, a
watchlist generation past its retention — the test needs the STATE, not the journey. Routing those
through HTTP would mean building endpoints to satisfy tests, which is the tail wagging the dog. The 42
are worth reading individually; they are not worth a convention.

---

## The 9 writes where conversion is impossible

Four models, which **nothing in the application creates**:

| model | writes in tests | |
|---|---:|---|
| `insurerMaster` | 4 | the global insurer catalogue — seeded, never written over HTTP |
| `insurerProduct` | 3 | |
| `insuredPerson` | 1 | no CRUD exists; recorded as a known gap in the 2026-09-28 deferral |
| `slaPolicyEscalation` | 1 | |

Each is also worth a second look **for the opposite reason**: a model the product never writes is either
scenery or a gap. `insuredPerson` is a known gap (it has no CRUD at all, which the deferral conditions
recorded). `insurerMaster` is correctly seed-only — a global catalogue is not an office's to edit.

---

## Where a convention change would actually be felt

| spec | raw writes |
|---|---:|
| `insurer-deactivation.e2e-spec.ts` | 30 |
| `employee-performance.e2e-spec.ts` | 25 |
| `financial-dashboard.e2e-spec.ts` | 20 |
| `claims-dashboard.e2e-spec.ts` | 17 |
| `sales-dashboard.e2e-spec.ts` | 16 |
| `watchlist-dataset-lifecycle.e2e-spec.ts` | 16 |
| `policy-dashboard.e2e-spec.ts` | 15 |
| `rbac.e2e-spec.ts` | 14 |
| `claim.e2e-spec.ts` | 13 |
| `compliance-dashboard.e2e-spec.ts` | 13 |

**Six of the ten are DASHBOARD specs, and that is the shape of the answer.** A dashboard spec needs a
book of business to aggregate: policies across four insurers and three branches, claims in five
statuses, invoices half-collected. Building that through HTTP means walking placement, issuance,
notification, registration and settlement for every row — dozens of requests to produce scenery whose
only job is to be summed. The assertion is about the ARITHMETIC, and the arithmetic does not care how
the rows arrived.

The top two write counts are the clearest cases on either side:

* `insurer-deactivation` (30) creates policies in six statuses to prove the impact counts. The statuses
  are the point and most of them are mid-workflow — reaching them through HTTP is the workflow engine's
  test, not this one's.
* `employee-performance` (25) creates performance rows to be scored. Same shape.

---

## The one real cost, with its own worked example

A Prisma fixture can create **a row the API could not produce**, and a test standing on one asserts
behaviour over a state the product cannot reach. This is not hypothetical here:

* **The bulk import wrote customers through a path that bypassed the intake DTO.** Found this session:
  the 2000-row path hand-rolled two checks and skipped the DTO's rules, so it could create corporate
  rows with no registration number — rows the new canonical-key index cannot protect. That is the same
  shape of hole, in production code.
* **`legacy-import-report.e2e-spec.ts` seeds its first company THROUGH the import endpoint** rather
  than with Prisma, deliberately, so the duplicate check is proven against what the import itself
  writes. A Prisma-seeded company would have proven the check against a row no import ever produced.

The second is the pattern to copy, and it is narrow.

---

## The rule worth adopting

Not "convert the fixtures". This:

> **When a test asserts that a mechanism SEES what another mechanism WROTE, the written row goes through
> the real write path. Everything else may be a fixture.**

A duplicate check against imported rows, a uniqueness constraint against a created record, an audit
query against an audited act — those are claims about a pairing, and a hand-made row breaks the pairing
while leaving the test green. Scenery to be counted, summed, aged or filtered is scenery.

Two supporting rules that cost nothing:

1. **A fixture that omits a column the model has is a fixture whose row state nobody knows.** Already
   learned here the hard way — seven recommendation unit tests failed on a fixture omitting three
   discard columns, and that was the fixture being wrong rather than the guard.
2. **A fixture created in a cumulative database must be torn down, and its identifying values derived
   from the run.** Both halves: a leftover row changes later specs, and a fixed value collides on the
   second run. Also already paid for, twice.

---

## What is NOT claimed

* **The 42 state mutations have not been read one by one.** Some will be shortcuts rather than
  unreachable states. The script names the models, not the intent.
* **No ranking of the 485 creates by whether conversion is wanted.** That is per test and the script
  says so rather than pretending to a verdict.
* **The possible/impossible split reads non-test api source for `.<model>.create`.** Its first version
  anchored on `.client.X.create` / `.tx.X.create` and missed `tx.claim.create` — a bare `tx` with no dot
  before it — which reported `claim`, `employee`, `lead` and `receipt` as impossible-to-convert when
  they are the opposite. Four false findings, in the safe-looking direction, caught by reading the
  output rather than the counts. The fix searches per candidate model by name, which needs no guess
  about how the client is reached.
