#!/usr/bin/env bash
# A.10 (Part 10.4/10.5) — "Encrypted, scheduled backups + actually-tested
# restore drills (not backup-only assurance)" and "Document and test RPO/RTO
# at least annually." This is the test: it dumps a database, encrypts the
# dump, decrypts and restores it into a throwaway database, verifies the
# restored row counts match the original, and fails if the whole cycle takes
# longer than the RTO target — see ibms-brain/meta/lex/backup-rpo-rto.md for
# what that target is and why. A backup nobody has ever restored is not a
# backup, it's an assumption.
#
# Runs against db-test (.env.test) by default — same "never the dev/prod
# database" posture as scripts/smoke.sh and scripts/verify.sh. Pass a
# different service name as $1 to target another docker-compose postgres
# service (e.g. `bash scripts/backup-restore-drill.sh db` for a deliberate,
# manual dev-DB drill) — never done automatically.
#
# Usage: bash scripts/backup-restore-drill.sh [service] [database]
#   BACKUP_ENCRYPTION_KEY=<passphrase> bash scripts/backup-restore-drill.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -f .env.test ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.test
  set +a
fi

SERVICE="${1:-db-test}"
DB_NAME="${2:-${POSTGRES_DB:-ibms_test}}"
DB_USER="${POSTGRES_USER:-ibms}"
RESTORE_DB="${DB_NAME}_restore_drill"
# Documented target: meta/lex/backup-rpo-rto.md. Overridable so a slower CI
# runner doesn't have to lie about the number that's actually being tested.
RTO_TARGET_SECONDS="${RTO_TARGET_SECONDS:-900}"

if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  echo "backup-restore-drill: BACKUP_ENCRYPTION_KEY is not set — required so the dump this script produces is never left as an unencrypted file on disk (Part 10.2/10.6)" >&2
  exit 1
fi

echo "backup-restore-drill: starting ${SERVICE} ..."
docker compose up -d "${SERVICE}" >/dev/null

WORKDIR="$(mktemp -d)"
cleanup() {
  docker compose exec -T "${SERVICE}" psql -U "${DB_USER}" -d postgres \
    -c "DROP DATABASE IF EXISTS ${RESTORE_DB};" >/dev/null 2>&1 || true
  rm -rf "${WORKDIR}"
}
trap cleanup EXIT

START_EPOCH=$(date +%s)

echo "backup-restore-drill: dumping ${DB_NAME} ..."
docker compose exec -T "${SERVICE}" pg_dump -U "${DB_USER}" "${DB_NAME}" \
  > "${WORKDIR}/dump.sql"
DUMP_BYTES=$(wc -c < "${WORKDIR}/dump.sql")

echo "backup-restore-drill: encrypting dump (AES-256-CBC) ..."
openssl enc -aes-256-cbc -pbkdf2 -salt \
  -pass "pass:${BACKUP_ENCRYPTION_KEY}" \
  -in "${WORKDIR}/dump.sql" -out "${WORKDIR}/dump.sql.enc"
rm -f "${WORKDIR}/dump.sql" # the plaintext dump must not outlive the encrypt step
ENCRYPTED_BYTES=$(wc -c < "${WORKDIR}/dump.sql.enc")

echo "backup-restore-drill: decrypting into a throwaway database (${RESTORE_DB}) ..."
openssl enc -d -aes-256-cbc -pbkdf2 \
  -pass "pass:${BACKUP_ENCRYPTION_KEY}" \
  -in "${WORKDIR}/dump.sql.enc" -out "${WORKDIR}/restore.sql"

docker compose exec -T "${SERVICE}" psql -U "${DB_USER}" -d postgres \
  -c "DROP DATABASE IF EXISTS ${RESTORE_DB};" >/dev/null
docker compose exec -T "${SERVICE}" psql -U "${DB_USER}" -d postgres \
  -c "CREATE DATABASE ${RESTORE_DB};" >/dev/null
docker compose exec -T "${SERVICE}" psql -U "${DB_USER}" -d "${RESTORE_DB}" \
  < "${WORKDIR}/restore.sql" >/dev/null

END_EPOCH=$(date +%s)
ELAPSED_SECONDS=$((END_EPOCH - START_EPOCH))

echo "backup-restore-drill: verifying restored row counts match the original ..."
count_rows() {
  local database="$1"
  docker compose exec -T "${SERVICE}" psql -U "${DB_USER}" -d "${database}" -tA -c "
    SELECT COALESCE(SUM(n_live_tup), 0)::bigint FROM pg_stat_user_tables;
  "
}
# pg_stat_user_tables is estimate-only until ANALYZE runs — force it on both
# sides so this comparison is exact, not approximate.
docker compose exec -T "${SERVICE}" psql -U "${DB_USER}" -d "${DB_NAME}" -c "ANALYZE;" >/dev/null
docker compose exec -T "${SERVICE}" psql -U "${DB_USER}" -d "${RESTORE_DB}" -c "ANALYZE;" >/dev/null
ORIGINAL_ROWS="$(count_rows "${DB_NAME}" | tr -d '[:space:]')"
RESTORED_ROWS="$(count_rows "${RESTORE_DB}" | tr -d '[:space:]')"

STATUS="PASS"
if [ "${ORIGINAL_ROWS}" != "${RESTORED_ROWS}" ]; then
  STATUS="FAIL — row count mismatch (${ORIGINAL_ROWS} original vs ${RESTORED_ROWS} restored)"
fi
if [ "${ELAPSED_SECONDS}" -gt "${RTO_TARGET_SECONDS}" ]; then
  STATUS="FAIL — ${ELAPSED_SECONDS}s exceeds the ${RTO_TARGET_SECONDS}s RTO target"
fi

cat <<SUMMARY

===== backup-restore-drill summary =====
Database:            ${DB_NAME} (${SERVICE})
Dump size:            ${DUMP_BYTES} bytes (plaintext, deleted after encryption)
Encrypted dump size:  ${ENCRYPTED_BYTES} bytes
Elapsed:              ${ELAPSED_SECONDS}s (RTO target: ${RTO_TARGET_SECONDS}s)
Original row count:   ${ORIGINAL_ROWS}
Restored row count:   ${RESTORED_ROWS}
Result:               ${STATUS}
SUMMARY

if [ "${STATUS}" != "PASS" ]; then
  exit 1
fi
