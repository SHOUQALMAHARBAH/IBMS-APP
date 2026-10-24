# The field-by-field report against `WASEET360_Broker_Insurer_Data_Fields_v5.xlsx`

**This is a REPORT. No field was added, no column was created, and no screen changed
because of it.** Batch 4 of the module 0 closure said report, do not build — and the money
half of what follows is inside the freeze that holds until module 7 besides.

Governing version: **v5**, named by decision 19. Read from
`C:\Users\user\Downloads\IBMS-DOC\WASEET360_Broker_Insurer_Data_Fields_v5.xlsx`.

---

## 0. The counts, measured rather than quoted

The brief gave **53 broker / 41 insurer / 19 agreement**. The file gives something else, and
the file is the authority:

| Sheet | Arabic name | Numbered field rows | The brief said |
|---|---|---|---|
| 3 | الوسيط | **50** (1–50, contiguous) | 53 |
| 4 | شركة التأمين | **38** (1–38, contiguous) | 41 |
| 5 | اتفاقية الوسيط-الشركة | **16** (1–16, contiguous) | 19 |
| 6 | ائتمان وتوريد الوثيقة | **13** (1–13, contiguous) | "two fields" |
| 1 | دليل الاستخدام | — (the guide) | — |
| 2 | تصحيحات ١٣ تشرين الأول | 48 changelog rows | — |
| 7 | القوائم المرجعية | 11 lookup columns | — |

Each of the three is exactly **three** higher in the brief than in the file, which is the
signature of counting a title row, a header row and one more. The totals that matter are
**50 + 38 + 16 + 13 = 117** specified fields.

**The credit sheet is thirteen fields, not two.** The brief named two of them — the
agreement's maximum credit period and the actual credit period at policy level. Both are
there (agreement field 15, credit field 5). The other eleven are the clocks those two drive,
and section 4 below is the whole of them.

### The one place the brief contradicts the file

The brief said the credit period is recorded "with the system refusing to exceed the
maximum". **v5 decides the opposite, twice, and gives its reason both times.**

Credit field 5, verbatim: «**ولا يرفضها النظامُ عند تجاوز الحدّ الأقصى** (القرار ٩٠) — بل
يُنبَّه بنصّ الحدّ ومصدره (الفرعُ أو الاتفاقية)، ويُسجَّل التجاوزُ في سجلات المكتب كفعلٍ
منبَّهٍ عليه». And agreement field 15: «**وهو شرطٌ تجاريٌّ في الاتفاقية لا حدٌّ قانوني**،
فلا يُجعل مانعاً للحفظ (القرار ٩٠): يُنبَّه عند التجاوز ويُسجَّل، ولا يُرفض».

The stated reason is that the maximum is a **commercial** term an office may exceed with the
company's knowledge, so refusing the save stops legitimate work. That is the same shape as
decision 88 (the registration pack saves and is marked incomplete) and decision 90 (a
database constraint must never be the error message) — and it is the opposite of a refusal.

Building the refusal the brief named would have shipped a gate v5 deliberately declined.

---

## 1. The broker sheet — 50 fields

`Organization` (type `BROKERAGE_OFFICE`) plus `BrokerLicense`, `BrokerLicenseScopeLine` and
`ProfessionalIndemnityPolicy`.

**Held: 49. Short of the specification: 1.**

| # | v5 field | System | Verdict |
|---|---|---|---|
| 1 | `broker_id` INT PK | `Organization.id` **uuid** | different name and type |
| 2 | `broker_code` | `Organization.code` | holds |
| 3 | `legal_name_ar` | `Organization.legalNameAr` (NOT NULL) | holds |
| 4 | `legal_name_en` | `Organization.legalName` | different name |
| 5 | `trade_name` | `Organization.tradeName` | holds |
| 6 | `legal_form_id` | `Organization.legalFormId` to `LegalForm` | holds |
| 7 | `national_establishment_no` | `Organization.nationalEstablishmentNo` (unique) | holds |
| 8 | `cr_no` | `Organization.commercialRegistrationNo` | different name |
| 9 | `cr_date` | `Organization.commercialRegistrationDate` | different name |
| 10 | `tax_no` | `Organization.taxNumber` | different name |
| 11 | `license_type_id` | **derived**, decision 67 — v5 field 44 agrees | holds, derived |
| 12 | `license_no` | `BrokerLicense.licenseNumber`, one per **term** | holds, stronger |
| 13 | `licensing_authority_id` | `Organization.licensingAuthorityId` | holds |
| 14 | `license_issue_date` | `BrokerLicense.issuedAt` | different name |
| 15 | `license_expiry_date` | `BrokerLicense.expiresAt` | different name |
| 16 | `license_status_id` | **derived**, decision 71, six states not four | holds, derived |
| 17 | `licensed_lines` | `BrokerLicenseScopeLine` | holds |
| 18 | `country_id` | `Organization.countryId` | holds |
| 19 | `city_id` | `Organization.cityId` | holds |
| 20 | `address` | `Organization.address` | holds |
| 21 | `phone` | `Organization.phone` | holds |
| 22 | `email` | `Organization.email` | holds |
| 23 | `website` | `Organization.website` | holds |
| 24 | `gm_name` | `Organization.generalManagerName` | different name |
| 25 | `compliance_officer_name` | `Organization.complianceOfficerName` | holds |
| 26 | `compliance_officer_email` | `Organization.complianceOfficerEmail` | holds |
| 27 | `compliance_officer_phone` | `Organization.complianceOfficerPhone` | holds |
| 28 | `bank_guarantee_no` | `Organization.bankGuaranteeNo` | holds |
| 29 | `bank_guarantee_bank_id` | `Organization.bankGuaranteeBankId` | holds |
| 30 | `bank_guarantee_amount` | `Organization.bankGuaranteeAmount` `Decimal(18,3)` | holds |
| 31 | `bank_guarantee_expiry` | `Organization.bankGuaranteeExpiry` | holds |
| 32 | `pi_policy_no` | `ProfessionalIndemnityPolicy.policyNumber` | different table |
| 33 | `pi_limit` | `ProfessionalIndemnityPolicy.coverageLimit` | different name and table |
| 34 | `pi_expiry` | `ProfessionalIndemnityPolicy.expiresAt` | different name and table |
| 35 | `bank_id` | `Organization.bankId` | holds |
| 36 | `iban` | `Organization.ibanEnc`, **encrypted** | holds, stronger |
| 37 | `currency_code` CHAR(3) | `Organization.currencyId` **FK** | different shape |
| 38 | `status` | `Organization.status` `OrgStatus` | different vocabulary — see below |
| 39 | `created_at` | `Organization.createdAt` | holds |
| 40 | `created_by` | `Organization.createdByUserId` | different name |
| 41 | `updated_at` | `Organization.updatedAt` | holds |
| 42 | `updated_by` | `Organization.updatedByUserId` | different name |
| 43 | `broker_kind` | `Organization.brokerKind` `BrokerKind` | holds |
| 44 | `licensed_insurance_types` (derived) | `typesInScope`, in catalogue order | holds, derived |
| 45 | `paid_up_capital_per_type` | `Organization.paidUpCapital` — **ONE** figure | **SHORT OF THE SPEC** |
| 46 | `license_certificate_document_id` | `BrokerLicense.certificateDocumentId` NOT NULL | holds, stronger |
| 47 | `renewal_requested_at` | `BrokerLicense.renewalRequestedAt`, write-once | holds, stronger |
| 48 | `premises_tenure_document_id` | `Organization.premisesTenureDocumentId` | holds |
| 49 | `association_membership_document_id` | `Organization.associationMembershipDocumentId` | holds |
| 50 | `registration_pack_completeness` (derived) | derived; names and never counts | holds, derived |

### Field 45 is the one real gap, and it is the open question from the 0-ب close

v5: «م٤/أ تتدرّج بعددِ **فروع التأمين ضمن النوع الواحد** و«لكلّ نوعٍ على حدة» … فمكتبٌ
بالنوعين (٢٧ عامّاً و٥ حياة) مطلوبُه ١٠٠٠٠ + ٥٠٠٠ = **١٥٠٠٠**، لا شريحةً واحدةً من ٣٢ فرعاً.
**ويُعرَض التفصيلُ لا المجموعُ وحده.**»

The system stores `paidUpCapital` as a single `Decimal(18,3)` on the office. The art. 4/a
warning already **sums per type** and renders each type's own requirement, so the
*requirement* side is right. What is one column where v5 wants a figure per type is the
*recorded capital* side.

This is precisely the question the 0-ب close recorded as unsettled — *"the counting unit the
capital figure uses is not settled"*. v5 settles it: **per type, with the detail displayed,
not the total alone.** That is a schema change, so it is reported here and not made.

Note that the arithmetic v5 uses, `27 general + 5 life`, is the 32-line catalogue's own
split. Item 13's official count (18 general, 8 life/medical) disagrees with it, and decision
20 deferred that mapping until the names arrive from an authoritative source. The warning's
bands are unaffected either way; only the *number of branches per type* moves, and **v5 is a
data dictionary, not an authoritative source for that count.**

### Field 38's vocabulary

v5 wants نشط / غير نشط / موقوف. `OrgStatus` is `ACTIVE` / `SUSPENDED` / `DEACTIVATED` —
three values, same cardinality, and `DEACTIVATED` carries "has left the platform" where v5's
«غير نشط» is softer. Not a gap; a wording difference worth knowing before a screen prints
either.

### What the system holds that v5 does not name

`Organization.brokerageKind` — direct versus reinsurance brokerage. v5's field 11
(`license_type_id`) covers the same ground as a licence TYPE, and the lookup sheet lists
«وساطة تأمين مباشر / وساطة إعادة تأمين» under أنواع الترخيص. So **v5 puts that distinction on
the licence**, while the system also carries it as a column on the office that **nothing
reads** — register entries 20 and 42, still open, still unsettled. v5 does not resolve them
and is not read as doing so.

---

## 2. The insurer sheet — 38 fields

This sheet is where the system's shape and v5's differ most, and the difference is deliberate
on our side. Module 0-ب split one noun into two:

* **`Organization`** with `type = INSURANCE_COMPANY` — the company as a registered tenant,
  holding the company's **own** facts.
* **`Insurer`** — **this office's relationship** with a company: the office's own terms,
  contacts and judgements. Office-scoped, one row per office per company.

v5's single sheet mixes both, and the rows below say which side each lands on. The
server-side refusal built in the 0-ب close (`officeMayEditCompanyFacts`) is what keeps them
apart: a linked record's **company** facts are read-only to the office, while the office's
**relationship** terms stay editable.

**Held: 37. Genuinely absent: 1.**

| # | v5 field | System | Verdict |
|---|---|---|---|
| 1 | `insurer_id` | `Organization.id` (registered) · `Insurer.id` (office record) | two homes by design |
| 2 | `insurer_code` | `Organization.code` | holds |
| 3 | `legal_name_ar` | `Organization.legalNameAr` · `Insurer.legalNameAr` | holds |
| 4 | `legal_name_en` | `Organization.legalName` · `Insurer.legalName` | different name |
| 5 | `short_name` | `Organization.shortName` | holds |
| 6 | `legal_form_id` | `Organization.legalFormId` | holds |
| 7 | `national_establishment_no` | `Organization.nationalEstablishmentNo` | holds |
| 8 | `cr_no` | `Organization.commercialRegistrationNo` | different name |
| 9 | `tax_no` | `Organization.taxNumber` | different name |
| 10 | `license_no` | `Organization.insurerLicenseNumber` | holds |
| 11 | `licensing_authority_id` | `Organization.licensingAuthorityId` | holds |
| 12 | `license_status_id` (derived) | **nothing to derive from** | **ABSENT** — see below |
| 13 | `business_model_id` | `Organization.businessModelId` to `BusinessModel` | holds |
| 14 | `licensed_lines` | `InsurerLicensedLine` | holds |
| 15 | `fs_rating` | `Insurer.financialStrengthRating` | holds — **and v5 confirms the placement** |
| 16 | `rating_agency_id` | `Insurer.ratingAgencyId` to `RatingAgency` | holds |
| 17 | `country_id` | `Organization.countryId` | holds |
| 18 | `city_id` | `Organization.cityId` | holds |
| 19 | `address` | `Organization.address` · `Insurer.companyCorrespondenceAddress` | holds |
| 20 | `phone` | `Organization.phone` · `Insurer.companyPhone` | holds |
| 21 | `email` | `Organization.email` · `Insurer.companyEmail` | holds |
| 22 | `website` | `Organization.website` · `Insurer.companyWebsite` | holds |
| 23 | `quotation_email` | `Organization.quotationEmail` · `Insurer.rfqContactEmail` | holds |
| 24 | `claims_email` | `Organization.claimsEmail` · `Insurer.claimsContactEmail` | holds |
| 25 | `broker_relations_name` | `Insurer.brokerRelationsName` | holds |
| 26 | `broker_relations_email` | `Insurer.brokerRelationsEmail` | holds |
| 27 | `broker_relations_phone` | `Insurer.brokerRelationsPhone` | holds |
| 28 | `integration_method_id` | `Organization.integrationMethod` `IntegrationMethod` | holds |
| 29 | `api_endpoint` | `Organization.apiEndpoint` (carries no credentials) | holds |
| 30 | `bank_id` | `Organization.bankId` | holds |
| 31 | `iban` | `Organization.ibanEnc`, **encrypted** | holds, stronger |
| 32 | `status` | `Organization.status` · `Insurer.isActive` | holds |
| 33 | `created_at` | `Organization.createdAt` · `Insurer.createdAt` | holds |
| 34 | `created_by` | `Organization.createdByUserId` | holds on the master — see below |
| 35 | `updated_at` | `Organization.updatedAt` | holds on the master — see below |
| 36 | `updated_by` | `Organization.updatedByUserId` | holds on the master — see below |
| 37 | `fs_rating_as_of` | `Insurer.financialStrengthRatingAsOf` | holds |
| 38 | `license_certificate_document_id` | `Organization.insurerLicenseCertificateDocumentId` | holds |

### Field 15 closes an open question from the 0-ب close — in our favour

The close recorded: *"the rating is `Insurer.financialStrengthRating` — `Organization`
carries no `%rating%` column at all, which confirms the company screen's specified scope
names something that does not exist."* That was flagged as a possible defect in the spec.

v5 decision 64 settles it the way we built it: «هذا الحقل نطاقُه **المكتب** لا الشركة — فهو
التصنيف الذي سجّله هذا المكتب أداءً لواجب العناية في اختيار الشركة، لا حقيقةٌ عامةٌ عن
الشركة». The rating is the **office's** due-diligence record, not a public fact about the
company — carried with its agency and its as-of date, «لأن تصنيفاً بلا تاريخٍ دعوى لا سجلّ
عناية».

So the company registration screen is right to omit it; the office's relationship record is
the right home; and `financialStrengthRatingAsOf` beside it, conditionally mandatory when a
rating is entered, is also already built. **Nothing to change, and the open question closes.**

### Field 12 is the one structural gap

An insurer's licence standing is specified as derived, «كما في ورقة الوسيط». For a brokerage
office the system derives it from `BrokerLicense` (the term series) plus `RegulatoryAction`
(append-only CBJ acts). For an insurance company **there is no term model at all** —
`Organization.insurerLicenseNumber` is a single string, with no issue date, no expiry and no
series. `RegulatoryAction` already hangs off `Organization`, so the *action* half exists; the
*term* half does not, and a derivation with nothing to derive from cannot be built.

A real absence, recorded rather than closed. It is not the same size as the brokerage side:
our licence standing exists because art. 21/a/9 blocks a brokerage office's new business, and
this product holds no equivalent gate on an insurance company.

### Fields 34–36 — the office's own relationship record has no update trail

`Insurer` carries `createdAt` and nothing else. So "who changed this office's commission
contact, and when" is unanswerable **from the row**. `AuditLogEntry` carries the act, so the
information is not lost; what is missing is the column pair every other registered entity
here has. Small, real, reported. One column pair, not three fields.

---

## 3. The agreement sheet — 16 fields

This is the largest structural finding in the report.

**`CommissionAgreement` is a rate table, not an agreement record.** It holds who, which
line, what rate and from when — and none of the agreement's own facts.

**Held: 8. Absent: 7. Correctly absent: 1.**

| # | v5 field | System | Verdict |
|---|---|---|---|
| 1 | `agreement_id` | `CommissionAgreement.id` | holds |
| 2 | `broker_id` | `CommissionAgreement.organizationId` | holds |
| 3 | `insurer_id` | `CommissionAgreement.insurerId` | holds |
| 4 | `agreement_ref` | — | **ABSENT** |
| 5 | `start_date` | `CommissionAgreement.effectiveFrom` | different name |
| 6 | `end_date` | `CommissionAgreement.effectiveTo` | different name |
| 7 | `agreement_status_id` | — (derivable from the dates) | **ABSENT** |
| 8 | `collection_mode_id` — broker or insurer collects | — | **ABSENT** |
| 9 | `remittance_days` | — | **ABSENT** — and see the correction below |
| 10 | `agreement_file` — the signed contract | — | **ABSENT** |
| 11 | `line_id` | `insuranceLineId` · `officeInsuranceLineId` | holds |
| 12 | `commission_rate` `DECIMAL(5,4)` fraction | `ratePercent` `Decimal(5,2)` **percent** | different convention |
| 13 | `rate_effective_from` | `CommissionAgreement.effectiveFrom` | holds |
| 14 | `remittance_basis_id` | — | **ABSENT** |
| 15 | `max_credit_days` | — | **ABSENT** |
| 16 | `line_max_credit_days` | — | **CORRECTLY ABSENT**, dropped by decision 99 |

Field 16 is worth reading for its reasoning, because it is the only field v5 removes: «أُسقط
بالقرار ٩٩ … وجوابُ الوسيط الممارس في ملفّ الأجوبة: «رقمٌ واحدٌ للشركة كلّها» … **وجدولٌ لا
يملؤه أحدٌ شغلٌ بلا مقابل ويُثقِل الشاشة** (القرار ٩٠). … وأُسقط **بجواب الممارس لا
بتقديرنا**.» Dropped on the practitioner's answer, not on an estimate — the same standard
this register applies to itself.

### Field 12's convention differs, and ours is the one with money in it

v5 stores a fraction (`0.1500` = 15%) in `DECIMAL(5,4)`. The system stores a percent
(`15.00`) in `Decimal(5,2)`, and every commission already calculated, reconciled and remitted
in this product was computed from that convention. Changing it is a data migration over live
money. It is named here only so that nobody reads the sheet and "corrects" the column.

### Field 9 carries a correction that matters more than the field

v5: «المدّة سقفٌ قانونيٌّ مقدارُه **سبعةُ أيام عملٍ** لتوريد الأقساط إلى الشركة (وثلاثةُ
أيام عملٍ لتسليم المطالبات إلى العميل). والاتفاقيةُ قد تُقصِّر المدّة ولا تُطيلها. والقيمةُ
تُقرأ من جدول القيم القانونية الذي يملكه المزوّد، **ولا تُزرَع ٣٠ يوماً** — المثالُ السابق
(٣٠) مخالفٌ للنصّ ويجب ألّا يُزرَع.»

Three things in one cell:

1. **Seven business days is art. 15/ي's legal ceiling**, not a default. An agreement may
   shorten it and may never lengthen it.
2. **Thirty days must not be seeded.** An earlier version of this sheet carried 30 as its
   example, and v5 names that as contrary to the text. Nothing in this repository seeds a
   remittance period at all today, so there is nothing to withdraw — the instruction is
   recorded here so that when the field is built it is not built with that example.
3. The value belongs in **the provider's legal-values table**, not typed per agreement — the
   same shape as the 32-line catalogue and the eight reference lists.

`Insurer.creditTermsDays` exists today and is a **different** thing: the office's note of the
company's credit terms **to the office**. Three distinct numbers live in this area — the
agreement's remittance ceiling (art. 15/ي), the client's credit period, and the company's
terms to the office — and only the third exists.

---

## 4. The credit and remittance sheet — 13 fields

v5's own first row is the shape decision: **a row per instalment, not per policy.**
«الوثيقةُ المدفوعةُ مرّةً واحدةً دفعةٌ واحدة، والمقسَّطةُ عدّةُ سطور — ولكلّ دفعةٍ
استحقاقُها وتحصيلُها وتوريدُها. وبناؤه على الوثيقة أولاً ثم نقلُه إلى الدفعات **إعادةُ
عملٍ** تُتجنَّب من البداية.»

**All thirteen are inside the money freeze. None is built, and none should be.**

**Held: 6. Absent: 7.**

| # | v5 field | System | Verdict |
|---|---|---|---|
| 1 | `premium_instalment_id` | — | **ABSENT** — see the shape note |
| 2 | `policy_id` | `Invoice.policyId` | holds |
| 3 | `agreement_id` on the money row | — | **ABSENT** |
| 4 | `invoice_date` | `Invoice.createdAt` — a **system stamp**, not an enterable date | different thing |
| 5 | `credit_days` | — | **ABSENT** |
| 6 | `premium_due_date` (**computed**) | `Invoice.dueDate` — **stored and entered** | holds, wrong mechanism |
| 7 | `payment_status` (**derived**) | `Invoice.status` `InvoiceStatus` — **stored** | holds, wrong mechanism |
| 8 | `collection_date` | `Receipt.receivedAt` | different name |
| 9 | `remittance_due_date` (**computed**) | — | **ABSENT** |
| 10 | `remitted_date` | `Remittance.remittedAt` | holds |
| 11 | `remittance_ref` | — | **ABSENT** |
| 12 | `remittance_status` (**derived**) | — | **ABSENT** — named the most important indicator |
| 13 | `claim_payout_due_date` (**computed**) | — | **ABSENT**, author-added, claims module |

### How close the existing shape is — closer in one direction, not the other

`Receipt` is already **per collection**, and `Remittance.receiptId` is `@unique`, so a
receipt's remittance hangs off that receipt one to one. The **collected** half of v5's
per-instalment clock is therefore representable today.

What is not is the **scheduled** half: there is one `Invoice.dueDate` for a whole invoice, so
a policy paid in four instalments has one due date, not four. That is exactly the rework
v5's first row says to avoid, and it is already the shape here. Naming it now is the point of
this section.

### Two derived states the system stores

Fields 7 and 12 are specified **derived, not stored**, «على سَنَنِ حالة الترخيص (القرار
٧١)» — citing our own decision 71 as the precedent. `Invoice.status` is a stored
`InvoiceStatus` of six values. It is not a straight contradiction: `RECONCILED`,
`EXCEPTION_RAISED` and `EXCEPTION_RESOLVED` are collection-cycle positions that are **not**
derivable from dates and amounts, while `INVOICED` / `COLLECTED` / `REMITTED` largely are.
Reconciling the two is a module 7 decision and is recorded as one, not resolved here.

Field 12's own wording is the reason it matters: «**محصَّلٌ غيرُ مورَّد** هو أهمُّ مؤشّرٍ في
العلاقة مع الشركة، وهو بعينُه ما تحرسه المادتان (١٥/ي) و(١٥/ك): أموالُ أمانةٍ في حسابٍ
منفصلٍ لا تُرهَن ولا يُستوفى عليها فائدة». Collected-not-remitted is trust money, and the
state nothing can currently report.

### Field 9's calculation, and what it needs from module 2

v5: the remittance due date is **the earlier of two** — what the agreement says on its own
basis, and **seven business days from receipt** (art. 15/ي's ceiling). The reason is not
strictness: «تاريخٌ أبعدُ من سقفِ النصّ **يعتمد عليه الوسيطُ فيتأخّر وهو يحسب نفسه
ملتزماً**» — a date beyond the ceiling is one a broker relies on, and he is late while
believing himself compliant. Both dates are shown on one line when they differ.

**Counting business days needs module 2's calendar.** This repository's holiday table is
still empty (register § 1.57) and that error direction is already recorded as running against
the brokerage. A remittance deadline computed on an empty calendar lands **earlier** than the
true one — the safe direction for a deadline and the wrong direction for evidence.

### Field 13 is the author's own addition, and the direction nobody asked about

«الاتجاهُ المعاكسُ غائبٌ عن اقتراح العميل. المادة (١٥/ي) تُوجب تحويلَ مبالغ المطالبات
**للعميل خلال ثلاثة أيّام عملٍ من الاستلام** — وهي مهلةٌ على الوسيط كمهلة التوريد، وبلا حقلٍ
لا تُنبَّه.»

Three business days to pass a claim payment through to the client, from the same article as
the seven-day remittance ceiling, and a deadline **on the broker** exactly as the remittance
one is. v5 itself says build it in the claims module, not now.

---

## 5. What v5 asks for that is a rule rather than a field

Sheet 1 carries five design notes. Four are already how this product works; one is not.

| v5 note | System |
|---|---|
| Amounts `DECIMAL(18,3)` because the dinar divides into 1000 fils | **holds** — `money-decimal-jod` is a mandatory rule, and the money gate enumerates every such column |
| Rates stored as fractions (`0.15` = 15%) | **differs** — stored as percents; see agreement field 12 |
| Reference values are FKs to lookup tables, never free text | **holds** — eight reference lists, each with a mandatory Arabic description |
| Personal data restricted, IBAN encrypted, no secrets in these tables | **holds** — `ibanEnc`, `sensitive-data-handling`, and `apiEndpoint` carries no credentials |
| An audit log keeping the value before and after | **holds** — `AuditLogEntry`, append-only by trigger |

And the regulatory note: «حقول الكفالة البنكية والمسؤولية المهنية مصنفة "إلزامي شرطي"؛
تُراجع قيمها وشروطها مقابل تعليمات البنك المركزي الأردني النافذة». v5's corrections sheet
then performs that review and moves both:

* the **bank guarantee** drops to optional — it has no basis in Instructions No. 9 of 2026 at
  all, and «تُجمَع إن وُجدت، ولا تُطلَب، ولا يُرفَض مكتبٌ لغيابها، **ولا تُسمّى متطلباً
  تنظيمياً**»; the two financial requirements are paid-up capital (art. 4/a) and 50,000 JOD
  for more than five physical offices (art. 13/b/2);
* **professional indemnity** becomes mandatory without condition — art. 10/a/4 before final
  licence approval, art. 18/a/3 in the periodic returns — and its limit «يُجمَع الحدّ ولا
  يُفرَض له أدنى» because the minimum awaits a separate CBJ decision nobody holds.

Both are already how the system behaves: all four guarantee columns are nullable and gate
nothing, and the PI record is its own model with its limit collected and no floor imposed.
The thing worth keeping is the **wording rule** — the guarantee must not be named a
regulatory requirement anywhere a person reads it, which is the same clause as the
registration pack's forbidden words.

---

## 6. The whole report in one count

| Sheet | Fields | Held | Held under another name | Absent | Correctly absent |
|---|---|---|---|---|---|
| Broker | 50 | 34 | 15 | **1** | — |
| Insurer | 38 | 33 | 4 | **1** | — |
| Agreement | 16 | 5 | 3 | **7** | 1 |
| Credit | 13 | 4 | 2 | **7** | — |
| **Total** | **117** | **76** | **24** | **16** | **1** |

Counted from this report's own tables by reading the verdict column, not by hand — the first
hand-written version of this table was wrong in five of its twenty cells, which is why it is
derived.

**The 16 absences are not 16 jobs. They are four.**

1. **Paid-up capital per type** (broker 45) — one schema change, and it is the open question
   the 0-ب close recorded. The art. 4/a arithmetic is already per type; only the stored
   figure is not.
2. **An insurer licence TERM** (insurer 12) — without it, the specified derivation has
   nothing to read.
3. **The agreement as a record** (agreement 4, 7, 8, 9, 10, 14, 15) — reference, status,
   signed file, who collects, the remittance ceiling and its basis, the client credit
   maximum. Seven fields, one table, and `CommissionAgreement` is not it.
4. **The per-instalment credit and remittance clock** (credit 1, 3, 5, 9, 11, 12, 13) — seven
   fields, plus the module-2 calendar they depend on.

Three of the four are **money** and sit behind the freeze until module 7. One — the insurer
licence term — does not, and is recorded rather than scheduled.

And three things that are **not** absences against v5 and are recorded anyway:

* **`Insurer` has no update trail.** Insurer fields 34–36 are held on the company master,
  which is what that sheet specifies, so they are not counted absent. But the office's own
  relationship record carries `createdAt` and nothing else, so "who changed this office's
  commission contact, and when" is unanswerable from the row. One column pair.
* **The commission rate is stored as a percent**, not v5's fraction. Live money was computed
  from that convention.
* **`OrgStatus`'s vocabulary** differs in wording from v5's three values, not in cardinality.

None of the three may be "corrected" by someone reading the sheet without reading this.

---

## 7. What this report is not

It adds no field and schedules nothing.

It does not reopen decision 20 (the 26 official branches). The `27 + 5` arithmetic v5 uses in
broker field 45 is **not** an authoritative source for that count — v5 is a data dictionary,
and decision 20's reopening condition is the arrival of the names from an authoritative
source.

It does correct one thing the brief said, in section 0: the credit maximum **warns and
records, and does not refuse**. v5 says so twice and gives its reason both times.
