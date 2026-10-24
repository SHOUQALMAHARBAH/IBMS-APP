"""CAN THE ROLES DOOR FOUR ENABLED REACH AN RFQ BY CLICKING?

The screen/route fit gate asks "can this role OPEN this screen, and do its calls resolve".
It never asks "can this role GET here from the work that justifies it". This asks the
second question, for the RFQ chain, and it is committed so the answer is re-derivable
rather than quoted from a report.

## WHY IT IS A SEPARATE MEASUREMENT

Door four lets a Compliance Officer read the RFQ chain of a customer whose screening case
is assigned to her, and a DPO read one whose DSR he is handling. A capability reachable
only by typing a URL is the class the owner found by clicking on a Thursday evening, and
our own change can reintroduce it without any gate noticing.

## EVERY NEGATIVE CARRIES A NON-VACUITY CONTROL

A grep that finds nothing and a grep that failed look identical. So each "there is no X"
below is paired with a positive control through the SAME matcher: if the control also
comes back empty, the run reports that it proved nothing and exits non-zero.

Written with the editor, never a heredoc: the patterns carry regex escapes and this host
eats backslashes in a heredoc — a leading word-boundary escape has arrived as a literal
0x08 before, and the pattern then matched nothing while reading correctly.
"""

import io
import os
import re
import sys

WEB = os.path.join("apps", "web")
APP = os.path.join(WEB, "app", "(app)")
DEST = os.path.join(WEB, "components", "app", "destinations.ts")

# The screens on the only candidate paths, plus the anchor screens door four keys on.
ANCHOR_SCREENS = ["screening-matches", "dsr"]
BRIDGE_SCREENS = [os.path.join("customers", "[id]"), "opportunities", "customers"]
TARGET = "/rfqs"


def read(path):
    return io.open(path, encoding="utf-8").read()


def nav_gate(href):
    """The permissions on a destination, read by splitting on `href:` FIRST and scanning to the
    next one — a one-line grep misses every multi-line destination, which is why
    `permission-reachability.py` does it this way too."""
    src = read(DEST)
    for part in src.split("href: '")[1:]:
        if part.split("'")[0] != href:
            continue
        chunk = part.split("href: '")[0]
        m = re.search(r"permissions:\s*\[([^\]]*)\]", chunk, re.S)
        if not m:
            return ["(UNGATED)"]
        return [c.strip().strip("'\"") for c in m.group(1).split(",") if c.strip()]
    return None


def links_out(path):
    """Every in-app navigation target a screen offers: `router.push('/x')` and `href="/x"`."""
    src = read(path)
    out = set()
    for m in re.finditer(
        r"(?:router\.push|push)\(\s*[`'\"](/[a-z][^`'\"]*)", src
    ):
        out.add(m.group(1))
    for m in re.finditer(r"href=\{?\s*[`'\"](/[a-z][^`'\"]*)", src):
        out.add(m.group(1))
    return out


def main():
    failures = 0

    print("=== 1. IS THERE A NAV ENTRY FOR THE RFQ SCREENS? ===")
    dest = read(DEST)
    rfq_hits = len(re.findall(r"rfq", dest, re.I))
    # THE CONTROL: the same matcher, on a destination that is certainly there.
    control = len(re.findall(r"opportunities", dest, re.I))
    print("  occurrences of 'rfq' in destinations.ts   : %d" % rfq_hits)
    print("  control — occurrences of 'opportunities'  : %d" % control)
    if control == 0:
        print("  THE CONTROL IS EMPTY, so this file proved nothing about the nav. Refusing.")
        return 1
    # NAME WHAT THE OCCURRENCES ARE, never just count them. The first version of this check used a
    # case-SENSITIVE `grep -c` and reported 0; the one real occurrence is `labelKey: 'navRfqMarket'`
    # on the `/opportunities` destination — so the navigation DOES carry an entry a person reads as
    # the RFQ screen, under exactly that name, pointing somewhere else.
    for m in re.finditer(r"^.*rfq.*$", dest, re.I | re.M):
        print("    occurrence: %s" % m.group(0).strip())
    exact = len(re.findall(r"href: '/rfqs'", dest))
    print("  destinations whose href is exactly /rfqs : %d" % exact)
    print("  control — href exactly /opportunities    : %d"
          % len(re.findall(r"href: '/opportunities'", dest)))
    if exact == 0:
        print("  => NO nav entry for the RFQ LIST. The only entry a reader would take for it is")
        print("     labelled 'RFQ / market' and points at /opportunities, gated on opportunity.read.")

    print()
    print("=== 2. EVERY INBOUND LINK TO AN RFQ, FROM ANY SCREEN OR COMPONENT ===")
    inbound = []
    scanned = 0
    for root, _dirs, names in os.walk(WEB):
        if "node_modules" in root or ".next" in root:
            continue
        for n in names:
            if not n.endswith((".tsx", ".ts")) or n.endswith(".spec.ts"):
                continue
            path = os.path.join(root, n)
            scanned += 1
            for target in links_out(path):
                if target.startswith(TARGET):
                    inbound.append((path, target))
    print("  files scanned: %d" % scanned)
    if scanned < 100:
        print("  scanned too few files to be trusted. Refusing.")
        return 1
    for path, target in sorted(inbound):
        print("    %-54s -> %s" % (path.replace(os.sep, "/").replace("apps/web/", ""), target))
    print("  => %d inbound link(s)" % len(inbound))

    print()
    print("=== 3. THE GATES ON EVERY SCREEN THAT LINKS TO AN RFQ ===")
    for path, _t in sorted(set((p, t) for p, t in inbound)):
        screen = (
            path.replace(os.sep, "/")
            .replace("apps/web/app/(app)", "")
            .replace("/page.tsx", "")
        )
        print("    %-30s nav gate: %s" % (screen, nav_gate(screen) or "(no nav entry)"))

    print()
    print("=== 4. DO THE ANCHOR SCREENS LINK ANYWHERE AT ALL? ===")
    for s in ANCHOR_SCREENS:
        path = os.path.join(APP, s, "page.tsx")
        if not os.path.isfile(path):
            print("    %-24s MISSING (%s)" % (s, path))
            failures += 1
            continue
        out = sorted(links_out(path))
        real = [t for t in out if not t.startswith("/login")]
        print("    %-24s links: %s" % (s, ", ".join(out) or "(none)"))
        print("    %-24s  of which in-app (not /login): %s" % ("", ", ".join(real) or "NONE"))

    print()
    print("=== 5. DO THE BRIDGE SCREENS CARRY THE READER TOWARDS AN RFQ? ===")
    for s in BRIDGE_SCREENS:
        path = os.path.join(APP, s, "page.tsx")
        if not os.path.isfile(path):
            print("    %-24s MISSING" % s)
            continue
        out = sorted(t for t in links_out(path) if not t.startswith("/login"))
        print("    %-24s -> %s" % (s, ", ".join(out) or "NONE"))

    print()
    print("A path exists only if a chain of OPENABLE screens ends at /rfqs/{id}. This script")
    print("prints the chain; whether a role can open each link is the nav gate beside it.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
