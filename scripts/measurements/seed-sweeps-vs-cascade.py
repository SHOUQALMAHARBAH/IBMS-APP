"""EVERY PER-ORGANIZATION SEED SWEEP MUST BE CLEARED BY THE FIXTURE CASCADE HELPER.

## THE RULE, AND WHY A COMMENT WAS NOT ENOUGH

The seed contains functions that walk `organization.findMany()` and write a row into EVERY
organization. A disposable fixture organization created by an e2e spec is one of those rows, so a
`db:test:seed` run after a leak attaches rows to it — and every one of those FKs is RESTRICT, which
makes the fixture permanently undeletable and takes down every later spec in the run at
`createTestApp` with a fault that looks like its own.

This has now happened TWICE, and the second time it happened to the fix for the first:

  * 2026-10-20, `9da34f1` — decision 25's `PasswordResetToken` broke two fixture teardowns. Fixed,
    and the rule was written as a COMMENT in `deleteOrganizationCascade`.
  * That same comment then listed the sweeps as "branches, departments and holidays" — which is TWO
    sweeps counted as three models. `ensureBrokerLicenseTerms` is a third sweep, writing
    `BrokerLicense` plus its certificate `Document`, and the cascade cleared neither. It did not
    fire only because eleven of the twelve leaks were `INSURANCE_COMPANY` and that sweep filters on
    `BROKERAGE_OFFICE`. The TYPE spared us, not the code.

A comment did not enforce it. This does.

## WHAT IT IS: A DERIVATION, NOT A LIST

It reads `seed.ts`, finds every top-level `async function` whose body calls
`organization.findMany`, extracts the models that function WRITES, and requires each to be cleared
by `deleteOrganizationCascade` in `apps/api/test/tenant-prisma.ts` — or to carry a declared reason.

So a fourth sweep, or a new write inside an existing one, fails here without anybody remembering
this file exists. A hand-kept list of three sweeps would have passed the very commit that motivated
it.

## ONE LEVEL OF HELPER, AND THE FLOOR IS WHAT FOUND THAT

`ensureDefaultOrgUnitsForEveryOrganization` writes nothing in its own body — it calls
`ensureDefaultOrgUnits(prisma, org.id)`, which is where `branch.create` and `department.create`
live. The non-vacuity floor below refused to report that sweep as "no writes" and pass, which is
how the helper hop was discovered rather than assumed. It follows ONE level deliberately: a sweep
whose writes are two helpers deep hits the floor and refuses, which is the right answer — that
needs reading, not a deeper regex.

## THE DENOMINATOR IS DERIVED, NOT PICKED

The floors below are MINIMUMS, and a minimum catches a parser that stopped working — it does NOT
catch a FOURTH sweep written in a shape the parser cannot read. It would find three, three would
clear the floor, and it would pass. That is the same story a third time, one shape along.

So EVERY OCCURRENCE of the sweep shape in `seed.ts` is ATTRIBUTED to the top-level
`async function` whose body contains it, and an occurrence that cannot be attributed FAILS by line
number. A sweep inside an arrow function, a class method, a nested closure or a second file is
therefore a refusal rather than a silent pass.

The attribution is TOTAL rather than partial, and that rests on a measurement: `prisma/seed.ts` is
the only seed entry point — `db:seed` and `db:test:seed` both run `prisma db seed`, and
`packages/db/package.json` resolves that to `tsx prisma/seed.ts`. If a second seed file is ever
added, `SEED` here names one file and the attribution silently narrows, so that is the one thing to
re-measure if this file is ever read in anger.

**If a shape turns up that cannot be attributed without a deeper parser, this FAILS and names it
rather than widening the regex quietly.** A refusal that says "there is a sweep here I cannot read"
is worth more than a parser nobody trusts.

## NON-VACUITY

Three floors, on top of the attribution:

  * the sweep count must be at least the three that exist today;
  * each sweep must yield at least one written model;
  * the cascade helper must be found and must clear at least what it clears today.

Written with the editor, never a heredoc — this host eats backslashes in one, and the first attempt
at this very edit was mangled that way. Output is ASCII-only: the console is cp1252.
"""

import io
import os
import re
import sys

# Spelled this way on purpose: a literal backslash-n inside an edit on this host is eaten by the
# shell, which has now cost four rounds in one session. `chr(10)` cannot be mangled.
NEWLINE = chr(10)


def strip_comments(src):
    """Remove block and line comments before matching.

    THE GATE READ PROSE AS CODE on its first run: `cleared` came back holding `user`, which
    `deleteOrganizationCascade` does not delete — the match was inside the NEXT function's doc
    comment, swallowed because a body boundary of `export async function` lands BELOW the comment
    that documents it.

    The second half is why this is not cosmetic: a model named only in a comment would read as
    "cleared" and mask a real gap. That is this repository's own rule — a comment is not a control —
    reappearing inside the gate written to enforce it.
    """
    def blank(match):
        # Same length, newlines kept: every character position in the result still maps to the
        # SAME position in the real file, so a reported line number is one a reader can open.
        # The first version DELETED the comment text, which shifted every line after it — the
        # check then named `seed.ts:944` for a sweep that was at 1325. A line number nobody can
        # re-derive cannot carry a rule, which is the standard this repository holds its own
        # output to, and this check is not exempt from it.
        return "".join(c if c == NEWLINE else " " for c in match.group(0))

    src = re.sub(r"/\*.*?\*/", blank, src, flags=re.S)
    src = re.sub(r"^\s*//.*$", blank, src, flags=re.M)
    return src

SEED = os.path.join("packages", "db", "prisma", "seed.ts")
CASCADE = os.path.join("apps", "api", "test", "tenant-prisma.ts")

WRITE = r"\b(?:tx|prisma|client)\.(\w+)\.(?:create|createMany|upsert)\b"

# The sweep shape itself, used BOTH to find sweeps and to count occurrences for attribution. One
# definition, so the thing being attributed and the thing being searched for cannot drift apart.
SWEEP = r"\borganization\.findMany\b"

# Where a sweep's writes live when they are one call away. Measured, not guessed.
HELPER_SOURCES = [
    os.path.join("packages", "db", "src", "default-org-units.ts"),
]

# A model a sweep writes that the cascade deliberately does not clear, with the reason. EMPTY today.
# A row here needs the same scrutiny as any other declared-exemption list in this repo: the question
# is not "is clearing it inconvenient" but "is the row genuinely not the fixture's".
DECLARED_NOT_CLEARED = {}

# Floors. Raise them when a sweep or a cleared model is added; never lower one to make a run pass.
MIN_SWEEPS = 3
MIN_CLEARED = 4


def blank_strings(src):
    """Replace every string literal with same-length spaces, so braces inside one cannot move a
    body boundary and every character position stays valid for the line arithmetic below."""
    out = list(src)
    i = 0
    n = len(src)
    while i < n:
        ch = src[i]
        if ch in "'\"`":
            quote = ch
            j = i + 1
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == quote:
                    break
                j += 1
            for k in range(i, min(j + 1, n)):
                if out[k] != "\n":
                    out[k] = " "
            i = j + 1
            continue
        i += 1
    return "".join(out)


def body_brace(blanked, after):
    """Index of the `{` that opens a function BODY, skipping braces inside the signature.

    MEASURED, by the floor refusing: `ensureDefaultOrgUnits` is declared
    `): Promise<{ branchCreated: boolean; departmentCreated: boolean }> {`, so taking the first
    `{` after the name landed inside the RETURN TYPE and brace-matched a tiny span with no writes
    in it. The sweep then read as "no writes" and the non-vacuity floor refused — which is the
    third time that floor has caught a parser defect rather than a code defect.

    So: walk the parameter list by paren depth, then take the first `{` seen at ANGLE depth zero,
    which is what separates a return-type literal from the body.
    """
    i = blanked.find("(", after)
    if i < 0:
        return -1
    depth = 0
    while i < len(blanked):
        if blanked[i] == "(":
            depth += 1
        elif blanked[i] == ")":
            depth -= 1
            if depth == 0:
                i += 1
                break
        i += 1
    angle = 0
    while i < len(blanked):
        c = blanked[i]
        if c == "<":
            angle += 1
        elif c == ">":
            if angle > 0:
                angle -= 1
        elif c == "{" and angle == 0:
            return i
        elif c == ";" and angle == 0:
            # An overload or a declaration with no body at all.
            #
            # `angle == 0` is load-bearing and was missing: the return type
            # `Promise<{ branchCreated: boolean; departmentCreated: boolean }>` contains a
            # SEMICOLON as its member separator, so the guard fired inside the type and the helper
            # file parsed to ZERO functions — which made the sweep read as "no writes" and the
            # floor refuse. The floor caught it; the guard was wrong.
            return -1
        i += 1
    return -1


def bodies(src):
    """(name, start, end) for every top-level `async function`, BRACE-MATCHED.

    Not "from this declaration to the next one". That shape absorbed a planted
    `const … = async () => {}` sweep into the preceding function and reported it as attributed —
    the very defect this check exists to refuse, reproduced inside the check. The plant is
    `a-fourth-sweep-in-a-shape-the-parser-cannot-read`.
    """
    blanked = blank_strings(src)
    out = []
    for m in re.finditer(r"^(?:export )?async function (\w+)", src, re.M):
        open_brace = body_brace(blanked, m.end())
        if open_brace < 0:
            continue
        depth = 0
        end = -1
        for i in range(open_brace, len(blanked)):
            if blanked[i] == "{":
                depth += 1
            elif blanked[i] == "}":
                depth -= 1
                if depth == 0:
                    end = i
                    break
        if end < 0:
            continue
        out.append((m.group(1), m.start(), end + 1))
    return out


def body_text(src, span):
    _name, start, end = span
    return src[start:end]


def attribute_sweeps(src):
    """[(line, function name or None)] for every occurrence of the sweep shape.

    `None` means the occurrence sits outside every top-level `async function` body — an arrow
    function, a class method, a nested closure — and is therefore a shape this parser cannot
    attribute. That is a refusal, not a pass.
    """
    spans = bodies(src)
    out = []
    for m in re.finditer(SWEEP, src):
        owner = None
        for name, start, end in spans:
            if start <= m.start() < end:
                owner = name
                break
        out.append((src.count("\n", 0, m.start()) + 1, owner))
    return out


def seed_sweeps(src):
    """{function name: models it writes} for every function that walks organization.findMany."""
    helpers = {}
    for path in HELPER_SOURCES:
        if not os.path.exists(path):
            continue
        hsrc = strip_comments(io.open(path, encoding="utf-8").read())
        for span in bodies(hsrc):
            helpers[span[0]] = set(
                m.group(1) for m in re.finditer(WRITE, body_text(hsrc, span))
            )

    out = {}
    for span in bodies(src):
        body = body_text(src, span)
        if not re.search(SWEEP, body):
            continue
        models = set(m.group(1) for m in re.finditer(WRITE, body))
        for helper, helper_models in helpers.items():
            if re.search(r"\b" + helper + r"\s*\(", body):
                models |= helper_models
        out[span[0]] = models
    return out


def cascade_clears(src):
    """The models `deleteOrganizationCascade` deletes."""
    start = src.find("export async function deleteOrganizationCascade")
    if start < 0:
        return set()
    end = src.find("\nexport ", start + 1)
    body = src[start : end if end > 0 else len(src)]
    return set(m.group(1) for m in re.finditer(r"\brawPrisma\.(\w+)\.deleteMany\b", body))


def main():
    seed_src = strip_comments(io.open(SEED, encoding="utf-8").read())
    cascade_src = strip_comments(io.open(CASCADE, encoding="utf-8").read())

    occurrences = attribute_sweeps(seed_src)
    sweeps = seed_sweeps(seed_src)
    cleared = cascade_clears(cascade_src)

    print("sweep-shape occurrences in seed.ts      %5d" % len(occurrences))
    print("attributed to a named sweep             %5d" % sum(1 for _l, o in occurrences if o))
    print("per-organization seed sweeps found      %5d" % len(sweeps))
    print("models the fixture cascade clears       %5d   (%s)" % (len(cleared), ", ".join(sorted(cleared))))
    print()

    # THE DERIVED DENOMINATOR, checked before the floors: an occurrence nobody can attribute is
    # the fourth-sweep-in-an-unreadable-shape case, and it must refuse rather than pass.
    unattributed = [line for line, owner in occurrences if owner is None]
    if unattributed:
        print(
            "seed-sweeps: FAILED - %d occurrence(s) of the organization sweep in %s sit outside "
            "every top-level `async function`, so this check cannot attribute them to a named "
            "sweep:" % (len(unattributed), SEED)
        )
        for line in unattributed:
            print("    %s:%d" % (SEED, line))
        print()
        print("That is the shape a FOURTH sweep would take if it were written as an arrow function,")
        print("a class method or a nested closure - the parser would find three, three would clear")
        print("the floor, and this would pass. So it refuses instead. Either move the sweep into a")
        print("top-level `async function` like the other three, or extend this check DELIBERATELY -")
        print("never by widening the regex until the red goes away.")
        return 1

    if len(occurrences) < MIN_SWEEPS:
        print(
            "seed-sweeps: FAILED - found only %d occurrence(s) of the sweep shape in %s, expected at "
            "least %d. The shape pattern no longer matches what the seed writes."
            % (len(occurrences), SEED, MIN_SWEEPS)
        )
        return 1

    if len(sweeps) < MIN_SWEEPS:
        print(
            "seed-sweeps: FAILED - found only %d per-organization sweep(s), expected at least %d. "
            "A parser that stops matching reports a clean result, so this refuses rather than passes."
            % (len(sweeps), MIN_SWEEPS)
        )
        return 1
    if len(cleared) < MIN_CLEARED:
        print(
            "seed-sweeps: FAILED - the cascade helper appears to clear only %d model(s), expected at "
            "least %d. Either it was narrowed or this script can no longer read it."
            % (len(cleared), MIN_CLEARED)
        )
        return 1

    uncovered = []
    for name in sorted(sweeps):
        models = sweeps[name]
        print("  %s" % name)
        if not models:
            print()
            print(
                "seed-sweeps: FAILED - %s walks organization.findMany and no writes were found in "
                "it or one level down. Either it writes through a helper this cannot see (add it to "
                "HELPER_SOURCES) or the matcher broke; both are refusals." % name
            )
            return 1
        for model in sorted(models):
            if model in cleared:
                verdict = "cleared"
            elif model in DECLARED_NOT_CLEARED:
                verdict = "declared: " + DECLARED_NOT_CLEARED[model]
            else:
                verdict = "NOT CLEARED"
                uncovered.append((name, model))
            print("      %-28s %s" % (model, verdict))
    print()

    if "--check" not in sys.argv:
        return 0

    if uncovered:
        print(
            "seed-sweeps: FAILED - %d model(s) written into EVERY organization are not cleared by "
            "deleteOrganizationCascade:" % len(uncovered)
        )
        for name, model in uncovered:
            print("    %s writes %s" % (name, model))
        print()
        print("A disposable fixture organization is one of the rows these sweeps walk, and these FKs")
        print("are RESTRICT. One db:test:seed run after a leak then makes that fixture PERMANENTLY")
        print("undeletable, and every later spec in the run fails at createTestApp with a fault that")
        print("looks like its own. This has happened twice. Clear it in apps/api/test/tenant-prisma.ts,")
        print("or add a row to DECLARED_NOT_CLEARED with the reason the row is not the fixture's.")
        return 1

    print(
        "seed-sweeps: %d sweep occurrence(s), all attributed, and every model written into every "
        "organization is cleared by the cascade." % len(occurrences)
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
