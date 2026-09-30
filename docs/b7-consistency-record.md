# B.7 — the consistency record

~~**This is the running record, not the pass.** The formal survey happens after the remaining backlog items
land~~ — **the pass ran on 2026-09-26; it is at the bottom of this file.** This part remains the running
record: the reason for keeping it was that fixing screens before they settle means fixing them twice, and
that still holds for anything noticed from here on. What goes in here is every
violation noticed while touching a screen for other work — **including ones not fixed in that commit** — so
that B.7 becomes reading a list somebody already holds rather than reading 93 screens cold.

One line per violation: screen · rule · what is wrong. Add to it as you go. Do not tidy it.

---

## The seven rules

Each is answerable **yes / no / not-applicable** per screen. "Make the flow consistent" is not checkable;
these are.

1. **The create form sits ABOVE the table, not below it.** Every screen with a create and a table.
2. **No field asks for an identifier** — not in the question and not in the answer. A screen that accepts a
   name and then prints a uuid in its results has half complied.
3. **No screen leaves a person facing nothing.** Every screen ends in one of four states: data · "no data"
   with the create action · "you do not have permission" with the reason · "something went wrong" with the
   way to retry.
4. **Every refusal names the way forward.**
5. **Delete means deactivate, IN THE SAME WORDS everywhere.** Not "suspend" here, "deactivate" there,
   "archive" on a third. One term per concept.
6. **Arabic and English say the same thing** — meaning parity, not key parity. This product's primary
   language is the one that gets missed.
7. **One action, one name, across every screen that shows it.** A written glossary, not per-screen
   judgement.

**What this is not**: not a redesign, not colours, not layout. It is removing contradictions so that a
person who learns one screen knows the rest.

---

## The glossary (rules 5 and 7)

Filled in as terms are settled. A term enters this table when two screens are found saying the same thing
differently — the disagreement is the evidence, not somebody's taste.

| Concept | The word we use | Never | Settled by |
|---|---|---|---|
| Ending an entity's active life while keeping its history and its links | **deactivate** | delete, remove, suspend, archive, retire | The four-action scheme names the permission `.deactivate`, and the owner's rule that delete MEANS deactivate. |
| Ending a ROLE's active life | **retire** | delete, deactivate | Deliberate exception: `/settings/roles` has BOTH — retire (reversible, keeps the grant history) and delete (only a role never used). Two different acts need two words. Recorded here so it is a decision, not drift. |
| Finding a named thing to attach to a record | **search / find** | pick, select, lookup | `EntitySearch` is one control on every screen that needs one (Plan B). |
| Ending an ENCRYPTION KEY's use for new writes, while keeping it to decrypt old rows | **retire** | deactivate, disable | A THIRD sense, and legitimately distinct: a retired key is still in use — for reading. It is not an entity whose active life ended. Found by batch 3 while checking whether `encryption-keys`' "Retired" was the same drift as the org units'. It is not; it stays. |
| Withdrawing a record RAISED IN ERROR | **withdraw** | discard, delete, cancel | The permission family is `*.discard` and the UI says withdraw — a deliberate divergence, not drift: the Arabic «إلغاء» means a cancellation endorsement on a live policy, so the UI could not use the code's own word. `docs/discard.md`. |
| Taking back something GRANTED — a role, a device's trust, an access right | **revoke** | deactivate, remove, disable | Not the same concept as deactivating an entity: the thing revoked was given to somebody, and the giving is what is undone. Four screens already agreed; recorded so the next one does not reach for "deactivate". |
| Ending a RELATIONSHIP with a counterparty — employment, a vendor contract | **terminate** | deactivate, end, close | Also distinct, and it carries obligations the other words do not imply (data return, access revocation). Two screens already agreed. |
| Closing out an item a sweep flagged | **resolve** | clear, dismiss, close | `/bank-reconciliation` and the claims follow-up alerts already agreed. Checked rather than assumed — the same word for the same kind of act, so it is compliance and not a collision. |
| Telling a reader they lack a permission | **one sentence, from `lib/i18n/permission-refusal.ts`** | a per-screen sentence; naming only the code | 100 refusal strings across 89 files each wrote their own, and the disagreement was total rather than partial: the ENGLISH named the code and never the act, the ARABIC named the act, and NOT ONE of the 100 said who could grant it. They became 102 act keys at 106 call sites. |
| Who the reader should ask for a grant | **whoever manages permissions in your office** (by FUNCTION) | Office Administrator, System Administrator, your Manager, any role name | An office defines its own role names — that is what office-scoped RBAC is for — so any role name is a sentence that can be false in some office. Asserted as an ABSENCE in `e2e/permission-refusal.spec.ts`, because absence is the only form that can fail. |
| A permission code shown to a reader | **alongside the sentence, in a parenthetical** | inside the sentence; as the whole sentence | The code is what the administrator types into the Role screen, so it is worth showing — but a reader being told what they cannot do should not have to parse an identifier to find out. |
| Several codes where holding ONE is enough | **any one of these permissions grants it** | naming them as a pair the reader needs both of | `PermissionsGuard` is `required.some`, so a route declaring two admits a holder of either. Four screens. |
| A data subject taking back CONSENT | **withdraw** | revoke, cancel | A FOURTH sense of withdraw and a legitimate one: it is a statutory PDPL act by the data subject, not the office withdrawing a record it raised in error. Seven strings on `/consent` and `/dpo-workspace` use it; recorded so nobody "corrects" them onto the discard concept. |
| Abandoning a form that was never submitted | **cancel** | discard, withdraw | Nothing was raised, so there is no record to withdraw. `/sla-policies` said "Discard" while `/watchlist-sync` said "Cancel" for the identical affordance — batch 4, fixed to Cancel, which is also what the Arabic already said («إلغاء الإدخال»). |
| Not surfacing matches below a score | **ignore** | discard, drop | A THRESHOLD, not a deletion: the matches still exist and are still screened, they are just not shown. `/screening-health` said "Discard below" in English while its own Arabic said «تجاهل دون» — ignore. Fixed to the Arabic's meaning in batch 4. |
| Deciding a sanctions match is not the person | **clear** | resolve, dismiss | A DELIBERATE exception to the resolve row above, on the same ground as "Suspended": in AML a match is *cleared*, it is the word an examiner expects, and it is a decision about the match's MERITS rather than the closing of a task. Checked in batch 4 and kept. |
| Choosing from a CLOSED LIST — a `<select>`, a role set, a catalogue | **pick / select** | search, find | NOT the same as the glossary's *search / find* row above, which governs finding a NAMED thing to attach to a record — the `EntitySearch` control, where the reader types. Four screens agree (`/sales-performance`, `/settings/users`, `/employees`, `/insurers/new`, whose catalogue is a `<select>`), checked in batches 6, 7 and 8. |
| Declining a suggestion the SYSTEM proposed | **dismiss** | resolve, clear, reject | A deliberate exception to the *resolve* row: a reconciliation exception is a problem that must be closed out, while a cross-sell or up-sell suggestion is an OFFER — there is nothing to resolve, and "resolve" would claim a problem existed. `/cross-sell` and `/up-sell` agree (`xsConfirmDismiss`, `upsDismiss*`). Checked in batch 8. |
| Several codes where ALL are needed | **needs all of these permissions** | any one of these | A screen loading several endpoints with `Promise.all` closes if any one refuses. Two screens. The opposite claim from the row above, and telling a reader the wrong one sends them to ask for a grant they do not need — which is why the two are separate FUNCTIONS with no default mode, rather than one function with a flag. |

### What batch 3 changed, and what it did not

**CHANGED (English), because the table above already decided it:**

| Screen | Was | Now | Why it was a violation |
|---|---|---|---|
| `/payment-channels` | Disable / Disabled | **Deactivate / Deactivated** | The permission is `payment-channel.deactivate`. The code already said the settled word and the screen did not. |
| `/settings/org-units` | Retire / Retired | **Deactivate / Deactivated** | The permissions are `branch.deactivate` / `department.deactivate`. The ROLE exception does not extend here: it exists because `/settings/roles` has retire AND delete, and org units have only the one act — checked, not assumed. |

**NOT CHANGED — singular, so there is nothing to be consistent with.** Per the rule that this list holds
decisions and not an inventory: `Pay refund`, `Approve refund`, `Calculate adjustment`,
`Request endorsement`, `Request cancellation`, `Advance to insurer`, `Notify client`, `Register & assign
adjuster`, `Second-approve settlement`, `Mark survey complete`, `Mark investigation complete`,
`Issue invoice`, `Record collection`, `Reconcile collected funds`, `Run reconciliation`, `Investigate`.
Each appears once across the twelve finance and claims surfaces.

One of those is worth a note rather than a row: **`Pay refund` is the UI for the permission
`refund.disburse`.** The screen says "pay" and the code says "disburse". That is not a rule 7 violation —
rule 7 is about one action having one name ACROSS SCREENS, and this appears once — but if a second refund
surface is ever built, "pay" is the word it should use, because it is the one a Finance officer says.

**THE ARABIC IS NOT SETTLED, and it is the owner's to settle.** Measured in batch 3: the English has
THREE words for the concept in the first row (deactivate, disable, retire) and the Arabic has TWO —
`إيقاف` on `/sla-policies` and `/settings/org-units`, `تعطيل` on `/settings/users` and
`/payment-channels`. They diverge in DIFFERENT PLACES, so neither language is the consistent one. The
English changes above move each screen onto the Arabic its English twin already used, so no Arabic was
invented and no pair now disagrees — but one English word still has two Arabic renderings. `تعطيل` reads
as "disable" and `إيقاف` as "halt/suspend"; the table above rejects "suspend" as a synonym, which is an
argument for `تعطيل`, but the owner writes the Arabic.

---

## Violations noticed so far

Format: `screen · rule N · what is wrong` — and `[FIXED <commit>]` when it was closed in the same work.

| Screen | Rule | What is wrong | Status |
|---|---|---|---|
| `/settings/roles` | 1 | The create form sat BELOW the table, and the permissions editor below that — so clicking a row's "Permissions" button appeared to do nothing at all. | **[FIXED]** create, then editor, then table. Same commit that found it. |
| `/settings/users` | 1 | Same shape as above. | **[FIXED]** same arrangement applied. |
| `/employees` | 1 | The create form sits BELOW the table. Still does: the unified person form is long, and putting it above pushes the list off the screen entirely. **Needs a decision** — a collapsed "Record a person" disclosure above the table would satisfy the rule without burying the list. | OPEN — rule 1, deliberate for now, no decision yet |
| ten screens using `CustomerPicker` | 2 | Ten forms asked for a raw `customerId`, fillable only by copying a uuid out of another screen's address bar. | **[FIXED]** `EntitySearch`, Plan B. |
| `/settings/users` | 2 | The provisioning form named an HR record by id through a dropdown that could not contain the person being registered. | **[FIXED]** the picker is gone; the person form carries the login. |
| `/audit-trail` | 2 | The User column printed a raw `userId` at the one person whose job is knowing who did what — the "answer" half of rule 2. | **[FIXED]** actor names resolved per page. |
| `/audit-trail` | 2 | The `entityId` filter still asks for a raw uuid, and `entityType` is free text. Nothing offers the vocabulary. | OPEN — rule 2 |
| `/audit-trail` | 3 | `action`, `from` and `to` are accepted by the API and have no control (IMPROVEMENTS § 1.52) — not a rule-3 violation strictly, but the same "the screen is narrower than the thing behind it" shape. | OPEN — recorded with § 1.52 |
| `/insurers` detail | 2 | `updateInsurer` exists in the web client with NO caller: a PATCH route reachable from nothing. An office cannot correct an insurer record it registered. | OPEN — rule 2/3, recorded in Part 3 Phase 1 |
| insurance lines | 2 | `POST`/`PATCH /insurance-lines` have no web client function at all. The permissions exist, the routes exist, no screen does. | OPEN — unreachable surface | **CLOSED 2026-09-28: `/settings/insurance-lines`, gated on both write codes. IMPROVEMENTS § 1.66. Note this row said "no screen" and was RIGHT about both verbs while § 1.44 had only recorded the PATCH — the path-only measurement could not see the POST.**
| every screen with a maker/checker refusal | 4 | The refusal stated the rule and stopped: no permission named, no way forward. | **[FIXED]** Part 5, 18 of 19 call sites; the nineteenth is a deliberate exception with its reason in the code. |
| `/insurers`, `/vendors`, `/documents` | 4 | "You do not hold X" messages named permission codes that four-action Phase 1 had renamed — and the ARABIC halves were missed after the English were corrected. | **[FIXED]** both languages, plus a gate: `translations.test.ts` now fails when user-facing text names a code the catalogue does not have. |
| `/settings/roles` | 3 | A caller with `role.read` and no write code saw a screen with no controls and no sentence explaining why. | **[FIXED]** the read-only branch says so. |
| `/opportunities/[id]` ×4, `/claims/[id]` | 1, 4 | Class B piece 1 added ONE withdraw control (`DiscardControl`) to four sections rather than four buttons, so the confirmation step, the reason floor and the wording cannot drift between them. Recorded as a rule-1 datum, not a violation: the four sections each compute their own `discardable` boolean from their own commitment rule, which is the part that legitimately differs. | **[SATISFIED]** one control, four call sites |
| the Arabic discard wording | 5, 7 | «إلغاء» means a CANCELLATION endorsement on a live policy in this product. Using it for "withdraw a record raised in error" would have made the two read as the same act, on screens where both appear. «سحب» throughout, including the back button — which is where the collision would otherwise slip in unnoticed, since "cancel" is the reflex word for a dismiss button. | **[SATISFIED]** noted in the dictionary itself, beside the keys |
| a withdrawn record's row | 1, 4 | A record marked withdrawn keeps its place in its own list and says so, with its reason. The alternative — hiding it — reads as deletion, the same argument that keeps deactivated insurers in the insurer list. Its forward action disappears rather than staying enabled and 422-ing: an enabled button that refuses teaches the user the screen is broken, not that the record is closed. | **[SATISFIED]** asserted in `e2e/discard.spec.ts` |
| every screen with a maker/checker approval | 3, 4 | Part 4 step 3 gave fifteen API routes an OPTIONAL `combinedDutyReason` that NO web control sent. Unreachable while no office could declare COMBINED, but the moment the mode screen shipped, an office that declared it found every approve button returning 422 "give a reason" with nowhere to type one. Rule 3's shape arriving from the other direction: not a route with no caller, but a route whose new requirement its existing caller cannot meet. | **[FIXED]** one shared control on all twelve approve screens; `e2e/combined-duty-declaration.spec.ts` asserts both halves |
| the refusal on a self-approval | 4 | Now produced by one engine rather than nineteen call sites, so the sentence a person reads — the rule, the permission a second signature needs, and where to see who holds it — cannot differ between refunds, claims and disposal batches. | **[SATISFIED]** one refusal, fifteen pairs |
| `/settings/duty-segregation` | 3, 4, 6 | NEW. Two audiences on one page: the office administrator gets the form, the reviewers get the same facts read-only WITH a sentence saying why they cannot change it — rule 4, since a screen that simply omits its controls teaches nothing. The COMBINED option stays visible and explains that it cannot be used yet rather than vanishing. Rule 6: the reason field IS the confirmation step, no separate "are you sure". | **[SATISFIED]** asserted in `e2e/duty-segregation-mode.spec.ts` |
| the endorsement's refund block | 1 | A declared combined-duty act now appears ON the record, naming the roles the actor wore and the recorded reason — not only in a report. The other fourteen views do not project it yet; stated as a limit in `docs/duty-segregation-mode.md` rather than left to be discovered. | PARTIAL — one of fifteen views |
| `/internal-controls` | 1, 4 | The declared-acts report sits ABOVE the silent-self-approval scan, because the scan is always a table of zeroes and the report is real acts — rule 1 applied to ordering within a screen. Its own error and its own empty state, so "nobody has done this" and "the report could not be read" never share a blank space, and one half failing does not blank the other. | **[SATISFIED]** asserted in `e2e/self-approval-report.spec.ts` |
| every approve control | 1, 3 | Fourteen of fifteen could not send a combined-duty reason, so an office in COMBINED mode met a 422 with nowhere to type. Closed with ONE control rather than twelve textareas — rule 1, because the wording is the load-bearing part: it has to say the person raised this AND that the office allows them to approve it, or the field reads as an accusation, and twelve copies are twelve places for that to drift. What legitimately differs per screen is only which column names the maker. | **[FIXED]** `CombinedDutyReasonField`, twelve call sites |
| two of my own twelve approve controls | 1 | `ClaimCard` and `KycQueue` called `needsCombinedDutyDeclaration` TWICE with identical input — once for the field, once for the disabled button — where the other ten compute it once. Functionally identical and a real rule-1 violation: the field and the button must agree about whether a reason is required, and two copies of the condition are two places for them to stop agreeing. Found while recording this table, in code written the same day. | **[FIXED]** computed once, matching the other ten |
| `/settings/roles` — three checkboxes | 2, 3 | MEASURED, not noticed: of 211 permission codes, 12 sit on no route guard and nine of those are read by a SERVICE (the `.all-owners.read` family widens a visibility filter — enforcement, just not at the route). THREE were read NOWHERE in the application. `refund.raise` is described as "the maker side" of a maker/checker pair, so an administrator who unchecks it believes she has removed the ability to raise a refund; she has not, because a refund is created inside `POST /endorsements/:id/calculate-adjustment` under `endorsement.apply`. `claim.delete` promised "disabled by default, logged privileged override only" — a control mechanism that exists nowhere. Nothing is exploitable (segregation still holds through `assertDifferentActors` and the CHECK); what is wrong is that the screen makes a promise the code does not keep. NOT deleted: a `RolePermission` row is the record of what an office once granted, the same reason Phase 3 gave `Role` no DELETE, and the house rule for a capability that is not ready is to keep it visible and SAY so (the mode screen's COMBINED option is the precedent). | **[FIXED]** each description now opens `NOT YET ENFORCED`, with a guard in both directions |
| the owner's Arabic-description input file | 2 | Its header said "Generated from the seeded database, so this IS what the Role screen renders" and NO generator existed — second occurrence of that exact defect in this repo, after the web permission fixture. Hand-written once at 186 codes against a catalogue of 211, so 25 codes were invisible to the person being asked to describe every permission: everything from four-action Phase 1, all four discard codes, and the duty-segregation mode. | **[FIXED]** `npm run db:permission-descriptions`, gated by its `:check` form in `verify.sh`. The logic lives in `apps/web/lib/admin/` and the script is a shell over it — the first version put it all in `scripts/`, which every local gate accepted and the docker build refused, because `turbo prune` excludes non-workspace directories |
| `/payment-channels` | 3, 4 | One umbrella, `payment-channel.manage`, gated adding a destination for client money, listing the destinations, and disabling one. Its own description read as three things. Rule 3 because a Finance officer who needs the list to record a receipt had to be given the ability to add bank accounts to get it; rule 4 because the screen's load-failure message named `payment-channel.manage` IN BOTH LANGUAGES, so a reader refused the LIST was told to ask for the write grant. Split three ways, and the refusal now names the READ, which is what actually failed. | **[FIXED]** three codes, three gates, and the message corrected in Arabic and English together |
| `/sla-policies` | 3 | One umbrella gated correcting a deadline AND switching an SLA off — and a fifth route that is not an SLA policy at all: adding a public holiday to the business-day calendar. Two entities under one checkbox, which is `insurer.relationship.manage`'s case. Split four ways on the owner's ruling. | **[FIXED]** `sla.policy.create` / `.update` / `.deactivate` + `sla.holiday.create`; `sla.policy.read` already existed |
| the holiday calendar | 2, 3 | NEW, found by that split. The calendar every business-day deadline is counted against is EMPTY on both databases, nothing seeds it, and its only writer had no web caller — so an office cannot enter Eid. The screen shows deadlines as if they were exact; the underlying utility is honest in a comment that they are a lower bound. Rule 2, because the screen answers with a date it cannot support. | OPEN — § 1.57; item 1 needs a source (the gazette), not an invention | **PARTLY CLOSED 2026-09-27: the writer has a screen ("Non-working days" on `/sla-policies`) and the empty calendar now states the direction of its own error. The DATES are still absent — they are gazetted annually and several are lunar, so nothing should seed a guess. IMPROVEMENTS § 1.57.**
| the combined-duty reason box | 6 | The reason field IS the gate: the button is disabled until ten characters are typed, and there is no separate "are you sure" step to click through without reading. Same treatment the discard control already gets, for the same reason. | **[SATISFIED]** asserted on nine characters, not only on zero |

---

## BATCH 4 — the compliance surface, 20 screens (2026-09-30)

Rules read: **1, 3, 4, 5, 7.** Rule 2 and rule 6 are guards now (`apps/web/test/screen-copy.test.ts`) and
cover all 102 screens continuously, so a per-batch sweep of them would re-measure what the build measures.

### FIRST, THE DENOMINATOR — and it is not what the earlier batches reported

**"76 of 102 remain" cannot be substantiated, and the reason is a process defect rather than an arithmetic
one: batches 1–3 reported their coverage in conversation and never wrote it into this file.** Files
*touched* is recoverable from git; screens *read* is not, and a screen read and found correct touches
nothing. So the honest position is that the covered set before batch 4 is unknown, and the numbers 16 + 26
+ 12 = 54 do not reconcile with 102 − 76 = 26 either.

That is fixed here rather than argued about: the table below is per-screen, it lives in this file, and from
now on a screen is covered when a row says so. **102 screens under `app/(app)`** — measured, and the
"93 screens" figure elsewhere in this document is stale.

### The 20 screens of batch 4

`access-recertification` · `audit-trail` · `consent` · `cross-border-transfers` ·
`data-sharing-approvals` · `dpia-screenings` · `dpo-workspace` · `dsr` · `incidents` ·
`internal-audit-findings` · `internal-controls` · `operational-pi-risk` · `privacy-notices` ·
`regulatory-compliance` · `retention-disposal` · `ropa-entries` · `screening-health` ·
`screening-matches` · `transaction-monitoring` · `watchlist-sync`

Chosen as a group because it is the surface a regulator opens, so a contradiction between two of these
screens costs more than one between two dashboards.

| Rule | Result |
|---|---|
| **1** — create form above its table | **CLEAN on all 20.** Read as PAIRS, which is what the formal pass warned about: `retention-disposal` has three (form, table) pairs and all three are ordered correctly (211<253, 328<382, 446<468); `operational-pi-risk` likewise. Four screens are read-only (`dpo-workspace`, `internal-controls`, `screening-health`, `screening-matches`) and have no form — n/a, not a violation. |
| **3** — four states | **CLEAN on all 20**, after reading three flags that were all false positives (below). |
| **4** — every refusal names the way forward | **One real finding, fixed, and it was app-wide** (below). The permission half of rule 4 is now structural for all 102 screens, because every refusal renders one sentence that names the grantor. |
| **5** — delete means deactivate, same words | **CLEAN.** `slapDeactivate` is the glossary's word; `empColTerminated` is the relationship sense, correctly. |
| **7** — one action, one name | **Two collisions, fixed**, plus two senses recorded as deliberate (below). |

### Rule 4 — the fourth state was half-built on 5 keys, and the finding is app-wide

Rule 3's fourth state is **two things**: "something went wrong" AND the way to retry. Every earlier pass
measured whether the error BRANCH exists. Nobody measured whether the message tells the reader anything
they can act on — which is rule 4 applied to the same state.

Measured over the whole app: **104 of 109 load-error messages already read `<what failed> — try again.`**
in both languages. Five stopped at the failure, **and all five failed in BOTH languages**, so there was no
bilingual asymmetry to argue about — just drift. 104-against-5 is what makes it drift rather than a
decision, the same standard the glossary uses.

    consStatusLoadError   dutySegLoadError   emailLoadFailed   insDirLoadError   insListLoadError

All five fixed to the house convention; `dutySegLoadError` also went from passive ("The list … could not be
loaded") to the active form all 104 siblings use, because the shape of the sentence is part of the name.
**Zero screens in this app have a retry CONTROL** — measured — so the sentence is not a nicety a button
makes redundant. It is the only way forward there is.

Guarded by `scripts/measurements/load-error-way-forward.py`, wired into the web unit suite, planted: putting
one message back to its old wording fails the guard reporting **`in ONE language only 1`**, which also
proves the guard reads each language separately rather than whichever half it finds first.

**THE FIRST VERSION OF THIS MEASUREMENT WAS WRONG IN THE COMFORTABLE DIRECTION.** It keyed on
`commonTryAgain`, the shared key, and reported 4 of 102 — true, and useless, because 98 screens use a
screen-specific key and almost all of them say "try again" in their own words. It was measuring which
screens share a string, not which screens help a reader. I had seen `commonTryAgain` on `/leads` and
generalised from one site, which is the same mistake as taking a rule measured at a route guard and
applying it to a screen.

### Rule 7 — two collisions fixed, two senses kept

| Screen | Was | Now | Why |
|---|---|---|---|
| `/sla-policies` | "Discard" | **"Cancel"** | A form-abandon button. `/watchlist-sync` already said "Cancel" for the identical affordance, and the Arabic here already said «إلغاء الإدخال». "Discard" is the withdraw concept's word, and a draft never submitted is not a record raised in error. |
| `/screening-health` | "Discard below" | **"Ignore below"** | A screening THRESHOLD. The matches still exist and are still screened — they are not shown. The screen's own Arabic already said «تجاهل دون», ignore; the English contradicted it. |

Kept deliberately, with reasons now in the glossary: **withdraw** in its fourth sense (a data subject taking
back consent — a statutory act, not the office withdrawing its own record), and **clear** for deciding a
sanctions match is not the person (an AML term of art and a decision about merits, not the closing of a
task — the same kind of exception as "Suspended" as a customer status).

### The three flags that were false positives, and what each taught the detector

Every one was caught by reading, none by the script, and the script now carries all three in its header.

1. **`/audit-trail` — "form below table".** The `<table>` at line 93 is inside `AuditLogTable`, a rendering
   helper defined above `export default`. The formal pass hit this same class on this same screen.
2. **`/audit-trail` — "no error branch".** It has `browseError`, `wfError` and `docError` — three, because
   it loads three independent things. A fixed name list saw none of them.
3. **`/access-recertification` — "no empty state".** It renders one, in the child component
   `RecertificationItemsTable`. The detector now follows local component imports one level deep, which
   fixes the count without making it reliable: a state two components down is still invisible.

`/regulatory-compliance` flagged for rule 1 as well and is the false positive the formal pass already
recorded by hand — its first table is the single current licence rendered as label/value rows, not a list.
Confirmed independently here.

### A STANDING EXCEPTION found while measuring, which must not be "fixed"

Ten screens have **no permission-refusal state**, and on the detail pages among them that is correct and
load-bearing: `claims/[id]`, `leads/[id]`, `policies/[id]`, `prospects/[id]`, `risk-profiles/[id]`,
`insurance-programs/[id]`. They branch on **404**, not 403, and say things like *"No claim with that id is
in your book."*

**A 403 there would disclose that the record exists.** That is the same tenancy property that keeps 18
"may not exist, or you may not have access" strings out of the refusal sweep. Completing rule 3's third
state on a detail page would turn a deliberate ambiguity into an existence oracle, so rule 3's third state
is **n/a by design** on any screen addressed by an id it did not itself list.

## BATCH 5 — the pre-policy pipeline, 23 screens (2026-09-30)

Rules read: **1, 3, 4, 5, 7.**

`crm` · `cross-sell` · `cross-sell/[id]` · `insurance-programs` · `insurance-programs/[id]` ·
`insurance-programs/new` · `leads` · `leads/[id]` · `needs-assessments` · `needs-assessments/[id]` ·
`needs-assessments/new` · `opportunities` · `opportunities/[id]` · `prospects` · `prospects/[id]` ·
`prospects/new` · `rfqs` · `rfqs/[id]` · `rfqs/new` · `risk-profiles` · `risk-profiles/[id]` · `up-sell` ·
`up-sell/[id]`

| Rule | Result |
|---|---|
| **1** — create form above its table | **CLEAN on all 23.** No screen has a form below a table. Several have a form and no table (`prospects`, `rfqs/new`, `risk-profiles`, `needs-assessments/new`) or a table and no form (`rfqs/[id]`, `insurance-programs/[id]`) — n/a, not violations. |
| **3** — four states | **One real gap, fixed** (`insurance-programs/new`). Four other screens flagged and all four are the standing detail-page exception. `prospects/new` has no empty state and is a create-only screen — correct. |
| **4** — refusal names the way forward | Clean; the shared sentence covers it. |
| **5** — delete means deactivate | **CLEAN.** |
| **7** — one action, one name | **CLEAN within the batch.** The 21 hardcoded labels below are rule 6, not rule 7 — the *word* was right, it was just in one language. |

### The one rule-3 gap, and it was measured before it was called live

`insurance-programs/new` had no permission-refusal state while its four sibling create screens all do
(`prospects/new`, `customers/new`, `rfqs/new`, `needs-assessments/new`). Measured before deciding it
mattered, because § 1.61's discipline is to compare who holds the permission against who can open the
screen:

    program.assemble        PLACEMENT alone
    needs-assessment.read   SALES, PLACEMENT, MANAGER, EXEC

**So three roles could open the form, fill it in, and get the API's own English message on submit.** The
button that leads here is gated on the same permission, correctly, so the state is reached by typing the
URL — which makes it rarer, not acceptable. Fixed with the shared refusal.

Its **403-and-404-treated-alike** branch is NOT a defect: the screen loads a needs assessment *by id*, so it
falls under the standing exception recorded in batch 4.

### RULE 6 AGAIN — 21 strings on 14 screens, while the guard read 0 across 102

Found by reading `insurance-programs/new` for something else, and it is the biggest miss this detector has
had. The seventh blind spot is a **bare JSX text line: one English word, no colon** — which every earlier
pattern needed two capitalised words, or a backtick, or a colon to see.

    Cancel ×7   Save ×4   Search ×4   Rename ×2   Edit   Back   Total   Channel   Category

**Fourteen of the twenty-one had a translated key sitting unused in `common.ts`.** `commonCancel`,
`commonSave`, `commonSearch`, `commonEdit`, `commonBack` all existed with Arabic — the screen simply did not
reach for them. That is what makes this drift rather than a missing capability, and it is why an Arabic
reader met "Cancel" and "Save" in English on fourteen screens.

Three keys were genuinely missing and were added: `commonRename` (shared, because three screens render that
button and one of them already had `orgUnitRename` — rule 7), `claColTotal` (matching the established
`*ColTotal` convention rather than inventing a shared `commonTotal` as a fourth way of saying it), and
`crmChannelLabel` (the `crmChannel*` keys in `enums.ts` are channel VALUES; the field's own label did not
exist).

**A COUNTING DEFECT COMPOUNDED IT, and it is the part worth remembering.** The scan's dedupe was
`not any(text == t for _, t in out)` — keyed on the TEXT alone, per file. So a screen with two `Search`
buttons reported one. The first pass said 19; after fixing those 19, **two more appeared** on the same two
screens, and only then was the real total 21. Keyed on `(line, text)` now.

That defect cannot be planted with `scripts/plant.mjs`, and the reason is sound rather than a gap: the tool
refuses an anchor matching more than once, which is exactly the condition this defect is about. It stands on
observation instead — 19 → fix → 2 more surfaced → fix → 0 — which is stronger evidence than a plant anyway,
because it happened rather than being arranged. The blind spot ITSELF is planted: putting one `Cancel` back
kills the rule-6 guard.

**And the first version of the new pattern reported 277 hits on 97 screens** — almost all multi-line code
continuations (`instanceof ApiError`, `message`, `outcomes`). That is the cry-wolf direction, so it was
tightened to require the previous non-blank line to close a tag and not be an arrow function. Both numbers
are in the script's header, because a pattern that has been wrong in both directions is worth documenting in
both.

### A DISAGREEMENT FOR THE OWNER, found by sweeping for role-name checks

`apps/web/app/(app)/settings/email/page.tsx:97` reads

    const seesInternalDetail = !!user && user.roles.includes('SYSTEM_SECURITY_ADMINISTRATOR');

and gates whether the raw API error message is shown. It is **the frontend directive implemented as
written** — the directive reserves implementation detail to the System/Security Administrator, naming a
role. And it is **what the office-scoped RBAC design forbids**: constraint 1, "a role NAME is not an
identity", because two offices may each define their own.

The consequence is display-only — an error message — so nothing is exploitable. But an office that renames
or defines its own administrator role gets different behaviour on that screen, silently.

This is a **fifth disagreement between the directive and what is written in the repo**, and per the owner's
handling of the other four it is hers to settle rather than mine to merge. The two resolutions are a
permission code (`diagnostics.view` or similar, which the directive's intent maps onto cleanly) or an
explicit decision that a role-name read is acceptable for display-only detail. Left exactly as it is.

Two other role-name reads were checked and are fine: `AppNav.tsx:115` orders the nav by role and is the
known, recorded exception ("which business function owns this", not "who may do this"); and
`needs-assessments/[id]`'s `isPlacement` is `hasPermission(user, 'program.assemble')` — correctly
permission-based, just named after a role, which is where somebody later "simplifies" it into a role check.

## BATCH 6 — the administration surface, 17 screens (2026-09-30)

Rules read: **1, 3, 4, 5, 7.**

`bcp-dr-plans` · `documents` · `employees` · `employees/[id]` · `employees/reveal` · `information-assets` ·
`knowledge-base` · `settings/customer-import` · `settings/duty-segregation` · `settings/email` ·
`settings/insurance-lines` · `settings/org-units` · `settings/roles` · `settings/security` ·
`settings/users` · `vendors` · `vendors/[id]`

| Rule | Result |
|---|---|
| **1** — create form above its table | **TWO REAL VIOLATIONS, fixed** — and rule 1 had been reported as *0 violations* by the formal pass. Details below. |
| **3** — four states | **One real gap, fixed** (`settings/duty-segregation`). `settings/security`'s absent refusal is the recorded deliberate one; `vendors/[id]` has no empty state and is a detail page. |
| **4** — refusal names the way forward | Closed by the same fix. |
| **5** — delete means deactivate | **CLEAN.** |
| **7** — one action, one name | **CLEAN.** |

### RULE 1 WAS NOT CLEAN, and the reason is that the pass corrected for the right thing

The formal pass reported **34 comply, 67 n/a, 0 violations**. Two screens were wrong:

    /vendors           onSearchSubmit at 121, TABLE at 149, onCreate at 197
    /employees/[id]    training H2 at 441, TABLE at 445, onRecordTraining at 473

**The pass had documented "a filter form was mistaken for a create form" as a false-positive class and
corrected for it. That correction is what created the blind spot.** Once a filter form is no longer counted
as a create form, a first-form-vs-first-table comparison is *satisfied* by the filter form sitting above the
list — and the create form below it is never examined. Telling the two apart stopped the noise and also
stopped the check looking at the case that matters.

Both fixed by moving the create form above its own table, which is what the pass did for its own four
(`/employees`, `/knowledge-base`, `/information-assets`, `/bcp-dr-plans`). `/vendors` was not among them.

`four-states.py` now compares CREATE-form offsets against table offsets separately, keyed on the submit
handler's name. Swept over all 102: **no other screen has this shape.** Seven screens still flag on the
coarse first-form-vs-first-table rule and all seven are the rendering-helper class — `audit-trail`, three
dashboards, `regulatory-compliance`, `settings/roles`, and `planning-export`, whose first table is inside a
helper and whose `onGenerate` form sits above the results table it produces.

### RULE 3 — the only screen in the app with no 403 branch

`settings/duty-segregation` did `setLoadError(err instanceof ApiError ? err.message : …)` with no permission
case, so a reader got the API's own English message — written for the caller, naming no way forward.

Measured before calling it live, per § 1.61's discipline:

    duty-segregation.mode.declare   OFFICE_ADMINISTRATOR alone
    internal-controls.view          COMPLIANCE, EXECUTIVE, EXTERNAL_AUDITOR

Eight of twelve roles hold neither, and the nav entry is gated on both (OR), so the state is reached by
typing the URL — rarer, not acceptable. Fixed with `permissionRefusalAnyOf`, because the READ genuinely
accepts either code: this is the one place `PermissionsGuard`'s OR semantics are what you want, and telling a
Compliance Officer they need the DECLARE permission would send them to ask for the one control this screen
deliberately withholds from them.

### A SECOND KIND OF THIRD STATE, and it must not be replaced by the shared sentence

The same screen already handled the reader who can SEE the mode but not declare it, and it does something
better than refusing:

> "You can see this setting but not change it. **Whoever declares it is not whoever reviews the acts it
> permits.**"

That explains the DESIGN rather than naming a missing grant — and the design is the segregation principle one
level up, applied to the control that weakens a control. Replacing it with "you do not hold permission to …
— ask whoever manages permissions in your office" would be a downgrade: the reader is not missing a grant
somebody could give them, they are on the wrong side of a deliberate split.

### A GUARD THAT WAS MEASURED AND DELIBERATELY NOT BUILT

The `settings/duty-segregation` fix was planted — disabling the 403 branch — and **all eleven unit guards
still passed**, which establishes that nothing checks for a missing 403 branch. So the next question is
whether one can be pinned, and it was measured rather than assumed:

    screens that catch an ApiError and report it   98
    of those, NO 403 branch                        8   and all 8 are CORRECT

    claims/[id]  leads/[id]  policies/[id]     the standing 404 exception — a 403 would disclose the record
    settings/security                          deliberately ungated, or ten roles can never enrol in MFA
    settings/customer-import  settings/email
    settings/insurance-lines  settings/org-units    refuse CLIENT-SIDE, before the call is made

**A "must have a 403 branch" guard would therefore be eight false positives on its first run** — the
cry-wolf direction, which gets a check switched off rather than fixed. Not built, and the reason is recorded
here so nobody re-derives it. What IS guarded covers the same class from the other side: every code named in
a refusal must exist, no act key may be rendered outside the shared sentence, and every load-error message
must name a way forward.

The four client-side refusals are a latent inconsistency rather than a defect: if a server gate ever moves
away from the code the screen checks, the reader gets the API's raw message. Recorded, not changed.

**So rule 3's third state has two legitimate forms:** name the missing permission where a grant would fix
it, and explain the design where a grant would not. `/settings/security` is a third case again — it renders
nothing, because a reader who came to pair an authenticator has no reason to learn a key inventory exists.
Choose by asking what the reader came for.

## BATCH 7 — the reporting surfaces, 16 screens (2026-09-30)

Rules read: **1, 3, 4, 5, 7.**

`dashboards/claims` · `dashboards/compliance` · `dashboards/executive` · `dashboards/financial` ·
`dashboards/insurer-employee-performance` · `dashboards/policy` · `dashboards/sales` ·
`employee-performance` · `financial-report` · `insurer-performance` · `kpi-dashboard` ·
`planning-export` · `portfolio-analysis` · `profitability-analysis` · `sales-performance` · `sla-dashboard`

These are the screens batch 1 claimed and never recorded. Reading them makes that coverage checkable.

| Rule | Result |
|---|---|
| **1** | **CLEAN.** Four flag on the coarse first-form-vs-first-table rule and all four are the rendering-helper class (`dashboards/claims`, `/compliance`, `/financial`, `planning-export` — their first table sits inside a helper defined above `export default`). Two more needed a judgement, below. |
| **3** | **CLEAN on all 16** — every one has all four states, which is what a reporting surface most easily lacks. |
| **4** | Clean; the shared sentence and the load-error guard cover it. |
| **5** | **CLEAN.** |
| **7** | **CLEAN**, with two judgements recorded below. |

### The rule-1 judgement: an ACTION that appends to a history is not a create form

`employee-performance` and `insurer-performance` each put an `onCompute` form ("Compute now") BELOW a table
headed "History". Read rather than counted, and recorded as **not violations**:

  * the table is a record of past computations, not a list the form maintains;
  * "Compute now" is an action on the report, closer to the dashboards' own controls than to a create form;
  * **the two screens agree with each other**, which is what rules 1 and 7 are ultimately for.

### THE DETECTOR CLASSIFIES 33 OF 77 FORMS, and now says so

Found while checking whether the create-vs-filter rule from batch 6 actually covered this batch. It did not:

    forms in the app carrying an onSubmit handler   77
    classified by the create/filter patterns        33   (22 before this batch widened them)

**The two violations batch 6 found happened to use `onCreate` and `onRecordTraining` — that is luck, not
coverage.** The residue is mostly a bare `submit` (14 screens) or an inline arrow calling it, which carries no
information about the form's kind at all.

So `four-states.py` now prints `(unclassified form — rule 1 UNDECIDED here)` per screen and a coverage line,
because **a zero with 55 unclassified forms behind it is not a clean result, it is an unmeasured one.** 26
screens are undecided by the script; 16 of those have been read by hand in batches 4–6 and rule 1 is decided
for them by the reading. Ten remain, two of which are this batch's `onCompute` pair — judged above. The other
eight fall to batches 8 and 9, and they are now NAMED rather than silently absent.

### Two vocabulary judgements

  * **"Pick an employee or a branch above."** `Pick` reads against the glossary's *search / find* row until
    you read that row: it governs **finding a named thing to attach to a record** — the `EntitySearch`
    control. Choosing from a closed `<select>` is not that. Three screens use `Pick` for exactly this and
    they agree, so rule 7 is satisfied rather than violated.
  * **"Cancelled policies" / "Cancelled at"** on `dashboards/policy` is the cancellation ENDORSEMENT, the
    domain act the glossary already protects when it explains why the withdraw concept could not use «إلغاء».
    Correct as written.

## BATCH 8 — customer service, customers and insurers, 14 screens (2026-09-30)

Rules read: **1, 3, 4, 5, 7.**

`communications` · `complaints` · `customers` · `customers/[id]` · `customers/kyc-queue` ·
`customers/new` · `feedback` · `insurer-directory` · `insurers` · `insurers/[id]` · `insurers/new` ·
`retention-cases` · `service-requests` · `sla-policies`

| Rule | Result |
|---|---|
| **1** | **CLEAN on all 14**, and it sharpened the detector — see below. |
| **3** | **CLEAN.** `customers/new` has no empty state and is create-only. |
| **4** | Clean. |
| **5** | **CLEAN.** `customerStatusSuspended` is the recorded domain-state exception. |
| **7** | **CLEAN**, with two senses recorded and one prose fix. |

### Rule 1 is now DECIDED FOR ALL 102 SCREENS, and the last step was narrowing the flag

Batch 7 left rule 1 "UNDECIDED" on 26 screens because a form's handler name did not say whether it created
or filtered. Reading this batch's five flagged screens showed why that flag was too wide: **every one had a
single form ABOVE its table** —

    communications 142<253   complaints 195<273   feedback 118<196
    retention-cases 136<195  service-requests 141<193

**A form's KIND only matters when a form sits BELOW a table.** If every form is above every table, rule 1
holds whether the form creates or filters, so an unclassified handler there is not an open question. With
that narrowing the undecided set went **26 → 5**, and all five are screens already read by hand:

    documents                batch 6 — later forms belong to sections with no table of their own
    operational-pi-risk      batch 4 — three (form, table) pairs, all correctly ordered
    retention-disposal       batch 4 — three pairs, all correctly ordered
    employee-performance     batch 7 — the onCompute-above-History judgement
    insurer-performance      batch 7 — same

So every screen in the app now has rule 1 decided: by position, by the create/filter classifier, or by a
reading recorded in a batch. That is the first of the seven rules to be closed with a checkable denominator.

### Two senses recorded, because four screens and two screens already agreed

  * **`pick` / `select` for choosing from a CLOSED LIST.** `/insurers/new` says "Pick a company from the
    shared catalogue" and its control is a `<select>`, not a search box — so it is not the glossary's
    *search / find* row, which governs finding a NAMED thing the reader types. Four screens agree.
  * **`dismiss` for declining a suggestion the SYSTEM proposed.** A reconciliation exception is a problem to
    be closed out; a cross-sell suggestion is an OFFER. "Resolve" would claim a problem existed. `/cross-sell`
    and `/up-sell` agree.

### One prose fix

`srIntro` said *"the timer **clears** when the request is fulfilled"* while the same product calls that state
**Resolved** in four places on the SLA dashboard and on `/complaints`. Rule 7 governs action names and a
timer being satisfied is one act; changed to "the timer resolves when". Prose is where a vocabulary decision
quietly acquires a second word, because nobody checks prose against the glossary.

## BATCH 9 — finance, claims, policy and the launcher, 12 screens (2026-09-30) — THE SWEEP IS COMPLETE

Rules read: **1, 3, 4, 5, 7.**

`(home)` · `bank-reconciliation` · `claims` · `claims-analytics` · `claims/[id]` · `client-accounting` ·
`commission` · `insurer-accounting` · `payment-channels` · `policies` · `policies/[id]` · `renewal-cases`

**All 102 screens are now named in a batch.**

| Rule | Result |
|---|---|
| **1** | **CLEAN.** Every form sits above its table (137<190, 140<242, 144<250); the rest have a form or a table but not both. |
| **3** | **CLEAN.** `claims/[id]` and `policies/[id]` have no permission refusal — the standing detail-page exception. `(home)` has neither an error branch nor a refusal, and both are correct: see below. |
| **4** | Clean. |
| **5** | **ONE VIOLATION, fixed** — and it is on a money screen, flagged below. |
| **7** | **CLEAN**, with three senses of *resolve/clear* recorded. |

### `(home)` — rule 3's four states presuppose a data load

The launcher makes **no API call of its own**. It reads `user` from the auth context and renders the cards
that reader can open. So it has no load to fail and no refusal to give: a session failure leaves `user` null
and the screen redirects to `/login`. Both absences are correct, and the general form is worth stating —
**rule 3 applies to screens that LOAD something**, and a screen that loads nothing has no fourth state to be
missing.

### RULE 5 — one screen used both words for one act, and it is a deferred screen

`/payment-channels`:

    pcDisableButton   "Deactivate"      the control
    pcDisabled        "Deactivated"     the state
    pcDisableError    "Could not disable it"        <-- the error for that same button
    pcIntro           "…stays so until it is disabled."

The button performs the act and its own error names it differently. The glossary's first row forbids
*disable* for this concept, so both strings are aligned to the control that performs it. No Arabic change was
needed — «تعطيل» is already the settled term on both.

**FLAGGED, because this screen is inside the owner's money deferral.** The change is two English strings; it
alters no control, no amount, no behaviour and no permission, and the deferral covers the payment-methods
WORK (types, cheque states, offset, net remittance, IBAN, CliQ caps) rather than the copy on the control that
already exists. Leaving a money screen saying both words because it is money-adjacent would be
over-applying the deferral — but it is the owner's to reverse, so it is named here rather than buried.

### Three senses of resolve/clear, all legitimate, recorded so nobody merges them

  * **resolve = close out a flagged item** — `/bank-reconciliation`, claim alerts, invoice exceptions. The
    glossary's word.
  * **resolve = DETERMINE a value** — `claimCoverageUnresolved`: *"coverage at loss date could not be
    resolved"*. Nothing is being closed out; a value could not be worked out.
  * **clear = a payment/refund clearing** — `endorsementRefundAutoCleared`: *"auto-cleared (below
    threshold)"*. Money vocabulary, and the refund really is auto-approved. **Not changed: this one is
    money semantics rather than copy**, and the word is doing work the glossary's *resolve* would not.

`policyRemoveDocRowButton: "Remove"` is also correct — it removes a row from a form before submission, which
is neither ending an entity's active life nor withdrawing a record.

---

## THE SWEEP, CLOSED

    102 screens, batches 4-9, every screen named in this file.

| Rule | State |
|---|---|
| 1 · create form above the table | **CLOSED for all 102** — decided by position, by the create/filter classifier, or by a recorded reading. Two violations found (batch 6) in a pass that had reported zero. |
| 2 · no identifier reaches a reader | **GUARDED** app-wide (`screen-copy.test.ts`), budget 29, ratcheting down. 28 deferred to broker question 16. |
| 3 · four states | **CLOSED for all 102**, with three recorded exception classes: detail pages addressed by an id (404, not 403 — a tenancy property), `/settings/security` (must stay ungated), and screens that load nothing. |
| 4 · every refusal names the way forward | **STRUCTURAL** for permissions (one sentence, 102 act keys, 106 call sites) and **GUARDED** for load errors (109 of 109). |
| 5 · delete means deactivate | **CLOSED** — 3 violations found across batches 3, 4 and 9. |
| 6 · Arabic and English say the same | **GUARDED** app-wide, 0/102 — and the guard has six known blind spots and one counting defect, all recorded in its header. Zero means zero of what it can see. |
| 7 · one action, one name | **CLOSED** — the glossary is 19 rows, every row carrying the disagreement that produced it. |

**What is NOT claimed:** rule 6's zero is bounded by its detector, and the base rate for finding a seventh
blind spot has so far been one per sweep. Rule 2 has 28 known remaining sites, deferred rather than missed.

---

## ~~Not yet surveyed~~ — THE SWEEP IS COMPLETE

**102 screens exist under `app/(app)`** — measured; the "93" this paragraph used to claim was stale, and the
five `(auth)` screens sit outside the count because they render before sign-in and have no permission
concept.

Rules 2 and 6 are GUARDS now (`apps/web/test/screen-copy.test.ts`) and cover all 102 continuously, so they
need no per-batch sweep. Rule 4's permission half is structural for all 102 as well, because every refusal
renders one sentence from `lib/i18n/permission-refusal.ts` that names the grantor — and its load-error half
is guarded by `scripts/measurements/load-error-way-forward.py`.

What remains per-batch is rules 1, 3, 5 and 7, which need a screen read. **Batches 4 through 9 (20 + 23 + 17 + 16 + 14 + 12) name ALL 102 screens** — the coverage is checkable by reading this file, which is the only form of that claim anybody can verify. Rules 1, 3, 5 and 7 are CLOSED; rules 2, 4 and 6 are GUARDED app-wide. See the table at the end of batch 9 for what is and is not claimed. Coverage before batch 4 was reported in conversation and never written here, so it cannot be
substantiated — batch 5 onwards names its screens in this file, which is the only form of that claim anybody
can check.

---

## THE FORMAL PASS — 2026-09-26

Run when the owner called the backlog landed. **103 screens** (the 99 under `app/(app)/` plus the four
`(auth)` screens that render before sign-in), 6,753 user-facing strings.

**The pass is measured where a rule is decidable and read where it is not, and saying which is which is
the first result.** A survey that guesses at rule 4 is worse than one that declares it unmeasured.

`python scripts/measurements/b7-survey.py <out.json>` — a measurement, not a gate.

| Rule | Decidable from source? | Result |
|---|---|---|
| 1 · create form above the table | **yes** | ~~**CLEAN** — 34 comply, 67 n/a, 0 violations~~ — **NOT CLEAN, corrected by BATCH 6**, which found two: `/vendors` and `/employees/[id]`. This pass could not see them *because* it correctly stopped counting a filter form as a create form — once it does that, a filter form above the list satisfies the check and the create form below is never examined. Four were found and fixed here; two more were flagged and are correct |
| 2 · no field asks for an identifier | no | a label reading "Entity id" is greppable, but whether a RENDERED value is an identifier needs the data shape, not the markup. Two known open cases already in the table above |
| 3 · no screen leaves a person facing nothing | **partly** | 80 of 103 branch on all three non-data states. 23 flagged, and the majority are n/a — see below |
| 4 · every refusal names the way forward | no | requires reading the sentence |
| 5 · one word per concept | **yes** | **CLEAN** — one hit, and it is not a violation |
| 6 · Arabic and English say the same thing | no | key parity and code-token parity are already gated by `translations.test.ts`; MEANING is not mechanisable |
| 7 · one action, one name across screens | no | needs the glossary decision per concept, and the record is explicit that a term enters the glossary when two screens are found disagreeing — a judgement, not a grep |

### Rule 1 — fixed, and the check's own limits

**Four real violations, all fixed in this pass** — the create form now sits above its own list on
`/employees`, `/knowledge-base`, `/information-assets` and `/bcp-dr-plans`. Their four Playwright specs
pass 19/19 after the move, including `knowledge-base`'s `input[dir="rtl"]` `.first()` selector, which was
identified as at risk BEFORE the move rather than discovered by it.

**Two were flagged and are CORRECT, which is the more useful half.** The check compares the first form
with the first table, and a multi-section screen has several pairs:

- `/settings/roles` — the first table is the duty-segregation READINESS panel. The create-role form sits
  above the roles list, which is a later table.
- `/regulatory-compliance` — the first table displays the single current licence, not a list. The
  create-item form does sit above the items list.

Both are recorded in the script as verified by hand rather than "fixed", because the screens are right
and the check is coarse. **Anything new in rule 1's output needs the same per-pair reading before it is
called a violation** — my own first count said six, and two of those were this.

**Five false-positive classes were closed getting rule 1 to zero**, and the first four came from reading
the output rather than counting it: a table-rendering HELPER defined above `export default` (which put
`/audit-trail` and three dashboards in the list), a filter form mistaken for a create form, and then the
multi-section pairing above.

### Rule 3 — 23 flagged, triaged by hand

The check is deliberately shallow: does the screen BRANCH on permission, error and empty at all. It does
not judge the wording — that is rule 4, which this does not claim to measure.

**Not applicable, by category:**

- **The four `(auth)` screens** (login, signup, forgot-password, reset-password) and `change-password`
  have no permission concept: they render before sign-in. A permission branch would be meaningless.
- **Create-only screens** (`/customers/new`, `/prospects/new`) have no list, so "empty" is n/a.
- **Detail pages** (`/claims/[id]`, `/leads/[id]`, `/policies/[id]`, `/cross-sell/[id]`, `/up-sell/[id]`,
  `/risk-profiles/[id]`) are one record: "empty" is n/a, and what matters instead is a not-found state.
- `/settings/security` has **no permission branch deliberately, and it is load-bearing**: the screen must
  stay ungated or ten of eleven roles can never enrol in MFA and are locked out of everything. A
  documented exception, not an omission. **This exception now also lives in the directive's own § 1**, by
  the owner's ruling of 2026-09-29 — an absolute rule whose exception is recorded only here gets "fixed"
  by somebody who never reads here.

**RULE 4 GAINS A CARVE-OUT, by the owner's ruling of 2026-09-29 (disagreement 3).** Rule 4 says every
refusal names the way forward; it said nothing about who may see implementation detail, and
`docs/frontend-ux-directive.md` § 2 does:

> *"…never expose internal implementation detail (table names, stack traces, raw exception text) to any
> role other than System/Security Administrator debugging tools."*

**The code already implements the directive**, so the document lacking the rule is the one that was
wrong: `/settings/email` (§ 1.76) states the deployment gap in every reader's own job language and shows
the environment-variable names only to SYSTEM_SECURITY_ADMINISTRATOR. Documents describe what exists.
So this record now carries the carve-out too, and a screen satisfying it is not a rule-4 violation.
- `/settings/duty-segregation` always has a mode to show, so "empty" is n/a.

~~**Genuinely worth reading, and NOT closed here**~~ — **RECLASSIFIED BY THE OWNER, 2026-09-29: these are
UNFINISHED SCREENS, not flags.** The directive is the stricter statement and it wins — *"a screen is not
considered finished if any of the four hasn't been designed and written with the same care as the 'happy
path'"*. They do NOT become a new item: they fold into item 5's by-hand read of every screen, one pass at
wider scope rather than two passes. **The three dashboards are the part that matters and the reason this
is not polish**: rendering zeros where there is no data is a box that lies, which makes it a CORRECTNESS
rule. Each still needs the sentence read, which is rule 4's work:

| Screen | Flag |
|---|---|
| `(app)/page.tsx` | no error branch on the home screen |
| `/leads` | a LIST screen with no empty state |
| `/access-recertification` | no empty state |
| `/customers/kyc-queue` | no empty state |
| `/sales-performance` | no empty state |
| `/dashboards/{compliance,executive,sales}` | no empty state — a dashboard with no data should say so rather than render zeros that read as facts |

### Rule 5 — clean, and the one hit is the interesting part

Exactly one user-facing string contains a glossary-forbidden word: `customerStatusSuspended:
'Suspended'`. **It is not a violation.** The glossary forbids "suspend" as a synonym for ending an
entity's active life; this is a CUSTOMER STATUS — a domain state a customer is in — not the act of
deactivating one. The script cannot make that distinction and does not try to; it reports, and this is
the judgement.

`delete` and `remove` are reported separately as soft hits for the same reason: deleting a role that was
never used is a real, different act the glossary explicitly allows, and removing a grant is not
deactivation.

### What the pass did NOT do

Rules 2, 4, 6 and 7 are **not measured and not claimed**. They need 103 screens read, which is the
remaining work, and the four categories above say what reading them is for. The value delivered here is
that rule 1 is now provably clean, rule 5 is clean with its one judgement recorded, rule 3 has its 23
flags triaged into n/a and a nine-screen read list, and the survey is repeatable with five false-positive
classes already paid for.
