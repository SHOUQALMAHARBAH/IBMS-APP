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

**2. `/incidents` rendered a titled, empty card** for a reader whose grants reach no act on that
record — a DPO looking at an incident only `incident.contain` can move. A heading over nothing is
the emptiness this batch exists to remove, and it is the frontend directive's own rule one step up:
a control a role cannot use does not exist on their screen, so neither does the box it would have
sat in.

---

## Owed to the owner — words only she can write

Nothing here was invented. Each row is a place the product needs a word that is neither already
shipping nor derivable by slicing a shipping string.

| # | where | what is needed | measured |
|---|---|---|---|
| 1 | the sign-in brand panel | the product's own sentence, and three capability chips | the i18n tree holds no product tagline; nine strings mention «المنصّة» and all are screen-specific |
| 2 | `/payment-channels`, three cells | what an em dash stands for: the owner's name where the owning row is gone; a bank name NOT RECORDED on a transfer and NOT APPLICABLE on a cash channel; the account digits | no general "not recorded" phrase exists to slice; the nearest, `rcNoRenewalRequest`, is a whole sentence about a renewal request |
| 2b | `/incidents`, two cells | the containment log's actor where the id is HELD and did not resolve, and the impact assessment where it was never performed | the class is known (decision 60 already classifies the first); the WORD is hers, so both render as their eleven siblings do until she rules |
| 3 | the Arabic email subjects | whether they should carry «وسيط 360» | they describe the system generically today («نظام إدارة الوساطة التأمينية»), which is correct and never carried the codename — so this is a branding choice, not a defect |

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
