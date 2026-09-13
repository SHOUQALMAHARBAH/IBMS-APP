# IBMS — Deferred Future Enhancements (not part of the current build)

These are **explicitly deferred**, not part of the current scope, and not to be built until the core system (schema + Part A security/infra + the business modules in `TASKS.md`/`TASKS-EN.md` + the multi-tenancy/auth corrections in `MULTI-TENANCY-SPEC.md`) is finished and stable. Recorded here so they aren't lost, per the user's explicit decision on 2026-09-07: *"بفضل نأجلهم حاليا لنخلص النظام الي عندي عشان اذا رح نضيفهم بكون ميزات اضافية للنظام"* (prefer to defer these for now until the current system is finished, so if added later they're additional features on top of it).

**Origin:** noticed in a competitor's marketing video/ad (`cambiotechsolutions` on Instagram/Snapchat) for a simpler insurance-agent tracking system. The ad's screenshot was confirmed by the user to be AI-generated marketing material, not evidence of a real working product — these three ideas are worth considering on their own merit, independent of that ad's credibility.

## 1. Configurable notification/reminder message templates

Beyond the existing SLA-timer-driven alerts (which fire, but with fixed system text), let staff design the actual wording of outbound notifications per purpose — a renewal reminder, a license-expiry notice, a payment-due reminder — with placeholders (customer name, policy number, expiry date, amount due) filled in automatically. Naturally tenant-scoped (`organizationId`) since each office would want its own tone/branding/language. Would live alongside the existing `SlaTimer`/`RenewalCase`/notification infrastructure rather than replacing it — the timer decides *when* to notify; this decides *what the message says*.

## 2. External ERP/accounting system integration point

The internal Finance module (`Invoice`, `Receipt`, `CommissionLedgerEntry`, `ReconciliationException`, `ClientFundsLedgerEntry`) is already complete for IBMS's own bookkeeping, but there's no defined export/sync path to a brokerage office's separate accounting software (e.g., if an office already runs a local accounting package and wants IBMS's financial transactions to flow into it rather than be re-entered manually). Would need: which systems to target first, whether it's a one-way export or two-way sync, and the actual data mapping — none of that has been discussed yet.

## 3. Mobile app scope decision

Still undecided: a dedicated native mobile app (like the one implied in the ad, for quick receipt/payment entry and report viewing on the go) vs. a responsive web app usable on mobile browsers being sufficient for the first version. This is a product/resourcing decision, not a technical one — needs to be made explicitly before Phase-based work would include it, since a native app is a materially larger scope addition (separate codebase, app-store distribution, push notifications infrastructure) than "make the web UI responsive."

---

## 4. Client/insurer external portal (surfaced by real implementation, not by the ad)

**Origin:** flagged directly by Claude Code during Phase 3 step 11 (per-tenant email, 2026-09-12), not from the competitor ad — recorded here because it's the same kind of "worth deciding on later, not now" item as 1–3 above, even though it came from a different source.

`MULTI-TENANCY-SPEC.md` §6.3's "secure link, not payload-in-body" pattern for sensitive email content assumes the person clicking the link can authenticate to view it — which works for staff (they already have IBMS accounts) but not for an external client or insurer contact, who currently has nowhere to log in at all. There is also no frontend UI for any of this yet. Whether IBMS ever needs a client-facing authenticated portal (to view a policy document, confirm a claim update, accept a quotation) versus staying purely a staff-facing internal system is a product decision with real scope consequences (external identity/auth for non-employees, a whole additional UI surface, its own security review) — not something to decide implicitly by building it piecemeal. Revisit alongside items 1–3 once the core system is stable.

---

**Do not build any of these as part of the current phases in `MULTI-TENANCY-SPEC.md`.** Revisit this file once the core system is verified working end-to-end.
