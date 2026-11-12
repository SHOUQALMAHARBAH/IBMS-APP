# The declared act — the seven callers, and which module owns each

**Written 2026-11-12, message 36 §3.** OWNER DECISION 126 names **seven** places where the system
warns, records and does not refuse. The record itself (`DeclaredAct`, migration
`20261217100000_declared_act_record`) is general from the first line because of that. **One is
wired in message 36: art. 15/d.** The other six are wired with their own modules.

This table is **read from the module papers, not re-decided here.** Where a paper does not name a
permission code, the cell says so rather than inventing one — a permission code is decision 127's
territory and the owner's.

| # | Site | Article | The module paper that owns it | The permission it will need | State |
|---|---|---|---|---|---|
| 1 | A quote request reaching fewer than three insurance companies | **م(15/د)** | `module-01-declared-action-and-legal-values.md` §٨.٤ | `declared-act.article-15-d.declare` — **minted in message 36 §4**, with the route that enforces it, and its template grant goes to the owner for ratification | **WIRED in message 36** (§4). The record, the texts and the service are in §3. |
| 2 | Booking an unpaid premium as a debt on the broker, or setting it off against commission | **م(19/أ/3)** | `module-04-premium-collection-and-client-money.md` | Not named by that paper. A `declared-act.article-19-a-3.declare` by the same convention, the owner's to ratify | Not built. ⚠️ **The adviser recommends a HARD BLOCK here**, not a declaration — see the note below. |
| 3 | The broker collecting a premium in the prohibited cases (group medical) | **م(16/ي/8)** | `module-04-premium-collection-and-client-money.md` | Not named. Same convention | Not built. ⚠️ **The adviser recommends a HARD BLOCK here too**, and calls this one «منع صلب حتمي» — inevitable. |
| 4 | Practising after the authorisation has been withdrawn | م(21) / م(82) | `module-01-declared-action-and-legal-values.md` (the licence standing derivation) | Not named | Not built. The licence gate refuses six issuance acts today; turning any of them into a declaration is a decision, not a refactor. |
| 5 | Issuing with approved staff below the minimum for the type | م(21/أ/12) area | `module-16-staff-fit-and-proper-and-dpo.md` | Not named | Not built. |
| 6 | The office manager also holding data protection | — | `module-16-staff-fit-and-proper-and-dpo.md` | Already built bespoke — see below | **BUILT, BESPOKE, AND STAYS THAT WAY FOR NOW** (decision 130, ruling 4). |
| 7 | One natural person approved for both life and general | م(3/أ) area | `module-16-staff-fit-and-proper-and-dpo.md` | Already a REFUSAL — see below | **A REFUSAL today, not a declaration.** Its turn is module 16's. |

---

## Caller 6 — built bespoke, and NOT touched in this batch

**Decision 130, ruling 4: «تبقى كما هي الآن»، وتُنقَل إلى سجل الأفعال المعلَنة العامّ مع مديول ١٦.**

`Organization` carries four `dpoManagerCombined*` columns — all-four-or-none by CHECK — which hold
the declaration that the office manager also holds data protection, including the sentence shown
verbatim. It predates the general record and it works.

**So the inspection report reads TWO places until module 16**, and that is a stated cost rather than
an oversight. Module 16 moves this caller into `DeclaredAct` **as a migration that carries the live
declarations** — not as a new write path beside the old one, which would be the second answer the
module paper forbids.

**⟶ Owed to module 16, recorded here so it is not rediscovered:** a migration that reads each
office's four `dpoManagerCombined*` columns and writes one `DeclaredAct` row per populated set, with
`site = 'OFFICE_MANAGER_HOLDS_DATA_PROTECTION'`. The columns' own `articleTextShown` equivalent is
already stored, which is why the move is possible at all — had it stored only a boolean, the
historical declarations could not have been carried and the move would have had to start from today.

## Caller 7 — a refusal today, and that is the harder change

`breachesNaturalPersonOneTypeRule` REFUSES. Decision 126 turns it into a declaration, which means
**going from "this cannot happen" to "this is recorded when it happens"** — the opposite direction
from every other caller, and the one that needs the most care: every row written before the change
means *this was impossible*, and every row after means *this was declared*. Module 16's, with its
own data question about what the existing rows mean.

## ⚠️ AND TWO OF THE SEVEN ARE WHERE THE ADVISER DISAGREES WITH THE DECISION

Measured in `docs/answers/legal-counsel-five-items-verbatim.md` (2026-11-12): the adviser advises a
**hard block** rather than a declaration for callers 2 and 3, *«وبشدة قانونية قاطعة»*, on the ground
that an acknowledgement does not cure the unlawfulness of the act and that building a path which
eases a prohibited money movement could make the developing company a *«مساعد أو شريك تكنولوجي»* in
the breach.

**OWNER DECISION 126 overrules that for five of the seven and keeps four refusals**, and decision 126
is explicit that the adviser's contrary advice is kept **verbatim inside the decision**, because an
overruled opinion that is deleted stops being an overruled opinion.

**This table does not re-open it.** It records that callers 2 and 3 are the two where the built
answer and the adviser's advice differ, so that whoever wires them reads decision 126 and the
adviser's text together rather than discovering the disagreement afterwards. **Which four acts stay
hard refusals is decision 126's own list, and the test for a fifth is its own: *is the harm
irreversible, and on whom does it fall?***
