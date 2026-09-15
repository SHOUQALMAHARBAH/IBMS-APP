-- ============================================================================
-- Multi-tenancy Phase 1, steps 5 and 6 — tenant-scoped unique constraints
--
-- STEP 6 fallout: merging feat/configurable-sla-engine brought three models
-- into this branch that Phase 1's organizationId pass never saw, because they
-- did not exist in this tree when it ran. SlaPolicy, SlaPolicyEscalation and
-- SlaHoliday are per-office data — an office's own SLA durations, working
-- hours, escalation targets and non-working-day calendar — so Phase 1 step 2
-- applies to them and is completed here.
--
-- STEP 5: a full pass over every unique constraint in the schema. The audit
-- enumerated all 81 non-primary-key UNIQUE indexes in the live database (not
-- just what schema.prisma declares — see the partial-index section below) and
-- classified each one. Ten convert; the rest stay global, deliberately:
--
--   * 59 are uniques whose leading column is a uuid foreign key to an
--     already-tenant-scoped row (CoverNote.policyId, Settlement.claimId,
--     ClaimStatusHistory(claimId,toStatus), ...). Two offices cannot generate
--     the same uuid, so there is no collision and nothing to leak — and adding
--     organizationId would WEAKEN them, permitting two children per parent as
--     long as they claimed different orgs.
--   * 3 are cryptographic secrets or globally-unique-by-design identifiers
--     (RefreshToken.tokenHash, PasswordResetToken.tokenHash,
--     MfaCredential.webauthnCredentialId). Scoping a bearer secret per-org
--     would make the same token valid in two organizations.
--   * 8 belong to models that stay GLOBAL under spec §3.1 (Role.name,
--     Permission.code, RolePermission, the watchlist cache), or are the tenant
--     key itself (Organization.subdomain), which must be globally unique.
--
-- Converted here (spec §3.2 — a bare @unique is both a functional bug and a
-- cross-tenant leak, since a uniqueness-violation error confirms a value
-- exists for someone without returning a row):
--
--   Policy.policyNumber                      -> (organizationId, policyNumber)
--   Claim.claimNumber                        -> (organizationId, claimNumber)
--   RetentionScheduleItem.recordCategory     -> (organizationId, recordCategory)
--   PrivacyNotice(touchpoint, versionNumber) -> + organizationId
--   ScreeningRequest.idempotencyKey          -> (organizationId, idempotencyKey)
--   SlaPolicy.policyCode                     -> (organizationId, policyCode)      [NEW]
--   SlaHoliday(observedOn, calendarType)     -> + organizationId                  [NEW]
--   SlaPolicy_one_active_per_process         -> + organizationId  (partial)       [NEW]
--   SlaPolicy_one_active_per_process_state   -> + organizationId  (partial)       [NEW]
--   SlaHoliday_one_per_date_all_calendars    -> + organizationId  (partial)       [NEW]
--   SlaHoliday_one_per_date_per_calendar     -> + organizationId  (partial)       [NEW]
--
-- (User.email was converted in Phase 1's own migration, 20260925100000.)
--
-- Also here: SlaTimer gains a DECLARED @@index([slaPolicyId]). Migration
-- 20260921100000 created that index in raw SQL without declaring it, so
-- `prisma migrate diff` proposed DROPPING a live index on a foreign-key
-- column. Declaring it is the fix; stripping the drop on every future diff
-- would leave the divergence in place forever.
--
-- Statements deliberately NOT included: the same 13 pre-existing-drift
-- statements Phase 1 documented (DROP INDEX on the searchVector/canonicalTokens
-- GIN indexes and four screening indexes, DROP DEFAULT on the three
-- searchVector GENERATED columns and on WatchlistEntry.canonicalTokens, and one
-- unrelated index rename). Unchanged by this migration, verified.
--
-- Still NOT enforced: no org-scoping interceptor, no RLS. Phase 2.
-- ============================================================================

-- DropForeignKey
ALTER TABLE "SlaTimer" DROP CONSTRAINT "SlaTimer_slaPolicyId_fkey";

-- ---------------------------------------------------------------------------
-- Drop the six old GLOBAL uniques, immune to which form Postgres holds them in.
--
-- `prisma migrate diff` emitted a bare `DROP INDEX` for all six. Two of them
-- are CONSTRAINTS, not bare indexes --- PrivacyNotice_touchpoint_versionNumber_key
-- and RetentionScheduleItem_recordCategory_key --- because the migrations that
-- created them used ALTER TABLE ... ADD CONSTRAINT rather than
-- CREATE UNIQUE INDEX. `DROP INDEX` on a constraint-backed index fails with
-- 2BP01, which is exactly how this migration failed on its first run.
--
-- This is the mirror image of a bug already in this repo's history: migration
-- 20260909160000 records that `ALTER TABLE ... DROP CONSTRAINT IF EXISTS`
-- SILENTLY NO-OPS against a Prisma `@unique`, which Postgres holds as an INDEX.
-- There the guess failed quietly and the constraint survived while
-- schema.prisma said it was gone --- and `db:migrate:status` called both states
-- "up to date", because it compares migration history, not schema. A silently
-- surviving global unique is precisely the cross-tenant collision this
-- migration exists to remove, so guessing the form is not acceptable here.
--
-- This block tries both forms and RAISES if neither existed, so the quiet
-- failure mode is unrepresentable.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  spec     TEXT;
  parts    TEXT[];
  tbl      TEXT;
  nm       TEXT;
  did_drop BOOLEAN;
  specs    TEXT[] := ARRAY[
    'Claim|Claim_claimNumber_key',
    'Policy|Policy_policyNumber_key',
    'PrivacyNotice|PrivacyNotice_touchpoint_versionNumber_key',
    'RetentionScheduleItem|RetentionScheduleItem_recordCategory_key',
    'ScreeningRequest|ScreeningRequest_idempotencyKey_key',
    'SlaPolicy|SlaPolicy_policyCode_key'
  ];
BEGIN
  FOREACH spec IN ARRAY specs LOOP
    parts := string_to_array(spec, '|');
    tbl := parts[1];
    nm  := parts[2];
    did_drop := FALSE;

    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = nm) THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', tbl, nm);
      did_drop := TRUE;
    ELSIF EXISTS (
      SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname = nm
         AND c.relkind = 'i'
         AND n.nspname = current_schema()
    ) THEN
      EXECUTE format('DROP INDEX %I', nm);
      did_drop := TRUE;
    END IF;

    IF NOT did_drop THEN
      RAISE EXCEPTION
        'Expected global unique % on table % to exist as a constraint or an index, found neither. Refusing to continue: the old global unique would survive alongside the new per-organization one, and this migration would report success while leaving a cross-tenant collision in place.',
        nm, tbl;
    END IF;
  END LOOP;
END $$;

-- AlterTable
ALTER TABLE "SlaHoliday" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "SlaPolicy" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "SlaPolicyEscalation" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- CreateIndex
CREATE UNIQUE INDEX "Claim_organizationId_claimNumber_key" ON "Claim"("organizationId", "claimNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_organizationId_policyNumber_key" ON "Policy"("organizationId", "policyNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyNotice_organizationId_touchpoint_versionNumber_key" ON "PrivacyNotice"("organizationId", "touchpoint", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionScheduleItem_organizationId_recordCategory_key" ON "RetentionScheduleItem"("organizationId", "recordCategory");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningRequest_organizationId_idempotencyKey_key" ON "ScreeningRequest"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "SlaHoliday_organizationId_idx" ON "SlaHoliday"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SlaHoliday_organizationId_observedOn_calendarType_key" ON "SlaHoliday"("organizationId", "observedOn", "calendarType");

-- CreateIndex
CREATE INDEX "SlaPolicy_organizationId_idx" ON "SlaPolicy"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SlaPolicy_organizationId_policyCode_key" ON "SlaPolicy"("organizationId", "policyCode");

-- CreateIndex
CREATE INDEX "SlaPolicyEscalation_organizationId_idx" ON "SlaPolicyEscalation"("organizationId");

-- AddForeignKey
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaPolicyEscalation" ADD CONSTRAINT "SlaPolicyEscalation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaHoliday" ADD CONSTRAINT "SlaHoliday_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaTimer" ADD CONSTRAINT "SlaTimer_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "SlaPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Step 5, the half Prisma cannot see: PARTIAL unique indexes.
--
-- migration 20260921100000 created these four in raw SQL. schema.prisma has no
-- syntax for a partial index, so `prisma migrate diff` does not know they
-- exist and proposed nothing for them — they would have stayed globally unique
-- while every neighbouring constraint became per-organization.
--
-- Each one is a hard blocker for a second office, not merely a leak:
--   * SlaPolicy_one_active_per_process(_state) — "which SLA applies right now
--     must have exactly one answer" is a per-OFFICE rule. Unscoped, the first
--     office to activate an SLA for a process locks every other office out of
--     activating its own.
--   * SlaHoliday_one_per_date_* — unscoped, the first office to record Eid on
--     a date prevents every other office from recording its own calendar.
--
-- The two-partial-indexes shape (rather than one composite) is preserved
-- exactly as migration 20260921100000 wrote it, including its reasoning:
-- Postgres treats NULLs as distinct, so a single composite index would let
-- several ACTIVE whole-process policies coexist for the same processType.
-- ---------------------------------------------------------------------------
DROP INDEX "SlaPolicy_one_active_per_process";
CREATE UNIQUE INDEX "SlaPolicy_one_active_per_process"
  ON "SlaPolicy" ("organizationId", "processType")
  WHERE "status" = 'ACTIVE' AND "workflowState" IS NULL;

DROP INDEX "SlaPolicy_one_active_per_process_state";
CREATE UNIQUE INDEX "SlaPolicy_one_active_per_process_state"
  ON "SlaPolicy" ("organizationId", "processType", "workflowState")
  WHERE "status" = 'ACTIVE' AND "workflowState" IS NOT NULL;

DROP INDEX "SlaHoliday_one_per_date_all_calendars";
CREATE UNIQUE INDEX "SlaHoliday_one_per_date_all_calendars"
  ON "SlaHoliday" ("organizationId", "observedOn")
  WHERE "calendarType" IS NULL;

DROP INDEX "SlaHoliday_one_per_date_per_calendar";
CREATE UNIQUE INDEX "SlaHoliday_one_per_date_per_calendar"
  ON "SlaHoliday" ("organizationId", "observedOn", "calendarType")
  WHERE "calendarType" IS NOT NULL;
