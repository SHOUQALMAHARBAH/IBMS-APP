> **How this document got here, and what is and is not mine.**
>
> The owner handed this to the session of 2026-09-28 as a standing instruction. **Everything below
> the line is hers, verbatim** — not edited, not summarised, not merged into anything. It is in the
> repo because a directive that exists only in a chat is a directive the next session never sees:
> the email-integration screen (§ 1.76) was built to it and nothing in `CLAUDE.md` would have told
> anybody why.
>
> **This block is the only part written by me**, and it exists to state where the directive and
> `docs/b7-consistency-record.md` overlap or disagree. B.7's seven rules were derived separately and
> surveyed across 103 screens; this directive covers much of the same ground in different words.
> **Neither is silently folded into the other.**
>
> ## Where they AGREE, in different words
>
> | Directive | B.7 | Both say |
> |---|---|---|
> | § 1 role-assembled screens | — | the control does not exist rather than existing and refusing |
> | § 2 four states | rule 3 | every data-bearing screen ends in one of four states |
> | § 2 refusals in the employee's own terms | rule 4 | every refusal names the way forward |
> | § 2 bilingual as first-class copy | rule 6 | meaning parity, not key parity |
> | § 6 consistency of action placement and naming | rules 5 and 7 | one term per concept, everywhere |
>
> ## Where they DISAGREE — for the owner to settle, not for me
>
> **1. Is a screen with an unwritten state a DEFECT, or a flag to triage?**
> The directive: *"a screen is not considered finished if any of the four hasn't been designed and
> written with the same care as the happy path."* B.7's formal pass found **nine screens with no
> empty state** — `/leads`, `/customers/kyc-queue`, `/sales-performance`,
> `/access-recertification`, three dashboards, the home screen's missing error branch — and recorded
> them as *"genuinely worth reading, and NOT closed here"*. Under the directive those nine are
> unfinished screens. Under B.7 they are triaged flags. **The disagreement is about status, not
> about facts**, and it decides whether they are a build item.
>
> **2. `/settings/security` has no permission branch, deliberately.**
> B.7 records it as a documented exception that is *load-bearing*: the screen must stay ungated or
> ten of eleven roles can never enrol in MFA and are locked out of everything. The directive's § 1
> admits no exception in its wording. The exception should survive — but it should survive as a
> stated exception, not by nobody noticing the rule.
>
> **3. Which roles may see implementation detail.**
> The directive § 2 permits internal detail (table names, stack traces, raw exception text) to reach
> *"System/Security Administrator debugging tools"*. B.7 has no equivalent carve-out. § 1.76
> implemented the directive's version — the office-mailbox screen shows the deployment gap in the
> reader's own terms and the environment-variable names only to that role — so the two documents
> currently disagree about a screen that exists.
>
> **4. What "sidebar" means for a screen whose only holder cannot reach it.**
> The directive § 5 governs what BELONGS in the sidebar. § 1.61 and § 1.75 govern what must be
> REACHABLE by every holder of a control's permission, and `scripts/measurements/permission-
> reachability.py` measures it. These are compatible and neither mentions the other; a screen can
> satisfy § 5 and still leave a permission-holder with no route. Worth one sentence in whichever
> document the owner prefers.
>
> **Nothing above changes a line of the directive.** Where § 1.76 and the screens after it follow the
> directive over B.7, that is recorded in each entry rather than resolved here.

---

# IBMS — Frontend & UX Engineering Directive

**Purpose of this document:** a standing instruction for whoever (or whatever coding agent) builds the IBMS frontend, covering how every screen, every piece of interface copy, and the overall navigation must be designed — not a one-off task, but the standard every screen in the system is held to from the first page built to the last. It is meant to be handed to Claude Code alongside `MULTI-TENANCY-SPEC.md`, `HAPPY-FLOW.md`, and `TASKS.md`/`TASKS-EN.md`, and it reconciles with — rather than duplicates — the UI principles already established in `MULTI-TENANCY-SPEC.md` §10.4 (role-based hiding) and §10.6 (UX simplicity guardrails).

---

## Role framing (use this verbatim when briefing the coding agent)

> You are acting as a senior Frontend Engineer, UI Developer, and UX Designer on the IBMS project. Every screen you build, every interaction you wire up, and every piece of text the system shows a user is your responsibility to get right — not just functionally correct, but polished enough that a working insurance-brokerage employee, on their first day, understands exactly what they're looking at and what to do next, without training. You are not scaffolding an admin panel; you are building a product a professional works inside for hours every day.

---

## 1. Every screen is built for the role actually looking at it, not a generic user

This is not new — it restates and extends `MULTI-TENANCY-SPEC.md` §10.4: a user's screen is assembled from their actual, resolved permission set (fetched once at login), never from a one-size-fits-all layout with parts disabled or hidden after the fact. Concretely:

- The eleven roles (Sales/Relationship Officer, Placement/Technical Officer, Policy Checking Officer, Claims Officer, Finance/Collections Officer, Compliance Officer, Branch/Department Manager, DPO, System/Security Administrator, Executive/Management, External Auditor) each see a genuinely different home dashboard, a genuinely different navigation set, and genuinely different actions on shared records (e.g., a `Policy` detail page shows a "Check this policy" action only to a Policy Checking Officer who isn't the one who placed it — everyone else simply doesn't see that button, per the existing maker/checker rule).
- Never render a control and then reject the click with "you are not authorized." If a role cannot do something, the control does not exist on their screen. The backend still independently re-validates every request regardless (§10.4) — this is a UX rule, not a substitute for that.

## 2. Every message the system shows a user is professional, specific, and immediately understandable

No raw error codes, no stack traces, no generic "An error occurred" or "Unauthorized" with nothing else — every message is written the way a well-trained employee would explain the situation to a colleague:

- **Validation errors** name the exact field and the exact problem, in plain language ("Sum Insured must be greater than zero" — not "Invalid input" or a field-name-as-code like `sumInsured_ERR_001`).
- **Empty states** explain what belongs there and, where relevant, offer the one action that would fill it (e.g., a customer with no policies yet shows "No policies yet — start a new RFQ to begin placing coverage," not a bare "No data").
- **Success confirmations** are specific about what happened ("Policy PLC-2026-00341 was delivered to Ahmad Al-Khatib on 10 Sep 2026," not a bare "Success").
- **Error/failure states** say what went wrong in terms the employee's job already gives them (e.g., "This claim can't be closed until a settlement amount is recorded" rather than a database constraint message), and never expose internal implementation detail (table names, stack traces, raw exception text) to any role other than System/Security Administrator debugging tools.
- All of the above is written and reviewed in **both Arabic (RTL) and English (LTR)** as first-class, professionally written text in each language — not a literal translation of one into the other — consistent with the bilingual requirements already established for IBMS.
- Every data-bearing screen implements all **four states** — loading, empty, error, and populated — and each of those four states follows the same tone-and-clarity rules above; a screen is not considered finished if any of the four hasn't been designed and written with the same care as the "happy path" populated state.

## 3. Nothing on a page that isn't earning its place

Every element on a screen must serve the task the role in front of it is actually there to do. No filler widgets, no placeholder cards with no data behind them, no decorative sections added "because the page felt empty." If a page has fewer things to show for a given role or record, the page is shorter — it does not get padded to look fuller.

## 4. No pages that exist only to link to other pages

Restating and enforcing `MULTI-TENANCY-SPEC.md` §10.6: a page must not exist purely as a waypoint with no actionable content of its own. Before building any page, its reason to exist independently — what a user does *on* it, not just links *from* it — must be clear. If a screen's only content is a list of links to other screens with no summary, status, or action of its own, it is either merged into the page that would otherwise link to it, or redesigned to actually do something.

## 5. Sidebar navigation: major modules only — everything smaller lives inside the pages it belongs to

This is the concrete rule behind the "3–5 shortcuts" principle already stated in §10.6, made explicit as a navigation architecture:

- **The sidebar holds only the small number of major, top-level modules relevant to the signed-in role's actual day-to-day work** — for example, a Claims Officer's sidebar is built around Claims, not around every sub-entity a claim happens to touch (documents, adjusters, settlements, third parties all live *inside* the claim record's own page as tabs or sections, not as separate sidebar entries).
- **A secondary or contextual item never gets its own top-level sidebar slot.** If something is only ever reached starting from a specific record (a document template tied to one insurer, a settlement tied to one claim, a schedule tied to one policy), it is reached by navigating into that record and finding it there — never by hunting through the sidebar.
- **Guideline, not a hard number**: each role's sidebar should be scannable in a glance — roughly the count of genuinely distinct top-level activities that role performs, not an exhaustive index of every entity in the schema. A sidebar that requires scrolling to see all its own items is a sign something secondary crept in as a top-level entry and needs to move inside a page instead.
- **Drill-down is always contextual**: from the sidebar's top-level module, the user lands on a list or dashboard for that module, and everything more specific (a single customer, a single policy, a single claim, and everything nested under it) is reached by opening that specific record — not by a parallel sidebar tree trying to mirror the database schema.

## 6. Consistency across the whole system

- The same action (Approve, Reject, Submit, Export, Delete-with-confirmation) is placed in the same relative position on every screen that has it, styled the same way, regardless of which module the user is in.
- The same icon always means the same thing everywhere in the app — an icon is never reused for two different meanings across different modules.
- Layout patterns (how a list screen is structured, how a detail/record screen is structured, how a form screen is structured) are consistent templates reused across all 74 business processes, not redesigned per module — a user who has learned one list screen already knows how every other list screen works.

---

## How this reconciles with what's already specified elsewhere

- `MULTI-TENANCY-SPEC.md` §10.4 (role-based hiding, two-layer enforcement) and §10.6 (UX simplicity guardrails) are not superseded by this document — they're the seed this document expands into a full frontend standard.
- The four-state screen requirement and bilingual copy standard were already implied by the source documents' bilingual/UX requirements (Part 11) — this document makes both explicit and mandatory for every screen, not just called out in passing.
- `HAPPY-FLOW.md`'s per-role login-to-logout journeys describe *what* each role does in sequence; this document governs *how* every screen in that journey looks, reads, and is reached.

## Acceptance checklist (add to the existing checklists, not a replacement for them)

- [ ] For every role, opening the sidebar shows only that role's major modules — no module the role has no permission for appears anywhere, not even disabled/greyed out
- [ ] No screen in the system exists solely to link to other screens with nothing of its own to show or do
- [ ] Every validation error, empty state, success message, and failure message has been written in professional, specific, plain-language Arabic and English — none reads as a generic or technical message
- [ ] Every data screen has a designed loading state, empty state, error state, and populated state — all four reviewed, not just the populated one
- [ ] A secondary/contextual entity (a document template, a settlement, a schedule, an adjuster) is reachable only from the record it belongs to, never from a standalone top-level sidebar entry
- [ ] The same primary action (Approve/Reject/Submit/etc.) appears in the same place and style on every screen that has it
