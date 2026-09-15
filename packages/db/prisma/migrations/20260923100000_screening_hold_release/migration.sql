-- Part B §17: workflow holds.
--
-- A REVIEW_REQUIRED screening hold may be released, but only by naming in
-- writing what is being accepted. That acceptance is a ROW — attributable,
-- queryable, and outliving any log rotation. A BLOCKED hold has no release
-- path and never produces one of these.

CREATE TYPE "ScreeningHoldLevel" AS ENUM ('NO_HOLD', 'REVIEW_REQUIRED', 'BLOCKED');

CREATE TABLE "ScreeningHoldRelease" (
    "id" TEXT NOT NULL,
    "kycRecordId" TEXT NOT NULL,
    "level" "ScreeningHoldLevel" NOT NULL,
    "conditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "detail" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "releasedByUserId" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workflow" TEXT NOT NULL DEFAULT 'kyc_decision',

    CONSTRAINT "ScreeningHoldRelease_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScreeningHoldRelease_kycRecordId_releasedAt_idx"
    ON "ScreeningHoldRelease"("kycRecordId", "releasedAt" DESC);
CREATE INDEX "ScreeningHoldRelease_releasedByUserId_idx"
    ON "ScreeningHoldRelease"("releasedByUserId");

ALTER TABLE "ScreeningHoldRelease" ADD CONSTRAINT "ScreeningHoldRelease_kycRecordId_fkey"
    FOREIGN KEY ("kycRecordId") REFERENCES "KYCRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A release with no stated reason is not a release. Enforced in the database
-- rather than only in the DTO: this row is the entire evidence that a human
-- accepted an unresolved screening, and an empty one is worse than none
-- because it looks like a decision.
ALTER TABLE "ScreeningHoldRelease" ADD CONSTRAINT "ScreeningHoldRelease_reason_not_blank"
    CHECK (length(btrim("reason")) > 0);

-- BLOCKED is not releasable by construction. If a future change ever tries to
-- write one, the database refuses rather than silently recording that somebody
-- waved through a confirmed sanctions match.
ALTER TABLE "ScreeningHoldRelease" ADD CONSTRAINT "ScreeningHoldRelease_only_review_required"
    CHECK ("level" = 'REVIEW_REQUIRED');
