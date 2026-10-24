# Part F's three conditions, measured

**This is a REPORT. Nothing was registered, and nothing may be.** Dev registrations are the
owner's alone: one login inside an organization writes an append-only audit row and that
organization can then never be deleted. So this file says exactly what is missing and leaves
the registering to her.

Measured on dev, 2026-10-19.

---

## Condition 1 — three offices and two insurers registered

**NOT MET. One office short, and two insurers short of two.**

```
organizations on dev: 3
   BROKERAGE_OFFICE   Default Brokerage Office            sub=default        users=21 licences=1 insurerRows=11 kind=CORPORATE
   PROVIDER           GO Global                           sub=provider       users=1  licences=0 insurerRows=0  kind=-
   BROKERAGE_OFFICE   Rawabi Insurance Brokerage (demo)   sub=demo-office-b  users=9  licences=1 insurerRows=8  kind=CORPORATE
```

| What the condition asks | Held | Short by |
|---|---|---|
| three brokerage offices | **2** | **1** |
| two insurance companies registered | **0** | **2** |

### The 19 `Insurer` rows are NOT registered insurers, and the distinction decides the count

```
Insurer rows:        19
InsurerMaster rows:   9
```

Those nineteen are the two offices' **relationship records** against the nine-company global
catalogue — the office's own contacts, terms and due-diligence rating. Module 0-ب split that
noun from the company itself: a **registered** insurer is an `Organization` with
`type = INSURANCE_COMPANY`, created by `POST /provider/insurance-companies`, and **there are
none**.

So the condition is two short, not satisfied nineteen times over. Reading `Insurer.count()` as
the answer is the error this section exists to prevent.

### Two measured facts that correct standing claims in the register

* **`Branch` = 3 and `Department` = 3**, one each per organization. The register still says
  *"`Branch` and `Department` are 0 and 0 across the whole database"* and *"`seed:demo`
  creates no branch at all"* — true when written, and made false by this module's batch-1
  sweep (`ensureDefaultOrgUnitsForEveryOrganization`). The `/employees` branch filter now has
  something to show without anybody creating a branch by hand.
* **`demo-office-b` exists**, with 9 users. The register records *"office B does not exist (a
  reseed removed it)"*. It is back.

Both are doc rot of the class this module spent three days on, and both are recorded here
rather than edited into the register's historical rows.

### What the third office has to BE, or refusal 3 stays undemonstrable

Both existing offices are `brokerKind = CORPORATE`. Art. 3/a's one-type rule
(`breachesNaturalPersonOneTypeRule`) keys on `NATURAL_PERSON` and **cannot fire for either of
them**. So if the walk is to show that refusal, **at least one of the registrations must be a
natural-person office** — a sole establishment — and art. 10/a/1/a is what makes that the
right legal form for one.

### And the licence scope is empty on both existing offices

```
BrokerLicenseScopeLine rows: 0
InsurerLicensedLine rows:    0
BrokerLicense rows:          2
```

Both offices hold a seeded licence TERM and **neither has recorded what it is licensed for.**
Consequences for the walk, named rather than discovered on the day:

* `typesInScope` returns nothing for either office, so the derived licence **type** (decision
  67) renders empty.
* The art. 4/a capital warning counts branches per type, so with no branches it has nothing to
  band — the "no capital recorded" and "capital short" states are both reachable only on a
  **new** registration, where the scope is chosen in the form.
* Art. 3/a likewise has no branches to span.

So the three article behaviours are demonstrable **on the registration screen** and not on
either existing office. That is not a defect: registration is where the scope is entered.

### Registering a third office changes nothing about `/signup`

`soleOrganizationIdOrThrow` counts **brokerage offices** and already sees two, so the signup
link already refuses on dev with the sentence module 0-ب wrote for it. A third does not make
that worse and does not make it better.

---

## Condition 2 — the four refusals demonstrated

**ALREADY MET IN THE SUITE, over real HTTP. NOT YET SEEN BY HER.**

`apps/api/test/brokerage-office-registration.e2e-spec.ts` § *the four refusals* sends a real
request for each and reads the real answer, asserting **which** refusal fired by status and by
the sentence's own substance — its header states the reason: *"a 4xx that could be any of four
refusals tells a reader nothing about which control fired."*

| # | The refusal | What a person does to cause it | The answer |
|---|---|---|---|
| 1 | **The same establishment registered twice** | enters a national establishment number that already exists | 409 naming the business it belongs to, and saying one establishment is one organization whether office or insurer |
| 1b | **…and across organization TYPES** | registers as an insurance company an establishment already registered as an office | the same 409 — the read is platform-wide, deliberately |
| 2 | **Saving without the licence certificate** | leaves the certificate fields empty | refused at **three depths** — the DTO, the write, and `BrokerLicense.certificateDocumentId` being NOT NULL forever |
| 3 | **A natural person given two insurance types** | picks GENERAL and LIFE branches for a sole establishment | 422 citing art. 3/a, naming both types, and offering the two ways out (register CORPORATE, or stay inside one type) |
| 3b | **…and ONE type is accepted** | the same office, branches inside one type | **201** — the proof that the refusal is narrow |
| 4 | **The capital shortfall, WHICH IS NOT A REFUSAL** | enters paid-up capital below art. 4/a's summed requirement | **201 plus the shortfall on the response** — both halves asserted, because a test checking only the shortfall would pass against an implementation that also blocked |

Two sibling collisions sit beside refusal 1 and are worth knowing before the walk, because
they produce a 409 that is **not** the duplicate-establishment one: a reused `code` (offices
and insurers share one namespace) and a reused `subdomain`.

### What only her walk can show

`provider-register-office.spec.ts` names it: the api e2e proves the refusals, and what only a
screen test can prove is **what a reader sees** — that the form is sectioned by the data
dictionary's own groups, that the three fields nobody enters are *stated absences* rather than
missing fields, that "no capital recorded" and "capital short" render as different things,
that the art. 10/b expiry warning appears **after** a successful registration, and that a
server refusal reaches the reader **in the server's own words**
(`page.tsx:311` renders `ApiError.message`, never a generic sentence — decision 90).

So condition 2's remaining half is not a test to write. It is her seeing each sentence on the
screen, in Arabic, and judging whether it tells her what to do next.

### One inconsistency found while measuring this

The service and its spec **number the refusals differently**:

| | refusal 2 | refusal 3 |
|---|---|---|
| `office-registration.service.ts` | art. 3/a (line 188) | the certificate (line 308) |
| `brokerage-office-registration.e2e-spec.ts` | the certificate | art. 3/a |

Harmless in itself — all four exist, all four are proven — and a real hazard the moment
anybody cites "refusal 2" in a decision, a message or a screen. Recorded, not renumbered:
renumbering touches a comment in one file and a test name in another, which is a change, and
this batch is a report.

---

## Condition 3 — her own walk

**NOT MET, and nothing here can meet it.**

What the walk needs, in the order the system imposes it:

1. **Sign in as the platform operator** — `operator@ibms.local`, the single user in `GO Global`.
   The seed's own log confirms the password is untouched; it is hers and is not in this
   repository.
2. **Pair an authenticator** at Settings → Security. `MfaRequiredGuard` refuses every other
   route until TOTP is paired, and the shell banner says so. The provider's roles carry
   `requiresHardwareToken = true` and this product has no WebAuthn — the
   `secHardwareKeyPending` banner already states that there is nothing for her to do and that
   the authenticator code is what satisfies the requirement, so this is a note, not a blocker.
3. **Register the third office** at `/provider-register-office`, one of them a
   **natural-person** sole establishment if refusal 3 is to be shown.
4. **Register two insurance companies** at `/provider-register-insurer`.
5. **Walk the four refusals on the screen**, reading each sentence rather than the status code.
6. **Then the two things she measured for herself on 17 October** become walkable: the roles
   screen's scope filter, and whether an invited office administrator can create a role and a
   user.

### What must NOT happen before she walks

* **Nothing registers an organization on dev but her.** A login inside one makes it permanent.
* **The system must not change under her** — the standing rule from the first walk. Batch 4
  changed eight translation strings and added two reports; no route, no schema, no grant.
* **`seed:demo` must not be re-run.** It would act on the offices she is about to walk.

---

## The three conditions in one line each

| Condition | State | What closes it |
|---|---|---|
| three offices and two insurers registered | **2 offices, 0 insurers** | three registrations, by her, one of them a natural person |
| the four refusals demonstrated | **proven over HTTP; not yet seen** | her reading the four sentences on the screen |
| her own walk | **not started** | sign in, pair, register, read |

Nothing in Part F is blocked by missing code. All three conditions are blocked on acts only
the owner may perform, and the first two cannot be closed by a test.
