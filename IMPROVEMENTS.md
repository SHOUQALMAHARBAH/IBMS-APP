# IMPROVEMENTS.md

## The principle these entries are instances of

> **Prefer the form that cannot express the mistake over the form that requires you to notice
> it.**

Nearly every fix in this file is that one move, applied somewhere new. It is worth absorbing as
a sentence, because a reader who has it will make the right call in a situation none of the
numbered entries covers — which is the only kind of documentation that scales.

| The form that requires noticing | The form that cannot express the mistake |
|---|---|
| A comment asserting an invariant (§ 1.23) | A test asserting it |
| "These are the only columns this view exposes" | A key allow-list asserted as a whole set (§ 1.19) |
| Remembering that a child row must agree with its parent's office | A composite FK making a disagreeing row fail to INSERT |
| Remembering to write `canonicalName` correctly | A `GENERATED ALWAYS … STORED` column the application cannot write |
| Remembering not to select a relationship column | A `SECURITY DEFINER` view where it is unreachable |
| Remembering that a migration changed a stored key | A `DO` block that refuses to deploy if it did not recompute |
| Reading `setting \|\| unit` and spotting `"5242888kB"` (§ 1.32) | `SHOW`, or separate columns, which cannot concatenate |
| Believing an extraction's «unreadable» about the source it came from | Reading the SOURCE — an absence claim is measured on the object it is about |
| An extraction marking a figure «trusted» because it came out in Latin digits | Nothing: OCR emits Latin digits for Arabic-Indic input, so the signal carries no information |
| A gate counting a population that cannot contain its subject | Measuring the class from the discriminator's own direction before trusting `ok` |
| Declaring a structured legal literal by NAME | Pinning its figure SET, so a figure added to the array cannot change no key |
| A citation comment that happens to render above a declaration | A comment block ending at its own `*/`, attributed to the declaration below it |
| Reading a character class to check its ranges (§ 1.34) | Decoding it and diffing against the intended set |
| Remembering that a guard covers only one directory (§ 1.34) | A sanity test that fails when a root moves |
| Believing a published count because it was carefully derived | A `--self-test` that plants each column's condition and fails unless the number moves (§ 1.79) |
| Reading "all green" off a gate that sees only workflow runs | A gate that also reads check-runs and names both passes |
| Trusting a sweep that reported success over empty output | A non-vacuity check that aborts when rows < commits |
| A scanner's alert list as the set of instances | Reading the line's other person-authored values |
| Actioning a usability complaint | Measuring it — the leak was behind one |
| Protecting a field because of its neighbour | Deriving protection from the fact it holds |
| Searching for the component you changed | Searching for the screens, from the inventory you already hold |
| Explaining a fault you did not read the tool's output for | Reading it — the tool probably said it |
| Anchoring a negative on its container | Anchoring it on something the role actually holds |
| Treating a single collision as a data problem | Computing its rate first — one in three here |
| Trusting that a reset seeded | Checking 219 permissions AND 502 grants |
| Reading "no checks reported" off a zero exit code | Reading the commit's own check-runs and asserting their COUNT |
| Waiting until nothing is pending (rule 12) | Waiting until the thing you named is PRESENT and `completed` |
| A comment claiming a figure is not restated here | A declaration that imports it, asserted on the source text |
| A guard reading a generated copy of its subject | A parity spec making the copy unable to diverge |

The tell that you are on the wrong side of the table: the correct and incorrect versions LOOK
THE SAME, and only care separates them. Care is not a control — it is the thing that was
already being applied when the defect got in.


## The blind instrument — what "CI is green" meant in this session, and what it means now

Added 2026-10-01, after the merge of PR #25. **Nothing above or below this section has been edited
to match it.** The claims it corrects were made in good faith by a gate that could not see the thing
it was reporting on, and a record that quietly rewrites them loses the only useful part — that the
instrument looked exactly as trustworthy while it was blind.

### The claims produced by it

`scripts/check-ci.sh` read `gh run list`, which lists **workflow runs**. A **check-run** is a
different object, and an app can post one with no workflow behind it. Every "CI is green" reported in
this session before 2026-10-01 was therefore scoped, without saying so, to *workflow runs only*:

| Claim | True at | False at |
|---|---|---|
| "All CI green through `cc95b09`" | workflow-run level | check-run level — `CodeQL` was `failure` |
| "CI is green on `b366561`" | workflow-run level | check-run level — `CodeQL` was `failure` |
| any green reported for the `7e83fd7` batch | workflow-run level | same alert, same line |

### What the sweep found — measured, not argued

`gh api repos/:owner/:repo/commits/<sha>/check-runs` for **all 143 non-merge commits** the branch
added to main: **788 check-run rows**.

**Three commits carried a failing check-run, and no others** — `7e83fd7`, `cc95b09`, `b366561`. All
three are the SAME single alert, `scripts/export-permission-catalogue.ts:107`, *Incomplete string
escaping or encoding* (high), introduced by the export commit and carried forward on every push until
`c590c85` fixed it. Every other non-green row belongs to `github-actions` and was visible to the old
instrument: the reds already in this file's § 1 (`477965d`, `395a0a3`, `ce95dbb`, `29b1e73`) and
`cancelled` rows from superseded pushes.

**Exactly two reporters post check-runs on this repository**, which is what bounds the blast radius:

| Reporter | app_id | Checks | Visible to `gh run list`? |
|---|---|---|---|
| `github-actions` | 15368 | `frontend`, `backend`, `docker (api)`, `docker (web)`, `analyze (javascript-typescript)` | yes |
| `github-advanced-security` | 57789 | `CodeQL` | **no** |

So the instrument's blind spot was exactly one check, and with 0 open code-scanning alerts on main the
one defect it hid is closed. Had there been a third reporter, every green in the session record would
need its scope restated rather than just these three.

**AND 14 OF THE 143 COMMITS HAVE NO CHECK-RUNS AT ALL** — nothing ever verified them. They are
non-tip commits of multi-commit pushes: CI runs on the pushed tip, and `check-ci.sh` only ever looked
at HEAD. Not a fault, but it makes "every commit on this branch was verified" false where "every
pushed tip was" is true. Say the second.

**AND THE FIRST SWEEP WAS ITSELF VACUOUS.** It piped to `jq`, which is **not installed on this host**;
all 143 iterations exited 127, both output files stayed empty, and the wrapper printed
`swept 143 commit(s); 0 with no check-runs at all`. It was one step from being reported as "a measured
nothing". `gh api --jq` is gh's own built-in and works; the standalone binary does not exist. The
rewrite uses `--jq` only and **aborts when it collects fewer rows than commits**, so an empty run
cannot be reported as a clean one.

### What the instrument checks now

Two passes, and the workflow pass is KEPT rather than replaced — a workflow that never started posts no
check-run at all, which a check-run pass alone would read as a clean commit. It also takes an optional
commit-ish, because the false green could otherwise only be reproduced by checking that commit out;
`bash scripts/check-ci.sh b366561` now exits 1 naming `CodeQL`, on the exact commit where it printed
"all green".

### And the gate that should have stopped it

A high-severity alert introduced by a pull request did not block its merge, because `CodeQL` was not
among main's required checks. It is now — owner's decision, on the grounds that this system holds
personal data under PDPL and a known high finding reaching main because nothing was configured to stop
it is not acceptable. Bound to **app_id 57789**, so a check merely NAMED `CodeQL` from another app
cannot satisfy it. `enforce_admins` stays `true`; `required_linear_history` stays `false`, because the
no-squash rule needs merge commits to remain possible.

**`analyze (javascript-typescript)` is NOT a substitute and must not be swapped in for it.** It is an
Actions job from the CodeQL workflow, it concluded `success` on `b366561` *while the high alert
existed*, and it reports that the analysis RAN rather than that it found nothing. Requiring it would
look like a security gate and block nothing.

Three properties were measured on throwaway PRs rather than read off the settings page, because a
required check that never arrives blocks every merge forever:

| Probe | What it tests | `CodeQL` | Mergeable |
|---|---|---|---|
| #27, docs only | does the check post when no analyzable code changed? | POSTED, `success` | CLEAN — merge allowed |
| #28, clean code | does a PR with no alert still pass? | POSTED, `success` | CLEAN — merge allowed |
| #29, alert reintroduced | **does the gate actually block?** | POSTED, `failure` | **BLOCKED**, with every other required check green |

The third probe is the point. Proving a clean PR passes does not prove the gate stops anything, which
is the same discipline as a plant: #29 reintroduces the exact escaping defect of alert 3.

### Three rules this branch earned, kept here because they outlive it

**An instrument declares what it cannot see, and "green" names which passes were made.** `gh run list`
sees workflow runs and not check-runs, a Playwright filter that matches no file runs nothing, a
`grep | head` truncates, a mangled regex matches nothing, and `jq` is not installed on this host. All
five produce output shaped exactly like a clean result. So a gate states its own scope — "2 workflow
runs and every check-run green", never "all green" — and a measurement that finds nothing carries a
non-vacuity check that fails when it collected nothing to look at.

**A scanner's finding is a starting point, not the finding.** CodeQL flagged the description column
because it is a plain data flow it could trace. The same defect's reachable instance was the ROLE NAME
column beside it — office-authored since Phase 3, so `Finance | Ops` is a name somebody can really
type — and no scanner named it. It was found by reading the code around the alert and asking which
other value on that line comes from a person. Fix what was flagged, then read the neighbourhood.

**A proof that does not first fail the old form is not a proof.** My first demonstration of the
escaping bug put a space between the backslash and the pipe; the old form came out correct, and I
would have reported a fix for something I had not shown. The adversarial input is a backslash
IMMEDIATELY before a pipe, which yields five cell boundaries where a row has four. Same shape as a
plant that kills no test, and as the length ladder that had to grow rather than merely not clip: run
the broken version first and watch it fail, or the proof is decoration.

## A flaky test observed once, recorded rather than explained away

**2026-10-01.** `permission-refusal.spec.ts:157` — *"ANY ONE of several codes — a route guard, which ORs
them"* — failed **all three attempts** in one full web e2e run, and passed in the run before it, in the
run after it, and 4/4 in isolation. Three readings, not one, which is what makes this a flake rather
than a regression.

Recorded because the alternative was to call it flaky on a single data point and move on, and because a
growing flaky count is a different problem from a stable one (§ 1.47). The baseline is now **one known
flaky test, observed once**. If it recurs, that is a trend; if a second appears, read § 1.47 before
reaching for a timeout, because raising one is § 1.1's mistake.

What it is NOT: it cannot be the one-field customer search that landed the same day. The test drives
`/customers/kyc-queue`, which carries no customer field at all, and it passed in a full run against the
identical component.

What it has in common with the four `rfq.spec.ts` flakes § 1.47 diagnosed: **six sequential awaits
before its first assertion**, against a 30s budget, on a machine where the full suite runs 640 tests
across two workers. That is the shape — several interactions, one assertion at the end — and the fix
when it recurs is to wait on each step's own settled state rather than to widen the budget.

## A usability complaint deserves measurement as much as a correctness complaint

**2026-10-01, and this is the one to generalise from.** The owner reported a two-field customer picker
as *"right but not practical."* A usability complaint. Measuring it rather than just actioning it found
that the field **searched on mount with an EMPTY term**, which returns the first page of the whole
customer book, and that **nothing recorded the search** — so opening `/complaints` listed customers
before anybody typed.

That is the customer directory her own four anti-browsing conditions exist to forbid, **already
running**. And no automated check could have found it: the screen worked, the request succeeded, the
result was correct, every test passed. A privacy leak was sitting behind a complaint about ergonomics.

So: **a complaint about usability gets the same measurement a complaint about correctness gets.** The
reason is structural rather than motivational — a usability complaint is a report from the one position
no test occupies, which is a person using the thing for its purpose. "It works but it is awkward" and
"it works and it should not" produce the same sentence from a user and are told apart only by measuring.

### The three rules from the same exchange

**A field's protection is derived from the nature of the fact it holds, not from sitting next to a
sensitive field.** Two reversals in one day came from this. A corporate registration number was going to
be masked and reveal-gated because it sits in the next column to a national ID — but it is on a public
register, so masking it hides a number anybody can look up, at the cost of searching and screening on
it. "Treat it the same" across two fields of different nature produces theatre at a real cost. The same
error is available in reverse: putting that public number behind `sendIdentifiers`, a flag built to
protect Highly Confidential identifiers, would make every default deployment screen companies by name
alone.

**When you already hold an inventory, the search runs against the inventory.** The one-field change broke
three specs. The scope search had looked for the COMPONENT (`EntitySearch`, `entity-search`,
`customerPickerSearch`) in the test directory and found one of them — while the eleven-screen inventory
the change was built from had been sitting there the whole time. Grepping the e2e directory for those
eleven ROUTES finds every spec that touches one, including
`retention-disposal.spec.ts`, which drives the field through
`getByLabel("Customer (optional)").selectOption(...)` and names neither the component nor its test
hooks. The rule is not "search harder": it is that an inventory already paid for is the thing the next
search is keyed on.

**A block that reads as a thorough check and proves nothing is the most expensive kind of green**, and it
is found by fixing things that look cosmetic. 52 api lint errors looked like formatting. Fixing them
surfaced that `row` was possibly `undefined`, and that `row!` would have silenced it while leaving six
`expect(row).not.toHaveProperty(...)` assertions running against `undefined` — where **every one of them
passes**, because `undefined` has no `contactPhone` either. Six assertions reading as a careful
narrowness check, proving nothing. `no-unsafe-member-access` on a response body is not a style rule.

### And the handover sentence, kept deliberately

The one-field control replaced a native `<select>` that had been chosen BECAUSE it carries ARIA roles,
focus management and keyboard handling for free. Two a11y defects got through that handover — a listbox
carrying the field's own label, and the field's accessible name becoming "Customer Clear" the moment
somebody selected a customer — and **axe caught neither, passing 80/80 throughout**. Both were found by
specs driving the control, and one of those specs was written only because CI failed.

**So: the combobox in `EntitySearch.tsx` is the least-proven part of that change rather than the
best-proven.** Said here rather than in a commit message because it is the sentence a future reader
needs before touching it, and because an a11y suite passing is not the same claim as an a11y behaviour
being verified.

## A tool whose output you discard cannot be said not to complain

**2026-10-01.** Running the plant tool as `node scripts/plant.mjs --revert` is a USAGE ERROR — it needs
the plants file and the plant name. The tool said so, every single time, and exited non-zero. I had
written `>/dev/null 2>&1` after it.

What made it expensive was not the mistake, it was the explanation. Plants began accumulating in the
tree, and rather than reading what the tool had printed I **invented a mechanism**: "`--revert` holds one
backup slot, so the fourth plant's anchor had already been eaten." Plausible, consistent with the
symptom, and entirely wrong. The tool's own guard — the guard that exists precisely so a plant cannot
silently fail — was working, and I was throwing the evidence away and then theorising about the result.

It also stranded a plant in the working tree when a background run was killed, found only by checking
each of five markers by hand.

> **Before inventing an explanation for a fault, read what the tool said. It probably said it.**

And the narrower operational form: **do not redirect a tool's output to `/dev/null` when you are relying
on it to have succeeded.** `grep -c PLANTED` or an exit-code check costs nothing; a fabricated mechanism
costs a wrong diagnosis that then gets written down. This is the fifth instance in two days of
absence-of-output being read as absence-of-finding, and the first where I went on to construct a theory
on top of it.

## Anchoring a negative on a container that does not hold the thing

**Two instances, both in nav tests, so this is a pattern rather than a slip.**

`expectNone(target, anchor)` exists because an absence assertion passes trivially on an unrendered page,
and the anchor is what proves the page rendered. **The anchor has to be something that would be present
in the failing case too** — and a CONTAINER is not that.

  * § 1.61: `getByRole('link', …)` returned 0 whether the DPO was denied `policy.read` or handed it,
    because a collapsed `<details>` keeps its anchors out of the accessibility tree.
  * 2026-10-01: `page.locator('nav').first()` is the TOP NAVBAR, not the sidebar — two `<nav>` landmarks
    exist, each with its own accessible name. A navbar holds no destination links, so an absence
    assertion against it is **true for free**, whatever the gating does. It surfaced only because the
    companion POSITIVE test failed; the negative passed happily.

> **Anchor a negative on something the role actually HOLDS, inside the same container — never on the
> container itself.** A container that cannot hold the thing makes every negative on it true.

The sidebar is addressed by its accessible name (`getByRole('navigation', { name: /^(Primary|…)$/ })`),
which is what `sidebar-manager.spec.ts` already did; and the absence of the KYC-queue entry is anchored
on `/customers`, a destination that role does hold.

The general form, because this is not only about nav: **a negative and a positive assertion on the same
container is one test, not two.** Writing the positive first is what tells you the container is the right
one.

## Before treating a single case, compute its rate

**2026-10-02.** One employee name appeared twice on dev and it looked like a data problem to resolve.
The arithmetic says otherwise: `personName()` drew four independent `pick()`s over pools of roughly
14 / 11 / 11 / 14, which is about **24,000 combinations**, and at **135 draws** the birthday problem
puts a collision at **nearly one in three**.

So *135 employees, 134 distinct ordered keys, exactly one collision* is not bad luck — **it is the
predicted outcome.** A generator whose collision rate is the collision rate of its pool will keep
producing these, and the next one lands on whichever table gets a unique key next.

> **Compute the rate before treating the case.** A single instance tells you nothing about whether you
> are looking at an accident or at a distribution; the rate tells you which, and therefore whether to
> fix the row or the thing that produced it.

Fixing the GENERATOR once is the correct unit. It now tracks the ordered keys it has issued and will
not reissue one — checked on the **ordered** key rather than the sorted one, so the demo data cannot
contain accidental cousins of itself either, and it no longer draws the same name for father and
grandfather, which halved the usable space for nothing.

The same arithmetic is why the colliding dev PAIR was renamed rather than deleted and why the renamed
value was checked against the existing set first: a replacement drawn from the same pool is as likely
to collide as the original was.

## A verification that confirms itself — two instances, 2026-11-08

> **A check whose subject and whose instrument share the same fault reports success.**

Both of these are stronger examples than anything else in this file of the class the owner's
"re-run it" rule exists for, because in both the assertion **passed** and the thing it asserted was
false. Neither was caught by reasoning; both were caught by a number moving when it should not have.

**One — the write succeeded, the read-back succeeded, the file was 0 bytes.** Extracting the module
papers on Windows, one archive entry was named `00 - الفهرس: الترتيب…md`. A colon after the drive
letter is an **NTFS alternate-data-stream separator**, so `open(p, 'wb').write(data)` wrote 32,327
bytes into a *stream* named ` الترتيب والتوزيع والأسئلة.md` hanging off a 0-byte file called
`00 - الفهرس`. Python raised nothing. The extractor's own assertion — `open(p,'rb').read() == data`
— **passed**, because the write and the read-back both resolved to the same stream, so the check
confirmed the stream against itself. `Get-Item -LiteralPath <f> -Stream *` shows it exactly:
`:$DATA` **0**, the named stream **32,327**.

Three things follow, and the third is the one worth keeping:

- **Verify an extraction by hashing the DIRECTORY and the source into two maps and comparing
  them.** Never by re-reading the path you just wrote. Any verification that travels the same
  resolution path as the write can only confirm that path, not the result.
- **Reject `< > : " / \ | ? *` in a basename explicitly**, before writing. Do not rely on an
  exception: there is none.
- **Git would have refused the path anyway** — a tree containing it answers `error: invalid path`,
  exit 1, on checkout — so it could never have landed in this repository. **It did not bite us
  because the archive was renamed to English kebab-case the day before, for legibility.** That
  rename is recorded as the decision it was: a change made for one reason that removed an NTFS
  metacharacter as a side effect. Luck is not a control, and a reader who finds this entry should
  not conclude the hazard was handled — it was avoided.

**Two — the correction and its assertion shared one pattern, so the correction was wrong and the
assertion agreed.** Moving the oldest `## What's New` row to history also updates the sentence
counting the history's rows. The mover carried its **own** copy of the row pattern,
`^\| 20\d\d-\d\d-\d\d \|`, which does not match the two two-day rows (`| 2026-09-22/23 |`,
`| 2026-09-30/10-01 |`). It therefore set the sentence to **133** when the truth was **135** —
**and its post-condition assertion passed, because the assertion counted rows with the same faulty
pattern.** A test that shares its subject's bug confirms the bug. Caught only by reconciling the
live table plus the history against the pre-move total, which is an independent route.

The fix is not a better pattern. **The pattern is imported from the gate that owns it**
(`scripts/measurements/whats-new-cap.py`'s `ROW` and `CAP`) instead of restated, so the mover and
the gate cannot disagree — one home for one fact, which is the same remedy this file applies to
duplicated counts everywhere else. The general rule:

> **Two routes agreeing is evidence only when they are independent in the thing that can be
> wrong.** Sharing a matcher, a resolution path, or a copied constant is not independence.

## The absence claim measured on a derivative — 2026-11-10

> **"Unreadable in OUR EXTRACTION" is not "unreadable in the SOURCE."** An absence claim about a
> source is measured on the source itself, never on a derivative of it.

This is rule 11's sharpest instance and it cost the owner a search for numbers that were never
missing. It is recorded separately because **the failure was not that nobody re-measured — it was
that the re-measurement was performed on the wrong object.**

**What happened.** `docs/legal/cbj-instructions-9-2026-source-text.md` is OCR output from a scanned
PDF. It marks eight figures «رقمٌ غير مقروء». That claim travelled — into
`docs/legal/00-index-sources.md`'s list of gaps, into `docs/modules/00-index-...md`'s deadline
section, into the module-1 paper as *"a first item in this module that code does not write"*, and
into a comment inside `scripts/measurements/legal-numbers.py`. **Every one of those said the
instrument was unreadable. The instrument is plainly legible; the OCR was not.** All eight read
first time off the page images: effective date **24/6/2026** (p3) · **5,000 / 6 branches**,
**7,500 / 12**, **10,000 above 12** (p5) · **2,000 JOD** (p17) · art. 15/e/2's full text (p17) ·
**50%** (p26) · **30 days** (p29).

**And the repository already held the refutation.** `docs/legal/cbj-instructions-9-2026-reading.md`,
dated 9 October, carries the amounts checked against the page images, and `CAPITAL_BANDS` in
`broker-license-scope.config.ts` has held 5000 / 7500 / 10000 with 6 and 12 the whole time. A
four-way agreement sat beside the claim and nobody put them next to each other.

**The second half, which is worse than the silence.** The extraction does not merely decline to
read those figures — **it publishes two WRONG ones and marks them «موثوق» (trusted)**:

| | the extraction | the instrument |
|---|---|---|
| art. 4/a/2 amount | **7,000** — "Latin digits, therefore trusted" (its raw line 129) | **٧٬٥٠٠** |
| art. 4/a/1 branch cap | **5 branches** — "Latin digits, trusted" (raw line 127) | **٦** |

**One mechanism, and it is the generalisable part:** the file's stated reliability rule — *Arabic-Indic
digits are corrupted by this OCR, Latin ones survived* — **treats a Latin-digit OUTPUT as evidence of a
Latin-digit INPUT.** It is not. Both figures are drawn in Arabic-Indic digits in the instrument, and
the OCR emitted Latin digits with different values. So:

> **An instrument's confidence signal is only as good as the inference behind it.** "It came out in
> Latin digits" says nothing about whether it was read correctly, and every figure that file marks
> trusted on that ground inherits the doubt — including art. 13/b/2's **50,000**, which has not been
> read from the image and is neither confirmed nor refuted.

**What was done.** The source text is NOT edited — it is source, and correcting it in place would make
it lie to the next reader. One dated marker sits at its head naming both wrong figures, the mechanism,
and the 15/e item-number slip (`م(15/هـ/3)` where the paragraph has two items and the rule is the
second). The four derived places carry dated markers with the old text left visible. `CAPITAL_BANDS`
now carries art. 4/a's citation on its own declaration, with the 7,000-vs-7,500 disagreement named.

## A gate that was green over a population that did not contain its subject — 2026-11-10

`npm run check:legal-numbers` read **149 declarations scanned, 2 cited, 2 declared, ok** — while the
largest block of legal figures in the codebase sat outside everything it counted. `CAPITAL_BANDS`
carries five of art. 4/a's figures and was invisible **twice over**, by two independent mechanisms:

1. **Shape.** The gate's unit was *a bare numeric constant declaration*. These are object properties,
   and the three amounts are **strings** — because `money-decimal-jod.md` forbids a JOD figure existing
   as a JS number, and that rule is correct. **So the right rule for money hid the figures from the
   right rule for legal numbers.**
2. **Attribution.** The `ART. 4/a's BANDS` doc comment was not above `CAPITAL_BANDS` at all. Two doc
   comments were stacked and the citation rendered above `INSURANCE_LINE_CATEGORIES`, two declarations
   up. A reader consulting the capital bands met a comment about an unrelated array, and a
   shape-aware gate reading the declaration's own comment block would still have found no citation.

**The class was measured before it was fixed, and from the direction that cannot be biased by the
shapes one happens to think of**: start at every comment block that CITES a legal source and ask what
it governs. 191 cited blocks across the three scanned roots → 2 bare numeric constants (the two the
gate saw) · 13 declarations in other shapes carrying digits, **of which 0 are legal figures** once the
digits are read properly (citation text like `'art. 10/a/2'`, call expressions, and one explicitly
drafted non-legal heuristic) · 12 cited blocks governing another comment, **of which exactly 1 is a
real detached citation** — `CAPITAL_BANDS`. And 101 citations live in `.prisma`/`.sql` and 18 in
`apps/web/app`+`components`, which the gate does not read at all: all of them are prose or
provenance notes, **none a figure a program reads.**

**The instrument reproduced the defect it was hunting, which is why this entry exists.** Its first
version accumulated comment lines until a non-comment line — merging two stacked blocks — and so
attributed art. 4/a's citation to the next declaration down and reported it as carrying no digits.
That is the same misattribution the gate's own `own_comment_block` was written to prevent, committed
by the thing measuring it. A block now ends at its own `*/`, and a cited block followed by another
comment is reported as ORPHANED rather than silently assigned to someone else's declaration.

**And the fix had to be the discriminator, not a declaration**, because of the plant the owner asked
for: *add a seventh figure to `CAPITAL_BANDS` and show the gate goes red*. A declared list keyed by
`path:NAME` would NOT have gone red — the key does not change when a band is added to an array that
is already declared. So `DECLARED_FIGURES` pins the figure SET, and the gate fails on an added, a
removed or a changed figure, naming it. Three plants: a fourth band → red naming `15000` and `20`;
`7500` → `7000` (the extraction's own wrong figure) → red naming both directions; re-detaching the
comment → red as *declared but no longer found*.

**The accepted cost, stated rather than hidden:** `DECLARED_FIGURES` is a second written home for
those five numbers. It is accepted because the gate FAILS when the two disagree, so they cannot
silently diverge — the standard `permission-catalogue-parity.spec.ts` already sets.

## Rule 12 — a completeness predicate asserts the PRESENCE of what it waits for, four instances

> **١٢ · شرطُ الاكتمال يؤكّد وجودَ ما ينتظره، لا غيابَ ما يخافه.**
>
> **A completeness predicate must assert the PRESENCE of what it waits for, never the absence of
> what it fears.**

Promoted to a numbered rule in `docs/modules/00a-day-one-setup-and-verification.md` § ٤ on
2026-11-10, by the owner, on the ground that four measured instances is what separates a rule from
an anecdote. **The common shape, which is what to recognise:** *a condition evaluated over an input
that could be empty, where EMPTY and SATISFIED are the same answer.*

| # | The predicate | Why empty satisfied it | Measured |
|---|---|---|---|
| 1 | a pipeline through `jq`, with failures defaulted away by `\|\| true` | the `jq` BINARY does not exist on this host, so every extraction was empty and every emptiness read as "no failures" | two CI watches reported green while the build was red |
| 2 | `[ -f "$script" ] && exec bash "$script" \|\| true` | `\|\| true` sat on the line that DECIDES whether a guard runs, so a deleted or renamed hook exited 0 — indistinguishable from a clean pass | 4 of 6 brain hooks were unregistered here and all 7 were recorded `100644`, so on any fresh clone they were inert |
| 3 | `all(check-runs are success)` | the check-run set was wholly green **under a workflow run still `in_progress`** — the later jobs had not produced rows yet | a green read taken off an object that could not yet disagree |
| 4 | `all(bucket != "pending")` over `gh pr checks` | a workflow run NOT YET REGISTERED contributes **no row**, so the predicate was vacuously true over a set that did not contain the job it was waiting for | announced ALL CHECKS SETTLED listing only CodeQL's two rows while `CI status=pending` on the same sha |
| 5 | `gh pr checks <n>` keyed on its EXIT CODE | it printed `no checks reported on the '<branch>' branch` **and exited 0** — so *no checks exist* and *all checks passed* are the same answer from the tool's own exit status | measured 2026-11-10 while 5 check-runs were already `in_progress` on that exact sha |
| 6 | a watch keyed only on `actions/runs?head_sha=` | **the runs index LAGS the check-runs API** — `commits/<sha>/check-runs` showed 5 jobs `in_progress` at 16:30:01Z while the runs index still returned an empty list for several minutes | the corrected watch emitted `WAIT` three times through that window and concluded nothing, which is why the WAIT branch had to exist rather than being a nicety |

**The fix in every case is the same move this file opens with:** key on a value that must be
present. For (4) that is the RUN's own `status == completed` on the exact sha, with *no run
registered yet* emitting an explicit WAIT line rather than silence; for (2) it is `exit 2` naming
the missing file; for (1) it is `gh --jq`, which needs no binary, plus a non-vacuity floor.

**And a fifth instance landed minutes after the fourth was written up, which is the argument for
treating this as a shape rather than a bug list.** A step-level watch tested `.conclusion != null`
while `gh` returns `""` for a pending step — so one wrong emptiness test produced a false
"36/36 concluded" AND listed the 10 unrun steps as failures, wrong in opposite directions at once.
Corrected to `!= null and != ""` → 26/36, 0 not-success.

> **And the generalisation rows 5 and 6 add, which is the part worth keeping:** *two GitHub APIs disagree about whether a build exists, and the disagreement has a DIRECTION — the check-runs API knows first.* So "no run has registered" is a statement about one index at one moment, never about the build. It must emit a WAIT line and never a verdict — and a tool that says "no checks reported" while exiting 0 must never be keyed on its exit code.

> **A sharpening of the measurement rule, from the same batch:** *the figure that survived longest
> wrong is the one whose unit sounded like the thing it was not.* Three of four wrong figures in
> module 1's opening measurement were a wrong UNIT, not a wrong count — `perm:` keys counted a
> comment quoting the pattern, roles/grants counted all offices where the subject was one, and
> "8 call sites across 6 modules" was the FILE count wearing the word *modules*.

## The standing rule for every number this file publishes

> **A figure that cannot be moved by a plant is published as an ESTIMATE, and says so.**

Owner's rule, 2026-09-29, after "writes the column" was read as "reads the relation" three times
and writing the lesson down had not worked. Before a count goes in a report, plant the condition
it claims to detect and confirm it moves — the instrument already used on guards (the
nav-reachability check reported 0 findings until a plant proved it vacuous), turned on published
columns.

Two things learned implementing it, both worth more than the rule itself:

- **The report and the self-test must share ONE measurement seam.** A self-test over a parallel
  implementation certifies the parallel implementation: it looks like rigour and proves nothing.
  `combined-duty-projection.py` routes both through `measure(sources)` for that reason, and
  mutates sources IN MEMORY so a failing self-test cannot leave the tree dirty.
- **The plant must assert its own anchor.** `planted()` refuses when the text it expects is
  absent, so a self-test cannot pass quietly against code that moved — § 1.51(a)'s shape, one
  level up.

**An estimate labelled as an estimate costs nothing. A count that was never planted, presented as
a count, is what this file has repeatedly paid for.**

---

Consolidated backlog of **things to fix** — bugs, CI/test failures, missing
wiring, unsourced values, security & compliance gaps, and tech debt — gathered
while building Part C (Domains A–D). This is the **cross-cutting action list**;
the per-backlog-item deferred edges live in `README.md` § "Known gaps (per
completed backlog item)" and are not repeated here except where they compound
into a system-wide problem.

**Status:** first compiled at parent `17e52b4` / `ibms-brain` `ed9ad56` (Domain
D complete); topped up through Part C #46 (**Domain E — Customer Service is
now complete**: #41 Customer Requests, #42 Complaints Management, #43 SLA
Management, #44 Customer Communication, #45 Customer Feedback, #46 Customer
Retention). This file is the plan for the "solve every gap / threat / bug"
pass the user asked for **after** the backlog build finished; the pass has
now **begun**, starting with **§5.1 (PDPL foundations)** — M03 Consent
Management landed 2026-09-04, the first of the pass's items to be actioned
(partially — §5.1 covers nine Part D systems, one is built).

**2026-09-07 note:** this file was NOT kept current across the many sessions
since it was last topped up here — §5.1 (Part D/PDPL), §7.1 (Part F/bilingual
UI), §7.2 (Part E/dashboards), and §8 (not-yet-started backlog) all still
read as if those Parts were unbuilt or barely begun. They are not: Part D's
full 9-system checklist is complete, Part E's six dashboards are complete,
Part F items #1-2 of 8 are complete, and Domains F/G/H (#47-74) are all
complete — see `CLAUDE.md` § What's New and `README.md` § Scope status for
the real current state. A full-codebase code-review audit this session (§10
below) found this exact "a context file's claim survives past the session
that made it true" pattern independently in `meta/context/consent-
management.md` and in stale code comments — this file has the same disease
and needs the same cure: a dedicated pass re-reading §5.1/§7.1/§7.2/§8
against current reality and updating or striking each stale claim, the way
"Resolved since this file was first compiled" already does for individual
items above. Not attempted in this session (out of scope for a "review the
code, then ship Part F #2" request) — flagging it here rather than silently
leaving a misleading document in place.

**Priority key:** `P0` blocks correctness, security, or a real "definition of
done" · `P1` must be fixed before the system goes near production · `P2` tech
debt / quality-of-life.

**2026-09-09 — a "fix the gaps" pass ran against this file.** What it closed,
what it found that was NOT in this file, and what it deliberately left:

*Closed:* §3.1 (commission source of truth — and the DI bug that fix shipped
with, below), §3.2 (refund disbursement, with the approval gate and the
client-funds `out` movement the first attempt omitted), §3.4 (partial
payments, application logic included), §10.2 (both `P2002` handlers), §3.6
(the renewal module — see below), §1.6/§5.8 partially (the rate limiter is
real, gated and no longer bypassable).

*Retracted:* an earlier version of this note claimed a `@nestjs/swagger` /
`@nestjs/schedule` upgrade. There was none to make — the versions were already
correct in both `package.json` and the lockfile, and `npm ls` reporting
`invalid` was a stale local `node_modules`. Regenerating `package-lock.json`
on that mis-diagnosis broke CI (dropped Linux `@rollup/*` binaries; de-hoisted
`vitest`/`next` away from `@testing-library/jest-dom` and `eslint-config-next`).
The lockfile is restored verbatim — see `SECURITY.md` § The lockfile's hoisting layout is load-bearing and undeclared (that reasoning moved there 2026-10-30 when `SECURITY_FIXES.md` was merged and deleted). **Treat this
lockfile's hoisting as load-bearing.**

*Found during that pass, not previously tracked, now fixed:*

- `P0` **The API could not boot.** `InvoiceService` injected
  `CommissionRepository` (added by the §3.1 fix) but `FinanceModule` never
  provided it. Unit tests construct the service by hand with mocks, so they
  passed; the failure only appears at module instantiation. Fixed by importing
  `CommissionModule` (which exports the repository). Caught by a new e2e —
  nothing else in the suite would have.
- `P0` **`Receipt.invoiceId @unique` was dropped in the schema with no
  application logic** — so the §2-recorded P0 ("two receipts per invoice
  possible") was reinstated and `CollectionService.finishReceipt`'s `P2002`
  branch became unreachable dead code. Fixed properly (see §3.4).
- `P0` **…and the migration that dropped it never actually ran.** Migration
  `20260909120000` used `ALTER TABLE "Receipt" DROP CONSTRAINT IF EXISTS
  "Receipt_invoiceId_key"`. Prisma materialises a scalar `@unique` as a unique
  **INDEX**, not a table CONSTRAINT, and `DROP CONSTRAINT IF EXISTS` silently
  no-ops on an index name — so the index survived on every already-migrated
  database (confirmed with `\d "Receipt"` on db-test).
  The effect was a **schema/database divergence**, which is worse than either
  state alone: `schema.prisma` had dropped the `@unique`, so a database
  created FRESH from the schema had no protection at all, while every migrated
  database still did. The same application code was therefore correct on one
  and wrong on the other, and `db:migrate:status` reports "up to date" either
  way because it compares migration HISTORY, not actual schema.
  Caught by an e2e writing a second instalment (`P2002` on `invoiceId`), not
  by reading the migration. Migration `20260909160000` now issues the
  `DROP INDEX`. **Lesson for any future constraint removal here: assert the
  post-state (`pg_indexes` / `\d`), never trust that the DDL matched the
  object type Prisma created.**
- `P0` **The rate limiter made the whole api e2e suite unrunnable.** All 63
  `*.e2e-spec.ts` files sign up and log in repeatedly from 127.0.0.1 against
  one static store with a 5-per-15-minutes budget. Now enforced in production
  only (`RATE_LIMIT_ENABLED=true` forces it on), the same `NODE_ENV` gate the
  rest of the security middleware uses.
- `P1` **The rate limiter was trivially bypassable.** It trusted
  `X-Forwarded-For` unconditionally — a client-supplied header — so rotating
  it minted a fresh bucket per request. Now gated on `TRUST_PROXY_HEADERS`.
- `P1` **`refund.disburse` was the one `@RequirePermissions` code not in the
  seed grid**, so its endpoint returned 403 to every role. And had it been
  reachable it checked no approval at all — an at/above-threshold refund could
  be paid with nobody having approved it, a maker/checker bypass on real money
  out. Both fixed; a cross-check of all 154 used codes against all 157 seeded
  now shows zero unreachable endpoints.
- `P1` **`user.manage` and `dashboard.executive.view` were seeded with no
  endpoint.** The first meant a production-seeded database had the full role
  catalogue, the full permission grid and no way to give anyone a role — see
  §5.9. Both now have one.
- `P2` `common/sanitization.util.ts` was dead code duplicating
  `document-html.util.ts`'s `escapeHtml`. Deleted.
- `P2` `SECURITY_FIXES.md` asserted fixes that did not exist in the tree. **The file is merged into `SECURITY.md` and deleted, 2026-10-30 — and it had done it AGAIN**: its multer acknowledgement still argued *there is no multipart route* after the customer-import upload landed, which is this very entry's shape recurring in the document that records it.
  Rewritten against verified evidence.
- `P0` **Found in this pass's own self-review, before commit:** the first cut
  of the partial-payments change moved the "is this invoice settled?" test out
  of the SQL `where` and into a JS filter — which silently relocates `LIMIT` to
  the wrong side of it. On a book with 5,900 settled and 100 outstanding
  invoices, `orderBy createdAt asc` + `take 5000` would have returned 5,000
  mostly-settled rows, discarded nearly all of them, and understated
  receivables just as badly as the bug being fixed. `loadOutstandingReceivables`
  and `loadInsurerObligations` are now raw SQL with a `HAVING` clause (see
  §6.1), verified against real Postgres by cross-checking both against an
  independent uncapped JS recomputation over db-test — exact match on both.

*Deliberately left:* the drafted/unsourced values in §4 (they need a business
decision, not a code change), real screening (§5.2), the remaining PDPL
systems (§5.1), reporting SQL aggregation (§6.1). None of these are one-line
changes and none should be guessed at.

**Resolved since this file was first compiled** (kept here so the gap isn't
rediscovered — see § 2 for the same convention applied to in-session bugs):

- ~~§5.4 "No consent check before marketing sends (#44)"~~ — **built at #44**
  (`ibms-app` `0ec7fad`/`142df0a`). `POST /communications` derives channel +
  language from the `Customer` record (a disagreeing explicit value is a 422)
  and blocks a marketing send (422, no row, a `REJECT` audit row) unless the
  customer's latest MARKETING `ConsentRecord` is granted and not withdrawn.
  Two new gaps this introduces, not previously tracked, now recorded in
  §5.4's slot in place of the old (now-resolved) entry: no real delivery
  integration (`CommunicationLog` is a *log*, nothing actually sends an
  email/SMS), and the consent-gate is a read-then-write with no DB constraint
  tying the two — a withdrawal landing between the check and the write would
  leave a row citing consent that no longer holds, tolerable only because
  there is no real dispatch yet to make that window matter.

---

## A completion claim made without running the gate that would have checked it

> **This section is the surviving content of `STATUS_90_PERCENT_COMPLETE.md`, deleted 2026-10-30.**

That file reported, on 2026-09-09, that all seven Part G verification gates passed, that
2,416/2,417 unit tests and 309/309 e2e tests passed, that four named fixes were "fully verified",
and that the system was "ready for staging/UAT as-is". A follow-up pass ran the gates it named.
**Seven of its claims were false, and two of the four "fixes" it reported had shipped defects:**

| it claimed | what running the gate showed |
|---|---|
| all 7 Part G gates passing | `npm run lint` **failed** (2 errors in `apps/web`); `npm run test:security` **failed** (8 high advisories) |
| "the 1 unit failure is `app.controller.spec.ts`" | the failure was `security-headers.middleware.spec.ts`, broken by its own security-fixes commit |
| "309/309 e2e passing (100%)" | that is the **web** suite. The **api** e2e suite was never run, and could not have passed: the new rate limiter 429s the sixth auth call and all 63 spec files sign up repeatedly |
| fix #1 commission reconciliation "fully verified" | it injected `CommissionRepository` into `InvoiceService` without providing it in `FinanceModule`. **The API could not boot.** Unit tests build the service by hand, so none of them could see it |
| fix #3 partial payments "enables real-world installment workflows" | it dropped `Receipt.invoiceId @unique` and shipped **no application logic**, reinstating a P0 and turning the `P2002` handler into dead code |
| fix #2 refund disbursement "completes the payment-execution step" | `refund.disburse` was never seeded, so the endpoint 403'd for every role — and it checked no approval, so an at-threshold refund could be paid with nobody having approved it |
| "ready for staging/UAT as-is" | a production-seeded database had no user able to sign in and no way to grant anyone a role |

All of those were fixed at the time. **The lesson is not any one of them — it is that every claim
in that document was made without running the gate that would have checked it**, and that the
document then read as evidence for a whole month. Three of its seven failures are specifically
invisible to the gate its author did run: a missing DI provider cannot be seen by unit tests that
construct the service by hand, an unseeded permission cannot be seen by a mocked web suite, and a
dropped unique constraint cannot be seen by anything that does not write two rows.

**Its TITLE is why it was deleted rather than archived.** A file called
`STATUS_90_PERCENT_COMPLETE` is read by its name long before its contents, and that name asserted
something nobody had verified since September. Four engineers join this repository next week and
would have found it in week one. The warning box it carried — honest, detailed, and at the top —
was not enough, because a name is read first and a box is read second.

**So: a completion figure is evidence only if the command that produced it is in the same
sentence.** That is the same rule as § The standing rule for every number this file publishes, one
level up: that rule is about a count being movable by a plant, and this one is about a count having
been run at all.

---

## The ten numbered finding sections

**Moved to [`docs/findings-register.md`](docs/findings-register.md) on 2026-10-30** — §§ 1-10, 6,700 lines, from CI and test-infrastructure failures through the 2026-09-07 audit.

> ## A numbered reference anywhere in this repository means `docs/findings-register.md`
>
> **ENTRY NUMBERS ARE UNCHANGED, so `IMPROVEMENTS.md § 1.40` and
> `docs/findings-register.md § 1.40` are the same entry.** That sentence is here rather than swept
> through the tree: **30 references to a numbered section exist in code comments, assertion
> messages and `docs/`** (26 under `apps`/`packages`/`scripts`, 4 in documentation), every one of
> which would otherwise resolve to nothing — grepping THIS file for `1.40` returns 0.
>
> A comment-only sweep across ~29 api and web files inside a documentation batch is exactly the
> change that gets mixed in and then cannot be told apart from a real one, so the pointer is made
> true once instead. **THE THREE EXCEPTIONS WERE REPOINTED DIRECTLY**, because they are messages a
> developer reads while a test is RED and will grep rather than browse: `test-app.ts`
> (§§ 1.11/1.22/1.31), `managed-line-writers.e2e-spec.ts` (§ 1.40), and `scripts/audit-check.mjs`
> (§ 1.82) — the last inside a security acknowledgement, where a record citing a section nobody can
> find is the same failure the record itself is about.

**What stayed here is the method**, which is what the sections above are: the blind instrument, the flaky test recorded rather than explained away, anchoring a negative on a container that does not hold the thing, computing a rate before treating a case, a completion claim made without running the gate that would have checked it, and the standing rule for every number this file publishes.

