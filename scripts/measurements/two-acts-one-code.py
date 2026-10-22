"""DECISION 98, WIDENED — every permission code that gates TWO ACTS OF DIFFERENT CONSEQUENCE.

A MEASUREMENT. It splits nothing and mints nothing.

## WHY

Decision 98 as written is about dates: *every date or deadline button is a separate permission by
its own name*. The owner has widened its LOGIC beyond dates, and the worked example is already
measured: `aml.monitor` gates FIVE routes on `transaction-monitoring.controller.ts` — logging an
alert, running the detection sweep, listing, READING and CLOSING one. So whoever may see a
suspicious-activity alert may dispose of it, and `transaction-monitoring.service.ts` already records
that the entity has no maker/checker. An administrator ticking that one box grants both.

## THE DEFINITION, IN WRITING — because otherwise this is an opinion dressed as a number

The owner's proposed definition, adopted:

    A code gates two acts of DIFFERENT CONSEQUENCE when
      (a) at least ONE act it gates is IRREVERSIBLE, or changes a record's STANDING or DISPOSAL,
      AND
      (b) at least ONE other act it gates is only a READ or a DRAFT.

`aml.monitor` qualifies on read-plus-close. **A code gating three reads does not.** A code gating
three consequential acts does not either — that is a code whose holder is trusted with all three,
which is a different question and not this one.

## HOW EACH ACT IS CLASSIFIED, AND WHY IT IS A DECLARED VOCABULARY RATHER THAN A GUESS

Classification cannot come from the HTTP verb alone: *log an alert* and *close an alert* are both
`POST`, and they are the two halves of the owner's own example. So the classifier is:

  * **READ** — `GET`. A read changes nothing.
  * **CONSEQUENTIAL** — `DELETE`, or a route whose path tail is in `CONSEQUENTIAL_TAILS` below.
    Those are the verbs this product uses for an act that ends, approves, refuses, withdraws,
    disposes of or pays out — each one either irreversible or a change of standing.
  * **DRAFT** — everything else: a `POST`/`PUT`/`PATCH` that creates or edits a record which some
    later act then decides on.

`CONSEQUENTIAL_TAILS` is declared below BY NAME so it can be argued with, which is the owner's own
instruction. Every classification this script makes is PRINTED, so a reader can disagree with a
specific row rather than with the total.

## WHAT THIS DOES NOT DECIDE

Whether a candidate SHOULD be split. Every split changes a role set, and that is the owner's
decision — which is why each candidate is reported with the roles that hold it BY NAME rather than
with a recommendation. No Arabic name is proposed either: decision 94 keeps permission naming with
the owner and her walk settles it.

## NON-VACUITY

A parser that stops matching must not be able to report "clean". Three floors, and the third is the
one that matters:

  1. the catalogue must yield more than 200 codes;
  2. the sweep must find more than 300 gated routes;
  3. **`aml.monitor` MUST come out as a candidate.** The owner measured that one by hand before this
     script existed, so it is a known-true answer this measurement has to reproduce — and if the
     route parser silently stops resolving, that code drops out and the script FAILS by name rather
     than printing a shorter list.

Usage:  python scripts/measurements/two-acts-one-code.py
"""

import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

# The route engine is REUSED, never re-written: it already resolves `...SPREAD` composite code sets
# through their constants, follows `@Controller` prefixes, and reports any set it could not resolve.
# A second copy of that parser would be a second answer to "what does this code gate".
import importlib.util

_spec = importlib.util.spec_from_file_location(
    "routes_gated_on", os.path.join(HERE, "routes-gated-on.py")
)
routes_gated_on = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(routes_gated_on)

CATALOGUE = os.path.join(
    ROOT, "packages", "db", "prisma", "seed-data", "permissions.ts"
)

# ---------------------------------------------------------------------------------------------
# THE DECLARED VOCABULARY. Argue with a row, not with the total.
#
# Each of these is a path tail this product uses for an act that is irreversible or changes a
# record's standing or disposal. Grouped by WHY, because the grouping is the argument.
CONSEQUENTIAL_TAILS = {
    # ENDS something, or decides it. Terminal by nature.
    "close": "closes a record — a disposal decision",
    "closure": "closes a record — a disposal decision",
    "approve": "approves — the checker half of a decision",
    "reject": "refuses — terminal for what was asked",
    "decide": "decides — terminal for the thing decided",
    "review": "records a review decision",
    "confirm": "confirms — the second half of a two-person act",
    "co-sign": "co-signs — the second half of a two-person act",
    "classify": "classifies — sets a record's standing",
    "escalate": "escalates — changes who owns the decision and its standing",
    # WITHDRAWS or ENDS an entity's active life.
    "deactivate": "deactivates — ends an entity's active life",
    "discard": "withdraws a record raised in error",
    "cancel": "cancels — terminal for the cover or the request",
    "cancellation": "raises a cancellation — terminal for the cover",
    "revoke": "revokes — withdraws something granted",
    "retire": "retires — ends an entity's active life",
    "terminate": "terminates",
    "deprovision": "removes access",
    "deprovisioning": "removes access",
    # MONEY LEAVES, or a figure becomes final.
    "disburse": "money leaves the office — irreversible",
    "remittance": "remits money to an insurer",
    "settle": "settles — money changes hands",
    "execute": "executes — carries the act out",
    "pay": "pays",
    # DISPOSAL of records, which is the one this product calls out as unable to be undone.
    "dispose": "disposes of records",
    "disposal": "disposes of records",
    "destroy": "destroys records",
    # REGULATORY STANDING.
    "regulatory-actions": "records a regulator decision — changes the office's standing",
    "mark-lapsed": "marks a licence lapsed — changes the office's standing",
    "rollback": "rolls a published generation back — changes what screening runs against",
    "reinstate": "reinstates",
    # A RECORD BECOMES THE OFFICIAL ONE.
    "send": "sends to the customer — cannot be unsent",
    "issue": "issues",
    "issuance": "records issuance",
    "publish": "publishes",
    "apply": "applies the change to a live record",
    # ------------------------------------------------------------------------------------------
    # ADDED AFTER THE FIRST RUN, because the measurement argued with the first vocabulary — which
    # is the owner's own instruction. All 57 DRAFT-classified routes inside candidates were read
    # one at a time; these are the ones that are plainly irreversible or plainly change a record's
    # standing and were sitting in DRAFT only because their verb was not listed.
    #
    # The delta is REPORTED rather than quietly applied, and it moves in both directions: a code
    # holding {READ, DRAFT} whose DRAFT becomes consequential now QUALIFIES, while one holding
    # {DRAFT, CONSEQUENTIAL} stops qualifying because it turns out to gate two decisions.
    "decline": "declines — terminal for what was asked, the sibling of reject",
    "report-to-authority": "reports a suspicious activity to the AMLU — irreversible, and outside this office",
    "fulfil": "fulfils — closes a statutory request",
    "partially-fulfil": "partially fulfils and closes — the request is answered either way",
    "dpo-approve": "approves — the checker half of a disposal",
    "deletion-override": "overrides a deletion lock — permits a removal the lock refused",
    "release": "releases a legal hold — permits disposal of what the hold protected",
    "revoke-access": "revokes access",
    "activate": "activates — changes an entity's active life, the mirror of deactivate",
    "reactivate": "reactivates — changes an entity's active life",
    "notify-client": "notifies the customer — cannot be un-notified, the `send` class",
    "certificate": "records the destruction certificate — the disposal itself",
}

# ----------------------------------------------------------------------------------------------
# THE JUDGEMENT CALLS, NAMED RATHER THAN BURIED — each left as DRAFT, with the reason.
#
# A reader who disagrees with one of these disagrees with a named row, which is the whole point of
# declaring the vocabulary instead of computing a number:
#
#   * `/incidents/:id/contain`, `/recover`, `/assess-impact` — recorded STEPS in an incident's
#     handling. They move its status, but the definition's test is irreversible-or-standing/disposal,
#     and a containment that was recorded wrongly is corrected by recording the truth. Not a
#     disposal.
#   * `/needs-assessments/:id/return` — sends the assessment BACK for work. It refuses nothing
#     permanently; the assessment continues.
#   * `/dsr/:id/start`, `/assign`, `/verify-identity`, `/apply-extension` — steps that move a
#     statutory request along. `/apply-extension` is the closest call, because it re-bases a legal
#     deadline; it is left as DRAFT because the request remains open and answerable, which is the
#     opposite of a disposal.
#   * `/screening/matches/:id/assign`, `/start-review`, `/notes` — the case machinery around a
#     decision, not the decision. `/review` IS consequential and is already listed.
#   * `/watchlist-sync/run`, `/screening/recurring-batch`, `/transaction-monitoring-alerts/detect`,
#     `/retention-cases/sweep` — sweeps that CREATE findings for somebody to decide on.
#   * `POST /broker-license`, `/renew`, `/renewal-requested`, `/scope` — recording the office's own
#     licence facts. They change what the system DERIVES about standing, which is a real
#     consequence, but the act is a clerical record of a regulator's document rather than a decision
#     this office takes. `license.manage` appears as a candidate anyway, on its regulatory-actions
#     route, so nothing is hidden by this call.
#
# EACH OF THESE WOULD MOVE THE COUNT IF DECIDED THE OTHER WAY. That is stated so the number is read
# as what it is: the output of a declared rule, not a fact about the codebase.

VERB_READ = "GET"


def strip_comments(src):
    return re.sub(r"/\*.*?\*/", "", src, flags=re.S)


def catalogue():
    """Every code in the seeded grid, with its module and the roles that hold it BY NAME."""
    raw = io.open(CATALOGUE, encoding="utf-8", errors="replace").read()
    # The role shorthands (`SALES`, `COMPLIANCE`, …) resolve through their own declarations, so the
    # report names the ROLE and not the local alias — an alias in a report is a name nobody can
    # grep for in the database.
    aliases = {}
    for m in re.finditer(r"^const ([A-Z_]+)\s*=\s*RoleName\.([A-Z_]+)", raw, re.M):
        aliases[m.group(1)] = m.group(2)
    for m in re.finditer(r'^const ([A-Z_]+)\s*=\s*"([A-Z_]+)"', raw, re.M):
        aliases[m.group(1)] = m.group(2)

    src = strip_comments(raw)
    out = {}
    for m in re.finditer(
        r'code:\s*"([^"]+)",\s*module:\s*"([^"]+)",.*?roles:\s*\[([^\]]*)\]',
        src,
        re.S,
    ):
        code, module, roles_blob = m.group(1), m.group(2), m.group(3)
        roles = []
        for token in re.findall(r"[A-Z_][A-Z_0-9]*", roles_blob):
            roles.append(aliases.get(token, token))
        out[code] = {"module": module, "roles": sorted(set(roles))}
    return out


def classify(route):
    """READ, DRAFT or CONSEQUENTIAL — and the reason, so the row is arguable."""
    verb, path = route.split(" ", 1)
    if verb == VERB_READ:
        return "READ", "a read changes nothing"
    if verb == "DELETE":
        return "CONSEQUENTIAL", "DELETE — removes the record"
    tail = path.rstrip("/").rsplit("/", 1)[-1].lower()
    if tail in CONSEQUENTIAL_TAILS:
        return "CONSEQUENTIAL", CONSEQUENTIAL_TAILS[tail]
    # A parameterised tail (`:id`) means the consequential word, if any, is one segment up.
    parts = [p.lower() for p in path.rstrip("/").split("/") if p]
    for p in reversed(parts):
        if p in CONSEQUENTIAL_TAILS:
            return "CONSEQUENTIAL", CONSEQUENTIAL_TAILS[p]
    return "DRAFT", "%s — creates or edits a record a later act decides on" % verb


def main():
    codes = catalogue()
    rows, unresolved = routes_gated_on.routes_for(set(codes))

    # ------------------------------------------------------------------ per-code routes
    per_code = {c: [] for c in codes}
    for r in rows:
        for c in r["codes"]:
            if c in per_code:
                per_code[c].append(r["route"])

    total_routes = sum(len(v) for v in per_code.values())

    print("=" * 100)
    print("DECISION 98 WIDENED — codes gating TWO ACTS OF DIFFERENT CONSEQUENCE")
    print("=" * 100)
    print()
    print("THE DEFINITION APPLIED (the owner's, adopted verbatim):")
    print(
        "  A code gates two acts of DIFFERENT CONSEQUENCE when at least ONE act it gates is"
    )
    print(
        "  IRREVERSIBLE or changes a record's STANDING or DISPOSAL, AND at least ONE other act it"
    )
    print("  gates is only a READ or a DRAFT.")
    print("  A code gating three reads does not qualify. Nor does one gating three decisions.")
    print()
    print("CODES EXAMINED:            %d (the whole seeded catalogue)" % len(codes))
    print("CODE-ROUTE PAIRS FOUND:    %d" % total_routes)
    print(
        "CODES GATING NO ROUTE:     %d  (read by a service or the web, or not yet enforced)"
        % sum(1 for v in per_code.values() if not v)
    )
    print()

    # ------------------------------------------------------------------ the candidates
    candidates = []
    for code, routes in sorted(per_code.items()):
        if len(routes) < 2:
            continue
        acts = [(r, *classify(r)) for r in sorted(set(routes))]
        kinds = {k for _, k, _ in acts}
        if "CONSEQUENTIAL" in kinds and ({"READ", "DRAFT"} & kinds):
            candidates.append((code, acts))

    print("-" * 100)
    print("CANDIDATES: %d" % len(candidates))
    print("-" * 100)
    for code, acts in candidates:
        meta = codes[code]
        print()
        print("  %s   [module: %s]" % (code, meta["module"]))
        print("    HELD BY: %s" % (", ".join(meta["roles"]) or "(no role)"))
        print("    ROUTES: %d" % len(acts))
        for route, kind, why in acts:
            print("      %-14s %-52s %s" % (kind, route, why))

    # ------------------------------------------------------------------ the per-code route counts
    print()
    print("-" * 100)
    print("ROUTE COUNT PER CODE — every code with at least one route, so the denominator is visible")
    print("-" * 100)
    for code, routes in sorted(per_code.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        if not routes:
            continue
        print("  %-3d  %s" % (len(set(routes)), code))

    if unresolved:
        print()
        print(
            "UNRESOLVED COMPOSITE CODE SETS (%d) — these are HOLES in the enumeration, not zeroes:"
            % len(unresolved)
        )
        for u in unresolved:
            print("    %s" % u)

    # ------------------------------------------------------------------ the three floors
    print()
    print("=" * 100)
    problems = []
    if len(codes) <= 200:
        problems.append(
            "the catalogue yielded only %d codes — the parser has stopped matching entries"
            % len(codes)
        )
    if total_routes <= 300:
        problems.append(
            "only %d code-route pairs were found — the route sweep has stopped matching"
            % total_routes
        )
    # THE FLOOR THAT MATTERS: a known-true answer, measured by hand before this script existed.
    if not any(code == "aml.monitor" for code, _ in candidates):
        problems.append(
            "`aml.monitor` did NOT come out as a candidate. The owner measured that one by hand — "
            "read and close on one code — so this is a broken measurement rather than a clean "
            "result. Do not report a candidate list from this run."
        )
    if problems:
        print("MEASUREMENT REFUSED:")
        for p in problems:
            print("  - %s" % p)
        sys.exit(1)
    print(
        "two-acts-one-code: %d candidates out of %d codes examined, %d code-route pairs.\n"
        "Nothing split, nothing minted. Each candidate's role set is the owner's decision."
        % (len(candidates), len(codes), total_routes)
    )


if __name__ == "__main__":
    main()
