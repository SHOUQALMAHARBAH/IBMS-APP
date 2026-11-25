import { it } from 'vitest';
import { lineCodeForProgrammeLine } from '../src/modules/insurance-program/insurance-program.config';
// Message 53 §2 item 7 — the PRODUCT's own line-family classifier, imported rather than
// re-implemented: a second copy would disagree the first time a line was renamed, and the
// disagreement would surface as exactly the defect it is here to fix.
import { classifyInsuranceLine } from '../src/modules/claim/claim.config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  prisma as rawPrisma,
  RoleName,
  type CustomerType,
  type LanguagePreference,
} from '@ibms/db';
import { createTestApp } from '../test/utils/test-app';
import {
  DEMO_OFFICE_NAMES,
  HALTED_STAGES,
  haltedChainSchedule,
  type HaltedStage,
} from './demo-chain-plan';

/**
 * Demo/dummy-data seed script — NOT part of the automated test suite.
 *
 * Run with `npm run seed:demo` from `apps/api/` (or `npm run seed:demo -w api`
 * from the repo root). It targets the DEV database (`../../.env`'s
 * DATABASE_URL / APP_DATABASE_URL), never `.env.test` — running it does not
 * touch anything `npm run test:e2e` uses.
 *
 * What it does, end to end, through the REAL HTTP API (the same path the
 * frontend and the e2e suite use — so every row it creates has passed the
 * same business-rule validation a real user's action would):
 *   - Ensures a second Organization ("Office B") exists alongside the
 *     default one, so every screen can be checked for tenant isolation too.
 *   - For each Organization: one login account per RBAC role actually needed
 *     to drive the pipelines below (Sales, Placement, Policy-Checking,
 *     Claims, Finance, Compliance, Manager, Admin) — created directly via
 *     Prisma (there is no HTTP endpoint to create the FIRST account in an
 *     Organization once a second Organization exists — see
 *     `AuthService.signup`), then logged in through the real
 *     `POST /auth/login`.
 *   - A shared pool of Insurers (global `InsurerMaster` + one `Insurer`
 *     relationship row per Organization — the platform has no HTTP endpoint
 *     to create these either; every e2e fixture creates them the same way).
 *   - Employee HR records via `POST /employees`.
 *   - Leads (some left at each pipeline stage, some fully converted) via
 *     `POST /leads` (+ transitions) and `POST /prospects`.
 *   - Customers via `POST /customers` (individual + corporate).
 *   - For a subset of customers, the FULL sales-to-active-policy pipeline:
 *     Risk Profile -> Needs Assessment (submit/review/approve) -> Insurance
 *     Program (assemble/finalize) -> Opportunity -> RFQ -> Quotation ->
 *     Comparison -> Recommendation (draft/send) -> Client Decision (ACCEPT)
 *     -> Policy (place/issuance/checking/delivery/acknowledge-receipt) ->
 *     Invoice and/or Claim on the resulting ACTIVE policy.
 *   - A handful of standalone Complaints, Incidents and Vendors.
 *
 * Every step that can fail on one item (a single customer, a single policy)
 * is caught and logged rather than aborting the whole run — see `attempt()`
 * below and the tally printed at the end.
 *
 * Scale is configurable via environment variables so this can be smoke-tested
 * small before committing to a full run (see README-SEED-DEMO.md):
 *   DEMO_EMPLOYEES_PER_ORG      (default 10  -> 20 total)
 *   DEMO_CUSTOMERS_PER_ORG      (default 250 -> ~500+ total, see report)
 *   DEMO_LEADS_PER_ORG          (default 20)
 *   DEMO_FULL_PIPELINE_PER_ORG  (default 15  -> up to 30 full policies)
 *   DEMO_COMPLAINTS_PER_ORG     (default 6)
 *   DEMO_INCIDENTS_PER_ORG      (default 5)
 *   DEMO_VENDORS_PER_ORG        (default 6)
 *
 * Safe to re-run: every unique field (emails, national IDs, registration
 * numbers, policy numbers, ...) is randomized per run, so re-running ADDS
 * more demo data rather than colliding with the previous run's rows. Actor
 * accounts (one per role per Organization) are the exception — they are
 * upserted by a fixed email so credentials stay stable across runs.
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Set BEFORE `createTestApp()` boots the real `AppModule`, because
 * `ScheduledJobsGuard.onApplicationBootstrap` reads it at boot.
 *
 * `.env.test` carries this flag; `.env` (which this script runs against) does
 * not, so without it all 19 `@Cron` jobs register and fire on wall-clock time
 * during a run that takes minutes. Two of them matter here: `WATCHLIST_SYNC`
 * would perform a REAL multi-megabyte sanctions download against the dev
 * database mid-seed, and the 4-hourly re-screen batch would start screening
 * the hundreds of customers this script is still in the middle of creating.
 * Neither is a failure exactly, but both make a seed run slow, non-repeatable
 * and network-dependent for no benefit.
 */
process.env.SCHEDULED_JOBS = 'disabled';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const NUM = {
  employeesPerOrg: envInt('DEMO_EMPLOYEES_PER_ORG', 10),
  customersPerOrg: envInt('DEMO_CUSTOMERS_PER_ORG', 250),
  leadsPerOrg: envInt('DEMO_LEADS_PER_ORG', 20),
  fullPipelinePerOrg: envInt('DEMO_FULL_PIPELINE_PER_ORG', 15),
  complaintsPerOrg: envInt('DEMO_COMPLAINTS_PER_ORG', 6),
  incidentsPerOrg: envInt('DEMO_INCIDENTS_PER_ORG', 5),
  vendorsPerOrg: envInt('DEMO_VENDORS_PER_ORG', 6),
  /*
   * MESSAGE 53 §2 ITEM 2 — the share of customers whose KYC is completed.
   *
   * ⚠️ A SHARE RATHER THAN ALL, by the owner's own words («جزء من العملاء»): a list where
   * every row reads «نشِط» has no KYC queue to show, and `/customers/kyc-queue` is in the
   * scenario. Expressed as a fraction here rather than a count so it scales with
   * `customersPerOrg`, and overridable for a quick run.
   */
  kycShare: envInt('DEMO_KYC_PERCENT', 70) / 100,
};

/**
 * The password every demo account gets, from the environment — with NO default.
 *
 * It used to be a literal string right here. That string is deliberately not repeated even in this
 * comment: a password in a source file is a password in every clone, every diff and every search
 * result, and the accounts on existing dev databases are still hashed with it. It had additionally
 * been copied into a requirements document, which is how it stopped being a secret at all.
 * Requiring it from the environment means the only place it exists is the shell that ran the seed.
 *
 * Refusing to run without it is deliberate rather than defaulting to something generated: a
 * generated password nobody recorded strands sixteen accounts, and this script has already
 * stranded sixteen accounts once (see README-SEED-DEMO.md). The operator chooses it, so the
 * operator has it.
 */
const DEMO_PASSWORD = (() => {
  const fromEnv = process.env.DEMO_PASSWORD?.trim();
  if (!fromEnv) {
    throw new Error(
      [
        'DEMO_PASSWORD is not set. This script no longer carries a password in its source.',
        'Set one for this run and keep it:',
        '  PowerShell:  $env:DEMO_PASSWORD = "<choose a password>"',
        '  bash:        export DEMO_PASSWORD="<choose a password>"',
        'It must satisfy the same policy a real sign-up does: at least 12 characters with upper case, lower case, a digit and a symbol. Every demo login this script prints will use it.',
      ].join('\n'),
    );
  }
  return fromEnv;
})();

/** Matches `packages/db/prisma/seed.ts`'s `DEFAULT_ORGANIZATION_ID` — kept as
 * a literal (not imported) because that module opens its own PrismaClient
 * and runs seeding side effects on import, same reasoning as
 * `test/tenant-prisma.ts`. */
const ORG_A_ID = '00000000-0000-0000-0000-000000000001';
const ORG_A_SLUG = 'office-a';

const ORG_B_ID = '00000000-0000-0000-0000-0000000000b1';
const ORG_B_SLUG = 'office-b';
const ORG_B_SUBDOMAIN = 'demo-office-b';

/*
 * 🔴 BOTH OFFICES ARE NAMED BY OWNER DECISION 150 RULING 6 — message 46 §2.3.
 *
 * Office A was `Default Brokerage Office` (the base seed's own placeholder, visible on every
 * screen of a demonstration) and office B was `Rawabi Insurance Brokerage (demo)`, which this
 * script invented. Neither is hers; both are now.
 *
 * ⛔ The strings live in `demo-chain-plan.ts` and are SLICED from `docs/decision-150-ratified-
 * strings.md` §٦, re-sliced byte-for-byte by `demo-chain-plan.spec.ts`. Nothing is retyped here.
 *
 * ⛔ DEMO DATA ONLY, which is her own instruction («لبيانات العرض وحدها»). `packages/db/prisma/
 * seed.ts` is untouched, so a real install still gets its own default office name — renaming an
 * office for a demonstration must never reach a real one.
 */
const ORG_A_LEGAL_NAME = DEMO_OFFICE_NAMES['office-a'].en;
const ORG_A_LEGAL_NAME_AR = DEMO_OFFICE_NAMES['office-a'].ar;
const ORG_B_LEGAL_NAME = DEMO_OFFICE_NAMES['office-b'].en;
const ORG_B_LEGAL_NAME_AR = DEMO_OFFICE_NAMES['office-b'].ar;

/** Both offices in one place: the MFA release and its post-condition check run
 * after any office-level abort, so they cannot read the loop variable that
 * seeds them. */
const DEMO_ORGS = [
  { orgId: ORG_A_ID, orgSlug: ORG_A_SLUG },
  { orgId: ORG_B_ID, orgSlug: ORG_B_SLUG },
] as const;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

let seq = 0;
function nextSeq(): number {
  seq += 1;
  return seq;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length > 0) {
    const i = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function money(n: number): string {
  return n.toFixed(3);
}

function jordanianNationalId(): string {
  return String(randomInt(1_000_000_000, 9_899_999_999));
}

function jordanianPhone(): string {
  const prefix = pick(['77', '78', '79']);
  const rest = String(randomInt(1_000_000, 9_999_999));
  return `+962${prefix}${rest}`;
}

function uniqueEmail(local: string): string {
  return `${local}.${Date.now()}.${nextSeq()}@demo-seed.ibms.test`;
}

/*
 * 🔴 MESSAGE 53 §2 ITEM 4 — THE POLICY SECTION'S TWO ADDRESSES, AND THE SHAPE WAS WRONG BEFORE
 * THE LENGTH WAS.
 *
 * The walk read `client-acceptance.1795519941693.558@demo-seed.ibms.test` under the client's
 * acceptance evidence, and the same shape beside the delivery recipient. The owner asked for
 * «عناوين قصيرة ومعقولة».
 *
 * ⟶ AND WHAT EACH FIELD SHOULD HOLD IS WRITTEN IN ITS OWN DTO, so neither of these is invented:
 *
 *   `CaptureClientDecisionDto.evidenceRef`  «a document id, an e-signature envelope id, or an
 *                                            email message reference. Not the evidence content.»
 *   `RecordDeliveryDto.recipient`           «a name, an email address, or a courier reference.»
 *
 * So `evidenceRef` was not merely long — a mailbox address is not an email MESSAGE reference,
 * which is the `<local@host>` form a mail client shows. And `recipient` ignored the `method`
 * beside it, so a policy delivered `in_person` or by `courier` recorded an email address as the
 * person who took it.
 *
 * ⛔ NEITHER FIELD IS UNIQUE-CONSTRAINED and neither is validated as an email (both are
 * `@IsString()` with a length bound), so the timestamp and sequence were buying nothing. Both
 * carry the record's own id instead, which is short, stable across a re-run, and traceable.
 */
function emailMessageRef(seed: string): string {
  return `<accept.${seed.slice(0, 8)}@mail.demo.test>`;
}

/** The delivery recipient, in the shape the `method` beside it implies. */
function deliveryRecipient(
  method: string,
  customerLabel: string,
  policyId: string,
): string {
  // ⚠️ `customerLabel` defaults to '' on a pipeline called without one, so every branch that
  // wants a name has a fallback that is still a plausible value rather than an empty string —
  // which `@MinLength(2)` would refuse, turning a cosmetic choice into a failed delivery.
  const who = customerLabel.trim() || 'مسؤول التأمين';
  switch (method) {
    case 'email':
      return `insurance@${policyId.slice(0, 6)}.demo.test`;
    case 'courier':
      return `ARAMEX-${policyId.slice(0, 8).toUpperCase()}`;
    default:
      // `portal` and `in_person` are both a PERSON taking the document.
      return who;
  }
}

function isoDateDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoDateDaysAgo(days: number): string {
  return isoDateDaysFromNow(-days);
}

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

interface Tally {
  created: Record<string, number>;
  failed: Record<string, number>;
  errors: string[];
}

function newTally(): Tally {
  return { created: {}, failed: {}, errors: [] };
}

function bump(tally: Tally, bucket: 'created' | 'failed', key: string): void {
  tally[bucket][key] = (tally[bucket][key] ?? 0) + 1;
}

/** Runs `fn`, tallies success/failure under `key`, and NEVER throws — a
 * single bad row (a validation edge case, a transient conflict) must not
 * abort a run that is otherwise creating hundreds of good rows. */
async function attempt<T>(
  tally: Tally,
  key: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  try {
    const result = await fn();
    bump(tally, 'created', key);
    return result;
  } catch (err) {
    bump(tally, 'failed', key);
    const message = err instanceof Error ? err.message : String(err);
    tally.errors.push(`[${key}] ${message}`);
    return undefined;
  }
}

async function postAs<T = Record<string, unknown>>(
  app: INestApplication<App>,
  token: string,
  urlPath: string,
  body: unknown,
): Promise<T> {
  const res = await request(app.getHttpServer())
    .post(urlPath)
    .set(bearer(token))
    .send(body as object);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `POST ${urlPath} -> ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return res.body as T;
}

/** The PATCH sibling of `postAs`. Added for Module 0 item (g)'s approval route, which is a PATCH. */
async function patchAs<T = Record<string, unknown>>(
  app: INestApplication<App>,
  token: string,
  urlPath: string,
  body: unknown,
): Promise<T> {
  const res = await request(app.getHttpServer())
    .patch(urlPath)
    .set(bearer(token))
    .send(body as object);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `PATCH ${urlPath} -> ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return res.body as T;
}

async function getAs<T = Record<string, unknown>>(
  app: INestApplication<App>,
  token: string,
  urlPath: string,
): Promise<T> {
  const res = await request(app.getHttpServer())
    .get(urlPath)
    .set(bearer(token));
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `GET ${urlPath} -> ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return res.body as T;
}

// ---------------------------------------------------------------------------
// Name / content pools (Arabic-first — this system's primary language)
// ---------------------------------------------------------------------------

const GIVEN_NAMES_M = [
  'محمد',
  'أحمد',
  'عمر',
  'خالد',
  'يوسف',
  'إبراهيم',
  'عبدالله',
  'سامي',
  'فادي',
  'مراد',
  'زيد',
  'قصي',
  'باسل',
  'هاني',
  'رامي',
  'طارق',
  'ماجد',
  'نضال',
  'وليد',
  'سعد',
];
const GIVEN_NAMES_F = [
  'فاطمة',
  'مريم',
  'سارة',
  'رنا',
  'هبة',
  'لينا',
  'ريم',
  'دانة',
  'نور',
  'رهف',
  'ياسمين',
  'دعاء',
  'سلمى',
  'آية',
  'لبنى',
  'هالة',
  'منى',
  'غادة',
  'إيمان',
  'شذى',
];
const MIDDLE_NAMES = [
  'محمود',
  'حسين',
  'سالم',
  'فهد',
  'رشيد',
  'منصور',
  'جميل',
  'كريم',
  'عادل',
  'ناصر',
];
const FAMILY_NAMES = [
  'الخطيب',
  'العبدالله',
  'النابلسي',
  'القاسم',
  'الحوراني',
  'السعدي',
  'المصري',
  'الزعبي',
  'الشوابكة',
  'التميمي',
  'العدوان',
  'الرفاعي',
  'الخوالدة',
  'الحياري',
  'البدور',
  'العمري',
  'السرحان',
  'القرالة',
  'الطراونة',
  'الزيود',
];

const COMPANY_PREFIXES = [
  'شركة الأمل',
  'شركة النخبة',
  'شركة الرواد',
  'مجموعة الأفق',
  'شركة الوفاء',
  'شركة المستقبل',
  'شركة الاتحاد',
  'شركة النور',
  'شركة الرياض',
  'مجموعة السلام',
  'شركة الفا',
  'شركة الياسمين',
];
const COMPANY_SUFFIXES = [
  'للتجارة العامة',
  'للمقاولات',
  'للصناعات الغذائية',
  'للاستشارات',
  'لتكنولوجيا المعلومات',
  'للنقل والشحن',
  'للتوزيع',
  'للخدمات اللوجستية',
  'للتصنيع',
  'للاستثمار العقاري',
];
const SECTORS = [
  'التصنيع',
  'تجارة التجزئة',
  'المقاولات',
  'الرعاية الصحية',
  'النقل والخدمات اللوجستية',
  'تقنية المعلومات',
  'الأغذية والمشروبات',
  'العقارات',
  'الخدمات المهنية',
  'الضيافة والفنادق',
];
const CITIES = [
  'عمّان، الأردن',
  'إربد، الأردن',
  'الزرقاء، الأردن',
  'العقبة، الأردن',
  'السلط، الأردن',
  'مادبا، الأردن',
  'الكرك، الأردن',
];
const LEAD_SOURCES = [
  'referral',
  'website',
  'social_media',
  'campaign',
  'tender',
  'bank_partner',
  'strategic_partner',
  'ex_customer',
  'renewal',
] as const;

/**
 * Every `lines` entry below MUST be one of `COVERAGE_LINES`
 * (`insurance-program.config.ts`) verbatim: an RFQ's `insuranceLine` is
 * validated against the lines the Opportunity's Insurance Programme actually
 * designed, and those come from that canonical list. A near-miss like
 * "Property All Risks (Fire)" is not a different spelling, it is a line that
 * does not exist, and every RFQ naming it 422s.
 */
interface InsurerSeed {
  legalName: string;
  legalNameAr: string;
  lines: string[];
}
/**
 * Companies an office registered ITSELF — no row in the global catalogue.
 *
 * This is the case the whole insurer feature exists for (`Insurer.insurerMasterId` is nullable),
 * and until now the demo data had none: every seeded insurer was catalogue-linked, so the
 * "registered locally" badge and the local-name-editing path were invisible.
 *
 * The LAST entry of each office is the same real company under two different spellings — extra
 * spaces and the Arabic definite article moved. `canonical_name_key()` folds both to one key, so
 * the cross-office DIRECTORY shows them as ONE entry while each office keeps its own row. That is
 * the directory's headline behaviour and it cannot be demonstrated with one office.
 *
 * Registering the second spelling into the SAME office is refused with a 409 — deliberately NOT
 * seeded, because a refusal is worth seeing happen rather than reading about. `docs/first-run.md`
 * walks it.
 */
/**
 * Locally registered insurers — no `InsurerMaster` row behind them, which is the second of the two
 * registration paths and the one a real office reaches for when a company the catalogue never heard
 * of turns up.
 *
 * The Yarmouk entry appears in BOTH offices, spelled differently, and the exact spellings are
 * load-bearing rather than decorative. The directory groups on `canonicalName`, which the database
 * generates from `legalName` alone — the Arabic name does not participate — so the strings below
 * were measured against `canonical_name_key()` on the dev database rather than reasoned about:
 *
 *   'Yarmouk Insurance (demo)'   -> 'demo insurance yarmouk'
 *   'YARMOUK   insurance (demo)' -> 'demo insurance yarmouk'   same key, so ONE directory entry
 *
 * The first draft of this pair used 'al-yarmouk   insurance' against 'Yarmouk Insurance' and would
 * have produced TWO entries under a comment claiming one: the key is token-SORTED and strips the
 * Arabic article 'ال' but keeps a Latin 'al' as a token of its own ('al insurance yarmouk'). The
 * walkthrough makes a promise about what this looks like on screen, so the promise is measured.
 *
 * The Arabic names differ the way a second typist would actually differ — 'شركة' against 'شركه',
 * 'للتأمين' against 'للتامين' — so the merged directory entry visibly covers two spellings.
 */
const LOCAL_INSURER_SEEDS: Record<
  'a' | 'b',
  { legalName: string; legalNameAr: string; lines: string[] }[]
> = {
  a: [
    {
      legalName: 'Petra Takaful (demo)',
      legalNameAr: 'بترا للتكافل',
      lines: ['Group Medical', 'Group Life'],
    },
    {
      legalName: 'Yarmouk Insurance (demo)',
      legalNameAr: 'شركة اليرموك للتأمين',
      lines: ['Motor Fleet', 'Property All Risks'],
    },
  ],
  b: [
    {
      legalName: 'Zarqa Mutual (demo)',
      legalNameAr: 'الزرقاء التعاونية',
      lines: ['Public Liability'],
    },
    // The same company as office A's second entry. Same canonical key, different spelling — which
    // is what makes the cross-office directory show one company rather than two.
    {
      legalName: 'YARMOUK   insurance (demo)',
      legalNameAr: 'شركه اليرموك للتامين',
      lines: ['Motor Fleet'],
    },
  ],
};

/**
 * The duplicate the walkthrough asks her to type, and the office it must be refused in.
 *
 * `docs/first-run.md` tells her to register this name in office A and watch it refused. That is a
 * promise about a running system, so the seed makes the attempt itself and fails if the refusal
 * does not come — an instruction nobody re-checks is exactly the kind that rots into "it just let
 * me save it".
 */
/**
 * Promises `docs/first-run.md` makes that this run could not confirm.
 *
 * Collected rather than thrown at the point of discovery, and the difference is not stylistic.
 * The first version threw, the throw reached `seedOrganization`'s caller, and the console read
 * "Default Brokerage Office FAILED entirely" — one wrong assertion about a documentation step had
 * skipped that office's employees, customers, pipelines and claims. A check on the DOCS must not
 * be able to cost the DATA; the run still fails at the end, where failing is free.
 */
const brokenPromises: string[] = [];

function recordBrokenPromise(detail: string): void {
  brokenPromises.push(detail);
  console.log(`  !!! walkthrough promise NOT confirmed: ${detail}`);
}

/**
 * 🔴 OWNER DECISION 158 §٤ — THE WALKTHROUGH NAMES THE OFFICES THIS RUN ACTUALLY CREATES.
 *
 * `docs/first-run.md` listed `Default Brokerage Office` and `Rawabi Insurance Brokerage (demo)`
 * long after decision 150 ruling 6 gave the two offices the owner's own names. A presenter
 * reading that paragraph and then looking at the screen sees two offices neither of which is
 * named in the guide, and has no way to tell a stale document from a failed seed.
 *
 * ⛔ IT COMPARES, IT DOES NOT WRITE. The guide is the thing that was wrong and the names in
 * `demo-chain-plan.ts` are the owner's; this reads both and reports a disagreement the way
 * every other walkthrough promise here is reported — collected, never thrown, because a check
 * on the DOCS must not be able to cost the DATA.
 *
 * It looks for the ARABIC name, which is the one she ratified; the English beside it in the
 * guide is this repository's transliteration and is not pinned.
 */
function verifyWalkthroughNamesTheOffices(): void {
  const guidePath = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'docs',
    'first-run.md',
  );
  let guide: string;
  try {
    guide = fs.readFileSync(guidePath, 'utf8');
  } catch (err) {
    recordBrokenPromise(
      `docs/first-run.md could not be read at ${guidePath}: ${(err as Error).message}. ` +
        'The walkthrough is what a presenter follows, so a missing one is a broken promise ' +
        'rather than a missing nicety.',
    );
    return;
  }
  for (const slug of ['office-a', 'office-b'] as const) {
    const { ar, en } = DEMO_OFFICE_NAMES[slug];
    if (!guide.includes(ar)) {
      recordBrokenPromise(
        `docs/first-run.md does not name ${slug} as ${JSON.stringify(ar)} (${en}), which is ` +
          'what this run creates. Either the guide is stale or the name moved; correct the ' +
          'guide before this seed is used for a demo.',
      );
    }
  }
  for (const stale of [
    'Default Brokerage Office',
    'Rawabi Insurance Brokerage (demo)',
  ]) {
    if (guide.includes(stale)) {
      recordBrokenPromise(
        `docs/first-run.md still names ${JSON.stringify(stale)}, which no demo office has ` +
          'been called since decision 150 ruling 6.',
      );
    }
  }
}

/**
 * 🔴 OWNER DECISION 158 TABLE ك, CHECKED AT THE END AGAINST WHAT IS ACTUALLY ON THE ROWS.
 *
 * ⚠️ AND THIS EXISTS BECAUSE A RUN FOUND WHAT EVERY STATIC CHECK MISSED. The demo numbers were
 * in the source and `decision-158-seed-arabic.spec.ts` was green, but after a complete run from
 * an EMPTY database office A's licence still read `CBJ-SEED-DEFAULT`: it already held a term
 * from `db:seed`, so the creation path returned early and the demo values were never applied.
 * A test that reads the SOURCE cannot see that; only reading the DATABASE at the end can.
 *
 * ⛔ It asserts, it does not write — `applyDemoLicenceValues` is what writes, on both branches.
 * Reported through `recordBrokenPromise` like every other walkthrough promise: collected, never
 * thrown, because this runs after all the data is in place and failing here must not cost it.
 */
async function verifyBothOfficesCarryTheDemoLicence(): Promise<void> {
  for (const [slug, expected] of Object.entries(DEMO_LICENCE_NUMBER)) {
    const terms = await rawPrisma.brokerLicense.findMany({
      // BY ID, for the reason `applyDemoLicenceValues` records: `orgSlug` is this script's name
      // for an office and the database `subdomain` is a different string.
      where: { organizationId: DEMO_ORG_ID_BY_SLUG[slug] },
      select: { licenseNumber: true },
    });
    if (terms.length === 0) {
      recordBrokenPromise(
        `${slug} holds no licence term at all, so decision 158 table ك's number ` +
          `${JSON.stringify(expected)} is on nothing. Every pipeline in that office is ` +
          'refused by the art. 21/a/9 gate, which is the guard working.',
      );
      continue;
    }
    const wrong = terms
      .map((t) => t.licenseNumber)
      .filter((number) => number !== expected);
    if (wrong.length > 0) {
      recordBrokenPromise(
        `${slug} carries licence number(s) ${JSON.stringify(wrong)} where decision 158 ` +
          `table ك says ${JSON.stringify(expected)}. The certificate a customer receives ` +
          'prints this under the office name (decision 153 ruling 2), so a presenter opening ' +
          'one in front of the brokers would show a number that looks like a real CBJ licence.',
      );
    }
  }
}

const DUPLICATE_SPELLING_DEMO = {
  attempt: 'yarmouk insurance (Demo)',
  attemptAr: 'شركة اليرموك للتامين',
  collidesWith: 'Yarmouk Insurance (demo)',
} as const;

const INSURER_SEEDS: InsurerSeed[] = [
  {
    legalName: 'Jordan Insurance Company (demo)',
    legalNameAr: 'الشركة الأردنية للتأمين',
    lines: [
      'Motor Fleet',
      'Property All Risks',
      'Marine Cargo / Goods in Transit',
    ],
  },
  {
    legalName: 'Middle East Insurance Company (demo)',
    legalNameAr: 'الشركة الشرق أوسطية للتأمين',
    lines: ['Motor Fleet', 'Public Liability', 'Group Medical'],
  },
  {
    legalName: 'Arabia Insurance Jordan (demo)',
    legalNameAr: 'شركة العربية للتأمين - الأردن',
    lines: [
      'Property All Risks',
      'Machinery Breakdown',
      'Marine Cargo / Goods in Transit',
    ],
  },
  {
    legalName: 'Jordan French Insurance (demo)',
    legalNameAr: 'الأردنية الفرنسية للتأمين',
    lines: ['Motor Fleet', 'Group Medical', 'Group Life'],
  },
  {
    legalName: 'National Ahlia Insurance (demo)',
    legalNameAr: 'الأهلية الوطنية للتأمين',
    lines: ['Property All Risks', 'Public Liability', 'Motor Fleet'],
  },
  {
    legalName: 'Al-Manara Insurance (demo)',
    legalNameAr: 'شركة المنارة للتأمين',
    lines: ['Group Medical', 'Group Life', 'Public Liability'],
  },
];

/**
 * Ordered four-part names already handed out by this run, so the generator cannot draw one twice.
 *
 * ## Why this exists — a finding about the GENERATOR, not about the data
 *
 * Measured on dev: **135 employees, 134 distinct ordered name keys, exactly one collision.** Two
 * separately-generated people drew `آية ناصر عادل الخوالدة` ten days apart — different positions,
 * different hire dates, two independent runs.
 *
 * That is not bad luck, it is arithmetic. Four independent `pick()` calls over these pools give roughly
 * twenty-four thousand combinations, so at 135 draws the birthday problem puts a collision at about one
 * in three. **A generator whose collision rate is the collision rate of its pool will keep producing
 * these, and the next one lands on whichever table gets a unique key next.** Fixing it once is cheaper
 * than resolving it per table — which is why this is a `Set` and not a rename of one row.
 *
 * The UNIQUENESS IS ON THE ORDERED KEY, matching `canonical_person_key` rather than the sorted company
 * key: the generator must not produce two people whose names differ only in word order either, since
 * for a person that IS a different person and the demo data should not contain accidental cousins of
 * itself.
 */
const USED_PERSON_NAMES = new Set<string>();

function personName(): {
  given: string;
  father: string;
  grandfather: string;
  family: string;
  gender: 'M' | 'F';
} {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const gender: 'M' | 'F' = Math.random() < 0.6 ? 'M' : 'F';
    const given = gender === 'M' ? pick(GIVEN_NAMES_M) : pick(GIVEN_NAMES_F);
    const father = pick(MIDDLE_NAMES);
    // A person is not their own father's namesake twice over: "X Y Y Z" reads as a data error rather
    // than a name, and it halves the usable space for no gain.
    const grandfather = MIDDLE_NAMES.filter((n) => n !== father)[
      Math.floor(Math.random() * (MIDDLE_NAMES.length - 1))
    ] as string;
    const family = pick(FAMILY_NAMES);
    const key = [given, father, grandfather, family].join(' ');
    if (!USED_PERSON_NAMES.has(key)) {
      USED_PERSON_NAMES.add(key);
      return { given, father, grandfather, family, gender };
    }
  }
  // The pool is exhausted rather than unlucky. A DISTINGUISHING FAMILY NAME beats a silent duplicate:
  // the demo data stays plausible, the uniqueness holds, and the suffix says plainly that the generator
  // ran out rather than pretending it did not.
  const gender: 'M' | 'F' = Math.random() < 0.6 ? 'M' : 'F';
  const given = gender === 'M' ? pick(GIVEN_NAMES_M) : pick(GIVEN_NAMES_F);
  const father = pick(MIDDLE_NAMES);
  const grandfather = pick(MIDDLE_NAMES);
  const family = `${pick(FAMILY_NAMES)}-${USED_PERSON_NAMES.size + 1}`;
  const key = [given, father, grandfather, family].join(' ');
  USED_PERSON_NAMES.add(key);
  return { given, father, grandfather, family, gender };
}

/*
 * 🔴 MESSAGE 53 §2 ITEM 3 — «أسماء بدون أرقام»: THE «#NN» SUFFIX GOES.
 *
 * It read «شركة النور للصناعات #77» on every corporate customer card, including the ones in the
 * rehearsed path.
 *
 * ⛔ AND IT WAS NEVER LOAD-BEARING, MEASURED RATHER THAN ASSUMED. A company's identity in this
 * product is its COMMERCIAL REGISTRATION NUMBER: `customer.service.ts` pre-checks
 * `findCanonicalCollision` on `{ customerType: 'CORPORATE', registrationNumber }` and the
 * database constraint beneath it is keyed the same way. The legal NAME carries no corporate
 * uniqueness at all — its own comment says a name collision is answered by the create screen's
 * question rather than by a 409, and that half is about INDIVIDUALS. `registrationNumber` here
 * stays `REG-<timestamp>-<seq>`, so nothing that was unique has stopped being unique.
 *
 * ⚠️ SO TWO CUSTOMERS MAY NOW SHARE A NAME, and that is reported rather than hidden: the pool is
 * 12 prefixes × 10 suffixes = 120 combinations against about 112 corporate customers an office,
 * so a repeat is likely and looks exactly like what it is — two similarly-named companies, which
 * is what a real book holds. ⛔ A third word axis would be new Arabic, which is the owner's.
 */
function companyName(): string {
  return `${pick(COMPANY_PREFIXES)} ${pick(COMPANY_SUFFIXES)}`;
}

function randomQuestionnaire(): Record<string, boolean | number> {
  const yes = () => Math.random() < 0.55;
  return {
    ownsOrLeasesPremises: yes(),
    holdsPhysicalStock: yes(),
    revenueDependsOnPremises: yes(),
    operatesSpecialisedMachinery: yes(),
    employeeCount: randomInt(3, 300),
    publicVisitsPremises: yes(),
    manufacturesOrSuppliesProducts: yes(),
    providesProfessionalAdvice: yes(),
    operatesVehicleFleet: yes(),
    movesGoodsByTransport: yes(),
    handlesPersonalOrPaymentData: yes(),
    wantsStaffMedicalCover: yes(),
    wantsStaffLifeCover: yes(),
  };
}

// ---------------------------------------------------------------------------
// Actors (one login account per RBAC role, per Organization)
// ---------------------------------------------------------------------------

interface ActorRoleDef {
  key: ActorKey;
  /*
   * A PLAIN STRING, NOT `RoleName`, and that widening is the whole fix for the insurer 403s.
   *
   * `RoleName` is the LEGACY eleven-member enum from before office-scoped roles, and it cannot name
   * `OFFICE_ADMINISTRATOR` — the role that actually holds `insurer.create` and `insurer.deactivate`.
   * So while this field was typed `RoleName` the script could not create the actor those two routes
   * require, however the calls were written. `ensureRole` already takes a plain `string` for exactly
   * this reason; this is the same lesson one layer up.
   *
   * MEASURED before changing anything, because the two possible fixes are opposites:
   *
   *   POST /insurers              requires `insurer.create`      -> held by OFFICE_ADMINISTRATOR alone
   *   POST /insurers/:id/deactivate requires `insurer.deactivate`-> held by OFFICE_ADMINISTRATOR alone
   *   SYSTEM_SECURITY_ADMINISTRATOR holds insurer.company.link, insurer.company.unlink,
   *                               insurer.form.map, insurer.office-form.map — and neither of the above
   *
   * So the ROUTES ARE RIGHT. Registering a company and withdrawing it from dealing is office
   * administration, not security administration, and the grid says so. The script was using
   * `actors.admin` as a general-purpose administrator when the capability it needed belongs to a
   * different role. Granting the security administrator `insurer.create` would have made this seed
   * pass by widening a security role into the commercial register — and those codes sit OUTSIDE the
   * office administrator's strict-subset-at-migration set deliberately (`ADDED_AFTER_THE_MIGRATION`).
   */
  role: string;
  label: string;
}
type ActorKey =
  | 'sales'
  | 'placement'
  | 'policyCheck'
  | 'claims'
  | 'finance'
  | 'compliance'
  | 'manager'
  | 'admin'
  | 'officeAdmin';

/** The ONE definition of a demo actor's address. `ensureActor` creates the
 * account under it and `releaseActorsForHumanLogin` finds it again by it, so a
 * rename cannot leave the release hunting for accounts that no longer answer
 * to that name — which would strand them behind MFA, silently. */
function actorEmail(orgSlug: string, key: ActorKey): string {
  return `demo.${key}@${orgSlug}.ibms.internal`;
}

const ACTOR_ROLE_DEFS: ActorRoleDef[] = [
  {
    key: 'sales',
    role: RoleName.SALES_RELATIONSHIP_OFFICER,
    label: 'Sales Relationship Officer',
  },
  {
    key: 'placement',
    role: RoleName.PLACEMENT_TECHNICAL_OFFICER,
    label: 'Placement Technical Officer',
  },
  {
    key: 'policyCheck',
    role: RoleName.POLICY_CHECKING_OFFICER,
    label: 'Policy Checking Officer',
  },
  { key: 'claims', role: RoleName.CLAIMS_OFFICER, label: 'Claims Officer' },
  {
    key: 'finance',
    role: RoleName.FINANCE_COLLECTIONS_OFFICER,
    label: 'Finance & Collections Officer',
  },
  {
    key: 'compliance',
    role: RoleName.COMPLIANCE_OFFICER,
    label: 'Compliance Officer',
  },
  {
    key: 'manager',
    role: RoleName.BRANCH_DEPARTMENT_MANAGER,
    label: 'Branch / Department Manager',
  },
  {
    key: 'admin',
    role: RoleName.SYSTEM_SECURITY_ADMINISTRATOR,
    label: 'System Security Administrator',
  },
  /*
   * THE OFFICE ADMINISTRATOR, added 2026-10-16 because two steps of this script were 403ing.
   *
   * Not in `RoleName` — see the note on `ActorRoleDef.role`. It is named as a string, which is what
   * `ensureRole` has always taken, and `ensureActor` mirrors the role out of the default office, where
   * the main seed creates it.
   *
   * It holds `insurer.create` and `insurer.deactivate`, which are the two the duplicate-name proof and
   * the deactivation step need, so neither of those steps grants anybody anything new.
   */
  {
    key: 'officeAdmin',
    role: 'OFFICE_ADMINISTRATOR',
    label: 'Office Administrator',
  },
];

interface Actor {
  id: string;
  email: string;
  token: string;
  label: string;
  /** The four parts of THIS person's name — so the `Employee` row linked to this account is the
   *  same person rather than a second one. See `ensureActor`'s header. */
  nameParts: {
    given: string;
    father: string;
    grandfather: string;
    family: string;
  };
}
type Actors = Record<ActorKey, Actor>;

/** The TOTP secret out of the `otpauth://` URI the enrolment endpoint
 * returns — the same one-liner every e2e spec uses. */
function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error(`No secret in otpauth URI: ${uri}`);
  return match[1];
}

/**
 * Install a role into a demo office by MIRRORING the default office's row of the
 * same name — its display names, its security attributes, its `isSystem` flag,
 * and its permission grants.
 *
 * ## Why mirroring rather than a bare upsert
 *
 * This used to be a bare `role.upsert` that created the row with the machine
 * name in all three name fields and NO grants at all, relying on Phase 1's
 * migration having copied the grants across. That left a real drift: `seed.ts`
 * grants permissions to the DEFAULT organization's roles only, so every code
 * added after the demo office was created never reached it. It was measured, not
 * theorised — Office B's `SYSTEM_SECURITY_ADMINISTRATOR` was three codes behind
 * the grid (`employee.create`, `employee.update`, `role.update`), so the demo
 * office's administrator silently could not do things the default office's could.
 *
 * The default office is the right source because `preflight()` already refuses to
 * run without it, and because "the demo offices behave like the seeded one" is
 * exactly the property the demo exists to show.
 *
 * Grants are added, never removed: a role in a demo office that somehow holds
 * something extra keeps it rather than being silently narrowed mid-demo.
 */
async function ensureRoleMirroringDefaultOffice(
  orgId: string,
  roleName: string,
): Promise<{ id: string }> {
  const template = await rawPrisma.role.findUnique({
    where: {
      organizationId_name: { organizationId: ORG_A_ID, name: roleName },
    },
    include: { permissions: { select: { permissionId: true } } },
  });
  if (!template) {
    throw new Error(
      `Role "${roleName}" does not exist in the default organization, so there is nothing to mirror into ${orgId}. ` +
        'Run `npm run db:seed` against the DEV .env first.',
    );
  }

  // Office A IS the template, so mirroring it onto itself is a no-op by
  // definition — but going through the same path keeps one code path for both
  // offices rather than a branch that only one of them exercises.
  const role = await rawPrisma.role.upsert({
    where: { organizationId_name: { organizationId: orgId, name: roleName } },
    update: {
      nameAr: template.nameAr,
      nameEn: template.nameEn,
      description: template.description,
      requiresMfaAlways: template.requiresMfaAlways,
      requiresHardwareToken: template.requiresHardwareToken,
      isSystem: template.isSystem,
    },
    create: {
      organizationId: orgId,
      name: roleName,
      nameAr: template.nameAr,
      nameEn: template.nameEn,
      description: template.description,
      requiresMfaAlways: template.requiresMfaAlways,
      requiresHardwareToken: template.requiresHardwareToken,
      isSystem: template.isSystem,
    },
  });

  for (const { permissionId } of template.permissions) {
    // `organizationId` named explicitly: on the raw client the column default
    // is NULL, which the composite FK to `Role(id, organizationId)` rejects
    // rather than accepting an unattributed grant.
    await rawPrisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId } },
      update: {},
      create: { organizationId: orgId, roleId: role.id, permissionId },
    });
  }
  return role;
}

/**
 * The rule for a NEW office: it gets an `OFFICE_ADMINISTRATOR` and no business
 * roles at all — its administrator defines whatever the office needs.
 *
 * This script and `packages/db/prisma/seed.ts` are the only two writers that
 * create an Organization anywhere in the codebase (verified: no endpoint, no
 * service, no screen). So the rule cannot live in a provisioning service that
 * does not exist; it lives in both writers, and
 * `office-administrator.e2e-spec.ts` asserts that an Organization without a role
 * granting `user.manage` is a defect. Whenever real org provisioning lands, it
 * therefore cannot ship without one.
 *
 * The demo office also gets its eight business roles, because the demo's whole
 * point is two offices running the same pipelines. That is not a contradiction of
 * the rule: the rule is about what a new office gets BY DEFAULT, and this script
 * is explicitly building a populated demo.
 */
async function ensureOfficeAdministrator(orgId: string): Promise<void> {
  await ensureRoleMirroringDefaultOffice(orgId, 'OFFICE_ADMINISTRATOR');
}

/** Direct-Prisma account creation, exactly like `packages/db/prisma/seed.ts`'s
 * `ensureSampleUsers` and every e2e spec's cross-org fixtures: there is no
 * HTTP endpoint to create the FIRST account in an Organization once a second
 * Organization exists (`AuthService.signup` refuses once there is more than
 * one).
 *
 * Two flags decide whether this account can actually be used, and they pull in
 * OPPOSITE directions — which is why the account is reset here on every run
 * rather than created once and reused:
 *
 *   - `mustChangePassword` must be FALSE, or `AuthService.login` returns an
 *     onboarding token instead of a session (§4.3.1). The schema defaults it
 *     to true.
 *   - `mfaEnabled` must be FALSE **at login** — otherwise login returns an
 *     `mfaRequired` challenge rather than a session — and TRUE **for every
 *     request after it**, because `MfaRequiredGuard` is a global APP_GUARD
 *     that throws `MFA_REQUIRED` on `!user.mfaEnabled` for EVERY role, not
 *     just the three always-MFA ones.
 *
 * There is therefore no single value of `mfaEnabled` that works: the account
 * has to log in without MFA and then enrol over that session, which is exactly
 * what every e2e spec's `makeUser` does. On a re-run the actor already has
 * `mfaEnabled = true` from last time, so the reset below puts it back to the
 * only state login accepts, and the enrolment that follows raises it again.
 * Old `MfaCredential` rows are deleted rather than reused because their secret
 * is encrypted at rest and cannot be recovered here to generate a code from.
 */
/**
 * 🔴 ONE PERSON, ONE NAME — message 46 §2.4, and the mechanism is not what the brief says.
 *
 * ## What was actually measured, 2026-11-18
 *
 * The brief reports that the seed «writes a fresh random `fullName` on every run». It does not:
 * that write is inside the `if (!user)` branch below, and the update that follows re-hashes the
 * password and clears the MFA state without touching `fullName`. An actor's user row keeps the
 * name it was created with, across every re-run.
 *
 * The real defect is one layer over: **`seedEmployees` called `personName()` AGAIN** for each
 * Employee row and then linked that row to an actor through `userId`. So one account carried two
 * independently generated people — a three-part name on `User.fullName` and a different
 * four-part name on the linked `Employee`.
 *
 * ⚠️ AND THE SPLIT THE BRIEF POINTS AT IS A DECISION, NOT A DEFECT. `common/display-name.util.ts`
 * says in its own words that a register showing «who did this» resolves through the HR record
 * while an AUDIT ROW keeps the name as stored — *«rewriting them through a display rule would
 * make the trail disagree with the row it describes»* — and both halves are pinned by a test
 * with two committed plants. ⛔ So nothing in the product is touched here. The two names are made
 * to AGREE in the demo data, which is the seed's own bug and is where the brief's requirement
 * lands: *«the same name in every place a screen reads one»*.
 *
 * ⟶ `User.fullName` carries the FULL four-part composition, the same string `composeFullName`
 * builds server-side from the parts handed to `POST /employees`, so the two are byte-identical.
 *
 * Re-runs heal rather than drift: an account created by an earlier version holds a three-part
 * name, which is re-split and completed instead of being left disagreeing forever. No name part
 * in this script's pools contains a space (measured: 20/20/10/20 entries, zero), so splitting a
 * composed name back into its parts is unambiguous for data this script wrote.
 */
function namePartsFromStoredFullName(
  stored: string,
): ReturnType<typeof personName> | undefined {
  const parts = stored.trim().split(/\s+/);
  if (parts.length !== 4) return undefined;
  return {
    given: parts[0],
    father: parts[1],
    grandfather: parts[2],
    family: parts[3],
    gender: 'M',
  };
}

async function ensureActor(
  orgId: string,
  orgSlug: string,
  def: ActorRoleDef,
): Promise<{
  id: string;
  email: string;
  label: string;
  nameParts: ReturnType<typeof personName>;
}> {
  const email = actorEmail(orgSlug, def.key);
  let user = await rawPrisma.user.findFirst({
    where: { organizationId: orgId, email },
  });
  let nameParts: ReturnType<typeof personName> | undefined = user
    ? namePartsFromStoredFullName(user.fullName)
    : undefined;
  if (!user) {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
    nameParts = personName();
    user = await rawPrisma.user.create({
      data: {
        organizationId: orgId,
        // A person's name, not their job title. This used to read
        // `Demo ${def.label}` — so every demo account showed "Demo Sales
        // Relationship Officer" in the navbar, with initials to match, while
        // the linked Employee row held the real four-part Arabic name.
        //
        // ALL FOUR PARTS, so this is the same string `composeFullName` will build for the
        // Employee row linked to this account. Three parts here is what made one person two.
        fullName: `${nameParts.given} ${nameParts.father} ${nameParts.grandfather} ${nameParts.family}`,
        email,
        passwordHash,
        mustChangePassword: false,
        languagePreference: 'AR' as LanguagePreference,
      },
    });
  }
  if (!nameParts) {
    // An account from before this change: a three-part name, or one edited by hand. Give it a
    // whole person rather than leaving the two records disagreeing for the life of the database.
    nameParts = personName();
    user = await rawPrisma.user.update({
      where: { id: user.id },
      data: {
        fullName: `${nameParts.given} ${nameParts.father} ${nameParts.grandfather} ${nameParts.family}`,
      },
    });
  }

  // Idempotent reset — see this function's header. Also re-asserts
  // `mustChangePassword: false` in case an earlier run (or an administrator)
  // left the account owing a password change.
  //
  // AND re-hashes the password, which the create branch above cannot do for an account that
  // already exists. Accounts are looked up by a FIXED email and reused, so without this a run with
  // a different `DEMO_PASSWORD` would print credentials that do not work — the script would be
  // claiming something untrue about sixteen accounts, and the person reading the output has no way
  // to tell. Rehashing every run costs one bcrypt per actor and makes the printed password the
  // real one by construction.
  await rawPrisma.mfaCredential.deleteMany({ where: { userId: user.id } });
  user = await rawPrisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
      mfaEnabled: false,
      mustChangePassword: false,
      lockedUntil: null,
      failedLoginAttempts: 0,
    },
  });

  const role = await ensureRoleMirroringDefaultOffice(orgId, def.role);
  const existingGrant = await rawPrisma.userRoleAssignment.findFirst({
    where: { userId: user.id, roleId: role.id, revokedAt: null },
  });
  if (!existingGrant) {
    await rawPrisma.userRoleAssignment.create({
      data: { organizationId: orgId, userId: user.id, roleId: role.id },
    });
  }
  return { id: user.id, email, label: def.label, nameParts };
}

async function loginActor(
  app: INestApplication<App>,
  email: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: DEMO_PASSWORD });
  if (res.status !== 200) {
    throw new Error(
      `Login failed for ${email} -> ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  const body = res.body as {
    accessToken?: string;
    mfaRequired?: boolean;
    outcome?: string;
  };
  if (!body.accessToken) {
    throw new Error(
      `Login for ${email} returned no session (${JSON.stringify(body)}) — ` +
        `ensureActor's reset of mfaEnabled/mustChangePassword did not take effect.`,
    );
  }
  return body.accessToken;
}

/** Enrol TOTP over the session just issued, so the account clears the global
 * `MfaRequiredGuard` on every subsequent call. Both enrolment endpoints are
 * `@SkipMfaRequired()`, which is what makes this bootstrap possible at all —
 * they are the only two routes reachable by an enrolled-but-not-yet-verified
 * account. The session token issued BEFORE enrolment stays valid afterwards
 * (same as every e2e spec), so nothing needs to log in twice. */
async function enrolMfa(
  app: INestApplication<App>,
  token: string,
): Promise<void> {
  const enroll = await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(token));
  if (enroll.status < 200 || enroll.status >= 300) {
    throw new Error(
      `MFA enrol failed -> ${enroll.status}: ${JSON.stringify(enroll.body)}`,
    );
  }
  const { credentialId, otpAuthUri } = enroll.body as {
    credentialId: string;
    otpAuthUri: string;
  };
  const verify = await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(token))
    .send({
      credentialId,
      code: authenticator.generate(secretFromOtpAuthUri(otpAuthUri)),
    });
  if (verify.status < 200 || verify.status >= 300) {
    throw new Error(
      `MFA verify failed -> ${verify.status}: ${JSON.stringify(verify.body)}`,
    );
  }
}

/**
 * Hand the actor accounts back in a state a HUMAN can log into.
 *
 * The enrolment above exists only so the script's own HTTP calls clear
 * `MfaRequiredGuard`. Its TOTP secret is generated inside this process and
 * never shown to anyone, so leaving `mfaEnabled = true` at the end would put
 * every demo account behind a six-digit prompt that nobody alive can answer —
 * the accounts would be permanently locked out, which for a script whose whole
 * purpose is "log in and demo the screens" is the opposite of working.
 *
 * So MFA is switched back off and the credential deleted once the seeding is
 * done. That is the same state `packages/db/prisma/seed.ts` leaves its sample
 * users in, and it is a state the app has a real path out of: `/auth/me` and
 * both TOTP-enrolment endpoints are `@SkipMfaRequired()`, so a demo user logs
 * in with the password alone, lands on `/settings/security`, scans the QR and
 * enrols their own authenticator. Every other screen 403s until they do —
 * which is Part II §4.3.2's forced-enrolment rule doing its job, not a fault.
 *
 * Two things about HOW this runs are load-bearing, and both are here because
 * the first version got them wrong and handed back sixteen unusable accounts.
 *
 * It runs after the whole seed, never at the end of the happy path. An actor
 * is locked from the moment `enrolMfa` returns, so every line between there
 * and here is a window in which a throw strands eight real accounts — and
 * `seedOrganization`'s caller catches office-level failures and carries on,
 * so that damage would surface as one line about an office and never as "and
 * nobody can sign in any more".
 *
 * It finds the accounts by EMAIL rather than from the in-memory `Actors` map.
 * That map holds only the actors whose whole create-login-enrol attempt
 * succeeded, and `enrolMfa` is two HTTP calls: an actor that enrolled and then
 * failed to verify owns a credential the map never recorded. Keying on the
 * address the account is created under reaches those too, and reaches an
 * office whose seeding never started.
 */
async function releaseActorsForHumanLogin(): Promise<void> {
  for (const { orgId, orgSlug } of DEMO_ORGS) {
    const emails = ACTOR_ROLE_DEFS.map((def) => actorEmail(orgSlug, def.key));
    const users = await rawPrisma.user.findMany({
      where: { organizationId: orgId, email: { in: emails } },
      select: { id: true },
    });
    if (users.length === 0) continue;
    const ids = users.map((u) => u.id);
    await rawPrisma.mfaCredential.deleteMany({
      where: { userId: { in: ids } },
    });
    await rawPrisma.user.updateMany({
      where: { id: { in: ids } },
      data: { mfaEnabled: false, mustChangePassword: false },
    });
  }
}

/** The post-condition the release above never had: every demo actor that would
 * still meet a prompt it cannot answer. Checked at the end of every run and
 * treated as a failure, because the damage is otherwise silent — a run can
 * report "1,292 rows, 0 failures" and hand back sixteen accounts nobody can
 * sign into, which is exactly what happened once. */
async function findLockedDemoActors(): Promise<string[]> {
  const locked: string[] = [];
  for (const { orgId, orgSlug } of DEMO_ORGS) {
    const emails = ACTOR_ROLE_DEFS.map((def) => actorEmail(orgSlug, def.key));
    const users = await rawPrisma.user.findMany({
      where: { organizationId: orgId, email: { in: emails } },
      select: {
        id: true,
        email: true,
        mfaEnabled: true,
        mustChangePassword: true,
      },
    });
    const credentials = await rawPrisma.mfaCredential.findMany({
      where: { userId: { in: users.map((u) => u.id) } },
      select: { userId: true },
    });
    const credentialled = new Set(credentials.map((c) => c.userId));
    for (const user of users) {
      if (
        user.mfaEnabled ||
        user.mustChangePassword ||
        credentialled.has(user.id)
      ) {
        locked.push(user.email);
      }
    }
  }
  return locked;
}

async function ensureActors(
  app: INestApplication<App>,
  orgId: string,
  orgSlug: string,
  tally: Tally,
): Promise<Actors> {
  const actors = {} as Actors;
  for (const def of ACTOR_ROLE_DEFS) {
    // Create + login as ONE attempt: if either half fails, this actor is
    // simply absent from `actors` (logged, not fatal) rather than the whole
    // script crashing on an unhandled rejection from a bare `loginActor` call.
    const actor = await attempt(tally, 'actor', async () => {
      const created = await ensureActor(orgId, orgSlug, def);
      const token = await loginActor(app, created.email);
      // Without this every later call from this actor 403s MFA_REQUIRED.
      await enrolMfa(app, token);
      return {
        id: created.id,
        email: created.email,
        token,
        label: created.label,
        nameParts: created.nameParts,
      };
    });
    if (actor) actors[def.key] = actor;
  }
  return actors;
}

// ---------------------------------------------------------------------------
// Insurers (global InsurerMaster + one Insurer relationship per Organization)
// ---------------------------------------------------------------------------

interface OrgInsurer {
  id: string;
  /** NULL for a company this office registered itself — the case the insurer feature exists for.
   *  Widened from `string` when local insurers were added to the demo data. */
  insurerMasterId: string | null;
  name: string;
  lines: string[];
}

/** No HTTP endpoint creates Insurer/InsurerMaster (confirmed against
 * `organization`/`insurer-master` controllers) — every e2e fixture
 * (`test/insurer-fixture.ts`) writes them directly via Prisma. Masters are
 * global (Part I §5 — "one row per real company, shared across offices"),
 * so they are upserted once and then given one `Insurer` relationship row
 * PER Organization, exactly like `tenant-isolation.e2e-spec.ts`'s "an
 * insurer form mapped once serves every office" test. */
/**
 * Attaches the MANAGED lines an insurer writes, and the company-level facts the directory shows.
 *
 * Both were missing until now, and their absence was visible on screen: every insurer card read
 * "no lines recorded yet", and the cross-office directory had nothing to display but a name —
 * no structure, no switchboard, no mailbox. The line strings are resolved to catalogue ids
 * through `lineCodeForProgrammeLine`, so this script does not carry a second copy of "which
 * catalogue line is `Motor Fleet`".
 *
 * A line string with no mapping is SKIPPED and counted, never guessed: an insurer described
 * against a line the catalogue does not have would be invisible to the directory's line filter,
 * which is the one question that screen exists to answer.
 */
async function attachCompanyFactsAndLines(
  insurerId: string,
  orgId: string,
  lines: string[],
  tally: Tally,
): Promise<void> {
  const codes = lines
    .map((l) => ({ line: l, code: lineCodeForProgrammeLine(l) }))
    .filter((x) => {
      if (x.code === null) {
        tally.errors.push(
          `insurer line "${x.line}" has no catalogue code — skipped`,
        );
        return false;
      }
      return true;
    });
  const catalogue = await rawPrisma.insuranceLine.findMany({
    where: { code: { in: codes.map((c) => c.code as string) } },
    select: { id: true, code: true },
  });
  const idByCode = new Map(catalogue.map((l) => [l.code, l.id]));

  await rawPrisma.insurer.update({
    where: { id: insurerId },
    data: {
      // COMPANY-level only — these are the fields the directory is allowed to show. The
      // relationship-level terms (credit days, rating, named contacts) are set separately and
      // never cross an office boundary.
      structure: pick(['CONVENTIONAL', 'TAKAFUL', 'TAKAFUL_WINDOW'] as const),
      companyPhone: `+962 6 5${String(100000 + Math.floor(Math.random() * 899999)).slice(0, 6)}`,
      companyEmail: `info@${insurerId.slice(0, 8)}.demo.test`,
      companyWebsite: `${insurerId.slice(0, 8)}.demo.test`,
      companyCorrespondenceAddress: pick([
        'عمان - شارع الملكة رانيا',
        'عمان - العبدلي',
        'إربد - شارع الجامعة',
      ]),
    },
  });

  for (const { code } of codes) {
    const lineId = idByCode.get(code as string);
    if (!lineId) continue;
    const already = await rawPrisma.insurerOfferedLine.findFirst({
      where: { insurerId, insuranceLineId: lineId },
    });
    if (already) continue;
    await rawPrisma.insurerOfferedLine.create({
      data: { organizationId: orgId, insurerId, insuranceLineId: lineId },
    });
    bump(tally, 'created', 'insurerOfferedLine');
  }
}

/**
 * Stops the office dealing with ONE insurer that has live commitments behind it.
 *
 * Without this the deactivation screen is demonstrable but meaningless: an insurer with nothing
 * outstanding shows five zeroes, and the whole point of that screen is the two policy counts —
 * cover still running, versus work the INSURER still owes. Both need real rows.
 *
 * Chosen AFTER the pipeline, and chosen as an insurer that actually holds policies, because
 * deactivating an unused one proves nothing. Driven through the real endpoint rather than an
 * `isActive = false` write: that endpoint records the act with its impact counts in the audit
 * trail, and a direct write would produce a deactivated insurer with no record of who or why —
 * which is exactly the difference the feature is built around.
 */
/**
 * Proves the sentence `docs/first-run.md` puts in front of a person: register this spelling in this
 * office and the system refuses it.
 *
 * Asserted here rather than trusted because the refusal depends on a chain no reader can see — a
 * database-side `canonical_name_key()`, a STORED generated column, and a per-office unique index —
 * and any link in it could change without the instruction changing. A walkthrough step that has
 * quietly stopped being true is worse than a missing one: she would conclude the name matching does
 * not work, when what broke was the sentence.
 *
 * Runs in office A only, which is where the doc sends her.
 */
async function proveDuplicateSpellingIsRefused(
  app: INestApplication<App>,
  adminToken: string,
): Promise<void> {
  const res = await request(app.getHttpServer())
    .post('/insurers')
    .set(bearer(adminToken))
    .send({
      legalName: DUPLICATE_SPELLING_DEMO.attempt,
      legalNameAr: DUPLICATE_SPELLING_DEMO.attemptAr,
      // `structure`, `companyPhone` and `companyEmail` are REQUIRED by `RegisterInsurerDto` on
      // both registration paths. Sending only the two names — which is what the first version of
      // this function did — is a 400 from the ValidationPipe, and the collision check never runs:
      // the assertion then reports "the refusal did not come" about a request the endpoint never
      // considered. Found by running the seed, which is the only way it could have been found.
      structure: 'CONVENTIONAL',
      companyPhone: '+962 6 000 0000',
      companyEmail: 'duplicate.check@example.invalid',
    });

  if (res.status !== 409) {
    recordBrokenPromise(
      [
        `The walkthrough promises that registering ${JSON.stringify(DUPLICATE_SPELLING_DEMO.attempt)} in office A is refused`,
        `because ${JSON.stringify(DUPLICATE_SPELLING_DEMO.collidesWith)} is already registered there, but POST /insurers answered`,
        `${res.status}, not 409: ${JSON.stringify(res.body)}.`,
        'Either the canonical name key changed, or the office A seed no longer holds the colliding',
        'name, or this request never reached the collision check at all — a 400 means the payload',
        'itself was refused by the DTO.',
        'Fix the step in docs/first-run.md (§ the duplicate she is asked to try) before this seed is used for a demo.',
      ].join(' '),
    );
    return;
  }

  // A 409 is the right status for several distinct collisions on this endpoint, so check it is THIS
  // one: the message names the spelling that was attempted, and points at reactivation because an
  // insurer is never deleted and the existing row may be one the office deactivated. Both
  // properties are pinned independently by `insurer-crud.e2e-spec.ts`, so this stays a check on the
  // demo rather than a second copy of that test.
  const message = String((res.body as { message?: unknown }).message ?? '');
  const namesTheAttempt = message
    .toLowerCase()
    .includes(DUPLICATE_SPELLING_DEMO.attempt.toLowerCase());
  if (!namesTheAttempt || !message.includes('reactivate')) {
    recordBrokenPromise(
      [
        'POST /insurers refused with 409, but not recognisably for the name collision the walkthrough',
        `describes — the message neither quotes ${JSON.stringify(DUPLICATE_SPELLING_DEMO.attempt)} nor mentions reactivation:`,
        JSON.stringify(res.body),
      ].join(' '),
    );
    return;
  }
  console.log(
    `  - duplicate-spelling demo verified: ${JSON.stringify(DUPLICATE_SPELLING_DEMO.attempt)} -> 409`,
  );
}

/**
 * MODULE 0-ب ITEM (c) — give this office a licence term, so its pipelines are not refused.
 *
 * ## WHY THIS EXISTS, AND WHY IT IS NOT A WEAKENED GUARD
 *
 * All fifteen of office B's pipelines were refused by the art. 21/a/9 gate: an office with no licence
 * term on record may not place new business. **The guard is right and is untouched.** What was wrong
 * is that office B had no term, which is an ORDER problem rather than a design one:
 * `ensureBrokerLicenseTerms` in the main seed covers EVERY brokerage office
 * (`findMany({ type: 'BROKERAGE_OFFICE' })`) and is idempotent — but it runs during `db:seed`, when
 * office B does not exist yet, and `seed:demo` then created the office and never gave it one.
 *
 * ## WHY A TERM RATHER THAN A DOCUMENTED ABSENCE
 *
 * The alternative was to declare office B deliberately unlicensed so the owner meets the guard on
 * purpose. Rejected, for three measured reasons:
 *
 *   1. This script's own INTENT is fifteen pipelines in office B. Declaring the absence would mean
 *      rewriting what the seed is for, not documenting what it does.
 *   2. `docs/phase-2-walkthrough.md` routes entries 1-4 and 9 to office B precisely because office A's
 *      accounts are MFA-bound, and its literal values are written for office B. With no policies,
 *      invoices or claims there, those entries can be walked in neither office.
 *   3. The guard is already demonstrable without sacrificing an office: `/regulatory-compliance`
 *      renders the no-term state, and a reader who wants to meet the refusal can mark a term lapsed.
 *
 * ## THROUGH THE REAL ROUTE, AS THE COMPLIANCE OFFICER
 *
 * `POST /broker-license` requires `license.manage`, held by COMPLIANCE_OFFICER — an actor this script
 * already creates. So this grants nobody anything new either. Going over HTTP rather than writing the
 * row directly is this script's standing rule, and it matters here: the route is what attaches the
 * certificate `Document` and writes the audit row, and a direct insert would produce a licence with
 * no evidence behind it — the exact thing the NOT NULL certificate column exists to prevent.
 *
 * The placeholder is unmistakable, following the main seed's own convention: a `CBJ-DEMO-` number and
 * a certificate named so it cannot be read as a real filing. Three calendar years ending 31 December
 * (art. 10/b), derived from the current year so a later run cannot seed an already-expired term.
 */
/** Slug -> organization id, derived from `DEMO_ORGS` so the two cannot drift. This script's
 *  own `orgSlug` is NOT the database `subdomain` — office A's subdomain is `default`. */
const DEMO_ORG_ID_BY_SLUG: Record<string, string> = Object.fromEntries(
  DEMO_ORGS.map((o) => [o.orgSlug, o.orgId]),
);

/**
 * 🔴 OWNER DECISION 158 TABLE ك — THE DEMO OFFICES' LICENCE NUMBER SAYS IT IS A DEMO.
 *
 * Item 12 was left to this session's judgement («اختار الاحسن برأيك»), and the paper records
 * the reasoning: the number is PRINTED ON THE CERTIFICATE under the office name (decision 153
 * ruling 2), and the presenter may open that certificate in front of the brokers. A number
 * that says «تجريبي» is safer than one that looks like a real CBJ licence.
 *
 * ⛔ `packages/db/prisma/seed.ts` IS NOT TOUCHED. `CBJ-SEED-<subdomain>` is what a REAL
 * install's placeholder term carries, and changing it would put a demo word into every office
 * anybody ever creates. The demo seeder puts demo values on its own two offices, which is the
 * whole division her «ما لا يتغيّر» section draws.
 *
 * ⚠️ A SLUG NOT IN THIS MAP KEEPS THE OLD GENERATED NUMBER rather than taking a demo one by
 * default: the two demo offices are named, and a third office added later is not silently
 * stamped «تجريبي».
 */
const DEMO_LICENCE_NUMBER: Record<string, string> = {
  [ORG_A_SLUG]: 'تجريبي/001',
  [ORG_B_SLUG]: 'تجريبي/002',
};

/** Table ك's third row — the scope text, on both demo offices. */
const DEMO_LICENCE_SCOPE = 'وساطة تأمين عامّة (بيانات تجريبية)';

/**
 * 🔴 OWNER DECISION 158 TABLE ك ON AN OFFICE THAT ALREADY HAS A TERM — AND A RUN FOUND THIS.
 *
 * `ensureBrokerLicenseTermForOffice` returns early when the office already holds a term, which
 * is right: a second term would change which one `pickCurrentTerm` calls current. But office A
 * ALWAYS holds one by then — `db:seed`'s `ensureBrokerLicenseTerms` gives every brokerage
 * office a placeholder — so the early return meant the demo number was applied to office B and
 * NEVER to office A.
 *
 * ⚠️ MEASURED ON A REAL RUN FROM AN EMPTY DATABASE, not reasoned about: after the whole seeder
 * finished, office A's licence still read `CBJ-SEED-DEFAULT` and only office B carried
 * «تجريبي/002». Every static check passed — the paper's values ARE in the file, which is all a
 * source-reading test can see. This is message 46's own lesson arriving again: run the seeder
 * before believing it.
 *
 * ⟶ So the demo values are applied to the TERM THAT IS ALREADY THERE rather than by creating a
 *   second one. ⛔ Nothing else on the row is touched: not the dates, not the certificate, not
 *   the renewal fields that office B's expiry path writes.
 *
 * ⛔ AND ONLY FOR A SLUG IN THE MAP. An office this seeder did not create keeps whatever its
 * licence says.
 *
 * 🔴 IT ADDRESSES THE OFFICE BY ID, AND THE FIRST VERSION DID NOT — WHICH A SECOND RUN CAUGHT.
 *
 * `orgSlug` is THIS SCRIPT'S OWN name for an office (`office-a`, `office-b`); the database
 * `subdomain` is `default` and `demo-office-b`. A `where: { organization: { subdomain:
 * orgSlug } }` therefore matched NOTHING for either, and `updateMany` reports a count of zero
 * rather than failing — so the run stayed green and office A's licence still read
 * `CBJ-SEED-DEFAULT`. ⟶ Addressing by `organizationId` is the only shape where a wrong key
 * cannot look like a successful no-op; `DEMO_ORG_ID_BY_SLUG` is derived from `DEMO_ORGS` so the
 * two cannot drift.
 */
async function applyDemoLicenceValues(
  orgSlug: string,
  tally: Tally,
): Promise<void> {
  const licenseNumber = DEMO_LICENCE_NUMBER[orgSlug];
  const organizationId = DEMO_ORG_ID_BY_SLUG[orgSlug];
  if (licenseNumber === undefined || organizationId === undefined) return;
  const updated = await rawPrisma.brokerLicense.updateMany({
    where: { organizationId },
    data: { licenseNumber, scopeOfAuthorization: DEMO_LICENCE_SCOPE },
  });
  if (updated.count > 0) bump(tally, 'created', 'demoLicenceNumberApplied');
}

async function ensureBrokerLicenseTermForOffice(
  app: INestApplication<App>,
  orgSlug: string,
  complianceToken: string,
  tally: Tally,
): Promise<void> {
  const existing = await request(app.getHttpServer())
    .get('/broker-license')
    .set(bearer(complianceToken));
  if (existing.status === 200) {
    const body = existing.body as { terms?: unknown[] };
    // Idempotent, like the seeder it stands in for: a second run must not append a second term,
    // which would also change which term `pickCurrentTerm` calls current.
    if (Array.isArray(body.terms) && body.terms.length > 0) {
      await applyDemoLicenceValues(orgSlug, tally);
      return;
    }
  }

  const year = new Date().getUTCFullYear();
  try {
    await postAs(app, complianceToken, '/broker-license', {
      licenseNumber:
        DEMO_LICENCE_NUMBER[orgSlug] ??
        `CBJ-DEMO-${orgSlug.toUpperCase()}-${year}`,
      scopeOfAuthorization: DEMO_LICENCE_SCOPE,
      issuedAt: new Date(Date.UTC(year, 0, 1)).toISOString(),
      expiresAt: new Date(Date.UTC(year + 2, 11, 31)).toISOString(),
      certificateFileName: `not-a-real-cbj-document--demo-seed-${orgSlug}.pdf`,
      certificateStorageRef: `demo-seed/${orgSlug}/licence-certificate`,
    });
    bump(tally, 'created', 'brokerLicenseTerm');
  } catch (err) {
    tally.errors.push(
      `could not record a licence term for ${orgSlug}: ${(err as Error).message}. ` +
        'Every pipeline in this office will be refused by the art. 21/a/9 gate, which is the guard ' +
        'working — the missing term is the defect, not the refusal.',
    );
  }
}

/**
 * 🔴 OFFICE B'S LICENCE HAS EXPIRED, THE RENEWAL IS FILED AND PROVEN, AND NOBODY HAS DECLARED —
 * message 46 §2.2.
 *
 * ## The state this reaches, and why it is the interesting one
 *
 * `deriveRenewalUnderStudy` returns `AWAITING_DECLARATION` when four things hold: the term is past
 * its printed expiry, the renewal was filed on time (art. 11's 45 days), the filing proof and the
 * Central Bank's reference are both attached, and no deficiency notice or renewal refusal has
 * landed since. The ONLY thing missing is the standing declaration — and `license-renewal.declare`
 * is held by NO role, by OWNER DECISION 131.
 *
 * So every issuance in office B is refused with decision 136(ب)'s own sentence, which tells the
 * employee what is missing and who to see rather than «your licence expired». The presenter then
 * creates a role, grants the code in front of the brokers, assigns it and declares — and issuance
 * opens. ⛔ **No seeded role holds that code** (decision 151 ruling 6: «لا يُزرَع دور يحملها»);
 * the live grant IS the demonstration, and seeding it would delete the thing being shown.
 *
 * ## Why it runs AFTER office B is seeded, and why office A is untouched
 *
 * An office past expiry with no declaration issues nothing — so running this before the pipelines
 * would refuse every one of them and leave office B with no policies, no invoices and no claims.
 * That is the exact failure `ensureBrokerLicenseTermForOffice`'s own header records from the other
 * direction. Office A keeps a valid term so the rest of the demonstration is not blocked.
 *
 * ## What is written through Prisma, and why
 *
 * The EXPIRY is moved directly. There is no route that expires a licence and there should not be:
 * a term expires by the passage of time, not by anybody's act, and an endpoint that could expire
 * one on demand would be a way to disable an office. This script's documented rule applies — HTTP
 * where an endpoint exists, Prisma where none does, with the reason named.
 *
 * The FILING and its proof go through `POST /broker-license/renewal-requested`, the real route, on
 * the real `license.manage` permission. The proof `Document` is written through Prisma because no
 * endpoint creates a bare document either — the same reason every `Insurer` row here is.
 */
async function expireOfficeLicenceAwaitingDeclaration(
  app: INestApplication<App>,
  summary: OrgSeedSummary,
  tally: Tally,
): Promise<void> {
  const compliance = summary.actors.compliance;
  if (!compliance) {
    tally.errors.push(
      `[expiredLicence] ${summary.orgSlug} has no compliance actor, so its licence could not be ` +
        'put past expiry — the whole §2.2 demonstration is missing from this run.',
    );
    return;
  }

  /*
   * ⚠️ EVERY TERM MOVES, NOT JUST THE LATEST — the lesson `license-renewal-awaiting-declaration.
   * e2e-spec.ts` paid for.
   *
   * `pickCurrentTerm` chooses among ALL of an office's terms, so expiring one only promotes the
   * next. Measured 2026-11-18, dev holds exactly ONE term per office and db-test holds 51 for its
   * one office — so the single-term assumption is true here today and is not a property of the
   * schema. The whole series is SHIFTED by one interval, which keeps its relative order intact
   * and therefore keeps `pickCurrentTerm`'s answer predictable whatever the count.
   */
  const terms = await rawPrisma.brokerLicense.findMany({
    where: { organizationId: summary.orgId },
    orderBy: { expiresAt: 'desc' },
  });
  if (terms.length === 0) {
    tally.errors.push(
      `[expiredLicence] ${summary.orgSlug} has no licence term to expire.`,
    );
    return;
  }

  // Already in the state: a re-run must not try to file twice (the route is write-once and
  // answers 409), and must not move the expiry again.
  if (terms.some((t) => t.renewalProofDocumentId !== null)) {
    bump(tally, 'created', 'expiredLicenceAlreadyInPlace');
    return;
  }

  /*
   * 🔴 MESSAGE 53 §2 ITEM 6 — THE EXPIRY LANDS ON A 31 DECEMBER, AND THE ISSUE DATE MOVES WITH IT.
   *
   * This used to shift the expiry to «thirty days ago», which on the walk was 25/10/2026 — and
   * the licence screen then showed TWO yellow warnings reading «تاريخ الانتهاء المُدخل ليس
   * الحادي والثلاثين من كانون الأول…», on the screen the presenter's whole demonstration happens
   * on.
   *
   * ⟶ AND THEY WERE RIGHT. Art. 10/b: «يُمنح الترخيص لمدة ثلاث سنوات ميلادية تنتهي في الحادي
   *   والثلاثين من شهر كانون الأول», and `expiryMatchesThreeYearTerm` asks exactly whether
   *   `expiresAt === Date.UTC(issuedAt.year + 2, 11, 31)`. The term was CREATED satisfying that
   *   (1 January to 31 December two years on) and this function then moved ONE of the two dates.
   *   So the warning was not a cosmetic problem with the screen — it was a true statement about
   *   data this seed had made inconsistent.
   *
   * ⛔ SO BOTH DATES MOVE. The expiry goes to the most recent 31 December strictly in the past
   * and the issue date to the 1 January three calendar years before it, which is the relation
   * art. 10/b states. The licence still reads «منتهي», the filing is still inside art. 11's
   * window, and the declaration still lifts the block — all three measured by
   * `licence-demo-dates.spec.ts`.
   *
   * ⚠️ AND THE WHOLE SERIES STILL SHIFTS BY ONE INTERVAL, which is the lesson
   * `license-renewal-awaiting-declaration.e2e-spec.ts` paid for: `pickCurrentTerm` chooses among
   * ALL of an office's terms, so moving one only promotes the next. Each term's issue date is
   * re-derived from its OWN new expiry, so a many-term series keeps both its order and art. 10/b.
   */
  /*
   * The most recent 31 December STRICTLY in the past, which is always last year's: this year's
   * has either not arrived or is today, and today is not past. Written as one expression rather
   * than a ternary over the two cases, because both answers are the same and a ternary that
   * returns one value twice reads as though it had found a distinction.
   */
  const targetExpiry = new Date(
    Date.UTC(new Date().getUTCFullYear() - 1, 11, 31),
  );
  const shiftMs = terms[0].expiresAt.getTime() - targetExpiry.getTime();
  if (shiftMs <= 0) {
    // Already past expiry with nothing filed — leave the dates alone and just file.
    bump(tally, 'created', 'expiredLicenceAlreadyPastExpiry');
  } else {
    for (const t of terms) {
      const expiresAt = new Date(t.expiresAt.getTime() - shiftMs);
      await rawPrisma.brokerLicense.update({
        where: { id: t.id },
        data: {
          expiresAt,
          // Art. 10/b, re-derived from this term's own new expiry rather than shifted by the
          // same milliseconds — a shifted 1 January is not a 1 January.
          issuedAt: new Date(Date.UTC(expiresAt.getUTCFullYear() - 2, 0, 1)),
        },
      });
    }
  }

  // Art. 11 measures its 45 days from THIS term's expiry, so the filing date comes off the
  // shifted expiry rather than off today — 60 days before it, which is on time under any legal
  // figure up to 60.
  const currentExpiry = new Date(
    Math.max(
      ...terms.map((t) =>
        shiftMs > 0 ? t.expiresAt.getTime() - shiftMs : t.expiresAt.getTime(),
      ),
    ),
  );
  const filedAt = new Date(currentExpiry.getTime() - 60 * 24 * 60 * 60 * 1000);

  const proof = await rawPrisma.document.create({
    data: {
      organizationId: summary.orgId,
      /*
       * CORRESPONDENCE, not REGULATORY_DECISION. The proof is the stamped copy of OUR application
       * or the Central Bank's acknowledgement of receiving it — a receipt, not a decision. That
       * enum member's own comment reserves it for «a regulator's own DECISION LETTER», and filing
       * an acknowledgement under it would make «show me the decisions about this office» return a
       * document in which the regulator decided nothing.
       */
      category: 'CORRESPONDENCE',
      classification: 'INTERNAL',
      fileName: `not-a-real-cbj-document--renewal-filing-proof-${summary.orgSlug}.pdf`,
      storageRef: `demo-seed/${summary.orgSlug}/renewal-filing-proof`,
      uploadedByUserId: compliance.id,
    },
  });

  const filed = await attempt(tally, 'licenceRenewalFiled', () =>
    postAs(app, compliance.token, '/broker-license/renewal-requested', {
      requestedAt: filedAt.toISOString().slice(0, 10),
      proofDocumentId: proof.id,
      referenceNumber: `CBJ-IN-${summary.orgSlug.toUpperCase()}-${filedAt.getUTCFullYear()}-0417`,
    }),
  );
  if (!filed) {
    tally.errors.push(
      `[expiredLicence] ${summary.orgSlug}: the term is past expiry but the renewal filing was ` +
        'not recorded, so the office reads EXPIRED rather than awaiting its declaration — which ' +
        'is a different screen and a different sentence.',
    );
    return;
  }

  /*
   * ⛔ AND NOTHING DECLARES. `POST /broker-license/renewal-declaration` exists, is enforced on
   * `license-renewal.declare`, and is deliberately not called: calling it here would finish the
   * demonstration before the presenter starts it.
   */
  bump(tally, 'created', 'expiredLicenceAwaitingDeclaration');
}

async function deactivateOneInsurerWithCommitments(
  app: INestApplication<App>,
  orgId: string,
  adminToken: string,
  tally: Tally,
): Promise<string | null> {
  const withPolicies = await rawPrisma.policy.groupBy({
    by: ['insurerId'],
    where: { organizationId: orgId },
    _count: { _all: true },
    orderBy: { _count: { id: 'desc' } },
    take: 1,
  });
  const insurerId = withPolicies[0]?.insurerId;
  if (!insurerId) {
    tally.errors.push(
      'no insurer in this office holds a policy — nothing deactivated, so the impact counts would all read zero',
    );
    return null;
  }
  const already = await rawPrisma.insurer.findUnique({
    where: { id: insurerId },
    select: { isActive: true },
  });
  if (already?.isActive === false) return insurerId;

  try {
    await postAs(app, adminToken, `/insurers/${insurerId}/deactivate`, {
      reason: 'إيقاف تجريبي للتعامل — لبيان أثر الإيقاف على الالتزامات القائمة',
    });
    bump(tally, 'created', 'insurerDeactivation');
    return insurerId;
  } catch (err) {
    tally.errors.push(
      `could not deactivate insurer ${insurerId}: ${(err as Error).message}`,
    );
    return null;
  }
}

async function ensureInsurersForOrg(
  orgId: string,
  tally: Tally,
): Promise<OrgInsurer[]> {
  const out: OrgInsurer[] = [];
  for (const seed of INSURER_SEEDS) {
    const master = await rawPrisma.insurerMaster.upsert({
      where: { legalName: seed.legalName },
      update: {},
      create: {
        legalName: seed.legalName,
        legalNameAr: seed.legalNameAr,
        linesOffered: seed.lines,
      },
    });
    let relationship = await rawPrisma.insurer.findFirst({
      where: { organizationId: orgId, insurerMasterId: master.id },
    });
    if (!relationship) {
      relationship = await rawPrisma.insurer.create({
        data: {
          organizationId: orgId,
          insurerMasterId: master.id,
          rfqContactName: 'قسم الاكتتاب',
          rfqContactEmail: `underwriting@${master.id.slice(0, 8)}.demo.test`,
          claimsContactEmail: `claims@${master.id.slice(0, 8)}.demo.test`,
          underwriterContact: 'قسم الاكتتاب',
          creditTermsDays: pick([30, 45, 60]),
        },
      });
    }
    await attachCompanyFactsAndLines(relationship.id, orgId, seed.lines, tally);
    out.push({
      id: relationship.id,
      insurerMasterId: master.id,
      name: seed.legalName,
      lines: seed.lines,
    });
  }

  // Companies this office registered ITSELF — no catalogue row. The case the feature exists for,
  // and the only way the "registered locally" badge and the local-name path appear on screen.
  const localSeeds = LOCAL_INSURER_SEEDS[orgId === ORG_A_ID ? 'a' : 'b'];
  for (const seed of localSeeds) {
    let local = await rawPrisma.insurer.findFirst({
      where: { organizationId: orgId, legalName: seed.legalName },
    });
    if (!local) {
      local = await rawPrisma.insurer.create({
        data: {
          organizationId: orgId,
          // NULL master link, named explicitly rather than omitted: the column is nullable now and
          // a seed that relied on the default would stop proving anything the day one appeared.
          insurerMasterId: null,
          legalName: seed.legalName,
          legalNameAr: seed.legalNameAr,
          rfqContactName: 'قسم الاكتتاب',
          creditTermsDays: pick([30, 45, 60]),
        },
      });
      bump(tally, 'created', 'insurerLocal');
    }
    await attachCompanyFactsAndLines(local.id, orgId, seed.lines, tally);
    out.push({
      id: local.id,
      insurerMasterId: null,
      name: seed.legalName,
      lines: seed.lines,
    });
  }

  /**
   * Deactivated insurers are dropped from the list the PIPELINES use, and only from that list.
   *
   * This run deactivates one insurer on purpose, at the end, so the deactivation screen has real
   * impact counts. The next run then picked that same company for an RFQ shortlist and `POST /rfqs`
   * refused it — correctly, with a 422 naming the company. Measured: three such failures in one
   * run, all the same insurer, and they will recur on every run after a deactivation.
   *
   * The refusal is right and the seed was wrong to ask. The rows stay in the database and on the
   * screens, which is the point of showing a deactivated insurer in the list at all — they are just
   * not offered to code that is about to place NEW business with them.
   */
  const activeIds = new Set(
    (
      await rawPrisma.insurer.findMany({
        where: {
          organizationId: orgId,
          id: { in: out.map((i) => i.id) },
          isActive: true,
        },
        select: { id: true },
      })
    ).map((i) => i.id),
  );
  const placeable = out.filter((i) => activeIds.has(i.id));
  if (placeable.length < out.length) {
    console.log(
      `  - ${out.length - placeable.length} deactivated insurer(s) held back from placement (still registered, still on the screens)`,
    );
  }
  return placeable;
}

/** `CommissionAgreement` also has no HTTP create endpoint exercised anywhere
 * in the e2e suite either — `tenant-isolation.e2e-spec.ts`'s own "two
 * offices' commercial terms" test writes it directly via Prisma with this
 * exact field shape, which this mirrors. Non-blocking: invoices work
 * (commission simply computes to a smaller/zero deduction) even if this
 * fails, so failures here are logged but never abort the run. */
async function ensureCommissionAgreements(
  orgId: string,
  insurers: OrgInsurer[],
  tally: Tally,
): Promise<void> {
  for (const insurer of insurers) {
    // The lines an insurer offers can be two DIFFERENT strings resolving to ONE catalogue line —
    // "Property All Risks" and "Property All Risks (Fire)" are the real pair that motivated the
    // variant axis. Only one open agreement may exist per (insurer, line, variant), so the second
    // is skipped deliberately rather than attempted and failed.
    const claimedLineIds = new Set<string>();
    for (const line of insurer.lines) {
      await attempt(tally, 'commissionAgreement', async () => {
        // Resolve the managed line, because the live constraint is keyed on the FK and NOT on the
        // free-text column beside it: UNIQUE (insurerId, insuranceLineId, variantKey) NULLS NOT
        // DISTINCT WHERE effectiveTo IS NULL. Writing NULL there — which this function did until it
        // was actually RUN — means every agreement for one insurer is the tuple (insurer, NULL,
        // NULL), so the FIRST line got an agreement and every later one failed the constraint.
        // Measured on the dev database: two such failures in one run, silent in a green exit.
        // This is § 1.40's lesson landing on one more writer: the column was added, the rows were
        // backfilled, and this writer was never changed.
        const code = lineCodeForProgrammeLine(line);
        const managed = code
          ? await rawPrisma.insuranceLine.findUnique({
              where: { code },
              select: { id: true },
            })
          : null;

        if (managed && claimedLineIds.has(managed.id)) {
          // Not an error: the invariant is correct and this is the second string for a line that
          // already has an open agreement. Saying so beats a constraint violation in the tally.
          console.log(
            `  - skipping a second open agreement for ${insurer.id} on "${line}" — the same managed line is already covered`,
          );
          return null;
        }

        // Matched on EITHER key, because this table now has two live partial unique indexes and a
        // row can be caught by the one the lookup did not check:
        //   (insurerId, insuranceLine)                        WHERE effectiveTo IS NULL
        //   (insurerId, insuranceLineId, variantKey) NULLS NOT DISTINCT, same predicate
        // A row written before the FK existed carries the STRING and a NULL FK. Looking it up by
        // FK alone misses it, the create then collides on the string index, and the failure reads
        // as a duplicate when the real problem is that the lookup and the constraints disagree.
        const existing = await rawPrisma.commissionAgreement.findFirst({
          where: {
            organizationId: orgId,
            insurerId: insurer.id,
            effectiveTo: null,
            OR: managed
              ? [{ insuranceLineId: managed.id }, { insuranceLine: line }]
              : [{ insuranceLine: line }],
          },
        });
        if (existing) {
          if (managed) claimedLineIds.add(managed.id);
          // Backfill rather than leave it: this is the writer, and a row it can see with a
          // resolvable line and a NULL FK is exactly the decay § 1.40 is about. The money crossing
          // (policy -> governing rate) matches on the FK, so a NULL here is a rate that cannot be
          // found by the code that pays the broker.
          if (managed && existing.insuranceLineId === null) {
            return rawPrisma.commissionAgreement.update({
              where: { id: existing.id },
              data: { insuranceLineId: managed.id },
            });
          }
          return existing;
        }

        const created = await rawPrisma.commissionAgreement.create({
          data: {
            organizationId: orgId,
            insurerId: insurer.id,
            insuranceLine: line,
            insuranceLineId: managed?.id ?? null,
            ratePercent: money(randomInt(10, 20)).replace(/\.000$/, '.00'),
            vatRatePercent: '16.00',
            effectiveFrom: new Date(isoDateDaysAgo(365)),
          },
        });
        if (managed) claimedLineIds.add(managed.id);
        return created;
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

async function seedEmployees(
  app: INestApplication<App>,
  actors: Actors,
  count: number,
  tally: Tally,
): Promise<void> {
  if (!actors.admin) return;
  // Only actors NOT already tied to an Employee row. `POST /employees` 409s on
  // a second link for the same account, and on a re-run every actor is still
  // linked from the previous one — which made the "safe to re-run" claim in
  // this file's header false for exactly this step. The check is a query, not
  // a flag: an Employee may also have been linked by hand between runs.
  const alreadyLinked = new Set(
    (
      await rawPrisma.user.findMany({
        where: {
          id: { in: Object.values(actors).map((a) => a.id) },
          employeeId: { not: null },
        },
        select: { id: true },
      })
    ).map((u) => u.id),
  );
  const linkableActors = Object.values(actors).filter(
    (a) => !alreadyLinked.has(a.id),
  );
  for (let i = 0; i < count; i += 1) {
    await attempt(tally, 'employee', async () => {
      const linkUser =
        i < linkableActors.length ? linkableActors[i] : undefined;
      /*
       * 🔴 ONE PERSON, ONE NAME — message 46 §2.4.
       *
       * This used to call `personName()` unconditionally, so an Employee row LINKED to an actor
       * carried a completely different randomly generated person from the one on `User.fullName`.
       * The account then read as two people: the HR record named one, the audit trail — which
       * keeps the stored `User.fullName` BY DECISION, see `common/display-name.util.ts` — named
       * the other.
       *
       * ⛔ The product rule is untouched. The two names simply AGREE now, which is the seed's
       * own bug to fix and not the resolver's.
       *
       * An UNLINKED employee is still a fresh person: there is no account for them to disagree
       * with, and an office of nine people all named after its nine logins would be worse data.
       */
      const name = linkUser ? linkUser.nameParts : personName();
      return postAs(app, actors.admin.token, '/employees', {
        givenName: name.given,
        fatherName: name.father,
        grandfatherName: name.grandfather,
        familyName: name.family,
        nationalId: jordanianNationalId(),
        position: pick([
          'مسؤول حسابات العملاء',
          'مساعد اكتتاب',
          'موظف مطالبات',
          'محلّل التزام',
          'إداري مكتب',
          'مدير فرع',
        ]),
        hireDate: isoDateDaysAgo(randomInt(60, 2000)),
        /*
         * MODULE 0 ITEM (g). This used to read 'CBJ Licensed Insurance Broker', and the api now
         * REFUSES CBJ-ish text here with a 400 — so ~40% of seeded employees would have failed.
         * The CBJ approval is a STRUCTURED marker now; `licensedRole` is for other certifications,
         * which is what this line seeds.
         */
        licensedRole:
          Math.random() < 0.4
            ? pick([
                'دبلوم مهني في التأمين',
                'شهادة مهنية متقدّمة في التأمين',
                'شهادة مهنية في التأمين',
              ])
            : undefined,
        userId: linkUser?.id,
      });
    });
  }

  await seedCbjApprovals(app, actors, tally);
}

/**
 * MODULE 0 ITEMS (g) AND (f) — give the demo office enough CBJ-approved people to be licensed for
 * both insurance types.
 *
 * Not decoration: item (f) refuses the second insurance type unless at least two people hold a
 * CURRENT approval, so a demo office with none cannot exercise the licence-scope screen at all. Two
 * is the minimum that makes the feature reachable; seeding every employee would make the refusal
 * unreachable instead, and a demo where no rule ever fires teaches nothing.
 *
 * Through the real routes, like everything else in this script — the refusals and the audit rows are
 * part of what is being demonstrated.
 */
async function seedCbjApprovals(
  app: INestApplication<App>,
  actors: Actors,
  tally: Tally,
): Promise<void> {
  if (!actors.admin) return;
  const candidates = await rawPrisma.employee.findMany({
    where: { terminationDate: null, cbjApprovalStatus: null },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
    take: 3,
  });
  const lines = await rawPrisma.insuranceLine.findMany({
    where: { category: { in: ['GENERAL', 'LIFE'] } },
    select: { id: true, category: true },
    orderBy: { displayOrder: 'asc' },
  });
  const general = lines.find((l) => l.category === 'GENERAL');
  const life = lines.find((l) => l.category === 'LIFE');

  for (const [index, employee] of candidates.entries()) {
    await attempt(tally, 'cbjApproval', async () => {
      await patchAs(
        app,
        actors.admin.token,
        `/employees/${employee.id}/cbj-approval`,
        {
          status: 'CURRENT',
          approvalDate: isoDateDaysAgo(randomInt(200, 1500)),
        },
      );
      // One general branch each, and a life branch for the second person — so the office is staffed
      // for both types and the derived-type display has something to show.
      const line = index === 1 ? (life ?? general) : general;
      if (line) {
        await postAs(
          app,
          actors.admin.token,
          `/employees/${employee.id}/cbj-approval/branches`,
          {
            insuranceLineId: line.id,
          },
        );
      }
      return { id: employee.id };
    });
  }
}

// ---------------------------------------------------------------------------
// Leads -> Prospects -> Customers
// ---------------------------------------------------------------------------

interface SeededCustomer {
  id: string;
  legalName: string;
}

async function createLead(
  app: INestApplication<App>,
  actors: Actors,
): Promise<{ id: string }> {
  const name = personName();
  return postAs(app, actors.sales.token, '/leads', {
    fullName: `${name.given} ${name.father} ${name.family}`,
    source: pick(LEAD_SOURCES),
    contactPhone: jordanianPhone(),
    contactEmail: uniqueEmail('lead'),
    marketingConsentGranted: true,
    consentTextVersion: 'privacy-notice-v1.0',
  });
}

async function createCorporateCustomer(
  app: INestApplication<App>,
  actors: Actors,
  prospectId?: string,
): Promise<SeededCustomer> {
  const legalName = companyName();
  const body: Record<string, unknown> = {
    customerType: 'CORPORATE' as CustomerType,
    legalName,
    registrationNumber: `REG-${Date.now()}-${nextSeq()}`,
    registeredAddress: pick(CITIES),
    natureOfBusiness: pick(SECTORS),
    contactPhone: jordanianPhone(),
    contactEmail: uniqueEmail('corp-customer'),
    languagePreference: pick(['AR', 'EN']) as LanguagePreference,
  };
  if (prospectId) body.prospectId = prospectId;
  const created = await postAs<{ id: string }>(
    app,
    actors.sales.token,
    '/customers',
    body,
  );
  return { id: created.id, legalName };
}

async function createIndividualCustomer(
  app: INestApplication<App>,
  actors: Actors,
  prospectId?: string,
): Promise<SeededCustomer> {
  const name = personName();
  const fullName = `${name.given} ${name.father} ${name.grandfather} ${name.family}`;
  const body: Record<string, unknown> = {
    customerType: 'INDIVIDUAL' as CustomerType,
    givenName: name.given,
    fatherName: name.father,
    grandfatherName: name.grandfather,
    familyName: name.family,
    nationalId: jordanianNationalId(),
    dateOfBirth: isoDateDaysAgo(randomInt(8000, 20000)),
    // ISO 3166-1 alpha-2, upper case, and nothing else — see
    // screening-identity.dto-parts.ts's IsNationality().
    nationality: 'JO',
    contactPhone: jordanianPhone(),
    contactEmail: uniqueEmail('individual-customer'),
    languagePreference: pick(['AR', 'EN']) as LanguagePreference,
  };
  if (prospectId) body.prospectId = prospectId;
  const created = await postAs<{ id: string }>(
    app,
    actors.sales.token,
    '/customers',
    body,
  );
  return { id: created.id, legalName: fullName };
}

/** Runs a Lead through as much of the funnel as `stage` names, using the
 * SAME sales officer throughout — Lead/Prospect ownership checks collapse to
 * 404 for any other officer, so a seed script must not switch actors
 * mid-chain (see lead.controller.ts / prospect.controller.ts). */
async function seedLeadFunnel(
  app: INestApplication<App>,
  actors: Actors,
  stage: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CONVERTED',
  tally: Tally,
): Promise<SeededCustomer | undefined> {
  const lead = await attempt(tally, 'lead', () => createLead(app, actors));
  if (!lead) return undefined;
  if (stage === 'NEW') return undefined;

  await attempt(tally, 'leadTransition', () =>
    postAs(app, actors.sales.token, `/leads/${lead.id}/transition`, {
      toStatus: 'CONTACTED',
    }),
  );
  if (stage === 'CONTACTED') return undefined;

  await attempt(tally, 'leadTransition', () =>
    postAs(app, actors.sales.token, `/leads/${lead.id}/transition`, {
      toStatus: 'QUALIFIED',
    }),
  );
  if (stage === 'QUALIFIED') return undefined;

  const prospect = await attempt(tally, 'prospect', () =>
    postAs<{ id: string }>(app, actors.sales.token, '/prospects', {
      leadId: lead.id,
      companyName: companyName(),
      sector: pick(SECTORS),
      activity: pick(SECTORS),
      employeeCount: randomInt(3, 250),
      businessSize: pick(['صغيرة', 'متوسطة', 'كبيرة']),
      location: pick(CITIES),
      contactPerson: `${pick(GIVEN_NAMES_M)} ${pick(FAMILY_NAMES)}`,
      productsOfInterest: pickN(
        ['Property', 'Motor Fleet', 'Group Medical', 'Marine', 'Liability'],
        2,
      ),
      expectedPremium: money(randomInt(5_000, 80_000)),
    }),
  );
  if (!prospect) return undefined;

  return attempt(tally, 'customer', () =>
    Math.random() < 0.5
      ? createCorporateCustomer(app, actors, prospect.id)
      : createIndividualCustomer(app, actors, prospect.id),
  );
}

// ---------------------------------------------------------------------------
// Full sales -> active-policy pipeline
// ---------------------------------------------------------------------------

interface PipelineResult {
  customerId: string;
  policyId: string;
  policyNumber: string;
  premium: number;
  /** So a claim can pick a loss date that actually falls inside cover. */
  inceptionDaysAgo: number;
  /** 🔴 MESSAGE 53 §2 ITEM 7 — so a claim's CAUSE OF LOSS can match the cover it is made on.
   *  See `causeOfLossFor`. */
  insuranceLine: string;
}

/**
 * 🔴 A CHAIN THAT STOPPED BECAUSE IT WAS TOLD TO — message 46 §2.1.
 *
 * ⚠️ Distinguished from one that stopped because it FAILED, and that distinction is the whole
 * reason this type exists. The existing loop prints `(stopped early, see errors)` for a failure,
 * and in the DATA the two look identical: a customer with an approved needs assessment and no
 * programme is the same row either way. A presenter who cannot tell them apart cannot use either.
 *
 * So a halt is RETURNED rather than inferred, the run's report names the customer sitting at each
 * stage, and the run asserts it produced the plan it declared.
 */
interface HaltedChain {
  halted: HaltedStage;
  customerId: string;
  customerLabel: string;
  /** Only `rfqIssuedAwaitingEvidence` fills these — what the presenter opens. */
  rfqId?: string;
  insurerCount?: number;
  evidenceWaiting?: boolean;
  /** Only `policyAwaitingCheck` fills these — the policy sitting in the checking queue, named so
   *  the report can tell `demo.policy_check` which one to open. */
  policyId?: string;
  policyNumber?: string;
}

function isHalted(
  r: PipelineResult | HaltedChain | undefined,
): r is HaltedChain {
  return r !== undefined && 'halted' in r;
}

/** The Risk Profile / Policy schedule figures — built once per pipeline run
 * and reused for BOTH the issued schedule and the checking step's requested
 * coverage, so they match exactly (a mismatch drives the policy into
 * DISCREPANCY, which is a realistic state to show but not the default one
 * this script aims for). */
function buildCoverageFigures(): {
  limits: Record<string, string>;
  sumsInsured: Record<string, string>;
} {
  const amount = randomInt(50_000, 750_000);
  /*
   * 🔴 OWNER DECISION 158 TABLE ي — THE THREE KEYS ARE ARABIC IN DEMO DATA.
   *
   * These are FREE-FORM JSON KEYS an employee types, which message 51 §3 pinned in the
   * NOT-MAPPED direction: there is no vocabulary to map them to and a value with no label
   * renders AS STORED (decision 49). So the English a broker read on the schedule summary was
   * never a missing translation — it was THIS SEED's own word, and her table settles it.
   *
   * ⛔ The renderers are untouched: they still print whatever key the data carries, which is
   * what makes an office's own key work the day one is typed.
   *
   * ⚠️ The local was called `total` too, which would have shadowed nothing but read as though
   * the key and the amount were one thing; it is `amount` now.
   */
  return {
    limits: {
      'لكل حادث': money(amount),
      'الإجمالي السنوي': money(amount * 2),
    },
    sumsInsured: { الإجمالي: money(amount) },
  };
}

async function runFullPipeline(
  app: INestApplication<App>,
  actors: Actors,
  orgSlug: string,
  insurers: OrgInsurer[],
  customerId: string,
  tally: Tally,
  /**
   * Stop here ON PURPOSE and return a `HaltedChain`. Omit for a chain that runs to an issued,
   * checked, delivered policy — which is what every chain did before message 46 §2.1.
   */
  stopAfter?: HaltedStage,
  /** The customer's own name, so the run's report can tell the presenter where to look. */
  customerLabel = '',
): Promise<PipelineResult | HaltedChain | undefined> {
  const halt = (stage: HaltedStage, extra: Partial<HaltedChain> = {}) => {
    bump(tally, 'created', `halted:${stage}`);
    return { halted: stage, customerId, customerLabel, ...extra };
  };
  const riskProfile = await attempt(tally, 'riskProfile', () =>
    postAs<{ id: string }>(app, actors.sales.token, '/risk-profiles', {
      customerId,
      siteLabel: 'المقرّ الرئيسي',
      priorClaimsHistorySummary: 'لا مطالبات سابقة في السنوات الثلاث الماضية.',
    }),
  );
  if (!riskProfile) return undefined;

  const needsAssessment = await attempt(tally, 'needsAssessment', () =>
    postAs<{ id: string }>(app, actors.sales.token, '/needs-assessments', {
      riskProfileId: riskProfile.id,
      questionnaireAnswers: randomQuestionnaire(),
    }),
  );
  if (!needsAssessment) return undefined;

  const naOk = await attempt(tally, 'needsAssessmentApproval', async () => {
    await postAs(
      app,
      actors.sales.token,
      `/needs-assessments/${needsAssessment.id}/submit`,
      {},
    );
    await postAs(
      app,
      actors.manager.token,
      `/needs-assessments/${needsAssessment.id}/review`,
      {},
    );
    await postAs(
      app,
      actors.manager.token,
      `/needs-assessments/${needsAssessment.id}/approve`,
      {},
    );
    return true;
  });
  if (!naOk) return undefined;

  // STAGE 1 — an APPROVED needs assessment that no programme was built from.
  if (stopAfter === 'needsAssessmentApproved') {
    return halt('needsAssessmentApproved');
  }

  const program = await attempt(tally, 'insuranceProgram', () =>
    postAs<{ id: string; lines: { insuranceLine: string }[] }>(
      app,
      actors.placement.token,
      '/insurance-programs',
      { needsAssessmentId: needsAssessment.id },
    ),
  );
  if (!program) return undefined;

  // Which lines this programme actually designed. Derived from the needs
  // assessment's answers, which are randomised per customer, so this differs
  // run to run and customer to customer.
  const designedLines = new Set(
    (program.lines ?? []).map((l) => l.insuranceLine),
  );

  const programFinalized = await attempt(
    tally,
    'insuranceProgramFinalize',
    () =>
      postAs(
        app,
        actors.placement.token,
        `/insurance-programs/${program.id}/finalize`,
        {},
      ),
  );
  if (!programFinalized) return undefined;

  // STAGE 2 — a FINALIZED programme that no opportunity was opened on.
  if (stopAfter === 'programmeFinalized') return halt('programmeFinalized');

  const opportunity = await attempt(tally, 'opportunity', () =>
    postAs<{ id: string }>(app, actors.placement.token, '/opportunities', {
      insuranceProgramId: program.id,
    }),
  );
  if (!opportunity) return undefined;

  /*
   * STAGE 3 — an opportunity still at `NEEDS_CONFIRMED`, with no quote request.
   *
   * Before the renewal mark below, deliberately: a renewal opportunity is a different thing to
   * demonstrate, and a halted chain that is also randomly a renewal one time in four would make
   * the stage inconsistent between runs for no gain.
   */
  if (stopAfter === 'opportunityNeedsConfirmed') {
    return halt('opportunityNeedsConfirmed');
  }

  /*
   * 🔴 SOME OPPORTUNITIES ARE RENEWALS — AND THIS IS THE ONLY WAY TO SAY SO, BECAUSE
   * `Opportunity.isRenewal` HAS THREE LIVE READERS AND NO WRITER AT ALL.
   *
   * Measured repo-wide 2026-11-11, for message 36 §2:
   *
   *   READERS  `sales-dashboard.repository.ts:64,82` filters policies by
   *            `opportunity: { isRenewal }` — that IS the dashboard's "Premium written
   *            (new vs. renewal)" split; `opportunities/page.tsx:102` renders «تجديد» or
   *            «أعمال جديدة» per row; `opportunity-api.ts:25` carries it on the wire.
   *   WRITERS  none. `CreateOpportunityInput` is exactly
   *            `{ customerId, insuranceProgramId, createdByUserId }`, `CreateOpportunityDto`
   *            accepts only `insuranceProgramId`, and no service, route or scheduler
   *            anywhere sets `isRenewal` or `Opportunity.renewalCaseId`.
   *
   * So the sales dashboard's new-vs-renewal split can only ever report 100% new business,
   * and every row of `/opportunities` reads «أعمال جديدة» — **not because the data says
   * so, but because nothing in the system can set the flag.** That is the inverse of an
   * absence claim: a screen reporting a fact that is structurally unobtainable.
   *
   * This write is consistent with this script's own documented rule — HTTP where an
   * endpoint exists, Prisma where none does, with the reason named, as it already does for
   * the first account in an Organization and for every `Insurer` row. ⛔ But it must NOT be
   * read as evidence the feature works: **seeded renewals prove the READERS render, and
   * prove nothing about a writer that does not exist.** Building one is a product decision
   * (what makes an opportunity a renewal — a link to the expiring policy, presumably
   * `RenewalCase`) and it belongs to the renewal module, not to a seed script.
   *
   * One in four, so both branches of every reader have data and neither is the whole set.
   */
  if (Math.random() < 0.25) {
    await rawPrisma.opportunity.update({
      where: { id: opportunity.id },
      data: { isRenewal: true },
    });
    bump(tally, 'created', 'opportunityMarkedRenewal');
  }

  /*
   * Pick from the INTERSECTION of what this programme designed and what each
   * insurer actually writes. Picking an insurer first and then one of its own
   * lines (the obvious order) 422s whenever that line is not on the
   * programme — which was ~1 pipeline in 3 before this.
   *
   * 🔴 THE LINE IS PICKED FIRST, AND THAT INVERSION IS THE WHOLE POINT — message 36 §2.
   *
   * Until 2026-11-11 this picked an insurer, then one of ITS lines, and sent to
   * `insurerIds: [insurer.id]` — so **every one of the 89 seeded RFQs reached exactly
   * ONE insurer**, measured on dev. Art. 15/d requires a quote request to reach three
   * insurers or more, and OWNER DECISION 130 rules that the office does so "because that
   * is what the law says". Seeded that way, art. 15/d's window would appear on 100% of
   * quote requests — which is precisely the failure decision 129's second form was
   * corrected for, and the owner's own test is *count the clicks added to the most
   * frequent transaction*.
   *
   * A shortlist of three needs three insurers writing ONE line, so the line has to be
   * chosen before the insurer. Measured on dev the same day: **9 (line, office) pairs
   * have three or more writers and 5 have fewer** — so the minority below three arises
   * from the real line/insurer structure rather than from a contrived ratio, which is a
   * better seed than forcing one. A thin line genuinely has few writers, and that is the
   * case the exemptions exist for.
   */
  const writersByLine = new Map<string, typeof insurers>();
  for (const candidate of insurers) {
    for (const line of candidate.lines) {
      if (!designedLines.has(line)) continue;
      const writers = writersByLine.get(line) ?? [];
      writers.push(candidate);
      writersByLine.set(line, writers);
    }
  }
  if (writersByLine.size === 0) {
    // Possible in principle (a questionnaire designing only lines no demo
    // insurer writes) and worth counting rather than silently dropping.
    bump(tally, 'failed', 'rfqNoEligibleInsurer');
    tally.errors.push(
      `[rfqNoEligibleInsurer] programme designed [${[...designedLines].join(', ')}] — no demo insurer writes any of them`,
    );
    return undefined;
  }
  /*
   * 🔴 MESSAGE 53 §2 — THE LINE IS CHOSEN FOR WHAT THE CHAIN IS MEANT TO DO, AND THAT CLOSES THE
   * 403s DECISION 158 §3 NAMED.
   *
   * This used to `pick(...)` any designed line with a writer. Message 46 §2 then recorded the
   * consequence and left it: «5 of 12 full pipelines ABORT at `POST /rfqs` with a 403 — the line
   * drew fewer than three writers and the placement officer holds no declaration code, so the
   * chain ends with no policy.» Decision 158 §3 asks for those requests to carry three insurers
   * instead.
   *
   * ⛔ AND NOTHING BENDS ART. 15/d TO DO IT. The rule is untouched, no exemption is invented and
   * no permission is granted — what changes is WHICH LINE the chain designs for, which is an
   * ordinary choice an office makes. A chain that must reach three companies asks for a line
   * three companies write.
   *
   * ⚠️ AND THE THIN-LINE CASE IS STILL SEEDED, DELIBERATELY: the `rfqIssuedAwaitingEvidence`
   * stage WANTS a line below the minimum, because its whole subject is the art. 15/d/5 exemption
   * marked «بلا إثبات». So the preference is inverted for that stage rather than dropped — and
   * it falls back to any line rather than refusing, because a run where every line happened to
   * be well served must still produce that stage (the lesson the stage's own header records).
   */
  const minInsurersForFullChain = 3;
  const wellServed = [...writersByLine.keys()].filter(
    (line) => (writersByLine.get(line) ?? []).length >= minInsurersForFullChain,
  );
  const thin = [...writersByLine.keys()].filter(
    (line) => (writersByLine.get(line) ?? []).length < minInsurersForFullChain,
  );
  const preferred =
    stopAfter === 'rfqIssuedAwaitingEvidence'
      ? thin.length > 0
        ? thin
        : [...writersByLine.keys()]
      : wellServed.length > 0
        ? wellServed
        : [...writersByLine.keys()];
  if (stopAfter !== 'rfqIssuedAwaitingEvidence' && wellServed.length === 0) {
    /*
     * Counted and named rather than left to the 403 downstream. This is the honest report the
     * owner's instruction asks for: if it ever prints, the demo insurers' line coverage — not
     * this chooser — is what needs changing.
     */
    bump(tally, 'failed', 'rfqNoWellServedLine');
    tally.errors.push(
      `[rfqNoWellServedLine] programme designed [${[...designedLines].join(', ')}] — no designed ` +
        `line has ${minInsurersForFullChain} writers among the demo insurers, so this chain will ` +
        'be refused by art. 15/d unless an exemption is declared, which it must not be',
    );
  }
  const insuranceLine = pick(preferred);
  const lineWriters = writersByLine.get(insuranceLine) ?? [];
  /*
   * 🔴 STAGE 4 — AN RFQ THAT WENT TO FEWER THAN THREE, MARKED «بلا إثبات» — message 46 §2.1.
   *
   * ## Nothing here bends a rule, and the §2 instruction says to stop if it would
   *
   * Art. 15/d is ENFORCED on this route. A request to fewer than three companies needs an
   * exemption or a declaration, and the exemption this stage uses is the fifth —
   * `AT_CUSTOMER_REQUEST`, art. 15/d/5 — sent with **no evidence at all**.
   *
   * OWNER DECISION 139 is what makes that legitimate rather than a hole: the exemption is
   * ACCEPTED and the row is MARKED «بلا إثبات», because the harm falls on the office and is
   * repaired by attaching the message, so refusing at the last step punished an employee for
   * not having logged a phone call yet. The mark is derived from the row (`exemptionLacksEvidence`),
   * never stored, and ⛔ no permission can clear it — `RfqArticle15DExemption` permits exactly
   * one transition, evidence NULL ⟶ NOT NULL, by trigger.
   *
   * ⟶ So this is the ordinary, intended path through the product, driven over real HTTP by an
   * actor holding the ordinary `rfq.create`. No role is widened, no code is minted, no check is
   * skipped and no row is written behind the API's back.
   *
   * ## And the shortlist is capped rather than hunted for
   *
   * The full-pipeline branch below takes up to FOUR writers so a well-served line reaches the
   * statutory three with one to spare. This branch takes at most TWO, from the same pool — which
   * is what puts the request under the article in the first place. ⛔ It does not search for a
   * thin line: that would make the stage depend on the insurer/line structure and silently
   * produce nothing on a run where every designed line happened to be well served.
   */
  const haltingAtRfq = stopAfter === 'rfqIssuedAwaitingEvidence';
  const shortlist = haltingAtRfq
    ? pickN(lineWriters, Math.min(2, lineWriters.length))
    : pickN(lineWriters, Math.min(4, lineWriters.length));
  const rfq = await attempt(tally, 'rfq', () =>
    postAs<{ id: string }>(app, actors.placement.token, '/rfqs', {
      opportunityId: opportunity.id,
      insuranceLine,
      insurerIds: shortlist.map((i) => i.id),
      ...(haltingAtRfq && shortlist.length < 3
        ? { article15D: { exemption: 'AT_CUSTOMER_REQUEST' } }
        : {}),
    }),
  );
  if (!rfq) return undefined;

  if (haltingAtRfq) {
    /*
     * The message the presenter attaches. INBOUND, from THIS customer, by an approved means —
     * decision 139's four conditions, unchanged by decision 143. ⛔ Never `WHATSAPP`, which
     * decision 44 excludes, and the route sets `customerId` from the opportunity itself so the
     * log lands where `findApprovedInboundForCustomer` will find it.
     *
     * Created AFTER the request, which is the honest order: the whole point of the stage is a
     * request that was accepted WITHOUT evidence and a message still waiting to be attached.
     * `rfq.communication.log` is the placement officer's — the same code the attach itself
     * carries, so nothing is granted to make this work.
     */
    const evidence = await attempt(tally, 'haltedRfqEvidenceWaiting', () =>
      postAs(app, actors.placement.token, `/rfqs/${rfq.id}/communications`, {
        direction: 'INBOUND',
        channel: 'EMAIL',
        subject: 'طلب التوجّه إلى شركة تأمين بعينها',
        body: 'كتب العميل يطلب أن يُوضَع هذا الفرع لدى شركة واحدة سمّاها.',
        // ⚠️ `occurredAt`, NOT `sentAt`. The first version sent `sentAt` — the COLUMN's name on
        // `CommunicationLog` — and the DTO forbids unknown properties, so all four of these
        // answered `400 property sentAt should not exist`: every halted RFQ shipped with nothing
        // for the presenter to attach, while the run itself stayed green. Found only by running
        // the seeder and reading its own failure tally.
        occurredAt: isoDateDaysAgo(randomInt(2, 20)),
      }),
    );
    return halt('rfqIssuedAwaitingEvidence', {
      rfqId: rfq.id,
      insurerCount: shortlist.length,
      evidenceWaiting: evidence !== undefined,
    });
  }

  /*
   * ONE QUOTATION PER SHORTLISTED INSURER, and the cheapest is what gets recommended.
   *
   * Before 2026-11-11 there was one insurer and therefore one quote, so every seeded
   * comparison matrix compared a field of ONE and every recommendation's *"most
   * competitive premium among the insurers approached"* rationale was true of a set with
   * no alternative in it. A shortlist with one quote on it would have been worse than
   * the old data, not better: the RFQ would say three insurers were approached while the
   * comparison showed one, which is the shape an inspector asks about.
   *
   * A quote is NOT forced from every insurer — `attempt` already tolerates one failing,
   * and a real market has insurers that decline to quote. What matters is that the set
   * is bigger than one and that the recommended quotation is the cheapest in it, so the
   * rationale the seed writes is true of the data it writes.
   */
  const quotes: {
    insurerId: string;
    quotationId: string;
    premium: number;
  }[] = [];
  for (const target of shortlist) {
    const premium = randomInt(500, 45_000);
    const quoted = await attempt(tally, 'quotation', () =>
      postAs<{ current?: { id: string }; id?: string }>(
        app,
        actors.placement.token,
        '/quotations',
        {
          rfqId: rfq.id,
          insurerId: target.id,
          premium: money(premium),
          currency: 'JOD',
          deductible: money(Math.max(50, Math.round(premium * 0.05))),
          commissionRatePercent: '12.50',
        },
      ),
    );
    const id = quoted?.current?.id ?? quoted?.id;
    if (id) quotes.push({ insurerId: target.id, quotationId: id, premium });
  }
  if (quotes.length === 0) return undefined;
  // Cheapest, so the recommendation's own stated reason matches the seeded figures.
  quotes.sort((a, b) => a.premium - b.premium);
  const quotationId = quotes[0].quotationId;
  /*
   * The policy downstream is issued at the RECOMMENDED quotation's premium, which used to
   * be true only because there was exactly one quote. With a shortlist it has to be said:
   * `premium` is the figure on the quote the recommendation names, and the compiler is
   * what asked — removing the single `premium` broke `issuedPremium` and the return value,
   * which is the right kind of break, because a policy issued at some OTHER insurer's
   * premium would have been a quiet inconsistency in money.
   */
  const premium = quotes[0].premium;
  if (!quotationId) {
    bump(tally, 'failed', 'quotationId');
    return undefined;
  }

  const comparisonOk = await attempt(tally, 'comparison', () =>
    postAs(app, actors.placement.token, '/comparison-matrices', {
      rfqId: rfq.id,
    }),
  );
  if (!comparisonOk) return undefined;

  const recommendation = await attempt(tally, 'recommendation', () =>
    postAs<{ id: string }>(app, actors.placement.token, '/recommendations', {
      opportunityId: opportunity.id,
      recommendedQuotationId: quotationId,
      rationale:
        'أفضل توازن بين اتّساع التغطية والسعر ومكانة شركة التأمين لهذا الخطر.',
      rationaleFactors: {
        coverage: 'التغطية تطابق كل فرع أوصى به تقييم الاحتياجات.',
        price: 'أقلّ قسط بين الشركات التي طُلب منها عرض.',
        financialStrength: 'للشركة تصنيف قوّة مالية جيّد.',
        claimsService: 'سجلّها في تسوية المطالبات محلياً جيّد وسريع.',
        deductible: 'مبلغ التحمّل مناسب لحجم العميل.',
        policyConditions:
          'نصّ الوثيقة معتاد في السوق وبلا استثناءات غير مألوفة.',
      },
    }),
  );
  if (!recommendation) return undefined;

  const sent = await attempt(tally, 'recommendationSend', () =>
    postAs(
      app,
      actors.placement.token,
      `/recommendations/${recommendation.id}/send`,
      {},
    ),
  );
  if (!sent) return undefined;

  const decisionOk = await attempt(tally, 'clientDecision', () =>
    postAs(app, actors.sales.token, '/client-decisions', {
      opportunityId: opportunity.id,
      decision: 'ACCEPT',
      evidenceType: 'email_confirmation',
      // An email MESSAGE reference, which is what this field's own docblock asks for — see
      // `emailMessageRef`. It used to be a mailbox address with a timestamp in it.
      evidenceRef: emailMessageRef(opportunity.id),
    }),
  );
  if (!decisionOk) return undefined;

  // Inception in the PAST, deliberately. `PlacePolicyDto` allows a future
  // date, but a claim's loss date must fall on or after inception AND must not
  // be in the future — with cover incepting next week there is no valid loss
  // date at all, and every claim below 422s. Back-dating also makes the demo
  // data look like a book that has been running, not one that starts tomorrow.
  const inceptionDaysAgo = randomInt(45, 200);
  const policy = await attempt(tally, 'policy', () =>
    postAs<{ id: string }>(app, actors.placement.token, '/policies', {
      opportunityId: opportunity.id,
      inceptionDate: isoDateDaysAgo(inceptionDaysAgo),
      /*
       * 🔴 MESSAGE 53 §2 ITEM 5 — THE EXPIRY DATE, WHICH READ «—» ON EVERY DEMO POLICY.
       *
       * `expiryDate` is OPTIONAL at placement by design — the DTO says «the insurer confirms the
       * exact period at issuance» — and this seed never supplied it, so the policy section
       * printed an em dash where a customer and an inspector both look for the end of cover.
       *
       * A 365-day term from inception, which is the annual period every other figure in this
       * script assumes (the renewal window on `/dashboards/policy`, the 365-day
       * `CommissionAgreement` effectiveFrom). ⛔ The DTO requires it to be AFTER
       * `inceptionDate`, and `inceptionDaysAgo` is 45–200, so this always lands in the FUTURE —
       * which is also what makes the renewal screens have something to show.
       */
      expiryDate: isoDateDaysFromNow(365 - inceptionDaysAgo),
    }),
  );
  if (!policy) return undefined;

  const policyNumber = `POL-${orgSlug.toUpperCase()}-${Date.now()}-${nextSeq()}`;
  const coverage = buildCoverageFigures();
  const issued = await attempt(tally, 'policyIssuance', () =>
    postAs(app, actors.placement.token, `/policies/${policy.id}/issuance`, {
      policyNumber,
      issuedPremium: money(premium),
      /*
       * ⚠️ MESSAGE 53 §2 ITEM 5 — `namedPerils` AND `extensions` ARE AN EMPTY ARABIC CELL, AND
       * THEY ARE REPORTED RATHER THAN FILLED.
       *
       * `PolicyScheduleInputDto` accepts both as optional `string[]`, so the route is ready and
       * the screen's «الأخطار المسمّاة» and «التوسعات» rows are blank only because nothing is
       * sent. ⛔ What is missing is the WORDS: these are schedule TERMS an underwriter writes,
       * no decision ratifies one, and none ships anywhere in this product (measured across
       * `translations/` and `seed-data/`).
       *
       * ⛔ AND DECISION 158's TABLE و IS NOT A SOURCE FOR THEM, which is the trap worth naming:
       * it ratifies «ضرر حريق في معدّات المكتب.» and «سرقة بضاعة من المخزن.» — CLAIM
       * DESCRIPTIONS, whole sentences about one event. A named peril is a term («حريق»,
       * «سرقة»), and slicing a noun out of her sentence to make one would be composing a word
       * she did not give. The expiry date beside them IS built, because a date is not a word.
       */
      schedule: { limits: coverage.limits, sumsInsured: coverage.sumsInsured },
      documents: [],
    }),
  );
  if (!issued) return undefined;

  /*
   * 🔴 MESSAGE 53 §2 — THE CHAIN THAT STOPS WITH THE POLICY ISSUED AND UNCHECKED.
   *
   * `demo.policy_check` holds `policy.check` and had nothing to open: every policy this seeder
   * produced was checked in the same breath as it was issued. Halting here leaves exactly the
   * work that account exists for.
   *
   * ⛔ RETURNED AS A HALT rather than by skipping the call and carrying on, which is this file's
   * own rule: a chain that stopped because it was TOLD to and one that stopped because it FAILED
   * are identical in the data unless the halt is declared. And because a halt is not pushed into
   * `policies`, this policy is never invoiced and never claimed — which is correct rather than
   * incidental: money must not move against cover nobody has checked.
   */
  if (stopAfter === 'policyAwaitingCheck') {
    return halt('policyAwaitingCheck', { policyId: policy.id, policyNumber });
  }

  // Maker/checker: the checker must be a DIFFERENT user than whoever placed
  // the cover (Placement) — see policy.controller.ts's own comment.
  const checked = await attempt(tally, 'policyChecking', () =>
    postAs(app, actors.policyCheck.token, `/policies/${policy.id}/checking`, {
      requestedCoverage: {
        limits: coverage.limits,
        sumsInsured: coverage.sumsInsured,
      },
    }),
  );
  if (!checked) return undefined;

  // The method is chosen FIRST, because the recipient's shape follows from it: an email address
  // recorded against an `in_person` delivery says the wrong thing about who took the document.
  const deliveryMethod = pick(['email', 'portal', 'courier', 'in_person']);
  const delivered = await attempt(tally, 'policyDelivery', () =>
    postAs(app, actors.sales.token, `/policies/${policy.id}/delivery`, {
      method: deliveryMethod,
      recipient: deliveryRecipient(deliveryMethod, customerLabel, policy.id),
    }),
  );
  if (!delivered) return undefined;

  await attempt(tally, 'policyAcknowledgeReceipt', () =>
    postAs(
      app,
      actors.sales.token,
      `/policies/${policy.id}/delivery/acknowledge-receipt`,
      {},
    ),
  );

  return {
    customerId,
    policyId: policy.id,
    policyNumber,
    premium,
    inceptionDaysAgo,
    insuranceLine,
  };
}

async function maybeInvoicePolicy(
  app: INestApplication<App>,
  actors: Actors,
  policyId: string,
  premium: number,
  tally: Tally,
): Promise<{ id: string; totalAmount: string } | undefined> {
  // taxAmount and feesAmount must both be `<= premiumAmount` (server-enforced
  // against Policy.issuedPremium) — keep both as small fractions of the
  // premium rather than an unrelated fixed range, so this never 422s on a
  // small policy.
  return attempt(tally, 'invoice', () =>
    postAs<{ id: string; totalAmount: string }>(
      app,
      actors.finance.token,
      '/invoices',
      {
        policyId,
        taxAmount: money(Math.max(1, Math.round(premium * 0.16))),
        feesAmount: money(Math.max(1, Math.round(premium * 0.02))),
        dueDate: isoDateDaysFromNow(30),
      },
    ),
  );
}

/**
 * 🔴 THE MONEY ACTUALLY ARRIVES ON A SHARE OF INVOICES — message 46 §2.5.
 *
 * The seed invoiced and never collected, so every invoice sat at `INVOICED` for ever and the
 * client funds ledger held no `in` entry at all.
 *
 * ⚠️ AND THE SENTENCE THAT USED TO STAND HERE WAS WRONG, CORRECTED 2026-11-25 AFTER A WALK FROM
 * AN EMPTY DATABASE. It said this step was why «the commission-income figure on four dashboards
 * read zero», which made collecting an invoice sound like what puts commission on a screen. It
 * is not. A `CommissionLedgerEntry` is written by `POST /commission/entries` and by nothing
 * else — see `recordCommission` below, which this seed did not call until message 53 — so the
 * executive and financial dashboards read **JOD 0.000** through every run that exited green.
 * ⟶ The two are independent: this one fills the client funds ledger and the ageing report, and
 *   that one fills the commission tiles.
 *
 * ⛔ Nothing about how commission is computed is touched by either.
 *
 * Through `POST /invoices/:id/receipt`, the product's own route, as the FINANCE actor, who is the
 * only seeded role holding `receipt.record`. The full invoiced total in one instalment, so the
 * invoice reaches `COLLECTED` and `reconcile` can take it to `RECONCILED`: a part payment is a
 * different demonstration and this one is about the figure being non-zero.
 *
 * `reference` is MANDATORY and doubles as the endpoint's idempotency key, so it carries the
 * invoice id — a re-run cannot book the same money twice.
 */
async function collectInvoice(
  app: INestApplication<App>,
  actors: Actors,
  invoice: { id: string; totalAmount: string },
  tally: Tally,
): Promise<boolean> {
  const receipt = await attempt(tally, 'receipt', () =>
    postAs(app, actors.finance.token, `/invoices/${invoice.id}/receipt`, {
      amount: invoice.totalAmount,
      method: pick(['bank_transfer', 'cheque', 'card']),
      receivedAt: isoDateDaysAgo(randomInt(1, 20)),
      reference: `DEMO-RCPT-${invoice.id}`,
    }),
  );
  if (!receipt) return false;
  // INVOICED -> COLLECTED -> RECONCILED. The second step is what the finance screens call
  // settled, and leaving it out would show money received against an invoice that still reads
  // as outstanding.
  await attempt(tally, 'invoiceReconciled', () =>
    postAs(app, actors.finance.token, `/invoices/${invoice.id}/reconcile`, {}),
  );
  return true;
}

/**
 * 🔴 MESSAGE 53 §2 ITEM 8 — THE OFFICE'S LICENSED LINES, WHICH MESSAGE 52 §3-A PROMISED AND DID
 * NOT BUILD.
 *
 * The walk read «أنواع التأمين: —» and «لم تُسجّل أي فروع بعد. لا يُحدّد نوع التأمين إلا من
 * فروعه.» on `/regulatory-compliance` — so the office was placing business on lines its own
 * licence scope did not list, which is the state art. 3 and art. 4/a exist to describe.
 *
 * ## IT DEPENDS ON A STEP THAT ALREADY EXISTS, AND THE ORDER IS A GUARD
 *
 * `BrokerLicenseScopeService.addBranch` REFUSES the branch that would give an office BOTH
 * insurance types unless the office records at least two CURRENT CBJ approvals. The demo offices
 * sell both (motor and property are GENERAL, group medical and life are LIFE), so without the
 * approvals the second type is refused and the scope lists one — a different defect wearing the
 * same «—». ⛔ The service's rule is not touched: what changes is that the demo office satisfies
 * it, the way a real office would.
 *
 * 🔴 AND THE FIRST VERSION OF THIS FUNCTION RECORDED THOSE APPROVALS ITSELF, WHICH WAS A SECOND
 * HOME FOR SOMETHING THE SEED ALREADY DID. `seedCbjApprovals` — called at the tail of
 * `seedEmployees`, which runs before this — already approves THREE people per office and gives
 * the second a LIFE branch, with its own docblock explaining why three and not ten. Measured on
 * the from-empty run of 2026-11-25: FIVE employees per office came back `CURRENT`, three from
 * that step and two from mine, which is how the duplication was found.
 *
 * ⟶ So this function records no approval. It depends on `seedEmployees` having run first, and
 *   says so by CHECKING rather than by assuming: a count below two is recorded and named, which
 *   is the only thing that distinguishes «the order changed» from «the branch was refused».
 *
 * ⚠️ AND A SOLE ESTABLISHMENT STILL CANNOT HOLD BOTH (art. 3/a). Measured: both demo offices are
 * created as corporate brokers, so the rule does not bite here — and if an office's `brokerKind`
 * is ever changed, the refusal is recorded by `attempt` with the service's own sentence rather
 * than swallowed.
 *
 * ⛔ AND THE LINES COME FROM WHAT THE OFFICE'S INSURERS ACTUALLY WRITE, read back from
 * `InsurerOfferedLine` — never a hand-written list. A list here would drift from
 * `LOCAL_INSURER_SEEDS` and `DEMO_INSURER_LINES` the first time either moved, and the drift would
 * look exactly like the defect it replaced.
 */
async function recordLicensedScope(
  app: INestApplication<App>,
  actors: Actors,
  orgId: string,
  tally: Tally,
): Promise<number> {
  if (!actors.compliance) return 0;

  // ---- 1. the precondition `seedEmployees` is responsible for ----------------------------
  const approved = await rawPrisma.employee.count({
    where: {
      organizationId: orgId,
      cbjApprovalStatus: 'CURRENT',
      terminationDate: null,
    },
  });
  if (approved < 2) {
    tally.errors.push(
      `[licensedScope] ${orgId} records ${approved} CURRENT CBJ approval(s). ` +
        '`addBranch` refuses the branch that would licence an office for BOTH insurance types ' +
        'below two, so the scope will list ONE type — check that `seedEmployees` (which calls ' +
        '`seedCbjApprovals`) ran before this.',
    );
  }

  // ---- 2. one licensed branch per catalogue line this office's insurers write -------------
  const offered = await rawPrisma.insurerOfferedLine.findMany({
    where: { organizationId: orgId },
    select: { insuranceLineId: true },
    distinct: ['insuranceLineId'],
  });
  let added = 0;
  for (const { insuranceLineId } of offered) {
    const branch = await attempt(tally, 'licensedBranch', () =>
      postAs(app, actors.compliance.token, '/broker-license/scope', {
        insuranceLineId,
      }),
    );
    if (branch) added += 1;
  }
  return added;
}

/**
 * 🔴 MESSAGE 53 §2 ITEM 9 — THE OBLIGATIONS CALENDAR, AND MOST OF IT IS AN EMPTY ARABIC CELL.
 *
 * `/regulatory-compliance` read «لا توجد بنود في تقويم الالتزامات.» in both offices. Decision 158
 * §2 asked for this and said «seed a few obligations if a route exists, report if none does».
 *
 * ⟶ A ROUTE EXISTS: `POST /compliance-calendar`, on `compliance-calendar.manage`, held by
 *   `COMPLIANCE_OFFICER` alone — measured, and nothing was granted.
 *
 * ## ⛔ AND THE OBLIGATION NAMES ARE WHAT IS MISSING, NOT THE ROUTE
 *
 * `obligationName` is free Arabic text an office types. No decision ratifies one — decision 158's
 * ten tables carry none — and inventing «التقرير الربعي للبنك المركزي» or anything like it would
 * be writing Arabic the owner has not seen, onto a screen an inspector reads.
 *
 * ⟶ SO ONLY THE TWO THIS PRODUCT CAN ALREADY NAME ARE SEEDED, each sliced from a span that ships
 *   for exactly that thing:
 *
 *     «تجديد الترخيص»            `rcRenewButton`  — the licence renewal, and its due date is the
 *                                                   one art. 11 fixes, so the figure is the
 *                                                   product's own rather than a day I chose.
 *     «إعادة اعتماد الصلاحيات»   `acrHeading`     — the periodic access recertification, which is
 *                                                   a real recurring obligation with its own
 *                                                   screen in this product.
 *
 * ⚠️ TWO IS NOT «a few», AND THAT IS REPORTED RATHER THAN PADDED. A third name is the owner's to
 * give; the gap is in `docs/design-pass-register.md`.
 *
 * ⚠️ AND «one near its due date» IS SATISFIED BY THE LICENCE ROW RATHER THAN BY AN OFFSET I
 * PICKED: for office A the renewal falls 45 days before a term expiring this year or next, and
 * for office B — whose term is already past expiry — it is in the past, which is exactly the
 * overdue row the calendar exists to show.
 */
async function seedComplianceObligations(
  app: INestApplication<App>,
  actors: Actors,
  orgId: string,
  tally: Tally,
): Promise<number> {
  if (!actors.compliance) return 0;

  /*
   * ⛔ THE DUE DATE IS READ OFF THE PRODUCT, NOT COMPUTED HERE, and that is the point rather than
   * convenience: art. 11's span is a `LegalValue` row (decision 123 moved it out of source), and
   * `GET /broker-license` already answers `renewalDueBy` for the current term by passing that row
   * to `renewalApplicationDueBy`. A `- 45 days` in this script would be the figure's second home
   * and would disagree with the screen the day the row moved.
   */
  const licence = await request(app.getHttpServer())
    .get('/broker-license')
    .set(bearer(actors.compliance.token));
  // `BrokerLicenseSeriesView.current` — the term `pickCurrentTerm` chose, which is the one every
  // screen and the issuance gate both read.
  const renewalDueBy = (
    licence.body as { current?: { renewalDueBy?: string } | null }
  )?.current?.renewalDueBy;
  if (!renewalDueBy) {
    tally.errors.push(
      `[complianceCalendar] ${orgId}: GET /broker-license answered ${licence.status} with no ` +
        'current term, so the renewal obligation has no due date to take and the calendar stays ' +
        'empty.',
    );
    return 0;
  }
  const renewalDue = new Date(renewalDueBy);

  const items: { obligationName: string; dueDate: Date }[] = [
    // ⛔ SLICED, never retyped: see the docblock for which shipping key each comes from.
    { obligationName: 'تجديد الترخيص', dueDate: renewalDue },
    {
      obligationName: 'إعادة اعتماد الصلاحيات',
      // The recertification cycle's own quarter, counted forward from today rather than from a
      // licence date: the two obligations are unrelated and sharing a date would imply they are.
      dueDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  ];

  let created = 0;
  for (const item of items) {
    const row = await attempt(tally, 'complianceObligation', () =>
      postAs(app, actors.compliance.token, '/compliance-calendar', {
        obligationName: item.obligationName,
        // The compliance officer owns both: they are the person the screen's own
        // «الجهة المسؤولة» column names, and the only actor holding the code that reads it.
        ownerUserId: actors.compliance.id,
        dueDate: item.dueDate.toISOString().slice(0, 10),
      }),
    );
    if (row) created += 1;
  }
  return created;
}

/**
 * 🔴 MESSAGE 53 §2 ITEM 2 — KYC, WHICH DECISION 158 §3 ASKED FOR AND MESSAGE 52 DID NOT BUILD.
 *
 * The walk from an empty database found **all 256 customers reading «بانتظار اعرف عميلك»** and
 * the sales account's bell at **258** — two more than the customer count, because every customer
 * is a notification and nothing had ever cleared one. Measured on `main` at `7f7c6a66`:
 * `seed-demo.script.ts` contained the string `kyc` nowhere at all.
 *
 * ## THE FOUR ACTS, EACH THROUGH THE PRODUCT'S OWN ROUTE
 *
 *   POST /customers/:id/kyc              `kyc.capture`   — SALES, who must also OWN the customer
 *   POST /kyc-records/:id/submit         `kyc.capture`   — SALES
 *   POST /kyc-records/:id/run-screening  `screening.run` — COMPLIANCE
 *   POST /kyc-records/:id/approve        `kyc.approve`   — COMPLIANCE
 *
 * ⛔ MEASURED ACROSS THE TWELVE SEEDED ROLES, AND NOTHING WAS GRANTED: `kyc.capture` is
 * `SALES_RELATIONSHIP_OFFICER` alone and `kyc.approve` / `screening.run` are
 * `COMPLIANCE_OFFICER` alone. That split is also what satisfies
 * `KYCRecord_maker_checker_distinct` for free — the capturer and the approver are two different
 * people because they have to be two different ROLES.
 *
 * ⚠️ AND `start` REFUSES ANYONE BUT THE CUSTOMER'S OWNER (`customer.ownerUserId !== actorUserId`
 * is a 404, not a 403). Every demo customer is created through `/customers` as `actors.sales`,
 * so sales is the owner — which is why this cannot be moved to another actor without the
 * customers moving with it.
 *
 * ## 🔴 AND THE SCREENING HOLD IS NOT WAIVED, WHICH IS THE ONE DECISION IN THIS FUNCTION
 *
 * `decide('APPROVED')` runs `ScreeningHoldService.assertClearToProceed`. Three outcomes:
 * `NO_HOLD` proceeds, `BLOCKED` refuses outright, and `REVIEW_REQUIRED` proceeds ONLY against a
 * written acceptance stored as a `ScreeningHoldRelease` row with the accepter's name on it.
 *
 * ⛔ SO NO `screeningHoldReason` IS SENT. A seed that supplies one would write «accepted in
 * writing» into a register an inspector reads, attributed to an account nobody was sitting at,
 * for a sanctions or PEP finding no human ever looked at. That is the exact silent override the
 * whole mechanism exists to make impossible, and it is worse than a short figure on a demo
 * screen.
 *
 * ⟶ A held file is COUNTED AND NAMED instead. `attempt` records the refusal with the server's
 *   own sentence, so the run's own tally says how many files stopped and why — a measurement the
 *   next reader can act on rather than a number I chose.
 *
 * ⚠️ MEASURED FROM EMPTY, 2026-11-25, WITH THE WATCHLIST SYNC AHEAD OF IT: `kycStart 363 ·
 * kycApprove 359 · failed.kycApprove 4`, and all four refusals are the SAME 422 —
 *
 *   «a high-risk result must go through the EDD path first
 *    (POST /kyc-records/:id/trigger-edd) before a decision can be recorded»
 *
 * ⟶ Four customers screened HIGH RISK, and the product routed them to Enhanced Due Diligence
 *   rather than letting them be approved. ⛔ NOT chased: those four files sitting at the EDD gate
 *   are real work for the compliance account and the EDD path has its own screen, so they are
 *   better demo data than four more approvals would be. Reported, not fixed.
 *
 * ## AND IT IS A SHARE, NOT ALL OF THEM
 *
 * The owner's words are «جزء من العملاء مكتمل «اعرف عميلك»». A list where every row reads
 * «نشِط» has no KYC queue to show, and `/customers/kyc-queue` is a screen in the scenario — so
 * the rest stay `PENDING_KYC` deliberately, which is also what leaves the bell a real number
 * rather than zero.
 */
async function approveKycForShare(
  app: INestApplication<App>,
  actors: Actors,
  customers: { id: string; legalName: string }[],
  share: number,
  tally: Tally,
): Promise<{ started: number; approved: number }> {
  let started = 0;
  let approved = 0;
  if (!actors.compliance) return { started, approved };
  for (const customer of customers) {
    if (Math.random() >= share) continue;
    const record = await attempt(tally, 'kycStart', () =>
      postAs<{ id: string }>(
        app,
        actors.sales.token,
        `/customers/${customer.id}/kyc`,
        {},
      ),
    );
    if (!record) continue;
    started += 1;
    const submitted = await attempt(tally, 'kycSubmit', () =>
      postAs(app, actors.sales.token, `/kyc-records/${record.id}/submit`, {}),
    );
    if (!submitted) continue;
    const screened = await attempt(tally, 'kycScreening', () =>
      postAs(
        app,
        actors.compliance.token,
        `/kyc-records/${record.id}/run-screening`,
        {},
      ),
    );
    if (!screened) continue;
    // ⛔ NO `screeningHoldReason` — see the docblock. A 400 here is the hold doing its job and
    // is recorded as such.
    const decided = await attempt(tally, 'kycApprove', () =>
      postAs(
        app,
        actors.compliance.token,
        `/kyc-records/${record.id}/approve`,
        {},
      ),
    );
    if (decided) approved += 1;
  }
  return { started, approved };
}

/**
 * 🔴 MESSAGE 53 §2 ITEM 1 — THE COMMISSION LEDGER ENTRY, WHICH NOTHING HAD EVER WRITTEN.
 *
 * Decision 158 §3 asked for this and message 52 reported nothing declined; the walk from an
 * empty database then found **JOD 0.000** on the executive dashboard, the financial dashboard
 * and every profitability table. Measured on `main` at `7f7c6a66`: `seed-demo.script.ts`
 * contained no call to `POST /commission/entries` at all.
 *
 * ⛔ THROUGH THE PRODUCT'S OWN ROUTE, as the actor who holds `commission.calculate`. Measured
 * across the twelve seeded roles, that is `FINANCE_COLLECTIONS_OFFICER` — `actors.finance`, the
 * same actor that invoices and collects. ⛔ No role was granted anything and no code was minted.
 *
 * ⛔ AND NOTHING ABOUT THE COMPUTATION IS TOUCHED. The service resolves the governed rate from
 * the `CommissionAgreement` in force for the policy's (insurer, line) AT INCEPTION and derives
 * the amount itself; this step supplies a policy id and nothing else. `CalculateCommissionDto`
 * has exactly one field, which is what makes that guarantee structural rather than a promise.
 *
 * ## WHY IT IS NOT CONDITIONAL, WHERE THE INVOICE AND THE CLAIM ARE
 *
 * An invoice is raised on about three quarters of policies and a claim on about two fifths,
 * because a book where every policy is invoiced and claimed shows neither an ageing report nor
 * an open-claims queue. Commission is different: an office earns it on EVERY placement, so a
 * policy with no ledger entry is not a demonstration of anything — it is a gap in the figure
 * the brokers are being shown.
 *
 * ⚠️ AND A 422 HERE IS EXPECTED ON SOME POLICIES RATHER THAN A DEFECT. The service refuses when
 * no agreement is in force for that (insurer, line) pair at that date, and
 * `ensureCommissionAgreements` skips a SECOND open agreement where two line strings resolve to
 * one managed line — correctly, since the constraint permits one. So the refusals are counted
 * and named by `attempt` rather than suppressed, and the run prints how many entries landed.
 *
 * The route is WRITE-ONCE by policy (`findLedgerEntryByPolicyId` resolves an existing entry
 * before any input check), so a re-run cannot double the figure.
 */
async function recordCommission(
  app: INestApplication<App>,
  actors: Actors,
  policyId: string,
  tally: Tally,
): Promise<boolean> {
  const entry = await attempt(tally, 'commissionEntry', () =>
    postAs(app, actors.finance.token, '/commission/entries', { policyId }),
  );
  return Boolean(entry);
}

/**
 * 🔴 MESSAGE 53 §2 ITEM 7 — THE CAUSE OF LOSS MATCHES THE COVER, AND THE PER-LINE MATRIX WAS
 * RIGHT ALL ALONG.
 *
 * The walk saw a claim described «تصادم مركبة أثناء التوصيل.» whose mandatory-document list
 * demanded «تقرير طبي». The owner asked which of the two was wrong. **MEASURED: the seed.**
 *
 *   `mandatoryDocTypesFor` reads the POLICY's `insuranceLine`, never the description, and
 *   `classifyInsuranceLine` sends a medical/health/life/GPA line to the `medical` family, which
 *   requires `medical_report` and `invoice`. ⟶ For a claim on a GROUP MEDICAL policy, asking for
 *   a medical report is exactly correct.
 *
 *   `maybeClaimPolicy` picked one of decision 158 table و's five descriptions with `pick(...)`
 *   and never looked at the line. ⟶ A vehicle-collision description landed on a medical policy
 *   about a fifth of the time, and the checklist beside it then read as nonsense.
 *
 * ⛔ SO NOTHING IN `claim.config.ts` IS TOUCHED — the matrix, the classifier and the medical
 * report's HIGHLY_CONFIDENTIAL rule all stand. What changed is which of her five sentences this
 * seed puts on which policy.
 *
 * ⛔ AND THE CLASSIFIER IS IMPORTED, NEVER RE-IMPLEMENTED. A second copy of «which family is
 * this line» in a seed script would disagree with the product the first time a line was renamed,
 * and the disagreement would show up as exactly the defect this is fixing.
 *
 * ⚠️ AND THE FIVE SENTENCES ARE HERS, so the families they can cover are limited by what she
 * wrote: her table has a storm, a collision, a burst pipe, a theft and a fire. ⟶ `medical`,
 * `liability` and `marine` have NO sentence of hers that fits, and for those the choice falls
 * back to her whole set rather than inventing one. ⟶ REPORTED as an empty cell: a line where the
 * cover and the cause still disagree is one of those three, and the words for them are hers.
 */
function causeOfLossFor(insuranceLine: string): string {
  const STORM = 'ضرر في سقف المستودع بسبب عاصفة.';
  const COLLISION = 'تصادم مركبة أثناء التوصيل.';
  const WATER = 'ضرر مياه بسبب انفجار ماسورة.';
  const THEFT = 'سرقة بضاعة من المخزن.';
  const FIRE = 'ضرر حريق في معدّات المكتب.';
  const ALL = [STORM, COLLISION, WATER, THEFT, FIRE];
  switch (classifyInsuranceLine(insuranceLine)) {
    case 'motor':
      // The one sentence of hers about a vehicle.
      return COLLISION;
    case 'property':
      // Everything but the collision: a storm, a burst pipe, a theft and a fire are all losses
      // to premises or contents.
      return pick([STORM, WATER, THEFT, FIRE]);
    default:
      // `medical`, `liability`, `marine` and `other` — see the docblock's empty cell.
      return pick(ALL);
  }
}

async function maybeClaimPolicy(
  app: INestApplication<App>,
  actors: Actors,
  policyId: string,
  inceptionDaysAgo: number,
  insuranceLine: string,
  tally: Tally,
): Promise<{ id: string; estimatedLoss: number } | undefined> {
  const estimatedLoss = randomInt(500, 30_000);
  const claim = await attempt(tally, 'claim', () =>
    postAs<{ id: string }>(app, actors.claims.token, '/claims', {
      policyId,
      // Strictly inside cover: after inception, and never in the future.
      lossDate: isoDateDaysAgo(randomInt(1, Math.max(1, inceptionDaysAgo - 1))),
      causeOfLoss: causeOfLossFor(insuranceLine),
      lossLocation: pick(CITIES),
      estimatedLoss: money(estimatedLoss),
    }),
  );
  if (!claim) return undefined;
  const registered = await attempt(tally, 'claimRegistration', () =>
    postAs(app, actors.claims.token, `/claims/${claim.id}/registration`, {
      insurerClaimReference: `INS-REF-${Date.now()}-${nextSeq()}`,
      adjuster: {
        name: `${pick(GIVEN_NAMES_M)} ${pick(FAMILY_NAMES)}`,
        firm: 'المكتب الإقليمي لتسوية الخسائر',
      },
    }),
  );
  return registered ? { id: claim.id, estimatedLoss } : undefined;
}

/**
 * 🔴 A SHARE OF CLAIMS IS ACTUALLY SETTLED — message 46 §2.5.
 *
 * The seed recorded claims and never settled one, so every loss ratio on every dashboard read
 * zero: a loss ratio is settlements over premium, and the numerator had never been written. ⛔ How
 * it is computed is untouched here — what changes is that there is something to compute it from.
 *
 * Through `POST /claims/:id/settlement` as the CLAIMS actor, who holds `claim.settle.approve`.
 *
 * ⚠️ AND THE SECOND APPROVAL IS HONOURED RATHER THAN AVOIDED. A settlement at or above
 * `CLAIM_LARGE_THRESHOLD_JOD` (25,000) needs a second approver who is NOT the first — the seeded
 * losses run to 30,000, so some land there. Those are second-approved by the MANAGER, a different
 * person holding `claim.settle.second-approve`. ⛔ Capping every approved amount below the
 * threshold to keep this simple would seed a demo in which the maker/checker rule never fires,
 * and a rule nobody can see working is a rule nobody believes.
 */
async function settleClaim(
  app: INestApplication<App>,
  actors: Actors,
  claim: { id: string; estimatedLoss: number },
  tally: Tally,
): Promise<boolean> {
  /*
   * 🔴 SETTLING IS FOUR ACTS, NOT ONE — measured by running the seeder, not by reading the route.
   *
   * The first version posted straight to `/settlement` and every attempt answered
   * «Claim … is REGISTERED; record the insurer's assessment verdict … before settling.» The real
   * chain is documentation ⟶ submit for assessment ⟶ the insurer's verdict ⟶ settlement, and
   * each step is a separate route with its own guard. That is the product being right: a payout
   * recorded against a claim nobody assessed is the thing those guards exist to refuse.
   *
   * ⟶ So the seeder walks it, which also means the demo file holds claims at SEVERAL stages
   * rather than two — the ones that stop here are as useful to a presenter as the ones that
   * finish.
   *
   * ⛔ THE MANDATORY DOCUMENT LIST IS READ BACK, NEVER COPIED. `mandatoryDocTypesFor` is a
   * per-line matrix (`claim_form` always, plus a police report for a third party, plus the line
   * family's own); restating it here would be a second home for it, free to disagree the day the
   * matrix moves. `GET /claims/:id` already answers `missingMandatoryDocuments`.
   */
  const view = await attempt(tally, 'claimChecklistRead', () =>
    getAs<{ missingMandatoryDocuments: string[] }>(
      app,
      actors.claims.token,
      `/claims/${claim.id}`,
    ),
  );
  if (!view) return false;

  if (view.missingMandatoryDocuments.length > 0) {
    const attached = await attempt(tally, 'claimDocuments', () =>
      postAs(app, actors.claims.token, `/claims/${claim.id}/documents`, {
        documents: view.missingMandatoryDocuments.map((docType) => ({
          docType,
          /*
           * A MEDICAL REPORT IS SENSITIVE PERSONAL DATA under PDPL and the service refuses any
           * other classification for it by name. The rest are CONFIDENTIAL — a claim file is
           * not public, and INTERNAL would understate it.
           */
          classification:
            docType === 'medical_report'
              ? 'HIGHLY_CONFIDENTIAL'
              : 'CONFIDENTIAL',
          fileName: `not-a-real-document--demo-seed-${docType}-${nextSeq()}.pdf`,
          storageRef: `demo-seed/claims/${claim.id}/${docType}`,
        })),
      }),
    );
    if (!attached) return false;
  }

  const submitted = await attempt(tally, 'claimAssessmentSubmit', () =>
    postAs(
      app,
      actors.claims.token,
      `/claims/${claim.id}/assessment/submit`,
      {},
    ),
  );
  if (!submitted) return false;

  /*
   * ⚠️ AND A FIFTH ACT, found the same way: «the loss adjuster has not completed the survey and
   * investigation — record those … before the assessment verdict». The verdict is not the
   * insurer's opinion out of nowhere; it rests on somebody having been to look, and the route
   * refuses to let a demo pretend otherwise. Write-once per field.
   */
  const surveyed = await attempt(tally, 'claimAdjusterProgress', () =>
    postAs(
      app,
      actors.claims.token,
      `/claims/${claim.id}/assessment/adjuster-progress`,
      {
        surveyCompletedAt: isoDateDaysAgo(randomInt(2, 10)),
        investigationCompletedAt: isoDateDaysAgo(randomInt(1, 2)),
      },
    ),
  );
  if (!surveyed) return false;

  // APPROVED rather than PARTIALLY_APPROVED: the partial case carries its own conversation with
  // the customer, and a demo that only ever shows the disputed path misrepresents the ordinary one.
  const decided = await attempt(tally, 'claimAssessmentDecision', () =>
    postAs(
      app,
      actors.claims.token,
      `/claims/${claim.id}/assessment/decision`,
      {
        outcome: 'APPROVED',
      },
    ),
  );
  if (!decided) return false;

  // `approvedAmount` must be > 0 and <= estimatedLoss; `deductible` >= 0 and <= approvedAmount.
  const approved = Math.max(1, Math.round(claim.estimatedLoss * 0.85));
  const deductible = Math.max(0, Math.round(approved * 0.1));
  const settled = await attempt(tally, 'claimSettlement', () =>
    postAs<{ settlement?: { secondApproverRequired?: boolean } }>(
      app,
      actors.claims.token,
      `/claims/${claim.id}/settlement`,
      {
        approvedAmount: money(approved),
        deductible: money(deductible),
        brokerProcessedPayment: false,
      },
    ),
  );
  if (!settled) return false;
  if (settled.settlement?.secondApproverRequired === true) {
    await attempt(tally, 'claimSettlementSecondApproval', () =>
      postAs(
        app,
        actors.manager.token,
        `/claims/${claim.id}/settlement/second-approve`,
        {},
      ),
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// Complaints / Incidents / Vendors
// ---------------------------------------------------------------------------

async function seedComplaints(
  app: INestApplication<App>,
  actors: Actors,
  customerIds: string[],
  count: number,
  tally: Tally,
): Promise<void> {
  const categories = [
    'denied_claim',
    'delayed_issuance',
    'premium_dispute',
    'unanswered_claim',
    'other',
  ];
  for (let i = 0; i < count && customerIds.length > 0; i += 1) {
    await attempt(tally, 'complaint', () =>
      postAs(app, actors.compliance.token, '/complaints', {
        customerId: pick(customerIds),
        issue: pick([
          'مبلغ التسوية المعروض أقلّ بكثير من كلفة الإصلاح المقدَّرة.',
          'تأخّر تسليم مستندات الوثيقة أكثر من ثلاثة أسابيع.',
          'زاد قسط التجديد بلا توضيح.',
          'لم يصل ردّ بعد اتصالات متابعة متكرّرة عن مطالبة مفتوحة.',
        ]),
        category: pick(categories),
      }),
    );
  }
}

async function seedIncidents(
  app: INestApplication<App>,
  actors: Actors,
  count: number,
  tally: Tally,
): Promise<void> {
  const severities = ['low', 'medium', 'high', 'critical'];
  const samples = [
    {
      title: 'بريد احتيالي استهدف جهاز موظف مطالبات',
      description:
        'أبلغ موظف مطالبات عن بريد مشبوه يطلب بيانات الدخول، ولم يُفتَح الرابط.',
    },
    {
      title: 'حاسوب محمول تُرك بلا رقابة في غرفة اجتماع عميل',
      description:
        'تُرك حاسوب موظف تنسيب بلا رقابة لوقت قصير، والشاشة مقفلة ولم يُطّلَع على بيانات.',
    },
    {
      title: 'بريد أُرسل لغير صاحبه وفيه مستند عميل',
      description:
        'أُرسل جدول وثيقة إلى مستلم خطأ داخل المكتب نفسه، واستُرجع فوراً.',
    },
    {
      title: 'نمط دخول غير معتاد على حساب في المالية',
      description: 'سُجّلت محاولات دخول فاشلة متكرّرة خارج ساعات العمل.',
    },
    {
      title: 'مراجعة صلاحيات مورّد متأخّرة',
      description:
        'تبيّن في فحص التزام دوري أن مراجعة صلاحيات مورّد خارجي تأخّرت عن موعدها.',
    },
  ];
  for (let i = 0; i < count; i += 1) {
    const s = samples[i % samples.length];
    await attempt(tally, 'incident', () =>
      postAs(app, actors.compliance.token, '/incidents', {
        title: s.title,
        description: s.description,
        severity: pick(severities),
      }),
    );
  }
}

async function seedVendors(
  app: INestApplication<App>,
  actors: Actors,
  count: number,
  tally: Tally,
): Promise<void> {
  const types = [
    'reinsurer',
    'loss_adjuster',
    'it_cloud',
    'printing_archiving',
    'marketing_call_centre',
    'other',
  ];
  const names = [
    'المكتب الإقليمي لتسوية الخسائر',
    'السحابة الآمنة لخدمات الاستضافة',
    'النخبة للطباعة والأرشفة',
    'الأفق للتسويق ومركز الاتصال',
    'مجمّع إعادة التأمين الأردني',
    'القمّة للوازم المكتبية',
  ];
  for (let i = 0; i < count; i += 1) {
    await attempt(tally, 'vendor', () =>
      postAs(app, actors.compliance.token, '/vendors', {
        /*
         * ⚠️ THE SAME «#NN» ON A SECOND SCREEN, FOUND RATHER THAN NAMED. Message 53 §2 item 3
         * names the customer cards; `/vendors` carried it too. Measured: there are six names
         * and `NUM.vendorsPerOrg` is six, so `i % names.length` hands each out exactly once per
         * office, and `Vendor.name` carries no unique constraint — the suffix was distinguishing
         * nothing.
         */
        name: names[i % names.length],
        vendorType: types[i % types.length],
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

async function preflight(): Promise<void> {
  const orgA = await rawPrisma.organization.findUnique({
    where: { id: ORG_A_ID },
  });
  if (!orgA) {
    throw new Error(
      'Default organization not found in this database. Run `npm run db:seed` (against the DEV .env) first — ' +
        'this script only ADDS demo data on top of the base seed, it does not replace it.',
    );
  }
  const permissionCount = await rawPrisma.permission.count();
  if (permissionCount === 0) {
    throw new Error(
      'No RBAC permissions found. Run `npm run db:seed` first — it seeds Roles/Permissions before this ' +
        'script can grant any of them to the demo actor accounts.',
    );
  }
}

// ---------------------------------------------------------------------------
// Per-Organization orchestration
// ---------------------------------------------------------------------------

interface OrgSeedSummary {
  orgId: string;
  orgSlug: string;
  orgLabel: string;
  actors: Actors;
  customersCreated: number;
  leadFunnelCustomers: number;
  fullPipelinesCompleted: number;
  invoicesCreated: number;
  claimsCreated: number;
  /** Message 46 §2.1 — the chains that stop on purpose, so the report can name who sits where. */
  haltedChains: HaltedChain[];
  /** Message 46 §2.5 — how many of each were taken the rest of the way. */
  receiptsRecorded: number;
  claimsSettled: number;
  /** Message 53 §2 item 1 — how many policies got a commission ledger entry. The figure the
   *  executive and financial dashboards read, which was zero through every run before this. */
  commissionRecorded: number;
}

async function seedOrganization(
  app: INestApplication<App>,
  orgId: string,
  orgSlug: string,
  orgLabel: string,
  tally: Tally,
): Promise<OrgSeedSummary> {
  console.log(`\n=== ${orgLabel} (${orgSlug}) ===`);

  console.log('- actors...');
  const actors = await ensureActors(app, orgId, orgSlug, tally);
  const missing = ACTOR_ROLE_DEFS.map((d) => d.key).filter(
    (key) => !actors[key],
  );
  if (missing.length > 0) {
    throw new Error(
      `Could not provision these actor accounts for ${orgLabel}: ${missing.join(', ')} — see errors above. ` +
        `Every pipeline step below needs all 8.`,
    );
  }

  console.log('- insurers...');
  const insurers = await ensureInsurersForOrg(orgId, tally);
  await ensureCommissionAgreements(orgId, insurers, tally);
  if (orgId === ORG_A_ID && actors.admin) {
    /*
     * THE OFFICE ADMINISTRATOR, not the security administrator. `POST /insurers` requires
     * `insurer.create`, which only OFFICE_ADMINISTRATOR holds — so this call used to answer 403 and
     * the assertion below reported that the duplicate-name refusal "did not come", about a request
     * the collision check never reached. A 403 and a 409 are different failures and the old wording
     * could not tell them apart.
     */
    await proveDuplicateSpellingIsRefused(app, actors.officeAdmin.token);
  }

  console.log(`- ${NUM.employeesPerOrg} employees...`);
  await seedEmployees(app, actors, NUM.employeesPerOrg, tally);

  console.log(`- ${NUM.leadsPerOrg} leads across the funnel...`);
  const leadFunnelCustomers: SeededCustomer[] = [];
  for (let i = 0; i < NUM.leadsPerOrg; i += 1) {
    const stage =
      i < Math.round(NUM.leadsPerOrg * 0.3)
        ? 'CONVERTED'
        : i < Math.round(NUM.leadsPerOrg * 0.5)
          ? 'QUALIFIED'
          : i < Math.round(NUM.leadsPerOrg * 0.75)
            ? 'CONTACTED'
            : 'NEW';
    const customer = await seedLeadFunnel(app, actors, stage, tally);
    if (customer) leadFunnelCustomers.push(customer);
  }

  console.log(`- ${NUM.customersPerOrg} standalone customers...`);
  const standaloneCustomers: SeededCustomer[] = [];
  for (let i = 0; i < NUM.customersPerOrg; i += 1) {
    const customer = await attempt(tally, 'customer', () =>
      Math.random() < 0.55
        ? createIndividualCustomer(app, actors)
        : createCorporateCustomer(app, actors),
    );
    if (customer) standaloneCustomers.push(customer);
    if ((i + 1) % 50 === 0) console.log(`  ...${i + 1}/${NUM.customersPerOrg}`);
  }

  const allCustomers = [...standaloneCustomers, ...leadFunnelCustomers];

  /*
   * MESSAGE 53 §2 ITEM 2 — KYC BEFORE THE PIPELINES, so the rest of the run and every screen
   * after it sees customers in the state a real office's would be in. Measured: nothing outside
   * the KYC module reads `Customer.status`, so the order is about what the screens show rather
   * than about a gate.
   */
  /*
   * 🔴 MEASURED ON A FRESH DATABASE, 2026-11-25 — AND WITHOUT THIS STEP THE KYC ONE APPROVES
   * NOTHING AT ALL.
   *
   * The first run of `approveKycForShare` against an empty database logged, 58 times:
   *
   *   UNABLE_TO_SCREEN via Built-in watchlist cache (OFAC SDN + UN Consolidated). The local
   *   sanctions cache is empty — the watchlist sync has never completed. Run
   *   POST /watchlist-sync/run. This is NOT a clear result — the KYC file is escalated for
   *   compliance review.
   *
   * ⟶ `UNRESOLVED_SCREENING` is a REVIEW_REQUIRED hold, and this seeder does not waive one (see
   *   `approveKycForShare`) — so every file would stop there and the customer list would stay
   *   uniformly «بانتظار اعرف عميلك», which is the defect message 53 §2 item 2 exists to fix.
   *
   * ⛔ THE REMEDY IS THE ROUTE THE ERROR ITSELF NAMES, as the actor holding
   * `sanctions-pep.screen` — `COMPLIANCE_OFFICER` alone, measured, and nothing was granted. The
   * sweep is otherwise nightly, so a database minutes old has never had one.
   *
   * ⚠️ IT REACHES THE NETWORK, so on a machine with no route to the OFAC and UN lists it fails —
   * and that is recorded by `attempt` and said out loud rather than swallowed, because the
   * consequence (no KYC approvals) would otherwise look like a defect in the KYC step.
   */
  if (actors.compliance) {
    const synced = await attempt(tally, 'watchlistSync', () =>
      postAs(app, actors.compliance.token, '/watchlist-sync/run', {}),
    );
    console.log(
      synced
        ? '- watchlist sync run (the sanctions cache is empty on a fresh database)'
        : '- watchlist sync FAILED — screening will answer UNABLE_TO_SCREEN and NO KYC file can ' +
            'be approved without waiving a hold, which this seeder does not do',
    );
  }

  console.log(`- KYC on a share of ${allCustomers.length} customers...`);
  const kyc = await approveKycForShare(
    app,
    actors,
    allCustomers,
    NUM.kycShare,
    tally,
  );
  console.log(
    `  ...${kyc.started} files opened, ${kyc.approved} approved (the rest stay «بانتظار اعرف عميلك», which is what the KYC queue is for)`,
  );

  /*
   * THE LICENCE TERM COMES BEFORE THE PIPELINES, and the order is the whole point.
   *
   * An office with no term on record may not place new business (art. 21/a/9), so recording the term
   * after the pipelines would refuse every one of them and then licence an office with nothing in it —
   * which is exactly what happened to office B before this call existed: fifteen refusals, no
   * policies, no invoices, no claims, and a walkthrough describing an office that could not exist.
   */
  if (actors.compliance) {
    await ensureBrokerLicenseTermForOffice(
      app,
      orgSlug,
      actors.compliance.token,
      tally,
    );
    /*
     * MESSAGE 53 §2 ITEMS 8 AND 9 — the licence SCOPE and the obligations calendar, both of
     * which hang off the term just recorded and so cannot run before it. The scope is also
     * before the pipelines, which is where a real office's would be: an office places business
     * on lines its licence lists.
     */
    const branches = await recordLicensedScope(app, actors, orgId, tally);
    const obligations = await seedComplianceObligations(
      app,
      actors,
      orgId,
      tally,
    );
    console.log(
      `- licence scope: ${branches} licensed branch(es); compliance calendar: ${obligations} obligation(s)`,
    );
  }

  console.log(`- ${NUM.fullPipelinePerOrg} full sales-to-policy pipelines...`);
  const pipelineTargets = standaloneCustomers.slice(0, NUM.fullPipelinePerOrg);
  const policies: PipelineResult[] = [];
  for (let i = 0; i < pipelineTargets.length; i += 1) {
    const result = await runFullPipeline(
      app,
      actors,
      orgSlug,
      insurers,
      pipelineTargets[i].id,
      tally,
    );
    if (result && !isHalted(result)) policies.push(result);
    console.log(
      `  ...pipeline ${i + 1}/${pipelineTargets.length}${result && !isHalted(result) ? ' -> ' + result.policyNumber : ' (stopped early, see errors)'}`,
    );
  }

  /*
   * 🔴 THE CHAINS THAT STOP ON PURPOSE — message 46 §2.1.
   *
   * AFTER the full pipelines, on their OWN customers, taken from the far end of the standalone
   * list so the two sets cannot overlap: a customer who is both halfway through one chain and
   * the holder of a delivered policy is a worse demonstration than either, and a presenter
   * looking for "the one with no programme" would find a programme.
   */
  const haltedChains: HaltedChain[] = [];
  const schedule = haltedChainSchedule();
  const haltTargets = standaloneCustomers.slice(
    NUM.fullPipelinePerOrg,
    NUM.fullPipelinePerOrg + schedule.length,
  );
  if (haltTargets.length < schedule.length) {
    tally.errors.push(
      `[haltedChains] ${orgSlug} has ${haltTargets.length} customers free for ${schedule.length} ` +
        `halted chains — raise DEMO_CUSTOMERS_PER_ORG or lower HALTED_CHAINS_PER_OFFICE. The ` +
        `stages that got no customer are missing from the demo, which is what this says out loud.`,
    );
  }
  console.log(`- ${haltTargets.length} chains halted on purpose...`);
  for (let i = 0; i < haltTargets.length; i += 1) {
    const stage = schedule[i];
    const result = await runFullPipeline(
      app,
      actors,
      orgSlug,
      insurers,
      haltTargets[i].id,
      tally,
      stage,
      haltTargets[i].legalName,
    );
    if (isHalted(result)) {
      haltedChains.push(result);
      console.log(`  ...halted at ${stage} -> ${haltTargets[i].legalName}`);
    } else {
      /*
       * It ran past its stop, or it failed before reaching it. Either way the stage has one
       * fewer chain than the plan says, and a presenter told to look for it would find nothing.
       * ⛔ Counted and NAMED rather than silently absorbed — a halted-chain seeder whose output
       * nobody checks is indistinguishable from one that never ran.
       */
      bump(tally, 'failed', `halted:${stage}`);
      tally.errors.push(
        `[haltedChains] ${orgSlug}: the chain meant to stop at ${stage} did not — ` +
          `${haltTargets[i].legalName} is not sitting at that stage`,
      );
    }
  }

  console.log(`- invoices/claims on ${policies.length} issued policies...`);
  let invoicesCreated = 0;
  let claimsCreated = 0;
  let receiptsRecorded = 0;
  let claimsSettled = 0;
  let commissionRecorded = 0;
  for (let i = 0; i < policies.length; i += 1) {
    // MESSAGE 53 §2 ITEM 1 — on EVERY issued policy, not a share: an office earns commission on
    // every placement, so a policy without an entry is a hole in the figure rather than a state
    // worth demonstrating. See `recordCommission`.
    if (await recordCommission(app, actors, policies[i].policyId, tally)) {
      commissionRecorded += 1;
    }
    if (Math.random() < 0.75) {
      const invoice = await maybeInvoicePolicy(
        app,
        actors,
        policies[i].policyId,
        policies[i].premium,
        tally,
      );
      invoicesCreated += 1;
      /*
       * MESSAGE 46 §2.5 — about two thirds of invoices are actually paid.
       *
       * Not all of them: an ageing report with nothing outstanding has nothing to report, and
       * `/collections` exists to show what has NOT been collected. Two thirds puts a real figure
       * on the commission-income tiles and leaves a real figure on the ageing one.
       */
      if (invoice && Math.random() < 0.65) {
        if (await collectInvoice(app, actors, invoice, tally)) {
          receiptsRecorded += 1;
        }
      }
    }
    if (Math.random() < 0.4) {
      const claim = await maybeClaimPolicy(
        app,
        actors,
        policies[i].policyId,
        policies[i].inceptionDaysAgo,
        // Message 53 §2 item 7 — the line the cover is on, so the cause of loss can match it.
        policies[i].insuranceLine,
        tally,
      );
      claimsCreated += 1;
      /*
       * MESSAGE 46 §2.5 — about half of claims settle.
       *
       * The rest stay open, which is what the claims dashboard and the SLA screens are for. A
       * file where every claim is closed shows neither.
       */
      if (claim && Math.random() < 0.5) {
        if (await settleClaim(app, actors, claim, tally)) {
          claimsSettled += 1;
        }
      }
    }
  }

  /*
   * 🔴 MESSAGE 53 §2 — THE FOLLOW-UP ALERT, WHICH DECISION 158 §3 ASKED FOR AND NOTHING RAN.
   *
   * Process 27's sweep raises an alert on every REGISTERED claim the insurer has not answered
   * within the configured business days. It is otherwise NIGHTLY, so a presenter running the
   * seed in the morning opened `/claims` and the SLA screens with no alert on any of them — the
   * scheduler had never fired on a database that was minutes old.
   *
   * ⛔ Through `POST /claims/follow-up-sweep`, the route the screen's own control calls, as the
   * CLAIMS actor who holds `claim.followup.manage` — measured, `CLAIMS_OFFICER` alone, and
   * nothing was granted.
   *
   * ⛔ ONCE, AT THE END, AND AFTER THE CLAIMS: a sweep run before them has nothing to scan, which
   * is the ordering failure `ensureBrokerLicenseTermForOffice` records from the other direction.
   * It is idempotent by its own design (an alert already raised is not raised twice), so a
   * re-run costs nothing.
   */
  const sweep = await attempt(tally, 'claimFollowUpSweep', () =>
    postAs(app, actors.claims.token, '/claims/follow-up-sweep', {}),
  );
  console.log(
    sweep
      ? '- claim follow-up sweep run once (otherwise nightly, so a fresh database has no alerts)'
      : '- claim follow-up sweep FAILED — see the error tally; the SLA screens will show no alerts',
  );

  console.log(
    `- ${NUM.complaintsPerOrg} complaints, ${NUM.incidentsPerOrg} incidents, ${NUM.vendorsPerOrg} vendors...`,
  );
  await seedComplaints(
    app,
    actors,
    allCustomers.map((c) => c.id),
    NUM.complaintsPerOrg,
    tally,
  );
  await seedIncidents(app, actors, NUM.incidentsPerOrg, tally);
  await seedVendors(app, actors, NUM.vendorsPerOrg, tally);

  // LAST, because it has to pick an insurer that already holds policies — the deactivation screen
  // is only worth looking at when its five impact counts are not all zero.
  // `insurer.deactivate` is OFFICE_ADMINISTRATOR's, not the security administrator's — so this
  // step produced nothing at all until the actor was corrected, which is why office A's suspension
  // screen read five zeros: the impact counts are computed by the route this never reached.
  if (actors.officeAdmin) {
    console.log('- deactivating one insurer that has live commitments...');
    await deactivateOneInsurerWithCommitments(
      app,
      orgId,
      actors.officeAdmin.token,
      tally,
    );
  }

  return {
    orgId,
    orgSlug,
    orgLabel,
    actors,
    customersCreated: allCustomers.length,
    leadFunnelCustomers: leadFunnelCustomers.length,
    fullPipelinesCompleted: policies.length,
    invoicesCreated,
    claimsCreated,
    haltedChains,
    receiptsRecorded,
    claimsSettled,
    commissionRecorded,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

it(
  'seeds demo data for two Organizations through the real API',
  async () => {
    const tally = newTally();
    // Two offices are the POINT of this script, so the one-Organization guard in
    // `createTestApp` does not apply to it — see `CreateTestAppOptions`. Passing this is what
    // makes the run repeatable: before it, the first run created Office B and every later run
    // was refused before reaching a single line of seeding logic.
    const app = await createTestApp({ multipleOrganizationsAreExpected: true });
    // Captured rather than allowed to propagate, so the release below still runs
    // and can never replace the error that actually caused it.
    let fatal: Error | undefined;
    try {
      console.log('Running preflight checks...');
      await preflight();

      console.log('Ensuring Office B exists...');
      const existingOrgB = await rawPrisma.organization.findUnique({
        where: { id: ORG_B_ID },
      });
      if (!existingOrgB) {
        await rawPrisma.organization.create({
          data: {
            id: ORG_B_ID,
            legalName: ORG_B_LEGAL_NAME,
            legalNameAr: ORG_B_LEGAL_NAME_AR,
            subdomain: ORG_B_SUBDOMAIN,
            // Brokerage office, not an insurance company. `OrganizationType` carries NO default:
            // neither kind is a safe fallback for the other, so every creator states which it is.
            type: 'BROKERAGE_OFFICE',
            // Required for a brokerage office by the `Organization_broker_kind_matches_type`
            // CHECK. The compiler cannot ask for it — a nullable column is optional in
            // Prisma's CreateInput — so the database is what refuses its absence.
            brokerKind: 'CORPORATE',
          },
        });
      }
      // The new-office rule. Runs on every pass, not just on creation, so an
      // Office B created by an earlier version of this script also ends up with
      // one — the same reason every other step here is idempotent.
      for (const orgId of [ORG_A_ID, ORG_B_ID]) {
        await ensureOfficeAdministrator(orgId);
      }

      /*
       * Both demo offices take the owner's names (decision 150 ruling 6). Idempotent and
       * unconditional: office A already existed under the base seed's placeholder, so this is a
       * rename rather than a creation, and it must run on every pass for the same reason every
       * other step here does.
       */
      for (const [orgId, legalName, legalNameAr] of [
        [ORG_A_ID, ORG_A_LEGAL_NAME, ORG_A_LEGAL_NAME_AR],
        [ORG_B_ID, ORG_B_LEGAL_NAME, ORG_B_LEGAL_NAME_AR],
      ] as const) {
        await rawPrisma.organization.update({
          where: { id: orgId },
          data: { legalName, legalNameAr },
        });
      }
      verifyWalkthroughNamesTheOffices();
      const orgAName = ORG_A_LEGAL_NAME;

      // Each Organization is seeded independently — a hard failure in Office A
      // (e.g. its actor accounts could not be provisioned) must not prevent
      // Office B from being attempted, and vice versa.
      const summaries: OrgSeedSummary[] = [];
      for (const [orgId, orgSlug, orgLabel] of [
        [ORG_A_ID, ORG_A_SLUG, orgAName],
        [ORG_B_ID, ORG_B_SLUG, ORG_B_LEGAL_NAME],
      ] as const) {
        try {
          summaries.push(
            await seedOrganization(app, orgId, orgSlug, orgLabel, tally),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`\n!!! ${orgLabel} FAILED entirely: ${message}\n`);
          tally.errors.push(`[org:${orgSlug}] ${message}`);
        }
      }

      /*
       * MESSAGE 46 §2.2 — office B's licence goes past expiry LAST, once everything it was going
       * to produce has been produced. See `expireOfficeLicenceAwaitingDeclaration`'s header for
       * why the order is load-bearing and why office A keeps a valid term.
       */
      const officeB = summaries.find((s) => s.orgSlug === ORG_B_SLUG);
      if (officeB) {
        console.log(
          "Putting Office B's licence past expiry, awaiting its declaration...",
        );
        await expireOfficeLicenceAwaitingDeclaration(app, officeB, tally);
      }

      // ------------------------------------------------------------------
      // Report
      // ------------------------------------------------------------------
      const totalCreated = Object.values(tally.created).reduce(
        (a, b) => a + b,
        0,
      );
      const totalFailed = Object.values(tally.failed).reduce(
        (a, b) => a + b,
        0,
      );

      console.log('\n================ DEMO SEED SUMMARY ================');
      for (const summary of summaries) {
        console.log(`\n${summary.orgLabel}:`);
        console.log(
          `  customers: ${summary.customersCreated} (of which ${summary.leadFunnelCustomers} came through the lead funnel)`,
        );
        console.log(
          `  full pipelines completed (ACTIVE-track policies): ${summary.fullPipelinesCompleted}`,
        );
        console.log(
          `  invoices: ${summary.invoicesCreated} (${summary.receiptsRecorded} collected), ` +
            `claims: ${summary.claimsCreated} (${summary.claimsSettled} settled)`,
        );
        // Message 53 §2 item 1 — printed against the policy count, because what matters is
        // whether EVERY placement earned one: a short figure names how many were refused.
        console.log(
          `  commission ledger entries: ${summary.commissionRecorded} of ` +
            `${summary.fullPipelinesCompleted} issued policies`,
        );
        /*
         * 🔴 WHICH CUSTOMER SITS AT WHICH STAGE — message 46 §2.1 asks for this by name.
         *
         * A presenter needs to be able to FIND the half-finished work, and a count cannot tell
         * them where to click. Customer names are seed data (generated here, from this script's
         * own pools) so printing them discloses nothing about anybody.
         */
        console.log('  chains halted on purpose:');
        for (const stage of HALTED_STAGES) {
          const at = summary.haltedChains.filter((c) => c.halted === stage);
          if (at.length === 0) {
            console.log(
              `    ${stage.padEnd(28)} NONE — the presenter has nothing to open at this stage`,
            );
            continue;
          }
          for (const chain of at) {
            const extra =
              chain.halted === 'rfqIssuedAwaitingEvidence'
                ? `  (${chain.insurerCount} insurer(s), evidence waiting: ${chain.evidenceWaiting ? 'yes' : 'NO'})`
                : '';
            console.log(
              `    ${stage.padEnd(28)} ${chain.customerLabel}${extra}`,
            );
          }
        }
        console.log(`  demo login (password for all: ${DEMO_PASSWORD}):`);
        for (const actor of Object.values(summary.actors)) {
          console.log(`    ${actor.label.padEnd(32)} ${actor.email}`);
        }
      }
      console.log(
        `\nRows created: ${totalCreated}  |  Failed attempts: ${totalFailed}`,
      );
      if (totalFailed > 0) {
        console.log(
          '\nFirst 20 failures (non-fatal — everything else above still got created):',
        );
        for (const line of tally.errors.slice(0, 20))
          console.log(`  - ${line}`);
        if (tally.errors.length > 20)
          console.log(
            `  ... and ${tally.errors.length - 20} more (see the full report file).`,
          );
      }
      console.log('=====================================================\n');

      await verifyBothOfficesCarryTheDemoLicence();

      const reportPath = path.join(__dirname, 'seed-demo-report.json');
      fs.writeFileSync(
        reportPath,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            config: NUM,
            // The password is deliberately NOT written here. This file is gitignored, but "not
            // committed" is not the same as "not on disk": the whole point of taking the password
            // from the environment is that it stops existing in a file anybody can open, and a
            // report that helpfully records it puts it straight back. Whoever set DEMO_PASSWORD for
            // the run is the one who knows it.
            passwordRecorded: false,
            totals: { created: tally.created, failed: tally.failed },
            errors: tally.errors,
            organizations: summaries.map((s) => ({
              orgId: s.orgId,
              orgLabel: s.orgLabel,
              customersCreated: s.customersCreated,
              leadFunnelCustomers: s.leadFunnelCustomers,
              fullPipelinesCompleted: s.fullPipelinesCompleted,
              invoicesCreated: s.invoicesCreated,
              claimsCreated: s.claimsCreated,
              receiptsRecorded: s.receiptsRecorded,
              claimsSettled: s.claimsSettled,
              commissionRecorded: s.commissionRecorded,
              /*
               * 🔴 THE STAGE TABLE GOES IN THE FILE, NOT ONLY IN THE CONSOLE — message 46 §2.1
               * asks for the run to name which customer sits at which stage.
               *
               * Measured 2026-11-18: vitest SWALLOWS the seeder's `console.log` output, so the
               * summary printed at the end of a successful run reaches nobody. The report file is
               * what a presenter can actually open — and it is the one place the stage table is
               * guaranteed to survive the runner.
               *
               * Customer names are seed data, generated by this script's own pools, so writing
               * them here discloses nothing about anybody.
               */
              haltedChains: s.haltedChains.map((c) => ({
                stage: c.halted,
                customer: c.customerLabel,
                ...(c.halted === 'rfqIssuedAwaitingEvidence'
                  ? {
                      rfqId: c.rfqId,
                      insurerCount: c.insurerCount,
                      evidenceWaiting: c.evidenceWaiting,
                    }
                  : {}),
              })),
              actors: Object.fromEntries(
                Object.entries(s.actors).map(([key, actor]) => [
                  key,
                  { email: actor.email, label: actor.label },
                ]),
              ),
            })),
          },
          null,
          2,
        ),
      );
      console.log(`Full report written to ${reportPath}`);
    } catch (err) {
      fatal = err instanceof Error ? err : new Error(String(err));
    }

    // Reached on every path — the catch above swallows anything the body threw.
    // Deliberately not a `finally`: throwing out of one is `no-unsafe-finally`,
    // and it would swallow the real error on its way past.
    console.log('');
    console.log('Releasing actor logins for human sign-in (MFA reset)...');
    await releaseActorsForHumanLogin();
    const stillLocked = await findLockedDemoActors();
    const totalActors = DEMO_ORGS.length * ACTOR_ROLE_DEFS.length;
    console.log(
      stillLocked.length === 0
        ? `All ${totalActors} demo accounts released — password-only sign-in, ` +
            'MFA enrolment on first login.'
        : `!!! ${stillLocked.length} demo account(s) STILL LOCKED.`,
    );

    await app.close();
    await rawPrisma.$disconnect();

    if (fatal) throw fatal;
    if (brokenPromises.length > 0) {
      throw new Error(
        `Seeding finished and the data is in place, but ${brokenPromises.length} promise(s) that ` +
          `docs/first-run.md makes to its reader could NOT be confirmed against this run:\n  - ` +
          `${brokenPromises.join('\n  - ')}\n` +
          'The environment is usable; the DOCUMENT is wrong until that is fixed.',
      );
    }
    if (stillLocked.length > 0) {
      throw new Error(
        `Seeding finished, but ${stillLocked.length} demo account(s) are still ` +
          `behind a six-digit prompt nobody can answer: ` +
          `${stillLocked.join(', ')}. Their TOTP secret was generated in this ` +
          `process and never shown to anyone. Clear MfaCredential and set ` +
          `mfaEnabled = false for them before demoing.`,
      );
    }
  },
  30 * 60_000,
);
