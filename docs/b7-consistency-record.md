# B.7 — the consistency record

**This is the running record, not the pass.** The formal survey happens after the remaining backlog items
land, because fixing screens before they settle means fixing them twice. What goes in here is every
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
| insurance lines | 2 | `POST`/`PATCH /insurance-lines` have no web client function at all. The permissions exist, the routes exist, no screen does. | OPEN — unreachable surface |
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
| the combined-duty reason box | 6 | The reason field IS the gate: the button is disabled until ten characters are typed, and there is no separate "are you sure" step to click through without reading. Same treatment the discard control already gets, for the same reason. | **[SATISFIED]** asserted on nine characters, not only on zero |

---

## Not yet surveyed

Everything else. 93 screens exist; the ones above are the ones passed through while doing other work. The
formal pass produces the full table — one row per screen, one column per rule, deliberate exceptions written
down **with their reason** rather than left blank.
