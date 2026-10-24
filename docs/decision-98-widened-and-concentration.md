# Decision 98 widened, and the data-protection concentration — two measurements

**Nothing in this document was built. No code was split and none was minted; the catalogue is 229
on both databases, unchanged.** Both measurements are committed as scripts so the numbers are
re-derivable rather than quoted:

```
python scripts/measurements/two-acts-one-code.py
python scripts/measurements/data-protection-concentration.py --live
```

---

## 1 — DECISION 98, WIDENED: codes that gate two acts of different consequence

### 1.1 The definition, in writing

Decision 98 as written is about dates — *every date or deadline button is a separate permission by
its own name*. The owner widened its **logic** beyond dates and set the definition; it is adopted
verbatim:

> A code gates two acts of **different consequence** when **at least one** act it gates is
> **irreversible**, or changes a record's **standing or disposal**, **and at least one other** act it
> gates is only a **read or a draft**.

Two exclusions follow from it and both are deliberate:

* **a code gating three reads does not qualify** — the owner's own example of what must not count;
* **a code gating three decisions does not either.** That is a code whose holder is trusted with all
  three, which is a different question from this one. It is worth stating because it is what removed
  five candidates when the vocabulary was corrected (§ 1.4).

### 1.2 How each act is classified — a declared vocabulary, not a guess

Classification cannot come from the HTTP verb: *log an alert* and *close an alert* are both `POST`,
and they are the two halves of the owner's own worked example. So:

| class | rule |
|---|---|
| **READ** | `GET`. A read changes nothing. |
| **CONSEQUENTIAL** | `DELETE`, or a path tail in `CONSEQUENTIAL_TAILS` — the verbs this product uses for an act that ends, approves, refuses, withdraws, disposes of, pays out or publishes. |
| **DRAFT** | everything else — a `POST`/`PATCH`/`PUT` that creates or edits a record some later act decides on. |

`CONSEQUENTIAL_TAILS` is written out in the script by name, grouped by *why*, and **every
classification the script makes is printed**, so a reader disagrees with a specific row rather than
with a total. The judgement calls left as DRAFT are named there too, with reasons — incident
containment, a DSR extension, the screening case machinery, the sweeps that create findings, and
recording the office's own licence facts.

### 1.3 The numbers

| | |
|---|---|
| **Codes examined** | **229** — the whole seeded catalogue |
| **Code–route pairs found** | **549** |
| Codes gating no route at all | 13 (read by a service or the web, or not yet enforced) |
| Unresolved composite code sets | **0** — so the enumeration has no holes it knows about |
| **CANDIDATES** | **24** |

**Scope stated rather than assumed.** The brief says "across module 0's codes". Module 0 added codes
across several modules, so the measurement covers the **whole catalogue** and reports each
candidate's module. Narrowing silently to a subset would have been the unstated-scoping failure this
module keeps catching.

### 1.4 The measurement argued with the first vocabulary, and the vocabulary moved

The owner's instruction was *argue with it if the measurement says otherwise*. It did. All **57**
DRAFT-classified routes inside candidates were read one at a time, and twelve were plainly
irreversible or plainly standing-changing, sitting in DRAFT only because their verb was not listed:
`decline`, `report-to-authority`, `fulfil`, `partially-fulfil`, `dpo-approve`, `deletion-override`,
`release`, `revoke-access`, `activate`, `reactivate`, `notify-client`, `certificate`.

**The delta, measured rather than reasoned about — 29 → 24:**

| | |
|---|---|
| removed | `aml.escalate`, `document.delete-override`, `role.deactivate`, `sla.policy.deactivate`, `vendor.deactivate` |
| added | none |

Every removal is a code that turns out to gate **two decisions** rather than a decision plus a read.
`aml.escalate` is the clearest: it gates *escalate* and *report-to-authority*, both irreversible.

**The delta can move in both directions**, which is why it had to be measured: a code holding
{READ, DRAFT} whose DRAFT becomes consequential starts qualifying, while one holding
{DRAFT, CONSEQUENTIAL} stops. So the figure is the output of a declared rule and not a fact about the
codebase — change a row in the vocabulary and the number moves.

### 1.5 The 24 candidates, with the role set each one produces

Reported with the holders **by name** because every split changes a role set, and that is the
owner's decision rather than something to discover afterwards.

**This table is GENERATED from the script's output.** The first version had the acts column written
by hand, and spot-checking six rows found four inaccurate and one plainly wrong — `insurer.update`
described as gating "link/unlink a company", which are different codes (`insurer.company.link`);
`user.manage` missing `deactivate`; `sanctions-pep.screen` missing `escalate`;
`retention.dispose.approve` missing `execute`; and `employee.update` credited with a `terminate`
that belongs to `deprovisioning.execute`. Reads and drafts are COUNTED and every consequential act
is NAMED from the route the script printed, so the column cannot drift from the measurement.
*(The generator was wrong first too: the printed line is `KIND  VERB /path   reason` and its first
regex captured the VERB, so every named act read `POST`. Caught by reading the generated table — a
generator's output is not evidence about the generator.)*

| code | module | acts it gates — reads and drafts COUNTED, every consequential act NAMED from its own route | held by |
|---|---|---|---|
| `aml.monitor` | compliance-risk | 2 reads; 2 draft/step; **close** | COMPLIANCE_OFFICER |
| `data-sharing.approve` | pdpl | 2 reads; **approve**, **decline** | DATA_PROTECTION_OFFICER |
| `deprovisioning.execute` | supporting-operations | 2 draft/step; **terminate** | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `dpia.review` | pdpl | 2 reads; 2 draft/step; **escalate**, **review** | DATA_PROTECTION_OFFICER |
| `dsr.handle` | pdpl | 4 draft/step; **fulfil**, **partially-fulfil**, **reject** | DATA_PROTECTION_OFFICER |
| `email.integration.manage` | insurance-operations | 1 read; 2 draft/step; **revoke** | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `employee.update` | supporting-operations | 3 draft/step; **delete branches** | BRANCH_DEPARTMENT_MANAGER, OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `endorsement.apply` | insurance-operations | 1 draft/step; **apply**, **notify-client** | PLACEMENT_TECHNICAL_OFFICER |
| `incident.contain` | compliance-risk | 3 draft/step; **close** | COMPLIANCE_OFFICER, OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |
| `insurer.deactivate` | insurance-operations | 1 read; **deactivate**, **reactivate** | OFFICE_ADMINISTRATOR |
| `insurer.update` | insurance-operations | 1 draft/step; **delete financial-strength-rating** | OFFICE_ADMINISTRATOR |
| `internal-audit.close` | compliance-risk | 2 reads; **close** | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER |
| `kyc.approve` | commercial-front-office | 3 reads; **approve**, **reject** | COMPLIANCE_OFFICER |
| `legal-hold.manage` | pdpl | 2 reads; 1 draft/step; **release**, **review** | DATA_PROTECTION_OFFICER |
| `license.manage` | compliance-risk | 3 reads; 4 draft/step; **delete scope**, **regulatory-actions** | COMPLIANCE_OFFICER |
| `needs-assessment.approve` | commercial-front-office | 1 draft/step; **approve**, **reject**, **review** | BRANCH_DEPARTMENT_MANAGER |
| `retention-case.manage` | customer-service | 2 reads; 2 draft/step; **close** | BRANCH_DEPARTMENT_MANAGER, SALES_RELATIONSHIP_OFFICER |
| `retention-schedule.confirm` | pdpl | 2 reads; **confirm** | COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER |
| `retention.dispose.approve` | pdpl | 4 reads; **certificate**, **close**, **dpo-approve**, **execute** | DATA_PROTECTION_OFFICER |
| `risk-profile.update` | commercial-front-office | 2 draft/step; **delete assets** | PLACEMENT_TECHNICAL_OFFICER, SALES_RELATIONSHIP_OFFICER |
| `risk-register.manage` | compliance-risk | 2 reads; 2 draft/step; **close** | BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER |
| `sanctions-pep.screen` | compliance-risk | 9 reads; 5 draft/step; **escalate**, **review**, **rollback** | COMPLIANCE_OFFICER |
| `service-request.manage` | customer-service | 2 reads; 3 draft/step; **cancel**, **fulfil** | BRANCH_DEPARTMENT_MANAGER, SALES_RELATIONSHIP_OFFICER |
| `user.manage` | admin | 3 reads; 2 draft/step; **activate**, **deactivate**, **revoke** | OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR |

Run the script for the per-route breakdown with each classification's reason; the table above is the
summary and the script is the authority.

### 1.6 Three things worth saying before any of these is split

* **`user.manage` is already a recorded decision not to split** — `IMPROVEMENTS.md` § 3.15 records
  the order if it is ever revisited: the last-administrator lockout guard anchors on it at four
  routes, and that guard is re-proven **first**. It appears here because the measurement is
  mechanical and does not know about the decision, which is the right behaviour for a measurement.
* **`sanctions-pep.screen` is the widest candidate** — 17 routes across three controllers, and its
  Arabic description is separately recorded as *actively false* (register § batch 5 group 4). A split
  here touches that line.
* **`retention-schedule.confirm` is held by COMPLIANCE_OFFICER *and* DATA_PROTECTION_OFFICER**,
  which is the pair the retention maker/checker concentration already names — so splitting it
  decides which of the two keeps which half. `retention.dispose.approve` is **DPO alone** and is the
  heaviest candidate by consequence: four reads and then *certificate*, *close*, *dpo-approve* and
  **execute**, which is the act this product declares it cannot undo. (This bullet originally named
  both codes as held by both roles — corrected against the measurement, which is the third error the
  hand-written prose in this section produced.)

**No Arabic name is proposed for anything here.** Decision 94 keeps permission naming with the owner
and her walk settles it.

### 1.7 Non-vacuity

Three floors, and the script **exits non-zero** rather than printing a short list:

1. the catalogue must yield more than 200 codes (it yields 229);
2. the sweep must find more than 300 code–route pairs (it finds 549);
3. **`aml.monitor` must come out as a candidate.** The owner measured that one by hand before this
   script existed, so it is a known-true answer the measurement has to reproduce. If the route
   parser silently stops resolving, that code drops out and the script fails by name.

---

## 2 — The data-protection / operational-management concentration

### 2.1 It is CONCENTRATION, and it is not a breach

The register's own rule, and it is not a wording preference. The **sixteen database CHECK
constraints still refuse one person performing both halves of a maker/checker pair**, whatever the
grants say. So what follows is who **could** be asked to do what — a control observation. Nothing
here is a violation that has occurred, and `docs/module-1-preflight.md` § 3 already records that
nothing may call concentration a segregation breach, because a screen reporting a violation it did
not measure makes a false claim.

### 2.2 The two sides, declared by name

Neither side is inferred from a module or a code prefix. A prefix sweep over `pdpl` would pull in
`dsr.log`, which SALES holds **deliberately** so a customer's request can be recorded by whoever
receives it, and would miss `legal-hold.manage`. So both lists are written out in the script and are
arguable — **18** data-protection codes, **17** operational-management codes.

**Side B is the management codes rather than every write in the product**, because the question
behind the conflict is whether whoever decides a privacy matter is the same person whose operational
decisions that matter is about. Placing a policy is operational work; deciding who may place one is
management. `policy.create` is on the list anyway, as the operational act the question is about.

### 2.3 (1) Seeded roles holding both sides — **4 of 12**

| role | data-protection | operational management |
|---|---|---|
| **DATA_PROTECTION_OFFICER** | **17** — consent, cross-border transfer, data sharing, DPIA, DSR handle + close, incident classify + both notifications, legal holds, privacy notices, the four retention codes, RoPA | **1** — `sla.policy.regulatory` |
| **COMPLIANCE_OFFICER** | 6 — regulator notification, privacy notices, retention set + confirm + extend + archive retrieval | **1** — `sla.policy.regulatory` |
| **BRANCH_DEPARTMENT_MANAGER** | 1 — `retention.dispose.nominate` | 4 — `commission-override.approve`, `employee.create`, `employee.update`, `refund.approve` |
| **PLACEMENT_TECHNICAL_OFFICER** | 1 — `consent.manage` | 2 — `endorsement.apply`, `policy.create` |

**The DPO's operational reach is exactly one code, and it is a regulatory deadline rather than a
business decision.** That is the most useful single fact in this measurement: on the shipped
template the privacy function is not also running the office. The overlap that is operationally real
is the **Manager's**, who nominates records for disposal while approving refunds, commission
overrides and recording people.

### 2.4 (2) Roles with both sides **and at least one active holder**

A seeded possibility nobody holds is not the same finding as a person who holds both, so the two are
reported separately.

| database | roles with both sides and a live holder |
|---|---|
| **dev** | BRANCH_DEPARTMENT_MANAGER (3), COMPLIANCE_OFFICER (3), DATA_PROTECTION_OFFICER (1), PLACEMENT_TECHNICAL_OFFICER (3) |
| **db-test** | the same four, at 139 / 251 / 326 / 280 holders |

**db-test's figures are not a finding about an office.** It is the cumulative e2e database — 985
users in one organization — and its numbers are reported only to show the query reaches real rows.
dev is the measurement that means something.

### 2.5 (3) Organizations where **one user** holds both sides

| database | organizations | users |
|---|---|---|
| **dev** | `default` | **7** |
| **dev** | `demo-office-b` | **3** |
| db-test | `default` | 985 (cumulative test data) |

This is the only one of the three questions that is about a **person** rather than a configuration.
On dev, **both** real offices have users holding both sides — which follows directly from § 2.3: any
holder of DPO, Compliance, Manager or Placement is such a user, and those are most of the seeded
accounts.

### 2.6 What is NOT built, and why

**No announcement.** What *constitutes* a conflict here comes from the legal adviser's answer on the
data-protection officer's independence, which the owner has not finished reading and will send as an
addendum. An announcement whose trigger is undefined either never fires or always fires, and both
are worse than none.

What **is** decided and is recorded for whoever builds it (decision 36): the disclosure is read
through **a permission the office grants to whoever it chooses**, with the office-manager role as the
**shipped template default** rather than a fixed holder; and **disclosing about oneself is not a
permission**, because the discloser is the subject of the disclosure — the same reasoning that leaves
`AccessRecertificationItem`'s maker permission empty.

### 2.7 Non-vacuity, and the six codes it caught

The script refuses to run if the catalogue yields fewer than 200 codes, **and refuses if any code it
names is absent from the catalogue.** That second floor fired on its first run and named six codes I
had written from memory:

| named | what exists |
|---|---|
| `incident.notify` | `incident.notify-regulator` **and** `incident.senior-management.notify` — two codes, both on side A |
| `commission.override` | `commission-override.raise` / `.approve` — a **pair**; the approve half is the management act |
| `permission.manage` | only `permission.read` exists |
| `role.permissions.manage` | does not exist; the matrix saves through `role.update` |
| `policy.place` | `policy.create` |
| `settlement.approve` | **no `settlement.*` code exists at all** |

The last one is **dropped rather than substituted**: guessing a near neighbour there is exactly how
`refund.raise` came to be recorded as a maker code that reads no route. This is the
phantom-permission class — the same one that had `insurer.relationship.manage` asserted as shipped
in two files — and the floor is what turns it from a silent under-measurement into a refusal.

---

## 3 — Decision 69's ninth element

Recorded in `docs/module-1-preflight.md` § 3.1, with both halves:

* the **ninth element** — besides the user's knowledge of the violation and the office bearing
  responsibility, an **explicit release of the developing company's liability**;
* and the **limit the same adviser stated beside it** — an acknowledgement **does not cure criminal
  liability** (*"an agreement to violate the law and public order is void"*), so the release protects
  the company **against the office, civilly**, and **not** before the Central Bank or a court.

Those ship together or neither ships. A note recording only the release would read as "we are
covered", and the adviser said the opposite about the half that matters most.

**MEASURED: decision 69 had no home in this repository at all** — the string appears in no file,
which my own group-6 row already reported when it went looking for the window. So § 3.1 is the home,
created rather than found, placed where module 1's own build list already names the warned-act
mechanism.

**The caller count is ONE — art. 15/d.** Searched before writing it: nothing in the tree claimed two,
so there was nothing to correct. It is recorded so the next reader does not re-derive it from a
struck decision. The warned-act row above § 3.1 cites three articles (15/d, 19/a/3, 16/y/8) — those
are callers of the **mechanism**, a larger thing than this acknowledgement box, and the two counts
are not the same question.
