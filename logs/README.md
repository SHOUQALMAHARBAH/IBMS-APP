# `logs/`

Runtime **operational** logs for `apps/api` — pino structured (JSON) output:
request traces, debug lines, error stacks. Written here only when
`NODE_ENV=production` or `LOG_TO_FILE=true` (set `LOG_DIR` to write elsewhere).
In plain local dev the API logs to the console only and this folder stays
empty.

Files (daily rotation, via `pino-roll`):

| File | Contents | Retention |
|------|----------|-----------|
| `api.<date>.<n>.log` | all lines at/above `LOG_LEVEL` (default `info` in prod, `debug` in dev) | ~14 rotated files, 50 MB each |
| `api-error.<date>.<n>.log` | `error`/`fatal` only | ~30 rotated files |

## This is not the audit trail

The immutable business audit trail is `AuditLogEntry` in Postgres
(`apps/api/src/modules/audit`) — that is the legal/compliance record
(Part 10.3, PDPL accountability). These files are for engineering incident
triage and are intentionally **scrubbed**:

- request and response **bodies are never logged**
- `Authorization` / `Cookie` headers and known secret / national-ID /
  contact-field keys are redacted (`[redacted]`)
- see `apps/api/src/common/logging/logger.options.ts` and
  `ibms-brain/meta/lex/sensitive-data-handling.md`

Do not commit real log files, and do not point production log shipping at a
path inside a repo checkout. Everything here except this README and
`.gitkeep` is git-ignored.
