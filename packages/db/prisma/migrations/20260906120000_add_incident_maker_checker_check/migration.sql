-- Process 55 — Incident Management (backlog Part C #55). `IncidentReport`
-- (Part 6.2/7.4 core schema) pre-existed with every field the state machine
-- and its Material-classification maker/checker needs, including BOTH
-- `classifiedByDpoUserId` and `seniorManagementCoSignUserId` columns — this
-- migration adds ONLY the missing DB-layer backstop: a CHECK constraint that
-- the two never match. `assertDifferentActors` is the application-layer
-- guard (packages/db/prisma/schema.prisma's own model comment: "Material
-- classification irreversible without this [co-sign]"); this is its
-- database-layer twin, the same pair every other maker/checker entity in
-- this codebase carries (`Complaint_closure_maker_checker_distinct`,
-- `DataSubjectRequest_closure_maker_checker_distinct`, etc.). Allows NULL on
-- either side ("not yet decided" is not a violation); rejects only an actual
-- match once both are set.

DO $$ BEGIN
  ALTER TABLE "IncidentReport"
    ADD CONSTRAINT "IncidentReport_classification_maker_checker_distinct" CHECK (
      "seniorManagementCoSignUserId" IS NULL OR "classifiedByDpoUserId" IS NULL
      OR "seniorManagementCoSignUserId" <> "classifiedByDpoUserId"
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
