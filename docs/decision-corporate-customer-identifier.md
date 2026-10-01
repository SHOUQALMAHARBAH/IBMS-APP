# The corporate customer's official identifier — measured before building

**Owner decision taken 2026-10-01**, after she confirmed the INDIVIDUAL case works as agreed. **Nothing
built. The individual case is untouched.**

## Her decision, restated

A corporate customer carries an official identifier that **mirrors the individual behaviour exactly** —
captured, masked, revealed only with a written justification, every reveal logged as a sensitive read —
and it joins the screening determinants. Not a new pattern; the same one.

Which number (national establishment number, commercial registration number, or both) goes to the
broker as part of question 12.

## ONE CORRECTION TO THE PREMISE, and it changes the size of the work

Her finding was that *a corporate customer shows no identifier at all.* **It shows one.**

* `registrationNumber` is **REQUIRED** for CORPORATE creation (`@ValidateIf` + a 1–100 length), the
  create wizard asks for it, the API returns it, and `/customers/[id]` renders it.
* `taxRegistrationNumber` is also captured, optional, and **displayed nowhere** — write-only today.
* Both are stored **in the clear**. Neither is masked, neither has a reveal control.

So the specification gap she identified is real — nothing anywhere states what identifies a company —
but the FIELD is not missing. That makes her decision **smaller than adding a field**: it is giving an
existing, already-required, already-populated column the treatment the national ID has.

It also means something worth knowing before any screen is touched: **every corporate customer in the
system already has this number on file**, so a masking change has data to mask from day one and no
backfill question.

## What the system captures for a corporate customer today

| field | required? | stored | shown on the detail page? |
|---|---|---|---|
| `legalName` | yes | clear | yes, as the heading |
| `registrationNumber` | **yes** | **clear** | **yes, unmasked, no reveal** |
| `taxRegistrationNumber` | no | clear | **no — captured and never displayed** |
| `registeredAddress` | yes | clear | yes |
| `natureOfBusiness` | yes | clear | yes |
| `dateOfBirth` / `nationality` | n/a | — | individual only; a company has none of its own |
| `nationalIdEnc` | n/a | — | refused by construction on the corporate form |

## Does the screening path treat a corporate customer differently? YES — and this is the finding

`buildScreeningSubjects` (one function, two callers, so the screening and the change-fingerprint cannot
drift) builds a company as:

```
subjectRef:  customer:<id>
fullName:    legalName
entityType:  'organization'
dateOfBirth: null      <- correct: belongs to the natural persons behind it
nationality: null      <- correct: same
```

**No identifier is passed at all.** So:

| | determinants a match is weighed on |
|---|---|
| an INDIVIDUAL | name + date of birth + nationality (three), plus a national ID held encrypted |
| a CORPORATE | **name. One.** |

The null date of birth and nationality are correct and the code says why — those belong to the UBOs, and
the UBO subjects carry them. But the consequence is that **a company is screened on its name alone**,
against a list the module's own comment calls the single largest source of false positives when matching
by name only. That is the measured basis for broker question 12, and it is the half of her decision with
the most consequence.

**And it is not a one-line change.** `ScreeningSubject` — the provider contract — has **no identifier
field**. Adding the corporate number to screening means changing that contract and every provider that
implements it, not adding a column. Worth knowing before the work is scoped.

## Is there an existing field that could serve?

**Yes, two**, and the choice between them is the broker's (question 12):

* `registrationNumber` — the commercial registration number. Already required, already populated,
  already displayed. Also already **searchable**: it is one of the two columns the new one-field
  customer search matches on a prefix, which is what lets a clerk holding a document find a company by
  its number.
* `taxRegistrationNumber` — captured, optional, displayed nowhere.

**Jordan's national establishment number is NOT a column today.** If the broker names that as the
official identifier, it is a new field; if he names the commercial registration number, it is a
treatment change to an existing one. The two answers have very different costs, which is why the
question should not be pre-empted.

## THE TENSION THIS CREATES WITH TWO THINGS SHIPPED THE SAME DAY

Named here because they are the places masking would have to reach, and both are easy to miss:

1. **The one-field customer search shows the registration number on an option line**
   (`docs/decision-one-field-finds-a-customer.md`). That is deliberate — it is what tells two companies
   of the same name apart, and what a person searching BY the number needs echoed back. If the number
   becomes masked and reveal-gated, **this is the one place it would still be rendered in the clear**,
   and it would have to change with it. It would also remove the only disambiguation that line has.
2. **The search MATCHES on it.** Masking is about display, not storage, so a prefix match on a cleartext
   column survives masking — but if the decision ever moves the number into an encrypted column (as
   `nationalIdEnc` is), the search by number **stops working**, because the IV is random per value. The
   clerk's case would then be lost for companies as well as for people.

So the decision has a hidden fork: **mask the display and keep the column cleartext** (the search keeps
working, the number is still at rest in the clear) **or encrypt it like the national ID** (the stronger
privacy posture, and the number becomes unsearchable). The individual case took the second. Mirroring
"exactly" therefore has to say which of the two "exactly" means.

## The permission question she raised

Her inclination: the same permission, `customer.national-id.reveal` — same sensitivity, same actor, no
reason to grow the catalogue.

**Measured, and I found no reason it cannot be the same code:**

* The customer reveal is already split **PER FIELD, not per route** — `POST /customers/:id/reveal-field`
  takes the field name and the gate is checked inside the service. A second field slots in with no new
  code and no new route.
* The holder is the same: `customer.national-id.reveal` is held by COMPLIANCE_OFFICER alone.
* The audit trail already records which FIELD was revealed, so one code does not blur two reveals in the
  log.

The only argument the other way is the code's NAME — `customer.national-id.reveal` reads as being about
a national ID, and an administrator granting it would not expect it to cover a company's registration
number. That is a naming problem, not a capability one, and the honest fix if it matters is to rename
the code rather than to add a second.

## What is NOT done

Everything. This is the measurement she asked for, and it stops here. The individual case —masked
national ID, written justification, logged reveal — is untouched and must stay that way: she has now
seen it behaving correctly on screen, which is the strongest evidence this system has for any of its
privacy controls.
