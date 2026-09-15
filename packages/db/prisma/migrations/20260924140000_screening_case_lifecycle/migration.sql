-- Part B §16: the screening case workflow.
--
-- `ScreeningMatch.status` already carried the DECISION (pending / cleared /
-- confirmed). It could not express the workflow around that decision — who owns
-- the case, whether anybody has started, whether it was escalated — so a case
-- sitting untouched for a week and one a reviewer was actively working looked
-- identical in the queue.
--
-- `caseStatus` is that workflow, kept separate from the decision on purpose:
-- "has anyone looked at this yet?" and "was it a real match?" are different
-- questions, and collapsing them makes "assigned but not yet decided"
-- unrepresentable.

CREATE TYPE "ScreeningCaseStatus" AS ENUM (
    'OPEN', 'ASSIGNED', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED'
);

ALTER TABLE "ScreeningMatch" ADD COLUMN "caseStatus" "ScreeningCaseStatus" NOT NULL DEFAULT 'OPEN';
ALTER TABLE "ScreeningMatch" ADD COLUMN "assignedToUserId" TEXT;
ALTER TABLE "ScreeningMatch" ADD COLUMN "assignedByUserId" TEXT;
ALTER TABLE "ScreeningMatch" ADD COLUMN "assignedAt" TIMESTAMP(3);
ALTER TABLE "ScreeningMatch" ADD COLUMN "reviewStartedAt" TIMESTAMP(3);
ALTER TABLE "ScreeningMatch" ADD COLUMN "escalatedToUserId" TEXT;
ALTER TABLE "ScreeningMatch" ADD COLUMN "escalatedAt" TIMESTAMP(3);
ALTER TABLE "ScreeningMatch" ADD COLUMN "escalationReason" TEXT;
ALTER TABLE "ScreeningMatch" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "ScreeningMatch" ADD COLUMN "closedByUserId" TEXT;

CREATE INDEX "ScreeningMatch_assignedToUserId_caseStatus_idx"
    ON "ScreeningMatch"("assignedToUserId", "caseStatus");
CREATE INDEX "ScreeningMatch_caseStatus_idx" ON "ScreeningMatch"("caseStatus");

-- Every match that already carries a decision is a CLOSED case; everything else
-- is OPEN. Without this, a queue full of historical decided matches would come
-- back as unowned work on the day this ships.
UPDATE "ScreeningMatch"
SET "caseStatus" = 'CLOSED',
    "closedAt" = COALESCE("reviewedAt", "detectedAt"),
    "closedByUserId" = "reviewedByUserId"
WHERE "status" IN ('cleared', 'confirmed');

-- An assigned case names its assignee. "ASSIGNED to nobody" is a state that
-- reads as owned work and is not.
ALTER TABLE "ScreeningMatch" ADD CONSTRAINT "ScreeningMatch_assigned_has_assignee"
    CHECK (
        "caseStatus" NOT IN ('ASSIGNED', 'UNDER_REVIEW')
        OR "assignedToUserId" IS NOT NULL
    );

-- Escalation carries a written reason and a timestamp. An escalation with no
-- stated basis tells the person receiving it nothing about why it arrived.
ALTER TABLE "ScreeningMatch" ADD CONSTRAINT "ScreeningMatch_escalated_has_reason"
    CHECK (
        "caseStatus" <> 'ESCALATED'
        OR ("escalatedAt" IS NOT NULL
            AND length(btrim(COALESCE("escalationReason", ''))) > 0)
    );

-- A CLOSED case has a decision and a decision has a written reason. This is the
-- substance of the control: it is what a regulator asks to see when questioning
-- why a name that matched a sanctions list was let through.
ALTER TABLE "ScreeningMatch" ADD CONSTRAINT "ScreeningMatch_closed_is_decided"
    CHECK (
        "caseStatus" <> 'CLOSED'
        OR ("status" IN ('cleared', 'confirmed')
            AND "closedAt" IS NOT NULL
            AND length(btrim(COALESCE("reviewReason", ''))) > 0)
    );

-- And the converse: a decision means the case is closed. Without this a match
-- could carry `status = 'confirmed'` while still showing as OPEN work, so the
-- screening hold would see a confirmed sanctions match that the queue still
-- presented as untouched.
ALTER TABLE "ScreeningMatch" ADD CONSTRAINT "ScreeningMatch_decided_is_closed"
    CHECK ("status" = 'pending' OR "caseStatus" = 'CLOSED');

-- ---------------------------------------------------------------------------

CREATE TABLE "ScreeningCaseNote" (
    "id" TEXT NOT NULL,
    "screeningMatchId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreeningCaseNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScreeningCaseNote_screeningMatchId_createdAt_idx"
    ON "ScreeningCaseNote"("screeningMatchId", "createdAt");

ALTER TABLE "ScreeningCaseNote" ADD CONSTRAINT "ScreeningCaseNote_screeningMatchId_fkey"
    FOREIGN KEY ("screeningMatchId") REFERENCES "ScreeningMatch"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- An empty note is not a note.
ALTER TABLE "ScreeningCaseNote" ADD CONSTRAINT "ScreeningCaseNote_note_not_blank"
    CHECK (length(btrim("note")) > 0);
