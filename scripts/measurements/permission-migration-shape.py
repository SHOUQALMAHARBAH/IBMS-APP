"""A MIGRATION THAT ADDS A PERMISSION MUST NOT GRANT IT TO ANYBODY -- OWNER DECISION 131.

## WHY THIS EXISTS -- measured, and the measurement is the whole argument

«إحنا بنطلّع كل صلاحيات النظام بالمصفوفة وما بنعطي ولا وحدة لحدا» -- we expose every permission in
the matrix and grant none of them. The office decides, from a mark and a notification.

Measured 2026-11-12, over every migration that has ever added a row to `Permission`:

    20261026100000_four_action_phase_one                      backfilled its grant
    20261029100000_four_action_phase_four_payment_channel     backfilled its grant
    20261030100000_four_action_phase_four_sla_policy          backfilled its grant
    20261101100000_customer_update_contact_details            backfilled its grant
    20261105100000_customer_read_narrow                       backfilled its grant (x3)
    20261106100000_diagnostics_view                           backfilled its grant
    20261128110000_retention_schedule_code_split              backfilled its grant
    20261129100000_insurance_company_administrator_invite     backfilled its grant

**EIGHT OF EIGHT.** Which answers a question decision 131 section 5 asks and nobody had measured:
*does any permission code today guard a button that used to be open?* **No** -- and the reason is
exactly the mechanism 131 removes. `20261212100000`'s own comment says it out loud: «every office
that has one of these three roles gets it, which is what the seed would have done».

⟶ So the NEXT such code is the first in this product's life that will actually close a button, and
from that moment the notification's «تتحكّم في: [الشاشة أو الزر]» line is the only thing standing
between an office's staff and a control that silently vanished.

## WHAT IT CHECKS, BOTH DIRECTIONS

  1. A migration that INSERTs into `"Permission"` must not INSERT into `"RolePermission"`.
  2. The eight above are DECLARED as history and are ASSERTED: if one of them stops backfilling,
     the declaration is stale and this gate says so.

The second half is what stops the list rotting into an amnesty -- `legal-numbers.py`'s
`DECLARED_FIGURES` and `rls-proof-shape.py`'s exemption list carry the same property for the same
reason.

## ⛔ WHY THE EIGHT ARE LEFT ALONE RATHER THAN CORRECTED

A migration is a record of what was done to a database, not a document. Rewriting one to match a
decision taken afterwards would make the file disagree with every database that has already run it,
and `db:checksums` would be right to refuse. The grants those eight wrote are real and are live;
undoing them is a separate decision about taking capability away from offices that have it, which
is the owner's and is not this gate's business.

## WHAT THIS GATE DELIBERATELY DOES NOT ASK

It does not look at the SEED. `seed.ts` writes `RolePermission` rows from the catalogue's own
`roles: [...]` arrays, and must keep doing so -- those arrays reach `DEFAULT_ORGANIZATION_ID`, the
DEMO office, and nowhere else (`seed.ts:1222`, measured 2026-11-12). Decision 131 is about what a
RELEASE does to a REAL office, and a migration is the only thing that touches one.

Usage:

    python scripts/measurements/permission-migration-shape.py             # the gate
    python scripts/measurements/permission-migration-shape.py --self-test # its own tests
"""

from __future__ import annotations

import io
import os
import re
import shutil
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8")  # a gate inside `npm run` owns its own stdout

# scripts/measurements/<this file> -> scripts/measurements -> scripts -> the repository root.
# THREE dirnames, not two: the first version used two, pointed at `scripts/packages/db/...`,
# found no migrations at all and reported all eight declarations as stale. A gate whose root is
# wrong fails LOUDLY here only because the declared list is asserted -- without that second
# direction it would have found zero backfills and printed a confident green.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIGRATIONS = os.path.join(ROOT, "packages", "db", "prisma", "migrations")

# The eight that backfilled, measured 2026-11-12. Each is ASSERTED below, so a stale entry fails.
DECLARED_BACKFILLS: dict[str, str] = {
    "20261026100000_four_action_phase_one": (
        "The four-action split's first phase. Gave the new codes to whoever held the code they "
        "were split out of, so nobody lost access -- which was the right call for a SPLIT and is "
        "the wrong default for a new capability."
    ),
    "20261029100000_four_action_phase_four_payment_channel": (
        "Same split, payment channel."
    ),
    "20261030100000_four_action_phase_four_sla_policy": "Same split, SLA policy.",
    "20261101100000_customer_update_contact_details": (
        "A narrower update code, handed to the holders of the broader one."
    ),
    "20261105100000_customer_read_narrow": (
        "Three inserts: the narrowed read, to three role sets."
    ),
    "20261106100000_diagnostics_view": (
        "The one code in the catalogue whose enforcement is in the WEB rather than a route "
        "guard -- it hides raw error detail on /settings/email. It is also the closest thing "
        "the product has to a code that gates a control INSIDE a screen, which is the case the "
        "notification's «الشاشة أو الزر» line has to handle."
    ),
    "20261128110000_retention_schedule_code_split": "A split, same shape.",
    "20261129100000_insurance_company_administrator_invite": (
        "A PROVIDER-scope invite code, granted to a provider role. ⚠️ Note this one is not an "
        "office grant at all -- it is listed because the mechanism is identical and a future "
        "reader counting 'migrations that backfilled' must get the same eight."
    ),
}

ADDS_PERMISSION = re.compile(r'INSERT\s+INTO\s+"Permission"', re.I)
ADDS_GRANT = re.compile(r'INSERT\s+INTO\s+"RolePermission"', re.I)


def _strip_sql_comments(sql: str) -> str:
    """Line and block comments come off before the search.

    A migration's comment may legitimately DISCUSS `INSERT INTO "RolePermission"` -- this very
    decision is the sort of thing a migration explains -- and a gate that reads a comment as code
    would refuse the file that documents why it does not do the thing.
    """
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    sql = re.sub(r"--[^\n]*", " ", sql)
    return sql


def scan(migrations_dir: str) -> tuple[dict[str, int], list[str]]:
    """-> ({migration name: RolePermission insert count} for those that add a Permission}, errors)"""
    errors: list[str] = []
    found: dict[str, int] = {}
    if not os.path.isdir(migrations_dir):
        return found, [f"no migrations directory at {migrations_dir}"]
    for name in sorted(os.listdir(migrations_dir)):
        path = os.path.join(migrations_dir, name, "migration.sql")
        if not os.path.isfile(path):
            continue
        with io.open(path, encoding="utf-8") as fh:
            sql = _strip_sql_comments(fh.read())
        if not ADDS_PERMISSION.search(sql):
            continue
        found[name] = len(ADDS_GRANT.findall(sql))
    return found, errors


def run_gate(migrations_dir: str = MIGRATIONS, quiet: bool = False) -> int:
    found, errors = scan(migrations_dir)
    backfilling = {n: c for n, c in found.items() if c > 0}

    for name, count in sorted(backfilling.items()):
        if name in DECLARED_BACKFILLS:
            continue
        errors.append(
            f"{name} adds a permission AND writes {count} RolePermission row(s).\n"
            f"      ⛔ OWNER DECISION 131: a new permission is granted to NOBODY. The office sees "
            f"it marked «جديدة», its administrator is notified, and the office decides.\n"
            f"      Remove the grant. If the code closes a control that is open today, that is "
            f"exactly the case the notification exists for -- make sure it names the screen or "
            f"button, do not pre-grant it to keep the control visible."
        )

    for name, why in sorted(DECLARED_BACKFILLS.items()):
        if name not in found:
            errors.append(
                f"{name} is declared as a historical backfill but adds no permission at all -- "
                f"that declaration is stale, delete it"
            )
        elif found[name] == 0:
            errors.append(
                f"{name} is declared as a historical backfill but writes no RolePermission row "
                f"-- that declaration is stale, delete it"
            )

    if not quiet:
        print("")
        print("  migrations that add a permission              ", len(found))
        print("  of those, writing a grant                     ", len(backfilling))
        print("  declared as history, each asserted            ", len(DECLARED_BACKFILLS))
        print("")
        for e in errors:
            print(f"  ERROR {e}")
        if errors:
            print("")
            print(f"  {len(errors)} finding(s)")
        else:
            print("  ok — no migration grants a permission it adds (OWNER DECISION 131)")
        print("")
    return 1 if errors else 0


# ---------------------------------------------------------------------------------------------
# THE SELF-TEST. A gate that cannot fail is a gate nobody should trust, and this one's whole job
# is to refuse something that has happened eight times -- so the plants matter more than usual.
# ---------------------------------------------------------------------------------------------

CLEAN = """-- adds a code and grants it to nobody, which is what decision 131 requires
INSERT INTO "Permission" ("id", "code", "module") VALUES ('x', 'a.b', 'm');
"""

BACKFILL = """INSERT INTO "Permission" ("id", "code", "module") VALUES ('x', 'a.b', 'm');
INSERT INTO "RolePermission" ("id", "roleId", "permissionId") SELECT 'y', r."id", 'x' FROM "Role" r;
"""

COMMENT_ONLY = """-- This migration deliberately does NOT do INSERT INTO "RolePermission" --
-- decision 131 ends the backfill. The comment names it so a reader knows it was considered.
/* Not even in a block comment: INSERT INTO "RolePermission" */
INSERT INTO "Permission" ("id", "code", "module") VALUES ('x', 'a.b', 'm');
"""

GRANT_ONLY = """-- touches grants but adds no code: out of scope, and must stay out
INSERT INTO "RolePermission" ("id", "roleId", "permissionId") VALUES ('y', 'r', 'p');
"""


def _write(root: str, name: str, sql: str) -> None:
    d = os.path.join(root, name)
    os.makedirs(d, exist_ok=True)
    with io.open(os.path.join(d, "migration.sql"), "w", encoding="utf-8") as fh:
        fh.write(sql)


def self_test() -> int:
    passed = failed = 0
    cases = [
        ("a migration that adds a code and grants nothing", {"20270101000000_ok": CLEAN},
         False, None),
        ("a migration that adds a code AND backfills its grant",
         {"20270101000000_bad": BACKFILL}, True, "granted to NOBODY"),
        ("a backfill named only in comments is NOT a finding",
         {"20270101000000_ok": COMMENT_ONLY}, False, None),
        ("a migration that writes grants but adds no code is out of scope",
         {"20270101000000_grants": GRANT_ONLY}, False, None),
        # The second direction. Both shapes of stale declaration, because they fail differently:
        # one where the declared migration is gone entirely, one where it stopped backfilling.
        ("a declared backfill that no longer exists",
         {"20270101000000_ok": CLEAN}, True, "stale"),
        ("a declared backfill that no longer writes a grant",
         {"20261106100000_diagnostics_view": CLEAN}, True, "stale"),
    ]
    for label, files, expect_fail, must_say in cases:
        tmp = tempfile.mkdtemp(prefix="perm-mig-")
        try:
            for name, sql in files.items():
                _write(tmp, name, sql)
            declared = DECLARED_BACKFILLS.copy()
            try:
                if "stale" not in (must_say or ""):
                    # the real declaration list names eight migrations this fixture does not have,
                    # so every case would fail as stale -- narrow it to what the fixture declares
                    DECLARED_BACKFILLS.clear()
                    DECLARED_BACKFILLS.update(
                        {n: "fixture" for n in files if n in declared}
                    )
                elif "no longer writes" in label:
                    DECLARED_BACKFILLS.clear()
                    DECLARED_BACKFILLS["20261106100000_diagnostics_view"] = "fixture"
                else:
                    DECLARED_BACKFILLS.clear()
                    DECLARED_BACKFILLS["20260101000000_gone"] = "fixture"
                buf = io.StringIO()
                real, sys.stdout = sys.stdout, buf
                try:
                    rc = run_gate(tmp)
                finally:
                    sys.stdout = real
            finally:
                DECLARED_BACKFILLS.clear()
                DECLARED_BACKFILLS.update(declared)
            text = buf.getvalue()
            said = (must_say or "") in text
            ok = (rc != 0) == expect_fail and (must_say is None or said)
            print(f"  {'ok  ' if ok else 'FAIL'}  {label:<58} "
                  f"{'named it' if ok and expect_fail else ('left it alone' if ok else 'WRONG')}")
            if not ok:
                print(f"        rc={rc}, expected {'failure' if expect_fail else 'pass'}")
                print("\n".join("        " + l for l in text.splitlines()[:12]))
            passed += ok
            failed += not ok
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    print("")
    print(f"  self-test: {passed} passed, {failed} failed")
    print("")
    return 1 if failed else 0


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    sys.exit(run_gate())
