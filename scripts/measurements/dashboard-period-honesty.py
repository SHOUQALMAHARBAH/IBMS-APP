# -*- coding: utf-8 -*-
"""
OWNER DECISION 58's REPORT-ONLY HALF — which dashboards carry a period-scoped figure
with no period printed.

Her instruction was to fix `/dashboards/sales` and REPORT the rest. This is the report,
as a script rather than a paragraph, because the list is a fact about the tree and a
paragraph goes stale the first time somebody adds a dashboard.

THE QUESTION IS NOT "DOES THIS SCREEN PRINT A PERIOD" — it is "does every figure on it
obey the period it prints". A screen printing one period line over a mixed set of
figures is in a WORSE state than one printing nothing, because the line reads as a
statement about all of them. That is why `/dashboards/policy` needed a declaration while
`/dashboards/sales` did not: measured, two of policy's four metrics ignore the window.

HOW EACH SIDE IS DETERMINED, and both are deliberately crude and SAID to be:

  api   — a service that mentions `previousUtcMonthRange`/`currentUtcMonthRange`,
          `periodStart`/`periodEnd`/`periodLabel` is period-scoped; one that mentions
          only `asOf` is as-of; one that mentions neither is a snapshot.
  web   — a screen is credited with printing a period only if it renders
          `ReportProvenance` with a `period`-bearing shape, or `FigurePeriod`.

Neither is a parser. A row here is a CANDIDATE to read, not a finding — the same
standing as `dead-client-helpers.py`'s rows, and for the same reason: every judgement
about which figures obey a window has needed a human reading the service's own `where`
clauses. Run it, then read the rows.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APP = os.path.join(ROOT, "apps", "web", "app", "(app)")
API = os.path.join(ROOT, "apps", "api", "src")

PERIOD_TOKENS = ("previousUtcMonthRange", "currentUtcMonthRange", "periodStart",
                 "periodEnd", "periodLabel")

# Screen -> the api service that answers it. Hand-paired BECAUSE the mapping is not
# derivable: several screens read two services, and one reads none of its own.
SCREENS = {
    "dashboards/sales": ["sales-dashboard.service.ts"],
    "dashboards/policy": ["policy-dashboard.service.ts"],
    "dashboards/claims": ["claims-dashboard.service.ts"],
    "dashboards/financial": ["financial-dashboard.service.ts"],
    "dashboards/compliance": ["compliance-dashboard.service.ts"],
    "dashboards/executive": ["executive-dashboard.service.ts"],
    "dashboards/insurer-employee-performance": [
        "insurer-performance.service.ts",
        "employee-performance.service.ts",
    ],
    "insurer-performance": ["insurer-performance.service.ts"],
    "employee-performance": ["employee-performance.service.ts"],
    "sales-performance": ["sales-performance.service.ts"],
    "portfolio-analysis": ["portfolio-analysis.service.ts"],
    "profitability-analysis": ["profitability-analysis.service.ts"],
    "kpi-dashboard": ["kpi-dashboard.service.ts"],
    "sla-dashboard": ["sla-dashboard.service.ts"],
    "financial-report": ["financial-report.service.ts"],
}


def find(name):
    for base, _dirs, files in os.walk(API):
        if name in files:
            return os.path.join(base, name)
    return None


def api_scope(services):
    period = asof = False
    seen = 0
    for s in services:
        p = find(s)
        if p is None:
            continue
        seen += 1
        src = open(p, encoding="utf-8").read()
        if any(tok in src for tok in PERIOD_TOKENS):
            period = True
        if "asOf" in src:
            asof = True
    if seen == 0:
        return "service-not-found"
    if period and asof:
        return "MIXED"
    if period:
        return "period"
    if asof:
        return "asOf"
    return "snapshot"


def web_prints(screen):
    p = os.path.join(APP, screen, "page.tsx")
    if not os.path.exists(p):
        return "screen-not-found"
    src = open(p, encoding="utf-8").read()
    if "FigurePeriod" in src:
        return "per-figure"
    kinds = set(re.findall(r'kind="(\w+)"', src))
    if {"period", "generatedAtWithPeriod"} & kinds:
        return "one line, period"
    if "asOf" in kinds:
        return "one line, as-of"
    if "generatedAt" in kinds:
        return "one line, generated-at"
    return "NOTHING"


def main():
    rows = []
    for screen, services in sorted(SCREENS.items()):
        rows.append((screen, api_scope(services), web_prints(screen)))

    width = max(len(r[0]) for r in rows)
    print("%-*s  %-18s %s" % (width, "screen", "api figures", "what the screen prints"))
    for screen, api, web in rows:
        print("%-*s  %-18s %s" % (width, screen, api, web))

    # A FLOOR, because every row above is satisfied by a walker that found nothing.
    if any(a == "service-not-found" for _s, a, _w in rows):
        sys.stderr.write("\nFAIL: a service named in SCREENS was not found — the pairing is stale.\n")
        return 1
    if any(w == "screen-not-found" for _s, _a, w in rows):
        sys.stderr.write("\nFAIL: a screen named in SCREENS was not found — the pairing is stale.\n")
        return 1

    owed = [
        (s, a, w) for s, a, w in rows
        if a in ("period", "MIXED", "asOf") and w == "NOTHING"
    ]
    print()
    print("REPORT ONLY — a screen whose figures are scoped to a window or a date, printing NEITHER:")
    if not owed:
        print("  none")
    for s, a, w in owed:
        print("  %-42s api=%s" % (s, a))
    print()
    print("  %d screen(s). Owner decision 58 fixed /dashboards/sales and /dashboards/policy;" % len(owed))
    print("  these are REPORTED and not changed, per her instruction. Read each before acting:")
    print("  a MIXED row needs a `metricScope` declaration like /dashboards/policy's, and a")
    print("  uniformly period-scoped one needs only a clause — do NOT add the declaration to a")
    print("  dashboard that does not need it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
