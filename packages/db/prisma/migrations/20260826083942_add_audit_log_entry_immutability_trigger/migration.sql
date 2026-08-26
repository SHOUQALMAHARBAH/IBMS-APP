-- Part 10.3 — AuditLogEntry is immutable by design. The application layer
-- already has no update/delete path (AuditService only exposes `record()`),
-- but that alone only stops mistakes made through AuditService. This adds
-- the DB-layer backstop: any UPDATE or DELETE against this table, from any
-- caller using any Prisma model or raw SQL, is rejected by Postgres itself.
--
-- Known residual risk (documented, not fixed here): apps/api and Prisma
-- Migrate currently share a single Postgres role (`ibms` — see
-- docker-compose.yml / .env.example), so a session running as that role can
-- still bypass a trigger via `SET session_replication_role = replica`. A
-- true fix needs a dedicated least-privilege app role with
-- `REVOKE UPDATE, DELETE` — a separate infra change from today's schema.
CREATE OR REPLACE FUNCTION prevent_audit_log_entry_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLogEntry rows are immutable (Part 10.3) — % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_entry_no_update
  BEFORE UPDATE ON "AuditLogEntry"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_entry_mutation();

CREATE TRIGGER audit_log_entry_no_delete
  BEFORE DELETE ON "AuditLogEntry"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_entry_mutation();
