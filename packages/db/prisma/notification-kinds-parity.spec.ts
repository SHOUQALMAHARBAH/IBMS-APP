import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/*
 * NOTIFICATION_KINDS IS DECLARED TWICE, IN TWO PACKAGES, AND NOTHING CHECKED THAT THEY AGREE.
 *
 * `apps/api/src/modules/notification/notification.config.ts` declares the list the API produces.
 * `apps/web/lib/notification/notification-api.ts` declares a byte-for-byte hand-written copy, because
 * the web has no import path to an api module. Seven kinds in each, and the compiler sees neither
 * against the other: two packages, two builds.
 *
 * ## The defect each direction produces, which are NOT the same severity
 *
 * A kind ADDED IN THE API AND NOT IN THE WEB is the one that matters. `NotificationItem.kind` is typed
 * from the web's union, and TypeScript does not check a value arriving over HTTP against a union — so
 * the row flows through, `LABEL_KEY[kind]` is `undefined`, and `t(undefined)` renders nothing. **The
 * bell then shows a notification with a count and no words**: a reader is told something needs
 * attention and not what. On a system whose notifications include an AML alert and a sanctions
 * screening match, that is the worst possible thing to render blank.
 *
 * A kind REMOVED FROM THE API and left in the web is rot rather than a defect: a label nobody reaches.
 * Caught here too, because an unreachable label is how the next reader concludes the list is longer
 * than it is.
 *
 * ## Why the compiler does not already cover the first direction
 *
 * `LABEL_KEY` in `NotificationBell.tsx` is a total `Record<NotificationKind, TranslationKey>`, so
 * adding a kind to the WEB's union without a label is a type error. That is real and it is not this
 * guard: it fires only once somebody has already copied the kind across. The gap is the copy itself,
 * and no type can see it. Same shape as `audit-action-parity.spec.ts`, which is this file's precedent
 * and which exists for the same reason one level down (a web union against a database enum).
 *
 * ## Why here, in `packages/db`, which owns neither list
 *
 * Because it is the only place that can SEE both. A spec in `apps/web` reading an `apps/api` path
 * typechecks on a laptop and fails inside the image — `turbo prune web --docker` keeps only web's
 * workspace dependencies, and apps/api is not one. The same is true mirrored. `packages/db` already
 * holds `audit-action-parity.spec.ts` for exactly this reason, reading an `apps/web` file as text.
 */

const REPO = path.join(__dirname, "..", "..", "..");

const API_LIST = path.join(
  REPO,
  "apps",
  "api",
  "src",
  "modules",
  "notification",
  "notification.config.ts",
);

const WEB_LIST = path.join(
  REPO,
  "apps",
  "web",
  "lib",
  "notification",
  "notification-api.ts",
);

const BELL = path.join(
  REPO,
  "apps",
  "web",
  "components",
  "app",
  "NotificationBell.tsx",
);

/**
 * Reads a `export const NOTIFICATION_KINDS = [...] as const;` array as text.
 *
 * Bounded on `] as const;` rather than on the next `;` or the next `export`: the audit-action guard's
 * own history is why. Its first version cut at the next semicolon, which is where a type alias ends,
 * and read 4 of 20 values because a comment inside the union contained a semicolon in ordinary prose —
 * the author's own comment breaking the author's own parser. `] as const;` is punctuation that cannot
 * appear in English.
 *
 * Only quoted members are collected, so a comment inside the array cannot contribute a value.
 */
function kindsIn(file: string, label: string): string[] {
  expect(
    fs.existsSync(file),
    `${file} does not exist — this guard is reading nothing, and would pass by finding no drift.`,
  ).toBe(true);
  const source = fs.readFileSync(file, "utf8");
  const start = source.indexOf("export const NOTIFICATION_KINDS = [");
  expect(
    start,
    `${label}: NOTIFICATION_KINDS has been renamed, moved, or is no longer a plain array literal`,
  ).toBeGreaterThan(-1);
  const end = source.indexOf("] as const;", start);
  expect(
    end,
    `${label}: NOTIFICATION_KINDS is not closed by "] as const;" — if it became computed, this guard cannot read it and must not pretend to`,
  ).toBeGreaterThan(start);
  return [...source.slice(start, end).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

/** The keys of `LABEL_KEY` in the bell — the third copy, and the one a reader actually sees. */
function labelledKinds(): string[] {
  expect(fs.existsSync(BELL), `${BELL} does not exist`).toBe(true);
  const source = fs.readFileSync(BELL, "utf8");
  const start = source.indexOf(
    "const LABEL_KEY: Record<NotificationKind, TranslationKey> = {",
  );
  expect(
    start,
    "NotificationBell's LABEL_KEY has been renamed or is no longer a plain object literal",
  ).toBeGreaterThan(-1);
  const end = source.indexOf("};", start);
  expect(end, "LABEL_KEY is not closed by \"};\"").toBeGreaterThan(start);
  return [...source.slice(start, end).matchAll(/^\s*([a-z_]+):/gm)].map(
    (m) => m[1]!,
  );
}

describe("NOTIFICATION_KINDS — the api's list and the web's copy agree", () => {
  const api = kindsIn(API_LIST, "apps/api");
  const web = kindsIn(WEB_LIST, "apps/web");
  const labelled = labelledKinds();

  it("is not vacuous — all three lists are substantial", () => {
    // Without this the guard passes when a regex matches nothing, which is the failure mode that lets
    // the drift back in through a refactor of a file it reads. The floor is set below today's seven so
    // deleting a kind on purpose does not fail THIS assertion instead of the real one.
    expect(api.length).toBeGreaterThanOrEqual(5);
    expect(web.length).toBeGreaterThanOrEqual(5);
    expect(labelled.length).toBeGreaterThanOrEqual(5);
  });

  it("the web can WORD every kind the api sends", () => {
    // The direction that matters: a kind the api sends and the web cannot name renders a count with no
    // words. The message names the kinds rather than reporting a length mismatch.
    expect(api.filter((k) => !web.includes(k))).toEqual([]);
  });

  it("the web declares no kind the api cannot send", () => {
    expect(web.filter((k) => !api.includes(k))).toEqual([]);
  });

  it("every kind the api sends has a LABEL_KEY in the bell", () => {
    // Separate from the list check, and not redundant with the compiler: `LABEL_KEY` is total over the
    // WEB's union, so it is complete with respect to a copy that may itself be short. This asserts it
    // against the API's list, which is what the reader's screen actually receives.
    expect(api.filter((k) => !labelled.includes(k))).toEqual([]);
  });

  it("the bell labels nothing the api cannot send", () => {
    expect(labelled.filter((k) => !api.includes(k))).toEqual([]);
  });

  it("has no duplicates in either list", () => {
    expect(new Set(api).size).toBe(api.length);
    expect(new Set(web).size).toBe(web.length);
  });
});
