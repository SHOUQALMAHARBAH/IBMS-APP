-- Backlog Part C #15 — Negotiation. Every negotiation round is recorded as a
-- new `Quotation` version (the #13 mechanism); an existing version is "never
-- deleted or replaced".

-- 1. The broker's documented rationale for a negotiation round (what was
--    asked for / conceded). NULL on a version-1 capture. Confidential — the
--    AuditLogEntry snapshot carries only a presence boolean, never this text.
ALTER TABLE "Quotation" ADD COLUMN "negotiationNotes" TEXT;

-- 2. DB-layer immutability backstop for "never deleted or replaced".
--
-- The application layer already has no path that would break this:
-- QuotationService only ever INSERTs a new version, and `reviseChain` is the
-- one place that UPDATEs a Quotation — a single `updateMany(... data: {
-- isCurrentVersion: false }) WHERE isCurrentVersion = true` that supersedes
-- the predecessor. This trigger is the Postgres-level guarantee that holds
-- regardless of caller (raw SQL, a future code path, a mistaken migration),
-- exactly like prevent_audit_log_entry_mutation (migration 20260826083942):
--   * any DELETE of any Quotation row is rejected;
--   * any UPDATE of an already-superseded version (isCurrentVersion = false)
--     is rejected — historical rounds are frozen verbatim;
--   * the only UPDATE a live version accepts is the supersede flip itself,
--     and ONLY the `isCurrentVersion` column may change in that statement
--     (true -> false) — an in-place edit of a live quote, or a flip that also
--     rewrites a term, is rejected (revise into a new version instead).
--
-- Known residual risk, identical to the AuditLogEntry trigger and documented
-- there: apps/api and Prisma Migrate share one Postgres role (`ibms`), so a
-- session as that role can still bypass a trigger via
-- `SET session_replication_role = replica`. A true fix needs a
-- least-privilege app role with `REVOKE UPDATE, DELETE` — a separate infra
-- change.
CREATE OR REPLACE FUNCTION prevent_quotation_version_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Quotation rows are never deleted (backlog Part C #15) — a negotiation round is a new version, not a replacement';
  END IF;
  IF OLD."isCurrentVersion" = false THEN
    RAISE EXCEPTION 'Quotation % is a superseded version and is immutable (backlog Part C #15) — revise the current version instead', OLD."id";
  END IF;
  IF NEW."isCurrentVersion" <> false THEN
    RAISE EXCEPTION 'A live Quotation version can only be superseded, not edited in place (backlog Part C #15) — POST /quotations/:id/revise';
  END IF;
  -- The supersede flip (isCurrentVersion true -> false) is the one permitted
  -- UPDATE. It must touch nothing else: every other column, compared as JSON,
  -- has to be identical between OLD and NEW.
  IF (to_jsonb(NEW) - 'isCurrentVersion') IS DISTINCT FROM (to_jsonb(OLD) - 'isCurrentVersion') THEN
    RAISE EXCEPTION 'Superseding a Quotation version may only change isCurrentVersion (backlog Part C #15) — no term may be rewritten as a version is frozen';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quotation_no_delete
  BEFORE DELETE ON "Quotation"
  FOR EACH ROW EXECUTE FUNCTION prevent_quotation_version_mutation();

CREATE TRIGGER quotation_freeze_superseded
  BEFORE UPDATE ON "Quotation"
  FOR EACH ROW EXECUTE FUNCTION prevent_quotation_version_mutation();
