-- Part D §5.1 (M-series), Process #52 item #7 — Privacy Notices.
-- Closes a race where two concurrent publishes for the same touchpoint
-- could otherwise land on the same versionNumber.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PrivacyNotice_touchpoint_versionNumber_key'
  ) THEN
    ALTER TABLE "PrivacyNotice"
      ADD CONSTRAINT "PrivacyNotice_touchpoint_versionNumber_key" UNIQUE ("touchpoint", "versionNumber");
  END IF;
END $$;
