"""A SPEC THAT CLAIMS ROW-LEVEL SECURITY REFUSES SOMETHING MUST PROVE IT ON A CONNECTION RLS APPLIES TO.

## WHY THIS EXISTS -- measured, and the measurement is worse than the suspicion

On 2026-11-11, building the legal-values table, the e2e suite's own database role was measured on
both databases:

    db-test :  ibms -> rolsuper = t, rolbypassrls = t
    dev     :  ibms -> rolsuper = f, rolbypassrls = f

The same role NAME, opposite privileges. A superuser bypasses row-level security entirely -- **even
`FORCE ROW LEVEL SECURITY`** -- so an RLS refusal asserted through `prisma` or `rawPrisma` is
asserting nothing at all, and passes with every policy dropped. The product was never in doubt:
`ci.yml`'s *Verify privileges* step has always checked the runtime role, and it stays exactly as it
is. What was in doubt was the TESTS' proof of it.

## THE UNIT IS THE FILE, AND THAT IS A CORRECTION MADE BY MEASUREMENT

The first version of this gate asked, per `expect()`, whether its subject came from the suite's own
client. Run against the tree it named nine assertions in `tenant-isolation.e2e-spec.ts`, and **every
one was correct code**. Asserting *office A's activity never wrote an audit row against office B*
requires a client that can SEE office B's rows; through a filtered connection that query returns
empty whatever the application did, and the test would pass against the very defect it exists to
catch. **For an ORACLE the bypassing client is the point, and for a REFUSAL it is the flaw** -- and
the difference is in what the assertion is about, which no per-`expect` rule can read.

So the unit is the file and the question is the claim: *does this spec tell its reader that RLS
refuses something?* If it does, it must open a connection on `APP_DATABASE_URL`. If it does not, it
is declared with what it actually proves -- which is a more useful artefact than a pass, because
five of the six specs measured on 2026-11-11 claimed RLS and proved the application layer.

## AND THE SECOND HALF, WHICH THE PLANTS ACTUALLY FOUND

Opening that connection is necessary and not sufficient. Four specs did it before this gate existed
and only one asserted the connection is not exempt.

`tenant-isolation.e2e-spec.ts` asserts, thoroughly, that the ROLE NAMED `ibms_app` holds no
bypassing attribute, no bypassing MEMBERSHIP, and owns no tables. That is the right check, and it is
a DIFFERENT claim from *the connection my assertions travel through is that role*: point
`APP_DATABASE_URL` at the owner and every one of those assertions still passes while every refusal
below it goes hollow. So what this gate requires is an assertion on `current_user` OF THE
CONNECTION -- rule 12, the presence of what the proof needs rather than the absence of what it
fears.

## WHAT IT CHECKS, BOTH DIRECTIONS

  1. A spec that CLAIMS RLS refuses, blocks, filters or hides something opens a connection on
     `APP_DATABASE_URL` -- or is DECLARED with what it proves instead.
  2. A spec that opens that connection asserts `rolsuper` and `rolbypassrls` are false for
     `current_user`.

A declared exemption that no longer applies FAILS, demanding the entry be deleted -- otherwise the
list rots into a permanent amnesty and the next hollow proof hides behind a stale entry. That is
`unguarded-routes.py`'s reasoning and `legal-numbers.py`'s `DECLARED_FIGURES` one level down.

## THE THING THIS GATE CANNOT ASK FOR, recorded so nobody adds it by reflex

**An HTTP assertion cannot prove RLS, and no amount of rewriting makes it able to.**
`tenantScopeExtension` adds `organizationId` to the query before it reaches the database, so the
database never gets the chance to refuse. MEASURED: replacing `OrganizationEmailIntegration`'s
policy with `USING (true)`, so Postgres refuses nothing at all, leaves
`provider-self-administration.e2e-spec.ts` at 10/10. Layer 2 is observable only by going around
layer 1, which is what `asAppRole` is for. So a spec whose refusals are HTTP refusals is not
defective -- its PROSE is, if the prose says RLS.

Usage:

    python scripts/measurements/rls-proof-shape.py            # the measurement
    python scripts/measurements/rls-proof-shape.py --check     # the gate (exit 1 on a finding)
    python scripts/measurements/rls-proof-shape.py --self-test # the gate's own tests
"""

import re
import sys
from pathlib import Path

TEST_DIR = Path("apps/api/test")

# ---------------------------------------------------------------------------
# The vocabulary, in two halves that must BOTH appear in one sentence.
#
# The mechanism half is deliberately narrow: "isolation" and "tenant" are excluded, because
# `tenant-isolation.e2e-spec.ts` says both on nearly every line while doing the right thing, and a
# vocabulary that matches the GOAL rather than the MECHANISM reports the specs that are correct.
# `current_org_id` is IN: a spec driving that GUC is talking about RLS whether or not it spells the
# acronym, which is how the tenth file was found when a word-only unit read nine.
#
# The refusal half is what separates a CLAIM from a mention. "real RLS context, no login" names the
# mechanism and claims nothing; "RLS filters it to the caller's own office" is a claim.
# ---------------------------------------------------------------------------
MECHANISM = (
    r"row[-\s]level\s+security|\bRLS\b|current_org_id|pg_policies|FORCE\s+ROW\s+LEVEL"
    # THE POLICY NAMES THEMSELVES, measured on db-test rather than guessed: every policy in the
    # `public` schema is named `tenant_isolation`, `<Model>_tenant_isolation`, or one of
    # `LegalValue`'s two provider-row policies. A sentence that names one and says it refuses IS an
    # RLS claim, even when it never spells the acronym.
    #
    # The gate's own self-test is what found this gap: a fixture reading "the tenant_isolation
    # policy refuses a cross-office read" went undetected, and that is exactly the sentence a real
    # spec writes. `tenant_isolation` is matched as a SUBSTRING so the 16 per-model prefixed names
    # are covered without listing them -- a list of model names would go stale on the next table.
    r"|tenant_isolation|provider_rows_are_readable|provider_rows_writable_by_owner"
)
REFUSAL = (
    r"refus\w*|reject\w*|block\w*|filter\w*|deni\w*|denies|hidden|hides|invisible"
    r"|cannot|can't|never|no reach|scoped by|constrain\w*|stops?\b|prevent\w*"
)

# One sentence, either order, because a claim is written both ways: "RLS filters it" and "it is
# filtered, by RLS". A docblock wraps one sentence over several lines, so a line-at-a-time reader
# would miss nearly every one -- the unit is the sentence and the split is on terminators.
#
# A COLON IS NOT A TERMINATOR HERE, and that is a correction the gate made to itself. With `:` in
# this set, `provider-self-administration`'s own claim -- "It is a property of
# `tenantScopeExtension` plus RLS: ... so every query the provider makes is filtered before it
# reaches the database" -- split into a half naming the mechanism and a half naming the refusal,
# and the file read as making no claim at all. A colon INTRODUCES the claim it belongs to.
SENTENCE_SPLIT = re.compile(r"(?<=[.;!?])\s+|\n\s*\n|\n\s*\*\s*\n")
HAS_MECHANISM = re.compile(MECHANISM, re.IGNORECASE)
HAS_REFUSAL = re.compile(REFUSAL, re.IGNORECASE)

APP_URL = re.compile(r"\bAPP_DATABASE_URL\b")
NOT_EXEMPT = re.compile(r"current_user", re.IGNORECASE)
BYPASS_ATTRS = re.compile(r"rolbypassrls", re.IGNORECASE)

# ---------------------------------------------------------------------------
# DECLARED: a spec whose text claims RLS refuses something, and which does NOT open the app role's
# connection -- because what it actually proves is something else. Each entry says WHAT, so the
# declaration is the answer to "what does this spec prove?" rather than an amnesty.
#
# Every entry is ASSERTED in the other direction: if the file stops making an RLS claim, or starts
# opening that connection, its entry must be deleted.
# ---------------------------------------------------------------------------
DECLARED_PROVES_SOMETHING_ELSE = {
    "provider-self-administration": (
        "PROVES `tenantScopeExtension`, NOT RLS, and its own header now says so. Its refusals are "
        "asserted over real HTTP -- which is right, and which structurally cannot reach layer 2, "
        "because the extension filters before the query leaves the application. MEASURED "
        "2026-11-11: with the policy replaced by `USING (true)` so the database refuses nothing, "
        "all 10 tests still pass. Its `rawPrisma` use is setup and ground-truth oracle."
    ),
    "company-record-shape": (
        "PROVES the registry record's SHAPE through the real service inside `orgContext.runAs`, and "
        "asserts no refusal at all. Its header said `real RLS context`, which was false -- the "
        "connection underneath is the suite's own, a superuser with BYPASSRLS on db-test -- and is "
        "corrected to say `real TENANCY context`. "
        "AND THIS ENTRY WAS EARNED BY THAT CORRECTION, which is worth more than the entry: the "
        "file was declared, reported STALE because it claimed nothing, undeclared -- and then the "
        "sentence written to explain the fix (`it asserts a SHAPE and no refusal ... where RLS is "
        "proven`) put both halves of the vocabulary in one sentence and read as a claim. That is "
        "this repository's comment-quotes-the-pattern blindness, committed inside the sentence "
        "correcting it. Rewording to dodge the words would satisfy the gate by making the "
        "documentation worse, which is batch 6b's recorded lesson, so it is declared instead -- the "
        "answer `legal-numbers.py` reached with `NOT_A_LEGAL_NUMBER`."
    ),
    # `office-administrator` is DELIBERATELY ABSENT, and the gate is what settled it: it was
    # declared here first and reported STALE, because "organization-scoped with an RLS policy on
    # top" claims nothing about what refuses. The sentence was nevertheless MISLEADING -- it
    # credited `provider-self-administration.e2e-spec.ts` with proving RLS in both directions -- and
    # is corrected on 2026-11-11 to name the layer that spec reaches. A declaration would have been
    # an entry with nothing to point at.
    "picker-search-gates": (
        "PROVES a permission gate lets an executive find an employee, by asserting a row COMES "
        "BACK -- a presence assertion, not a refusal. Its RLS sentence described the search's "
        "office scoping and is corrected to name the extension, which is what scopes it."
    ),
    "provider-office-state": (
        "PROVES the provider dashboard crosses offices, which is the OPPOSITE of a refusal, and the "
        "`security_invoker` setting that makes it do so. Its own-client reads are a catalogue "
        "enumeration (`pg_class`, where RLS does not apply) and a count used as the oracle the "
        "dashboard's figure is compared against. Its one refusal is a PARTIAL UNIQUE index, "
        "deliberately asserted through the harshest caller there is."
    ),
    "company-administrator-invitation": (
        "PROVES the invitation route's refusals over HTTP. Its `current_org_id` sentence explains "
        "why a `rawPrisma` insert must spell `organizationId` out -- the column's "
        "`dbgenerated()` default reads that GUC and the owner client sets none. That is a NOT NULL "
        "violation being explained, not an RLS refusal being claimed."
    ),
}

# Non-vacuity floors. A gate that silently scans nothing prints a clean pass.
MIN_SPECS = 100
MIN_APP_ROLE_SPECS = 4
MIN_CLAIMS = 5


def mask(src: str):
    """Return (code, comments): two strings, each the same length as `src`.

    `code` has every comment byte blanked; `comments` has every code byte blanked. Equal length is
    what lets a position found in one be reported against the other.

    A TOKENISER rather than a regex, because `//` inside a string literal is the shape that
    destroyed a measurement on 2026-11-07: `(?m)//.*$` truncated real code at every
    `"http://localhost:4000/..."` in `rfq.spec.ts`, and the figure moved by four.
    """
    code = list(src)
    comments = [" "] * len(src)
    i, n = 0, len(src)
    state = None  # None | "line" | "block" | "'" | '"' | "`"
    while i < n:
        ch = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if state is None:
            if ch == "/" and nxt == "/":
                state = "line"
                code[i] = code[i + 1] = " "
                i += 2
                continue
            if ch == "/" and nxt == "*":
                state = "block"
                code[i] = code[i + 1] = " "
                i += 2
                continue
            if ch in "'\"`":
                state = ch
            i += 1
            continue
        if state == "line":
            if ch == "\n":
                state = None
                i += 1
                continue
            comments[i] = ch
            code[i] = " "
            i += 1
            continue
        if state == "block":
            if ch == "*" and nxt == "/":
                code[i] = code[i + 1] = " "
                state = None
                i += 2
                continue
            comments[i] = ch
            code[i] = " " if ch != "\n" else "\n"
            i += 1
            continue
        # inside a string literal: left in `code`, since a test title IS a string
        if ch == "\\":
            i += 2
            continue
        if ch == state:
            state = None
        i += 1
    return "".join(code), "".join(comments)


def rls_claims(src: str):
    """Sentences in this file that claim RLS refuses something. Comments AND code.

    Code is included deliberately: a claim can live in an assertion's failure MESSAGE, which is
    prose a reader meets at 3am, and those are string literals rather than comments.
    """
    code, comments = mask(src)
    found = []
    for blob in (comments, code):
        for sentence in SENTENCE_SPLIT.split(blob):
            s = sentence.strip()
            if not s:
                continue
            if HAS_MECHANISM.search(s) and HAS_REFUSAL.search(s):
                flat = re.sub(r"\s+", " ", s.replace("*", " ")).strip()
                found.append(flat[:160])
    return found


def collect(root: Path):
    specs = sorted(root.glob("*.e2e-spec.ts")) if root.exists() else []
    claiming = {}       # path -> [sentences]
    app_role = []       # paths opening the app role's connection
    missing_exempt = [] # of those, the ones not proving non-exemption

    for p in specs:
        src = p.read_text(encoding="utf-8", errors="replace")
        claims = rls_claims(src)
        if claims:
            claiming[p] = claims
        code, _ = mask(src)
        if APP_URL.search(code):
            app_role.append(p)
            if not (NOT_EXEMPT.search(code) and BYPASS_ATTRS.search(code)):
                missing_exempt.append(p)

    return specs, claiming, app_role, missing_exempt


def stem_of(p: Path) -> str:
    return p.name.replace(".e2e-spec.ts", "")


def run_gate(root: Path = TEST_DIR, quiet: bool = False) -> int:
    specs, claiming, app_role, missing_exempt = collect(root)
    app_role_stems = {stem_of(p) for p in app_role}
    errors = []
    out = ["", "  RLS proof shape", ""]
    out.append(f"  e2e spec files scanned                        {len(specs):>4}")
    out.append(f"  specs CLAIMING RLS refuses something          {len(claiming):>4}")
    out.append(f"  specs opening the app role's connection       {len(app_role):>4}")
    out.append(f"  of those, NOT proving non-exemption           {len(missing_exempt):>4}")
    out.append(f"  claims declared as proving something else     {len(DECLARED_PROVES_SOMETHING_ELSE):>4}")
    out.append("")

    if len(specs) < MIN_SPECS:
        errors.append(
            f"only {len(specs)} e2e spec file(s) were scanned, against a floor of {MIN_SPECS}. "
            f"This gate found nothing because it READ almost nothing -- check the path `{root}` "
            f"rather than believing the clean result."
        )
    if len(app_role) < MIN_APP_ROLE_SPECS:
        errors.append(
            f"only {len(app_role)} spec(s) open a connection on APP_DATABASE_URL, against a floor "
            f"of {MIN_APP_ROLE_SPECS}. Either the helper was renamed or the proofs were deleted, "
            f"and an empty set makes check 2 vacuous."
        )
    if len(claiming) < MIN_CLAIMS:
        errors.append(
            f"only {len(claiming)} spec(s) read as claiming RLS refuses something, against a floor "
            f"of {MIN_CLAIMS}. The vocabulary stopped matching -- fix it rather than enjoying the "
            f"quiet, because an empty claim set makes check 1 vacuous."
        )

    # --- check 1, both directions
    for p in sorted(claiming):
        stem = stem_of(p)
        if stem in app_role_stems:
            continue
        if stem in DECLARED_PROVES_SOMETHING_ELSE:
            if not quiet:
                out.append(f"  declared  {p.name}")
                out.append(f"            {DECLARED_PROVES_SOMETHING_ELSE[stem][:96]}...")
            continue
        errors.append(
            f"{p} tells its reader that row-level security refuses something, and never opens a "
            f"connection row-level security applies to.\n"
            f"        claim: {claiming[p][0]}\n"
            f"        On db-test `ibms` is a SUPERUSER with BYPASSRLS, so a refusal asserted "
            f"through `prisma`/`rawPrisma` passes with every policy dropped; and an HTTP refusal "
            f"proves `tenantScopeExtension`, because the extension filters before the database is "
            f"asked. Either prove it on `APP_DATABASE_URL` (`asAppRole`, the shape in "
            f"`tenant-isolation.e2e-spec.ts`) and assert FIRST that `current_user` is not exempt, "
            f"or declare the spec in DECLARED_PROVES_SOMETHING_ELSE saying what it does prove and "
            f"correct the sentence that says RLS."
        )

    claiming_stems = {stem_of(p) for p in claiming}
    for stem, reason in DECLARED_PROVES_SOMETHING_ELSE.items():
        if stem not in claiming_stems:
            errors.append(
                f"DECLARED_PROVES_SOMETHING_ELSE names `{stem}`, which no longer claims RLS "
                f"refuses anything -- delete the entry. A declaration kept past its subject is a "
                f"permanent amnesty, and the next hollow proof hides behind it.\n"
                f"        declared: {reason[:110]}..."
            )
        elif stem in app_role_stems:
            errors.append(
                f"DECLARED_PROVES_SOMETHING_ELSE names `{stem}`, which now opens the app role's "
                f"connection -- so it can prove RLS, and the declaration that it proves something "
                f"else is stale. Delete the entry."
            )

    # --- check 2
    for p in missing_exempt:
        errors.append(
            f"{p} opens a connection on APP_DATABASE_URL and never asserts that connection is not "
            f"exempt. Point that variable at the table OWNER and every refusal below it goes "
            f"hollow while the spec stays green. Assert `rolsuper` and `rolbypassrls` are false "
            f"for `current_user` -- of the CONNECTION, not of a role looked up by name, which is a "
            f"different claim."
        )

    if errors:
        out.append("")
        for e in errors:
            out.append(f"  FAIL  {e}")
        out.append("")
        if not quiet:
            print("\n".join(out))
        return 1

    out.append("  ok     every spec that claims row-level security refuses something proves it on a")
    out.append("         connection RLS applies to, and proves that connection is not exempt")
    out.append("")
    if not quiet:
        print("\n".join(out))
    return 0


# ---------------------------------------------------------------------------
# Self-test. Runs BEFORE the gate in `check:guards`, so a broken gate says so rather than printing
# a plausible pass.
# ---------------------------------------------------------------------------
PROPER = """
const APP_DB_URL = process.env.APP_DATABASE_URL ?? 'postgresql://x';
it('the connection making these refusals is not exempt', async () => {
  const who = await asAppRole(null, 'SELECT current_user AS u, rolbypassrls AS b');
  expect(who[0].b, 'the connection has BYPASSRLS').toBe(false);
});
/* RLS refuses the cross-office read. */
"""


def self_test() -> int:
    import contextlib
    import io as _io
    import tempfile

    global DECLARED_PROVES_SOMETHING_ELSE, MIN_SPECS, MIN_APP_ROLE_SPECS, MIN_CLAIMS

    cases = []

    def case(name, files, expect_fail, must_say=None, declared=None, floors=False):
        cases.append((name, files, expect_fail, must_say, declared, floors))

    # 1 -- the defect: a claim with no app-role connection
    case(
        "a spec claiming RLS refuses, with no app-role connection",
        {
            "bad": """
/* The tenant_isolation policy refuses a cross-office read. */
it('refuses it', async () => {
  expect(await prisma.legalValue.count()).toBe(0);
});
""",
            "proper": PROPER,
        },
        True,
        "never opens a connection",
    )

    # 2 -- the same claim, proved properly
    case(
        "the same claim, on a connection opened with APP_DATABASE_URL",
        {
            "good": """
const APP_DB_URL = process.env.APP_DATABASE_URL ?? 'postgresql://x';
/* RLS refuses a cross-office read. */
it('not exempt', async () => {
  const who = await asAppRole(null, 'SELECT current_user AS u, rolbypassrls AS b');
  expect(who[0].b).toBe(false);
});
""",
            "proper": PROPER,
        },
        False,
    )

    # 3 -- a MENTION is not a CLAIM: the refusal half must be there too
    case(
        "an RLS mention that claims nothing",
        {
            "prose": """
/* Real service, real Prisma, real database, real RLS context, no login. */
it('returns the shape', async () => { expect(1).toBe(1); });
""",
            "proper": PROPER,
        },
        False,
    )

    # 4 -- a refusal sentence with no mechanism is somebody else's business
    case(
        "a refusal sentence that never names RLS",
        {
            "other": """
/* The unique index refuses a second provider organization. */
it('refuses it', async () => { expect(1).toBe(1); });
""",
            "proper": PROPER,
        },
        False,
    )

    # 5 -- check 2: the connection is opened and never proved
    case(
        "a spec opening APP_DATABASE_URL without proving non-exemption",
        {
            "weak": """
const APP_DB_URL = process.env.APP_DATABASE_URL ?? 'postgresql://x';
/* RLS refuses the write. */
it('refuses the write', async () => {
  await expect(asAppRole('INSERT INTO t VALUES (1)')).rejects.toThrow();
});
""",
            "proper": PROPER,
        },
        True,
        "not exempt",
    )

    # 6 -- a role looked up BY NAME is not the connection, which is the whole second half
    case(
        "non-exemption asserted for a role by NAME rather than for the connection",
        {
            "byname": """
const APP_DB_URL = process.env.APP_DATABASE_URL ?? 'postgresql://x';
/* RLS refuses the cross-office read. */
it('the role holds no bypass', async () => {
  const r = await ownerQuery("SELECT rolbypassrls FROM pg_roles WHERE rolname = 'ibms_app'");
  expect(r[0].rolbypassrls).toBe(false);
});
""",
            "proper": PROPER,
        },
        True,
        "not of a role looked up by name",
    )

    # 7 -- the comment-blindness case: a claim that exists only in dead code stays a claim,
    #      but a `//` inside a URL must not swallow the rest of the file
    case(
        "a URL in a string does not blind the scanner to a later claim",
        {
            "url": """
const base = 'http://localhost:4000/legal-values';
/* RLS refuses the cross-office read. */
it('refuses it', async () => { expect(1).toBe(1); });
""",
            "proper": PROPER,
        },
        True,
        "never opens a connection",
    )

    # 8 -- a claim in an assertion MESSAGE, not a comment
    case(
        "a claim that lives in a failure message rather than a comment",
        {
            "msg": """
it('refuses it', async () => {
  expect(rows, 'row-level security did not filter the other office out').toHaveLength(0);
});
""",
            "proper": PROPER,
        },
        True,
        "never opens a connection",
    )

    # 9 -- declared list, direction two: the subject stopped claiming
    case(
        "a DECLARED spec that no longer claims RLS",
        {"quiet": "it('x', () => {});\n", "proper": PROPER},
        True,
        "permanent amnesty",
        declared={"quiet": "declared for a reason that has gone away"},
    )

    # 10 -- declared list, direction three: the subject can now prove it
    case(
        "a DECLARED spec that has since opened the app-role connection",
        {
            "grown": """
const APP_DB_URL = process.env.APP_DATABASE_URL ?? 'postgresql://x';
/* RLS refuses it. */
it('not exempt', async () => {
  const who = await asAppRole(null, 'SELECT current_user');
  expect(who[0].rolbypassrls).toBe(false);
});
""",
            "proper": PROPER,
        },
        True,
        "the declaration that it proves something else is stale",
        declared={"grown": "declared as proving the extension"},
    )

    # 11 -- the floors
    case("an empty tree trips the spec floor", {}, True, "floor", floors=True)

    passed = failed = 0
    for name, files, expect_fail, must_say, declared, floors in cases:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            for stem, body in files.items():
                (root / f"{stem}.e2e-spec.ts").write_text(body, encoding="utf-8")

            keep = (DECLARED_PROVES_SOMETHING_ELSE, MIN_SPECS, MIN_APP_ROLE_SPECS, MIN_CLAIMS)
            DECLARED_PROVES_SOMETHING_ELSE = declared or {}
            if not floors:
                MIN_SPECS, MIN_APP_ROLE_SPECS, MIN_CLAIMS = 0, 0, 0
            buf = _io.StringIO()
            try:
                with contextlib.redirect_stdout(buf):
                    rc = run_gate(root)
            finally:
                (
                    DECLARED_PROVES_SOMETHING_ELSE,
                    MIN_SPECS,
                    MIN_APP_ROLE_SPECS,
                    MIN_CLAIMS,
                ) = keep

            text = buf.getvalue()
            said = (must_say or "") in text
            if (rc != 0) == expect_fail and (must_say is None or said):
                print(f"  ok    {name:<72} {'named it' if expect_fail else 'left it alone'}")
                passed += 1
            else:
                print(f"  FAIL  {name}")
                print(f"        expected {'a failure' if expect_fail else 'a pass'}, got rc={rc}")
                if must_say and not said:
                    print(f"        message did not contain {must_say!r}")
                    print("\n".join("        " + l for l in text.splitlines()[:20]))
                failed += 1

    print("")
    print(f"  self-test: {passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    sys.exit(run_gate())
