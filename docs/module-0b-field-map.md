# Module 0-ب Part 1 — the field dictionary, placed field by field

**The owner's instruction:** *"Read it yourself and report, field by field, where each one
lands: an existing column, a new column, or a field you cannot place. A field you cannot
place is a finding, not a silent omission."*

Source: `WASEET360_Broker_Insurer_Data_Fields.xlsx` — broker **42** (31 mandatory / 7
conditional / 4 optional), insurer **36** (31/2/3), and a broker–insurer agreement sheet of
13 which is **not in this module**. The workbook's own summary tab states those counts and
they match the brief exactly.

Legend: **EXISTS** · **NEW** · **CANNOT PLACE** (a finding).

---

## A. The broker sheet — 42 fields

### Basic identity (10)

| # | Sheet field | Lands on | State |
|---|---|---|---|
| 1 | `broker_id` | `Organization.id` | **EXISTS** |
| 2 | `broker_code` | `Organization.code` | **NEW** — unique platform-wide, see § C.1 |
| 3 | `legal_name_ar` | `Organization.legalNameAr` | **EXISTS** — but nullable; see § C.2 |
| 4 | `legal_name_en` | `Organization.legalName` | **EXISTS** |
| 5 | `trade_name` | `Organization.tradeName` | **NEW** (optional) |
| 6 | `legal_form_id` | FK → `LegalForm` | **NEW** table (§ C.5) |
| 7 | `national_establishment_no` | `Organization.nationalEstablishmentNo` | **NEW** — unique platform-wide, the duplicate-registration defence |
| 8 | `cr_no` | `Organization.commercialRegistrationNo` | **NEW** |
| 9 | `cr_date` | `Organization.commercialRegistrationDate` | **NEW** (optional) |
| 10 | `tax_no` | `Organization.taxNumber` | **NEW** |

### Licence (7)

| # | Sheet field | Lands on | State |
|---|---|---|---|
| 11 | `license_type_id` | `Organization.brokerageKind` | **NEW** enum `BrokerageKind` — a DIFFERENT AXIS from our derived life/general types (§ 1.1 of the brief). Never merged. |
| 12 | `license_no` | `BrokerLicense.licenseNumber` | **EXISTS** — and see § C.3, a dead duplicate column |
| 13 | `licensing_authority_id` | FK → `LicensingAuthority` | **NEW** table |
| 14 | `license_issue_date` | `BrokerLicense.issuedAt` | **EXISTS** |
| 15 | `license_expiry_date` | `BrokerLicense.expiresAt` | **EXISTS** — computed per art. 10/b, part-year counting as a year (correction 0.3) |
| 16 | `license_status_id` | `BrokerLicense.status` | **EXISTS as a String**; becomes an enum (§ C.4) |
| 17 | `licensed_lines` | `BrokerLicenseScopeLine` | **EXISTS** — chosen from the 32-line global catalogue; licence TYPES derive from them and are never stored |

### Address and contact (6)

| # | Sheet field | Lands on | State |
|---|---|---|---|
| 18 | `country_id` | FK → `Country` | **NEW** table |
| 19 | `city_id` | FK → `City` | **NEW** table |
| 20 | `address` | `Organization.address` | **NEW** |
| 21 | `phone` | `Organization.phone` | **NEW** |
| 22 | `email` | `Organization.email` | **NEW** |
| 23 | `website` | `Organization.website` | **NEW** (optional) |

### Key people (4) — text at registration, never FKs (§ 1.8)

| # | Sheet field | Lands on | State |
|---|---|---|---|
| 24 | `gm_name` | `Organization.generalManagerName` | **NEW** (text) |
| 25 | `compliance_officer_name` | `Organization.complianceOfficerName` | **NEW** (text) |
| 26 | `compliance_officer_email` | `Organization.complianceOfficerEmail` | **NEW** (text) |
| 27 | `compliance_officer_phone` | `Organization.complianceOfficerPhone` | **NEW** (text, optional) |

All four are personal data under PDPL No. 24/2023 and are permission-gated for read from
the start, not later.

### Regulatory guarantees (7) — the conditional block

| # | Sheet field | Lands on | State |
|---|---|---|---|
| 28 | `bank_guarantee_no` | `Organization.bankGuaranteeNo` | **NEW**, **OPTIONAL** |
| 29 | `bank_guarantee_bank_id` | FK → `Bank` | **NEW**, **OPTIONAL** |
| 30 | `bank_guarantee_amount` | `Organization.bankGuaranteeAmount` `Decimal(18,3)` | **NEW**, **OPTIONAL** |
| 31 | `bank_guarantee_expiry` | `Organization.bankGuaranteeExpiry` | **NEW**, **OPTIONAL** |
| 32 | `pi_policy_no` | `ProfessionalIndemnityPolicy.policyNumber` | **NEW COLUMN ON AN EXISTING MODEL** — see § C.6 |
| 33 | `pi_limit` | `ProfessionalIndemnityPolicy.coverageLimit` | **EXISTS** |
| 34 | `pi_expiry` | `ProfessionalIndemnityPolicy.expiresAt` | **EXISTS** |

The four bank-guarantee fields carry, in each column's own description, that they have **no
basis in Instructions No. 9 of 2026** — verified by reading arts. 3, 4, 10, 11, 13, 15 and
18. Never required, never a reason to refuse, never labelled a regulatory requirement.

Professional indemnity is **mandatory, not conditional** (art. 10/a/4, art. 18/a/3), and
**no minimum limit is enforceable** — art. 10/a/4 leaves terms and amounts to a CBJ decision
we do not have.

### Banking (3)

| # | Sheet field | Lands on | State |
|---|---|---|---|
| 35 | `bank_id` | FK → `Bank` | **NEW** table |
| 36 | `iban` | `Organization.ibanEnc` | **NEW**, encrypted — measured: no IBAN or bank-account column exists anywhere today |
| 37 | `currency_code` | FK → `Currency` | **NEW** table |

Arts. 15/i and 15/k (the dedicated client-funds account; may not be pledged, may not earn
interest) are **recorded against the field and not built in this module**, so module 14 does
not rediscover them.

### System data (5)

| # | Sheet field | Lands on | State |
|---|---|---|---|
| 38 | `status` | `Organization.status` (`OrgStatus`) | **EXISTS** — reused, no second enum |
| 39 | `created_at` | `Organization.createdAt` | **EXISTS** |
| 40 | `created_by` | `Organization.createdByUserId` | **NEW** — see § C.7 |
| 41 | `updated_at` | `Organization.updatedAt` | **EXISTS** |
| 42 | `updated_by` | `Organization.updatedByUserId` | **NEW** — see § C.7 |

**Broker total: 42 placed. 0 cannot place.** 13 existing, 29 new.

---

## B. The insurer sheet — 36 fields

Placed per the owner's two rulings: the company as a party that signs in is an
`Organization`; `Insurer` stays as one office's counterparty relationship and gains a
nullable pointer; the split is a **resolver, not a move** (`docs/decision-insurer-field-split.md`).

| # | Sheet field | Lands on | State |
|---|---|---|---|
| 1 | `insurer_id` | `Organization.id` | **EXISTS** |
| 2 | `insurer_code` | `Organization.code` | **NEW** — same column as `broker_code`, § C.1 |
| 3 | `legal_name_ar` | `Organization.legalNameAr` | **EXISTS** |
| 4 | `legal_name_en` | `Organization.legalName` | **EXISTS** |
| 5 | `short_name` | `Organization.shortName` | **NEW** |
| 6 | `legal_form_id` | FK → `LegalForm` | **NEW** (shared with the broker sheet) |
| 7 | `national_establishment_no` | `Organization.nationalEstablishmentNo` | **NEW** (shared) |
| 8 | `cr_no` | `Organization.commercialRegistrationNo` | **NEW** (shared) |
| 9 | `tax_no` | `Organization.taxNumber` | **NEW** (shared) |
| 10 | `license_no` | `Organization.insurerLicenseNumber` | **NEW** — see § C.8 |
| 11 | `licensing_authority_id` | FK → `LicensingAuthority` | **NEW** (shared) |
| 12 | `license_status_id` | enum | **NEW** (shared, § C.4) |
| 13 | `business_model_id` | FK → `BusinessModel` | **NEW** table — **nothing may branch on it** (§ 1.5) |
| 14 | `licensed_lines` | join → `InsuranceLine` | **NEW** — see § C.9 |
| 15 | `fs_rating` | `Insurer.financialStrengthRating` | **EXISTS**, stays office-scoped |
| 16 | `rating_agency_id` | `Insurer.ratingAgencyId` → `RatingAgency` | **NEW** on `Insurer`, mandatory when a rating is entered |
| — | *(no sheet field)* | `Insurer.ratingAsOf` | **NEW** — the owner added it: a rating without a date is a stale claim, not a due-diligence record |
| 17 | `country_id` | FK → `Country` | **NEW** (shared) |
| 18 | `city_id` | FK → `City` | **NEW** (shared) |
| 19 | `address` | `Organization.address` + resolver | **NEW** on org; `Insurer.companyCorrespondenceAddress` **EXISTS** and stays as the unlinked fallback |
| 20 | `phone` | `Organization.phone` + resolver | as above, `Insurer.companyPhone` stays |
| 21 | `email` | `Organization.email` + resolver | as above, `Insurer.companyEmail` stays |
| 22 | `website` | `Organization.website` + resolver | as above, `Insurer.companyWebsite` stays |
| 23 | `quotation_email` | `Organization.quotationEmail` + resolver | **NEW** — a published company channel; `Insurer.rfqContactEmail` **EXISTS** as the unlinked fallback |
| 24 | `claims_email` | `Organization.claimsEmail` + resolver | **NEW**; `Insurer.claimsContactEmail` **EXISTS** |
| 25 | `broker_relations_name` | `Insurer.rfqContactName` | **EXISTS** — relationship data, never resolved |
| 26 | `broker_relations_email` | `Insurer.brokerRelationsEmail` | **NEW on `Insurer`** — see § C.10 |
| 27 | `broker_relations_phone` | `Insurer.rfqContactPhone` | **EXISTS** |
| 28 | `integration_method_id` | enum `IntegrationMethod` | **NEW** — code genuinely branches (API / portal / email / manual) |
| 29 | `api_endpoint` | `Organization.apiEndpoint` | **NEW**, required only when the method is API. **Credentials never enter this table** (§ 1.6) |
| 30 | `bank_id` | FK → `Bank` | **NEW** (shared) |
| 31 | `iban` | `Organization.ibanEnc` | **NEW**, encrypted (shared) |
| 32 | `status` | `Organization.status` **and** `Insurer.isActive` | **EXISTS, BOTH** — two different facts, see § C.11 |
| 33 | `created_at` | `Organization.createdAt` | **EXISTS** |
| 34 | `created_by` | `Organization.createdByUserId` | **NEW** |
| 35 | `updated_at` | `Organization.updatedAt` | **EXISTS** |
| 36 | `updated_by` | `Organization.updatedByUserId` | **NEW** |

**Insurer total: 36 placed. 0 cannot place.** 12 existing, 24 new (plus the owner's
`ratingAsOf`, which the sheet does not have).

---

## C. The findings — things the sheet does not say and a reader would get wrong

### C.1 `broker_code` and `insurer_code` are one column now — A DECISION, NOT A READING

The sheet has them on two tables because it models two tables. Both now live on
`Organization`, so one `code`, unique platform-wide, serves both. **This is a consolidation
I am proposing, not something the sheet says.** The alternative — two nullable columns with
a CHECK tying each to its organization type — buys nothing and creates a shape where an
insurer can carry a broker code.

### C.2 `legal_name_ar` is MANDATORY on the sheet and NULLABLE in our schema

`Organization.legalNameAr` is `String?`, with the stated reason that "an office may be
onboarded before its registered Arabic name is confirmed". The sheet marks it mandatory.
Registration will require it; **the column is not tightened to NOT NULL in this module**,
because two existing offices and the provider would have to be backfilled and that is a
separate decision. Flagged rather than silently diverging.

### C.3 `Organization.brokerLicenseNumber` IS A DEAD DUPLICATE — measured

Its own comment says it is "distinct from the `BrokerLicense` model". Measured on both
databases: **NULL on every row** (dev 3 organizations, db-test 2), while `BrokerLicense`
carries the real data (1 term per dev office, 43 on db-test). Read by **nothing** — the only
reference in the whole repository is a test fixture setting it to `null`.

It is a second home for one fact that never filled up. The sheet's `license_no` maps to
`BrokerLicense.licenseNumber`. **Recommend dropping the column**; not dropped here, because
a column drop is a migration with its own blast radius and is not one of the seven items.

### C.4 Licence status: the sheet has four values, the column has two

`BrokerLicense.status` is a `String` holding `active | lapsed`, and **four code paths branch
on it**. The sheet wants ساري / قيد التجديد / موقوف / ملغى.

Per the owner's enum/table test this is an enum. The mapping is **not** mechanical:
`قيد التجديد` (under renewal) is already DERIVED by module 0 from `renewalRequestedAt` plus
the 45-day deadline, so storing it would be a second home for a derived fact; and
`موقوف`/`ملغى` are two new states no existing branch handles — the exact silent failure the
owner's rule warns about. **The enum's value set needs her word before I write it.**

### C.5 None of the eight reference tables exists

Measured: no `Country`, `City`, `Bank`, `Currency`, `LegalForm`, `LicensingAuthority`,
`RatingAgency`, `BusinessModel` model, and no enum covering any of them. All eight are new,
built on the `InsuranceLine` shape (`code @unique`, `nameEn`, `nameAr`, `displayOrder`), all
PLATFORM-scoped.

### C.6 `ProfessionalIndemnityPolicy` HAS NO POLICY NUMBER

The model carries `insurerName`, `coverageLimit`, `expiresAt`, `claimsHistorySummary`. The
sheet's `pi_limit` and `pi_expiry` map onto it directly; **`pi_policy_no` has nowhere to
go.** One new column on that model, not three loose ones on the organization.

### C.7 `created_by` / `updated_by` cannot be ordinary FKs to `User`

`User` is tenant-scoped; the person who registers an office is the **provider's** user, in a
different organization. A plain FK would be a cross-tenant reference. Stored as a plain id
with the reason written at the column, the same treatment `Organization.dpoAlternateApproverUserId`
already has.

### C.8 An insurance company's licence is not a `BrokerLicense`

`BrokerLicense` is a term series with a mandatory CBJ certificate, a 45-day renewal rule and
art. 10/b expiry arithmetic — all broker rules. The insurer sheet asks for three flat fields
(number, authority, status) and no dates. Flat columns on `Organization`; **no term series,
and the broker guards must not fire on an insurer.**

### C.9 `licensed_lines` on the insurer has an existing neighbour that does NOT fit

`InsurerOfferedLine` exists, but it hangs off the **office-scoped** `Insurer`, so it records
what one office knows a company writes. The sheet's field is a company fact. A new
organization↔line join is needed; the existing model stays as the office's own record.

### C.10 `broker_relations_email` has no column, and is not `rfqContactEmail`

`quotation_email` (#23) maps to `Insurer.rfqContactEmail`. `broker_relations_email` (#26) is
a different thing — the named person who handles this broker, not the quotations inbox — and
there is no column for it. New on `Insurer`, relationship data.

### C.11 `status` is two facts, and conflating them would be a real defect

On the sheet it is one field. Here it is two: `Organization.status` is whether the company is
on the platform at all; `Insurer.isActive` is whether **this office** still places with it.
An office that stops dealing with a live insurer must not deactivate that company for
everyone.

### C.12 A reinsurance broker is outside these instructions, and must be marked so

Where `BrokerageKind` is reinsurance, the art. 4/a capital slabs, the art. 3/a type rules and
the art. 4/z staffing minimums **must not fire**, and the office must be visibly marked as
outside the scope of Instructions No. 9 of 2026 with those rules not implemented. Silently
applying a broker's capital slab to a reinsurance broker is the same class of defect as the
provider being reported as an unlicensed office.

---

## D. What this module does NOT touch

* **The 32-line `InsuranceLine` catalogue** — the sheet's line examples are illustrations.
  A seed that touched it would silently change what every licence means (§ 1.4).
* **The broker–insurer agreement sheet (13 fields)** — not in this module.
* **`InsurerMaster`** — neither revived nor deleted. Vestigial for **writes** only; read in
  24 non-build source files.
