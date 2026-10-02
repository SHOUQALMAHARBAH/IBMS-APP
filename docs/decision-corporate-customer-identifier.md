# The corporate customer's identifier — NOT masked. A unique key, and a screening determinant.

**REVERSED 2026-10-01, the same day it was taken.** Nothing has been built under either version.

## What this replaces, and why the first version was wrong

The first decision was to mirror the national ID exactly: captured, masked, revealed only with a written
justification, every reveal logged. It was proposed on a recommendation and approved on it, and it was
wrong.

**A company's registration number is PUBLIC.** Jordan's Companies Control Department lets anyone look it
up. Masking it hides a number any person can query, at the cost of searching on it and screening against
it — theatre with a real price.

### The rule behind the reversal, which is the part to keep

> **A field's protection is derived from the nature of the fact it holds, not from sitting next to a
> sensitive field.** "Treat it the same" across two fields of different nature produces theatre at a
> real cost.

The national ID and the registration number sit in adjacent columns on the same screen and are facts of
opposite kinds: one identifies a natural person and is Highly Confidential; the other identifies a legal
entity and is on a public register. Proximity suggested symmetry and symmetry was the error.

**The same error is available in reverse**, and reversal 3's scoping below finds it already latent: a
public registration number placed behind `ScreeningProviderConfig.sendIdentifiers`, a flag that exists to
protect Highly Confidential identifiers, would be the same category mistake with the signs swapped.

## The decision

For a company what matters is not confidentiality, it is **UNIQUENESS**.

1. **It stays visible**, as it already is on `/customers/[id]` and on the one-field search's option line.
2. **It becomes the company's unique key**, under the canonicalisation discipline already applied to
   insurer names — so the same company cannot be registered twice under a different spelling.
3. **It joins the screening determinants**, so a corporate screening stops resting on the name alone.

**The tax registration number is NOT public, is displayed nowhere today, and that stays as it is.**

Which number is the official one — Jordan's national establishment number, the commercial registration
number, or both — remains broker question 12. The establishment number is not a column today, so that
answer decides between a treatment change and a new field.

## What is already true, measured

* `registrationNumber` is **required** for CORPORATE creation, populated on every corporate customer,
  returned by the API, rendered unmasked on the detail page, and already **searchable** — it is one of
  the two cleartext columns the one-field customer search prefix-matches.
* So items 1 and the search half of 2 need **no work at all**. What is missing is the uniqueness and the
  screening.

## SCOPING THE SCREENING CHANGE — and a correction to my own earlier report

**I reported that `ScreeningSubject` has no identifier field at all, making this a provider-contract
change rather than a column. That was wrong.** The contract already carries two:

```ts
export interface ScreeningSubject {
  subjectRef: string;          // correlation only, never sent to a provider
  fullName: string;
  aliases?: string[];
  entityType: 'individual' | 'organization';
  dateOfBirth?: string | null;
  nationality?: string | null;
  country?: string | null;
  /** Highly Confidential. Only sent to a provider configured to receive it —
   *  see `ScreeningProviderConfig.sendIdentifiers`. */
  nationalId?: string | null;
  passportNumber?: string | null;
}
```

So the interface change is **one optional field**, not a contract rewrite. The real work is elsewhere,
and the measurement found three things that matter more than the field:

### 1. THE CONTRACT'S IDENTIFIER FIELDS HAVE NO PRODUCER — for anybody

`buildScreeningSubjects` populates `fullName`, `entityType`, `dateOfBirth` and `nationality`. It sets
**neither `nationalId` nor `passportNumber`**, for an individual or for a UBO. Measured: zero producers.

So the corporate case is not uniquely deprived — **no subject this system screens carries an identifier
at all.** The company's name-only screening is the visible instance of a gap that covers every subject.

### 2. THE PROVIDER ACTUALLY IN USE READS NO IDENTIFIER

| provider | identifier handling |
|---|---|
| `built-in-watchlist` — **the one in use** | matches on `fullName` only; reads no identifier field |
| `on-premise` (Yente) | `if (config.sendIdentifiers) props.idNumber = [subject.nationalId]` |
| `commercial` | the same, spread into the request body |

**Adding a field to the contract changes nothing until the matcher reads it.** The built-in provider is
where the uniqueness and screening benefit is actually bought, and it is the larger half of the work —
a registration-number comparison is an exact-match branch beside a fuzzy-name one, with its own
`matchedAttributes` entry so a reviewer can see which identifier agreed.

### 3. `sendIdentifiers` DEFAULTS TO FALSE, AND THE REGISTRATION NUMBER MUST NOT SIT BEHIND IT

`envBool(SCREENING_ENV.sendIdentifiers, false)`. That flag exists to stop a Highly Confidential
identifier leaving the building for a provider not configured to receive it. A public registration number
has no such need, and putting it behind that flag would make the corporate screening silently
name-only in every default deployment — the same category error as masking it, with the signs swapped.

So the field is sent unconditionally, and the flag keeps governing exactly the two fields it was built
for. **This follows directly from the rule behind the reversal**, which is why the rule is worth having
rather than the individual calls.

### What the change therefore involves, in order of size

| | work |
|---|---|
| 1 | **the built-in provider's matcher** — an exact-match branch on the identifier, a `matchedAttributes` entry, and tests. The largest part, and the part that buys the benefit. |
| 2 | **`buildScreeningSubjects`** — populate the new field. One function, two callers, and they must agree exactly or the change-fingerprint drifts from the screening (the reason that function exists). |
| 3 | **`ScreeningSubject`** — one optional field, outside the `sendIdentifiers` gate, with a comment saying why it is outside. |
| 4 | **the two external providers** — map it, also outside the gate. |

And a question the scoping raises rather than answers: **the same change would let an individual's
screening carry a national ID**, since the contract field exists and has no producer. That is a
different decision — a Highly Confidential value leaving for a provider — and it is governed by
`sendIdentifiers` precisely because it is. It should not be swept in alongside the public number.

## Nothing built

Reported and stopped, as instructed. The uniqueness half connects to
`docs/customer-duplicate-prevention-measured.md`: for a company, the registration number is the key the
insurer pattern can be applied to directly, because it is in the clear. For a person it is not, and that
is a separate decision.
