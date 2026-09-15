# Per-Organization outbound email

Multi-tenancy Part I §6. The platform never sends mail as itself. Each office
connects its **own** corporate mailbox by OAuth, and every message leaves from
that address — so recipients recognise the sender, deliverability reputation
belongs to the office rather than a shared platform domain, and no bulk-sending
infrastructure has to be operated at all.

## Status: built, and not yet proven against a real mailbox

Read this before assuming outbound mail works.

| | State |
|---|---|
| Schema, encryption, RLS, the connect/revoke flow, the send path | Built and tested |
| Microsoft Graph and Gmail adapters | Written against published API docs; **never run against a real tenant** |
| A message actually arriving in somebody's inbox | **Never observed** |

No office has connected a mailbox on this project, and a live OAuth consent
cannot be faked from a test. The adapters' HTTP behaviour — token exchange and
caching, retry and backoff, the difference between a rejected credential and a
transient failure, the request and MIME shapes — is covered by unit tests
against a stubbed `fetch` (`email-provider.spec.ts`). What is *not* covered is
whether Microsoft and Google accept those exact payloads.

**Verifying that is the first task of whoever connects the first real mailbox.**
It is small by construction: the places a real integration would need adjusting
are `sendMail`'s body shape in `microsoft365.provider.ts` and the MIME builder
in `google-workspace.provider.ts`. This is the same standing as Part B's
commercial screening adapter, and it is recorded here for the same reason —
an unproven integration that nobody flags is one somebody later assumes works.

## Setting it up

Register **one** OAuth application per provider for the whole platform, not one
per office. The per-office half is the consent, which each office grants itself.

Microsoft 365 (Entra ID app registration):
- Application permission `Mail.Send`, plus `offline_access` and `openid`/`email`.
- Redirect URI must match `EMAIL_MS_REDIRECT_URI` **exactly**, or consent fails
  with `redirect_uri_mismatch` — which is easy to misread as a credential fault.

Google Workspace (Cloud console OAuth client):
- Scope `https://www.googleapis.com/auth/gmail.send` only. This integration
  sends; it never reads the office's mail.

```bash
EMAIL_MS_CLIENT_ID=...
EMAIL_MS_CLIENT_SECRET=...
EMAIL_MS_REDIRECT_URI=https://your-host/settings/email/callback

EMAIL_GOOGLE_CLIENT_ID=...
EMAIL_GOOGLE_CLIENT_SECRET=...
EMAIL_GOOGLE_REDIRECT_URI=https://your-host/settings/email/callback

APP_BASE_URL=https://your-host
```

All optional. With a provider's variables unset, an office trying to connect it
is refused with a message naming the missing variables, and an office already
connected to it falls back to `NOT_CONFIGURED` — never to a shared sender.

`APP_BASE_URL` is what deep links in message bodies are built from. Getting it
wrong produces links nobody can open.

## Connecting an office's mailbox

```
GET  /admin/email-integration                 email.integration.read
GET  /admin/email-integration/authorize-url   email.integration.manage
POST /admin/email-integration/connect         email.integration.manage
POST /admin/email-integration/verify          email.integration.read
POST /admin/email-integration/test            email.integration.manage
POST /admin/email-integration/revoke          email.integration.manage
```

`email.integration.read` goes to the administrator, branch/department managers
and executives — knowing whether mail is going out is an operational concern.
`email.integration.manage` is administrator-only **and** role-gated: holding
this consent lets the platform send as a real company address.

`authorize-url` returns a `state` value. Store it and compare it on the way
back — an authorization code accepted without that check can be replayed from
another site.

`verify` proves the stored credential still works without mailing anyone.
`test` sends a real message to the office's **own** connected mailbox, which
proves end-to-end delivery without mailing anybody who did not ask to be part
of a configuration test.

## The rules this enforces

**A message that was not sent is never reported as sent.** Outcomes are `SENT`,
`NOT_CONFIGURED`, `CREDENTIAL_REJECTED` or `SEND_FAILED`, and only the first
means the provider accepted it. This is the same rule Part B applies to
screening, for the same reason: silence about a failure is worse than the
failure.

**There is no fallback.** No connected mailbox, a revoked or errored one, a
provider whose OAuth app is not configured here, a token that will not decrypt —
every one of them yields `NotConfiguredEmailProvider`. None degrades to a shared
platform sender. Sending from an address the recipient does not recognise is the
specific failure §6 exists to prevent, and doing it quietly while reporting
success would be worse than not sending.

**Sensitive content never goes in the body.** §6 requires that KYC documents,
quotations with pricing and policy documents are not emailed as payload: the
message is a notification carrying a link back into the platform, where access
is authenticated and audited. This is enforced structurally rather than by
convention — `OutboundMessage` has no attachment field and no HTML field, and
`OutboundEmailService.send` accepts only a **template key plus typed
parameters**, never caller-supplied body text. Adding a message type is a
reviewable change to `email-templates.ts`.

**Every template renders in Arabic and English.** Arabic is the platform's
primary language and the schema default; each message is rendered in the
recipient's own `languagePreference`. A template missing its Arabic body would
leave the main audience reading English.

**A rejected credential is distinguished from a failed send.** `401`/`403` sets
the integration to `ERROR` and tells the administrator to reconnect; a `5xx` or
a timeout is retried and leaves the mailbox `ACTIVE`. Collapsing the two would
tell them to do the wrong thing.

## The credential

The OAuth refresh token is stored in `OrganizationEmailIntegration
.oauthRefreshTokenEnc`, encrypted by the same field-level `EncryptionService`
as national IDs, under a distinct `oauth` purpose so its key-use audit trail is
distinguishable from a national ID being read. It is:

- never returned by any route (`status` gives the address, provider and health);
- never logged — `oauthRefreshTokenEnc`, `refresh_token`, `access_token`,
  `client_secret` and `authorizationCode` are all redaction paths in the logger;
- never written to an audit entry, encrypted or otherwise.

The plaintext exists only inside `OrganizationEmailIntegrationService.connect`,
between receiving it from the provider and encrypting it.

The table is tenant-scoped and carries an RLS policy of its own (migration
`20260930100000`). That is not ceremony: `20260928100000` installed policies for
the 118 tables that existed when it ran and **cannot cover a table added
afterwards**. Every new tenant-scoped table has to add its own — the application
layer picks them up automatically from the Prisma DMMF, the database layer does
not. The migration refuses to finish if the policy did not take.

## What sends mail today

One thing: **password reset**. That was the outstanding gap
(`auth.service.ts`'s own comment, and `sla-registry.config.ts`'s), and it is now
wired — the message goes from the office's own mailbox and carries a link to the
existing `/reset-password` page rather than anything sensitive.

A send failure there is deliberately **not** surfaced to the caller.
`POST /auth/forgot-password` returns the same shape whether or not the address
matched an account; reporting a mail failure for one address but not another
would reintroduce exactly the account enumeration that shape prevents. The
failure is logged, recorded on the integration row, and visible on the
integration screen.

`ENABLE_DEV_RESET_TOKEN` still works for local and e2e use, so the reset flow
can be exercised without a mailbox.

## What is not built

- **No client portal.** §6's "authenticated link" works for staff, who have
  accounts. An external recipient — a client or an insurer — has nowhere to
  authenticate, so a time-limited link for them is not implementable yet. Today
  the links are deep links into the platform for people who can already log in.
- **No UI.** The endpoints exist; the settings screen does not. Screens belong
  with the Phase 4 UI work, where they also need Arabic.
- **No other notification types.** Two templates exist (password reset, mailbox
  test). Adding one is an edit to `email-templates.ts` and its spec.
