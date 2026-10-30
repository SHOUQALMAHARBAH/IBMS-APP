# The insurer field split — company fact or relationship fact

**Status: the field map, produced BEFORE any migration, on the owner's instruction of
2026-10-12: *"Before migrating a single row: measure and show me the 14 overlapping fields
with a per-field decision … I want the field map before the migration, not after."***

Nothing in this document has been migrated. Two questions at the end need the owner's
ruling before a single row moves.

---

## 1. The decision this implements

Module 0-ب item (d), owner's decision of 2026-10-12:

> The insurance company as a party that signs in and is administered can only be an
> Organization, because a user belongs to an organization and nothing else. The 36 sheet
> fields live on Organization (plus its profile tables).
>
> `Insurer` stays — it is one office's counterparty relationship (commission agreements,
> policies, that office's own notes). It gains a nullable pointer to the organization and
> is linked when the company is registered on the platform. An office may still carry an
> `Insurer` row for a company that has no platform organization.
>
> `InsurerMaster` is not revived.

---

## 2. The split is NOT a judgement call — the codebase already made it

`InsurerDirectory` is a `security_invoker = false` view, and its migration
(`20261012100000_insurer_directory_view`) states that its column list **is** the boundary:

> These are COMPETING BROKERAGES on one platform. The company is public knowledge; the
> panel is not. So the directory shows the company — legal name in both scripts, its
> structure, general contact details, lines of business offered — and must NEVER show
> which offices deal with it, nor anything from the office-scoped relationship.

So the question "is this a company fact?" was already answered, reviewed, and enforced
structurally. Measured column list, read live from db-test:

```
directoryKey, name, nameAr, structure, companyPhone, companyEmail,
companyWebsite, companyCorrespondenceAddress, lines
```

Every field the directory shares is a company fact. Every field it withholds is either
office-scoped or identity plumbing. That is the test applied below, and it agrees with the
owner's instruction on 13 of 14 fields.

---

## 3. The field map

Row counts measured on both databases. `dev` is the dense one; `db-test`'s 534 rows are
overwhelmingly e2e fixtures carrying nothing but the catalogue link.

### Company facts → the Organization

| # | `Insurer` column | Sheet field | In directory? | dev | db-test |
|---|---|---|---|---|---|
| 1 | `legalName` | `legal_name_en` (#4) | **yes** (`name`) | 4/19 | 6/534 |
| 2 | `legalNameAr` | `legal_name_ar` (#3) | **yes** (`nameAr`) | 4/19 | 6/534 |
| 3 | `structure` | `business_model` (#13) | **yes** | 16/19 | 3/534 |
| 4 | `companyCorrespondenceAddress` | `address` (#19) | **yes** | 16/19 | 0/534 |
| 5 | `companyPhone` | `phone` (#20) | **yes** | 16/19 | 3/534 |
| 6 | `companyEmail` | `email` (#21) | **yes** | 16/19 | 3/534 |
| 7 | `companyWebsite` | `website` (#22) | **yes** | 16/19 | 0/534 |
| 8 | `financialStrengthRating` | `fs_rating` (#15) | **NO — see § 5.1** | 3/19 | 3/534 |

### Relationship facts → stay on `Insurer`

| # | `Insurer` column | Sheet field | In directory? | dev | db-test |
|---|---|---|---|---|---|
| 9 | `rfqContactEmail` | `quotation_email` (#23) | no | 15/19 | 3/534 |
| 10 | `claimsContactEmail` | `claims_email` (#24) | no | 15/19 | 3/534 |
| 11 | `rfqContactName` | `broker_relations_name` (#25) | no | 16/19 | 0/534 |
| 12 | `rfqContactPhone` | `broker_relations_phone` (#27) | no | 3/19 | 3/534 |
| 13 | `claimsContactName` | *(none)* | no | 0/19 | 0/534 |
| 14 | `isActive` | `status` (#32) | no | 19/19 | 534/534 |

`isActive` is the clearest of the six and worth stating explicitly: it means **active for
this office**, not "trading". An insurance company the platform knows is perfectly alive
may be deactivated by one office that has stopped placing with it. Moving it would make
one office's commercial decision a fact about the company.

### Not part of the split

| `Insurer` column | Why |
|---|---|
| `canonicalName` | `GENERATED` by the database — the duplicate-name key. Never written by hand. |
| `underwriterContact` | No sheet field; this office's own named underwriter. |
| `creditTermsDays` | No sheet field; the directory migration names credit terms as office-scoped by name. |

---

## 4. What `InsurerMaster` still does — measured, because the owner asked

"Vestigial" is true of **writes only**: no registration creates one. It is a **live read
dependency** in 24 non-build source files, including:

* `GET /insurer-master` and `/:id` (`insurer-master.controller.ts`)
* `insurer-identity.ts` — coalesces master name over local name, so it decides what an
  insurer is **called**
* the rfq, commission, comparison, policy, recommendation and invoice repositories
* `apps/web/lib/insurer/insurer-master-api.ts`

Row counts: **9 on dev, 528 on db-test**. Leaving it declared vestigial is safe. Deleting
it is not, and nothing in this module deletes it.

---

## 5. Two things the owner must rule on before a row moves

### 5.1 `financialStrengthRating` — the instruction and the codebase disagree

The owner's instruction lists **rating** among company facts. The directory migration
lists it among office-scoped relationship data, **by name**:

> must NEVER show … anything from the office-scoped relationship: no credit terms, **no
> financial-strength rating**, no commission, no relationship contacts …

Both readings are defensible and they are about different things. The *rating itself* is
objectively a company fact — AM Best rates the company, not the relationship. What the
directory is protecting is **disclosure**: which rating office A chose to record is part of
office A's own due diligence, and the sheet agrees, describing `fs_rating` as supporting
"the broker's duty of care when selecting an insurer".

Moving the column to `Organization` does **not** force the directory to expose it — the
directory's column list is independent and would not change. But it does mean an office can
no longer record its own rating for a company, which is a capability it has today.

**Not chosen here.** It is field #8 and the only one of the 14 in dispute.

### 5.2 This is a RESOLVER, not a move — and that changes the migration

The owner's own decision says an office may carry an `Insurer` row for a company with **no
platform organization**. That case is not hypothetical: it is the majority. On dev, 4 of 19
`Insurer` rows are local-only; on db-test, 6 of 534.

For those rows there is no organization to hold the company facts. So the eight columns
**cannot simply move** — an unregistered company's phone number has nowhere else to live.
What the split actually requires is:

* the eight columns **stay on `Insurer`**, used when `organizationId` is NULL;
* when the insurer **is** linked to an organization, the organization's value **wins**;
* one resolver owns that precedence, exactly as `insurer-identity.ts` already coalesces
  master name over local name today.

Framed that way the migration is small and reversible: **no row is rewritten at all**. The
columns keep their values, and a resolver decides which source answers. That also removes
the cross-tenant write problem — an office writing a company fact onto another
organization's row is not something tenant scoping permits, and nothing should be built that
needs it.

**The alternative** — genuinely moving the values and leaving unregistered insurers unable
to record a phone number — would need a decision, and would break 16 of dev's 19 rows.

---

## 6. If the owner confirms § 5.2

No data migration is required for this split. The work is a nullable
`Insurer.organizationId` pointer, a resolver, and the registration write path. The 534 rows
the owner was right to be careful about are not touched.
