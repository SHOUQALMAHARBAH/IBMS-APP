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

---

## Not yet surveyed

Everything else. 93 screens exist; the ones above are the ones passed through while doing other work. The
formal pass produces the full table — one row per screen, one column per rule, deliberate exceptions written
down **with their reason** rather than left blank.
