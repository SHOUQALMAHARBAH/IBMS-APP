-- Part B — record what a screening ATTEMPT actually did, not just what it
-- concluded.
--
-- `ScreeningResult` carries a three-value outcome (CLEAR / HIT /
-- PENDING_INVESTIGATION) and nothing about HOW the answer was reached. That is
-- enough to say "this customer is clear" and not enough to say whether a
-- provider was even reachable — so "we checked 19,000 records and found
-- nothing" and "the provider timed out" were indistinguishable once stored.
--
-- `ScreeningRequest` is the attempt record: which provider answered, against
-- which dataset, what it concluded, why it failed if it did, and the
-- correlation id that ties it to the provider's own logs. It also carries the
-- idempotency key, so a retried job cannot mint a second case for the same
-- screening.

CREATE TYPE "ScreeningAttemptOutcome" AS ENUM (
  'NO_MATCH',
  'POTENTIAL_MATCH',
  'NOT_CONFIGURED',
  'SCREENING_FAILED',
  'UNABLE_TO_SCREEN'
);

CREATE TYPE "ScreeningProviderKind" AS ENUM (
  'built_in',
  'on_premise',
  'commercial'
);

CREATE TYPE "ScreeningListType" AS ENUM ('SANCTIONS', 'PEP', 'WATCHLIST');

CREATE TABLE "ScreeningRequest" (
  "id"              TEXT NOT NULL,
  "kycRecordId"     TEXT NOT NULL,
  -- Ties this attempt to the provider's own logs and to every audit row and
  -- case it produced.
  "correlationId"   TEXT NOT NULL,
  -- Idempotency key. Derived from (kycRecord, subject set, provider, dataset)
  -- by the caller, so a retried scheduler tick recognises work it already did
  -- instead of screening again and opening duplicate cases.
  "idempotencyKey"  TEXT NOT NULL,

  "provider"        "ScreeningProviderKind" NOT NULL,
  "providerName"    TEXT NOT NULL,
  -- What the provider's answer was computed against. A decision is only
  -- reproducible if you know which data produced it.
  "datasetVersion"  TEXT,

  "outcome"         "ScreeningAttemptOutcome" NOT NULL,
  -- Populated for NOT_CONFIGURED / SCREENING_FAILED / UNABLE_TO_SCREEN.
  -- Never contains credentials or subject PII — adapters pass an error
  -- message, never a request body or a header.
  "failureReason"   TEXT,
  "candidateCount"  INTEGER NOT NULL DEFAULT 0,
  -- How many candidates cleared the review threshold and became cases.
  "casesOpened"     INTEGER NOT NULL DEFAULT 0,

  "startedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"     TIMESTAMP(3),
  "durationMs"      INTEGER,
  "requestedByUserId" TEXT,

  CONSTRAINT "ScreeningRequest_pkey" PRIMARY KEY ("id")
);

-- IDEMPOTENCY, as a constraint rather than a check-then-act.
--
-- The 4-hourly re-screening batch and the retry path both re-enter with the
-- same key; without this a transient failure followed by a retry would open a
-- second set of cases for one screening (race-safe-invariants.md).
CREATE UNIQUE INDEX "ScreeningRequest_idempotencyKey_key"
  ON "ScreeningRequest" ("idempotencyKey");

CREATE INDEX "ScreeningRequest_kycRecordId_startedAt_idx"
  ON "ScreeningRequest" ("kycRecordId", "startedAt" DESC);
CREATE INDEX "ScreeningRequest_outcome_idx" ON "ScreeningRequest" ("outcome");
CREATE INDEX "ScreeningRequest_correlationId_idx"
  ON "ScreeningRequest" ("correlationId");

-- RESTRICT: the attempt record is the evidence that a screening happened (or
-- could not). Deleting a KYC file must not erase it.
ALTER TABLE "ScreeningRequest"
  ADD CONSTRAINT "ScreeningRequest_kycRecordId_fkey"
  FOREIGN KEY ("kycRecordId") REFERENCES "KYCRecord"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScreeningRequest" ADD CONSTRAINT "ScreeningRequest_counts_non_negative"
  CHECK ("candidateCount" >= 0 AND "casesOpened" >= 0);

-- ---------------------------------------------------------------------------
-- ScreeningResult gains the provenance of the answer.
-- ---------------------------------------------------------------------------

ALTER TABLE "ScreeningResult"
  ADD COLUMN IF NOT EXISTS "screeningRequestId" TEXT,
  ADD COLUMN IF NOT EXISTS "provider"           "ScreeningProviderKind",
  -- The FIVE-value attempt outcome behind the three-value ScreeningOutcome.
  -- CLEAR maps only from NO_MATCH; every unresolved outcome maps to
  -- PENDING_INVESTIGATION, and this column is what keeps them distinguishable
  -- once stored.
  ADD COLUMN IF NOT EXISTS "attemptOutcome"     "ScreeningAttemptOutcome",
  ADD COLUMN IF NOT EXISTS "datasetVersion"     TEXT;

ALTER TABLE "ScreeningResult"
  ADD CONSTRAINT "ScreeningResult_screeningRequestId_fkey"
  FOREIGN KEY ("screeningRequestId") REFERENCES "ScreeningRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ScreeningResult_screeningRequestId_idx"
  ON "ScreeningResult" ("screeningRequestId");

-- A CLEAR result may only come from an attempt that actually found nothing.
-- The application enforces this too; the constraint is what makes it
-- impossible to write a clear screening from any other path.
ALTER TABLE "ScreeningResult" ADD CONSTRAINT "ScreeningResult_clear_requires_no_match"
  CHECK (
    "attemptOutcome" IS NULL
    OR "result" <> 'CLEAR'
    OR "attemptOutcome" = 'NO_MATCH'
  );

-- ---------------------------------------------------------------------------
-- ScreeningMatch becomes provider-neutral and carries the evidence a reviewer
-- needs to decide.
-- ---------------------------------------------------------------------------

ALTER TABLE "ScreeningMatch"
  ADD COLUMN IF NOT EXISTS "screeningRequestId" TEXT,
  ADD COLUMN IF NOT EXISTS "provider"           "ScreeningProviderKind",
  -- PEP is FIRST-CLASS, not a flavour of sanctions: the obligations attached
  -- to each are different, and a queue that cannot tell them apart cannot be
  -- worked correctly.
  ADD COLUMN IF NOT EXISTS "listType"           "ScreeningListType" NOT NULL DEFAULT 'SANCTIONS',
  -- The provider's own id for the entity, so a reviewer can look it up in the
  -- provider's console and a re-screen can recognise the same candidate.
  ADD COLUMN IF NOT EXISTS "providerEntityId"   TEXT,
  -- 0..1. Nullable because the built-in matcher is deterministic set logic
  -- rather than a similarity engine — a fabricated fraction would be false
  -- precision.
  ADD COLUMN IF NOT EXISTS "matchScore"         DOUBLE PRECISION,
  -- WHAT agreed. A name-only agreement and a name+DOB+nationality agreement
  -- are very different evidence, and the reviewer needs to see which they have.
  ADD COLUMN IF NOT EXISTS "matchedAttributes"  TEXT[] NOT NULL DEFAULT '{}',
  -- For a PEP candidate: the position that makes them politically exposed.
  ADD COLUMN IF NOT EXISTS "pepPosition"        TEXT;

ALTER TABLE "ScreeningMatch"
  ADD CONSTRAINT "ScreeningMatch_screeningRequestId_fkey"
  FOREIGN KEY ("screeningRequestId") REFERENCES "ScreeningRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ScreeningMatch" ADD CONSTRAINT "ScreeningMatch_score_is_a_fraction"
  CHECK ("matchScore" IS NULL OR ("matchScore" >= 0 AND "matchScore" <= 1));

CREATE INDEX "ScreeningMatch_listType_status_idx"
  ON "ScreeningMatch" ("listType", "status");
CREATE INDEX "ScreeningMatch_screeningRequestId_idx"
  ON "ScreeningMatch" ("screeningRequestId");
