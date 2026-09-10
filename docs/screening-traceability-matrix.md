# Part B — requirement traceability matrix

Requirement → implementation → automated test → evidence.

**On the scenario list:** the original brief named "23 E2E scenarios" without
reproducing them here, so the 23 rows below are a reconstruction from the
requirements actually stated across the brief and the closure audit. Where a
row's phrasing differs from the original wording, the *requirement* it stands
for is the one being traced. This is stated plainly rather than presented as a
one-to-one restoration of a list this document's author could not see.

Every row's test is automated and currently passing. A row with no test is not
listed as satisfied.

---

## Core guarantee

| # | Requirement | Implementation | Test | Evidence |
|---|---|---|---|---|
| 1 | A failed screening is never reported as clear | `isClear()`, `ScreeningService` mapping, DB CHECK `ScreeningResult_clear_requires_no_match` | `screening.service.spec.ts`, `provider-reliability.spec.ts` | api unit; CHECK proven by rejected INSERT |
| 2 | Five distinct attempt outcomes | `screening-provider.types.ts` | `provider-reliability.spec.ts` | api unit |
| 3 | A provider failure is `SCREENING_FAILED`, never `NO_MATCH` | `base-screening-provider.ts` | `provider-reliability.spec.ts` | 4 transport/timeout/5xx/429 cases |
| 4 | Retry only what is retryable; `MAX_RETRIES=0` means one attempt | `base-screening-provider.ts`, `envInt` | `provider-reliability.spec.ts` | 7 cases counting actual fetch calls |

## Provider seam

| # | Requirement | Implementation | Test | Evidence |
|---|---|---|---|---|
| 5 | Three adapters behind one contract, plus a null object | `built-in-watchlist`/`on-premise`/`commercial`/`not-configured.provider.ts` | `screening-provider.registry.spec.ts` | api unit |
| 6 | A misconfigured external provider does NOT fall back to built-in | `screening-provider.registry.ts` | `screening-provider.registry.spec.ts` | api unit |
| 7 | Capabilities distinguish supported / configured / operational | `capabilities()` on all four providers | `screening-provider.registry.spec.ts`, `screening-health.spec.ts` | api unit + Playwright |
| 8 | The built-in provider reports NO PEP coverage | `built-in-watchlist.provider.ts` | `screening-health.spec.ts` | Playwright: 2 tests |
| 9 | List classification is explicit, never substring | `list-classification.config.ts` | `list-classification.config.spec.ts` | 23 regression tests |

## Dataset lifecycle (§6/§7)

| # | Requirement | Implementation | Test | Evidence |
|---|---|---|---|---|
| 10 | `DOWNLOADED → VALIDATED → PUBLISHED → SUPERSEDED` | `watchlist-dataset.config.ts`, `WatchlistDatasetVersion` | `watchlist-dataset-lifecycle.e2e-spec.ts` | e2e 12/12 |
| 11 | **A reader never sees an intermediate state** | Version-scoped reads + single-transaction publish | `watchlist-dataset-lifecycle.e2e-spec.ts` | Continuous reads during a live publish; every observation a complete generation |
| 12 | At most one published generation per source | Partial UNIQUE index | `watchlist-dataset-lifecycle.e2e-spec.ts` | Rejected UPDATE + concurrent-publish test |
| 13 | An invalid dataset cannot publish; last known good stays live | `validateDataset()`, `markRejected` | `watchlist-dataset-lifecycle.e2e-spec.ts`, `watchlist-sync.service.spec.ts` | e2e + unit floor tests |
| 14 | Rollback restores a previous version, with a written reason | `rollbackDataset()`, DB CHECK | `watchlist-dataset-lifecycle.e2e-spec.ts`, `screening-security.e2e-spec.ts` | e2e; reason enforced in DB and DTO |
| 15 | A historical screening stays tied to its dataset version | `ScreeningResult.datasetVersion` (label, not FK) | `watchlist-dataset-lifecycle.e2e-spec.ts` | Version survives deletion of the generation |

## Holds (§17)

| # | Requirement | Implementation | Test | Evidence |
|---|---|---|---|---|
| 16 | An unresolved screening holds the workflow | `screening-hold.config.ts`, `KycService.decide()` | `kyc-screening-hold.e2e-spec.ts` | e2e 11/11 |
| 17 | `BLOCKED` is not releasable by any written reason | Hold engine + DB CHECK | `kyc-screening-hold.e2e-spec.ts` | 422 + rejected INSERT |
| 18 | A release is an attributed row with a mandatory reason | `ScreeningHoldRelease` | `kyc-screening-hold.e2e-spec.ts` | e2e; blank reason refused by DB |
| 19 | Identity change since screening is detected | `subjectFingerprint` | `kyc-screening-hold.e2e-spec.ts`, `screening-subjects.util.spec.ts` | Add-UBO → held → re-screen → lifted |
| 20 | List change since screening is detected | `WatchlistSyncRun.addedCount` | `screening-hold.config.spec.ts` | 6 unit cases |

## Case lifecycle (§16)

| # | Requirement | Implementation | Test | Evidence |
|---|---|---|---|---|
| 21 | `MATCH → ASSIGN → UNDER_REVIEW → FALSE_POSITIVE → CLOSED` | `screening-case.service.ts` | `screening-case-lifecycle.e2e-spec.ts` | Full path e2e |
| 22 | `MATCH → ASSIGN → UNDER_REVIEW → CONFIRMED → CLOSED` | same | `screening-case-lifecycle.e2e-spec.ts` | Full path e2e |
| 23 | Escalation, with a reason, decidable by the recipient | `escalate()` | `screening-case-lifecycle.e2e-spec.ts` | e2e incl. refusals |

---

## Supporting coverage (beyond the 23)

| Requirement | Test | Evidence |
|---|---|---|
| Invalid case transitions refused | `screening-case-lifecycle.e2e-spec.ts` | Decision from OPEN → 422; closed case terminal |
| Case notes append-only, blank refused | `screening-case-lifecycle.e2e-spec.ts` | 409 after closure; DB CHECK |
| Assignment to a deactivated user refused | `screening-case-lifecycle.e2e-spec.ts` | 422 |
| Idempotency window; recurring batch really re-screens | `provider-screening.service.spec.ts` | 4 regression tests counting provider calls |
| P2002 on concurrent attempt resumes the winner | `provider-screening.service.spec.ts` | 2 tests |
| Match provenance (matcher version + threshold) | DB range CHECKs | Rejected INSERTs against real Postgres |
| Operations view: 4 render states + permission denied | `screening-health.spec.ts` | Playwright 18/18 |
| Arabic RTL on the operations view | `screening-health.spec.ts` | `dir="rtl"` asserted |

## Security (§34)

All ten categories in `screening-security.e2e-spec.ts` — 12 tests, passing.

| # | Category | Evidence |
|---|---|---|
| 1 | Provider configuration authorization | 403 without `sanctions-pep.screen`, 200 with |
| 2 | Provider capability authorization | 403 on health and overview |
| 3 | Dataset publication authorization | 403 on sync run and dataset list |
| 4 | Dataset rollback authorization | 403 without permission; 400 without a reason |
| 5 | Case assignment authorization | 403 |
| 6 | Case decision authorization | 403, and the match stays `pending` |
| 7 | Hold release authorization | The capturing officer cannot waive their own file (403) |
| 8 | Cross-owner isolation | 404 (not 403) for another officer; 200 for owner and cross-owner role |
| 9 | Secret leakage | No key, no `sk-live`, no `apiKey` field across three endpoints |
| 10 | Sensitive-data leakage in audit | Subject name and review reason absent from audit rows; reason retained on its own row |

---

## What has NO test, and why

| Item | Status |
|---|---|
| Commercial provider against a live vendor | **External dependency** — no credentials exist to test against |
| Real PEP data | **External dependency** — no free PEP source; needs a contract |
| yente running live | **Environment-blocked** — compose profile validates; host disk is full |

These three are the only Part B items without automated coverage, and none of
them can be given one without something this repository does not have.
