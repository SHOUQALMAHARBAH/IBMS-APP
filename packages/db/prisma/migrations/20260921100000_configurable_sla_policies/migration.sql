-- Configurable SLA policies.
--
-- WHY: `SLA_REGISTRY` is a TypeScript const, so every SLA value in this system
-- is a compile-time constant. Changing "3 business days" to "5" required a
-- code change, a review, and a deploy — which is the wrong shape for a
-- business rule the compliance function owns rather than engineering.
--
-- Worse, the registry recorded an SLA's PROVENANCE only as free text inside a
-- `citation` string, mixing genuine PDPL rows with five whose own citation
-- read "DRAFT, UNSOURCED". Nothing downstream — no query, no API, no screen —
-- could tell a statutory deadline from a figure somebody drafted. This
-- migration makes that distinction structural and enforces it.

CREATE TYPE "SlaDurationUnit" AS ENUM ('MINUTES', 'HOURS', 'BUSINESS_DAYS', 'CALENDAR_DAYS', 'MONTHS');
CREATE TYPE "SlaCalendarType" AS ENUM ('JORDAN_STANDARD', 'CONTINUOUS_24_7', 'CUSTOM');
CREATE TYPE "SlaSourceType"   AS ENUM ('REGULATORY', 'INTERNAL_POLICY', 'CONTRACTUAL', 'OPERATIONAL', 'OTHER');
CREATE TYPE "SlaPolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

CREATE TABLE "SlaPolicy" (
  "id"                TEXT NOT NULL,
  "policyCode"        TEXT NOT NULL,
  "policyName"        TEXT NOT NULL,
  "processType"       TEXT NOT NULL,
  "workflowState"     TEXT,
  "description"       TEXT,

  "durationValue"     INTEGER NOT NULL,
  "durationUnit"      "SlaDurationUnit" NOT NULL,

  "calendarType"      "SlaCalendarType" NOT NULL DEFAULT 'JORDAN_STANDARD',
  "customWeekendDays" INTEGER[] NOT NULL DEFAULT '{}',
  "workingHoursStart" TEXT,
  "workingHoursEnd"   TEXT,
  "timezone"          TEXT NOT NULL DEFAULT 'Asia/Amman',

  "sourceType"        "SlaSourceType" NOT NULL,
  "sourceReference"   TEXT,
  "sourceDocument"    TEXT,
  "sourceSection"     TEXT,

  "effectiveFrom"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo"       TIMESTAMP(3),

  "escalationEnabled" BOOLEAN NOT NULL DEFAULT true,
  "warningThreshold"  DOUBLE PRECISION NOT NULL DEFAULT 0.8,

  "status"            "SlaPolicyStatus" NOT NULL DEFAULT 'DRAFT',

  "createdByUserId"   TEXT NOT NULL,
  "updatedByUserId"   TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

-- REGULATORY TRACEABILITY, enforced by the database rather than by hope.
--
-- Claiming an SLA is legally required without naming the instrument that
-- requires it is the specific failure this whole table exists to prevent. The
-- application layer checks it too and returns a readable 422; this constraint
-- is what makes the claim impossible to write by any other route (a seed, a
-- migration, a psql session, a future service that forgets).
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_regulatory_needs_citation"
  CHECK (
    "sourceType" <> 'REGULATORY'
    OR (
      "sourceReference" IS NOT NULL AND btrim("sourceReference") <> ''
      AND "sourceDocument"  IS NOT NULL AND btrim("sourceDocument")  <> ''
    )
  );

-- ZERO is a legitimate duration, not a mistake: `termination_access_revocation`
-- is 0 HOURS — "revoke the account's access immediately on termination", an
-- SLA whose deadline is the triggering event itself. A `> 0` check would
-- refuse to store one of the registry's own real values. Negative is still
-- refused: a deadline before its own start is meaningless.
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_duration_non_negative"
  CHECK ("durationValue" >= 0);

ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_warning_threshold_fraction"
  CHECK ("warningThreshold" > 0 AND "warningThreshold" <= 1);

ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_effective_window_ordered"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

CREATE UNIQUE INDEX "SlaPolicy_policyCode_key" ON "SlaPolicy" ("policyCode");
CREATE INDEX "SlaPolicy_processType_workflowState_status_idx"
  ON "SlaPolicy" ("processType", "workflowState", "status");
CREATE INDEX "SlaPolicy_status_effectiveFrom_idx"
  ON "SlaPolicy" ("status", "effectiveFrom");

-- AT MOST ONE ACTIVE POLICY per (process, state).
--
-- "Which SLA applies right now" must have exactly one answer. Resolving it by
-- ordering a findMany and taking the first would be a check-then-act with no
-- constraint behind it (race-safe-invariants.md); this makes two concurrent
-- activations impossible instead of merely unlikely.
--
-- TWO partial UNIQUEs, not one composite. Postgres treats NULLs as distinct,
-- so a single index on (processType, workflowState) would let several ACTIVE
-- whole-process policies coexist for the same processType. A COALESCE
-- expression would close that but is not IMMUTABLE once an enum cast is
-- involved, and Postgres refuses it in an index. Two indexes is the shape this
-- schema already uses for the same NULL-uniqueness problem elsewhere.
CREATE UNIQUE INDEX "SlaPolicy_one_active_per_process"
  ON "SlaPolicy" ("processType")
  WHERE "status" = 'ACTIVE' AND "workflowState" IS NULL;

CREATE UNIQUE INDEX "SlaPolicy_one_active_per_process_state"
  ON "SlaPolicy" ("processType", "workflowState")
  WHERE "status" = 'ACTIVE' AND "workflowState" IS NOT NULL;

CREATE TABLE "SlaPolicyEscalation" (
  "id"          TEXT NOT NULL,
  "slaPolicyId" TEXT NOT NULL,
  "stageOrder"  INTEGER NOT NULL,
  "offsetValue" INTEGER NOT NULL,
  "offsetUnit"  "SlaDurationUnit" NOT NULL,
  "escalateTo"  TEXT,
  CONSTRAINT "SlaPolicyEscalation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SlaPolicyEscalation_slaPolicyId_stageOrder_key"
  ON "SlaPolicyEscalation" ("slaPolicyId", "stageOrder");

ALTER TABLE "SlaPolicyEscalation"
  ADD CONSTRAINT "SlaPolicyEscalation_slaPolicyId_fkey"
  FOREIGN KEY ("slaPolicyId") REFERENCES "SlaPolicy"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The public-holiday calendar `business-days.util.ts` documented as missing.
CREATE TABLE "SlaHoliday" (
  "id"              TEXT NOT NULL,
  "observedOn"      DATE NOT NULL,
  "name"            TEXT NOT NULL,
  "calendarType"    "SlaCalendarType",
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SlaHoliday_pkey" PRIMARY KEY ("id")
);

-- Two partial UNIQUEs, same NULL-distinctness reason as above: without the
-- first, the same date could be added many times as an all-calendars holiday.
CREATE UNIQUE INDEX "SlaHoliday_one_per_date_all_calendars"
  ON "SlaHoliday" ("observedOn")
  WHERE "calendarType" IS NULL;

CREATE UNIQUE INDEX "SlaHoliday_one_per_date_per_calendar"
  ON "SlaHoliday" ("observedOn", "calendarType")
  WHERE "calendarType" IS NOT NULL;
CREATE INDEX "SlaHoliday_observedOn_idx" ON "SlaHoliday" ("observedOn");

-- ---------------------------------------------------------------------------
-- SlaTimer gains lifecycle state: which policy set the deadline, pause/resume,
-- and a recorded breach.
-- ---------------------------------------------------------------------------

ALTER TABLE "SlaTimer"
  ADD COLUMN IF NOT EXISTS "slaPolicyId"   TEXT,
  ADD COLUMN IF NOT EXISTS "pausedAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pausedTotalMs" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pauseReason"   TEXT,
  ADD COLUMN IF NOT EXISTS "breachedAt"    TIMESTAMP(3);

-- RESTRICT, not CASCADE: a timer is the evidence that a deadline existed and
-- what happened to it. Deleting a policy must not erase the history of every
-- deadline it ever set — the same reasoning migration 20260920140000 applied
-- to a reviewed ScreeningMatch.
ALTER TABLE "SlaTimer"
  ADD CONSTRAINT "SlaTimer_slaPolicyId_fkey"
  FOREIGN KEY ("slaPolicyId") REFERENCES "SlaPolicy"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SlaTimer" ADD CONSTRAINT "SlaTimer_paused_total_non_negative"
  CHECK ("pausedTotalMs" >= 0);

CREATE INDEX "SlaTimer_slaPolicyId_idx" ON "SlaTimer" ("slaPolicyId");
-- The breach sweep reads "open, not yet breached, past due".
CREATE INDEX "SlaTimer_open_breach_scan_idx"
  ON "SlaTimer" ("dueAt")
  WHERE "resolvedAt" IS NULL AND "breachedAt" IS NULL;
