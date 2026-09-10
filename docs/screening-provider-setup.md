# Screening providers — setup, configuration and what is still missing

Operational runbook for the sanctions/PEP screening subsystem (backlog Part B).

This document exists to answer one question precisely: **what does a deployment
have to do to make screening real, and what can no amount of configuration
fix?**

---

## The one thing this system will never do

**It will never report a customer CLEAR because it could not screen them.**

Every path that cannot produce an answer says so, and says which kind of
"cannot":

| Attempt outcome | Means | Presented as clear? |
|---|---|---|
| `NO_MATCH` | A populated source was searched; the subject was not on it | **Yes — the only one** |
| `POTENTIAL_MATCH` | The provider returned a candidate above the review threshold | No |
| `NOT_CONFIGURED` | No provider is configured | No |
| `SCREENING_FAILED` | Configured, but the attempt failed | No |
| `UNABLE_TO_SCREEN` | Answered, but the data cannot support a decision (empty/stale) | No |

This is enforced in three places, deliberately:

1. `isClear()` in the provider contract — `NO_MATCH` and nothing else.
2. `ScreeningService` maps anything else to `PENDING_INVESTIGATION`.
3. A database CHECK, `ScreeningResult_clear_requires_no_match`, refuses the
   wrong mapping from **any** write path — including a future migration, a
   seed, or an admin tool nobody has written yet.

---

## Choosing a provider

Set `SCREENING_PROVIDER` to one of:

### `built_in` (the default)

Matches against `WatchlistEntry`, this repository's own synced cache of two
free public sanctions lists: **OFAC SDN** and the **UN Consolidated List**.
No API key, no contract, no third-party data share.

```bash
SCREENING_PROVIDER=built_in
```

**The cache starts EMPTY.** Until a sync completes, every screening returns
`UNABLE_TO_SCREEN` — correctly, because an empty table cannot clear anybody.
Run the sync before onboarding:

```bash
curl -X POST http://localhost:4000/watchlist-sync/run \
  -H "Authorization: Bearer $TOKEN"
```

After that the 12-hourly `WatchlistSyncScheduler` keeps it current.

**This provider has no PEP data**, and reports `PEP: supported=false` in its
capabilities. OFAC and UN are sanctions lists. See "What is still missing".

### `on_premise` — yente / OpenSanctions

Keeps the subjects screened inside the broker's own infrastructure. The
subjects are Highly Confidential, and sending them to a commercial provider is
a third-party data share with its own PDPL basis to establish first.

```bash
SCREENING_PROVIDER=on_premise
SCREENING_BASE_URL=http://localhost:8000
SCREENING_DATASET=sanctions        # or `default`, `peps`, ...
```

Run the engine from this repository's own compose file (opt-in profile — the
dataset is a multi-GB download, so it is not started by `docker compose up`):

```bash
docker compose --profile screening up -d screening-engine

# Watch the first ingest. It takes a long time.
docker compose logs -f screening-engine

# Ready when this returns 200:
curl -fsS http://localhost:8000/readyz
```

Then point the API at it:

```bash
SCREENING_PROVIDER=on_premise SCREENING_BASE_URL=http://localhost:8000 npm run dev
```

The index is empty until the first ingest finishes. Until then the adapter
reports `UNABLE_TO_SCREEN`, the same rule the built-in cache follows.

Whether this deployment gets PEP coverage depends entirely on
`SCREENING_DATASET`: a sanctions-scoped dataset gives sanctions only. The
adapter reports that honestly in its capabilities rather than claiming PEP
because yente *can* serve it.

### `commercial` — a contracted provider

```bash
SCREENING_PROVIDER=commercial
SCREENING_BASE_URL=https://api.<provider>.example
SCREENING_API_KEY=...              # from the deployment's secret store
SCREENING_SEND_IDENTIFIERS=false   # see below
```

**The adapter's request and response shapes are documented but UNVERIFIED
against any real vendor.** No credentials were available to test against a live
service, and writing a client that "should work" and calling it done is how a
screening integration fails silently in production. Read
`commercial.provider.ts` before pointing it at a real endpoint: the mapping is
where a vendor's actual API will differ.

Until a successful health check, the adapter reports every capability as
`operational: false`. Capability breadth is a matter of the **contract**, not
the vendor: two customers of the same provider can have different list access.

---

## Configuration reference

### Provider

| Variable | Default | Meaning |
|---|---|---|
| `SCREENING_PROVIDER` | `built_in` | `built_in` \| `on_premise` \| `commercial` |
| `SCREENING_BASE_URL` | — | Required for `on_premise` and `commercial` |
| `SCREENING_API_KEY` | — | Required for `commercial` |
| `SCREENING_DATASET` | — | Which dataset/index to query |
| `SCREENING_TIMEOUT_MS` | `10000` | Per-attempt timeout |
| `SCREENING_MAX_RETRIES` | `2` | **`0` means one attempt.** Retries only 5xx/429/timeout — never a 4xx, which will fail identically every time |
| `SCREENING_SEND_IDENTIFIERS` | `false` | Whether national ID / passport number leave this system |
| `SCREENING_TENANT_ID` | — | Vendor tenant, where the contract uses one |
| `SCREENING_DATASET_STALE_AFTER_HOURS` | `48` | Dataset age past which health reports DEGRADED |
| `SCREENING_IDEMPOTENCY_WINDOW_MINUTES` | `15` | How long an identical attempt counts as a REPEAT rather than a new screening |

`SCREENING_API_KEY` is read from the environment and **never** returned by any
endpoint, not even masked. `GET /screening/providers/config` reports
`apiKeyConfigured: true|false` and nothing more. There is deliberately no
endpoint that writes provider settings: a credential that can be written
through HTTP can be read back through HTTP, and every screen that edits a key
eventually grows a "show" button.

### The idempotency window — read this before changing it

An attempt for the same KYC file, the same people and the same provider inside
`SCREENING_IDEMPOTENCY_WINDOW_MINUTES` resumes the previous one instead of
calling the provider again. That is what stops a retry storm or a
double-submitted request from minting a second set of compliance cases.

**Do not raise it past the re-screening cadence.** The first implementation had
no window at all, and the consequence was severe: the second time the 4-hourly
recurring batch reached a customer it resumed the original attempt and never
called the provider again. For `built_in` that was masked — the real list check
runs separately against the local cache — but for `on_premise` and
`commercial`, where the provider is the only source, **ongoing monitoring
stopped after each customer's first screening.**

A changed subject set produces a different key regardless of the window, so a
UBO added seconds after a screening is screened immediately.

### Match thresholds

| Variable | Default | Meaning |
|---|---|---|
| `SCREENING_MATCH_THRESHOLD_HIGH` | `0.9` | Treated as a strong match |
| `SCREENING_MATCH_THRESHOLD_REVIEW` | `0.7` | Queued for human review |
| `SCREENING_MATCH_THRESHOLD_LOW` | `0.5` | Below this, discarded as noise |

Mis-ordered bands fall back to the defaults **and are reported** in
`thresholdProblems` — a silently-ignored threshold is how a deployment believes
it tightened something it did not.

### Workflow holds (Part B §17)

Each condition maps to `NO_HOLD`, `REVIEW_REQUIRED` or `BLOCKED`.

| Variable | Default | Condition |
|---|---|---|
| `SCREENING_HOLD_NEVER_SCREENED` | `BLOCKED` | No screening was ever performed |
| `SCREENING_HOLD_CONFIRMED_SANCTIONS` | `BLOCKED` | A reviewer confirmed a sanctions match |
| `SCREENING_HOLD_CONFIRMED_PEP` | `REVIEW_REQUIRED` | A reviewer confirmed a PEP match |
| `SCREENING_HOLD_CONFIRMED_WATCHLIST` | `REVIEW_REQUIRED` | A reviewer confirmed a watchlist match |
| `SCREENING_HOLD_PENDING_REVIEW` | `REVIEW_REQUIRED` | Matches still awaiting review |
| `SCREENING_HOLD_UNRESOLVED` | `REVIEW_REQUIRED` | The attempt produced no usable answer |
| `SCREENING_HOLD_POTENTIAL_MATCH` | `REVIEW_REQUIRED` | A candidate above the review threshold |
| `SCREENING_HOLD_IDENTITY_CHANGED` | `REVIEW_REQUIRED` | The subjects changed after screening |
| `SCREENING_HOLD_LIST_UPDATED` | `REVIEW_REQUIRED` | Entries were added to a list after screening |
| `SCREENING_HOLD_STALE` | `REVIEW_REQUIRED` | The screening is older than the limit below |
| `SCREENING_STALE_AFTER_DAYS` | `0` (off) | Days before a screening stops counting as current |

**Two of these cannot be relaxed.** `SCREENING_HOLD_NEVER_SCREENED` and
`SCREENING_HOLD_CONFIRMED_SANCTIONS` may be raised but never lowered; a
configuration that tries is ignored **and reported**. Approving a customer
nobody screened is not a judgement a written reason can carry, and letting a
second person wave through a match a reviewer already confirmed in writing
would make the review queue decorative.

`SCREENING_STALE_AFTER_DAYS` defaults to **off**. No sourced re-screening
cadence exists in this repository, and inventing one would present an
unsourced figure as policy. Set it to whatever the deployment's own
documented cadence is.

None of these levels is a regulatory requirement, and none carries a citation,
because none was supplied to this repository. They are the deployment's own
control settings; the defaults fail toward review rather than toward silent
approval.

---

## What a hold means in practice

* **`NO_HOLD`** — approval proceeds. Nothing recorded; there is nothing to
  accept.
* **`REVIEW_REQUIRED`** — approval is refused (`400`) unless the request
  carries `screeningHoldReason`. That text is stored as a
  `ScreeningHoldRelease` row, attributed and timestamped, **before** the
  workflow proceeds.
* **`BLOCKED`** — approval is refused (`422`). No reason text releases it. The
  database refuses to record a `BLOCKED` release at all.

Rejecting a customer is never gated. Refusing a customer does not need a
screening finding waived, and demanding one would be a reason not to refuse.

---

## Operating it

| Endpoint | Permission | Shows |
|---|---|---|
| `GET /screening/providers/config` | `sanctions-pep.screen` | Configuration in force, redacted |
| `GET /screening/providers/health` | `sanctions-pep.screen` | Reachability, state, capabilities |
| `GET /screening/overview` | `sanctions-pep.screen` | What actually happened — attempt counts by outcome, unresolved rate, recent failures, hold policy, sync history |
| `GET /screening/matches` | `sanctions-pep.screen` | The review queue |
| `GET /kyc-records/:id/screening-hold` | `kyc.capture` \| `kyc.approve` | What is holding one file |

**Watch the unresolved rate.** A health check answers "can I reach it right
now?"; it cannot answer "how many of our customers were actually screened?" A
deployment can pass every health check while a third of its attempts come back
`SCREENING_FAILED` — each one correctly refusing to say `NO_MATCH`, each one
silently held, and nobody looking at the total. `GET /screening/overview`
states that number rather than leaving it to be computed.

None of these views carries subject PII — counts, outcomes, versions and
timestamps only — so none requires an `isSensitiveDataAccess` read.

---

## What is still missing, and cannot be configured away

### There is no PEP data

OFAC and UN are **sanctions** lists. The backlog asks for "sanctions/PEP/AML"
and no free PEP source exists. Real PEP screening needs a commercial provider
(Dow Jones, Refinitiv, ComplyAdvantage or similar) with a contract and an API
key.

The `commercial` adapter is the seam that connects one. It is deliberately not
"finished": its request/response mapping is documented from vendor
documentation and **has never run against a live service**, because there were
no credentials to run it against. Verifying it is the first task of whoever
brings a contract.

Until then, `GET /screening/providers/health` reports `pepOperational: false`,
and the screening health screen states plainly that **no customer may be
described as clear of PEP status**.

### The transliteration table covers given names only

Roughly 50 common Arab **given** names collapse across romanisations and
scripts (`Mohammed` / `Muhammad` / `محمد` are one key). **Family names across
scripts still will not match.**

### The commercial adapter is unverified

Stated again because it is the single most important caveat in this document.

---

## When the matcher changes

`MATCHING_ALGORITHM_VERSION` is stamped onto every attempt and every match it
raises, alongside the review threshold that judged it. Bump it whenever a
change could make the same subject and the same list entry produce a different
answer — the transliteration table, the canonicalisation, the fuzzy floor, the
containment rule. Not for a comment or a refactor.

Without it, lowering a review threshold silently rewrites the meaning of every
match already in the queue: the score is stored, but the line it crossed is
not. `GET /screening/overview` reports which matcher versions the **open**
queue holds — more than one means two items with the same score were judged by
different rules.

---

## Related

* `ibms-brain/meta/context/sanctions-pep-screening.md` — Process 49 domain
  context, the matching rules, and the review queue's own design decisions.
* `ibms-brain/meta/lex/race-safe-invariants.md` — why the idempotency key is a
  UNIQUE constraint rather than a preceding read.
* `ibms-brain/meta/lex/sensitive-data-handling.md` — why these views carry
  identifiers rather than names.
