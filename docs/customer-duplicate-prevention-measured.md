# Does the system stop the same person being registered twice? Measured

**Measured 2026-10-01. NOTHING BUILT.** The owner withdrew the identity-number SEARCH requirement and
kept this question, correctly separating the two: a search is a convenience, duplicate prevention is
data integrity. They collide on the same encrypted column and they are not the same ask.

## THE ANSWER: there is none. Not for a person, not for a company.

Asked of the **database** rather than of `schema.prisma`, because this repo's own divergence gate is
blind to partial indexes and CHECK constraints — the two shapes a duplicate rule is most likely to take.

Every index and constraint on `Customer`:

```
CREATE UNIQUE INDEX "Customer_pkey"            ON "Customer" (id)
CREATE UNIQUE INDEX "Customer_prospectId_key"  ON "Customer" ("prospectId")
CREATE INDEX        "Customer_legalName_idx"   ON "Customer" ("legalName")
CREATE INDEX        "Customer_organizationId_idx"
CREATE INDEX        "Customer_status_idx"
CREATE INDEX        "Customer_searchVector_idx" USING gin ("searchVector")

CHECK Customer_dateOfBirth_not_future   -- a date, not an identity
CHECK Customer_nationality_iso3166      -- a format, not an identity
```

**Two unique indexes, and neither is about the person.** `Customer_pkey` is the row's own id.
`Customer_prospectId_key` stops one PROSPECT becoming two customers — a pipeline rule, not an identity
one, and it is `NULL` for every customer onboarded directly, which is most of them.

`legalName` carries a plain index for lookup speed. **Nothing unique. No canonicalisation. No key on the
national ID, the registration number, or any combination.**

**The application layer does not compensate.** `CustomerService.create` throws exactly one
`ConflictException`, and it is about the prospect:

> `Prospect ${dto.prospectId} has already been converted to a Customer.`

No `findFirst`, no existence check, no name comparison. **And the BULK IMPORT does not dedupe either** —
`legacy-import.service.ts` contains no duplicate check of any kind, which is the path that would create
duplicates at volume: an office importing its back-book twice writes every customer twice.

## The same hole in two neighbours

| model | duplicate prevention |
|---|---|
| `Customer` | **none** |
| `UltimateBeneficialOwner` | **none** — same two format CHECKs, no unique at all |
| `Employee` | **none** — no unique on the national ID either |

So the same natural person can be registered twice as a customer, twice as a beneficial owner, and twice
as an employee.

## WHAT THE INSURER REGISTRY DOES, which is the discipline to copy

The owner's framing was right: the insurer registry refuses a duplicate under a different spelling, and
customers do not.

```
CREATE UNIQUE INDEX "Insurer_one_local_company_per_org"
  ON "Insurer" ("organizationId", "canonicalName")
  WHERE ("insurerMasterId" IS NULL)
```

`canonicalName` is a `STORED GENERATED` column over `canonical_name_key(text)`, an `IMMUTABLE` SQL
function (migration `20261013100000`). The application **cannot write it**, so the key cannot be bypassed
by a service bug, and the TypeScript mirror of that function exists only for mid-registration
suggestions — pinned by a 39-name parity table.

That function is already Arabic-correct by measurement rather than by intent: `lower()` and
`[^[:alnum:][:space:]]` are destroyed by a C ctype (every Arabic letter becomes punctuation and every
Arabic name keys to the EMPTY STRING), so both are enumerated folds; Arabic punctuation is stripped
while the Arabic letter ranges are kept; Arabic-Indic digits are folded both ways; presentation forms
are normalised through NFKC innermost so the tatweel it emits is still stripped.

**So the hard part is already built and tested.** What does not exist is any use of it outside the
insurer tables.

## WHY A PERSON IS HARDER THAN A COMPANY, and this is the part that needs a decision

For a **company**, the owner's reversal 2 already names the key: the registration number, public and
unique by construction at the Companies Control Department. A partial unique over
`(organizationId, canonical_registration_number)` is the insurer pattern applied directly, and the
number is in the clear so the index is possible.

For a **PERSON**, every candidate key is a problem:

| candidate | why it does not work as it stands |
|---|---|
| `nationalIdEnc` | **encrypted with a random IV per value** — two rows holding the same ID have different ciphertexts, so a unique index on the column constrains nothing. This is the same wall the withdrawn search hit. |
| `legalName` alone | two real people share a name. A unique index here REFUSES A REAL CUSTOMER, which is worse than admitting a duplicate. |
| `(legalName, dateOfBirth)` | both in the clear and indexable. But `dateOfBirth` is OPTIONAL by deliberate decision (a broker often onboards before every document is in hand), so the key is null for an unknown share of rows — and a unique index ignores NULLs unless declared `NULLS NOT DISTINCT`, which this repo has been bitten by before on `CommissionAgreement`. |
| `(legalName, nationality, dateOfBirth)` | the screening discriminators, all in the clear. Strongest available, same NULL problem. |

**The honest options, none of them free:**

1. **A blind index** — store `hmac(key, national_id)` in a second column and make THAT unique. Equality
   works, the plaintext is never stored, and a guess is only testable by someone holding the HMAC key.
   It is weaker than the random-IV column beside it, which is exactly the trade the owner refused for
   search — but the purpose here is different, and a one-way keyed digest is not the "guessable encoding"
   she rejected. **This is the option that actually solves it, and it is a privacy decision, not a
   technical one.**
2. **A soft warning at capture** — search by name on the create form and say *"three customers already
   match this name"*, leaving the judgement to the person. No schema change, no refusal, and it does
   nothing for the bulk import.
3. **Nothing**, and accept duplicates. Worth stating because that is the current position, chosen by
   nobody.

## What a duplicate actually costs here, so the decision has a size

Not just a tidy register. A duplicated customer means:

* **two KYC files** for one person, each screened separately — so one may be APPROVED while the other
  is REJECTED, and `Customer.status` is read as a gate by nothing (§ 1.59), so neither blocks anything;
* **a PDPL data-subject request that cannot be answered completely.** A deletion or an access request is
  fulfilled against the record somebody found. The second record is not in the response, and nothing
  reports that it exists — which is a statutory answer that is wrong without anybody lying;
* **retention and disposal keyed to the wrong row**, so one copy is disposed of on schedule and the
  other is kept past its purpose — PDPL Article 6(B), the same clause behind the no-real-data rule;
* **screening history split in two**, so "has this customer ever matched a list" has two answers.

The PDPL one is the heaviest: duplicate prevention is not housekeeping here, it is a precondition for
answering a data subject truthfully.

## Nothing built

This is the measurement. Which option, and whether a person is keyed at all, is the owner's — and option
1 is a privacy decision of the same kind as the masked national ID, so it belongs beside that one rather
than being taken as a database detail.
