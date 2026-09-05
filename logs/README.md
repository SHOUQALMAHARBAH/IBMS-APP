# `logs/`

Runtime **operational** logs for `apps/api` — pino structured (JSON) output.
The running API mirrors **everything it prints** here: HTTP request traces,
Nest `Logger` output, error stacks, stray `console.*` from libraries, and
uncaught `unhandledRejection` / `uncaughtException` crashes.

Written whenever `NODE_ENV=production` **or** `LOG_TO_FILE` is anything other
than `false` — i.e. **on by default in local dev too**, alongside the pretty
console. Set `LOG_TO_FILE=false` for console-only; set `LOG_DIR` to write
elsewhere. Forced silent and file-less under `vitest` regardless.

The `npm run dev` / turbo / `nest start --watch` compiler output ("compiled
successfully", webpack progress, etc.) comes from separate parent processes
and is **not** captured here — only what the API process itself emits.

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
