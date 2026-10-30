"""
"NO ARABIC EXISTS FOR IT" IS A CLAIM, AND IT WAS NOT MEASURED.

The register said of `ProviderHealth.providerName`: *"No Arabic exists for it and inventing one is
what the standing rule forbids."* That sentence was repeated to the owner. Measured, it is TOO
STRONG for one of the three values and WRONG ABOUT THE NOUN for a second class entirely.

This script re-derives the split. It reads the api's own display strings and asks, per string,
whether the i18n tree already ships one that says the same thing:

    EXACT     — byte-identical to a shipping English value, so its Arabic sibling is the answer
                and nothing is written.
    NEAR      — a shipping value is close but NOT the same claim. This is the `dclmAgeing0To30`
                shape (one codepoint apart, a different range) and the `caAgeing1To30` shape (a
                near-match a reader in a hurry reaches for). A NEAR match is REPORTED, never
                pointed at: deciding two sentences mean the same thing is the owner's.
    COMPOSITE — no single shipping string matches, but every RUN of words in it ships somewhere.
                Reported with its parts named, because assembling them is a decision about word
                order in a language this script cannot read.
    NONE      — nothing in the tree says it. This is the true remainder, and it is the only
                list the owner is asked to write.

## WHY A STRING CAN BE UNLOCALISABLE RATHER THAN MERELY UNWRITTEN

Three of the api's `detail` strings interpolate `(err as Error).message` or a slice of a remote
engine's response body. That fragment is NOT our prose — it arrives at runtime from somebody
else's software — so it can never be translated. **But the sentence around it can.** The verdict
for those is SPLIT: the carrier sentence is localisable with the raw fragment left exactly as it
arrives, and declaring the whole row impossible is what this script exists to refuse.

## AND ONE COLUMN IS TWO THINGS

`RetentionScheduleItem.legalBasis` (which the register called `note` — the field name is `note`
on the TEMPLATE and `legalBasis` on the row, and they are not the same column) ships eight
seeded values AND is editable by the office under decision 80. So a localised copy would be
a second home for a value a person may replace, and the shipped eight are statutory CITATIONS
carrying article numbers, a Gazette reference and a PROVISIONAL marker — translating one is a
legal act rather than a translation. Verdict: NOT-A-LABEL, reported as such.

Run:  python scripts/measurements/api-display-strings.py
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
WEB_I18N = ROOT / "apps" / "web" / "lib" / "i18n" / "translations"
API_SRC = ROOT / "apps" / "api" / "src"

# A dictionary entry: `  key: 'value',` or `  key: "value",` possibly wrapped across lines by
# prettier. Captured non-greedily so an adjacent entry cannot be swallowed.
ENTRY = re.compile(
    r"^\s{2,}([A-Za-z][A-Za-z0-9_]*):\s*(['\"])((?:[^'\"\\]|\\.)*)\2,?\s*$",
    re.MULTILINE,
)

ARABIC = re.compile(r"[؀-ۿ]")


def shipping_english() -> dict[str, str]:
    """Every English dictionary value in the tree, keyed by its i18n key.

    The English half is what an api string can be compared against; the Arabic half is the
    ANSWER, so it is looked up separately once a match is established.
    """
    out: dict[str, str] = {}
    for path in sorted(WEB_I18N.glob("*.ts")):
        text = path.read_text(encoding="utf-8")
        for m in ENTRY.finditer(text):
            key, _, value = m.group(1), m.group(2), m.group(3)
            if ARABIC.search(value):
                continue  # the Arabic half
            # First writer wins: a key appears once per language, and the English block is
            # second in every file, so this records the English value.
            if key not in out or not out[key]:
                out[key] = value
    return out


def shipping_arabic() -> dict[str, str]:
    out: dict[str, str] = {}
    for path in sorted(WEB_I18N.glob("*.ts")):
        text = path.read_text(encoding="utf-8")
        for m in ENTRY.finditer(text):
            key, value = m.group(1), m.group(3)
            if ARABIC.search(value) and key not in out:
                out[key] = value
    return out


def norm(s: str) -> str:
    """Fold for comparison: case, punctuation and runs of space. Deliberately NOT a fuzzy
    match — a fold that admits a different claim is the thing this script exists to refuse."""
    s = s.lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def words(s: str) -> list[str]:
    return norm(s).split()


def overlap(a: str, b: str) -> float:
    wa, wb = set(words(a)), set(words(b))
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


# ─────────────────────────────────────────────────────────────────────────────────────────────
# THE API'S OWN DISPLAY STRINGS, transcribed from the source with their site, so a reader can
# check each one rather than trust this list. Re-derive with:
#   grep -rn "readonly name = \|detail:" apps/api/src/modules/screening-providers/
# The RAW marker names a fragment that arrives at runtime and can never be localised.
API_STRINGS: list[tuple[str, str, str, str]] = [
    # (class, site, string, raw-fragment description or "")
    (
        "providerName",
        "on-premise.provider.ts:40",
        "On-premise screening engine",
        "",
    ),
    (
        "providerName",
        "commercial.provider.ts:47",
        "Commercial screening provider",
        "",
    ),
    (
        "providerName",
        "built-in-watchlist.provider.ts:43",
        "Built-in watchlist cache (OFAC SDN + UN Consolidated)",
        "",
    ),
    (
        "detail",
        "built-in-watchlist.provider.ts:304",
        "The local sanctions cache is empty — the watchlist sync has never completed successfully. "
        "No customer can be screened against a real list until it does.",
        "",
    ),
    (
        "detail",
        "built-in-watchlist.provider.ts:324",
        "The sanctions cache was last refreshed {n}h ago, beyond the {limit}h staleness tolerance. "
        "Sanctions lists change; screening against this data is not current. Covers SANCTIONS only "
        "— no PEP source is configured.",
        "",
    ),
    (
        "detail",
        "built-in-watchlist.provider.ts:325",
        "Sanctions cache refreshed {n}h ago. Covers SANCTIONS only (OFAC SDN + UN Consolidated) — "
        "no PEP source is configured.",
        "",
    ),
    (
        "detail",
        "commercial.provider.ts:272 + on-premise.provider.ts:285",
        "Circuit breaker is open after repeated failures. Screening reports SCREENING_FAILED, not "
        "NO_MATCH, while it recovers.",
        "",
    ),
    (
        "detail",
        "commercial.provider.ts:298",
        "Provider reachable at {baseUrl}.",
        "the configured base URL — a URL, language-free",
    ),
    (
        "detail",
        "commercial.provider.ts:312",
        "Provider unreachable: {raw}",
        "(err as Error).message — another library's own text",
    ),
    (
        "detail",
        "not-configured.provider.ts:108",
        "Missing configuration: {list}. Compliance review is required before the applicable "
        "workflow can proceed.",
        "env var names — identifiers, language-free",
    ),
    (
        "detail",
        "not-configured.provider.ts:109",
        "No automated screening provider is configured. Compliance review is required before the "
        "applicable workflow can proceed.",
        "",
    ),
    (
        "detail",
        "on-premise.provider.ts:305",
        'Screening engine reachable at {baseUrl} (dataset "{dataset}"). {raw}',
        "an 80-char slice of the engine's own response body",
    ),
    (
        "detail",
        "on-premise.provider.ts:318",
        "Screening engine unreachable at {baseUrl}: {raw}",
        "(err as Error).message — another library's own text",
    ),
]

NEAR_FLOOR = 0.45


def main() -> int:
    en = shipping_english()
    ar = shipping_arabic()
    if len(en) < 500:
        print(
            f"REFUSED: only {len(en)} English dictionary values parsed. The entry pattern has "
            "stopped matching — a measurement that reads nothing reports a clean NONE for every "
            "string, which is the direction that looks like honest remaining work.",
            file=sys.stderr,
        )
        return 2

    print(f"api display strings: {len(API_STRINGS)} sites | dictionary {len(en)} EN / {len(ar)} AR")
    print()

    tallies: dict[str, int] = {}
    for cls, site, s, raw in API_STRINGS:
        probe = re.sub(r"\{[a-z]+\}", "", s).strip()
        best: list[tuple[float, str, str]] = []
        for key, value in en.items():
            if norm(value) == norm(probe):
                best = [(1.0, key, value)]
                break
            score = overlap(probe, value)
            if score >= NEAR_FLOOR:
                best.append((score, key, value))
        best.sort(reverse=True)

        if best and best[0][0] == 1.0:
            verdict = "EXACT"
        elif best:
            verdict = "NEAR"
        else:
            verdict = "NONE"
        if raw:
            verdict = f"{verdict}/SPLIT"
        tallies[verdict] = tallies.get(verdict, 0) + 1

        print(f"[{verdict}] {cls} · {site}")
        print(f"    api: {s}")
        if raw:
            print(f"    RAW: {raw} — the carrier sentence is localisable, the fragment is not")
        for score, key, value in best[:3]:
            arabic = "(no Arabic sibling!)" if key not in ar else "ships Arabic"
            print(f"    {score:.2f} {key} = {value!r} — {arabic}")
        if not best:
            print("    no shipping English value reaches the floor")
        print()

    print("-" * 92)
    for verdict in sorted(tallies):
        print(f"  {verdict}: {tallies[verdict]}")
    print()
    print(
        "A NEAR match is NOT a match. State the comparison; do not point a label at a string "
        "that says something slightly different."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
