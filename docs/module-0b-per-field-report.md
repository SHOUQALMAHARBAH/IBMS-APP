# Module 0-ب Part 2 — the per-field report: where each field lands, and **why**

**The owner's instruction (note 2, item (e)):** *"The per-field report must say WHY, not only
whether."*

A report that says *"field 7 → `Organization.nationalEstablishmentNo`"* is a mapping table. It
tells the reader nothing they could disagree with, and a mapping nobody can disagree with is a
mapping nobody has checked. So every row below answers the second question: **why that column, why
no column, or why it is placed differently from what the sheet says.**

---

## What this is written against — measured, not recalled

| | |
|---|---|
| Source | `WASEET360_Broker_Insurer_Data_Fields_v4.xlsx` (**v4** — the current dictionary) |
| Broker sheet «الوسيط» | **50 numbered fields** — counted from the sheet, matches the brief |
| Insurer sheet «شركة التأمين» | **38 numbered fields** — counted, matches the brief |
| Deliberately **out of scope** | «اتفاقية الوسيط-الشركة» (the broker–company agreement) and «ائتمان وتوريد الوثيقة» (credit and policy delivery). The owner's instruction: these belong to **modules 8, 9 and 14** and are not this module's to place. |
| Also out of scope | «القوائم المرجعية» — the reference-lists sheet is the *source* of item (c)'s eight tables, not a sheet of fields to place. |

**Re-measure rather than trust this.** The counts above come from parsing the workbook's own
numbered rows:

```
python <scratch>/readxlsx.py <unzipped-workbook> sheet3.xml broker.tsv     # الوسيط
python <scratch>/readxlsx.py <unzipped-workbook> sheet4.xml insurer.tsv    # شركة التأمين
awk -F'\t' '$1 ~ /^[0-9]+$/ {n++} END {print n}' broker.tsv                # -> 50
```

There is no `openpyxl` on this host; an `.xlsx` is a zip, and the reader parses
`sharedStrings.xml` plus one worksheet. It resolves each cell by its **column letter**, so a sparse
row does not shift the cells after it — the failure that would silently mis-align a whole sheet.

---

## How to read a row

Four kinds of answer, and the distinction is the point:

- **A column, and why that one.** The ordinary case.
- **DERIVED — and why it is not stored.** Decisions 67, 71 and 88. A stored copy of a derived fact
  is a second home for one fact, and the copy is the one that drifts.
- **PLACED DIFFERENTLY FROM THE SHEET.** The sheet names a type or a shape and we chose another.
  Each one is argued, not asserted.
- **A FINDING.** Something a reader would get wrong, or something declared and not built.

---

# A. The broker sheet — «الوسيط», 50 fields

## A.1 Basic identity — «التعريف الأساسي» (#1–#10, #43)

| # | Sheet field | Lands on | **Why** |
|---|---|---|---|
| 1 | `broker_id` — *INT (PK, auto)* | `Organization.id` (**uuid**) | **PLACED DIFFERENTLY.** The sheet says `INT`. A sequential integer key would be the only one in 143 migrations' worth of tables, and it leaks: an office can read its own id and infer how many offices the platform has, and roughly when it joined. A uuid says nothing. The sheet's `INT` is a data-dictionary convention, not a requirement — nothing in Instructions No. 9 of 2026 names a key format. |
| 2 | `broker_code` | `Organization.code` | **ONE COLUMN SERVES BOTH SHEETS.** The insurer sheet's `insurer_code` (#2) is the same field for a different kind of organization, and both are now the same kind of row (decision 63). Two columns would mean every read asking "which code column applies to this row" — a question the row's `type` already answers. |
| 3 | `legal_name_ar` | `Organization.legalNameAr` **NOT NULL** | The sheet marks it mandatory and this platform's base language is Arabic. It was nullable until module 0-ب, on the reasoning that an office might be onboarded before its registered Arabic name is known; the column tightened because **zero rows lacked one** (measured), and a future row that does will fail the migration rather than have a legal name invented for it. |
| 4 | `legal_name_en` | `Organization.legalName` **NOT NULL** | The sheet's own note: the English name is for correspondence with reinsurers and foreign parties. Named `legalName` rather than `legalNameEn` because it predates the pair; renaming it would touch every reader for no gain. |
| 5 | `trade_name` | `Organization.tradeName` (nullable) | Optional on the sheet, nullable here — and the two agree *because* a trade name is a fact that may genuinely not exist, not because nobody has typed it yet. |
| 6 | `legal_form_id` | `Organization.legalFormId` → `LegalForm` | **A reference table, not an enum**, because nothing in the code branches on a legal form — it is displayed, stored and filtered. Item (c)'s rule. It gained **sole establishment** («مؤسسة فردية») in this module, because art. 10/a/1/a requires a natural-person broker to register as one and the list did not have it — see #43. |
| 7 | `national_establishment_no` | `Organization.nationalEstablishmentNo`, **platform-wide unique** | The unique is **platform-wide and not per-office**, deliberately: this is the national register's number, so the same number appearing on two organizations means one of them is wrong, whoever owns the rows. It is also unique **across organization types** — a brokerage office and an insurance company cannot share one (refusal 1b). |
| 8 | `cr_no` | `Organization.commercialRegistrationNo`, platform-wide unique | Same argument as #7. |
| 9 | `cr_date` | `Organization.commercialRegistrationDate` | Optional on the sheet and nullable here. A `DATE`, not a timestamp: a registration date is a calendar day, and storing an instant would invite a timezone to move it. |
| 10 | `tax_no` | `Organization.taxNumber` | Mandatory on the sheet; nullable in the column, **enforced by the DTO**. The asymmetry is deliberate and is named in the findings (§ C.2). |
| 43 | `broker_kind` — *ENUM (natural / corporate)* | `Organization.brokerKind` | **AN ENUM, AND CODE GENUINELY BRANCHES ON IT** — art. 3/a limits a natural-person broker to ONE insurance type, which is refusal 3. That is the test item (c) established: an enum when code branches, a reference table when the value is only displayed. Nullable exactly when the row is an insurance company, held by a CHECK in **both** directions. |

## A.2 Licence — «الترخيص» (#11–#17, #44–#50)

| # | Sheet field | Lands on | **Why** |
|---|---|---|---|
| 11 | `license_type_id` — *FK → licence-type list* | `Organization.brokerageKind` — **enum `DIRECT`/`REINSURANCE`** | **PLACED DIFFERENTLY, AND IT IS A FINDING.** The sheet's own explanation is "direct insurance brokerage / reinsurance brokerage, and it determines which operations are permitted" — i.e. **code is meant to branch on it**, which is an enum and not a reference table. It is a different axis from #44 entirely. **The finding: nothing branches on it today** (§ C.1). |
| 12 | `license_no` | `BrokerLicense.licenseNumber` (per TERM) | **NOT on `Organization`.** A licence is a **series of terms** (module 0 item (c)): renewal appends a row, and the number belongs to the term that carries it. `Organization.brokerLicenseNumber` still exists and is a **dead duplicate** — § C.3. |
| 13 | `licensing_authority_id` | `Organization.licensingAuthorityId` → `LicensingAuthority` | On the organization rather than the term, because the authority that licenses an office does not change between terms. If it ever did, that is a new office in regulatory terms, not a new term. |
| 14 | `license_issue_date` | `BrokerLicense.issuedAt` | Per term — see #12. |
| 15 | `license_expiry_date` | `BrokerLicense.expiresAt` | Per term. Art. 10/b says a term ends 31 December; a date that is not one **warns and is still saved**, because the certificate is the authority and the system's job is not to correct it. |
| 16 | `license_status_id` | **DERIVED — no column** | **Decision 71**, and the sheet now says so itself. Computed from the term dates, the renewal request if one was filed, and any standing regulatory act. What *is* stored is the regulator's **act**: an append-only `RegulatoryAction` carrying its kind, effective date, CBJ decision number and document. Six honest statuses, not the sheet's original four — § C.4. |
| 17 | `licensed_lines` | `BrokerLicenseScopeLine` (per term) | A branch is a **catalogue row**, never free text, so the same cover means the same thing on every screen that groups by line. The adopted catalogue is **32 lines (27 general, 5 life)** and the reference-lists sheet's examples are illustrative — they are **not seeded over the catalogue**. |
| 44 | *Licensed Insurance Types* | **DERIVED — no column** | **Decision 67.** The types are the distinct `category` values of the licensed branches. A type column beside the branches would be a second home for one fact, and it would let a screen report a licence the branches do not support. Returned in **catalogue order**, not insertion order, so the answer cannot depend on which branch somebody recorded first. |
| 45 | `paid_up_capital_per_type` | `Organization.paidUpCapital` `DECIMAL(18,3)` + the **derived** per-type requirement | **The stored figure is the office's capital; the REQUIREMENT is derived** from the branch counts per type (art. 4/a: 5,000 / 7,500 / 10,000 at ≤6 / ≤12 / >12 branches **within a type**). The breakdown is shown, not only the total, because "per type" is the whole point — 27 general + 5 life needs 10,000 + 5,000, not one slab over 32 branches. **It warns and never refuses** (`capital-never-refuses.inventory.spec.ts` fails if a refusal appears near a capital read), and **"no capital recorded" is rendered as a different fact from "recorded and short"** — the first is a missing entry, the second is a finding about the office. **The counting unit is unverified and declared as such** on both screens that show the figure — register entry on art. 4/a. |
| 46 | `license_certificate_document_id` | `BrokerLicense.certificateDocumentId` **NOT NULL** | **The strongest enforcement in this module, and it was DISCOVERED rather than chosen** — the column was already `NOT NULL` when item (c) built the term series. A term with no certificate cannot exist in the database at all. `ON DELETE RESTRICT`, because the document is the evidence. **Do not reason about #48/#49 by analogy with this** — § C.5. |
| 47 | `renewal_requested_at` | `BrokerLicense.renewalRequestedAt`, **write-once** | Art. 11's 45-day deadline is measured from it, so an overwrite would move a filing date. **The date may be SUPPLIED rather than server-stamped** — an office that files on paper on Sunday and records it on Tuesday must not be reported late — and the audit row records which, so a backdated filing is answerable instead of invisible. **45 CALENDAR days, not business days**: counting business days would move the deadline *earlier* and report a timely filing as late. |
| 48 | `premises_tenure_document_id` | `Organization.premisesTenureDocumentId`, **nullable** | **Decision 88.** Art. 10/a/2 requires the lease or title deed. **Absence does not block the save**, and the migration asserts the column is nullable so a later tightening cannot reinstate the block. The reason is not leniency: an office licensed by the Central Bank *did* submit this to the regulator — that is what being licensed means — so our not holding a copy is **our** gap. |
| 49 | `association_membership_document_id` | `Organization.associationMembershipDocumentId`, **nullable** | **Decision 88.** Art. 10/a/3, repeated annually by art. 18/a. **It carries no person key**: the article attaches the proof to people who **do not exist in the system when an office is registered**, so a person FK here would be a precondition nothing can satisfy. The migration asserts `Organization` references `Employee` nowhere. |
| 50 | *Registration Pack Completeness* | **DERIVED — no column** | **Decision 88**, on the same pattern as #16. The migration **refuses a completeness column by name** (`attname ILIKE '%complete%'`), so a stored flag cannot come back and drift. It **NAMES and never counts** — "Missing: lease contract or title deed", not "2 documents missing" — because the two documents come from different places and different people, so a count is not actionable. **It gates nothing**, asserted: an office registered with neither still receives its administrator role. |

## A.3 Address and contact — «العنوان والتواصل» (#18–#23)

| # | Sheet field | Lands on | **Why** |
|---|---|---|---|
| 18 | `country_id` | `Organization.countryId` → `Country` | Reference table — displayed and filtered, never branched on. |
| 19 | `city_id` | `Organization.cityId` → `City` | Reference table. **Not validated against the country**, declared: the seeded cities are Jordanian, and a country/city coherence rule needs a list this module does not have. |
| 20 | `address` | `Organization.address` | Free text, deliberately. An address is not a reference-table row and structuring it would ask the broker for more than the paper form does. |
| 21 | `phone` | `Organization.phone` | **Stored in the clear, unlike a customer's.** An office's switchboard number is a business contact; a customer's phone is personal data under PDPL and is encrypted. The asymmetry is correct and is worth stating because the column names look alike. |
| 22 | `email` | `Organization.email` | As #21. |
| 23 | `website` | `Organization.website` | Optional on the sheet, nullable here. |

## A.4 Key people — «الأشخاص الرئيسيون» (#24–#27)

| # | Sheet field | Lands on | **Why** |
|---|---|---|---|
| 24 | `gm_name` | `Organization.generalManagerName` — **TEXT, not an FK** | **PLACED DIFFERENTLY, AND THIS IS THE SAME ARGUMENT AS #49.** At the moment an office is registered it has no employees and no users — the provider is registering it from outside. An FK to `Employee` would be unsatisfiable at exactly the moment the field is needed. Text now; the employees module is where a person becomes a record. |
| 25 | `compliance_officer_name` | `Organization.complianceOfficerName` — text | As #24. |
| 26 | `compliance_officer_email` | `Organization.complianceOfficerEmail` | As #24. **Not a login**: this is the regulator-facing contact, and conflating it with a user account is how the first administrator's email gets silently decided for them (item (f)). |
| 27 | `compliance_officer_phone` | `Organization.complianceOfficerPhone` | Optional on the sheet, nullable here. |

## A.5 Regulatory guarantees — «الضمانات الرقابية» (#28–#34)

| # | Sheet field | Lands on | **Why** |
|---|---|---|---|
| 28 | `bank_guarantee_no` | `Organization.bankGuaranteeNo`, nullable | **OPTIONAL, AND THE SHEET'S OWN CORRECTION 1 SAYS WHY**: a bank guarantee appears **nowhere** in Instructions No. 9 of 2026. It is collected if an office has one, never demanded, never a reason to refuse a registration, and **never called a regulatory requirement** — because naming it one would be the system asserting a rule the regulator did not make. |
| 29 | `bank_guarantee_bank_id` | `Organization.bankGuaranteeBankId` → `Bank` | As #28. |
| 30 | `bank_guarantee_amount` | `Organization.bankGuaranteeAmount` `DECIMAL(18,3)` | As #28. `Decimal`, never a float — the money rule, and it is classified in `MONEY_DECIMAL_FIELDS`. |
| 31 | `bank_guarantee_expiry` | `Organization.bankGuaranteeExpiry` | As #28. |
| 32 | `pi_policy_no` | `ProfessionalIndemnityPolicy.policyNumber` | **MANDATORY WITHOUT CONDITION** (sheet correction 2): art. 10/a/4 requires professional indemnity before final licence approval, and art. 18/a/3 puts it in the periodic returns. **Its own table, not three columns on `Organization`** — a renewal is a NEW ROW, because "what were we covered by in 2025" is a question an examiner asks and an overwritten column cannot answer. |
| 33 | `pi_limit` | `ProfessionalIndemnityPolicy.coverageLimit` | Per policy — see #32. Art. 22/d is about the **coverage amount**, not a headcount. |
| 34 | `pi_expiry` | `ProfessionalIndemnityPolicy.expiresAt` | Per policy. |

## A.6 Banking — «البيانات البنكية» (#35–#37)

| # | Sheet field | Lands on | **Why** |
|---|---|---|---|
| 35 | `bank_id` | `Organization.bankId` → `Bank` | Reference table. |
| 36 | `iban` | `Organization.ibanEnc` — **ENCRYPTED** | An IBAN is an account identifier and is held encrypted, like a national ID, rather than in the clear like a switchboard number. **It carries NEITHER art. 15/i nor art. 15/k today** — nothing marks it as the dedicated client-funds account and nothing counts the seven-working-day premium cap or the three-day claims cap. Declared; the rules belong to module 14. |
| 37 | `currency_code` | `Organization.currencyId` → `Currency` | Reference table. **There is no conversion path**: every threshold in Instructions No. 9 of 2026 is in JOD, so an amount in another currency cannot be compared against any of them, and comparing the bare numbers would reach a regulatory conclusion from an invalid comparison. Declared, with the sizing question to be asked at module 14's **opening**. |

## A.7 System data — «بيانات النظام» (#38–#42)

| # | Sheet field | Lands on | **Why** |
|---|---|---|---|
| 38 | `status` | `Organization.status` | **An enum, not a reference table**, because code branches on it — an inactive organization's users cannot sign in. |
| 39 | `created_at` | `Organization.createdAt` | Server-set. Nobody types it, and the registration screen **says so** rather than omitting the field: an absent field reads as an oversight, a stated absence reads as a decision. |
| 40 | `created_by` | `Organization.createdByUserId` | Server-set from the authenticated provider operator. Same stated-absence treatment as #39. |
| 41 | `updated_at` | `Organization.updatedAt` | Prisma's `@updatedAt`, applied client-side — which is why a **raw** INSERT into `Organization` must supply it. |
| 42 | `updated_by` | `Organization.updatedByUserId` | Server-set. |

---

# B. The insurer sheet — «شركة التأمين», 38 fields

**The split that governs this whole sheet (decision 63).** A company that signs in is an
`Organization`; a company an office deals with is an `Insurer`. They are **not** two records of one
thing — they answer different questions — and the resolver that reconciles them **modified zero
rows**. So each field below lands on whichever of the two actually owns the fact, and the
interesting rows are the ones where that is not the obvious one.

## B.1 Basic identity (#1–#9)

| # | Sheet field | Lands on | **Why** |
|---|---|---|---|
| 1 | `insurer_id` | `Organization.id` (uuid) | As broker #1. |
| 2 | `insurer_code` | `Organization.code` | **The same column as broker #2** — see there. |
| 3 | `legal_name_ar` | `Organization.legalNameAr` **NOT NULL** | A **company** fact, so it belongs to the registered organization. `Insurer.legalNameAr` also exists and is the **office's own** record of a counterparty it has not been able to point at a registered company — the resolver prefers the registered row. |
| 4 | `legal_name_en` | `Organization.legalName` **NOT NULL** | As #3. |
| 5 | `short_name` | `Organization.shortName` | Mandatory on this sheet and optional on the broker's, which is the sheet reflecting practice: a broker refers to insurers by short name constantly. |
| 6 | `legal_form_id` | `Organization.legalFormId` | Reference table. |
| 7 | `national_establishment_no` | `Organization.nationalEstablishmentNo` | **Unique across BOTH types** — refusal 1b. |
| 8 | `cr_no` | `Organization.commercialRegistrationNo` | As #7. |
| 9 | `tax_no` | `Organization.taxNumber` | As broker #10, with the same DTO-enforced asymmetry (§ C.2). |

## B.2 Licence and activity (#10–#16, #37–#38)

| # | Sheet field | Lands on | **Why** |
|---|---|---|---|
| 10 | `license_no` | `Organization.insurerLicenseNumber` | **On the organization, NOT a term series** — and that is a deliberate asymmetry with the broker (§ C.6). A company's licence is not what this product governs; the broker's is. |
| 11 | `licensing_authority_id` | `Organization.licensingAuthorityId` | As broker #13. |
| 12 | `license_status_id` | **DERIVED — no column** | Decision 71, as broker #16. |
| 13 | `business_model_id` | `Organization.businessModelId` → `BusinessModel` | **A reference table and NOTHING MAY BRANCH ON IT.** Takaful versus conventional changes *terminology* on documents, not code paths, and a branch here would quietly become a second product. The terminology templates are deferred to item (e)'s successor. |
| 14 | `licensed_lines` | `InsurerLicensedLine` (keyed by `insuranceCompanyId`) | **A COMPANY fact, and the column name is the mechanism.** The first version keyed it by `organizationId` — which would have put it in `tenantScopeExtension`'s scoped set, because that set is derived from the DMMF by **exact field name**, and the company's own licensed lines would then have been invisible to every other office. Renamed before it shipped. **It is NOT the same fact as `InsurerDirectory.lines`**, which is what offices have recorded *buying* — a reader who confused them would read a company's licence out of market behaviour, so the screen says which it is. |
| 15 | `fs_rating` | `Insurer.financialStrengthRating` — **OFFICE-SCOPED** | **Sheet correction 5, and the most counter-intuitive placement on this sheet.** A rating is a *company* fact, so the obvious home is `Organization`. It stays on `Insurer` because **the office's own record of it is what the office acts on**, and two offices legitimately disagree — one has refreshed it, one has not. A platform-wide column would silently overwrite one office's record with another's. |
| 16 | `rating_agency_id` | `Insurer.ratingAgencyId` → `RatingAgency` | Conditional on #15 and **enforced by a CHECK**, `Insurer_rating_carries_its_date` — a rating with no agency and no as-of date is a number nobody can source. The constraint was added `NOT VALID` and then **validated after the seed was corrected to emit the pair**, rather than validated against rows that did not satisfy it. |
| 37 | `fs_rating_as_of` | `Insurer.financialStrengthRatingAsOf` | The other half of #16's CHECK. **Clearing the pair has its own action** (decision 93) — `DELETE /insurers/:id/financial-strength-rating` clears both in ONE write, because clearing one alone either violates the constraint or strands the other. There is still **no API-wide way to clear an optional value**; that convention is declared and unowned. |
| 38 | `license_certificate_document_id` | `Organization.insurerLicenseCertificateDocumentId`, **nullable, enforced by the SERVICE** | **PLACED DIFFERENTLY FROM THE BROKER'S, PERMANENTLY** — § C.5. The pointer sits on the **parent** here, so a `NOT NULL` column would make the row un-insertable: the organization must exist before its document, and the document before the pointer. Three statements in one transaction, and **the order is the finding** — the first version was a 500 on every registration. |

## B.3 Address and contact (#17–#22)

| # | Sheet field | Lands on | **Why** |
|---|---|---|---|
| 17 | `country_id` | `Organization.countryId` | Reference table. |
| 18 | `city_id` | `Organization.cityId` | Reference table; not validated against the country (as broker #19). |
| 19 | `address` | `Organization.address` | Free text. `Insurer.companyCorrespondenceAddress` is the office's own record, preferred only when no registered company is linked. |
| 20 | `phone` | `Organization.phone` | In the clear — a business contact (as broker #21). |
| 21 | `email` | `Organization.email` | As #20. |
| 22 | `website` | `Organization.website` | Optional. |

## B.4 Broker-facing channels — «قنوات التعامل مع الوسيط» (#23–#29)

This group is where the two-records split earns itself, so the *why* is shared: **a channel is how
THIS office reaches the company**, and two offices deal with different named people inside the same
company. #23/#24/#28/#29 are company-level (one switchboard, one integration); #25–#27 are the
office's own.

| # | Sheet field | Lands on | **Why** |
|---|---|---|---|
| 23 | `quotation_email` | `Organization.quotationEmail` | A company-level inbox — one address, published by the company. |
| 24 | `claims_email` | `Organization.claimsEmail` | As #23. |
| 25 | `broker_relations_name` | `Insurer.brokerRelationsName` | **OFFICE-SCOPED, on measurement rather than preference.** Every office deals with a *different named person* in the same company's broker-relations desk. On `Organization` one office's account manager would appear to every other office as theirs. |
| 26 | `broker_relations_email` | `Insurer.brokerRelationsEmail` | As #25. |
| 27 | `broker_relations_phone` | `Insurer.brokerRelationsPhone` | As #25; optional on the sheet. |
| 28 | `integration_method_id` | `Organization.integrationMethod` — **enum** | **An enum, because these are four genuinely different code paths**, and because `api_endpoint` is required only for one of them. A reference table could not express that. **No credential ever enters these columns** — keys and tokens belong in a secret store. |
| 29 | `api_endpoint` | `Organization.apiEndpoint` | Conditional on #28 being `API`, and **enforced in both directions**: an API method with no endpoint is refused, and an endpoint with a non-API method is refused too. One-sided would leave a value nothing reads, which is a value somebody eventually reads. |

## B.5 Banking (#30–#31)

| # | Sheet field | Lands on | **Why** |
|---|---|---|---|
| 30 | `bank_id` | `Organization.bankId` | Reference table. |
| 31 | `iban` | `Organization.ibanEnc` — encrypted | As broker #36, and carrying neither art. 15/i nor 15/k. |

## B.6 System data (#32–#36)

| # | Sheet field | Lands on | **Why** |
|---|---|---|---|
| 32 | `status` | `Organization.status` | Enum; code branches on it. **`Insurer.isActive` is a DIFFERENT fact** — an office deactivating its relationship with a company is not the company ceasing to exist, and conflating them would let one office switch a company off for everybody. |
| 33 | `created_at` | `Organization.createdAt` | Server-set. |
| 34 | `created_by` | `Organization.createdByUserId` | Server-set. |
| 35 | `updated_at` | `Organization.updatedAt` | Prisma `@updatedAt`. |
| 36 | `updated_by` | `Organization.updatedByUserId` | Server-set. |

---

# C. The findings

Each of these is something a reader of the mapping alone would get wrong.

## C.1 `license_type_id` (broker #11) IS STORED AND NOTHING READS IT — measured

`Organization.brokerageKind` is written at registration by the service and the screen, and **read
by nothing**. Measured: every non-spec occurrence is a write, a DTO validator, or a label.

The column's own doc comment states the consequence it was created for:

> *Where this reads `REINSURANCE`, Instructions No. 9 of 2026 do not govern the office and their
> guards must not fire.*

**They fire.** Art. 3/a's one-type refusal, art. 4/a's capital warning and art. 10/a's registration
pack are all keyed on `type = BROKERAGE_OFFICE`, not on `brokerageKind`. So a **natural-person
reinsurance broker would be refused a second insurance type under an article that, on this reading,
does not govern it** — and the direction is the unsafe one: the error runs *against* the office,
which is the same direction as the empty holiday calendar.

**Not fixed here, and deliberately.** Whether Instructions No. 9 of 2026 govern a reinsurance broker
is a reading of the regulation, not a code decision, and this module's correction 0.1 was exactly
the mistake of enforcing a rule under an article that did not carry it. What is wrong *today* is
that the comment claims a mechanism that does not exist — so the claim is recorded as a declared
gap rather than left as a sentence a future reader would trust.

## C.2 Ten fields the sheet marks MANDATORY are NULLABLE columns — and that is correct

`tax_no`, `country_id`, `city_id`, `address`, `phone`, `email`, `gm_name`,
`compliance_officer_name`, `compliance_officer_email`, `bank_id` are all mandatory on the sheet and
nullable in the database, enforced by the DTO instead.

**Why, and it is one reason rather than ten:** the sheet describes a **registration**, and the
column describes **every organization that has ever existed here**. A `NOT NULL` would have to be
satisfied by rows that predate the sheet — the default office, and db-test's — and the only ways to
get there are to invent values or to delete history. Both are worse than a DTO rule.

Where the answer was different, it was because the data allowed it: `legal_name_ar` **did** tighten
to `NOT NULL`, because zero rows lacked one. The rule is therefore *measure, then tighten if you
can* — not *leave it nullable because it is easier*.

## C.3 `Organization.brokerLicenseNumber` is a dead duplicate — measured, and still there

The licence number lives on the **term** (#12). The organization-level column predates the term
series and is now a second home for one fact. It is left in place rather than dropped in this
module, because dropping a column is cheap and dropping it *in the same pass that added
thirty-five* makes one migration answer two questions. Declared.

## C.4 Licence status: the sheet said four values, the honest answer is six

`NO_TERM_ON_RECORD`, `ACTIVE`, `RENEWAL_PENDING`, `EXPIRED`, `SUSPENDED`, `CANCELLED`.

The two the sheet's four would have lost are the two that matter most:

- **`NO_TERM_ON_RECORD` is not `EXPIRED`.** An office with no term recorded is *further* from
  compliant than one whose licence lapsed, because the lapsed office can at least show what it held.
  Collapsing them would report an expiry nobody ever recorded.
- **`RENEWAL_PENDING` is not `ACTIVE`.** An office past its printed expiry that filed on time may
  still practise; one that filed late or not at all may not. Both read "expired" on the certificate.

**And the extension past expiry is the owner's decision, not art. 11** — that article is one
sentence about a 45-day filing deadline and contains no extension. It is recorded as a decision with
art. 8/d of Law 12/2021 cited **by analogy**, which is a weaker claim than a rule, and is written as
one.

## C.5 The two certificates have PERMANENTLY different strengths of enforcement

| | Broker (#46) | Insurance company (#38) |
|---|---|---|
| Column | `BrokerLicense.certificateDocumentId` | `Organization.insurerLicenseCertificateDocumentId` |
| Enforcement | **`NOT NULL`** — the database | **the service only** |
| Pointer sits on | the **child** (the term) | the **parent** (the organization) |

**Neither is ever reasoned about by analogy with the other.** The same column shape creates a
circular foreign key in one direction and not the other: the organization must exist before its
document and the document before the pointer, so `NOT NULL` on the company side would make the row
un-insertable. The broker side is stricter **by accident of where the pointer sits**, not by a
decision that a broker's certificate matters more.

So: **do not "fix" the company column to `NOT NULL`.** It would reinstate a 500 on every insurance
company registration. The service's refusal is asserted on the **stored record**, and removing the
transaction's third statement kills that assertion alone — verified by plant.

## C.6 A company's licence is not a series, and a broker's is

Deliberate. This product governs a **brokerage** office's licence: art. 11's renewal deadline, art.
10/b's term end, art. 21/a/9's practising-after-expiry sanction. None of that applies to a company we
merely transact with. Giving the company a term series would build a regulator's filing cabinet for
an entity this system does not regulate.

## C.7 What the registration pack's "complete" does and does not mean

**"Both documents are recorded"**, never "both files can be fetched". This product has **no object
storage anywhere**: a `Document` holds a name, a `storageRef` nothing can retrieve, a classification
and an uploader.

This was a defect in my own wording, found by auditing the marker against decision 88 rule 4's
mirror. Rule 4 forbids the marker making a finding about the **office**; the owner's standing rule —
what the system *says* stays accurate — forbids it overclaiming about **us**, and the first version
read *"both documents are held in the system"*. Corrected, with the scope note stating what
"recorded" means, and pinned by a plant that restores the overclaim and kills exactly one test.

The **missing**-side wording is the dictionary's verbatim (field 48,
«هذه الوثيقة غير محفوظة في النظام») and is asserted rather than paraphrased — I had reworded it for
symmetry and put it back on reading the sheet.

## C.8 What the capital figure counts is unverified, and both screens say so

Art. 4/a's slabs count **branches within a type**, so the counting unit decides how much capital an
office must hold. The derivation counts rows of **our 32-line catalogue**. An unattributed reply to a
question put to the Central Bank states those 32 are a *commercial product* catalogue while the Bank
licenses against a shorter *regulatory* classification.

**Nothing is built on that reply** — no reference number, no signature, and it directs us to submit
a formal written request. The catalogue is **not** touched, because merging or renaming a line
changes what every existing licence means; and **no mapping column is added**, because an empty
column with no reader is the `dpoAlternateApproverUserId` precedent exactly. What exists is the
declared note on **both** surfaces that display the figure, through one shared translation key, so a
reader moving between them does not meet two accounts of how settled it is.

---

## Coverage, stated plainly

The rows below **add up**, which took a correction: my first version listed "placed differently" as
its own row, and it is a **subset** of the fields that land on a column, not a fourth category. A
coverage table that does not add up is a coverage table nobody has checked.

| | Broker | Insurer |
|---|---|---|
| Fields on the sheet | **50** | **38** |
| Land on a column | 47 | 37 |
| **DERIVED — no column at all** | 3 — #16 licence status, #44 licensed types, #50 pack completeness | 1 — #12 licence status |
| **CANNOT PLACE** | **0** | **0** |

Field #45 is counted as landing on a column, not as derived: the office's **capital** is stored
(`Organization.paidUpCapital`); only the **requirement** it is compared against is derived. Both
halves are on the screen and they are different facts.

Of the fields that land on a column, these are **placed differently from what the sheet says**, each
argued in its own row above — 10 on the broker sheet and 7 on the insurer's:

| | Fields |
|---|---|
| Broker | #1 (uuid, not `INT`) · #11 (enum, not an FK list) · #12 (on the licence **term**, not the organization) · #24–#27 (text, not FKs to people who do not exist yet) · #32–#34 (their **own table**, because a PI renewal is a new row) |
| Insurer | #1 (uuid) · #15 (**office**-scoped, not company-scoped) · #25–#27 (office-scoped) · #28 (enum, not an FK list) · #38 (nullable + service-enforced, permanently — § C.5) |

**No field is unplaced.** Eight carry a declared gap — the ones named in § C — and a declared gap is
not an unplaced field: the column exists, the value is stored, and what is missing is a rule or a
confirmation, named in `docs/deferred-register.md` against the module it belongs to.

### The owner's yardstick, applied to the sheet as a whole

> *Could the broker do this on paper today, and does the system ask him for anything the paper did
> not? Where it asks for more, there must be a reason statable in one sentence, or it comes off the
> screen.*

**Every one of the 88 fields is on the owner's own sheets**, so the sheet is the answer for 88 of
them. Three things the system asks for that the paper does not:

| It asks for | One-sentence reason |
|---|---|
| `subdomain` | This platform addresses an office by name in a URL, and the paper form has no URLs. |
| The two art. 10/a uploads (#48, #49) | It does **not** ask — absence saves, and the record is marked; the sheet itself carries «لا يمنع الحفظ». |
| `broker_kind` (#43) | Art. 3/a limits a natural-person broker to one insurance type, and without this field half of what the regulation distinguishes is unrecordable. |

And one thing the paper asks for that the system does **not** demand: the bank guarantee (#28–#31),
because it appears nowhere in Instructions No. 9 of 2026 — collected if an office has one, never a
reason to refuse.
