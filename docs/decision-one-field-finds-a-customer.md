# One field finds a customer — and how two of the owner's own decisions were reconciled

**Decided 2026-10-01, by the owner, after running the system herself.** Built the same day.

## What she found

Every screen needing a customer showed a **search box AND a separate select below it**. Her words:

> this is right but it is not practical.

Both halves of that are load-bearing. The two-field shape was a correct fix to a real defect — ten
forms had asked for a raw `customerId`, which nobody knows, so the only way to fill one in was to open
another screen and copy a uuid out of the address bar. It solved that and was still two controls for one
decision, the second only usable after remembering to use the first.

## The decision

One field. Type a name, matching names appear, pick one.

**Scope: 11 screens, not the 7 she named.** Her list was examples and she said so — *"and the same for
every page that needs this design"* — so the inventory was measured rather than transcribed:
`service-requests`, `complaints`, `communications`, `feedback`, `retention-cases`, `consent`, `dsr`
(hers), plus `payment-channels`, `retention-disposal`, `transaction-monitoring` and `audit-trail`.
Taking the list as the inventory would have left four screens behind and reported the work as complete.

Seven other screens pair a text input with a `<select>` and are **not** instances: all seven are
filters (`status`, `channel`, `lineCode`, `vendorType`, `activeOnly`), and `needs-assessments/new` takes
its customer from the URL. The pattern lives in exactly one component, which is why no call site
changed.

## THE TENSION BETWEEN TWO OF HER OWN DECISIONS, AND HOW IT WAS RESOLVED

This is the part worth keeping, because the same shape will recur.

Two prior decisions pulled in opposite directions:

* **The narrow employee search** (IMPROVEMENTS § 1.83) was granted on four conditions whose whole
  purpose is to stop a find-a-person field decaying into a staff directory: nothing before a floor of
  characters, a bounded result set, nothing on an empty query, every search recorded.
* **One field that completes customer names** is, by construction, closer to a directory than the
  two-field version it replaces — it answers as you type, with no deliberate act of submitting.

Resolved **not by choosing between them but by carrying the first's conditions into the second.** Both
stand. The usability decision is delivered in full, and the anti-browsing decision is applied to a
second entity for the first time rather than being treated as local to employees.

The floor differs — **three characters for customers, two for employees** — and that is not an
inconsistency to tidy away. The number is a judgement about how much of *that* set one keystroke may
return: an office's staff list is tens of people, its customer book is the whole of its business. Per
entity, by decision, which is why `minChars` lives on the SOURCE and not in a shared constant.

## How the four conditions are enforced

**On the server, all four.** A condition only the client enforces is a condition the next client
forgets, and this field's only real risk is becoming a customer directory by increments.

| condition | where |
|---|---|
| nothing before three characters | `SearchCustomersDto` — mandatory `q`, trimmed, `@MinLength(3)` |
| a bounded result set | `CUSTOMER_SEARCH_MAX_RESULTS = 10`, a *required* repository argument |
| nothing at all on an empty query | the same mandatory `q` — the route has no unfiltered mode |
| every search recorded | an audit row that is **not** `safeAudit` |

**The audit row is deliberately not best-effort.** Every other audit call on `CustomerService` is, because
losing the record of a contact correction is worse than failing the correction. Here the record of who
searched for whom IS the control, so a failure to write it fails the request. Same decision, same
sentence, as `EmployeeService.search`.

**A second route, not a filter on the list.** `GET /customers` has an unfiltered mode and must keep it —
`/customers` is a paged register somebody browses on purpose. Applying the conditions there would have
broken that screen. So `GET /customers/search` stands beside it exactly as `GET /employees/search`
stands beside `GET /employees`: one route per intent, each enforcing its own.

**The previous field met none of the four for customers.** It searched once on mount with an EMPTY term,
which returns the first page of the whole book, and nothing recorded it — so opening `/complaints` put
a list of customers on screen before anybody typed anything. The conditions do not tighten the old
field; they reverse its default.

## The identifier half: delivered for a company, NOT for a person

Her requirement: *"It must also accept an identity number or a phone number, because a clerk holding a
document knows the number and not the spelling."*

**Delivered** for the commercial registration number and the tax registration number — both stored in
the clear, matched as a case-insensitive PREFIX (a *contains* on a number turns every three-digit
fragment into a wide scan, which is condition 1 defeated by the thing meant to satisfy it).

**WITHDRAWN** for an individual's national ID or anyone's phone number — by the owner, the same day,
and the reasoning is the part to keep.

Those columns are encrypted with a **random IV per value** (`randomBytes(12)`), so the same national ID
stored twice is two different ciphertexts: there is no equality to test and nothing to prefix-match.
Making them searchable means a **guessable encoding of a Highly Confidential field**, which is precisely
what the masked national ID exists to refuse.

**And the thing the requirement missed: the document in the clerk's hand carries the NAME too.** Nobody
was ever blocked. The requirement was a convenience, and a convenience does not buy a weakening of that
field's protection.

So the clerk's case is served for a company and deliberately not for a person. The limit is asserted by
a test, which now pins a DECISION rather than a pending gap — if that assertion ever starts failing, the
encryption posture changed and that has to be a decision rather than a side effect.

**A different question stayed**, and it is a need rather than a convenience: does the system prevent the
same person being registered twice? It hits the same encrypted column and has nothing to do with search
comfort. Measured in `docs/customer-duplicate-prevention-measured.md` — **there is no duplicate
prevention on customers at all**, and the PDPL consequence is the heavy one.

## The chosen customer displays as a NAME

Her third requirement, and the one that would have quietly undone rule 2 of the consistency sweep while
fixing the usability: an identifier echoed back into the field is an identifier rendered at a reader.

The field shows the name. The identifier appears only on an **option line**, where it is what tells two
companies of the same name apart — and what a person searching BY a number needs echoed back to confirm
the right record came up.

**One interaction, now SETTLED rather than watched**: the item-4 decision to mask the corporate
identifier was reversed the same day — a company's registration number is public, so masking it is
theatre at the cost of searching and screening on it. The option line stays exactly as it is, and it is
no longer the loose end it was written as.

## Keyboard and a11y

The two-field version used a native `<select>` **because** it carries ARIA roles, focus management and
keyboard handling for free in both reading directions. That argument was right, and merging the controls
gives it up — so the behaviour is now explicit and asserted rather than inherited: `role="combobox"`
with `aria-expanded`/`aria-controls`/`aria-activedescendant`, arrows to move, Enter to pick, Escape to
close without choosing, Home/End to jump.

`entity-search.spec.ts` drives the whole flow **with no mouse**, because a combobox is the easiest
control in a UI to make unreachable and the a11y suite would not catch it: axe checks roles and labels,
not whether a key does anything.

## What the build itself found

**A search is a shortcut to the list, so it must disclose no more than the list.** The owner filter sits
OUTSIDE the `OR` in the repository query: inside it, a registration-number match would ignore the filter
and hand a Sales officer a colleague's customer. Asserted from both directions — the colleague cannot
find it by name OR by number, the owner can, and a holder of the all-owners read can.

**"The search failed" and "nobody matches" were collapsing into one another**, caught by this change's
own e2e: the failure path set `results = []`, which is how "nobody by that name" is represented, so the
field said both at once and a server fault read as a customer who does not exist.

**And the first fix to that was two guards where one was unprovable.** It also added `error === null` to
the render condition, which read as belt and braces and was dead code — `setError` is non-null only in
the catch, which nulls `results` in the same breath. The PLANT for that line killed nothing, which is
how the dead guard was found. One mechanism a plant can reach beats two where one is unreachable.

**One string had to be widened**: `customerPickerNoMatches` said *"No customer matches that name"*, which
is wrong for half of what can now be typed — a clerk searching a registration number would be told no
customer has that *name*.

## Five plants, each killing its own named test

`scripts/plants/entity-search-one-field.json`, committed, and covered by `plant.mjs --self-test` so a
stale anchor fails the build:

| plant | what dies |
|---|---|
| the three-character floor removed | the field searches on one character and on an empty term |
| the field pointed back at `GET /customers?search=` | all four conditions defeated at once, screen unchanged |
| the chosen customer displays its registration number | the name assertion, with REG-2 where a name belongs |
| arrow keys stop moving through options | keyboard-only operation; the mouse path still works |
| the failure path sets `[]` again | the error and no-matches states conflate |

## What is NOT in this decision

* The **individual** national ID / phone search half — above, with the owner.
* The **28 (now 29) rendered-identifier sites** — a different defect with a different fix, and a
  separate measurement; they are broker question 16.
* The **32 TYPED-identifier inputs on 20 screens, 9 of them `required`** — screens that cannot be used
  at all without pasting a uuid, found while measuring item 2 of the same message
  (`scripts/measurements/typed-identifier-inputs.py`). The field built here is the fix for them, pointed
  at a different entity, and NONE of them was touched: the owner sets the order.
