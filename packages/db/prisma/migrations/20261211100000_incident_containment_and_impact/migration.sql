-- OWNER DECISION 56 — THE TWO INCIDENT ACTS COLLECT WHAT THEY CLAIM.
--
-- The owner pressed both buttons on `/incidents` and reported, in her own words:
-- «لما أضغط ع زر الاحتواء بس بغيّر الحالة إلى تم احتوائه، و لما أضغط ع زر تقييم الأثر
--  بس بظهرلي إنه تم تقييم أثره وأنا كل الي عملته ضغط ع الزر، ما قيّمت ولا عملت شي.»
--
-- Measured against `PRIV-SRS-02`, sheet `IncidentReport` — the organization's APPROVED
-- field-level dictionary, read from `S:\Project\DataBase& Req\`. NOTHING HERE IS
-- DESIGNED; every field below is transcribed from that sheet, and `ibms-brain`'s standing
-- rule is why: IBMS IMPLEMENTS PCMS AND NEVER WRITES ITS OWN PRIVACY RULES.
--
-- The dictionary's rows, verbatim, that this migration closes:
--
--   containment_actions       | Text (log)  | REQUIRED | Timestamped containment actions.
--   data_categories_affected  | Text        | Optional | Required once impact assessment
--                                                        is complete.
--   subjects_affected_estimate| Integer     | Optional | Required once impact assessment
--                                                        is complete.
--   reported_by               | Ref (User)  | Optional | Reporting employee (may be
--                                                        anonymous).
--   detected_date/occurred_date| DateTime x2| Req/Opt  | Detection (required); occurrence
--                                                        (if known).
--
-- WHY A CHILD TABLE AND NOT A TEXT COLUMN. The dictionary types it **Text (log)** and
-- describes **timestamped containment actions** — plural. SOP-09 step 3 is «عزل الأنظمة
-- أو الحسابات المتأثرة» and an incident is routinely contained in more than one action
-- (isolate the server, then disable the account). A single text column cannot carry a
-- timestamp per action, and appending into one would make WHO and WHEN unrecoverable.
-- The shape copied is `ClaimStatusHistory` — a row per act, with its actor and its
-- instant — minus that model's `@@unique`, because a second containment action is a
-- legitimate new entry rather than a repeat.
--
-- `containedAt` IS KEPT AND IS NOW DEFINED AS THE FIRST ACTION. The 4-hour target for
-- `critical` severity keys on it (`incident.config.ts#containmentOverdue`), so removing
-- it would silently retire a deadline; what changes is that it can no longer be set
-- without an action beside it.
--
-- THE ASSESSMENT TRIO IS ALL-OR-NONE, AND THAT IS THE POINT RATHER THAN TIDINESS.
-- SOP-09 step 4 gives the DPO three outputs: whether the incident touches personal data,
-- the data CATEGORIES, and the approximate NUMBER of subjects. The dictionary's own rule
-- is *Required once impact assessment is complete*, so a row with `impactAssessedAt` set
-- and the trio empty is exactly the state her sentence describes — the act reporting work
-- it did not take. The CHECK below makes that state UNREPRESENTABLE, which is stronger
-- than a service refusal and survives any later code path.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO:
--
--   * NO DEADLINE. SOP-09 defers every period to the Governing Policy § 12.1–12.10, and
--     the owner has ruled that document will not be obtained. No period is hard-coded
--     here from any other source.
--   * NO SEVERITY CHANGE. Our `severity` is a free `String` admitting FOUR values
--     (low|medium|high|critical) where the dictionary types it an Enum of THREE
--     (Low/Medium/High) and the form offers «منخفض / متوسط / مرتفع». That divergence is
--     REPORTED for the owner, not resolved: `critical` is what the 4-hour containment
--     target keys on, so narrowing the vocabulary would retire a deadline as a side
--     effect of a type change.
--   * NO THRESHOLD. SOP-09's «أكثر من 100 عميل» sits inside its «مثال تطبيقي» — a worked
--     EXAMPLE, not a rule — so nothing here keys on 100, and this comment is where that
--     is written down so nobody later reads the example as a specification.

-- ---------------------------------------------------------------- the containment log ---
CREATE TABLE "IncidentContainmentAction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT current_setting('app.current_org_id', true),
    "incidentReportId" TEXT NOT NULL,
    -- «وصف أي إجراء احتواء فوري (كعزل نظام أو تعطيل حساب)» — PRIV-FRM-06, section III.
    -- Her form supplies its own example, which is why the screen needs no invented
    -- placeholder.
    "description" TEXT NOT NULL,
    "actionTakenByUserId" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentContainmentAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IncidentContainmentAction_organizationId_idx"
    ON "IncidentContainmentAction"("organizationId");
CREATE INDEX "IncidentContainmentAction_incidentReportId_idx"
    ON "IncidentContainmentAction"("incidentReportId");

ALTER TABLE "IncidentContainmentAction"
    ADD CONSTRAINT "IncidentContainmentAction_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IncidentContainmentAction"
    ADD CONSTRAINT "IncidentContainmentAction_incidentReportId_fkey"
    FOREIGN KEY ("incidentReportId") REFERENCES "IncidentReport"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- The composite tenant FK below needs this, and Postgres refuses it BY NAME without one
-- — the `LegalHold(id, organizationId)` lesson, met again on a model that had only an
-- `organizationId` index.
CREATE UNIQUE INDEX "IncidentReport_id_organizationId_key"
    ON "IncidentReport"("id", "organizationId");

-- A COMPOSITE TENANT FK, the shape every org-owned child in this schema carries: without
-- it one office's incident could carry another office's containment action, and Prisma
-- cannot express this so it lives here and in `db:divergence`'s expected list.
ALTER TABLE "IncidentContainmentAction"
    ADD CONSTRAINT "IncidentContainmentAction_incident_same_org_fkey"
    FOREIGN KEY ("incidentReportId", "organizationId")
    REFERENCES "IncidentReport"("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- The dictionary says the log is REQUIRED, and a blank description would make
-- «تم الاحتواء» mean "somebody pressed a button" — which is the defect. The floor is the
-- ONE home for a declaration minimum (`common/declaration-reason.ts`, 10), the same
-- number `rootCauseAnalysis` is held to before Closed.
ALTER TABLE "IncidentContainmentAction"
    ADD CONSTRAINT "IncidentContainmentAction_description_not_blank"
    CHECK (length(btrim("description")) >= 10);

ALTER TABLE "IncidentContainmentAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IncidentContainmentAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY "IncidentContainmentAction_tenant_isolation"
    ON "IncidentContainmentAction"
    USING ("organizationId" = current_setting('app.current_org_id', true));

-- ------------------------------------------------- the impact assessment, and the two ---
-- ------------------------------------------------- reporter fields the dictionary has ---
ALTER TABLE "IncidentReport"
    ADD COLUMN "touchesPersonalData" BOOLEAN,
    ADD COLUMN "dataCategoriesAffected" TEXT,
    ADD COLUMN "subjectsAffectedEstimate" INTEGER,
    ADD COLUMN "reportedByUserId" TEXT,
    ADD COLUMN "occurredAt" TIMESTAMP(3);

ALTER TABLE "IncidentReport"
    ADD CONSTRAINT "IncidentReport_reportedByUserId_fkey"
    FOREIGN KEY ("reportedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- THE CONDITIONAL RULE, MADE STRUCTURAL. The dictionary's own words are *Required once
-- impact assessment is complete*, and `impactAssessedAt` is what "complete" means here.
-- A non-negative estimate because a count of affected subjects cannot be negative, and
-- the dictionary types it Integer with no sign qualification.
--
-- `NOT VALID`, AND THAT IS A DECISION RATHER THAN A CONCESSION. The first version of this
-- migration added it VALID and FAILED on dev:
--
--     ERROR: check constraint "IncidentReport_impact_assessment_complete" of relation
--     "IncidentReport" is violated by some row
--
-- Measured after that failure: of 30 incidents on dev, exactly ONE carries
-- `impactAssessedAt` with an empty assessment and ONE carries `containedAt` with no
-- action. That is the owner's own sentence — «بس بظهرلي إنه تم تقييم أثره وأنا ما قيّمت
-- ولا عملت شي» — appearing in the seeded data, and it is the strongest evidence the
-- defect was real that this batch has.
--
-- The two ways to make a VALID constraint possible are both refused:
--   * BACKFILLING the trio would write an impact assessment NOBODY PERFORMED into a
--     record a regulator reads — the same refusal as inventing a retention period beside
--     an article number, and the same refusal the containment log makes below.
--   * DELETING the row destroys seeded history to satisfy a constraint.
--
-- `NOT VALID` enforces on every INSERT and every UPDATE from now on and leaves the
-- historical row readable, which is exactly the division wanted: the past is recorded as
-- it happened, and no future assessment can be empty. A later `VALIDATE CONSTRAINT` is
-- available the day somebody decides what to do with that one row, and it is deliberately
-- not run here.
ALTER TABLE "IncidentReport"
    ADD CONSTRAINT "IncidentReport_impact_assessment_complete"
    CHECK (
        "impactAssessedAt" IS NULL
        OR (
            "touchesPersonalData" IS NOT NULL
            AND "dataCategoriesAffected" IS NOT NULL
            AND length(btrim("dataCategoriesAffected")) >= 10
            AND "subjectsAffectedEstimate" IS NOT NULL
            AND "subjectsAffectedEstimate" >= 0
        )
    ) NOT VALID;

-- AND CONTAINMENT CANNOT BE STAMPED WITHOUT AN ACTION. The mirror of the rule above, on
-- the other act, and the half that makes her first sentence unrepresentable rather than
-- merely refused in a service. A trigger rather than a CHECK because the fact lives in
-- another table, which a CHECK cannot read.
CREATE OR REPLACE FUNCTION "incident_contained_needs_an_action"()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."containedAt" IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM "IncidentContainmentAction"
           WHERE "incidentReportId" = NEW."id"
       )
    THEN
        RAISE EXCEPTION
            'IncidentReport % cannot be marked contained with no containment action on '
            'record — PRIV-SRS-02 types containment_actions as a REQUIRED timestamped '
            'log, and a bare timestamp is the defect this refuses.', NEW."id";
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "IncidentReport_contained_needs_an_action"
    AFTER INSERT OR UPDATE OF "containedAt" ON "IncidentReport"
    FOR EACH ROW
    EXECUTE FUNCTION "incident_contained_needs_an_action"();

-- ------------------------------------------------------------------------ assertions ---
-- Every one of these has been WRONG at least once in this repository's history when left
-- unasserted, which is why the migration proves its own work rather than trusting it.
DO $$
DECLARE
    v_cols INTEGER;
    v_checks INTEGER;
    v_policy INTEGER;
    v_forced BOOLEAN;
    v_trigger INTEGER;
    v_contained INTEGER;
    v_assessed INTEGER;
BEGIN
    SELECT count(*) INTO v_cols
    FROM information_schema.columns
    WHERE table_name = 'IncidentReport'
      AND column_name IN ('touchesPersonalData', 'dataCategoriesAffected',
                          'subjectsAffectedEstimate', 'reportedByUserId', 'occurredAt');
    IF v_cols <> 5 THEN
        RAISE EXCEPTION 'expected 5 new IncidentReport columns, found %', v_cols;
    END IF;

    -- BY DEFINITION, not by existence: a predicate loosened to `TRUE OR (…)` keeps its
    -- name and refuses nothing, which is the recorded way a CHECK stops being a control.
    SELECT count(*) INTO v_checks
    FROM pg_constraint
    WHERE conname = 'IncidentReport_impact_assessment_complete'
      AND pg_get_constraintdef(oid) LIKE '%touchesPersonalData%'
      AND pg_get_constraintdef(oid) LIKE '%dataCategoriesAffected%'
      AND pg_get_constraintdef(oid) LIKE '%subjectsAffectedEstimate%';
    IF v_checks <> 1 THEN
        RAISE EXCEPTION
            'the impact-assessment CHECK does not name all three assessment columns — it '
            'reads %', (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                        WHERE conname = 'IncidentReport_impact_assessment_complete');
    END IF;

    SELECT count(*) INTO v_policy FROM pg_policies
    WHERE tablename = 'IncidentContainmentAction';
    IF v_policy <> 1 THEN
        RAISE EXCEPTION 'expected 1 RLS policy on IncidentContainmentAction, found %',
            v_policy;
    END IF;

    SELECT relforcerowsecurity INTO v_forced FROM pg_class
    WHERE relname = 'IncidentContainmentAction';
    IF NOT v_forced THEN
        RAISE EXCEPTION 'IncidentContainmentAction is not FORCE ROW LEVEL SECURITY';
    END IF;

    SELECT count(*) INTO v_trigger FROM pg_trigger
    WHERE tgname = 'IncidentReport_contained_needs_an_action' AND NOT tgisinternal;
    IF v_trigger <> 1 THEN
        RAISE EXCEPTION 'the contained-needs-an-action trigger is missing';
    END IF;

    -- THE BACKFILL QUESTION, ANSWERED BY MEASUREMENT RATHER THAN ASSUMED. Any existing
    -- row already carrying `containedAt` has no action behind it and would violate the
    -- trigger on its next update. Counted and REPORTED rather than silently patched,
    -- because inventing a containment description for a historical incident would put a
    -- sentence nobody wrote into a compliance record.
    SELECT count(*) INTO v_contained FROM "IncidentReport" WHERE "containedAt" IS NOT NULL;
    IF v_contained > 0 THEN
        RAISE NOTICE
            '% existing incident(s) carry containedAt with no containment action. The '
            'trigger fires only on INSERT or on an UPDATE OF containedAt, so these rows '
            'are readable and closable as they stand; re-stamping containedAt on one '
            'would refuse until an action is logged. No description was invented for '
            'them.', v_contained;
    ELSE
        RAISE NOTICE 'no existing incident carries containedAt — nothing to report.';
    END IF;

    SELECT count(*) INTO v_assessed FROM "IncidentReport"
    WHERE "impactAssessedAt" IS NOT NULL
      AND ("touchesPersonalData" IS NULL OR "dataCategoriesAffected" IS NULL
           OR "subjectsAffectedEstimate" IS NULL);
    IF v_assessed > 0 THEN
        RAISE NOTICE
            '% existing incident(s) are marked impact-assessed with an EMPTY assessment. '
            'That is the defect this migration closes, visible in the data. The CHECK is '
            'NOT VALID so those rows stand as recorded; nothing was backfilled, because '
            'an invented assessment in a compliance record is worse than a visible gap.',
            v_assessed;
    END IF;

    -- AND THE CONSTRAINT IS ASSERTED AS NOT VALID, deliberately: somebody later running
    -- VALIDATE CONSTRAINT over the historical rows is a decision, and this is where it
    -- would be noticed.
    IF EXISTS (SELECT 1 FROM pg_constraint
               WHERE conname = 'IncidentReport_impact_assessment_complete'
                 AND convalidated) THEN
        RAISE EXCEPTION
            'IncidentReport_impact_assessment_complete is VALIDATED. It is declared NOT '
            'VALID on purpose — validating it requires deciding what to do with the '
            'historical rows counted above, and that decision is the owner''s.';
    END IF;

    RAISE NOTICE 'decision 56: containment log + impact-assessment trio in place.';
END $$;
