# The design-pass register — WASEET 360

**Read this before re-walking any screen, and before starting one.** It is the row-by-row record of
the design batch: what each screen was, what changed, what it composes from now, its inline-style
count before and after, which suite asserts about what moved, and the commit. It is also the
**resume point** — a session that ends mid-batch leaves nothing in anybody's memory; the next one
reads this file and continues from the first screen with no row.

The owner's reason for it, in her own words: she will not re-walk a system to discover nothing
changed. The screenshots are how she reviews 113 screens without opening 113 screens, and they are
also how a design pass catches its own regressions, because a design pass breaks things silently and
a diff of two pictures does not.

---

## The two reference pages

They are the specification. Where this register, the batch brief and those pages disagree, **the
pages win** — she looked at the pages.

| | what it establishes | link |
|---|---|---|
| A | `/incidents` in real Arabic: page header, four summary tiles, filters, a table with status pills, a row expanded in place into two sections | https://claude.ai/code/artifact/e9313a21-71e9-4dd6-aef2-8822a2f2e4a0 |
| B | the sign-in screen with the logo animating on load, and the provider dashboard with percentage rings, a horizontal bar list and a segmented status bar | https://claude.ai/code/artifact/728f18e7-4f5d-445c-b925-74d7dbc07b3a |

What she approved, verbatim: the overall look («حلو جميل»), the four summary tiles («أشيك للموظف في
شغله و بكون عنده زي مختصر للمعلومات»), **font option 1 — Tajawal**, and on the second pair «بدي هيك
يكونوا الشاشات فيهم حياة و حركة مش زي قبل اشي بخزي بيسك بدون تنسيق ولا شغل».

**The Arabic PROSE on reference page B is not hers.** The pages were drafted for her to look at; what
she approved in writing is the appearance and the motion. So the sign-in screen's brand panel ships
with the mark and the product's name and **no pitch sentence and no capability chips** — those words
are on her list. `AuthFrame` carries a `pitch` slot so they drop in without moving anything.

---

## The baseline, measured before a line was written

Every figure here is the output of a command, with the command beside it.

| what | figure | command |
|---|---|---|
| page files | **111** (106 under `(app)`, 5 under `(auth)`) | `find apps/web/app -name page.tsx \| wc -l` |
| …of which carry inline styling | **110** | `grep -rl 'style={{' apps/web/app --include=page.tsx \| wc -l` |
| inline style sites, whole web tree | **1,511** across **169** files | `python scripts/measurements/inline-styles.py` |
| …of which in screens (outside `components/ui/`) | **1,455** | same |
| …of which already in the primitive set | **56** | same |
| design tokens declared | **140** | `grep -c -- '^\s*--' apps/web/app/globals.css` |
| ready-made primitives | **18** | `ls apps/web/components/ui/` |
| em-dash placeholder sites | **157** across **66** files | `python scripts/measurements/em-dash-placeholder.py` |
| `IBMS` in a string a person reads | **6** | see § The codename |
| a11y specs (axe) | **84** | `grep -rl '@a11y' apps/web/e2e \| wc -l` |

**Where the inline count stands after the pilot: 1,455 → 1,418 in screens** (login 2→0, payment-channels 5→1, incidents 15→1, internal-controls 19→2, plus the shared page frame and the auth styles), and **56 → 120 in the primitive set**, which is where those declarations went.

**That is the whole diagnosis: the product did not lack a design system, its screens did not use the
one it had.** 140 tokens and 18 primitives against 1,511 hand-written style objects.

---

## The brand, read out of the SVG source

Not sampled by eye. `grep -rhoiE '#[0-9a-f]{6}' …/02_Logo_Pack --include=*.svg | sort | uniq -c`:

| hex | occurrences | what it is | on white |
|---|---|---|---|
| `#1A3E66` | 102 | the navy — structure, headings, the rail | **10.91** |
| `#2072B8` | 75 | the blue — interactive | **5.05** |
| `#F4A921` | 44 | the amber — **one mark at a time** | **1.99** |
| `#4A5868` | 2 | the tagline grey; not a UI colour | 7.27 |

**The amber rule is a measurement, not a preference.** 1.99:1 fails every threshold there is, so it
is never text, never an icon stroke on a light surface, and never a fill behind body copy. It is a
solid fill with the navy written on it (**5.48**), or a mark on a dark field — the rail's active
indicator (**5.48** on the rail), one highlight, the logo. It is deliberately **not** a chart colour.

### The ramp, and the one pairing that fell

The old palette's `--brand-500` was `#4c7ea8` at **4.32** — it FAILED WCAG AA for normal text. The
re-anchored ramp puts `#2072B8` at 600 (the interactive FILL) and `#1A5E99` at 700 (brand-coloured
TEXT), because `#2072B8` on `--surface-sunken` measures **4.46** and would fail by 0.04 for a link
inside a filter bar.

**Reported rather than fudged:** the primary button's own label was white on `#3b6790` at **5.95**
and is now white on `#2072B8` at **5.05**. Both clear AA at every text size; the difference is the
cost of using the company's actual blue, and no colour was adjusted to hide it. Every other text
pairing holds or improves — `--ink-brand` goes **5.95 → 6.76**.

**And there was no WCAG pairings test to re-check.** Measured: the accessibility gate is axe over 84
Playwright specs, which reads RENDERED contrast on whatever a screen happens to paint and is silent
about a ramp step no screen has reached yet. `scripts/measurements/token-contrast.py` is the gate
that closes it — **32 declared pairings, both themes, all passing** — and its `SEPARATOR` class
exists because the first version gated every border at 3.0 and produced six reds on a palette whose
a11y suite is green.

---

## The codename

`IBMS` was the internal codename. The product is **وسيط 360 / WASEET 360**.

**Six occurrences reached a person, and the Arabic never carried the codename at all** — both i18n
strings say «النظام» and the Arabic email subject says «نظام إدارة الوساطة التأمينية». Only the
English side had it, which is its own small finding: the half nobody proof-read.

| site | what a person saw | now |
|---|---|---|
| `operations.ts` `secNotEnrolled` (EN) | "…before you can use most of IBMS" | WASEET 360 |
| `operations.ts` `secAccessEnds` (EN) | "Your access to IBMS ends: {at}" | WASEET 360 |
| `app/layout.tsx` `metadata.title` | the browser tab read `IBMS` | «وسيط 360 — WASEET 360» |
| `AppNavbar.tsx` | a hardcoded JSX literal `IBMS` — **invisible to an i18n grep** | the brand lockup in the rail |
| `mfa.service.ts` `ISSUER` | the entry in the user's authenticator app | WASEET 360 |
| `email-templates.ts` | 4 subjects/bodies | WASEET 360 |

**The TOTP issuer's consequence is recorded rather than discovered:** the issuer is baked into the
`otpauth://` URI at ENROLMENT, so this changes NEW pairings only. Anybody already paired keeps
seeing the old name in their phone until they re-enrol; there is no repair that reaches them and
none is needed, because verification reads the secret and nothing else.

**Not renamed, deliberately:** `IBMS_Full_Scope_Context_Document.docx`, cited by `sourceDocument` on
four SLA policies and rendered on `/sla-policies`. It is a CITATION of a real artefact and renaming
it would make the citation false.

**One correction of my own:** the metadata `description` was first replaced with an Arabic sentence I
had composed, which this batch forbids outright. It is English-only now. Measured before deciding:
the i18n tree holds **no** product tagline to slice — nine strings mention «المنصّة» and every one is
about a specific screen — so the Arabic is hers.

---

## The spacing scale — five steps, and no sixth

**4 · 8 · 12 · 16 · 22** px, through `--space-1` … `--space-5`. `--space-5` moved 20px → 22px.

`--space-6`, `--space-8`, `--space-10` and `--space-12` are **DELETED**, not deprecated. They were
going to be kept and migrated per screen until measuring found only **seven** sites read them and
every one was in a shared styles module or a primitive — so the migration was six edits rather than
a sweep across 110 screens. Deleting them is the form that cannot express the mistake: a bare
`var()` on an undefined property drops the whole declaration and `check:css-properties` fails by
name.

**The highest-leverage single change in the batch** is `pageStyle`'s padding: 110 screens read that
one constant, so all of them landed on the scale at once. `pageStackStyle` is the other half — a
column with ONE gap, so the space between a page header and its summary row is the same as between
the summary row and the table, on every screen, without any of them deciding.

---

## The gates this batch added

| gate | what it refuses | wired |
|---|---|---|
| `check:token-contrast` | a declared token pairing below its WCAG floor, in either theme | `npm run check:screen-pass`, `frontend` CI |
| `check:inline-styles` | **two** budgets, each of which may only FALL — screens and the primitive set | same |

Two budgets rather than one, for the reason `typed-identifier-inputs.py` already records: *a single
total lets one class be traded for another behind a green gate* — and here the trade is precisely
the migration being measured. The split immediately earned itself: `AuthFrame` and `IconField` were
first written into `components/auth/`, where the gate counted their 14 sites as a screen
**regression**, correctly, and the fix was to put a shared frame in the set it belongs to.

---

## Findings recorded, not fixed

Each is something the pass found and deliberately left, with what it would take to close it.

| # | finding | why it is left |
|---|---|---|
| 1 | **`check:raw-values` is structurally blind to a vocabulary stored as a free `String`.** It keys on field names typed as a PRISMA ENUM; `PaymentChannel.ownerType` and `.channelType` are `String` columns whose vocabulary lives in a schema doc comment. The gate reported *5 declared, 0 undeclared* while two undeclared raw renders sat on `/payment-channels`. | Widening it to every `String` column whose comment looks like a vocabulary is a matcher change with its own blast radius. The instance is fixed; the class is a decision. |
| 2 | **`check:css-properties` reads comments as code.** It flagged the very paragraph explaining the deleted spacing tokens, because the prose spelled one inside a `var()` call. | Teaching it to strip CSS comments would also blind it to a real reference inside a commented-out block — a trade worth its own decision rather than a change riding along with a design commit. |
| 3 | **The reference screen expands a row's detail on a toggle; `/incidents` renders it always.** | An expand/collapse is an INTERACTION change, which §4(h) forbids in this batch — and every assertion in that screen's 479-line spec that reads a log or an assessment would have to learn to click first, which is a design pass quietly weakening a suite. Proposed, not built. |
| 3b | **`four-states.py` reports `/incidents` as having an empty state, and it has none.** Measured: with no incidents the screen rendered a table header over nothing, while `incNone` had shipped in both languages with ZERO consumers since before this batch. The detector counts a `.length === 0` branch and that file has one — `inc.containmentActions.length === 0`, a PER-ROW check inside a cell. | The instance is fixed (the screen uses `incNone` now). Telling a screen-level empty branch from a per-row one needs more than a text match, so the gate is left and the class recorded. **Found by reading the screen, not the count.** |
| 3c | **The reference screen has a filter strip; `/incidents` gets none.** | A filter is new interactive functionality, and §4(h) says no altered logic. It also has a real consequence worth a decision rather than a default: a filter that hides rows can hide an overdue containment. Proposed, not built. |
| 4 | **Tajawal has no weight 600.** `--weight-semibold` resolves by the browser's own font-matching, which for a desired 600 with 500 and 700 available lands on 700. | Stated rather than discovered: a heading that reads bolder than its token says is the face not having that weight, not a bug. |
| 4b | **`aria-label` over a visible label is the most common defect this pass is finding.** Two of the three pilot screens carried it, FOUR controls in all, and in three of the four the two strings DISAGREED: `pcAccountAria` said four digits where the field accepts two to four; `incTitleLabel` ("Incident title") was better than the visible `incTitleFieldLabel` ("Title"); `incRootCauseLabel` was a placeholder doing a label's job, so a sighted reader had nothing left to read once they typed. An `aria-label` REPLACES the accessible name, so the two readers were told different things and nobody proof-reads the invisible one. | Fixed per screen as the pass reaches them, by making the informative string the VISIBLE label and withdrawing the duplicate key in both languages — four keys withdrawn so far. A gate for the class is worth considering and is not built here. |
| 4c | **`hardcoded-ui-english.py` reports 0 undeclared and misses two strings on `/internal-controls`** — a governance report an auditor reads. `'None'` was the violations figure when the count was zero: a ternary of bare literals inside a PROP VALUE, which failure mode 8 excludes by design because the identical shape is a `data-*` test hook elsewhere. And `Generated {…}` was a capitalised single word in front of a brace, which `PROSE` misses (it needs two words) and `BARE_TEXT_LINE` misses (its character class excludes braces). | Both instances fixed — the count is `٠` through `formatNumber`, and the generated-at line goes through `ReportProvenance`, which this product already decided on for exactly that line. **Mode 8 is NOT widened**: that script's own header records that tolerating more makes every bare call a finding. |
| 4d | **`ReportProvenance` was never exported from the `components/ui` barrel.** Found by the compiler when the first screen tried to compose it. | Exported. Worth a line because the component shipped with its own decision record and a `report-provenance` testid and could only be reached by a deep import — which is how a primitive stays unused. |
| 4e | **`/internal-controls/combined-duty-acts` is mocked by NO Playwright spec and its declared-acts half has never been exercised in a browser.** Found while writing that screen's capture: there was no working fixture to copy, so the first attempt was paraphrased from the type and silently rendered nothing. | The capture now exercises it. A real assertion on that section belongs with whoever owns COMBINED mode — it is the section the whole mode rests on. |
| 5b | **The collapsed rail is a STRIP, not a drawer.** Its `<details>` groups stay closed, so it costs about one brand lockup and one search field of height. | A drawer needs a toggle, a focus trap and an escape key — three pieces of BEHAVIOUR, which §4(h) does not allow this batch to add. It is the better answer whenever somebody is allowed to build it. |
| 5c | **The rail's layout lives in inline styles, which is why the responsive rule needs `!important`.** | Moving it to CSS is a larger change than a responsive fix should carry. Recorded so the `!important` is read as a consequence rather than as carelessness. |
| 6 | **The two new CI steps are committed locally and NOT PUSHED.** `check:token-contrast` and `check:inline-styles` are wired in `package.json` (so `npm run check:screen-pass` runs both) and their `ci.yml` steps sit in an unpushed commit: GitHub refuses a push touching a workflow file from a token without `workflow` scope, and this machine's keyring token holds `gist, read:org, repo`. **No credential was written to disk to get around it** — the credential-safety hook refuses that and is right to, since it cannot tell a credential store from a leak. | Needs one push with a `workflow`-scoped token, which is the owner's to make. Until then both gates are green locally and runnable by name, and CI simply does not run them. Recorded here rather than left as a silent gap, because a gate nobody runs is the thing this repository has paid for three times. |
| 5 | **The four other `(auth)` screens do not yet use `AuthFrame`.** `/login` links to `/forgot-password`, which still wears the old card. | They are screens in this batch and adopt the frame when the pass reaches them. |

---

## What the screenshots caught — the argument for them, in two findings

Both of these were invisible to every gate, every typecheck and every Playwright assertion. Both
were found by **opening the pictures**, which is the thing the owner asked for and the reason this
is not optional.

**1. The sign-in hero rendered almost WHITE in the dark theme.** The brand panel's gradient was
built from `--brand-800` / `--brand-900` — and **the ramp inverts**, which is the entire point of a
ramp: `--brand-800` is the navy `#1a3e66` in light and the pale `#d7e7f5` in dark. So the panel came
up pale, with white logo strokes on it and a `--nav-ink-muted` subtitle that vanished completely.
**The light theme looked perfect**, which is exactly how this class ships.

> **THE RULE IT EARNED: a surface that must stay dark in BOTH themes takes `--nav-*`.** Those are
> the one pair in the system deliberately dark either way — the rail is navy whichever way a reader
> sets their machine. A ramp step is for something that should FOLLOW the theme.

**2. THE SHELL NEVER COLLAPSED AT PHONE WIDTH, so all 106 authenticated screens were unusable on a
phone.** The rail is a fixed `--sidebar-width` column in a flex row and nothing narrowed it: at
390px the content column was squeezed to roughly a quarter of the screen and every Arabic word
wrapped character by character. No gate, typecheck or assertion could see it — a Playwright test at
the default viewport is a desktop — and §11.5 makes it part of done. Fixed in `globals.css` as one
rule, because it is one property of the frame all 106 render into; a per-screen fix would be 106
fixes for one defect.

> **AND THE FIRST VERSION OF THAT FIX WAS HALF-APPLIED, which the very next screenshot showed.**
> `sidebarStyle` is an INLINE style object, and an inline declaration beats any stylesheet rule
> whatever its specificity. The shell DID become a column — `shellRowStyle` happens not to set
> `flex-direction` inline — while the rail kept its fixed width and sat across 60% of the screen
> with the page ground beside it. **A half-applied media query is worse than none, because it looks
> deliberate.** Every declaration on the rail carries `!important` now, scoped to that one query,
> with the reason written beside it.

**3. A `data-testid` ON A CUSTOM COMPONENT IS SILENTLY DROPPED, AND TYPESCRIPT WILL NOT TELL YOU.**
TypeScript exempts hyphen-containing JSX attributes from excess-property checking, so
`data-anything` on any custom component type-checks and then goes nowhere. Moving a screen's
`<tr data-testid=…>` and its empty-state `<p data-testid=…>` onto `Tr` and `EmptyState` killed
**three hooks** — with `tsc` clean, the screens rendering perfectly, and `internal-controls.spec.ts`
(the spec for that very screen) still green, because the hooks belong to a DIFFERENT spec.

> The spec that reads them is `self-approval-report.spec.ts`, which I had not run. That is the miss
> shape this repository keeps recording: *which specs exercise what I touched* and *which specs
> assert about what I MOVED* are different questions, and the second is the one that bites. Here it
> was caught by my own screenshot capture failing to find one of the hooks — the pictures earning
> their keep a third time. `Tr`, `EmptyState`, `ErrorState` and `Note` forward it explicitly now,
> as a named prop so the support is visible in the signature.

**4. The access-self-review flag carried a dangling em dash inside its new pill.** The string ends
with a separator because it was written to run into the date beside it in running text. In a pill
there is nothing left to separate. Fixed by dropping the trailing separator — a strict substring of
what shipped, no word written.

**5. `/incidents` rendered a titled, empty card** for a reader whose grants reach no act on that
record — a DPO looking at an incident only `incident.contain` can move. A heading over nothing is
the emptiness this batch exists to remove, and it is the frontend directive's own rule one step up:
a control a role cannot use does not exist on their screen, so neither does the box it would have
sat in.

---

## Owed to the owner — ANSWERED 2026-10-29

Every row on this list is closed. Nothing on it was invented while it was open, and nothing was
widened when it closed.

| # | where | her answer | what it cost |
|---|---|---|---|
| 1 | the sign-in brand panel | **it needed no word from her** — it is in her own brand pack. The Arabic and English flyers carry the headline, the product sentence and six capability lines; reference page B composes three of them into this panel | `BrandPitch`, five key pairs. **The Arabic bytes came from the reference page's HTML, not from my reading of the flyer PNG** — transcribing Arabic from an image is where the shadda/vowel trap bites, and the reference is text that can be copied exactly |
| 2 · 2b | the five em-dash cells | **three words, not one** — «لم يُقيَّم بعد» (not done yet), «لا ينطبق» (does not apply), «غير متوفّر» (held, unresolvable), with the instruction that a site which does not fit one of the three KEEPS ITS DASH | three keys; **three of the five sites converted and two did not** — see the table below |
| 4 | `/client-accounting`'s receivables ageing | the word for the **1–30 days** bucket. The nearest shipping string, `dclmAgeing0To30`, covers DAY ZERO — which on a receivables report is the `current` bucket, a separate column — so pointing at it would be a false label. The other four headers converted | **OPEN** |
| 3 | the Arabic email subjects | **they carry «وسيط 360»** — they read as a generic description today, which was correct while the product had no name to show | three subjects, plus one body line as a stated judgement |

### Decision 60 — what converted, and what deliberately did not

Her instruction is half the decision: *do not substitute a different word, and do not widen these
three into a general vocabulary. If a site does not fall cleanly into one of the three, leave the em
dash and record the site.* A count cleared by stretching a word onto a site it does not fit is worse
than a count that stands.

| site | class | outcome |
|---|---|---|
| `/payment-channels` — owner name | the id is HELD and the owning row is gone | **«غير متوفّر»** — her third case verbatim |
| `/payment-channels` — bank name, `cash` channel | there is no bank to name | **«لا ينطبق»** — her own worked example |
| `/payment-channels` — bank name, transfer/cheque/card | nobody wrote it down | **DASH KEPT** — *not recorded* is not one of the three, and a cheque has a drawee bank and a card an issuer, so a blank there really is a gap |
| `/payment-channels` — account digits | same split, same treatment | `cash` → «لا ينطبق»; otherwise **DASH KEPT** |
| `/incidents` — containment actor | the id is HELD and did not resolve | **«غير متوفّر»** — her third case, named in her own table |
| `/incidents` — impact assessment never performed | the thing has not been DONE yet | **«لم يُقيَّم بعد»** — her first case, and the one her walk complained about by name |
| `/incidents` — empty containment log | no action taken yet | **DASH KEPT** — her first word is assessment-specific (*not ASSESSED yet*); *no action taken yet* is a different verb |
| `/incidents` — the three assessment fields, individually null | the assessment WAS performed and this field was not filled | **DASH KEPT** ×3 — reachable only on a row predating the `NOT VALID` completeness CHECK, and *assessed but blank* is none of the three |

**An unrecognised channel type falls to the dash, not to «لا ينطبق».** `channelType` is a free
`String` whose vocabulary lives in a schema doc comment, so a fifth value is representable, and
defaulting an unknown type to *does not apply* would be the system asserting something it cannot
know.

**AND THE NFC GUARD FIRED ON MY OWN TYPING OF HER WORD.** «لم يُقيَّم بعد» came out with the SHADDA
before the FATHA (`064A 0651 064E`); NFC orders by combining class, so the vowel (30) sorts before
the shadda (33) — `064A 064E 0651`. The two render identically and compare unequal. Normalising is
not editing her word (NFC is canonical equivalence, so it is the same text), and the reordering is
printed by the script that made the change rather than happening silently. This is the third time
that trap has been paid for here, and the first time a guard caught it before it reached a file.

---

## The commit that could not be pushed — RESOLVED 2026-10-29

`b804579` wires `check:token-contrast` and `check:inline-styles` into `ci.yml`, and GitHub refuses a
workflow-file push from a credential without `workflow` scope. **Its commit message still says
`UNPUSHED` and that is now false** — corrected here rather than by rewriting it, which is this
repository's own convention: a claim that was true when written is corrected beside itself, and
amending would have discarded the CI run that verifies the commit.

Two things worth keeping from the attempts:

**`git -c credential.helper=…` APPENDS to the existing list.** The first attempt supplied a
credential and GitHub still answered *refusing to allow an OAuth App … without `workflow` scope* —
the OAuth helper already configured on this machine answered FIRST and the supplied one was never
consulted. Clearing the list with an empty `-c credential.helper=` before adding one is what makes
the supplied credential the only source, and the error changed to a flat 403, which is how it became
diagnosable at all.

**A flat 403 and the workflow-scope message are different diagnoses.** `GET /repos/{owner}/{repo}`
reported `push: true`, which is about the ACCOUNT's access to the repo and not the credential's
grants — so it reads as permission the push does not have. What settled it was the shape of the
refusal: GitHub names `workflow` scope by name when that is the only thing missing, so a refusal
that does NOT name it means write access is absent entirely. That was fed back and corrected, and
the push then landed first try.

**The credential-safety hook refused two commands and both refusals were sound in shape.** Its
matcher is `(echo|printf|cat) … (SECRET|TOKEN|PASSWORD|…) … >`, and both commands genuinely
contained all three — once from a credential helper printing `password=` with a `2>&1` after it, and
once from `echo "=== token-contrast ==="` beside the same stream merge. Neither wrote anything to
disk; the `>` was a stream merge in both. It is reported rather than routed around, and the
measurement that matters is the one taken afterwards: `.git/config` holds no credential, no local
helper was configured, and `git grep` finds nothing in the worktree. The `-c` flags are transient by
construction.

---

## Group 6 — the three-way split, measured BEFORE any of it is changed

The brief required this number first, and that **nothing in the class be touched until it is
reported**. Nothing has been: the pilot changed no server message. What it changed on
`/payment-channels` and `/internal-controls` are CLIENT-side raw renders and hardcoded English,
which are different classes with different gates.

`python scripts/measurements/server-message-identifiers.py` — rows to a UTF-8 file, counts to the
console, because this host's console is cp1252 and the first run died partway through on an arrow.

| class | sites | what it is |
|---|---|---|
| **IDENTIFIER** | **424** across 80 files | the refusal interpolates an id — `Claim ${claim.id} is ${claim.status}` hands a reader a uuid at the moment they are already stuck |
| **ENUM** | **43** | a raw `SCREAMING_SNAKE` member where the product mostly has an Arabic word |
| **VOCABULARY** | **142** | a field, a permission code or a route — mostly DELIBERATE and mostly correct, reported so the other two are not inflated |
| scanned | **877** call sites, **609** carrying a readable message across **129** files | |

**THE FIGURE IS NOT THE REGISTER'S 97 OF 282, AND THE DIFFERENCE IS THE POPULATION rather than a
regression.** That measurement was taken over a narrower set; this one reads every
`throw new …Exception(` under `apps/api/src` outside the specs, which is 877 call sites. Reported as
measured, per the instruction.

**It is a REPORT and not a gate, and the counts are a starting point for reading rows.** The matcher
reads TEXT: a message interpolating a variable called `reference` may be carrying a human-readable
receipt reference (correct) or a surrogate key (not), and nothing can tell those apart without
reading it. And the owner's standing rule applies — a message whose vocabulary belongs to a module
goes to THAT module rather than being rewritten in a design pass.

---

## The screens

`inline` is `grep -c 'style={{'` on that screen's own file, before → after. `asserts` names the suite
that holds a claim about what moved — the question being *which suite asserts about what I moved*,
not *which suite exercises what I touched*.

| screen | what it was | what changed | composes from | inline | asserts | commit |
|---|---|---|---|---|---|---|
| **foundation** — tokens, Tajawal, the icon set, the brand mark, 7 primitives, the shell, the codename, 2 gates | 140 tokens and 18 primitives that almost nothing used; a navy sampled from a comp; the brand nowhere; `IBMS` in six places a person reads | the brand ramp re-anchored on the logo's own blue with every pairing measured; Tajawal through `next/font`; 21 inline-SVG icons at one stroke weight; the real logo geometry; `Tiles`/`FilterBar`/`DetailPanel`/`DetailSection`/`KeyValue`/`Note`/`TimelineLog`/`Ring`/`BarList`/`SegmentedBar`/`AuthFrame`/`IconField`; the rail carries the brand and an icon per group and the top bar carries a derived breadcrumb; five-step spacing with the four off-scale tokens deleted | — | 56 → 120 in the primitive set; screens unchanged at 1,455 | `globals-theme.test.ts`, `check:token-contrast`, `check:css-properties`, `check:inline-styles`, `navbar.spec.ts`, `sidebar-*.spec.ts`, `home*.spec.ts` | `f23fcbe` / `cf05491` |
| **`/login`** | one card, a plain `<h1>`, bare inputs, `opacity: 0.8` on the MFA prompt | the two-panel frame; the mark draws itself in on load with one slow ambient loop and two drifting glows; fields with the icon inside the control; `--ink-secondary` instead of opacity. **Nothing about what it does changed** — the credentials submit, the MFA branch, the forced-password-change redirect and the absent sign-up link are byte-for-byte the same | `AuthFrame`, `IconField`, `Button` | 2 → 0 | `auth.spec.ts` | `f23fcbe` / `cf05491` |
| **`/incidents`** | the reference screen, and the most crowded table in the product: SEVEN columns at `min-width: 92rem`, three of which held a whole containment log, a three-field impact assessment and the entire action apparatus inside table CELLS. No empty state — a header over nothing. No summary. `opacity: 0.75` intro. Two `aria-label`s over visible labels, both better than the labels they replaced | five narrow columns with the record opened in place underneath in three sections, which is the approved page's own arrangement; four summary tiles whose every label is a string the table itself already renders; the severity read by a bar AND its word; status and classification as pills; `incNone` finally rendered; `SkeletonList`; both duplicate aria keys withdrawn. **Every handler, permission check and refusal is byte-for-byte what it was** | `PageHeader`, `Tiles`, `Tile`, `Card`, `Field`, `Select`, `TextInput`, `TextArea`, `Button`, `Badge`, `Table`, `DetailPanel`, `DetailSection`, `KeyValue`, `TimelineLog`, `SkeletonList`, `EmptyState`, `ErrorState`, `ActionStatus` | 15 → 1 | `incidents.spec.ts` (479 lines; every testid and label locator preserved deliberately, which is why the detail is always rendered) | `f23fcbe` / `cf05491` |
| **`/payment-channels`** | a hand-rolled table; `{r.ownerType}` printed `customer` and `{r.channelType}` printed `bank_transfer` RAW at an Arabic reader; `opacity: 0.75` intro; a bare `<p>` for loading; status by font-weight alone; two `aria-label`s overriding their own visible labels, one of which said FOUR digits where the field accepts two to four | both vocabularies labelled from keys the screen already used in its own form four lines above; two summary tiles that partition the visible list; `SkeletonList`; a status pill; `Field` wiring every label by `htmlFor`; both duplicate aria keys withdrawn in both languages | `PageHeader`, `Tiles`, `Tile`, `Card`, `Field`, `Select`, `TextInput`, `Button`, `Badge`, `Table`, `SkeletonList`, `EmptyState`, `ErrorState` | 5 → 1 | `payment-channels.spec.ts` (two locators re-pointed, reversal stated in the spec) | `f23fcbe` / `cf05491` |

| **`/internal-controls`** | THREE hand-rolled tables on one screen, each with its own `min-width`, so a governance report scrolled sideways in three independent ways; a local `Stat` re-implementing `Tile` with `opacity: 0.7`, a literal `border-radius: 8` and a `margin`-based section rhythm; the violations heading coloured with the literal `#b91c1c`, which on a dark card is close to unreadable; `Generated {ISO-string-sliced-by-hand}.` as the provenance line; the literal English `'None'` for a zero count; `<p>Loading…</p>` twice | one `Table` primitive three times; `Tiles`/`Tile` with the violations tile going to the ALARM tone on a non-zero count; `ReportProvenance` for the generated-at line; the access-self-review row FLAGGED by a warning pill rather than by font weight alone; `SkeletonList` for both loading states; the page's four blocks on `pageStackStyle`'s single gap. **Not one colour literal and not one opacity left** | `PageHeader`, `Tiles`, `Tile`, `Card`, `Button`, `Badge`, `Note`, `Table`, `ReportProvenance`, `SkeletonList`, `EmptyState`, `ErrorState` | 19 → 2 | `internal-controls.spec.ts` | `f23fcbe` / `cf05491` |


### Batch 1 — 33 screens, and the converter that made them affordable

These share one shape and were converted together: `<main style={pageStyle}>`, an `<h1>` over a
`<p style={{ opacity: 0.75 }}>`, a hand-rolled `<table>` with its own borders and its own minimum
width, two `<p role="alert">` blocks, and a bare `<p>` for loading. Every one of those is a real
defect rather than a style preference:

* **`opacity` as muting is what `globals.css` itself bans.** It dims the BACKGROUND through the
  text and is the cause of this product's recorded a11y contrast regression. `--ink-secondary` is
  a colour with a measured ratio behind it.
* **A hand-rolled table carries its own `minWidth`**, so no two screens here agreed on when a
  table starts scrolling — and two of them had NO scroll container at all, which pushes the whole
  page sideways on a phone.
* **`0.2rem`, `0.3rem`, `0.4rem`, `0.75rem`, `1.75rem`** are all off the owner's five-step scale.
* **A bare `<p>` for a load error** is the fourth state done as an afterthought.

`scripts/measurements/` carries the converter used (committed with this batch). It is EXACT-MATCH
and REFUSES a file where a transform it was told to apply does not match — so a screen whose shape
differs is handed back whole rather than half-converted. Seven screens refused and are listed below
as still owed.

| screen | inline before → after | spec that asserts about it |
|---|---|---|
| `/claims` | 11 → 7 | `claims-queue.spec.ts` |
| `/complaints` | 13 → 5 | `complaints.spec.ts` |
| `/service-requests` | 10 → 6 | `customer-service.spec.ts` |
| `/communications` | 11 → 7 | `customer-service.spec.ts` |
| `/feedback` | 9 → 5 | `customer-service.spec.ts` |
| `/retention-cases` | 8 → 4 | `customer-service.spec.ts` |
| `/vendors` | 6 → 4 | `vendors.spec.ts` |
| `/documents` | 6 → 3 | `documents.spec.ts` |
| `/knowledge-base` | 3 → 0 | `knowledge-base.spec.ts` |
| `/information-assets` | 3 → 0 | `information-assets.spec.ts` |
| `/bcp-dr-plans` | 3 → 1 | `bcp-dr-plans.spec.ts` |
| `/internal-audit-findings` | 6 → 2 | `internal-audit-findings.spec.ts` |
| `/watchlist-sync` | 5 → 2 | `watchlist-sync.spec.ts` |
| `/privacy-notices` | 10 → 6 | `privacy-notices.spec.ts` |
| `/ropa-entries` | 11 → 8 | `ropa-entries.spec.ts` |
| `/data-sharing-approvals` | 11 → 7 | `data-sharing-approvals.spec.ts` |
| `/cross-border-transfers` | 9 → 5 | `cross-border-transfers.spec.ts` |
| `/dpia-screenings` | 8 → 4 | `dpia-screenings.spec.ts` |
| `/operational-pi-risk` | 8 → 4 | `operational-pi-risk.spec.ts` |
| `/renewal-cases` | 7 → 4 | **none — see below** |
| `/portfolio-analysis` | 3 → 0 | `portfolio-analysis.spec.ts` |
| `/profitability-analysis` | 3 → 0 | `profitability-analysis.spec.ts` |
| `/planning-export` | 6 → 2 | `planning-export.spec.ts` |
| `/kpi-dashboard` | 10 → 7 | `kpi-dashboard.spec.ts` |
| `/claims-analytics` | 13 → 1 | `claims-analytics.spec.ts` |
| `/insurer-performance` | 8 → 5 | `insurer-performance.spec.ts` |
| `/employee-performance` | 8 → 5 | `employee-performance.spec.ts` |
| `/dashboards/insurer-employee-performance` | 5 → 2 | `dashboards.spec.ts` |
| `/consent` | 16 → 12 | `consent.spec.ts` |
| `/transaction-monitoring` | 11 → 7 | `transaction-monitoring.spec.ts` |
| `/dsr` | 13 → 9 | `dsr.spec.ts` |
| `/audit-trail` | 6 → 1 | `audit-trail.spec.ts` |
| `/settings/insurance-lines` | 13 → 10 | `insurance-lines.spec.ts` |

**273 → 145 on these 33 screens.** `SCREEN_BUDGET` **1418 → 1290**.

**`/renewal-cases` HAS NO PLAYWRIGHT SPEC AT ALL** — found by running the filters through
`node scripts/playwright-specs.mjs`, which refuses a filter matching nothing, where
`npx playwright test` would have silently run a smaller suite and still passed. Recorded rather
than fixed: writing a spec for a screen is not a design change, and inventing one mid-batch is how
a batch stops being reviewable.

### Three screens got more than the mechanical pass

**`/claims`** — all three badges rendered in the identical grey pill, so the state a desk is
INFORMED of (the claim's status) looked exactly like the two it must ACT on (an unanswered insurer
follow-up, documentation not complete). This screen exists to answer *what needs me next*, and a
queue whose urgent rows look like its calm ones answers that no better than a list. Status stays
neutral; the two signals take `warning` and keep their words, because a colour is a second carrier
and never the only one.

**`/complaints`** — four `aria-label`s withdrawn, **two of them actively wrong**:
`complaintsCategoryAria` said «التصنيف» where the visible label says «التصنيف (اختياري)», so a
screen-reader user was NOT told the field is optional. That is the fourth and fifth instance of
this class in the batch. And a real defect: `c.escalations.length || "—"` rendered an em dash for
ZERO, so a complaint that was never escalated read identically to one whose count nobody knows.
`0 || x` is `x` — the recorded shortcut this product has now paid for three times.

**`/claims-analytics`** — its totals row carried `{ ...cellStyle, fontWeight: 600 }` once per
column: six inline style objects all saying one thing about the row they are in. `Tr` gained a
`total` variant, so a totals row is now a property of the row.

### Seven screens refused the converter and are still owed

| screen | why it refused |
|---|---|
| `/dashboards/claims`, `/dashboards/policy`, `/dashboards/financial`, `/dashboards/compliance` | their tables are tiny inline-styled key/count pairs with no local style constant — a `KeyValue` shape rather than a `Table`, and §7 says a dashboard needs more than a repaint anyway |
| `/employees` | no `errorStyle` import to convert; its error path is shaped differently |
| `/sla-policies` | its heading is not the `<h1>` + muted `<p>` pair |
| `/retention-disposal`, `/regulatory-compliance`, `/settings/users`, `/financial-report`, `/bank-reconciliation`, `/commission`, `/insurer-accounting`, `/client-accounting` | not yet attempted — the four heaviest are the crowded screens §4(c) is about and want hand work |

---

### Batch 2 — 40 screens, driven by the compiler

The converter grew five shapes it had not seen, each found by a screen refusing or by `tsc`
naming it: a heading with `opacity: 0.8` and no `maxWidth`; an `<h1>` with no description at all;
an import carrying `pageStyle` alongside other names; the MULTI-LINE import block prettier makes
once that list is long enough; and a cell whose style sits on its own line because it carries two
attributes.

**The error-paragraph transform was REPLACED rather than widened a fifth time.** It had grown a
variant per shape — bare, inline, carrying `data-testid`, carrying some other `data-` hook, wearing
`{{ ...errorStyle, marginTop }}` — and every new screen found one more. A list of shapes that grows
by one per file is a matcher that has not understood what it is matching. One rule now matches the
PARAGRAPH (`role="alert"` plus a style mentioning `errorStyle`, whatever else it carries), rides
any surviving attributes across, and DROPS a `marginTop` override on purpose, because
`pageStackStyle`'s own gap is what spaces a screen's children now.

**And the group was driven with automatic revert-on-failure.** The converter already refuses a file
whose shape it does not recognise; this covers the other half — a file it DOES recognise and gets
wrong — by letting the compiler arbitrate. Convert a group, typecheck once, revert exactly the
screens `tsc` names, repeat until it is quiet. **22 screens were reverted this way and are still
owed**, untouched, rather than shipped half-converted.

| screen | inline | screen | inline |
|---|---|---|---|
| `/audit-trail` | 1 → 1 | `/bank-reconciliation` | 15 → 5 |
| `/claims/[id]` | 2 → 2 | `/commission` | 14 → 6 |
| `/crm` | 13 → 12 | `/cross-sell/[id]` | 9 → 9 |
| `/cross-sell` | 11 → 10 | `/customers/[id]` | 38 → 35 |
| `/customers` | 8 → 7 | `/dashboards/executive` | 7 → 6 |
| `/dashboards/sales` | 10 → 9 | `/dpo-workspace` | 17 → 15 |
| `/employees/[id]` | 9 → 8 | `/employees` | 7 → 4 |
| `/insurance-programs/new` | 6 → 6 | `/insurer-directory` | 9 → 8 |
| `/insurers/[id]` | 10 → 10 | `/insurers` | 7 → 6 |
| `/leads` | 2 → 1 | `/needs-assessments/[id]` | 9 → 9 |
| `/needs-assessments/new` | 7 → 6 | `/needs-assessments` | 3 → 2 |
| `/opportunities/[id]` | 8 → 7 | `/policies` | 8 → 7 |
| `/prospects/[id]` | 2 → 2 | `/prospects` | 6 → 5 |
| `/provider-register-insurer` | 10 → 10 | `/provider-register-office` | 14 → 14 |
| `/rfqs/new` | 12 → 11 | `/risk-profiles/[id]` | 2 → 2 |
| `/risk-profiles` | 7 → 6 | `/sales-performance` | 7 → 5 |
| `/settings/duty-segregation` | 13 → 13 | `/settings/insurance-lines` | 10 → 10 |
| `/settings/org-units` | 0 → 0 | `/settings/users` | 19 → 16 |
| `/sla-policies` | 14 → 12 | `/up-sell/[id]` | 9 → 9 |
| `/up-sell` | 11 → 10 | `/vendors/[id]` | 4 → 3 |

**370 → 319 on these 40 files; `SCREEN_BUDGET` 1290 → 1239.**

### The `data-*` trap, for the THIRD time — and this one cost a test

`ErrorState` named `data-testid` explicitly, which was the pilot's own fix after three hooks were
silently dropped. **It was not enough.** Converting `/insurer-directory`'s error paragraph carried
its `data-line-error` across faithfully, into a component that dropped it — `tsc` clean, the screen
rendering perfectly, and the only thing that said so was a Playwright assertion looking for the
attribute.

The lesson is that naming ONE attribute does not close this class: a screen hangs its OWN hook on a
refusal, a pill, a cell. `Badge`, `Table`, `Td`, `Th`, `EmptyState` and `ErrorState` now all take
`{ [key: \`data-${string}\`]: string | undefined }` and spread it, so the forwarding is a property
of the SIGNATURE rather than a list somebody has to extend.

### Still owed after batch 2

22 screens reverted by the compiler, plus the ones that refused outright. The heaviest are the
crowded screens §4(c) is about and want hand work rather than a wider matcher:

`/retention-disposal` (70 sites), `/regulatory-compliance` (25), `/financial-report` (18),
`/settings/customer-import` (18), `/screening-matches` (17), `/rfqs/[id]` (17),
`/dashboards/policy` (17), `/dashboards/claims` (15), `/sla-dashboard` (22),
`/screening-health` (37), `/dashboards/financial` (18), `/dashboards/compliance`,
`/client-accounting`, `/insurer-accounting`, `/access-recertification`, `/customers/kyc-queue`,
`/customers/new`, `/employees/reveal`, `/insurance-programs`, `/insurance-programs/[id]`,
`/insurers/new`, `/opportunities`, `/prospects/new`, `/provider-offices`, `/rfqs`,
`/settings/email`, `/settings/roles`, `/company-record`.

---

### Batch 3 — the crowded screens §4(c) is about

`/retention-disposal` is the exemplar: SIX `<section>`s on one page, each a bare `<h2>` over a
table that brought its own borders and its own minimum width — 56rem here, 64rem there,
`width: 100%` somewhere else — so a reader scrolling the page met three different horizontal
behaviours and nothing said where one block of work ended and the next began. A section is a CARD
WITH A TITLE now, so the heading and the thing it heads share one surface. On a page with six of
them that is the difference between a page and a pile.

`scripts/measurements/design-pass-sections.py` is the tool, and it is a SECOND one rather than a
wider first because the shape is genuinely different. Both closing tags are found by PAIRING with
a depth count, never by a blanket replace: `</section>` and `</tr>` both nest, and a screen where
one section converts and another does not would get a `</Card>` closing a `<section>`.

| screen | inline | screen | inline |
|---|---|---|---|
| `/client-accounting` | 13 → 4 | `/financial-report` | 18 → 13 |
| `/insurer-accounting` | 14 → 4 | `/regulatory-compliance` | 25 → 21 |
| `/retention-disposal` | 70 → 57 | `/rfqs/[id]` | 17 → 17 |
| `/screening-health` | 37 → 33 | `/screening-matches` | 17 → 16 |
| `/settings/customer-import` | 18 → 14 | `/settings/roles` | 8 → 6 |
| `/sla-dashboard` | 22 → 19 |  |  |

**259 → 204 on these 11 files; `SCREEN_BUDGET` 1239 → 1184.**

### THE a11y SUITE FOUND A KEYBOARD TRAP EVERY TABLE IN THE PRODUCT HAD

52 axe violations on `/retention-disposal` the moment its six hand-rolled tables became six
`Table`s — `scrollable-region-focusable`. The component wraps its table in an `overflow-x: auto`
div, and **a scroll container nothing can focus is a region a keyboard user cannot scroll at all**:
everything past the fold is simply unreachable.

**THE HAND-ROLLED TABLES HAD THE SAME DEFECT AND THE SUITE NEVER SAID SO.** Each screen wrote its
own `<div style={{ overflowX: 'auto' }}>`, and axe raises this only when the region actually
overflows — so whether it was reported depended on the fixture's data being wide enough. Moving
every table onto one component is what made one fix reach all of them, and is also what made the
defect loud enough to see. `tabIndex={0}` is the whole fix; the focus ring goes with it, because a
thing that takes focus and does not show it leaves a keyboard user with no idea where they are.

No `role="region"`, deliberately: axe is satisfied by the tab stop, and a region needs an
accessible NAME to be worth announcing — a new string per table, in both languages, on 40-odd
screens. That is rule 8(d) work and is not this.

### The `data-*` trap, found twice more — so it is a guard now

Batch 2 fixed `ErrorState` and said naming one attribute is always one short. It was: `Tr` still
named only `data-testid`, so `/retention-disposal`'s `data-notice-for` and `/screening-health`'s
`data-capability` went nowhere; and `Card` named none at all, so two section hooks did too. That
is five components in three batches, every one found by a failing test rather than by the compiler.

`apps/web/test/data-attributes.test.ts` ends it: every component in `components/ui` must forward,
by spreading `...dataAttributes` or by a props type extending an `*HTMLAttributes` interface. The
exemptions are declared with a reason and the list **fails in both directions**, so a row cannot
outlive what it was for.

**AND THE GUARD HAD TWO HOLES OF ITS OWN, BOTH FOUND BY PLANTING IT.** The first version checked
per FILE, so planting the forwarding away from `Card` left `Card.tsx` still containing
`...dataAttributes` — `PageHeader`'s — and the guard passed on a component that had stopped
forwarding. The second checked for the bare name, which matches the DESTRUCTURE: a planted `Card`
that still collected the attributes and no longer spread them passed again. It matches
`{...dataAttributes}` — the spread onto an element, which is the thing that actually forwards —
and the plant now dies naming `Card.tsx#Card`.

It also named two things that were findings about the MATCHER rather than the code: two exported
predicates in `CombinedDutyReasonField.tsx` that return booleans and render nothing, and `Button`,
whose props are a named interface declared above the function so a per-component slice cannot see
its `HTMLAttributes` extension. The first is fixed by requiring the body to render markup; the
second by allowing that one route at file level, with the limit written down.

### Still owed after batch 3

`/retention-disposal` is 70 → 57 and the rest of it is FORMS rather than tables — the biggest
single remaining screen. Eleven more are reverted-by-compiler or refused and listed above; the four
`/dashboards/*` are a `KeyValue` shape rather than a `Table`, and §7 says a dashboard needs more
than a repaint anyway.

---

### Batch 4 — 19 screens, and the two tools learned to run after each other

Ten of these were batch 3's own screens: `design-pass-sections.py` converts sections and tables
and deliberately leaves the page wrapper alone, so they kept `<main style={pageStyle}>` and their
heading. Running the list converter over them afterwards is what finished them — and doing that
exposed three ways the two tools get in each other's way, each found by `tsc`:

**The row-pairing scan counted every `<Tr` opener**, including ones a previous tool had already
closed, so it went looking for `</tr>` tags that no longer existed and refused a file with
*"2 row(s) opened, 0 closed"* when nothing was wrong with it. It counts the UNCLOSED ones now.

**Both tools added their own `components/ui` import block**, and every name they shared became
`TS2300: Duplicate identifier`. `design-pass-imports.py` MERGES first, so it is idempotent — the
same tool run twice, or after a sibling, leaves one block.

**And the import-restore anchored on `^import .*$`**, which matches the first LINE of a
multi-line block — so the new statement was spliced inside an open `import {` on seven screens.
Repaired by a pass that finds that exact shape; the lesson is the same one the error transform
taught, that a pattern assuming a tree's shape reads it wrong.

| screen | inline | screen | inline |
|---|---|---|---|
| `/access-recertification` | 2 → 1 | `/client-accounting` | 4 → 2 |
| `/customers/kyc-queue` | 1 → 0 | `/customers/new` | 1 → 0 |
| `/employees/reveal` | 2 → 2 | `/financial-report` | 13 → 11 |
| `/insurance-programs` | 3 → 2 | `/insurer-accounting` | 4 → 3 |
| `/insurers/new` | 7 → 6 | `/opportunities` | 5 → 4 |
| `/prospects/new` | 1 → 0 | `/regulatory-compliance` | 21 → 20 |
| `/rfqs` | 4 → 4 | `/screening-health` | 33 → 33 |
| `/screening-matches` | 16 → 16 | `/settings/customer-import` | 14 → 14 |
| `/settings/email` | 4 → 4 | `/settings/roles` | 6 → 6 |
| `/sla-dashboard` | 19 → 19 |  |  |

**160 → 147 on these 19 files; `SCREEN_BUDGET` 1184 → 1171.**

### A notice that is not an error is wearing the error token — recorded, not converted

Fifteen screens use `style={errorStyle}` for something that is NOT a failure: a REDUCED-CAPABILITY
notice (*you can see this list, you cannot approve from it*) and permission refusals. The converter
removed their import and the compiler named every one, which is how this surfaced.

**They were NOT converted to `ErrorState`.** That would put a red danger box around a sentence
telling somebody the system is working as intended for their role — the opposite of what the
four-states work is for. The import is restored and the class is recorded: a reader cannot tell a
refusal they can do nothing about from a failure they should report, and `Note tone="info"` is the
shape this product already has for it. Choosing per site is a per-screen judgement rather than a
sweep, and it is owed.

### `/opportunities` HAS NO PLAYWRIGHT SPEC

The second screen found with none, after `/renewal-cases` — again by running the filters through
`node scripts/playwright-specs.mjs`, which refuses a filter matching nothing where
`npx playwright test` would have run a smaller suite and still passed. Recorded, not written.

---

### Batch 5 — the dashboards §7 is about, and the last seven wrappers

**EVERY SCREEN IN THE ROUTER IS OFF `pageStyle`.** 111 pages, 0 remaining, 101 composing from
`components/ui`.

| screen | inline | screen | inline |
|---|---|---|---|
| `/client-accounting` | 2 → 2 | `/company-record` | 1 → 1 |
| `/dashboards/claims` | 15 → 2 | `/dashboards/compliance` | 7 → 3 |
| `/dashboards/financial` | 18 → 6 | `/dashboards/policy` | 17 → 9 |
| `/insurance-programs/[id]` | 11 → 11 | `/leads/[id]` | 4 → 3 |
| `/page.tsx` | 2 → 2 | `/policies/[id]` | 6 → 5 |
| `/provider-offices` | 2 → 2 | `/rfqs/[id]` | 17 → 17 |

**102 → 63 on these 12 files; `SCREEN_BUDGET` 1171 → 1132 — and 1,455 → 1,132 across the batch.**

#### The dashboards got ordering and grouping, which is §7's own limit

Every figure is the same figure from the same field with the same formatting. `metricScope` is not
touched and decision 58 is not re-litigated — on `/dashboards/policy` each of the three figures
keeps its own `FigurePeriod`, passed through byte-for-byte into `Tile`'s `meta` slot, which is
exactly where a per-figure period clause belongs.

What moved: the headline figures became `Tile`s in one row instead of three stacked sections, so a
figure has the weight of a figure rather than being slightly larger text; the claims ageing became
a `BarList`, because four numbers side by side do not say which is the big one and *which bucket
holds the money* is the whole question on that desk; and the three loss-ratio breakdowns sit in one
`Card`, so by-client, by-line and by-insurer read as three cuts of one thing rather than three
screens.

**NO `Ring` FOR OPEN-VERSUS-CLOSED, and that is a measurement.** It is a proportion and the
component exists for one — but `Ring` REQUIRES a caption carrying the raw count, and no such string
ships. The nearest, `providerOfficesUsersValue`, reads *{active} active of {total}* and carries the
word ACTIVE, which is a different claim about a claim. Two tiles say the same two numbers with no
word invented.

**`/dashboards/policy`'s EXPIRING tile takes the alarm tone** — a reading of the screen rather than
decoration. A policy about to lapse is the one figure there somebody has to act on, and it sat in
the same weight as the other two. The label still says what it is; the colour is never the only
carrier.

#### FIVE ENGLISH COLUMN HEADERS ON THE RECEIVABLES AGEING REPORT, and the gate cannot see them

`AR_AGEING_BUCKET_LABEL` was a hardcoded ENGLISH-ONLY map in `apps/web/lib/`, rendered as the
column headers of `/client-accounting`: *Current*, *1–30 days*, *31–60 days*, *61–90 days*,
*90+ days* — on an Arabic-first product, on the screen that says what clients owe the office.

**`hardcoded-ui-english.py` reports 0 undeclared, correctly by its own rules**: it scans
`app/(app)` and `components/`, and this lives in `lib/`. That is the blind-spot class that script
already records against itself — *it had never scanned `components/` at all* — one directory
further out. Measured before being described: exactly TWO label maps in `lib/` hold Latin prose,
and the other (`LEAD_STATUS_LABEL`) has **no consumer at all** — dead English rather than a live
defect, because `LEAD_STATUS_LABEL_KEY` beside it is the bilingual one actually in use.

**FOUR OF THE FIVE CONVERT AND THE FIFTH DOES NOT.** `d31_60`, `d61_90` and `d90_plus` are
POINTERS at strings already rendering the identical range on `/dashboards/claims`; `current` is a
slice of `commonCurrentLabel` with its inline colon dropped, substring and NFC asserted. **`d1_30`
is left in English and recorded**: the nearest shipping string, `dclmAgeing0To30`, covers DAY ZERO,
and on a receivables report day zero is the `current` bucket — a separate column one place to the
left. Pointing at it would put a header over this column claiming a range it does not hold, which
is a false label and worse than an English one.

The header row now reads with four Arabic words and one English one. That looks unfinished because
it IS, and it is still strictly better than five English headers. **The word for *1–30 days* on a
receivables ageing report is owed to the owner.**

#### The last seven keep their headings, deliberately

`/company-record`, `/insurance-programs/[id]`, `/leads/[id]`, `/policies/[id]`, `/provider-offices`,
`/rfqs/[id]` and the home screen have DYNAMIC headings — a customer's legal name, a policy line,
the signed-in person's own name. That is not a page TITLE in the sense `PageHeader` means, and
making one into a title would have the frame claim the record is the page rather than that the page
is about the record. The heading stays; the wrapper, the error paragraphs and an off-scale `1.5rem`
margin are what changed.

**AND `/leads/[id]` AND `/policies/[id]` WRAP EVERY BRANCH IN A `<div>` RATHER THAN A `<main>`** —
four each, one per state. A page with no `main` landmark is a page a screen reader cannot skip to.
Recorded, not fixed: changing a page's landmark structure is more than a wrapper swap and wants its
own look.

---

### Batch 6 — what the two new captures showed, which no gate could

Three defects, all found by OPENING a screenshot rather than by any check, on screens that were
already converted and already green.

| What the picture showed | What it was | What changed |
|---|---|---|
| The two pickers in the filter row were a different colour from the two text fields beside them | `EntitySearch` rendered a bare `<input>` with **no `style` prop at all**, so the browser painted its own control chrome — a light box on a dark screen | `Field`'s `CONTROL` is exported and the picker wears it |
| `40000.000` and `20000.000` in a table, four centimetres under a tile reading `JOD 37,500.000` | The loss-ratio breakdowns printed the api's raw `Decimal` strings while the same screen's tiles went through `formatMoney` | Both money columns go through the money formatter |
| `0.5000` where a loss ratio belongs | THREE screens render a loss ratio and already rendered it TWO ways — `/claims-analytics` carried a private `ratioPct` reading `50.0%` | `formatLossRatio` in `lib/i18n/format.ts`; the private copy is gone and both readers point at it |

#### The ratio measurement inverted the first reading, which is why it is written down

The obvious move was to invent a percentage rendering for the dashboard. Measuring first found that
the considered treatment ALREADY EXISTED one screen over, carrying decision 55's capped marker in
the same cell — so this is the decision-42 shape resolved the right way round: one home for one
fact, rather than a third reading of it.

**`/renewal-cases` IS DELIBERATELY NOT CONVERTED, and that is a finding rather than a scoping
line.** Its wire carries `{ periodClaims, periodPremium, ratio }` and **no `ratioCapped`**, so that
screen cannot render the capped marker at all — and `CLAUDE.md`'s own record of decision 55 says
`(capped)` is the most dangerous of the eleven precisely BECAUSE the renewal workflow depends on
that number. Turning a clamped ceiling into a confident `100000.0%` there would make it read *more*
precise, not less. **Owed to the renewal module: `ratioCapped` on that view, before the screen can
say anything about it.**

#### «حسب الفرع» over a table of insurance lines, beside a filter for physical branches

Register entry 1's noun collision, live on one screen. `/dashboards/claims` carries both senses of
«فرع» at once: `dashBranchIdLabel` («اعرض فرعاً واحداً فقط») is a physical office,
`dashInsuranceLineLabel` («فرع التأمين») is a line, and `dclmByLine` read «حسب الفرع» — unqualified,
four centimetres below the branch filter, over rows reading «مركبات».

The other two are each unambiguous in themselves; the heading was the one that reads either way.
**No Arabic was typed**: «حسب» is `dclmByClient`'s own first word and «فرع التأمين» is
`dashInsuranceLineLabel` entire — both already rendering on this same screen — so the value is two
shipping runs joined, with both halves asserted as substrings and the result asserted NFC. The
English is written rather than sliced, the ordinary asymmetry.

---

### Batch 7 — owner decision 60's three words, and the 91 sites that keep their em dash

**16 of 107 converted.** `scripts/measurements/em-dash-sites.py` re-derives both figures; it writes
its rows to a gitignored UTF-8 file because this console is cp1252 and a row carrying Arabic or an
em dash kills the run — the treatment `server-message-identifiers.py` already takes, and exactly
how this script failed on its own first run.

#### The one class a matcher can recognise, and why only that one converted

Her ruling was classify-then-convert and her instruction with the words was explicit: *do not
substitute a different word, do not widen these three into a general vocabulary, and a site that
does not fall cleanly into one of the three keeps its em dash and is recorded.*

The three cases are distinguished by what the FIELD MEANS, which no matcher can read — `?? '—'` on
a name that did not resolve and `?? '—'` on a field that does not apply to this row are the same
five characters. One class is the exception, and it is the exception because **decision 48 already
settled it**: `displayNamesForUserIds` and its three siblings take IDS and return a Map, and a
MISSING KEY MEANS NO NAME AND MUST NEVER BECOME THE UUID. So wherever a view carries
`<something>Name` beside the id it was resolved from, a null is precisely *the value is held and
its name is unavailable* — «غير متوفّر», and not *never recorded* and not *does not apply*.

All sixteen were read; one needed checking rather than assuming. `/policies` renders
`policy.customer?.legalName`, which is an INCLUDE and not a resolver — measured,
`customer: { id; legalName } | null` on the wire while `customerId` is NOT NULL and always present,
so the id is held and the name is absent. Same case, different mechanism.

**Three of the sixteen are not JSX at all.** `/internal-controls`, `/settings/duty-segregation` and
`DpoAssignmentSection` interpolate the value into a translated sentence as `who`, so the em dash was
landing INSIDE prose — where a dash reads worse than anywhere else, because a sentence with a dash
in the middle of it does not read as a missing value.

#### The guard fired on its own first run, and both findings were my matcher

`declared-vocabulary.test.ts` gained decision 60's three properties beside decision 59's — there are
exactly three keys and the Arabic is hers verbatim; no FOURTH key carries one of the words; no
screen spells one as a literal. Its first run reported two offenders for «لا ينطبق» and **both were
legitimate strings**: `providerOfficesLicenceNotApplicable` reads «لا ينطبق — ليست مكتب وساطة»,
which is the richer string the owner herself named as where the word already ships, and a dashboard
paragraph uses «ولا ينطبق» as ordinary prose.

The matcher used CONTAINMENT where the hazard is EQUALITY: a second key whose value **is** the word
is a duplicate free to be reworded alone, while a longer sentence built from it is a different
string doing a different job. Corrected, and both plants then kill their own test by name — a fourth
key, and a screen spelling the literal.

#### The 91 that keep the em dash

Dates never recorded, free text nobody wrote, figures not yet captured, ids that resolve to nothing.
Telling *not recorded yet* from *does not apply to this row* needs the field's own meaning, which
her ruling reserves to a reader. They are listed by `em-dash-sites.py`, and a count cleared by
stretching a word onto a site it does not fit is worse than a count that stands.

---

### Batch 8 — the record shape, and a contrast defect no gate in this repository could see

`/customers/[id]` joined the capture set as the RECORD shape — the one shape missing from it, and
the screen a person spends most of their day on. Opening the picture found that the screen had
**kept its own markup**: eight `<section>`s with a bare `<h2>` and no surface behind any of them,
nine browser-default `<button>`s rendering as tiny grey boxes, and the record's own facts — the
masked national id, the contact phone and email, the reveal controls — sitting on the bare page
between two cards.

`design-pass-sections.py` had REFUSED that file with *nothing changed*, correctly: its markup is a
shape the converter does not recognise. That is the honest limit of a converter and the reason the
captures exist at all.

| | before | after |
|---|---|---|
| sections with a surface | 0 of 8 | 8 of 8 |
| bare `<button>` | 9 | 0 |
| the facts grid | on the page background | on a `Card` |
| correction forms | two unstyled toggles | `Button` + `Card`, in their own components |

**`SCREEN_BUDGET` 1132 → 1115**, and the ratchet is what produced the number: it refuses a budget
left ABOVE the real figure, because a ceiling that absorbs the next regression silently is worse
than no gate.

#### `opacity` as muting — the recorded contrast regression, in a second form

Eight of this screen's sites read `style={{ opacity: 0.8 }}` on body text. Measured from this
product's own tokens rather than asserted:

| pairing | 1.00 | 0.85 | 0.80 | 0.75 | 0.70 |
|---|---|---|---|---|---|
| `--ink-secondary` on `--surface-card` | 6.58 | 4.60 | **4.10** | **3.68** | **3.31** |
| `--ink-secondary` on `--surface-page` | 6.09 | **4.32** | **3.90** | **3.50** | **3.14** |
| `--ink-muted` on `--surface-card` | 5.22 | **3.82** | **3.47** | **3.13** | **2.87** |

`opacity` composites the text INTO its background, so muted text written that way drops below AA's
4.5 on a token that passes comfortably. `--ink-muted` fails at every value this tree uses.

**The a11y suite is silent about it, and that is why it needed a measure of its own**: axe
composites the colours it can resolve and reports the rest as INCOMPLETE, while the gate reads
serious/critical VIOLATIONS — so 85/85 green says nothing at all about this class.

**130 sites across 69 files tree-wide, now 120.** `scripts/measurements/opacity-as-muting.py`
carries the table in its own header and is a CI gate beside the other two design ratchets. It is a
ratchet rather than a ban because a reduced opacity on an icon, a divider or a disabled control is
legitimate and is not a contrast question — the rows are candidates to read. Planted: one more site
takes it to 121 and it exits 1 naming the class.

**And my own arithmetic was wrong by two.** I counted eight removals with `grep -c` and the script
measured six: two of the eight were inside COMMENTS, which the script strips and a `grep` does not.
The budget is the measurement, 120, not the 122 I predicted.

---

### Batch 9 — two English runs on the money screen, and a fixture of mine that was lying

Both found by opening `/client-accounting`'s capture, which batch 5 had changed and nobody had
looked at since.

#### `125d overdue` and `due 2026-08-20`, on the screen that says what clients owe

Built by a helper in the screen itself, so `hardcoded-ui-english.py` DOES scan the file — and still
reports 0, for a different reason from the `lib/` blind spot one batch earlier: its
`TEMPLATE_PROSE` pattern needs backticks **and two words**, and each of these carries exactly one
word beside an interpolation. **A one-word template literal is a ninth blind spot**, recorded
rather than fixed in the script — widening the word floor to one is how that gate starts flagging
every `${id}px` in the tree.

**The treatment is the sibling screen's, not a new one.** `/sla-dashboard` renders exactly this
concept — *how far past its deadline is the oldest one* — as `${overdueDays}d` with the meaning in
its column heading. So the figure stays a figure and the meaning comes from `statusOverdue`
(«(فات موعده)»), owner decision 55's own marker, already serving three screens, whose recorded job
is to sit beside a date or a figure and say the deadline has passed. The not-yet-due case renders
the DATE ALONE — `caColOldest` («الأقدم») already says what the column is and the English `due `
prefix added nothing. The third case keeps its em dash: *nothing is outstanding* is not one of
decision 60's three, and her instruction was that a site which does not fit keeps its dash.

**And the day count now goes through `formatNumber`**, which it did not — every other figure on
that screen does, and a bare `${n}` is the one place a digit could render differently from the
money beside it.

**A stale assertion was PINNING the English**, and it is re-pointed as a PAIR (the marker present
AND the English run gone) with the reversal stated in the test, rather than relaxed.

#### A role name that does not exist, in two of my own captures

`/client-accounting` and `/payment-channels` were both captured as `FINANCE_OFFICER`. **That role
does not exist** — the seeded name is `FINANCE_COLLECTIONS_OFFICER` — and `permissionsForRoles`
answers an unknown name with an EMPTY LIST rather than refusing. So both pictures were of a reader
holding nothing, with a two-link nav, and **they looked like pictures of the product.**

That is the recorded class this repository already asserts against one layer down, where the api
e2e helper carries a test whose only job is that *a mistyped code grants nothing*. Here the same
mistake sat in a FIXTURE, where nothing asserts at all — **a screenshot has no expected value,
which is exactly what makes a wrong one so quiet.** `screenshots()` now refuses an unknown role by
name and prints the twelve; planted, it fails the run.

**It also says something about the valve.** The instruction is to keep opening the captures, and
this is the second time opening one found a defect in the capture rather than in the screen. A
picture that cannot be wrong is not evidence either.

---

### Batch 10 — `/screening-health`, and CI caught a stale assertion in a file named after dates

`/screening-health` was the heaviest screen left after `/retention-disposal` at 33 inline sites: it
is the screen that answers *is sanctions screening actually working*, and it carried its own local
`card` style with a `1px solid` border and a hand-set `6px` radius off the scale.

| | before | after |
|---|---|---|
| sections | 10 `<section style={card}>` + an `<h2 style={{ marginTop: 0 }}>` | 10 `Card`s |
| muted text | 12 `opacity: 0.75` / `0.7` | `--ink-secondary` |
| error paragraphs | 6 `<p role="alert" style={errorStyle}>` | 6 `ErrorState`s |
| the local `card` | a second answer to what a surface looks like | deleted |

**`SCREEN_BUDGET` 1115 → 1100 and `opacity-as-muting` 120 → 108**, both ratchets refusing to be left
above the real figure.

**The count check found a sixth error paragraph I had not seen.** My pass asserted four single-line
sites, found a multi-line one it had not matched, and **refused with the file untouched**. A pass
that wrote what it could and reported success would have left two paragraphs behind on a screen
that now looks converted. One of the six carries a `data-testid`, which is why `ErrorState`
forwarding `data-*` matters — three hooks were lost to that trap earlier in this pass.

**And my comment-preserving branch produced invalid JSX**: a `{/* … */}` is a JSX EXPRESSION and
cannot sit inside an attribute value. The comment is worth keeping — it records why three strings
that bypassed the dictionary became one key — so it moved ABOVE the element, where it reads as what
it is.

#### CI caught a stale assertion in `locale-formatting.spec.ts`

Batch 9 removed the English `due ` prefix from `/client-accounting`'s oldest column. I ran the
specs that exercise that SCREEN — `client-accounting.spec.ts`, 3 of 3 green — and the spec that
mattered asserts about the THING I MOVED: a date rendered through two locales, in a file named
after dates. **`frontend` went red on the full Playwright step with three assertions pinning
`due 07/09/2026`.**

*Which specs exercise what I touched* and *which specs assert about what I moved* are different
questions, and CI keeps answering the second one. All three re-pointed with the reversal stated;
**the test's own property survives intact** — it proves the date genuinely re-renders through the
Arabic locale (D/M/YYYY, no leading zeros) rather than re-using the English string, and that the
MONEY deliberately does not, because `AR_LOCALE` is `'ar'` and not `'ar-JO'`. What came off each
assertion is the two English characters in front.

**The full suite is 915/915 now**, which is the gate this change needed and the one the recorded
rule already names for a cross-cutting web change.

#### Recorded, not done

`/screening-health`'s `row` style — a flex label/value pair used about thirty times — stays. `Note`
and `KeyValue` are the primitives for it, but thirty swaps is a second screen's worth of work and
the valve says a screen that needs more than a design pass gets recorded.

---

---

## The method, per screen

1. **Read what the screen is for.** Its purpose decides its shape. A screen showing one number is
   not laid out like a screen showing 200 rows.
2. **Structure before style.** Page header (title, one line on what the screen is for, primary
   action), then summary, then detail. **Do not invent figures to fill tiles** — a tile shows
   something the screen's own API already returns.
3. **Crowded screens get taken apart.** The test is one question: can a person tell, without reading
   everything, where they are and what to press?
4. **Replace inline styles with the primitives and the tokens.** A literal colour left in a screen
   is a defect: it is invisible to the dark theme and to the next brand change.
5. **The four states, every time** — loading, empty, refused, error.
6. **Arabic first.** Check every screen in Arabic, not in English.
7. **Both themes, and phone width.**
8. **Behaviour does not change.** If making a screen usable appears to need a behaviour change,
   record it above and move on.
