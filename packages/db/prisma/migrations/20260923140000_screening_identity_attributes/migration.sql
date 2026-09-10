-- Part B §11/§12: identity attributes for screening, and a fingerprint of what
-- was actually screened.
--
-- `ScreeningSubject` has declared `dateOfBirth` and `nationality` since the
-- provider contract was written, and `ScreeningMatch.matchedAttributes` names
-- them as things a reviewer weighs. Neither had a producer: no table carried
-- the data, so every match this system has ever raised agreed on NAME ALONE.
-- Against ~19,000 sanctions entries that is the single largest source of false
-- positives, and a false positive that a reviewer clears is a control losing
-- credibility one queue item at a time.
--
-- Stored in the clear rather than encrypted like `nationalIdEnc`: the entire
-- purpose of these two columns is to be compared against a list entry. See the
-- schema comment on `Customer.dateOfBirth`.

ALTER TABLE "Customer" ADD COLUMN "dateOfBirth" DATE;
ALTER TABLE "Customer" ADD COLUMN "nationality" TEXT;

ALTER TABLE "UltimateBeneficialOwner" ADD COLUMN "dateOfBirth" DATE;
ALTER TABLE "UltimateBeneficialOwner" ADD COLUMN "nationality" TEXT;

-- ISO 3166-1 alpha-2, upper case. A free-text nationality column collects
-- "Jordan", "JORDAN", "Jordanian", "JO" and "962" within a month, and a
-- comparison across those is a comparison that silently never matches — which
-- on a screening discriminator means quietly falling back to name-only.
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_nationality_iso3166"
    CHECK ("nationality" IS NULL OR "nationality" ~ '^[A-Z]{2}$');
ALTER TABLE "UltimateBeneficialOwner" ADD CONSTRAINT "UltimateBeneficialOwner_nationality_iso3166"
    CHECK ("nationality" IS NULL OR "nationality" ~ '^[A-Z]{2}$');

-- A date of birth in the future is a typo, and a typo in a screening
-- discriminator is worse than a null: it makes a match look actively
-- contradicted rather than merely unknown.
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_dateOfBirth_not_future"
    CHECK ("dateOfBirth" IS NULL OR "dateOfBirth" <= CURRENT_DATE);
ALTER TABLE "UltimateBeneficialOwner" ADD CONSTRAINT "UltimateBeneficialOwner_dateOfBirth_not_future"
    CHECK ("dateOfBirth" IS NULL OR "dateOfBirth" <= CURRENT_DATE);

-- What was actually screened, independent of provider and dataset. Nullable:
-- every request written before this column existed screened a subject set
-- nobody recorded, and inventing a fingerprint for those rows would assert an
-- identity match that was never checked. A NULL is read as "unknown", which
-- the hold treats as a change.
ALTER TABLE "ScreeningRequest" ADD COLUMN "subjectFingerprint" TEXT;
CREATE INDEX "ScreeningRequest_subjectFingerprint_idx"
    ON "ScreeningRequest"("subjectFingerprint");
