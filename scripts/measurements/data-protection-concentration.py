"""CONFLICT OF INTEREST, THE MEASUREMENT STEP — who holds data-protection codes AND operational
management codes at the same time.

A MEASUREMENT. It builds no announcement, because the trigger is undefined: what CONSTITUTES a
conflict here comes from the legal adviser's answer on the data-protection officer's independence,
which the owner has not finished reading. An announcement whose trigger is undefined either never
fires or always fires, and both are worse than none.

## AND IT IS CALLED CONCENTRATION, NEVER A BREACH

The register's own rule, and it is not a wording preference. The sixteen database CHECK constraints
still refuse one person performing BOTH HALVES of a maker/checker pair, whatever the grants say. So a
role — or a person — holding both sides is ROLE CONCENTRATION: a control observation about who could
be asked to do what, not a violation that has occurred. `docs/module-1-preflight.md` § 3 already
records that nothing may call concentration a segregation breach, because a screen reporting a
violation it did not measure makes a false claim.

## THREE QUESTIONS, AND THEY ARE DIFFERENT QUESTIONS

  1. Which SEEDED roles hold both sides? That is about the template this product ships.
  2. Which of those combinations exist as ACTUAL HOLDERS on a database? A seeded possibility nobody
     holds is not the same finding as a person who holds both.
  3. How many organizations have ONE USER holding both sides? That is the only one of the three that
     is about a person rather than a configuration.

Reported separately because conflating them is how a template question gets reported as a live one.

## THE TWO SIDES, DECLARED BY NAME

Neither side is inferred from a module name or a code prefix pattern — a prefix sweep would pull in
`dsr.log` (which Sales holds, deliberately, so a customer's request can be recorded by whoever
receives it) and would miss `legal-hold.manage`. So both lists are written out below and are
arguable, which is the same discipline the retention floors use.

Usage:  python scripts/measurements/data-protection-concentration.py
        python scripts/measurements/data-protection-concentration.py --live   (reads both databases)
"""

import io
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CATALOGUE = os.path.join(
    ROOT, "packages", "db", "prisma", "seed-data", "permissions.ts"
)

# ---------------------------------------------------------------------------------------------
# SIDE A — THE DATA-PROTECTION CODES.
#
# What the office's privacy function decides. Declared by name, not by module: the `pdpl` module
# also contains `dsr.log`, which Sales holds on purpose so a customer's request can be recorded by
# whoever receives it, and `privacy-notice.read`, which is a read of a published notice.
DATA_PROTECTION_CODES = {
    "dsr.handle": "works a data-subject request",
    "dsr.close": "closes a data-subject request — the checker half",
    "legal-hold.manage": "places and releases a legal hold, which refuses disposal",
    "retention-schedule.update": "sets a retention period",
    "retention-schedule.confirm": "confirms a retention period as legal counsel",
    "retention.dispose.nominate": "nominates records for disposal",
    "retention.dispose.approve": "approves a disposal — the checker half",
    "retention.extend": "extends a record's retention",
    "retention.archive.retrieve": "retrieves a blocked record",
    "data-sharing.approve": "approves sharing personal data with a third party",
    "cross-border-transfer.approve": "approves a transfer out of the Kingdom",
    "dpia.review": "decides a data-protection impact assessment",
    "consent.manage": "records and withdraws consent",
    "ropa.manage": "maintains the record of processing activities",
    "privacy-notice.publish": "publishes a privacy notice",
    "incident.classify": "classifies a personal-data incident",
    # MEASURED, not guessed: there is no `incident.notify`. The catalogue carries TWO notification
    # codes and both belong on this side — one reaches the regulator, one reaches the office's own
    # senior management, and a breach notification is the sharpest data-protection act there is.
    "incident.notify-regulator": "notifies the regulator of a personal-data breach",
    "incident.senior-management.notify": "notifies the office's own senior management of one",
}

# ---------------------------------------------------------------------------------------------
# SIDE B — THE OPERATIONAL MANAGEMENT CODES.
#
# What the office's own business and its people are run by. The question behind the conflict is
# whether whoever decides a privacy matter is the same person whose operational decisions that
# matter is about — so this side is deliberately the MANAGEMENT codes rather than every write in the
# product. Placing a policy is operational work; deciding who may place one is management.
OPERATIONAL_MANAGEMENT_CODES = {
    "user.manage": "creates accounts and grants roles",
    "role.create": "defines a role",
    "role.update": "edits a role",
    "role.deactivate": "retires a role",
    # `role.permissions.manage` and `permission.manage` DO NOT EXIST — measured. The catalogue has
    # `role.update` (which the matrix saves through) and `permission.read`, a read. So what a role
    # may do is decided by `role.update`, already on this list, and there is nothing else to name.
    "employee.create": "records a person",
    "employee.update": "edits a person's record",
    "deprovisioning.execute": "removes a person's access",
    "duty-segregation.mode.declare": "declares the office a one-person office",
    "insurer.create": "registers an insurer the office deals with",
    "insurer.deactivate": "withdraws an insurer from dealing",
    "payment-channel.create": "adds an account client money is sent to",
    "payment-channel.deactivate": "withdraws one",
    # `commission.override` DOES NOT EXIST. It is a PAIR — raise and approve — and the APPROVE half
    # is the management act, which is also why naming the wrong one would have measured the maker.
    "commission-override.approve": "approves a commission override — the checker half",
    "refund.approve": "approves a refund",
    # `settlement.approve` DOES NOT EXIST — there is no `settlement.*` code at all; the settlement
    # pair is gated by finance codes. Dropped rather than substituted: guessing a near neighbour here
    # is how `refund.raise` got recorded as a maker code that reads no route.
    # `policy.place` DOES NOT EXIST; the code is `policy.create`. Kept, because placing new business
    # is the operational act the conflict question is about.
    "policy.create": "places new business",
    "endorsement.apply": "applies a change to a live policy",
    "sla.policy.regulatory": "decides a regulatory deadline",
}


def strip_comments(src):
    return re.sub(r"/\*.*?\*/", "", src, flags=re.S)


def seeded_grid():
    """code -> set of role names, resolved through the file's own aliases."""
    raw = io.open(CATALOGUE, encoding="utf-8", errors="replace").read()
    aliases = {}
    for m in re.finditer(r"^const ([A-Z_]+)\s*=\s*RoleName\.([A-Z_]+)", raw, re.M):
        aliases[m.group(1)] = m.group(2)
    for m in re.finditer(r'^const ([A-Z_]+)\s*=\s*"([A-Z_]+)"', raw, re.M):
        aliases[m.group(1)] = m.group(2)
    src = strip_comments(raw)
    grid = {}
    for m in re.finditer(
        r'code:\s*"([^"]+)",\s*module:\s*"[^"]+",.*?roles:\s*\[([^\]]*)\]', src, re.S
    ):
        grid[m.group(1)] = {
            aliases.get(t, t) for t in re.findall(r"[A-Z_][A-Z_0-9]*", m.group(2))
        }
    return grid


def sql(url, statement):
    out = subprocess.run(
        [
            "node",
            os.path.join(ROOT, "packages", "db", "scripts", "scratch-sql.mjs"),
            url,
            statement,
        ],
        capture_output=True,
        text=True,
    )
    if out.returncode != 0:
        return None
    return out.stdout.strip()


def db_url(env_file):
    path = os.path.join(ROOT, env_file)
    if not os.path.exists(path):
        return None
    for line in io.open(path, encoding="utf-8", errors="replace"):
        if line.startswith("DATABASE_URL"):
            return line.split("=", 1)[1].strip().strip('"')
    return None


def main():
    live = "--live" in sys.argv
    grid = seeded_grid()

    print("=" * 100)
    print("DATA-PROTECTION / OPERATIONAL-MANAGEMENT CONCENTRATION")
    print("=" * 100)
    print()
    print(
        "CONCENTRATION, NOT A BREACH. The sixteen database CHECK constraints still refuse one person"
    )
    print(
        "doing BOTH HALVES of a maker/checker pair, whatever the grants say. What follows is who"
    )
    print("COULD be asked to do what — a control observation, not a violation.")
    print()

    # A floor before any answer: a parser that stopped matching would report zero overlaps, which
    # reads exactly like a clean result.
    if len(grid) <= 200:
        print(
            "MEASUREMENT REFUSED: the catalogue yielded only %d codes — the parser has stopped matching."
            % len(grid)
        )
        sys.exit(1)

    missing_a = sorted(c for c in DATA_PROTECTION_CODES if c not in grid)
    missing_b = sorted(c for c in OPERATIONAL_MANAGEMENT_CODES if c not in grid)
    if missing_a or missing_b:
        print(
            "MEASUREMENT REFUSED: these declared codes are NOT in the catalogue, so this run would"
        )
        print("have silently measured a smaller set than it claims:")
        for c in missing_a + missing_b:
            print("    %s" % c)
        print(
            "\nA code named here that does not exist is the phantom-permission class — correct the"
        )
        print("list against the catalogue rather than dropping the name.")
        sys.exit(1)

    print("SIDE A — data-protection codes:        %d" % len(DATA_PROTECTION_CODES))
    print(
        "SIDE B — operational management codes: %d" % len(OPERATIONAL_MANAGEMENT_CODES)
    )
    print("Catalogue codes examined:              %d" % len(grid))
    print()

    # ------------------------------------------------------------------ (1) SEEDED ROLES
    roles = sorted({r for codes in grid.values() for r in codes})
    print("-" * 100)
    print("(1) SEEDED ROLES HOLDING BOTH SIDES")
    print("-" * 100)
    both = []
    for role in roles:
        a = sorted(c for c in DATA_PROTECTION_CODES if role in grid[c])
        b = sorted(c for c in OPERATIONAL_MANAGEMENT_CODES if role in grid[c])
        if a and b:
            both.append((role, a, b))
    print("    %d of %d seeded roles hold at least one code from each side." % (len(both), len(roles)))
    for role, a, b in both:
        print()
        print("    %s" % role)
        print("      DATA-PROTECTION (%d):" % len(a))
        for c in a:
            print("        %-32s %s" % (c, DATA_PROTECTION_CODES[c]))
        print("      OPERATIONAL MANAGEMENT (%d):" % len(b))
        for c in b:
            print("        %-32s %s" % (c, OPERATIONAL_MANAGEMENT_CODES[c]))

    if not live:
        print()
        print("-" * 100)
        print("(2) and (3) need the databases — re-run with --live")
        print("-" * 100)
        return

    # ------------------------------------------------------------------ (2) and (3) LIVE
    for label, env in (("dev", ".env"), ("db-test", ".env.test")):
        url = db_url(env)
        print()
        print("-" * 100)
        print("LIVE on %s (%s)" % (label, env))
        print("-" * 100)
        if not url:
            print("    %s not found — skipped." % env)
            continue

        a_list = "','".join(sorted(DATA_PROTECTION_CODES))
        b_list = "','".join(sorted(OPERATIONAL_MANAGEMENT_CODES))

        # (2) Which of the seeded combinations exist as ACTUAL HOLDERS — a role with a live grant
        #     AND at least one active assignment. A role nobody is assigned to is a possibility, not
        #     a holder, and reporting the two together is how a template question becomes a live one.
        q2 = (
            "SELECT r.\"name\" || ' (' || count(DISTINCT ura.\"userId\") || ' holder(s))' "
            'FROM "Role" r '
            'JOIN "UserRoleAssignment" ura ON ura."roleId" = r."id" AND ura."revokedAt" IS NULL '
            'JOIN "User" u ON u."id" = ura."userId" AND u."isActive" '
            'WHERE EXISTS (SELECT 1 FROM "RolePermission" rp JOIN "Permission" p ON p."id" = rp."permissionId" '
            "            WHERE rp.\"roleId\" = r.\"id\" AND p.\"code\" IN ('%s')) "
            '  AND EXISTS (SELECT 1 FROM "RolePermission" rp JOIN "Permission" p ON p."id" = rp."permissionId" '
            "            WHERE rp.\"roleId\" = r.\"id\" AND p.\"code\" IN ('%s')) "
            'GROUP BY r."name" ORDER BY r."name"' % (a_list, b_list)
        )
        out = sql(url, q2)
        print("    (2) ROLES WITH BOTH SIDES *AND* AT LEAST ONE ACTIVE HOLDER:")
        if out is None:
            print("        query failed — report this rather than a zero")
        elif not out:
            print("        none")
        else:
            for line in out.splitlines():
                print("        %s" % line)

        # (3) ONE USER holding both sides — across however many roles. This is the only question
        #     about a PERSON, and it is per organization because that is the unit an office is.
        q3 = (
            'SELECT o."subdomain" || \'  users=\' || count(*) FROM ( '
            '  SELECT u."id", u."organizationId" FROM "User" u '
            '  WHERE u."isActive" '
            '    AND EXISTS (SELECT 1 FROM "UserRoleAssignment" ura JOIN "RolePermission" rp ON rp."roleId" = ura."roleId" '
            '                JOIN "Permission" p ON p."id" = rp."permissionId" '
            "                WHERE ura.\"userId\" = u.\"id\" AND ura.\"revokedAt\" IS NULL AND p.\"code\" IN ('%s')) "
            '    AND EXISTS (SELECT 1 FROM "UserRoleAssignment" ura JOIN "RolePermission" rp ON rp."roleId" = ura."roleId" '
            '                JOIN "Permission" p ON p."id" = rp."permissionId" '
            "                WHERE ura.\"userId\" = u.\"id\" AND ura.\"revokedAt\" IS NULL AND p.\"code\" IN ('%s')) "
            ') z JOIN "Organization" o ON o."id" = z."organizationId" '
            'GROUP BY o."subdomain" ORDER BY o."subdomain"' % (a_list, b_list)
        )
        out = sql(url, q3)
        print("    (3) ORGANIZATIONS WITH ONE USER HOLDING BOTH SIDES:")
        if out is None:
            print("        query failed — report this rather than a zero")
        elif not out:
            print("        none")
        else:
            for line in out.splitlines():
                print("        %s" % line)

    print()
    print("=" * 100)
    print(
        "data-protection-concentration: reported, nothing built. What CONSTITUTES a conflict here\n"
        "is the legal adviser's answer on the DPO's independence and is not yet settled, so no\n"
        "announcement exists — an announcement whose trigger is undefined either never fires or\n"
        "always fires. And every number above is CONCENTRATION, never a breach."
    )


if __name__ == "__main__":
    main()
