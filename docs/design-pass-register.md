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
| 4b | **`aria-label` over a visible label is the most common defect this pass is finding.** Two of the three pilot screens carried it, FOUR controls in all, and in three of the four the two strings DISAGREED: `pcAccountAria` said four digits where the field accepts two to four; `incTitleLabel` ("Incident title") was better than the visible `incTitleFieldLabel` ("Title"); `incRootCauseLabel` was a placeholder doing a label's job, so a sighted reader had nothing left to read once they typed. An `aria-label` REPLACES the accessible name, so the two readers were told different things and nobody proof-reads the invisible one. | **CLOSED 2026-10-30 (batch 14 § 4): 54 → 14, and the 14 are the MATCHER.** FULLER 8 → 1, THINNER 10 → 0, UNRELATED 31 → 13, DUPLICATE 7 → 0; 209 aria-labels across 73 files → 159 across 67, with 25 keys withdrawn in both languages and **no new string anywhere**. The sharpest row was hers: `/settings/users` told the eye the password policy and the ear «كلمة المرور». **A GATE IS STILL NOT BUILT, and now there is a measured reason rather than a hesitation**: the resolver falls through to the nearest text node, which can be a BUTTON, an empty-state sentence or a heading, so 13 rows are false — and a ratchet on a matcher with 13 known false rows is a red build on a clean tree, where the first false red teaches everyone to ignore it. |
| 4c | **`hardcoded-ui-english.py` reports 0 undeclared and misses two strings on `/internal-controls`** — a governance report an auditor reads. `'None'` was the violations figure when the count was zero: a ternary of bare literals inside a PROP VALUE, which failure mode 8 excludes by design because the identical shape is a `data-*` test hook elsewhere. And `Generated {…}` was a capitalised single word in front of a brace, which `PROSE` misses (it needs two words) and `BARE_TEXT_LINE` misses (its character class excludes braces). | Both instances fixed — the count is `٠` through `formatNumber`, and the generated-at line goes through `ReportProvenance`, which this product already decided on for exactly that line. **Mode 8 is NOT widened**: that script's own header records that tolerating more makes every bare call a finding. |
| 4d | **`ReportProvenance` was never exported from the `components/ui` barrel.** Found by the compiler when the first screen tried to compose it. | Exported. Worth a line because the component shipped with its own decision record and a `report-provenance` testid and could only be reached by a deep import — which is how a primitive stays unused. |
| 4e | **`/internal-controls/combined-duty-acts` is mocked by NO Playwright spec and its declared-acts half has never been exercised in a browser.** Found while writing that screen's capture: there was no working fixture to copy, so the first attempt was paraphrased from the type and silently rendered nothing. | The capture now exercises it. A real assertion on that section belongs with whoever owns COMBINED mode — it is the section the whole mode rests on. |
| 5b | **The collapsed rail is a STRIP, not a drawer.** Its `<details>` groups stay closed, so it costs about one brand lockup and one search field of height. | A drawer needs a toggle, a focus trap and an escape key — three pieces of BEHAVIOUR, which §4(h) does not allow this batch to add. It is the better answer whenever somebody is allowed to build it. |
| 5c | **The rail's layout lives in inline styles, which is why the responsive rule needs `!important`.** | Moving it to CSS is a larger change than a responsive fix should carry. Recorded so the `!important` is read as a consequence rather than as carelessness. |
| 6 | **The two new CI steps are committed locally and NOT PUSHED.** `check:token-contrast` and `check:inline-styles` are wired in `package.json` (so `npm run check:screen-pass` runs both) and their `ci.yml` steps sit in an unpushed commit: GitHub refuses a push touching a workflow file from a token without `workflow` scope, and this machine's keyring token holds `gist, read:org, repo`. **No credential was written to disk to get around it** — the credential-safety hook refuses that and is right to, since it cannot tell a credential store from a leak. | **STILL OPEN 2026-10-30, AND THE ORIGINAL CLAIM IN THIS ROW WAS RIGHT: THE STEPS ARE STILL NOT PUSHED.** The push was refused a SECOND time, naming `workflow` — so what batch 14 corrected here is not the row's status but its ARITHMETIC: **IT WAS ONE STEP, NOT THREE.** Measured rather than trusted: `check:token-contrast` and `check:inline-styles` are already in `ci.yml` at lines 124 and 133, and the held branch's own diff proves it — `5a17f08` adds exactly ONE step and *"Inline styling may only fall"* appears in it as unchanged CONTEXT. So only `check:opacity-muting` was ever absent. Both are WRITTEN now — `check:opacity-muting` and the new `check:literal-colours` — and NEITHER IS IN CI, held on `wire-both-design-gates-into-ci`, named for what it does because a hash moves, and `wire-opacity-gate-into-ci` is SUPERSEDED (it sat four commits behind carrying the same 13 lines). The half of this row that outlived its figures is the reason it was written: a gate nobody runs is a number nobody can trust. |
| 7 | **SIXTEEN screens still wrap a `<Table>` in their OWN `overflow-x: auto` div.** `Table` has provided a scroll container since batch 3 **with `tabIndex={0}`**, because a scroll container nothing can focus is a region a keyboard user cannot scroll at all — so an unfocusable one wrapping it is that defect one level out. Measured 17 sites across 10 files; `/screening-health`'s is fixed. **axe is silent**: `scrollable-region-focusable` fires only when a region actually OVERFLOWS, and the inner scroller absorbs the overflow first. `client-accounting`, `financial-report`, `insurer-accounting`, `regulatory-compliance`, `retention-disposal` ×6, `ropa-entries`, `screening-matches`, `sla-dashboard` ×3, `watchlist-sync`. | **CLOSED 2026-10-30 (batch 14 § 5).** Sixteen removed across nine files, each close matched by DEPTH COUNTING because `</div>` nests; `SCREEN_BUDGET` 1099 → 1083, exactly one site per wrapper. **Re-measured first, and the measurement classified them independently: 28 wrappers exist, of which exactly 16 wrap the PRIMITIVE — her list to the site. The other 12 hold a RAW `<table>`, where that div is the ONLY scroller**, so removing it there would be the regression rather than the fix — and those twelve are therefore batch 3's keyboard trap still UNFIXED, which is the one item this register leaves both mechanical-ish and open. **And removing them dropped a live test hook**: `watchlist-sync`'s wrapper carried `data-testid="watchlist-runs"`, read by two assertions — the `data-*` class from the other direction, five having been dropped BY components before. It rides the `<Table>` now, which forwards them. |
| 8 | **`ProviderHealth.providerName` is English on an Arabic screen** — «الاسم» reads `Built-in watchlist cache (OFAC SDN + UN Consolidated)` beside a TYPE that reads «القائمة المحلية المزامنة». Declared as `readonly name` on each adapter, which is why a sweep over display-FIELD names (`note`, `detail`, …) did not see it. | **~~No Arabic exists for it~~ — MEASURED 2026-10-30 AND THAT CLAIM WAS TOO STRONG (batch 14 § 11), which matters because it was repeated to the owner.** `scripts/measurements/api-display-strings.py` re-derives it: `'On-premise screening engine'` is **byte-identical** to `screenProviderOnPremise`, whose «محرك فحص محلي» ships; `'Commercial screening provider'` is ONE WORD from `screenProviderCommercial`; only the built-in name has no single twin, and its two parts both ship. **AND THE REAL FINDING IS THAT THE ARABIC IS ALREADY ON THAT SCREEN EIGHT LINES ABOVE** — the «المزوّد» row renders `ENUM_LABEL.ScreeningProviderKind` in Arabic and «الاسم» renders `providerName` raw in English, so for two of the three this is a SECOND answer to a question already answered, in the wrong language. **Reported and NOT shipped by her instruction**, because the honest fix is removing a row from a compliance screen or putting a KEY on the wire, and she reads the derivation first. `ProviderHealth.detail` is a DIFFERENT answer: two of its ten are already covered bilingually by `shMissingConfig` (rendered as a duplicate directly beneath the English), three carry a RAW runtime fragment whose CARRIER SENTENCE is still localisable, and five interpolate only numbers or URLs. |
| 5 | **~~The four other `(auth)` screens do not yet use `AuthFrame`~~ — CLOSED 2026-10-30 (batch 14 § 6).** THE ORIGINAL CLAIM: `/login` links to `/forgot-password`, which still wore the old card — this product's first impression going wrong one click in. | All four wear the frame, with `pitch` OMITTED because `AuthFrame`'s own comment anticipated exactly these four in advance: *a reader who is already resetting a password does not need selling to*. No new words, and the frame renders its own `<main>`, so each screen shed two inline style sites as well. |

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

## Owed to the owner

**Every row here is ANSWERED except 9b, and nothing on any of them was invented while it was
open** — which is the only thing that makes the list worth keeping. Rows 4 to 7 were found by
opening captures after the first three were answered; 8 to 11 came from closing 5 and 6 and
finding what sat underneath them.

**9b is the one still open, and it is one clause.** It is also the one where the defect is
UPSTREAM of her: she was given a truncated English sentence and wrote faithful Arabic for the
truncation.

| # | where | her answer | what it cost |
|---|---|---|---|
| 1 | the sign-in brand panel | **it needed no word from her** — it is in her own brand pack. The Arabic and English flyers carry the headline, the product sentence and six capability lines; reference page B composes three of them into this panel | `BrandPitch`, five key pairs. **The Arabic bytes came from the reference page's HTML, not from my reading of the flyer PNG** — transcribing Arabic from an image is where the shadda/vowel trap bites, and the reference is text that can be copied exactly |
| 2 · 2b | the five em-dash cells | **three words, not one** — «لم يُقيَّم بعد» (not done yet), «لا ينطبق» (does not apply), «غير متوفّر» (held, unresolvable), with the instruction that a site which does not fit one of the three KEEPS ITS DASH | three keys; **three of the five sites converted and two did not** — see the table below |
| 4 | `/client-accounting`'s receivables ageing | **«من ١ إلى ٣٠ يوماً», as a NEW key and not a pointer** — `dclmAgeing0To30` reads «من ٠ إلى ٣٠ يوماً» and covers DAY ZERO, which on a receivables report is the `current` bucket one column to the left | `caAgeing1To30`. **AND HER WORD WAS ALREADY IN THE PRODUCT**: `frAgeing1To30` on `/financial-report` is BYTE-IDENTICAL (both NFC, 17 codepoints, compared one at a time), so the value was copied from it rather than typed. The near-match she warned about is exactly ONE codepoint — U+0660 against U+0661. `AR_AGEING_BUCKET_FALLBACK` is DELETED rather than emptied |
| 3 | the Arabic email subjects | **they carry «وسيط 360»** — they read as a generic description today, which was correct while the product had no name to show | three subjects, plus one body line as a stated judgement |
| 5 | `/screening-health`'s capability table | **«العقوبات»** and **«الأشخاص السياسيون (PEP)»** — the NOMINATIVE, which is what a column label takes, against the genitive run inside the sentence already on that screen | `shCapSanctions` / `shCapPep`, in a map TOTAL over a declared union by her own instruction. **BUT THE UNION IS NINE MEMBERS, NOT TWO** — `ProviderCapability`, and every provider reports all nine; **my own capture fixture carried two rows**, which is why her note reads *a third capability*. Seven render their token and are owed |
| 6 | `/screening-health`'s screening outcomes | **«لا يوجد تطابق، الفحص نظيف», «مطابقة محتملة», «تعذّر الفحص»** — with the `CLEAR` sentence trimmed BY HER after being shown it renders beside a COUNT rather than on one customer's record | **NONE OF THEM WAS NEEDED, and that is the finding.** The keys are `ScreeningAttemptOutcome` — five members, no `CLEAR` and no `ERROR` — and `ENUM_LABEL.ScreeningAttemptOutcome` has mapped all five to bilingual keys the whole time; `screenOutcomeUnableToScreen` IS «تعذّر الفحص», her own word. **Her token names came off my own fixture**, which invented two members that cannot occur. Reported, not swapped in |
| 8 | `/screening-health`'s nine capability words | **all nine, and «التغطية الإعلامية السلبية» was decided TWICE** — she rejected «الأخبار السلبية» as not clear enough to a clerk and chose the AML term herself | `PROVIDER_CAPABILITY_LABEL_KEY` is TOTAL with no `\| null` left and the screen's fall-through to the raw token is DELETED. The rejected word is the one a later reader would guess, which is why it is written down |
| 9 | `/screening-health`'s 27 capability NOTES | **26 of the 27, her own Arabic** — grouped by the adapter that builds each, because the same capability means different things per provider | A note is a KEY on the wire now, not a sentence. **The 27th was not in her table**: the built-in SANCTIONS row is a ternary and she was given its FALSE branch, so the note an Arabic reader sees on the DEFAULT provider in the normal case had no word — DERIVED from `wsIntro` as a contiguous run in both languages rather than asked for |
| 9b | the on-premise PEP note | **ANSWERED 2026-10-30 — she restored the clause herself**, so the Arabic now opens «حسب ما إذا كانت» against the English's own *Depends on whether*. THE ORIGINAL ROW, because the defect was UPSTREAM of her: the shipping English hedges, the table she was given had lost that clause, and her Arabic rendered the truncation faithfully and ASSERTED what the English HEDGES | `shNoteOnPremisePepVerify`. **It was caught by comparing the two languages against each other rather than by reading either alone** — a bilingual pair where one half makes a stronger claim than the other is a defect neither reader can see. The clause went missing when the sentences were extracted FOR her, not when she wrote them, so it was never hers to drop |
| 10 | the `CLEAR` sentence | **WITHDRAWN BY HER.** `screenOutcomeNoMatch` keeps «لا يوجد تطابق»: *the product can demonstrate that no match was found; it cannot demonstrate that a customer is clean, and on a compliance screen the weaker claim is the true one* | Nothing changed. Recorded as HER decision with that reason, because the label now reads like half a sentence and is not |
| 11 | the date fields | **ANSWERED IN FULL 2026-10-30 — NINE SENTENCES, and her measurement is what made it nine.** 19 fields were worth reading; six already had their Arabic shipping as an invisible `aria-label` (*what is heard becomes what is seen*), two were DECIDED to stay bare, one cannot have a word until the behaviour is measured, and 20 never needed one. Plus **GREGORIAN ONLY — «نحسمها ميلادي فقط- حاليا»**, with «حالياً» part of the decision | Nine key pairs, `Hint` and `DateEcho`, four labels that took their spoken sentence and six aria-labels withdrawn. **NOT ONE of the nine sites goes through `Field`**, so its `hint` slot — which the previous batch said this would reuse — was not reachable at any of them; `Hint` is extracted from `Field` instead. The MONTH-FIRST defect a hint cannot reach is closed in Arabic and NOT in English, measured |
| 12 | the aria-vs-visible class | **COUNT IT AND STOP** — *if it is six, this is closed; if it is sixty, the owner needs to know that before anyone decides what to do* | **IT IS 54 — AND IT IS 14 NOW, CLOSED 2026-10-30 (batch 14 § 4) after she approved closing the rest; what remains is entirely the matcher.** THE ORIGINAL MEASUREMENT, because the split is what made the decision possible: **IT IS 54**, by `aria-vs-visible-label.py` over 209 aria-labels in 73 files — and split by WHICH READER LOSES: **FULLER 8** (the eye loses, her class), **THINNER 10** (the EAR loses a qualifier), **UNRELATED 36** (22 of them naming a deliberately-written `*Aria` key, so most of that bucket is the matcher). **The sharpest row is not in her six**: `/settings/users`' password field tells the eye the policy and the ear «كلمة المرور». Nothing beyond her six was changed |
| 13 | «تتوقّف التغطية» on the endorsement form | **SHE DELIBERATELY DID NOT WRITE THIS ONE** — *is the date entered the LAST day cover applies, or the FIRST day it does not? One day apart, and one day decides whether a claim is covered or refused* | **MEASURED: it is the FIRST day cover does NOT apply**, and both halves of the product agree — the schedule closes at `effectiveTo := effectiveFrom` with no successor and `claim.config.ts` reads `effectiveFrom <= lossDate < effectiveTo`, while `cancellationReturnPremium` counts `unexpiredDays` FROM that date, so the client is refunded for it. **No finding** — the behaviour is consistent and the label is not wrong, only ambiguous by one day. **ANSWERED 2026-10-30: «أول يوم لا تسري فيه التغطية.»**, hers, now shipping as `endorsementCoverCeasesHint` — and the HINT AND THE ASSERTION WERE WRITTEN TOGETHER, which is the pairing to keep: `claim.config.spec.ts` pins a loss ON the cancellation date as NOT covered, so the sentence cannot drift from the behaviour in either direction. The original guidance was right to the word. |
| 14 | «مُهيّأ» the POSITIVE word | **NOT ASKED** — her ruling names the negative phrase «غير مُهيّأ», which is now one spelling across all 8 sites | The positive word meaning *configured* ships four times, **three without the damma (`shConfigured` among them) and once with it (`provStateConfigured`)**. It is PRE-EXISTING on `/screening-health`, which already renders `shConfigured` «مهيّأ» beside `screenOutcomeNotConfigured` «غير مُهيّأ» — so the normalisation neither caused it nor closed it. Four sites, one word |
| 7 | the `Ring` caption | **«١٤ مطالبة مفتوحة من ٦٦»** — *{open} open claims of {total}*, the string `Ring` has required since it was written | `dclmOpenClaimsOfTotal` in `plurals.ts`, and a `Ring` on `/dashboards/claims`. `other` is her run with the numerals replaced; `few` slices `execOpenClaims` verbatim; **`zero`, `one` and `two` are OMITTED** because «مطالبتان» ships nowhere — the «محاولتان» dual again. **And her caption did not fit the space**: it drew as 9px SVG text inside the ring and spilled past the arc, so the COMPONENT moved it under the label. Her words untouched |

### The shell: the window stops scrolling

Her words, after walking the captures: *«بدي يكون الناف بار و السايد بار ستاتيك يعني ثابتين محلهم و
بس البادي هو الي بيتحرك بالسكرول»* — the top bar and the rail stay put; only the body moves.

**What was there.** Both were `position: sticky` and THE SCROLLER WAS THE WINDOW. Sticky keeps them
in view, which is close — but the page scrollbar ran the full document height and the content's own
top was never a fixed edge.

**What it is now.** `shellStyle` is `height: 100dvh` with `overflow: hidden`; the navbar drops
`sticky`/`top`; the rail drops `sticky`, `top` and `max-height` and becomes `height: 100%`; the
content column gains `overflow-y: auto`, `min-height: 0` and a `data-app-content` hook.

**AND THE ARITHMETIC DISAPPEARS RATHER THAN BEING KEPT IN STEP**, which is the part worth carrying
forward. `NAVBAR_HEIGHT`'s own comment said THREE things had to agree on it — the bar, the rail's
sticky offset and the rail's max-height — and that going out of step either parks the rail under
the bar or grows it a phantom scrollbar exactly one bar tall. Two of those three readers are gone:
nothing offsets anything, because nothing overlaps.

**`100dvh` is not a preference.** On a mobile browser `100vh` is the viewport WITHOUT the
retracting chrome, so `100vh` plus `overflow: hidden` clips the last 60–100px permanently.

**THE PHONE KEEPS THE PAGE SCROLLER**, which is the inverse and is deliberate. Below 64rem the lock
is worse: the collapsed rail strip eats fixed height off a short screen, and the address-bar
retraction that gives a phone reader their screen back only happens when the PAGE scrolls. With
`!important`, for the reason already written above that block — these are INLINE style objects.

#### Measured before touching it, as she asked

| question | answer |
|---|---|
| `window.scrollTo` / `window.scrollY` in web source | **0** |
| `scrollIntoView` in web source | **1** (`settings/roles`), works on any scrolling ancestor — unaffected |
| Playwright assertions that scroll the page or wait on page scroll | **0** |
| `position: sticky` anywhere in the web tree | **2**, and they are the two this change removes — so there is no sticky table header or toolbar to re-check |

#### Three things the change nearly cost, none of which failed a gate

**1 · The scroll reset I predicted does not need writing, and mine was the worse of two.** I wrote
the effect, wrote the test, then PLANTED THE EFFECT AWAY — and all three tests still passed.
Measured in `next/dist/client/components/layout-router.js`: the App Router calls
`instance.scrollIntoView()` on the new segment when it is out of view, and that scrolls every
scrollable ancestor. Mine fired on `[pathname]`, which changes on a BACK navigation too, so it
would have destroyed the position a reader was returning to. Removed. `shell-scroll.spec.ts` stays
and now pins the FRAMEWORK on this shell shape.

**2 · Every desktop capture was silently clipped at the viewport.** All 32 passed; the desktop ones
were one viewport tall and cut off mid-row while the phone ones were still 2,755px of full page,
because `fullPage: true` captures the DOCUMENT'S extent and the document is now exactly `100dvh`.
The viewport is grown to the content column's `scrollHeight` before the shot, so the rail and bar
stay in frame. **Found by opening a picture. Nothing failed.**

**3 · Two live assertions would have become unable to fail.**
`permission-description-length.spec.ts` asserts twice that a long description does not make the
page scroll sideways, reading `documentElement.scrollWidth` — permanently false once the shell
clips. Both re-pointed at `[data-app-content]`, which is the stronger claim as well as the
surviving one. Found by asking what the change made VACUOUS rather than what it broke.

**4 · And the capture fix in (2) BLINDED the evidence to a different defect, in the same helper.**
`!important` was planted away from the phone shell rule — the half-applied media query this
repository has shipped once and caught IN A SCREENSHOT — and the capture came back **2,189px
against 2,115px correct**. Noise. The picture could not see it, because growing the viewport to the
content column's `scrollHeight` produces a whole capture whether the PAGE scrolls or a div inside
it does.

So `shell-scroll.spec.ts` gained the inverse of its first test: below 64rem the DOCUMENT must
scroll, and the content column must NOT be its own scroller. Both halves, because they are
different claims — the document scrolling is what lets a phone browser retract its chrome, and the
column not scrolling is what stops the strip-plus-inner-scroller arrangement that makes a short
screen unusable. Under the plant it dies naming exactly that.

**The lesson is narrower than "open a picture": an instrument fixed for one blindness can acquire
another in the same edit, and only planting against it says which.**

**And the MFA enrolment banner now scrolls away with the page. That is correct** — it is a one-time
signpost, not a persistent state — and it is said here so nobody "fixes" it later.

### Recorded from the captures, not fixed — the native date input is in English on every Arabic screen

Visible on `/client-accounting`'s «كما في» field in all four of its captures: the control renders
the browser's own **`mm/dd/yyyy`** placeholder beside an Arabic label, on an Arabic-first product.

**MEASURED: 25 files use a native `<input type="date">`** — **and re-measured 2026-10-29 at 40 inputs across those same 25 files**, classified below — so this is a property of the control
rather than of one screen. The format hint is BROWSER CHROME — it follows the user agent's locale,
not the page's `dir` or `lang` — which is why no gate in this repository can see it: there is no
English string in our source to find, `hardcoded-ui-english.py` is looking at the right files and
correctly reports nothing, and axe has no opinion about a date format.

Not fixed, and the reason is that both honest answers are bigger than a design pass. Setting `lang`
on each input is not reliable across engines; a custom date control is a new primitive with
keyboard, locale and calendar decisions attached — and this product has an open question about
Hijri dates (Part F item #5) that such a control would have to answer first. Recorded here so it is
a decision rather than something nobody noticed.

#### OWNER DECISION, 2026-10-29 — GREGORIAN ONLY, FOR NOW

Her words: *«نحسمها ميلادي فقط- حاليا»*. Every date in this product is Gregorian on display and on
entry, and nothing converts between calendars.

**«حالياً» — *for now* — IS PART OF THE DECISION**, in the same form as her currency ruling («دينار
أردني فقط — حالياً»). The code must not ASSUME Gregorian silently, so that opening this later is one
known place rather than a hunt. **The reopening condition is recorded with it**: a customer document
whose date of birth is written in Hijri, which is the one case that would force it — and if it ever
opens, the conversion must be VISIBLE rather than silent.

**THIS DOES NOT AUTHORISE THE DATE CONTROL.** It removes the thing that blocked it; the control
itself is still not built and is not an engineer's to start.

#### OWNER DECISION, 2026-10-30 — TWO FIELDS STAY BARE, AND THAT IS DECIDED RATHER THAN UNFINISHED

`/regulatory-compliance`'s «ينتهي الإيقافُ في (إن كان محدَّدًا)» and the claim card's «استلم العميل
مبلغ التسوية بتاريخ» get **no hint**. Her reason: the label already says everything, and a hint over
a clear label is noise — **and noise is how people stop reading hints, which costs us the ones that
matter.** Recorded as DECIDED so the next reader does not "complete" the set.

#### OWNER DECISION, 2026-10-30 — «غير مُهيّأ» IS THE SPELLING

The fully-marked one, damma U+064F and shadda U+0651. The phrase shipped THREE ways and two of
them could appear on `/screening-health` at once; it is now one spelling across all eight sites.
**These are the same word in Arabic, so this is a NORMALISATION and not a rewording** — no
sentence's sense changes and no new string was written: the canonical bytes were READ OUT of
`provStateNotConfigured` rather than typed.

**AND A GREP COULD NOT HAVE FOUND THE SET**: `grep «مهي»` cannot match «مُهيّأ», because a damma
sits between the م and the ه — so the first reading listed only the undiacriticised sites and
silently omitted the three that were already correct. `scripts/measurements/not-configured-spelling.py`
compares on the form with every Arabic combining mark REMOVED, and re-derives the figure.

**IS A DIACRITIC-CONSISTENCY CHECK BUILDABLE? Asked and not answered, and not built here.** What
one would need is a DECLARED vocabulary of words whose marking is decided, because the general
question — *is this the same word differently marked?* — needs Arabic morphology and would fire on
every legitimate inflection.

**AND IT IS NOT THE SAME QUESTION AS THE HIJRI HOLIDAYS**, which was answered long ago and is
unchanged: the Eid dates are not computed in code, because in Jordan they are set by official
decision and can differ by a day from any calendar conversion — they are entered by hand each year.
Nothing here touches that.

#### Her own fix, and the half it does not reach — MEASURED 2026-10-29

She proposed the remedy herself: **a line under the label saying which date it is** — «أدخل تاريخ
المطالبة» and so on. `Field` already has a `hint` slot wired to `aria-describedby`, so this needs no
new component and no new mechanism. It needs WORDS, and the words are hers.

**MEASURED FIRST, because a hint on an already-obvious field is noise and noise is how people stop
reading hints.** `python scripts/measurements/date-input-labels.py` re-derives the list; it reports
**40 date inputs across 25 files**, classified by whether the VISIBLE label names the date:

| class | count | verdict |
|---|---|---|
| **AS-AT** — a bare «كما في» / `As of` | 4 | **a hint is owed.** It says the reading is a snapshot and never of WHAT |
| **RANGE** — a bare «من» / «بداية الفترة» / `Period end` | 8 | **a hint is owed.** It says which END of a range and never which date |
| **MEANS** — names what the date means, no date noun («تتوقّف التغطية», «ساري من») | 7 | **read by hand.** Most are already clear and a hint would be noise |
| **NAMES** — a date noun bound to a subject («تاريخ الميلاد») | 20 | **no hint** |
| unreadable | 1 | see the finding below |

**THE TWELVE SITES A HINT IS OWED FOR, BY NAME**, because she is the one writing them. The other
28 are not listed on purpose: naming them invites a hint each, and the whole point of classifying
was that 20 already say which date they want.

| screen | key | label today | what the date IS |
|---|---|---|---|
| `/client-accounting` | `caAsOf` | «كما في» | the balance date the ageing is computed at |
| `/financial-report` | `frAsOf` | «كما في» | the balance date the report is computed at |
| `/insurer-accounting` | `iaAsOf` | «كما في» | the balance date the insurer ledger is computed at |
| `/dashboards/executive` | `execAsOf` | «كما في تاريخ» | the date the whole dashboard is computed at |
| `/audit-trail` | `atFromLabel` | «من تاريخ» | the earliest ACT to list |
| `/audit-trail` | `atToLabel` | «إلى تاريخ» | the latest ACT to list |
| `/employee-performance` | `ipPeriodStartOptionalLabel` | «بداية الفترة (اختياري)» | the first day of the scored period |
| `/employee-performance` | `ipPeriodEndOptionalLabel` | «نهاية الفترة (اختياري)» | the last day of the scored period |
| `/insurer-performance` | `ipPeriodStartOptionalLabel` | same key, shared | same |
| `/insurer-performance` | `ipPeriodEndOptionalLabel` | same key, shared | same |
| `/sales-performance` | `dashPeriodStart` | «بداية الفترة» | the first day of the sales period |
| `/sales-performance` | `dashPeriodEnd` | «نهاية الفترة» | the last day of the sales period |

**TWO OF THOSE KEYS ARE SHARED BY TWO SCREENS** (`ipPeriodStartOptionalLabel` /
`ipPeriodEndOptionalLabel` serve both performance dashboards), so the twelve SITES are ten
STRINGS — and a hint on a shared key has to be true on both screens, which is why the table lists
the sites rather than collapsing them.

**THE FIGURE IS 40, NOT 42** — a plain grep reports 42 and two of those are prose inside a doc
comment in `audit-trail/page.tsx` explaining the end-of-day trap. A small correction, with its
reason, rather than a number carried across.

**AND MEASURING IT FOUND THE `aria-label`-OVER-VISIBLE-LABEL CLASS AGAIN, on all four AS-AT
fields.** `/client-accounting`, `/financial-report`, `/insurer-accounting` and
`/dashboards/executive` each render «كما في» and carry an `aria-label` of «تاريخ الرصيد» — *balance
date*, which is the BETTER wording and is the one only a screen-reader user hears. An `aria-label`
REPLACES the accessible name, so the two readers are told different things and nobody proof-reads
the invisible one; this repository has recorded that class four times, and `incTitleLabel` was the
same shape (the invisible one better than the visible one). **The hint she is being asked for would
make the visible label say what the invisible one already says.**

**ONE INPUT HAS NO LABEL AT ALL — CLOSED 2026-10-30 by her row 9, «تاريخ الفحص القادم للخطة.», as a LABEL rather than a hint because there was no label for a hint to sit under** — `bcp-dr-plans/page.tsx:202`, a bare `<input type="date">` in a
table cell with no `<label>`, no `htmlFor` and no `aria-label`. It renders only after *Record test*
is pressed, which is why the a11y suite has never seen it: axe scans what is on the page.

**AND THE HALF HER FIX DOES NOT REACH, which is the dangerous half.** A hint says WHAT to enter;
`mm/dd/yyyy` is about HOW, and it is month-first. An employee who types `03/04` meaning 3 April gets
4 March — **a valid date, silently wrong**, which neither they nor any validation can catch, and on
a receivables ageing report that moves money between buckets.

**A hint cannot carry the format**, because the format is the user agent's and not ours: the same
build shows `mm/dd/yyyy` on one machine and `dd/mm/yyyy` on another, so a fixed Arabic «شهر/يوم/سنة»
would be false for half the readers — worse than the English placeholder.

**PROPOSED, NOT BUILT: echo the chosen date back.** Render the selected value under the field
through `formatDate`, which already takes the reader's language and already ships. Whatever order
the employee typed in, they see what the system understood — «7 أيلول 2026». One place, not 40, and
**no new words at all**, which is what makes it buildable without her.

**Where it belongs is a measurement and it came out AGAINST the `hint` slot.** `Field`'s `hint` is
wired into `aria-describedby`, and a field may legitimately want BOTH an instruction and an echo —
so an echo in the `hint` slot would either displace the instruction or have to be concatenated into
it, and a screen reader would then announce the chosen date as part of the field's description every
time focus lands. The echo wants its own slot, rendered after the control and NOT in
`aria-describedby`: the value is already announced by the input itself, so describing it again is a
duplicate announcement rather than help.

### What these four answers left OWED, measured

Every row here is a word nobody may invent. Each renders its own member name today, which is
visibly unfinished — the established treatment, because a plausible invented word is
indistinguishable from a decided one and never gets corrected.

| what | how many | where it renders | why it is not derivable |
|---|---|---|---|
| ~~`ProviderCapability` — the seven she did not name~~ | ~~7~~ | — | **CLOSED 2026-10-29.** She named all nine, and `PROVIDER_CAPABILITY_LABEL_KEY` has no `\| null` in its type any more — the screen's fall-through to the raw token is DELETED rather than left unreachable, the same treatment `AR_AGEING_BUCKET_FALLBACK` got. «التغطية الإعلامية السلبية» was decided twice: she rejected «الأخبار السلبية» as not clear enough to a clerk, which is the one a later reader would guess |
| `ScreeningCaseStatus` | 5 | `/screening-health`'s case-workload table | `OPEN`, `ASSIGNED`, `UNDER_REVIEW`, `ESCALATED`, `CLOSED`. **There is no `ENUM_LABEL` entry at all** — measured, unlike `ScreeningAttemptOutcome` beside it, which had a complete one. Found while reading for rows 5 and 6; not in either. **STILL OPEN** — this batch did not touch it |
| `dclmOpenClaimsOfTotal` — `zero`, `one`, `two` | 3 forms | the ring caption on `/dashboards/claims` | They fall back to `other`, so 0/1/2 read as «{n} مطالبة مفتوحة». «مطالبتان» ships NOWHERE and a dual is morphology; «مطالبة واحدة» and «لا مطالبات» are constructions rather than slices. **Do not compose them from shipping words** — that is the decision this omission protects |

**And one thing was reported rather than decided — ANSWERED 2026-10-29, and the answer is HERS.**
Her `CLEAR` sentence «لا يوجد تطابق، الفحص نظيف» is **not adopted**, and `screenOutcomeNoMatch` keeps
the schema's own careful «لا يوجد تطابق». She was shown the reasoning and accepted it: *the product
can demonstrate that no match was found; it cannot demonstrate that a customer is clean, and on a
compliance screen the weaker claim is the true one.* `NO_MATCH`'s own schema comment says it is *the
only outcome that MAY map to* `ScreeningOutcome.CLEAR` — MAY, not DOES.

**This is recorded as HER DECISION, with that reason, because the label now looks unfinished and is
not.** The next person to read «لا يوجد تطابق» will think half a sentence is missing; this row is
where they find out it was removed on purpose.

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

**NO `Ring` FOR OPEN-VERSUS-CLOSED, and that is a measurement.** **CLOSED 2026-10-29 — owner answer 4 supplied the one thing this was waiting on, so the reasoning below stands and only its conclusion moved.** It is a proportion and the
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

> **CLOSED 2026-10-29 — owner answer 1, and the reasoning above is why it was worth asking rather
> than guessing.** «من ١ إلى ٣٠ يوماً», as `caAgeing1To30`, a NEW key by her instruction. **And it
> was already in the product**: `frAgeing1To30` on `/financial-report` is BYTE-IDENTICAL, so the
> value was copied rather than typed. The near-match that made this a question is exactly ONE
> codepoint — `dclmAgeing0To30` is U+0660 where hers is U+0661.

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

**16 of 107 converted.** **CORRECTED 2026-10-29: 16 of 145, of which my matcher could see 107.**
`scripts/measurements/em-dash-placeholder.py` ALREADY EXISTED, from module 0-c group 7, and answers
exactly this question — I did not find it before writing a second one, and the two then disagreed
**145 against 91**. The existing one also matches a bare `'—'` literal and a JSX text dash
(`> — <`), so it is the broader and correct denominator and mine saw a SUBSET. **The disagreement
is the finding rather than either figure**, and it is the defect this batch keeps reporting — two
answers to one question — found in my own work. The second script is DELETED; the one thing it
contributed, the NAME-shaped column that made decision 60's convertible class recognisable, moved
into the one that already existed.

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
her ruling reserves to a reader. They are listed by `em-dash-placeholder.py`, and a count cleared by
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

### Batch 11 — `/screening-health`'s capture, and two vocabularies that are the owner's

The screen converted in batch 10 went into the capture set as the SMALL-FACTS shape — ten stacked
panels of label/value rows, nothing a table and nothing a tile, where the thing that matters most
is whether any panel is saying something is wrong. Opening it found two more things.

#### Three raw ISO timestamps, four centimetres below a panel formatting its own dates a third way

The scheduled-tasks panel printed `2026-09-11T00:00:00.000Z` three times — a machine string on a
compliance screen — while the provider panel above rendered `2026-09-10 00:00` through its own
hand-rolled `.slice(0, 16).replace("T", " ")`. **Two treatments of one kind of value on one screen,
and neither was the product's.**

`formatDate` is the product's: every other date-bearing screen reads it, it takes the reader's
language, and it is the single reason `locale-formatting.spec.ts` can assert that a date
re-renders in Arabic while the money deliberately does not. **All five sites moved, not the three
that looked worst** — leaving the two sliced ones would be the same screen with two answers instead
of three. A stale assertion pinning the raw ISO string is re-pointed with the reversal stated; the
property it is about, that the screen STATES when the recurring work next runs, is unchanged.

The `?? t('shUnknown')` fallbacks stay exactly as they were: *no next run is scheduled* is a real
state with its own word already shipping, and it is not one of decision 60's three.

#### Two vocabularies render raw, and both need a word that is hers

| what renders | where it comes from | why it is not converted here |
|---|---|---|
| `SANCTIONS`, `PEP` | `capability: string` on the wire — **not** a Prisma enum | The Arabic for PEP exists only INSIDE a sentence on this same screen («فحص الأشخاص السياسيين (PEP)»), and lifting a genitive run out of a sentence to label a table row is Arabic morphology, which her rule reserves to her |
| `CLEAR`, `POTENTIAL_MATCH`, `ERROR` | the keys of `attempts.byOutcome` | **They are NOT `ScreeningOutcome`'s members** — that Prisma enum is `CLEAR \| HIT \| PENDING_INVESTIGATION`. This is a second, undeclared vocabulary with no label map anywhere, so three words are owed rather than one map being reached for |

`check:raw-values` reports 0 undeclared over both, correctly by its own rules: it keys on PRISMA
ENUM field names, and neither of these is one. That is the same structural limit the gate already
records against `/payment-channels`, met on a second screen.

**Measured before being described**, because the first reading was wrong: `byOutcome`'s keys look
like `ScreeningOutcome` and are not, and had they been, this would have been the pure-oversight
class (a complete bilingual map shipping while the screen does not reach for it) rather than three
words owed.

---

### Batch 11b — a flake CI found, and the one class of fix a plant cannot prove

The full suite went 918 of 919 on a spec nothing in this batch touches:
`duty-segregation-mode.spec.ts` asserts a captured POST body immediately after the click that
sends it, and in a 919-test run the array was EMPTY. **7 of 7 in isolation**, which is what a
timing assertion always looks like.

**It is the recorded class rather than a new one** — *a console assertion must WAIT for the
console*, a snapshot taken after the clicks passing or failing on which side of an async round trip
it lands, which is how a green local run once reached a red CI here. The array is a captured
request body rather than a console; the shape is identical.

Three sites, all three hardened with `await expect.poll(() => posted.length).toBe(1)` before the
original assertion, which is unchanged. **Two of the three were not failing and are hardened
anyway**: a timing assertion that happens to win is the same assertion, and leaving two to be found
by a future red CI is choosing to pay for this twice.

**AND THE PLANT PROVES NOTHING, WHICH IS WORTH SAYING RATHER THAN HIDING.** Removing the poll
leaves the test passing in isolation — that IS the failure mode. A timing fix is the one class
whose plant cannot demonstrate anything locally, because *it passes locally* is the defect. What
stands behind this one is the CI run that found it and the ones that come after.

---

### Batch 11c — the captures were being written where Playwright deletes them

Found by looking for them. **`test-results/` is Playwright's own output directory and it is CLEARED
at the start of every run**, so the 36 captures survived exactly until the next
`npx playwright test` — which in this batch was the full suite. I opened several, and then they
were gone.

**That is a defect in the EVIDENCE rather than a tidiness question.** The owner's stated reason for
these is that they are how she reviews 113 screens without opening 113 screens, and a file that any
later command silently deletes cannot be that. It also fails in the quietest possible direction:
**an empty folder looks exactly like a capture run that was never taken.**

They move to `design-pass-captures/` at the repo root, which Playwright does not manage. Still
gitignored — evidence to look at, not an artefact to carry in the tree. **Proven rather than
assumed**: 32 captures written, an unrelated spec run afterwards, 32 still there.

---

### Batch 12 — the nine capability words, and the twenty-seven English sentences under them

The owner's framing is the finding, and it is about where a string LIVES rather than about this
screen: closing her capability-label answer gave the table two Arabic words against nine members,
and **the seven unworded ones were only half of what that row shows.** Under each capability name
the screen rendered `c.note` — an English sentence built in the api — so an Arabic compliance
officer read an English token with an English sentence under it, on the screen whose job is to say
whether customers are actually being screened.

**`hardcoded-ui-english.py` REPORTED 0 AND WAS RIGHT TO.** It reads the web tree, and these strings
did not exist there. That is the structural class the thirteen risk-questionnaire prompts already
recorded by name — *a string the api sends and a screen renders verbatim is invisible to a scanner
that reads source* — and this is the **second instance**.

#### The shape: measured before it was built, which she asked for

| question | answer |
|---|---|
| can the api hold the Arabic? | **No.** `Accept-Language` appears NOWHERE in `apps/api/src`; `languagePreference` is a stored user field returned on `/auth/me` and is never consulted when a message is composed. One deployment serves both readers |
| can a flat string swap carry them? | **No.** Four of the 27 keys interpolate — three name the configured dataset, one lists the missing settings |
| how many readers does `note` have? | **One.** `/screening-health`'s capability table. Nothing in the api reads it, and `screening-config.controller.ts` passes `capabilities` straight through |
| could the WEB derive the note instead, needing no wire change? | **No**, and this is the alternative that had to be ruled out. Two of the 28 ROWS are ternaries on api-internal state the wire does not carry — `hasData` on the built-in cache, `sanctionsOnly` on the dataset — and reconstructing either from `operational` is the screen re-deriving what the api knows, which is decision 58's own prohibition one module over |

So: a note KEY plus params on the wire, resolved by the web. `promptAr`'s mechanism, with the
difference that a prompt is reference DATA (a pair on the wire) while a note is COPY about the
system itself, whose home is the i18n tree.

**AND `kind` IS ON THE WIRE, by decision 58's argument.** She identified three of these sentences as
WARNINGS rather than descriptions and asked that each be verified to render as one. The api is the
only layer that knows which of its own notes is a caution — a screen cannot derive it from three
booleans, and the commercial one rides a row where all three TICK. Required rather than optional, so
a 29th note cannot default to the non-warning value.

**A caution renders through `Note tone="warning"`** — this product's own primitive for *something
worth reading before acting*, with `--warning-bg`, a border and an icon. A description keeps the
small secondary text it always had. Her words for why: *"a caution that renders as decoration is
worse than one nobody can read, because the first one looks like it was considered."*

#### THE TWENTY-SEVENTH NOTE, WHICH HER TABLE DID NOT HAVE — and it is the one most readers see

Her table grouped the notes one per capability per adapter, nine for the built-in cache. The
built-in SANCTIONS row is a **TERNARY**, and her table took the FALSE branch (*the local cache is
empty*). The TRUE branch — `OFAC SDN + UN Consolidated, synced locally.` — is what an Arabic reader
sees on the DEFAULT provider in the NORMAL case, because `SCREENING_PROVIDER=built_in` is the only
configured value anywhere in this repository.

**It is DERIVED rather than asked for.** `wsIntro` on `/watchlist-sync` carries the identical claim
as a contiguous run in BOTH languages — «تُزامَن قائمتان عامّتان مجانيتان للعقوبات (OFAC SDN وقائمة
الأمم المتحدة الموحّدة) محلياً» — asserted as a substring in the edit script, plus a terminal full
stop, which is the treatment `commonCurrentLabel` already took when its colon was dropped. **No word
was asked for and none was invented.**

Same shape as `rendered-identifiers.py` reading `??` as a ternary: a branch nobody read is a branch
nobody counted.

#### The one row whose Arabic and English do not make the same claim — REPORTED, hers to settle

`ON_PREMISE_PEP_VERIFY`. The shipping English opens **`Depends on whether`** dataset "{name}"
actually ingested PEP collections; **the table she was given dropped that clause**, so her Arabic
renders the truncation faithfully and reads «مجموعة البيانات «{name}» **تتضمّن فعلاً** بيانات
الأشخاص السياسيين» — which ASSERTS what the English HEDGES.

Her sentence ships verbatim, because that is the standing rule and because its tail is still *راجع
قائمة بيانات المحرّك قبل الاعتماد عليها* — verify before relying on it. What is owed is one clause
from her. **It renders nowhere today**: it needs `on_premise` configured with a non-sanctions
dataset, and `built_in` is the only configured provider.

By her own criterion for the other three this is the same class as them, so **it is marked a CAUTION
by this code rather than by her**, and so is `BUILT_IN_CACHE_EMPTY` — an empty cache on the default
provider means nobody has been screened against anything. Both are named in the api's `cautions()`
doc comment as judgements rather than her classification, and
`capability-note-parity.spec.ts` pins the set of five BY NAME so overturning either is a deliberate
act.

#### «غير مهيّأ» IS THREE SPELLINGS NOW, on one screen — reported, not harmonised

She asked whether the not-configured note is a pointer at `screenOutcomeNotConfigured` rather than a
new string. **It is a pointer up to ONE DIACRITIC**, which is the honest answer:

| spelling | where |
|---|---|
| «غير مُهيّأ» — **with the damma on the م** | `provHealthNotConfigured` and `screenOutcomeNotConfigured`, shipping, rendered in this screen's own status row |
| «غير مهيّأ» — no damma | hers, this batch, now the capability note four rows below |
| «غير مهيأ» — no shadda either | `shWhichProviderActuallyPerformsScreening`, the intro paragraph at the top of the same screen |

Hers ships verbatim, because *nothing here is to be reworded* and a divergence is a finding. All
three render almost identically and compare unequal, which is why this is worth a row at all: a
search box or a stored value matching one will not match the others.

#### THE PHONE CAPTURE: the caution did not fit the cell, measured rather than squinted at

The desktop capture was right. The phone one looked cramped, so it was MEASURED rather than judged
from a thumbnail — a throwaway probe at 390px, deleted in the same session:

| at 390px | before | after |
|---|---|---|
| the caution's own TEXT | **62px wide, 299px tall** | **219px wide, 104px tall** |
| the capability column | 143px | 117px |
| the table against its scroller | 325px in 300px — it overflowed | 300px in 300px — it does not |
| a DESCRIPTION in that column | 111px wide, 38px tall | 85px wide, 38px tall |

Roughly four Arabic characters per line over twenty-five lines, on a compliance warning. A `Note`
spends about 47 of those px on its padding, its icon and the gap between them, and that chrome is
the whole difference between the two rows.

**And the move paid twice**: with the note out of the first cell the column shrank from 143px to
117px, the table stopped being wider than its scroller, and the horizontal overflow went away — so
the caution got 3.5× the text width AND the table stopped needing to scroll sideways on a phone.

**So the SPACE changed and not the sentence** — her own rule, and the second time this batch's
predecessor applied it (the ring caption drew as 9px SVG text inside an 84px circle). The caution
is its own `<Tr>` spanning all four columns, directly beneath the capability it is about: full
table width in both layouts, the box kept because it is what makes a caution unmistakable on a
desktop, and nothing squeezed.

**The three warning tests were RE-POINTED with the reversal stated**, and the nine-words test
gained the absence that proves the move: `[data-capability="PEP"] [data-note-kind="CAUTION"]` must
have count 0 and `[data-capability-caution="PEP"]` must be visible. A version that put the box back
in the cell fails there.

#### AND IT FOUND SEVENTEEN REDUNDANT SCROLLERS — batch 3's keyboard trap, one level out

Measuring the phone width meant reading what constrains the table, and this screen wrapped it in
its OWN `<div style={{ overflowX: "auto" }}>`. `Table` has provided a scroll container since batch
3 — **with `tabIndex={0}`**, because *a scroll container nothing can focus is a region a keyboard
user cannot scroll AT ALL*. An unfocusable scroller wrapping a focusable one is that same defect
one level out.

**axe cannot see it**, which is why they survived: it raises `scrollable-region-focusable` only
when a region actually OVERFLOWS, and the outer div rarely does — the inner one absorbs the
overflow first.

**MEASURED: 17 sites across 10 files.** One fixed (this screen's, which also took `SCREEN_BUDGET`
1100 → 1099). **The other 16 are counted and NOT swept** — six of them are `/retention-disposal`
alone, three `/sla-dashboard`:

`client-accounting`, `financial-report`, `insurer-accounting`, `regulatory-compliance`,
`retention-disposal` ×6, `ropa-entries`, `screening-matches`, `sla-dashboard` ×3, `watchlist-sync`.

#### A FIFTH api display string, seen in the capture: the provider's own NAME

«الاسم» renders `Built-in watchlist cache (OFAC SDN + UN Consolidated)` — English, beside a TYPE
that reads «القائمة المحلية المزامنة» in Arabic, because `ScreeningProviderKind` was given a label
map last batch and `ProviderHealth.providerName` was not. The three adapters declare it as
`readonly name`, so the field-name sweep that found `note` and `detail` did not look at it.

Counted with the others in the class table below, not fixed: it is the same class and the same
answer — no Arabic exists for it and inventing one is the thing the standing rule forbids.

**And it is the one the sweep could never have found**, which is why it is worth its own heading: a
sweep over display-FIELD names (`note`, `detail`, `meaning`, …) cannot see a field declared as
`readonly name`. It took opening the picture.

#### The intro paragraph teaches two token names the screen stopped rendering — reported

`shWhichProviderActuallyPerformsScreening` is the sentence under the heading. Its English reads
*"**NOT_CONFIGURED** or **UNAVAILABLE** means screening did not happen"* and its Arabic quotes «غير
مهيأ» and «غير متاح» — but the status row has rendered `ENUM_LABEL.ProviderHealthStatus` since the
previous batch, so an English reader now sees **Not configured** and **Unavailable** while the
paragraph above names the raw tokens, and an Arabic reader sees «غير مُهيّأ» against the
paragraph's undiacriticised «غير مهيأ».

The sentence was exactly right when it was written and the batch that fixed the status row did not
look up at it. **NOT reworded** — it is product copy nobody has approved a change to, and its
substance (*screening did not happen; it is not a negative result*) is still true and still the
most important sentence on the screen. One line for her.

#### `/screening-health` HAD NO `@a11y` TEST AT ALL, and this batch restructured its table

Measured: **84 of 121 specs carry one**, and of the 37 that do not, this screen and `/sla-policies`
are the only two COMPLIANCE screens.

One is added, in ARABIC, because the batch earned it rather than to widen the pass: the capability
table gained a `Note` inside a cell and then a second `<Tr>` whose single `<Td>` spans four
columns. `Table`'s own history here is a keyboard trap that axe raised **only once a region
actually overflowed** — which is exactly why running axe on a table this batch restructured is
verifying its own change rather than sweeping.

**`/sla-policies` still has none.** Counted, not written: a spec is not a design change.

#### A VERIFICATION RUN DIED ON THE HOST, NOT ON THE CODE — and the distinction is the point

The last full verification pass failed at its Playwright step with
`Process from config.webServer was not able to start. Exit code: 3221225794` — `0xC0000142`,
`STATUS_DLL_INIT_FAILED`, which on Windows is a process that could not INITIALISE rather than one
that ran and failed. Nothing in the suite executed.

**What makes it diagnosable rather than a mystery is what happened next in the same script**: the
a11y suite started its OWN web server seconds later and ran 86 tests green. A build that cannot
start a server and then starts one is a resource problem, not a broken build — this host had been
running a forced turbo build, three vitest workspaces and a browser pool in quick succession.

Recorded because the failure mode LOOKS like a catastrophic build failure and is not, and because
this repository has already once resolved a red local run the wrong way on an environment
explanation that happened to fit. The step was re-run alone.

#### The class she asked me to count, and stop

`note` is a display string in an api response. Measured across all **888** non-spec api files:

| field | sites | renders on | state |
|---|---|---|---|
| `CapabilityState.note` | 28 rows / 27 strings | `/screening-health` | **CLOSED by this batch** |
| `NeedsAssessmentQuestion.prompt` | 13 | `/needs-assessments` | **already closed** — `promptAr` sits beside it, which is the recorded fix and the precedent for this batch's shape |
| `RetentionScheduleItem` template `note` | 8 | `/retention-disposal` | **OPEN.** Same field name, same class, a second real instance. Counted, NOT fixed |
| `ProviderHealth.detail` | ~9 in the four screening adapters | `/screening-health`, one card ABOVE the notes | **OPEN.** Several are transport-error text (`(err as Error).message`) which is not api prose and cannot be localised at all |
| `EmailProviderHealth.detail` | 2 prose + 6 error-text | `/settings/email` | **OPEN**, same split |
| `ProviderHealth.providerName` | 3 (`readonly name`, one per adapter) | `/screening-health`, under «الاسم» | **OPEN**, and found by OPENING THE CAPTURE rather than by the sweep — a sweep over display-FIELD names cannot see a field declared as `readonly name`. It renders beside a TYPE that reads «القائمة المحلية المزامنة», which `ScreeningProviderKind` gained a label map for last batch |

**`health.detail` is on the SAME screen as the notes and is deliberately left**, which is worth
saying plainly rather than leaving as an omission: this batch has no Arabic for those sentences, and
inventing it is the one thing the standing rule forbids. So `/screening-health` still has English
prose on it, one card above the table this batch translated.

#### THE CAPTURE FIXTURE'S NINE NOTES WERE ALL INVENTED — third instance, same file, same screen

Six of the nine notes in `design-pass-screenshots.spec.ts` were sentences that appear NOWHERE in the
product: `Local watchlist.`, `Recurring sweep.`, `Four-hourly re-screen.`, `No callback endpoint.`,
`No PEP source is configured.`, and a mis-cased OFAC line. Three happened to match.

That is the third instance of this class in one file, on one screen, across three batches:

1. `capabilities` carried TWO rows where the product renders NINE;
2. `byOutcome` named `CLEAR` and `ERROR`, which are not members of `ScreeningAttemptOutcome`;
3. nine note sentences the api never sends.

**Her table for the notes came off the SOURCE and not off the picture** — it quotes `Only sanctions
lists are synced.`, which my fixture never contained — so this one cost her nothing. The first two
cost her words. The fixture's notes are KEYS now, so a wrong one is a compile error against
`CapabilityNoteKey` rather than a believable picture of a product that does not exist.

#### A comment of mine over-claimed the mechanism, and the parity guard is what makes it true

Last batch I wrote, at `PROVIDER_CAPABILITY_LABEL_KEY`: *"A third capability added to the api should
be a COMPILE ERROR in the web."* **False for a value arriving over HTTP.** The compile error fires
when somebody edits the WEB union — the second half of the job, not the first. A member added in the
api ALONE makes the lookup return `undefined`, `t(undefined)` renders nothing, and the row loses its
label with nothing failing anywhere.

`packages/db/prisma/capability-note-parity.spec.ts` is what makes it fail, and it is the fifth
cross-package parity guard here for the reason the other four sit in `packages/db`: it is the only
place that can SEE both packages. Six tests, planted four ways — a key added in the api alone (kills
3), a caution demoted to a description (1), a declared key no adapter builds (1), a `null` back in a
label map (1).

### Batch 13 — the date fields: nine sentences, six labels, and a class that is 54 rather than six

**Her measurement reshaped the job before any of it was built.** The script found **19 date fields
worth reading** and she wrote a word for **nine** — two were decided to stay bare, six already had
their Arabic shipping as an invisible `aria-label`, and one cannot have a word until somebody
measures what the product does. Twenty more never needed one.

#### 1 — SIX FIELDS WHERE THE ARABIC WAS ALREADY SHIPPING, SPOKEN ONLY

Her framing is the finding: *a blind reader was better informed than a sighted one, which is
backwards — the aria is supposed to be a FLOOR, not a better version.*

| screen | seen | spoken | what changed |
|---|---|---|---|
| `/client-accounting` | «كما في» | **«تاريخ الرصيد»** | `caAsOf` took the spoken value; `caAsOfDateAria` WITHDRAWN |
| `/financial-report` | «كما في» | **«تاريخ الرصيد»** | `frAsOf` took it; `frAsOfDateAria` WITHDRAWN |
| `/insurer-accounting` | «كما في» | **«تاريخ الرصيد»** | `iaAsOf` took it; `iaAsOfDateAria` WITHDRAWN |
| `/operational-pi-risk` | «تنتهي في» | **«تاريخ انتهاء المسؤولية المهنية»** | `opPiExpiresFieldLabel` took it; `opPiExpiresAtLabel` WITHDRAWN |
| `/audit-trail` ×2 | **«من تاريخ» / «إلى تاريخ»** | the same two | **NO TEXT CHANGED** — see below |

**NO ARABIC WAS TYPED.** The value is MOVED programmatically out of the aria key into the label key
and the aria key is then withdrawn in both languages — the `pcColOwnerType` treatment, where the
key whose NAME describes what it now is survives. A retyped «تاريخ الرصيد» is a shadda/vowel trap
for no gain.

**AND HER PREMISE ABOUT `/audit-trail` WAS FALSE, BECAUSE MY OWN SCRIPT TOLD HER SO.** Her table
records those two as having nothing visible. They have a visible label, and the aria merely
repeated its own key — `aria-label={t('atFromLabel')}` beside `{t('atFromLabel')}`. The script
reported *"aria-label only — no visible text"* because `BARE_KEY` was anchored at BOTH ends and the
line reads `{t('atFromLabel')}{' '}`, a text node followed by a JSX space. **Third instance of a
wrong measurement of mine becoming an owner input**, after the two capture fixtures. The aria still
goes — one key used twice is a drift risk and nothing else — but no string moved.

#### 2 — THE CLASS SHE ASKED ME TO COUNT AND STOP: 54, NOT SIX

`scripts/measurements/aria-vs-visible-label.py`, over every control in the web tree:
**209 aria-labels across 73 files — DIVERGENT 54, DUPLICATE 7, REDUNDANT 89, ARIA-ONLY 47,
UNRESOLVED 12.**

**That is the BEFORE figure, which is what she asked for.** After this batch's own six (plus
`/dashboards/executive`) it reads **201 across 70 — DIVERGENT 49 (fuller 8, thinner 10, unrelated
31), REDUNDANT 86** — so five divergences and three redundancies are closed and **49 remain**.

**54 is not a number anybody can act on, so it is split by WHICH READER LOSES**, and reading the
bucket rather than counting it found that **the class runs in BOTH directions and the second one is
the one she was not shown**:

| direction | count | what it means |
|---|---|---|
| **FULLER** | 8 | the spoken text CONTAINS the seen text — **the eye loses**. Her class |
| **THINNER** | 10 | the seen text CONTAINS the spoken text — **the EAR loses**, and what it loses is a qualifier |
| **UNRELATED** | 36 | neither contains the other — a different sentence, OR the resolver found a NEIGHBOURING control's label. **22 of the 36 name a deliberately-written `*Aria` key**, the signature of a control meant to have only an aria, so most of this bucket is the matcher rather than a defect |

**THE SHARPEST ROW IS NOT IN HER SIX AND IT IS A THINNER.** `/settings/users`' password field: seen
«كلمة المرور (١٢ محرفاً على الأقل، مع حرف كبير وصغير ورقم ورمز)», spoken «كلمة المرور». **A
screen-reader user is never told the password policy** — they type one, it is refused, and nothing
on the field ever said what was required. `pcAccountAria`'s recorded defect, in the direction nobody
proof-reads. Six more of the ten drop «(اختياري)», so a screen-reader user cannot tell which fields
are optional on six screens.

**So the honest answer to her question is 18 real plus 36 that need reading by hand.** Not six, not
sixty. **Nothing in this class was fixed beyond her six**, which is what she asked for.

#### 3 — TWO FIELDS DECIDED TO STAY BARE

| screen | label | |
|---|---|---|
| `/regulatory-compliance` | «ينتهي الإيقافُ في (إن كان محدَّدًا)» | **no hint, by her decision** |
| the claim card | «استلم العميل مبلغ التسوية بتاريخ» | **no hint, by her decision** |

**Recorded as DECIDED, not as unfinished**, so the next reader does not "complete" the set. Her
reason: a hint over a clear label is noise, and noise is how people stop reading the hints that
matter.

#### 4 — THE COVER-CEASES MEASUREMENT: THE DATE IS THE FIRST DAY COVER DOES **NOT** APPLY

`EndorsementSection.tsx`'s «تتوقّف التغطية» is bound to `cancelDate`, and `cancelDate` **exists
nowhere in the api** — the web submits it as the endorsement's `effectiveFrom`. So the question is
what `effectiveFrom` means for a cancellation, and **both halves of the product answer the same
way**:

* **the schedule.** `versionScheduleForEndorsement` closes the open schedule with
  `effectiveTo := effectiveFrom` and, for a cancellation, writes **no successor**. For an ordinary
  endorsement the successor OPENS at that same instant, so the interval must be half-open or the
  boundary day would sit in two versions at once — and `claim.config.ts` says so in its own words:
  **`effectiveFrom <= lossDate < effectiveTo`**, with `t < s.effectiveTo.getTime()` in the code and
  a test named *"treats the version boundary as [from, to)"*. A cancellation therefore leaves the
  boundary day belonging to nothing: **a loss ON that date resolves to no schedule.**
* **the money.** `cancellationReturnPremium` counts `unexpiredDays` as
  `daysBetween(cancellationDate, expiryDate)` — so **day D itself is refunded to the client.** A
  client who is refunded for a day must not also be covered on it.

**Consistent, so there is no finding — and the label «تتوقّف التغطية» / *Cover ceases* is not wrong,
only ambiguous by one day.** Her sentence is owed and it should say *the first day cover no longer
applies*, never *the last day of cover*.

**ONE TEST WAS ADDED BEYOND THE LETTER OF THE INSTRUCTION, with the reason.** The cancellation case
was consistent BY CONSTRUCTION and asserted nowhere — the sibling test covers an endorsement
boundary, where a successor exists. A sentence on a screen is only as good as what pins the
behaviour it describes, so `claim.config.spec.ts` now asserts that a loss on the cancellation date
is NOT covered and that the day before still is. Planted with `<=` for `<`: both boundary tests die,
each for its own reason.

#### 5 — THE NINE SENTENCES, AND WHERE EACH RENDERS

| # | key | renders on | her sentence |
|---|---|---|---|
| 1 | `execAsOfHint` | `/dashboards/executive` | تُعرض أرقام اللوحة كما كانت في هذا التاريخ. |
| 2 | `ipPeriodStartHint` | **`/employee-performance` AND `/insurer-performance`** | أول يوم تُحسب عليه الأرقام في هذه الشاشة. |
| 3 | `ipPeriodEndHint` | **both of the same two** | آخر يوم تُحسب عليه الأرقام في هذه الشاشة. |
| 4 | `dashPeriodStartHint` | `/sales-performance` | أول يوم تُحسب عليه أرقام المبيعات. |
| 5 | `dashPeriodEndHint` | `/sales-performance` | آخر يوم تُحسب عليه أرقام المبيعات. |
| 6 | `crateEffectiveFromHint` | `/commission` | أول يوم تسري فيه نسبة العمولة هذه. |
| 7 | `endorsementEffectiveFromHint` | the endorsement form | أول يوم يسري فيه الملحق. |
| 8 | `slapHolidayDateHint` | the holiday calendar | تاريخ يوم العطلة. |
| 9 | `bcpNextTestDueLabel` | `/bcp-dr-plans` — **a LABEL, not a hint** | تاريخ الفحص القادم للخطة. |

**Rows 2 and 3 are ONE shared pair and must not be split.** Her sentence says *the figures on this
screen* rather than naming employees or insurers precisely so that it is true on both — a split is
two more of her sentences for a gain she has already declined.

**Row 9 is a LABEL because there was no label.** That input had no label, no `aria-label`, no `id`
and no `htmlFor` — the one row the measurement could not read at all — and it renders only after a
button is pressed, which is why the a11y suite had never seen it. **The cell is a stack now**, which
is the space changing rather than her sentence: a label that long beside an input and a Save button
in one table cell is the caution-in-a-111px-column shape again.

**NOT ONE OF THE NINE GOES THROUGH `Field`** — measured, and it changes the mechanism. All nine are
a raw `<label>` wrapper or a `<div><label htmlFor>` pair, so the `hint` slot the previous batch said
this would reuse is not reachable at any of them without converting six screens onto a primitive
that changes a control's width and a label's type scale. **`Hint` is extracted from `Field` instead**
and `Field` now renders it, so there is one home for what a hint looks like and one wiring
(`aria-describedby`) for how it is announced. A hint left INSIDE a wrapping `<label>` becomes part
of the accessible NAME rather than the description — the cheaper edit, and the wrong one.

#### 6 — THE ECHO, AND THE HALF OF IT THAT DOES NOT WORK IN ENGLISH

`DateEcho` renders the chosen date through `formatDate` under the field, on all 14 inputs this batch
touched. `aria-hidden` and deliberately NOT in `aria-describedby`: a date input already announces
its own value, so an echo in the accessibility tree is the same fact twice on every focus — which is
why `Field`'s `hint` slot was measured as the wrong home for it.

**The Date is built at LOCAL midnight from the ISO parts, never `new Date('2026-03-04')`** — that
parses as UTC midnight and `toLocaleDateString` renders in local time, so west of UTC the echo would
show THE DAY BEFORE. `SlaHolidayCalendar` already carries that warning in its own words.

**AND MEASURED RATHER THAN ASSUMED, which found the limit:**

| language | `formatDate(4 March 2026)` | calendar | digits |
|---|---|---|---|
| AR (`'ar'`) | **`4‏/3‏/2026`** — DAY-first | gregory | Western |
| EN | ~~**`3/4/2026`** — MONTH-first~~ → **`04/03/2026`** — DAY-first | gregory | Western |

**CORRECTED 2026-10-30, AND THE CORRECTION MATTERS BECAUSE THE WRONG HALF WAS REPORTED TO HER AS A
LIMITATION OF HER OWN FEATURE.** `EN_LOCALE` is **`'en-GB'`**, not `en-US`. Measured through the
product's own constant, 4 March 2026 renders **`04/03/2026`** — DAY-FIRST, the OPPOSITE of the
input's `mm/dd/yyyy` placeholder. **So the echo closes the ambiguity in BOTH languages.**

The defect was mine and it is the ordinary one: **I measured a locale I assumed instead of reading
`EN_LOCALE`.** Caught when a re-pointed Playwright assertion on `/bcp-dr-plans` predicted `9/6/2027`
and the page rendered `06/09/2027` — so the thing that found it was a test asserting an EXACT value
rather than a substring.

**Her decision «ميلادي فقط — حالياً» is satisfied either way**: both are Gregorian, measured.

~~**The closure needs no new words and is NOT taken here**: a LONG month form, for which
`AR_MONTH_LOCALE = 'ar-JO-u-nu-latn'` already exists…~~ — **WITHDRAWN: THERE IS NO CLOSURE OWED.**
That paragraph existed only to describe how to fix an English gap that does not exist, so the
`AR_MONTH_LOCALE` widening is NOT a question for her and must not be put to her as one.

THE ORIGINAL CLAIM, kept because it is what the correction corrects: *the echo closes the ambiguity
in Arabic and does NOT close it in English, where `formatDate` reproduces the same month-first order
as the input's own placeholder; it disambiguates only when one number exceeds 12, and is silent in
exactly the case it exists for.*

#### 7 — THE HEDGE RESTORED, AND HOW IT WAS FOUND

`shNoteOnPremisePepVerify`'s Arabic now opens **«حسب ما إذا كانت»**, matching the English's own
*Depends on whether*. It read «تتضمّن فعلاً» — *the dataset DOES include PEP data* — which ASSERTED
what the English HEDGES, on a caution about whether politically exposed persons are screened at all.
The clause went missing when the sentences were extracted **for** her, not when she wrote them, so
it was never hers to drop.

**It was caught by comparing the two languages against each other, not by reading either alone.** A
bilingual pair where one half makes a stronger claim than the other is a defect neither an Arabic
reader nor an English reader can see. The note stays a `CAUTION`, which it already was and now
reads like.

#### 8 — «غير مُهيّأ» IS THE SPELLING, AND A GREP COULD NOT HAVE FOUND THE SET

**Owner decision, 2026-10-30: the fully-marked «غير مُهيّأ» (damma U+064F AND shadda U+0651).**
These are the same word in Arabic, so this is a NORMALISATION and not a rewording: no sentence's
sense changes and no new string is written.

**`grep «مهي» CANNOT MATCH «مُهيّأ»**, because a damma sits between the م and the ه — so the first
reading of this listed only the undiacriticised sites and silently omitted the three that were
already correct. A sweep that reports a subset reads exactly like a sweep that found everything.
`scripts/measurements/not-configured-spelling.py` compares on the form with every Arabic combining
mark REMOVED.

**Measured: 12 lines carry the word, 8 as the negative PHRASE and 4 as the positive word alone.**
Five spellings before, three after:

| | before | after |
|---|---|---|
| PHRASE «غير مُهيّأ» | 3 | **8 — all of them** |
| PHRASE «غير مهيّأ» | 3 | 0 |
| PHRASE «غير مهيأ» | 2 | 0 |

**Her table named two shadda-only sites and there are THREE** — the third is
`shNoteCommercialWebhooksNotConfigured`, which is FEMININE («غير مهيّأة», agreeing with «إشعارات»).
The agreement is untouched; the canonical run covers only the four bare letters of the word itself.
**The canonical bytes were READ OUT of `provStateNotConfigured` rather than typed**, so they cannot
differ from the three that were already right.

**AND THERE IS A SECOND SPLIT SHE HAS NOT BEEN ASKED ABOUT.** The POSITIVE word «مهيّأ» meaning
*configured* ships four times — three without the damma, including `shConfigured`, and once with it
(`provStateConfigured`). **It is PRE-EXISTING on `/screening-health`**, which already renders
`shConfigured` «مهيّأ» beside `screenOutcomeNotConfigured` «غير مُهيّأ», so this change neither
causes it nor closes it. Four sites, one word, hers to rule on.

**IS A DIACRITIC-CONSISTENCY CHECK BUILDABLE? Asked, not answered, and not built in this batch.**
The owner has now paid for this twice. What a check would need is a declared vocabulary of words
whose marking is decided, because the general question — *is this the same word differently
marked?* — needs Arabic morphology and would fire on every legitimate inflection.

#### 9 — SEVEN DEFECTS IN MY OWN INSTRUMENTS, every one found by reading output rather than counting it

Three were recorded in batch 12. Four more here, and **all four UNDER-report, which is the direction
that looks like a clean result**:

* **(5) the aria-label was searched FORWARD ONLY** from the `type="date"` line. Attribute order is
  the author's choice: `/operational-pi-risk` and `/dashboards/executive` both write `aria-label`
  ABOVE `type="date"`, so both read as having no divergence at all. **She found the first by hand.**
  It searches the input ELEMENT now, both directions.
* **(6) `BARE_KEY` was anchored at BOTH ends**, so `{t('atFromLabel')}{' '}` did not match and
  `/audit-trail`'s two inputs were reported as having NO VISIBLE LABEL. **That false reading reached
  her own table.** A START anchor is sufficient and is all that was ever needed.
* **(7) the divergence compared KEYS, not TEXT** — surfaced by fixing (5). Three inputs on
  `/regulatory-compliance` appeared as *ARIA OVERRIDES THE VISIBLE LABEL* while both keys hold
  «تاريخ الإصدار». Two keys and one sentence is a drift risk, not a divergence, and calling it one
  would have put three screens on a list of things that need nothing changed.
* **(8) the sibling import RAN the whole measurement as a side effect**, because `main()` was
  unguarded — so the two scripts' reports interleaved and a reader could not tell which figure came
  from which run.

#### 10 — AND OPENING THE PICTURES MEASURED THE TWO CELLS THIS BATCH RESTRUCTURED, AND FOUND A FIFTH DEFECT

A throwaway probe at 1440px and 390px, then deleted:

| | desktop | phone |
|---|---|---|
| `/bcp-dr-plans` cell / label | 406x86 / 154x19 (one line) | **143x128 / 109x40** (two lines, inside the cell) |
| `/client-accounting` echo | 46x18 | 46x18 |
| `document.scrollWidth` vs viewport | 1440 vs 1440 | **390 vs 390** |

**No horizontal overflow at either width**, so the stacked cell is the space changing rather than
the sentence — which is her own rule and the ring caption's own treatment.

**AND IT STACKS WITH NO WRAPPER, WHICH THE RATCHET DECIDED RATHER THAN TASTE.** The first version
wrapped the cell in a styled `div`, and `check:inline-styles` refused at **SCREEN 1100 against a
budget of 1099** — that budget may only FALL. The echo is a `<p>`, so it breaks the line on its own
and the cell stacks anyway; the figures above are the version without it.

**AND THE COMMENT EXPLAINING THAT REMOVAL WAS ITSELF COUNTED AS A SITE.** It named the attribute it
was about, the gate reads TEXT, and the count stayed at 1100 after the wrapper was gone — **this
repository's own recorded limit, met inside the comment explaining it.** Found by diffing the
per-file counts against HEAD rather than by re-reading the diff.

**The desktop capture is what the batch is for, in one line:** «تاريخ الرصيد» · `03/04/2026` ·
`2026/3/4`. The label says WHICH date, the control shows the user agent's month-first order, and
the echo shows the same date arranged differently — so a reader who typed `03/04` meaning 3 April
can see that it was read as 4 March.

**AND THE PHONE CAPTURE FOUND A FIFTH WAY `/bcp-dr-plans` IS BEHIND.** Its section heading renders
the RAW enum member `system_outage` while the `<select>` **five lines above it** renders
`t(ENUM_LABEL.BcpDrScenario[s])` — so one screen gives two answers to what a scenario is called:
you pick «انقطاع النظام» from the dropdown and the section you created is headed `system_outage`.
The map is complete and bilingual and already in use on that same screen. **The dead-vocabulary
class, found by opening a picture rather than by any gate** — and recorded rather than fixed,
because she moved that screen to its own batch. It needs no words, which is what makes that batch
cheap.

**AND `e2e-anchored-reads.test.ts` CAUGHT A VACUOUS ASSERTION IN ONE OF THIS BATCH'S OWN NEW
TESTS, BEFORE IT SHIPPED.** The `/bcp-dr-plans` test opened with
`await expect(page.locator('input[type="date"]')).toHaveCount(0)` and nothing positive asserted
first — and `toHaveCount(0)` passes on its FIRST poll, so it could not tell *correctly withheld*
from *the page has not rendered yet*. That guard exists because `navbar.spec.ts` asserted exactly
that for 107 commits; **this is the first time it has fired on its own stated scenario in a test
written the same day.** The anchor is the control that OPENS the row, which proves the row the
assertion is about is on screen.

**AND MY OWN EDIT TOOL WROTE SIX SCREENS AND THEN REFUSED.** It wrote each file as it finished and
raised on the last, leaving six half-converted on disk and making the next run's anchors miss. **A
refusal that has already edited the tree is worse than no refusal, because it reads as "nothing
happened".** It computes every file before writing any, now.

### Held back — one commit that needs a workflow-scoped push

`check:opacity-muting` is wired into `package.json` and into `npm run check:screen-pass`, so it
runs locally. **Its CI step is written and is NOT on the branch**: GitHub refuses a push that
creates or updates a workflow file without `workflow` scope, and the credential this machine
defaults to does not carry it.

It is held as a single 13-line commit on the local branch **`wire-opacity-gate-into-ci`**,
rather than sitting in the working tree where it would be the most losable thing in the repository.
It was kept OFF `module-0b/provider-registration` deliberately: any commit touching `ci.yml` blocks
the push of the ENTIRE branch, so leaving it in line would hold every later commit hostage to one
line.

**RETRIED AFTER THE OWNER GRANTED `Contents: Read and write`, AND STILL REFUSED — with the same
message, which is the diagnosis.** The refusal NAMES `workflow`, and this repository's own recorded
rule is the discriminator: *a 403 that names `workflow` is a scope problem and a flat one is a
write-access problem.* So the write access she granted is present and working — four other commits
pushed on this same credential in this same batch — and what is missing is a different permission:

* on a **fine-grained** token, the **Workflows** repository permission. It is its own row and is
  NOT implied by Contents, which is why granting Contents changed nothing here.
* on a **classic** token, the `workflow` scope checkbox.

**AND THE BRANCH WAS REBASED ONTO THE CURRENT TIP WHILE THIS WAS BEING CHECKED.** It still sat on
`ea991cd`, three commits behind, so merging it in that state would have brought back the previous
versions of sixteen files — the whole of the batch before this one, reverted. It is one commit on
the tip now, so a merge brings exactly the thirteen lines and nothing else. The hash moves whenever
it is rebased, so it is named by BRANCH here rather than by commit; the previous note pinned
`b9794f4` and that hash is already stale.

**Until it lands, the gate is in the unwired-script state this repository already records against
itself** — a number nobody can trust, because nothing runs it where it matters.

---

---

---

## Batch 14 — closing the pass: everything recorded and not fixed that could be

The owner's test for this batch was not the list. It was: *when it is reported, is there anything
left in this register that is both MECHANICAL and OPEN?* The answer is at the bottom of this
section, with the one remaining item named and its size measured.

**Nothing in this batch needed a new Arabic word**, which is the line that kept it mechanical. Two
items started to need one and both STOPPED — they are named below rather than guessed at.

### 1 · Her last date sentence shipped, and the assertion was written with it

**«أول يوم لا تسري فيه التغطية.»** — `endorsementCoverCeasesHint`, on the cancellation date of the
endorsement form, where «تتوقّف التغطية» was ambiguous by exactly one day and one claim.

She deliberately did not write this one until the behaviour was measured, and the measurement is
what makes the sentence safe to print: `cancelDate` is submitted as the endorsement's
`effectiveFrom`; `versionScheduleForEndorsement` closes the schedule at
`effectiveTo := effectiveFrom` with **no successor** for a cancellation; `claim.config.ts` reads
`effectiveFrom <= lossDate < effectiveTo`; and `cancellationReturnPremium` counts `unexpiredDays`
FROM that date, so the client is refunded for it. Both halves agree: **day D is the first day not
covered.**

**THE HINT AND THE ASSERTION WERE WRITTEN TOGETHER, and that pairing is the thing to record.** The
previous batch added a test beyond the letter of its instruction — a loss ON the cancellation date
is NOT covered, pinned by name in `claim.config.spec.ts` — because the case was consistent BY
CONSTRUCTION and asserted nowhere. A hint that contradicts the behaviour is worse than no hint,
because it is believed; this one cannot drift silently now, in either direction.

### 2 · The 26 literal colours, and the gate is the deliverable

**17 converted, 9 declared, the gate wired, and the defect turned out to be ARITHMETIC.**

The brief said *the fix is the gate, not the sites*, and that was right for a reason neither of us
had measured. Against the two card surfaces (`#ffffff` light, `#1e2733` dark):

| literal | what it was | on light | on DARK | the token | light | DARK |
|---|---|---|---|---|---|---|
| `#b91c1c` | danger text | 6.47 | **2.33** | `--danger-ink` | 7.26 | 6.76 |
| `#15803d` | success text | 5.02 | **3.01** | `--success-ink` | 6.50 | 7.81 |
| `#b45309` | warning text | 5.02 | **3.00** | `--warning-ink` | 5.91 | 7.91 |
| `#c00` | danger, via a `var()` fallback | 5.89 | **2.56** | `--danger-ink` | 7.26 | 6.76 |
| `#2a7` | ok, via a `var()` fallback | **2.96** | 5.08 | `--success-ink` | 6.50 | 7.81 |
| `#6b7280` | muted ink | 4.83 | **3.12** | `--ink-muted` | — | — |

**Five of the six fail AA in the dark theme. `#2a7` fails the OTHER way round, in LIGHT** — so a
policy that passed its QC check rendered its own *no discrepancy* marker at 2.96:1 for every
light-theme reader, which is the `--brand-800` ramp inversion met a second time. **The a11y suite
is silent about all of it** for the same reason it is silent about `opacity`-as-muting: axe reads
RENDERED contrast and Playwright runs one theme, so a literal that is legible in whichever theme
the suite happens to be in is a pass.

**AND WIDENING THE MATCHER FROM `.tsx` TO `.ts` FOUND A 27TH SITE, WHICH IS THE WORST ONE.**
`auth-form.styles.ts:119` set the primary button's label to a literal `#ffffff` on
`background: var(--brand-600)` — and the dark theme flips that fill to `#6bb0e6`, where white
measures **2.34:1** against `--on-brand`'s **7.70**. That is the SIGN-IN button's own label, on the
first screen this product shows anybody, and **`Button`'s own `primary` variant already carried a
comment naming that exact defect**: *"`--on-brand`, not a literal white… white would measure 3.02:1
— the defect reference page B shipped."* The primitive was fixed once and the sign-in form kept the
literal, invisible because every `*.styles.ts` file was outside the matcher. **Same blind-spot class
as `hardcoded-ui-english.py` never scanning `components/`** — a measurement reporting a clean figure
over a surface it does not read — and it means the owner's 7 and my 26 were BOTH low.

**THE FLOOR BECAME A `--self-test`, AND IT HAD TO.** `FLOOR = 10` was the non-vacuity guard against
a real 26; the moment the sweep succeeded it REFUSED a correct tree at 9. **A count floor goes stale
every time the work it guards gets done** — so the matcher is now proven against 12 planted inputs
(7 positives including a `var()` fallback pair and a gradient at alpha, 5 negatives including a
token reference, a comment quoting a removed colour, and a hex-looking id), which holds at any count
including zero.

**THE NINE THAT REMAIN ARE DECLARED WITH WHAT EACH IS FOR, because `rgba()` is not automatically a
defect and converting one to make a sweep finish is worse than leaving it:**

| site | ×  | why there is no token |
|---|---|---|
| `NotificationBell` `#b42318` + `#fff` | 2 | A SOLID red badge with white text. The semantic set ships (bg tint, ink, border) for a NOTICE and has no solid step — using `--danger-ink` as a background inverts in dark (a pale `#e59a9a`). The code has read `var(--danger-solid, …)` since it was written: somebody anticipated the token and it was never added. |
| `IdleLockOverlay` `rgba(0,0,0,0.6)` | 1 | A modal scrim. It must NOT follow the theme — a scrim that lightens in dark mode stops being a scrim. |
| `AuthFrame` radial gradients | 4 | `--brand-600` and the amber at ALPHA. A plain `var()` cannot express a token at an alpha, and the amber's own rule (1.99:1 on white — never text, never a ground) is what makes it safe as a glow and unsafe as anything else. |
| `BrandPitch` white at alpha | 2 | On the one surface that stays dark in both themes. The site's own comment already records it: there is no token for *a sixth of the surface above me*. |

**`--danger-solid` IS THE ONE TOKEN DECISION STILL OWED and is deliberately not taken** — it needs a
light value and two dark ones, and `globals.css`'s 86 properties are a set somebody reasoned about.
Adding a token to empty a list is what the brief forbade.

**AND THE COLOUR SWEEP MOVED A SECOND GATE, which is the two meeting.** `check:css-properties`'
fallback-only list went **5 → 2**: `--error` and `--ok` disappeared because pointing those sites at
real tokens removed the undefined references entirely. Then the third was fixed on the same ground:
**`--status-warning-ink` is defined nowhere**, so `/insurers/[id]`'s attention count fell back to
`var(--ink-primary)` and rendered IDENTICALLY to the four ordinary counts stacked beside it — while
its own comment says it is *"emphasised because it is the one the API reports separately for exactly
that reason."* It was not emphasised at all. `--warning-ink` is the token that means this. The two
survivors are `--danger-solid` (above) and `--font-geist-mono` inside `globals.css` itself.

### 3 · `/bcp-dr-plans` — three of five closed, and the two words are hers

CLOSED: both literal colours; both `.slice(0, 10)` dates now through `formatDate`; and **the raw
`system_outage` section heading, which needed no word at all** — `ENUM_LABEL.BcpDrScenario` ships
all five bilingually and the `<select>` eighteen lines above already rendered it, so one screen gave
two answers to what a scenario is called: you pick «انقطاع الأنظمة» and the section you created is
headed `system_outage`. **Found by opening the phone capture, not by any gate.**

**STILL OWED, AND THE REASON IS SHARPER THAN *nothing ships*.** Measured both:

- **`'not scheduled'` HAS A BYTE-IDENTICAL ENGLISH TWIN** — `vendNotScheduled`, doing the identical
  job on `/vendors/[id]`: a next-due date nobody has set. **And its Arabic cannot be reused.**
  «غير مجدولة» is FEMININE, agreeing with «المراجعة» (the review); this screen's subject is «الفحص»
  (the test), which is masculine. Agreeing it to «غير مجدول» is Arabic morphology, which a slice can
  never be, and which this repository has refused by name twice — the «محاولتان» dual and
  «تقويمي»/«تقويمية». **That is a better finding than *no source*: the English twin exists and the
  gender is what blocks it.**
- **`'never'` has no twin.** The nearest are `icNone` «لم يُجرَ أي تدقيق بعد» and `dcmpNoScanYet`
  «(لم يُجرَ أي فحص بعد)» — full SENTENCES where this cell holds one word. «فحص» IS this screen's own
  noun for a test, by her own row-9 decision, so the raw material is right there; the register and
  the length are hers.

**AND THE MODE-8 COUNT IS THREE**, which the brief asked to be recorded as a number:
`/data-sharing-approvals`, `/sales-performance`, and now this. `hardcoded-ui-english.py` reports 0
and is right to — both strings are the ternary-of-bare-literals shape mode 8 excludes BY DESIGN,
because the identical shape is a `data-*` hook elsewhere and tolerating it makes every bare call a
finding. **Three instances is where a known limit stops being theoretical, and the honest closure is
the two keys, not a wider matcher. DO NOT WIDEN MODE 8.**

### 4 · The aria class — 54 → 14, and the 14 that remain are the matcher

| bucket | before | after | treatment |
|---|---|---|---|
| DIVERGENT / FULLER (the eye loses) | 8 | **1** | the spoken value became the VISIBLE label, or the aria was dropped |
| DIVERGENT / THINNER (the EAR loses) | 10 | **0** | the aria dropped; the fuller visible label becomes the accessible name |
| DIVERGENT / UNRELATED | 36 → 31 | **13** | 18 were plainly the same class and are closed; 13 are matcher noise |
| DUPLICATE (two keys, one sentence) | 7 | **0** | the aria dropped |
| total aria-labels | 209 / 73 files | **159 / 67 files** | 25 keys withdrawn in both languages |

**NO NEW STRING ANYWHERE.** Every fix is a REMOVAL or a MOVE of a value that already ships — a label
pointed at the richer KEY, never Arabic typed.

**THE SHARPEST ROW IS THE ONE SHE NAMED, AND IT IS CLOSED.** `/settings/users`: the eye read
«١٢ محرفاً على الأقل، مع حرف كبير وصغير ورقم ورمز» and the ear read «كلمة المرور», so a
screen-reader user was never told the password policy, typed a password, was refused, and nothing on
the field had ever said what was required. Six more THINNER rows dropped «(اختياري)» — the ear was
not told the field was optional — and two more are worse than that: `/communications`' channel field
loses *«(اتركها فارغة لاستخدام القناة المفضّلة المسجّلة للعميل)»*, which is the only thing that
explains what leaving it empty DOES, and `/ropa-entries` loses «(مفصولة بفواصل)», which is how to
type the value at all.

**TWO MORE THINNER ROWS CAME OUT OF THE *UNRELATED* BUCKET AND ARE WORSE AGAIN**:
`CommissionSection`'s override reason spoke «سبب التعديل» against a visible
«السبب (إلزامي، ويُسجَّل)» — so the ear is never told the reason is mandatory and RECORDED, on a
commission override.

**THE FOUR DASHBOARD FILTERS WERE DROPPED RATHER THAN PROMOTED, and the row itself is the reason.**
«تصفية حسب فرع التأمين» spoken against «فرع التأمين» seen — but every OTHER filter in that same row
(the branch field, the period fields) carries no *filter by* aria, so one control announced itself as
a filter and its siblings did not. Promoting it would lengthen four dashboards' visible labels;
adding *filter by* to every filter in the product is a NEW CONVENTION and hers. Dropping makes one
string serve both readers with nothing changing on screen, and removes a key shared across four
screens — a drift risk by itself.

**ONE ROW WAS A DUPLICATE IN MEANING RATHER THAN A DIVERGENCE** and is recorded because the
treatment differs: `iafAuditPeriodLabel` «الفترة التدقيقية» (adjectival) against
`iafAuditPeriodFieldLabel` «فترة التدقيق» (construct) — two phrasings of one thing, neither fuller.
The aria went and the VISIBLE one stayed: the conservative choice between two of her words, needing
none. **And the key SURVIVED, because it still heads its own column** — which is also what confirms
dropping was right rather than promoting.

**THE 13 THAT REMAIN ARE ALL THE RESOLVER, AND THE CAUSE IS ONE DEFECT.** `labels_for` falls through
to the nearest text node, which can be a BUTTON, an EMPTY-STATE sentence or a HEADING. So it reports
`ScreeningCasePanel`'s escalation textarea — which has `aria-label` + `placeholder` with the same key
and **no `<label>` at all**, an ARIA-ONLY control — as *spoken «سبب التصعيد» | seen «تصعيد»*, where
«تصعيد» is the button above it. Thirteen rows have that shape. **Reported rather than fixed, and a
gate for the class is NOT built**: a ratchet on a matcher with 13 known false rows is a red build on
a clean tree, and the first false red teaches everyone to ignore it.

### 5 · The sixteen table scrollers, and the twelve that must keep theirs

**Re-measured before starting, as the brief required** — and the measurement classified them
independently of her list: **28 wrappers, of which exactly 16 wrap the `<Table>` primitive**, which
is her list to the site. The other 12 wrap a **RAW `<table>`**, where that div is the ONLY scroller
and removing it would be the regression rather than the fix.

16 removed, `SCREEN_BUDGET` **1099 → 1083** — exactly one site per wrapper, which is what makes the
fall reconcile. Each close was matched by DEPTH COUNTING rather than a blanket replace, because
`</div>` nests.

**AND REMOVING THEM DROPPED A LIVE TEST HOOK, which is the `data-*` class from the other direction.**
`watchlist-sync`'s wrapper carried `data-testid="watchlist-runs"`, read by two Playwright
assertions. Five times this repository has paid for a hook being silently dropped BY A COMPONENT;
here a sweep removed the element that carried one. It is on the `<Table>` now, which forwards `data-*`
onto its own `<table>` through the template-literal index signature — which is what that signature is
for. `ropa-entries`' wrapper also carried `role="region" aria-label={t('ropaHeading')}`: a region
named after the page's own `<h1>`, which announces nothing a heading does not, and whose removal also
retired one of the 13 matcher-noise rows.

### 6 · The four `(auth)` screens wear the frame

`/login` adopted `AuthFrame` in the pilot and **links to `/forgot-password`**, which still wore the
old bare card — so this product's first impression went wrong one click in. All four now use the
frame, with `pitch` OMITTED: `AuthFrame`'s own comment already recorded why, in advance — *«a reader
who is already resetting a password does not need selling to, and the panel there is the mark
alone»*. No new words, and the frame renders its own `<main>`, so each screen also shed two inline
style sites.

### 7 · Both record screens have a `main` landmark

`/leads/[id]` and `/policies/[id]` wrapped every branch in a `<div>` — four each, one per state. **A
page with no `main` landmark is a page a screen reader cannot skip to**, and these are record screens
where the rail is long, so the cost fell on exactly the reader who most needs the shortcut. All eight
branches take it, because a landmark present only in the populated state is one the loading and
refused states lack.

**It was recorded as *more than a wrapper swap*, and that was right for a batch forbidden to change
structure. It is eight lines.**

**AND MY OWN CONVERTER WAS DEFEATED BY A COMMENT, which is this repository's own recorded limit met
inside the tool.** `leads/[id]` carries a comment explaining a past fix that QUOTES `` `<div>` `` —
so the depth counter matched it, the count went wrong, and the script REFUSED with *no clean matching
`</div>`* and **wrote nothing**, which is the half that mattered. Comments are blanked (positions
preserved) before counting now.

### 8 · `/sla-policies` has its `@a11y` test

The second of the two COMPLIANCE screens that had none. Written in ARABIC, for the same two reasons
as `/screening-health`'s: these words were written for that reading direction, and this screen is
THREE tables — and this batch removed sixteen scrollers across nine screens, so the markup around
every table in the product moved. Anchored on content from both independently-loaded surfaces, so a
run where one request escaped the mocks cannot pass as a clean a11y result over half a screen.

### 9 · The CI steps — and it was ONE, not three

**Measured rather than trusted, and the brief's own figure was wrong.** `check:token-contrast` and
`check:inline-styles` are ALREADY in `ci.yml` on this branch (lines 124 and 133), and the held
branch's own diff confirms it: `5a17f08` adds exactly one step, and *"Inline styling may only fall"*
appears in it as unchanged CONTEXT. So only **`check:opacity-muting`** was absent.

Both steps are WRITTEN and **NEITHER IS PUSHED**: the push was refused a second time, naming
`workflow` — so they are held on `wire-both-design-gates-into-ci`, named for what it does rather
than by a hash that moves. The previously held branch `wire-opacity-gate-into-ci`
is **superseded** — it sat four commits behind and carried the same 13 lines.

### 10 · What stays deferred, and why

| left | why |
|---|---|
| the expand/collapse and the filter strip on `/incidents` | new INTERACTION, and a filter that hides rows can hide an overdue containment — her decision |
| the collapsed rail as a drawer | a toggle, a focus trap and an escape key: BEHAVIOUR |
| the rail's layout out of inline styles | larger than this batch, and the `!important` is recorded as its consequence |
| widening `check:raw-values` and `check:css-properties` | matcher changes with their own blast radius |
| a custom date control | the calendar question is answered (**Gregorian only, for now**); the control is its own piece of work |
| `--danger-solid` | a token needs a light value and two dark ones — § 2 |
| the two English words on `/bcp-dr-plans` | hers, and the gender finding is why — § 3 |
| «مُهيّأ», the POSITIVE word | hers; 4 sites, 3 spellings without the damma and 1 with |
| a gate on the aria class | the matcher has 13 known false rows — § 4 |
| Tajawal has no weight 600 | a property of the face, stated not fixed |
| `ProviderHealth.providerName` · `.detail` · `RetentionScheduleItem.legalBasis` | **measured now — § 11. The register's claim about all three was too strong, and about one of them wrong in its noun.** |

### 11 · "No Arabic exists" was a claim, and it was not measured

The register said of `ProviderHealth.providerName`: *"No Arabic exists for it and inventing one is
what the standing rule forbids."* **That was repeated to the owner. Measured, it is too strong for
one value, and the sibling claim about `RetentionScheduleItem` is wrong in its NOUN.**
`scripts/measurements/api-display-strings.py` re-derives all of it.

**THE THREE PROVIDER NAMES — AND THE ANSWER IS BETTER THAN DERIVING.**

| the api sends | verdict |
|---|---|
| `'On-premise screening engine'` | **EXACT.** `screenProviderOnPremise`'s English is byte-identical, and «محرك فحص محلي» ships beside it. |
| `'Commercial screening provider'` | **NEAR, 0.67.** `screenProviderCommercial` is `'Commercial provider'` — one word apart. Reported, not pointed at. |
| `'Built-in watchlist cache (OFAC SDN + UN Consolidated)'` | **NONE** as a whole string; the kind label «القائمة المحلية المزامنة» plus the parenthetical's own Arabic inside `shNoteBuiltInSanctionsSynced` («OFAC SDN وقائمة الأمم المتحدة الموحّدة»). |

**BUT THE REAL FINDING IS THAT THE ARABIC IS ALREADY ON THAT SCREEN, EIGHT LINES ABOVE.**
`/screening-health` renders `providerLabel(health.provider)` at the «المزوّد» row from
`ENUM_LABEL.ScreeningProviderKind` — the Arabic kind label — and then renders `health.providerName`
RAW in English at «الاسم». **So for two of the three, `providerName` is a SECOND answer to a
question the row above already answers, in the wrong language.** For the third it adds one genuine
extra fact — WHICH lists — and that fact ships too.

**REPORTED AND NOT SHIPPED, by her own instruction** (*do not ship any of it unless deriving it is as
mechanical as the 27th note was — these render on a compliance screen, and the owner reads the
derivation before it goes live*). It is not: the honest fix is removing a duplicate ROW from a
compliance screen, or putting a KEY on the wire the way the 27 capability notes now do. Both are hers
to read first.

**`ProviderHealth.detail` IS NOT ONE THING, AND TWO OF ITS TEN ARE ALREADY COVERED.** Ten distinct
strings across eleven sites. **`shMissingConfig` ALREADY SHIPS BILINGUALLY** — and is rendered on
that very screen, as an `ErrorState` directly beneath the English `detail` it duplicates. So for a
NOT_CONFIGURED provider the same claim is on screen TWICE, once in English from the api and once in
Arabic from the dictionary, and **the Arabic one is RICHER** (it carries the *automated screening is
not configured* clause the api splits across two variants). That is a duplicate, not a gap.

Of the remaining eight: **three interpolate a RAW fragment that can never be localised** —
`(err as Error).message` twice, and an 80-character slice of a remote engine's own response body —
**but the sentence AROUND it can be.** *"Provider unreachable: {raw}"* becomes Arabic with the
fragment left exactly as it arrives. **Splitting the translatable carrier from the untranslatable
fragment is the work; declaring the whole row impossible is what the measurement refuses.** The other
five interpolate only numbers, URLs or env-var names — all language-free — so they are ordinary
parameterised strings.

**AND `RetentionScheduleItem.note` DOES NOT EXIST.** The field is `note` on the TEMPLATE and
`legalBasis` on the ROW, and they are not the same column — the register named the wrong one. What
actually ships is **eight statutory CITATIONS**: article numbers in both scripts («المادة ١٧/أ»),
an Official Gazette reference, and a PROVISIONAL marker. **Translating one is a legal act rather than
a translation**, and the column is EDITABLE by the office under decision 80 — so a localised copy
would be a second home for a value a person may replace. Verdict: **NOT-A-LABEL.** Nothing is owed
here, and that is a different answer from *nobody has written it yet*.

### THE QUESTION THIS BATCH IS JUDGED ON

**Is anything left in this register both MECHANICAL and OPEN? One thing, and it is new — my own
measurement found it while closing § 5.**

**TWELVE WRAPPERS HOLD A RAW `<table>` WITH NO `tabIndex`**, which is batch 3's keyboard trap
UNFIXED: a scroll region nothing can focus is one a keyboard user cannot scroll at all, and axe
raises `scrollable-region-focusable` only when a region actually overflows. `/dpo-workspace` ×5,
`/financial-report`, `/settings/customer-import` ×2, `AdminAccessRecord`, `WatchlistGenerations`,
`EncryptionKeyInventory`, `SlaHolidayCalendar` — including the DPO's own workspace.

**AND IT IS NOT PURELY MECHANICAL, WHICH IS WHY IT IS STOPPED RATHER THAN DECIDED.** The cheap fix
— adding `tabIndex={0}` to twelve divs — **introduces a second defect**: a thing that takes focus and
does not show it leaves a keyboard user with no idea where they are, which is exactly what `Table`'s
own comment says its focus ring is for. Doing it properly means either four lines per site (a copy of
`Table`'s focus handling, twelve times) or converting the twelve onto the primitive — a markup sweep
across every cell of twelve tables, where `design-pass-sections.py` has refused files before.

**So: one item, measured, with both options and why neither is a one-liner.**

**AND ONE THING IS OPEN WITHOUT BEING WORK, which the answer above would otherwise hide:** the two
CI steps are written and refused, so `check:opacity-muting` and `check:literal-colours` run locally
and not in CI. That is not an engineering task — the push needs `workflow` scope on the credential
and the refusal names it — but it IS the thing this repository has paid for three times, so it does
not get to sit in the deferred table as though somebody chose it. It is one push.

**Everything else in this register is either closed, deferred with a reason, or a word that is
hers.**

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
