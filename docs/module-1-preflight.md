# Module 1 — pre-flight list

**Why this file exists.** The brief requires this list to reach the owner *before module 1 opens*. It
is a file rather than a message because module 1's own debts were already recorded in **three
different places** in `docs/deferred-register.md` — a dedicated section, four scattered rows in the
main table, and the named short pass — and a list spread across three places is a list nobody reads
as one thing. Nothing here is new: every row is carried from the register, with its measurement
re-checked on the date below.

**Measured 2026-10-15** against head `d3860db`, 145 migrations, both databases.

---

## 1 — THE SHORT PASS RUNS FIRST, AND ITS FIRST TASK IS NOT A FIX

The owner named three debts and placed them in a short pass of their own, between module 0's close
and module 1's opening. **All three must be re-identified before any of them can be repaired**, and
that is the honest state rather than a delay:

| # | The debt, in the owner's words | What searching by shape found |
|---|---|---|
| S1 | a **grants counter** exiting before measuring | `permission-reachability.py` runs clean — **exit 0, 509 grants**, 91 codes read by a page, 7 component-only, 10 covered pairs with no nav route, every figure printed. It HAD this defect once (a `== 491` pin against a real 502) and it is fixed by reading the count from the fixture's own header. No hard-pinned grant count remains under `scripts/`. **The figure moves with every permission change** — `CLAUDE.md` records it at 502 when item (i) ran it, and it is 509 today — which is precisely why it must not be pinned again. |
| S2 | a **screening comment** denying two columns that exist | Every "has no field / does not exist" comment in the screening module reads correctly today, including the likeliest candidate (`MatchThresholds` lacking an index signature — a true statement about a TypeScript interface). |
| S3 | a **segregation comment** citing a lifted refusal | `SELF_APPROVAL_REPORT_EXISTS` — the COMBINED-mode shipping gate that *was* lifted — appears nowhere in the tree, so a comment naming it would have surfaced. |

**Guessing at a location and writing it down would put a false entry in the register, which is the
defect class this module's close was spent correcting in three other places.** So the pass opens by
re-reading the three subsystems, and records what is actually there — including "nothing", if that is
the answer.

---

## 2 — WHAT IS HELD ON THE OWNER AND BLOCKS WORK

Each of these is a decision, not a task. Where the measurement contradicted the brief, the
measurement is stated.

| # | Held item | Measured state | What it blocks |
|---|---|---|---|
| H1 | **The provider operator cannot be reached on dev** | `operator@ibms.local` has no usable password — the seed hashes `randomBytes(32)`, so nothing knows one. The only route in is a password reset, which `ENABLE_DEV_RESET_TOKEN` would permit. I stopped deliberately: setting it changes the owner's credentials on the database she is about to walk. **Two steps before any screen: request the reset, then pair an authenticator** (`PLATFORM_OPERATOR` is `requiresMfaAlways`). | the owner's own walk; every authenticated screen |
| H2 | **`demo:release` is held** by standing instruction until decision 95's two items are done | Zero `demo.*` accounts exist on dev, so the script would report "No demo account is locked" and change nothing. | nothing — recorded so it is not run reflexively |
| H3 | **There is no office "B" on dev**, and the one brokerage office has **0 branches and 0 departments** | Re-measured 2026-10-15: dev holds `default [BROKERAGE_OFFICE]` — 12 roles, 12 users, **0 branches, 0 departments** — and `provider [PROVIDER]` (1 role, 1 user, 0 branches). Nothing else. db-test is unaffected and has plenty of both; its count is **not quoted here because that database is cumulative and the figure moves with every e2e run** (register entry 23's 101/71 of 2026-10-14 reads 104/72 today — the entry is dated, so it is a snapshot rather than drift). | **no branch-filter or branch-scoped step can be demonstrated on dev at all, by any office** — the finding generalises worse than decision 95 stated |
| H4 | **Registering three offices and two companies on dev** | Irreversible in one direction that matters: a second brokerage office breaks the `Sign up` link's bootstrap, which is why item 5 required the replacement be proven first. | the walk's registration steps |
| H5 | **46 Arabic reference-value descriptions** | `docs/module-0b-reference-values.md` exports 55 values across 8 reference tables and 4 enums; 9 carry text, 46 are owed. The owner's reason for the export stands: she will not describe a value she has not seen. | the reference tables reading correctly to an office |
| H6 | **The art. 4/a branch-counting unit** | `requiredCapitalForScope` counts rows of **our 32-line commercial catalogue**, not physical branches — which contradicts the brief's own wording and matches the dictionary's field 45 and the code's comment. An unattributed reply states the Bank licenses against a shorter regulatory classification (consistent with its published 18-general / 8-life form). **Nothing is built on it**: no catalogue change, no mapping column (the `dpoAlternateApproverUserId` precedent). Both surfaces that display the figure carry the declared note, through one shared i18n key. | the capital figure's correctness; arrives with the official annex |
| H7 | **Item 3's schema guarantee** | Measured and reported: the gap is larger than one constraint, because the provider legitimately holds six office-scoped codes. Not to be decided in either direction without the owner. | the separation guarantee |
| H8 | **The company-facing screen's rating** | **There is no company-level rating at all** — re-measured 2026-10-15 against the live schema: `Organization` has **no column matching `%rating%`**, and the only rating in the database is on `Insurer` (`financialStrengthRating`, `financialStrengthRatingAsOf`, `ratingAgencyId`), which is an **office-scoped relationship fact** — one office's view of a company, not the company's own. So item (f)'s specified company screen names something that does not exist. **And the tables are NAMED rather than counted**, because a count hides which ones: of what that screen would read, `Organization` (identity) and `InsurerLicensedLine` (licensed lines) are **OUTSIDE** the tenant-scoped set — they carry no `organizationId`, and the name is the mechanism — while `Document` (the certificate) and `Insurer` (the only home of a rating) are **INSIDE** it. So a company reading its own record crosses the scoping boundary in both directions on one screen, which is the design question, not a detail. | item (f)'s company half |

---

## 3 — WHAT MODULE 1 ITSELF BUILDS

| Item | Why it is owed | Note |
|---|---|---|
| **The warned-act mechanism, and the issuance gate that depends on it** | arts. 15/d, 19/a/3, 16/y/8 — specified in the module 0-ب brief's appendix | **Must not be half-built earlier.** |
| **The legal-values table** | م١٥/ي reads from it; the provider-owned home for regulator-set values | The broker–insurer remittance period **reads from here, never seeded at 30 days** — the dictionary's correction 6 says the sheet's `30` contradicts art. 15/i. |
| **`MAKER_CHECKER_REGISTRY` records no MAKER code** | It holds the checker permission and the database constraint, so half of every pair is recorded nowhere and the system **cannot answer the real segregation question** — does one role hold both halves. Surfaced only because a scan of mine rested on five maker codes that do not exist. | Record the maker code beside the checker code, so a pair is a pair in data. |
| **The readiness signal splits in two** | One name covers two different measurements. They must be named for what they measure: **checker concentration** (a control observation) and **both halves of one pair** (the hard rule). | **Nothing may call concentration a segregation breach** — a screen reporting a violation it did not measure is a false claim. Lands with the warned-act machine. |

---

## 4 — WHAT MODULE 1 MUST NOT DO

- **Do not change the seeded role's permissions.** `BRANCH_DEPARTMENT_MANAGER` holds seven checker
  permissions. Whether that is a breach **cannot be judged until the question above can be asked
  correctly**, and changing it first would settle by accident what the registry fix exists to measure.
- **Do not rename a permission as a first move.** The owner's instruction: a rename touches every role
  that holds it in every office, so it is the last option considered. The measured offenders are
  candidates for a corrected **description**, which is what a person reads at the moment of granting.
- **Do not touch the 32-line catalogue.** Merging or renaming a line changes what every existing
  licence means.
- **Do not add a column with no reader.** The `dpoAlternateApproverUserId` precedent: it existed for
  exactly this class of problem, acquired no reader, and is now marked superseded.

---

## 5 — THE STATE MODULE 1 INHERITS, MEASURED

| Figure | Value | Where it is pinned |
|---|---|---|
| migrations | **145** | `from-empty.sh`, applied to dev and db-test |
| permission codes | **226** | `permission-matrix.test.ts` |
| PLATFORM-scoped codes | **4** | `from-empty.sh` |
| provider grants | **10** | `office-administrator.e2e-spec.ts`, `PROVIDER_CODES` |
| maker/checker CHECK constraints | **16** | the migration's own assertion; `pg_constraint` both ways |
| `pairsScanned` | **17** | 16 registry entries **plus** `scanPolicyCheckingIssuerPair()` — a separate scan in the service, **not** a registry row |
| `db:divergence` | **24 / 24** | blind to partial indexes, CHECK constraints and RLS |
| (role, permission) grants in the seeded grid | **509** | NOT pinned anywhere, deliberately — `permission-reachability.py` reads it from the fixture's own header |

**The `pairsScanned` distinction is the one to carry forward**: the number is not the registry's
length, and reading it as such is what produced four stale pins and a stale mock in this close.

---

## 6 — ONE GATE IS MISSING, AND IT IS WORTH KNOWING BEFORE MODULE 1 EDITS A SCRIPT

**Four TypeScript files under `scripts/` are linted and typechecked by nothing** — register entry 32,
found while editing one of them during this very pass. There is no root `tsconfig.json`, and both
`lint` and `typecheck` are `turbo run`, which reaches workspaces only; `tsx` strips types rather than
checking them. This is not hypothetical for that class: `export-permission-catalogue.ts:107` carried
this project's only high-severity CodeQL alert.

**The fix has a precedent in this repo** (`packages/db/tsconfig.seed.json`) and is small. It is not
done here because adding a gate changes the build, which is outside both this close and the
three-item short pass the owner bounded. **Module 1 should decide whether to take it before it edits
any root script**, because the alternative is improvising a verification per edit — which is what was
done for the one-line counter fix in this pass, and the improvisation is the symptom.

---

## 7 — ONE THING WAS FOUND AND FIXED WHILE WRITING THIS LIST, AND THE RULE GENERALISES

Verifying this list's own figures found that **dev held 225 permission rows against db-test's 226**,
and the missing one was `provider.office.administrator.invite` — the code that gates the invite route
item (f) built. **On the owner's own walkthrough database the provider could not invite an office
administrator**, which leaves item (d) built and unusable: the precise failure the brief named item
(f) to prevent, one layer down.

**The cause is an asymmetry worth carrying into module 1.** The retention split's two codes *were*
on dev, because they arrived in a **migration**, applied to both databases by the same command that
proves the schema. Item (f)'s code arrived in the **seed**, which nobody had re-run on dev. Two codes
added in the same close, one present and one absent, on one database — and **no gate can see it**,
because `db:checksums`, `db:divergence` and `db:privileges` all compare the *schema*, while a
catalogue row is *data*.

**Fixed by `npm run db:seed`, with the delta measured rather than assumed**: full row counts before
and after differ by exactly `Permission 225→226` and `RolePermission 518→519`. Users, roles,
organizations, licences, holidays, insurers, branches and audit rows are unchanged, and the seed's own
log confirms `operator@ibms.local already exists — password untouched`. **Register entry 33.**

**The rule: after adding a permission, re-run the seed on DEV, not only on db-test.** The five
regenerations this repository already requires are all about generated *files*; none of them touches
the dev database.
