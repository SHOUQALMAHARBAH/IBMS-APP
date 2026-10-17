import { describe, expect, it } from "vitest";
import {
  BrokerageKind,
  IntegrationMethod,
  RegulatoryActionBasis,
  RegulatoryActionKind,
} from "@prisma/client";
import {
  BROKERAGE_KIND_DESCRIPTIONS,
  INTEGRATION_METHOD_DESCRIPTIONS,
  REGULATORY_ACTION_BASIS_DESCRIPTIONS,
  REGULATORY_ACTION_KIND_DESCRIPTIONS,
  type EnumDescriptionSeed,
} from "./enum-descriptions";

/**
 * MODULE 0-ب CLOSE — the one property the database cannot enforce.
 *
 * `member` is the ENUM TYPE in each description table, so a row describing a member that does not
 * exist is unrepresentable — Postgres refuses it. What a database cannot express is COMPLETENESS:
 * that every member HAS a row. A member a person can choose with nothing explaining it is the gap
 * these tables exist to close, and it would otherwise appear silently the next time an enum gains a
 * value.
 *
 * So this reads the GENERATED Prisma enums rather than a hand-written list of member names. A
 * hand-written list is a second home for the same fact, and the copy is the one that drifts — the
 * `AuditAction` parity guard next door exists because of exactly that.
 */

const CASES: [string, Record<string, string>, EnumDescriptionSeed[]][] = [
  ["BrokerageKind", BrokerageKind, BROKERAGE_KIND_DESCRIPTIONS],
  [
    "RegulatoryActionKind",
    RegulatoryActionKind,
    REGULATORY_ACTION_KIND_DESCRIPTIONS,
  ],
  [
    "RegulatoryActionBasis",
    RegulatoryActionBasis,
    REGULATORY_ACTION_BASIS_DESCRIPTIONS,
  ],
  ["IntegrationMethod", IntegrationMethod, INTEGRATION_METHOD_DESCRIPTIONS],
];

/** Arabic script. A description present, non-empty and written in Latin letters is useless on an
 *  Arabic-first screen, and a presence check cannot see it. */
const ARABIC = /[؀-ۿ]/;

describe("every enum member a person can choose carries an Arabic description", () => {
  it("covers FOUR enums — pinned so a fifth is a deliberate edit here", () => {
    /*
     * The figure that moved three times in this close, so it is derived where it can be and pinned
     * where it cannot. Four enums, eleven members: a fifth enum added without a description table
     * fails HERE by name rather than appearing as an empty column on a screen.
     */
    expect(CASES).toHaveLength(4);
    expect(CASES.reduce((n, [, , rows]) => n + rows.length, 0)).toBe(11);
  });

  describe.each(CASES)("%s", (name, members, rows) => {
    const declared = Object.values(members);

    it("describes EVERY member, with no member left out", () => {
      const described = rows.map((r) => r.member).sort();
      /*
       * AN EXACT SET, not a count. A count survives a substitution — two members could become two
       * different members and still total two — which is the assertion class this module spent its
       * close correcting, and which CI caught on the PLATFORM code set two commits ago.
       */
      expect(described).toEqual([...declared].sort());
    });

    it("describes NOTHING that is not a member", () => {
      /*
       * Structurally impossible in the DATABASE, because the column is the enum type. Asserted here
       * anyway because this FILE is where the text is edited, and a typo caught at the seed is a
       * typo caught before a migration refuses it at deploy time.
       */
      for (const row of rows) {
        expect(
          declared,
          `${name}.${row.member} is described here but is not a member of the enum`,
        ).toContain(row.member);
      }
    });

    it("is Arabic, non-empty, and longer than a label", () => {
      for (const row of rows) {
        expect(row.descriptionAr.trim()).toBeTruthy();
        expect(
          ARABIC.test(row.descriptionAr),
          `${name}.${row.member} description is not Arabic script`,
        ).toBe(true);
        /*
         * A floor, not a pin. The point of these is to explain what the label cannot, so a
         * description shorter than a short sentence is a restatement — the failure mode the owner
         * named when she refused descriptions on the proper-noun lists the first time.
         */
        expect(
          row.descriptionAr.trim().length,
          `${name}.${row.member} description is too short to explain anything`,
        ).toBeGreaterThan(40);
      }
    });
  });

  it("says plainly, on the two values no guard reads, that no guard reads them", () => {
    /*
     * THE OWNER'S STANDING RULE, asserted rather than trusted: "where a value carries no consequence,
     * the description says so. A person who believes his choice changes the system's behaviour, and
     * later finds it does not, stops trusting every list after it."
     *
     * `brokerageKind` is the measured case — NOTHING reads it, which `schema.prisma` states twice
     * and `regOfficeBrokerageKindNote` says on screen. So both its descriptions must disclaim a
     * consequence, and a future edit that quietly promotes the field to meaning something fails here.
     */
    const DISCLAIMS = "ولا يقرأه"; // «ولا يقرأه» — "and nothing reads it"
    for (const row of BROKERAGE_KIND_DESCRIPTIONS) {
      expect(
        row.descriptionAr.includes(DISCLAIMS),
        `BrokerageKind.${row.member} no longer states that no guard reads this field. If a guard now does, that is a product change and this test is the right place to notice it`,
      ).toBe(true);
    }
  });
});
