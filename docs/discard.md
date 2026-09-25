# Discard — a record raised in error

**Read this before adding a fifth discardable entity, before adding a query over one of the four, and
before changing a partial index on any of them.**

Class B piece 1. Four models can now be marked as raised in error: `Policy`, `Claim`, `Endorsement`,
`Recommendation`. The source of truth for which, and for when each stops being discardable, is
`apps/api/src/common/discard.config.ts` — this document is the reasoning around it, not a second copy of it.

---

## 1. The trap this removes

Measured across four modules before building: **there was no route out of any pre-commitment state.**

The sharpest case is the endorsement. A broker raises one against the wrong policy — the wrong client, even
— and the only exit was to walk it forward to `APPLIED`, which changes a real policy, its premium and its
commission, and then correct it with a second endorsement. **To undo the mistake you had to commit it
first.** A first bad keystroke was permanent, and the correction left two real financial events in the
record where nothing should have happened at all.

The same shape, less sharply, on the other three: a policy placed against the wrong opportunity, a claim
notified against the wrong policy, a recommendation drafted from the wrong quotation. Each one sat in its
list forever, indistinguishable from work in progress.

## 2. What a discard IS

- **A STATE, not a deletion.** Three columns — `discardedAt`, `discardedByUserId`, `discardedReason` — and
  nothing else changes. The status stays exactly where it was.
- **Terminal.** It cannot be repeated, reversed or edited. Somebody who needs a correct record creates one.
- **Reasoned, mandatorily.** At least 10 characters of trimmed text. Who and when are recoverable from an
  audit row; *why this record should never have existed* is not, which is what makes the reason the one part
  that must be captured at the moment it is still known.
- **Pre-commitment only.** Each entity has its own point of no return and its own refusal naming it.

### The status is deliberately NOT rewritten

There is no `DISCARDED` status on any of the four. A discarded Policy is `PLACEMENT_CONFIRMED` forever.

Two reasons. A `status` in this system is a position in a workflow, and "raised in error" is not a position —
it is a statement about the whole record. And rewriting the status would silently change the shape of every
status-keyed report ever written against these models, which is a much larger blast radius than adding a
column nothing reads yet.

The cost of that choice is § 3, and it is the part most likely to be got wrong next time.

## 3. THE RULE FOR READERS: in its own register, out of every derived view

Because the status is unchanged, **every existing query that reasons about a pre-commitment status was
answering with withdrawn records the moment the columns existed.** All 31 reads over the four models were
enumerated; seven were wrong and now filter `discardedAt: null` (IMPROVEMENTS § 1.55 lists them).

The rule that decided each one:

> A discarded record **stays in its own register** — the entity's own list, and the count that pages it — and
> **leaves every derived view**: dashboards, ageing reports, performance ratios, the 360° timeline, and any
> "is there one of these in flight" check.

It stays in its own register for the same reason a deactivated insurer stays in the insurer list: hiding it
reads as deletion, and the register is where somebody looking for the mistake goes. It leaves the derived
views because those answer questions about the business, and a record that never took effect is not part of
any answer.

**When you add a query over one of these four models, answer one question: can a row in the discarded state
reach this, and is the answer it gives still true?** The state is pinned per entity (see
`discard.config.ts`), so this is decidable rather than a guess.

### The database half, which is easy to miss

`Endorsement_one_live_cancellation_per_policy` is a partial UNIQUE index. Its original predicate was
`changeType = 'cancellation' AND status <> 'CLIENT_NOTIFIED'` — and a discarded endorsement can never reach
`CLIENT_NOTIFIED`, because a discard is terminal. So a withdrawn cancellation would have occupied that
policy's one live-cancellation slot **permanently**, and the only exit would have been to apply the
cancellation nobody wanted: the trap of § 1, rebuilt by the fix for it.

Migration `20261027120000` adds `AND "discardedAt" IS NULL` and asserts the predicate in its own `DO` block,
because `db:divergence` does not see partial indexes. **Any partial index on a discardable model needs the
same question asked of its predicate.**

## 4. Where "cannot advance" is enforced — two places, deliberately

**Policy, Claim, Endorsement:** in `WorkflowTransitionService.transition`, which every forward move of those
three passes through. One guard, not three: a terminal-state rule copied into three services is three
chances to forget one, and the forgotten one would be the one that mattered. It reads the column defensively
(the engine serves eighteen entity types) but decides WHETHER to look from `discardableEntity(entityType)`,
so a renamed column cannot turn the guard off silently.

**Recommendation:** in its own service, on `approve`, `discloseConflictOfInterest` and `send`. It has no
`status` column and drives the *Opportunity's* transitions rather than its own, so there is no chokepoint to
guard. `discard.config.ts` records `advancesViaWorkflowEngine: false` against it precisely so a reader does
not assume the engine covers all four.

Both refusals name the discard. "Cannot transition from X to Y" would be true and would send the reader
looking for a status problem that is not there.

## 5. The layers under the reason, and what each is for

| Layer | Gives | Exists because |
|---|---|---|
| `DiscardDto` `@Length` | 400 naming the field | a round trip to learn a mandatory field is mandatory is a worse screen |
| `assertDiscardable` | 422 explaining what the reason is for | one place decides for all four, so the floor cannot drift between them |
| CHECK per table | the write fails | a caller that skips application code still cannot write a discard nobody can read |

The middle layer also owns the commitment rule and the already-discarded 409. It does **not** own the
permission: that is `@RequirePermissions('<entity>.discard')` on the route, one code, because
`PermissionsGuard` ORs what it is given and a second code there would weaken the gate rather than tighten it.

The write itself is a status-conditional `updateMany` re-asserting `discardedAt: null` in each repository —
so two people discarding the same record at once do not have the second silently overwrite the first one's
reason (`race-safe-invariants.md`). A count of 0 is a 409 that says so.

## 6. Permissions

Four codes, 206 → 210: `policy.discard`, `claim.discard`, `endorsement.discard`, `recommendation.discard`.

Each is granted to exactly the roles that can RAISE that record — whoever can make the mistake can withdraw
it, and nobody else gains anything. `claim.discard` therefore goes to Sales and Claims; the other three to
Placement.

**A consequence for tests:** no seeded role separates a discard code from its create code, so a seeded token
cannot tell a route gated on one from a route gated on the other — the § 1.51(d) trap. `discard.e2e-spec.ts`
builds roles holding exactly the codes named, the same way `four-action-separability.e2e-spec.ts` does.

## 7. The audit action

`AuditAction.DISCARD`, new. `DELETE` would be a lie — the row is still there — and `UPDATE` would make
withdrawing a wrongly raised endorsement indistinguishable, in a filtered audit list, from correcting its
premium. The feature exists so that a record raised in error is legible as an error afterwards; an action
name that erases that distinction gives it up at the last step.

## 8. On screen

One control, `components/ui/DiscardControl.tsx`, wired into all four sections (plus `DiscardedNotice`, which
is what a withdrawn record says about itself wherever one is listed). What differs per entity is the
`discardable` boolean the section computes from that entity's commitment rule.

The reason field IS the confirmation — there is no separate "are you sure" step to click through without
reading — and the Arabic wording never uses **«إلغاء»**, which in this product means a *cancellation
endorsement on a live policy*. «سحب» throughout, the back button included; that is where the collision would
otherwise slip in unnoticed.

## 9. Adding a fifth discardable entity

1. Add it to `DISCARDABLE_ENTITIES` with its permission, its commitment rule, its refusal, and whether it
   advances through the workflow engine. If it does not, guard its forward moves in its own service and say
   so in the entry.
2. Migration: the three columns, plus an all-or-nothing CHECK (`discardedAt`/`By`/`Reason` together or none,
   reason length measured on `btrim`), plus an index on `discardedAt` if anything filters on it.
3. Seed the permission to exactly the roles that can create the record. Regenerate
   `apps/web/e2e/fixtures/role-permissions.ts`.
4. **Do § 3**: enumerate every read of that model and answer the question there, per read. This is the step
   that is cheap now and expensive later.
5. **Check every partial index and unique constraint on the model** for a predicate that a permanently-stuck
   row would occupy.
6. Route, service method, repository conditional write, view projection (`discardView`), screen control.
7. Prove it the way `discard.e2e-spec.ts` does — create, discard, read the row BACK; every forward move
   refused; the committed record refused; nothing downstream touched, read from the database.
