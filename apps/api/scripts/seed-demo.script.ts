import { it } from 'vitest';
import { lineCodeForProgrammeLine } from '../src/modules/insurance-program/insurance-program.config';
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
const ORG_A_LABEL = 'Default Brokerage Office';

const ORG_B_ID = '00000000-0000-0000-0000-0000000000b1';
const ORG_B_SLUG = 'office-b';
const ORG_B_SUBDOMAIN = 'demo-office-b';
const ORG_B_LEGAL_NAME = 'Rawabi Insurance Brokerage (demo)';
const ORG_B_LEGAL_NAME_AR = 'شركة الروابي لوساطة التأمين (تجريبي)';

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

// ---------------------------------------------------------------------------
// Name / content pools (Arabic-first — this system's primary language)
// ---------------------------------------------------------------------------

const GIVEN_NAMES_M = [
  'محمد', 'أحمد', 'عمر', 'خالد', 'يوسف', 'إبراهيم', 'عبدالله', 'سامي',
  'فادي', 'مراد', 'زيد', 'قصي', 'باسل', 'هاني', 'رامي', 'طارق', 'ماجد',
  'نضال', 'وليد', 'سعد',
];
const GIVEN_NAMES_F = [
  'فاطمة', 'مريم', 'سارة', 'رنا', 'هبة', 'لينا', 'ريم', 'دانة', 'نور',
  'رهف', 'ياسمين', 'دعاء', 'سلمى', 'آية', 'لبنى', 'هالة', 'منى', 'غادة',
  'إيمان', 'شذى',
];
const MIDDLE_NAMES = [
  'محمود', 'حسين', 'سالم', 'فهد', 'رشيد', 'منصور', 'جميل', 'كريم', 'عادل', 'ناصر',
];
const FAMILY_NAMES = [
  'الخطيب', 'العبدالله', 'النابلسي', 'القاسم', 'الحوراني', 'السعدي',
  'المصري', 'الزعبي', 'الشوابكة', 'التميمي', 'العدوان', 'الرفاعي',
  'الخوالدة', 'الحياري', 'البدور', 'العمري', 'السرحان', 'القرالة',
  'الطراونة', 'الزيود',
];

const COMPANY_PREFIXES = [
  'شركة الأمل', 'شركة النخبة', 'شركة الرواد', 'مجموعة الأفق', 'شركة الوفاء',
  'شركة المستقبل', 'شركة الاتحاد', 'شركة النور', 'شركة الرياض',
  'مجموعة السلام', 'شركة الفا', 'شركة الياسمين',
];
const COMPANY_SUFFIXES = [
  'للتجارة العامة', 'للمقاولات', 'للصناعات الغذائية', 'للاستشارات',
  'لتكنولوجيا المعلومات', 'للنقل والشحن', 'للتوزيع', 'للخدمات اللوجستية',
  'للتصنيع', 'للاستثمار العقاري',
];
const SECTORS = [
  'Manufacturing', 'Retail Trade', 'Construction', 'Healthcare',
  'Logistics & Transport', 'Information Technology', 'Food & Beverage',
  'Real Estate', 'Professional Services', 'Hospitality',
];
const CITIES = [
  'عمّان، الأردن', 'إربد، الأردن', 'الزرقاء، الأردن', 'العقبة، الأردن',
  'السلط، الأردن', 'مادبا، الأردن', 'الكرك، الأردن',
];
const LEAD_SOURCES = [
  'referral', 'website', 'social_media', 'campaign', 'tender',
  'bank_partner', 'strategic_partner', 'ex_customer', 'renewal',
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
const LOCAL_INSURER_SEEDS: Record<'a' | 'b', { legalName: string; legalNameAr: string; lines: string[] }[]> = {
  a: [
    { legalName: 'Petra Takaful (demo)', legalNameAr: 'بترا للتكافل', lines: ['Group Medical', 'Group Life'] },
    { legalName: 'Yarmouk Insurance (demo)', legalNameAr: 'شركة اليرموك للتأمين', lines: ['Motor Fleet', 'Property All Risks'] },
  ],
  b: [
    { legalName: 'Zarqa Mutual (demo)', legalNameAr: 'الزرقاء التعاونية', lines: ['Public Liability'] },
    // The same company as office A's second entry. Same canonical key, different spelling — which
    // is what makes the cross-office directory show one company rather than two.
    { legalName: 'YARMOUK   insurance (demo)', legalNameAr: 'شركه اليرموك للتامين', lines: ['Motor Fleet'] },
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
const DUPLICATE_SPELLING_DEMO = {
  attempt: 'yarmouk insurance (Demo)',
  attemptAr: 'شركة اليرموك للتامين',
  collidesWith: 'Yarmouk Insurance (demo)',
} as const;

const INSURER_SEEDS: InsurerSeed[] = [
  { legalName: 'Jordan Insurance Company (demo)', legalNameAr: 'الشركة الأردنية للتأمين', lines: ['Motor Fleet', 'Property All Risks', 'Marine Cargo / Goods in Transit'] },
  { legalName: 'Middle East Insurance Company (demo)', legalNameAr: 'الشركة الشرق أوسطية للتأمين', lines: ['Motor Fleet', 'Public Liability', 'Group Medical'] },
  { legalName: 'Arabia Insurance Jordan (demo)', legalNameAr: 'شركة العربية للتأمين - الأردن', lines: ['Property All Risks', 'Machinery Breakdown', 'Marine Cargo / Goods in Transit'] },
  { legalName: 'Jordan French Insurance (demo)', legalNameAr: 'الأردنية الفرنسية للتأمين', lines: ['Motor Fleet', 'Group Medical', 'Group Life'] },
  { legalName: 'National Ahlia Insurance (demo)', legalNameAr: 'الأهلية الوطنية للتأمين', lines: ['Property All Risks', 'Public Liability', 'Motor Fleet'] },
  { legalName: 'Al-Manara Insurance (demo)', legalNameAr: 'شركة المنارة للتأمين', lines: ['Group Medical', 'Group Life', 'Public Liability'] },
];

function personName(): { given: string; father: string; grandfather: string; family: string; gender: 'M' | 'F' } {
  const gender: 'M' | 'F' = Math.random() < 0.6 ? 'M' : 'F';
  const given = gender === 'M' ? pick(GIVEN_NAMES_M) : pick(GIVEN_NAMES_F);
  return {
    given,
    father: pick(MIDDLE_NAMES),
    grandfather: pick(MIDDLE_NAMES),
    family: pick(FAMILY_NAMES),
    gender,
  };
}

function companyName(): string {
  return `${pick(COMPANY_PREFIXES)} ${pick(COMPANY_SUFFIXES)} #${nextSeq()}`;
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
  role: RoleName;
  label: string;
}
type ActorKey =
  | 'sales' | 'placement' | 'policyCheck' | 'claims'
  | 'finance' | 'compliance' | 'manager' | 'admin';

/** The ONE definition of a demo actor's address. `ensureActor` creates the
 * account under it and `releaseActorsForHumanLogin` finds it again by it, so a
 * rename cannot leave the release hunting for accounts that no longer answer
 * to that name — which would strand them behind MFA, silently. */
function actorEmail(orgSlug: string, key: ActorKey): string {
  return `demo.${key}@${orgSlug}.ibms.internal`;
}

const ACTOR_ROLE_DEFS: ActorRoleDef[] = [
  { key: 'sales', role: RoleName.SALES_RELATIONSHIP_OFFICER, label: 'Sales Relationship Officer' },
  { key: 'placement', role: RoleName.PLACEMENT_TECHNICAL_OFFICER, label: 'Placement Technical Officer' },
  { key: 'policyCheck', role: RoleName.POLICY_CHECKING_OFFICER, label: 'Policy Checking Officer' },
  { key: 'claims', role: RoleName.CLAIMS_OFFICER, label: 'Claims Officer' },
  { key: 'finance', role: RoleName.FINANCE_COLLECTIONS_OFFICER, label: 'Finance & Collections Officer' },
  { key: 'compliance', role: RoleName.COMPLIANCE_OFFICER, label: 'Compliance Officer' },
  { key: 'manager', role: RoleName.BRANCH_DEPARTMENT_MANAGER, label: 'Branch / Department Manager' },
  { key: 'admin', role: RoleName.SYSTEM_SECURITY_ADMINISTRATOR, label: 'System Security Administrator' },
];

interface Actor {
  id: string;
  email: string;
  token: string;
  label: string;
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
 * the grid (`employee.create`, `employee.update`, `role.manage`), so the demo
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
    where: { organizationId_name: { organizationId: ORG_A_ID, name: roleName } },
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
async function ensureActor(
  orgId: string,
  orgSlug: string,
  def: ActorRoleDef,
): Promise<{ id: string; email: string; label: string }> {
  const email = actorEmail(orgSlug, def.key);
  let user = await rawPrisma.user.findFirst({ where: { organizationId: orgId, email } });
  if (!user) {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
    const actorName = personName();
    user = await rawPrisma.user.create({
      data: {
        organizationId: orgId,
        // A person's name, not their job title. This used to read
        // `Demo ${def.label}` — so every demo account showed "Demo Sales
        // Relationship Officer" in the navbar, with initials to match, while
        // the linked Employee row held the real four-part Arabic name.
        fullName: `${actorName.given} ${actorName.father} ${actorName.family}`,
        email,
        passwordHash,
        mustChangePassword: false,
        languagePreference: 'AR' as LanguagePreference,
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
  return { id: user.id, email, label: def.label };
}

async function loginActor(app: INestApplication<App>, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: DEMO_PASSWORD });
  if (res.status !== 200) {
    throw new Error(
      `Login failed for ${email} -> ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  const body = res.body as { accessToken?: string; mfaRequired?: boolean; outcome?: string };
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
async function enrolMfa(app: INestApplication<App>, token: string): Promise<void> {
  const enroll = await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(token));
  if (enroll.status < 200 || enroll.status >= 300) {
    throw new Error(`MFA enrol failed -> ${enroll.status}: ${JSON.stringify(enroll.body)}`);
  }
  const { credentialId, otpAuthUri } = enroll.body as {
    credentialId: string;
    otpAuthUri: string;
  };
  const verify = await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(token))
    .send({ credentialId, code: authenticator.generate(secretFromOtpAuthUri(otpAuthUri)) });
  if (verify.status < 200 || verify.status >= 300) {
    throw new Error(`MFA verify failed -> ${verify.status}: ${JSON.stringify(verify.body)}`);
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
      return { id: created.id, email: created.email, token, label: created.label };
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
        tally.errors.push(`insurer line "${x.line}" has no catalogue code — skipped`);
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
      companyCorrespondenceAddress: pick(['عمان - شارع الملكة رانيا', 'عمان - العبدلي', 'إربد - شارع الجامعة']),
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
    });

  if (res.status !== 409) {
    throw new Error(
      [
        `The walkthrough promises that registering ${JSON.stringify(DUPLICATE_SPELLING_DEMO.attempt)} in office A is refused`,
        `because ${JSON.stringify(DUPLICATE_SPELLING_DEMO.collidesWith)} is already registered there, but POST /insurers answered`,
        `${res.status}, not 409: ${JSON.stringify(res.body)}.`,
        'Either the canonical name key changed or the office A seed no longer holds the colliding name.',
        'Fix the step in docs/first-run.md (§ the duplicate she is asked to try) before this seed is used for a demo.',
      ].join(' '),
    );
  }

  // A 409 is the right status for several distinct collisions on this endpoint, so check it is THIS
  // one: the message names the spelling that was attempted, and points at reactivation because an
  // insurer is never deleted and the existing row may be one the office deactivated. Both
  // properties are pinned independently by `insurer-crud.e2e-spec.ts`, so this stays a check on the
  // demo rather than a second copy of that test.
  const message = String((res.body as { message?: unknown }).message ?? '');
  const namesTheAttempt = message.toLowerCase().includes(DUPLICATE_SPELLING_DEMO.attempt.toLowerCase());
  if (!namesTheAttempt || !message.includes('reactivate')) {
    throw new Error(
      [
        'POST /insurers refused with 409, but not recognisably for the name collision the walkthrough',
        `describes — the message neither quotes ${JSON.stringify(DUPLICATE_SPELLING_DEMO.attempt)} nor mentions reactivation:`,
        JSON.stringify(res.body),
      ].join(' '),
    );
  }
  console.log(
    `  - duplicate-spelling demo verified: ${JSON.stringify(DUPLICATE_SPELLING_DEMO.attempt)} -> 409`,
  );
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
    tally.errors.push('no insurer in this office holds a policy — nothing deactivated, so the impact counts would all read zero');
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
    tally.errors.push(`could not deactivate insurer ${insurerId}: ${(err as Error).message}`);
    return null;
  }
}

async function ensureInsurersForOrg(orgId: string, tally: Tally): Promise<OrgInsurer[]> {
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
          underwriterContact: 'Underwriting Desk',
          creditTermsDays: pick([30, 45, 60]),
        },
      });
    }
    await attachCompanyFactsAndLines(relationship.id, orgId, seed.lines, tally);
    out.push({ id: relationship.id, insurerMasterId: master.id, name: seed.legalName, lines: seed.lines });
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
    out.push({ id: local.id, insurerMasterId: null, name: seed.legalName, lines: seed.lines });
  }
  return out;
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
    for (const line of insurer.lines) {
      await attempt(tally, 'commissionAgreement', async () => {
        const existing = await rawPrisma.commissionAgreement.findFirst({
          where: { organizationId: orgId, insurerId: insurer.id, insuranceLine: line },
        });
        if (existing) return existing;
        return rawPrisma.commissionAgreement.create({
          data: {
            organizationId: orgId,
            insurerId: insurer.id,
            insuranceLine: line,
            ratePercent: money(randomInt(10, 20)).replace(/\.000$/, '.00'),
            vatRatePercent: '16.00',
            effectiveFrom: new Date(isoDateDaysAgo(365)),
          },
        });
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
        where: { id: { in: Object.values(actors).map((a) => a.id) }, employeeId: { not: null } },
        select: { id: true },
      })
    ).map((u) => u.id),
  );
  const linkableActors = Object.values(actors).filter((a) => !alreadyLinked.has(a.id));
  for (let i = 0; i < count; i += 1) {
    await attempt(tally, 'employee', async () => {
      const name = personName();
      const linkUser = i < linkableActors.length ? linkableActors[i] : undefined;
      return postAs(app, actors.admin.token, '/employees', {
        givenName: name.given,
        fatherName: name.father,
        grandfatherName: name.grandfather,
        familyName: name.family,
        nationalId: jordanianNationalId(),
        position: pick(['Account Executive', 'Underwriting Assistant', 'Claims Handler', 'Compliance Analyst', 'Office Administrator', 'Branch Manager']),
        hireDate: isoDateDaysAgo(randomInt(60, 2000)),
        licensedRole: Math.random() < 0.4 ? 'CBJ Licensed Insurance Broker' : undefined,
        userId: linkUser?.id,
      });
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

async function createLead(app: INestApplication<App>, actors: Actors): Promise<{ id: string }> {
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

async function createCorporateCustomer(app: INestApplication<App>, actors: Actors, prospectId?: string): Promise<SeededCustomer> {
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
  const created = await postAs<{ id: string }>(app, actors.sales.token, '/customers', body);
  return { id: created.id, legalName };
}

async function createIndividualCustomer(app: INestApplication<App>, actors: Actors, prospectId?: string): Promise<SeededCustomer> {
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
  const created = await postAs<{ id: string }>(app, actors.sales.token, '/customers', body);
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
    postAs(app, actors.sales.token, `/leads/${lead.id}/transition`, { toStatus: 'CONTACTED' }),
  );
  if (stage === 'CONTACTED') return undefined;

  await attempt(tally, 'leadTransition', () =>
    postAs(app, actors.sales.token, `/leads/${lead.id}/transition`, { toStatus: 'QUALIFIED' }),
  );
  if (stage === 'QUALIFIED') return undefined;

  const prospect = await attempt(tally, 'prospect', () =>
    postAs<{ id: string }>(app, actors.sales.token, '/prospects', {
      leadId: lead.id,
      companyName: companyName(),
      sector: pick(SECTORS),
      activity: pick(SECTORS),
      employeeCount: randomInt(3, 250),
      businessSize: pick(['Small', 'Medium', 'Large']),
      location: pick(CITIES),
      contactPerson: `${pick(GIVEN_NAMES_M)} ${pick(FAMILY_NAMES)}`,
      productsOfInterest: pickN(['Property', 'Motor Fleet', 'Group Medical', 'Marine', 'Liability'], 2),
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
}

/** The Risk Profile / Policy schedule figures — built once per pipeline run
 * and reused for BOTH the issued schedule and the checking step's requested
 * coverage, so they match exactly (a mismatch drives the policy into
 * DISCREPANCY, which is a realistic state to show but not the default one
 * this script aims for). */
function buildCoverageFigures(): { limits: Record<string, string>; sumsInsured: Record<string, string> } {
  const total = randomInt(50_000, 750_000);
  return {
    limits: { perOccurrence: money(total), aggregate: money(total * 2) },
    sumsInsured: { total: money(total) },
  };
}

async function runFullPipeline(
  app: INestApplication<App>,
  actors: Actors,
  orgSlug: string,
  insurers: OrgInsurer[],
  customerId: string,
  tally: Tally,
): Promise<PipelineResult | undefined> {
  const riskProfile = await attempt(tally, 'riskProfile', () =>
    postAs<{ id: string }>(app, actors.sales.token, '/risk-profiles', {
      customerId,
      siteLabel: 'Head Office',
      priorClaimsHistorySummary: 'No prior claims reported in the past 3 years.',
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
    await postAs(app, actors.sales.token, `/needs-assessments/${needsAssessment.id}/submit`, {});
    await postAs(app, actors.manager.token, `/needs-assessments/${needsAssessment.id}/review`, {});
    await postAs(app, actors.manager.token, `/needs-assessments/${needsAssessment.id}/approve`, {});
    return true;
  });
  if (!naOk) return undefined;

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
  const designedLines = new Set((program.lines ?? []).map((l) => l.insuranceLine));

  const programFinalized = await attempt(tally, 'insuranceProgramFinalize', () =>
    postAs(app, actors.placement.token, `/insurance-programs/${program.id}/finalize`, {}),
  );
  if (!programFinalized) return undefined;

  const opportunity = await attempt(tally, 'opportunity', () =>
    postAs<{ id: string }>(app, actors.placement.token, '/opportunities', {
      insuranceProgramId: program.id,
    }),
  );
  if (!opportunity) return undefined;

  // Pick from the INTERSECTION of what this programme designed and what each
  // insurer actually writes. Picking an insurer first and then one of its own
  // lines (the obvious order) 422s whenever that line is not on the
  // programme — which was ~1 pipeline in 3 before this.
  const eligible = insurers
    .map((i) => ({ insurer: i, lines: i.lines.filter((l) => designedLines.has(l)) }))
    .filter((e) => e.lines.length > 0);
  if (eligible.length === 0) {
    // Possible in principle (a questionnaire designing only lines no demo
    // insurer writes) and worth counting rather than silently dropping.
    bump(tally, 'failed', 'rfqNoEligibleInsurer');
    tally.errors.push(
      `[rfqNoEligibleInsurer] programme designed [${[...designedLines].join(', ')}] — no demo insurer writes any of them`,
    );
    return undefined;
  }
  const chosen = pick(eligible);
  const insurer = chosen.insurer;
  const insuranceLine = pick(chosen.lines);
  const rfq = await attempt(tally, 'rfq', () =>
    postAs<{ id: string }>(app, actors.placement.token, '/rfqs', {
      opportunityId: opportunity.id,
      insuranceLine,
      insurerIds: [insurer.id],
    }),
  );
  if (!rfq) return undefined;

  const premium = randomInt(500, 45_000);
  const quotation = await attempt(tally, 'quotation', () =>
    postAs<{ current?: { id: string }; id?: string }>(app, actors.placement.token, '/quotations', {
      rfqId: rfq.id,
      insurerId: insurer.id,
      premium: money(premium),
      currency: 'JOD',
      deductible: money(Math.max(50, Math.round(premium * 0.05))),
      commissionRatePercent: '12.50',
    }),
  );
  if (!quotation) return undefined;
  const quotationId = quotation.current?.id ?? quotation.id;
  if (!quotationId) {
    bump(tally, 'failed', 'quotationId');
    return undefined;
  }

  const comparisonOk = await attempt(tally, 'comparison', () =>
    postAs(app, actors.placement.token, '/comparison-matrices', { rfqId: rfq.id }),
  );
  if (!comparisonOk) return undefined;

  const recommendation = await attempt(tally, 'recommendation', () =>
    postAs<{ id: string }>(app, actors.placement.token, '/recommendations', {
      opportunityId: opportunity.id,
      recommendedQuotationId: quotationId,
      rationale: 'Best overall balance of coverage breadth, competitive pricing and insurer standing for this risk profile.',
      rationaleFactors: {
        coverage: 'Coverage matches every line the needs assessment recommended.',
        price: 'Most competitive premium among the insurers approached.',
        financialStrength: 'The insurer carries a strong regional financial-strength rating.',
        claimsService: 'Established, responsive local claims-handling track record.',
        deductible: 'Deductible level is appropriate for the client size and risk appetite.',
        policyConditions: 'Standard market wording with no unusual exclusions.',
      },
    }),
  );
  if (!recommendation) return undefined;

  const sent = await attempt(tally, 'recommendationSend', () =>
    postAs(app, actors.placement.token, `/recommendations/${recommendation.id}/send`, {}),
  );
  if (!sent) return undefined;

  const decisionOk = await attempt(tally, 'clientDecision', () =>
    postAs(app, actors.sales.token, '/client-decisions', {
      opportunityId: opportunity.id,
      decision: 'ACCEPT',
      evidenceType: 'email_confirmation',
      evidenceRef: uniqueEmail('client-acceptance'),
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
    }),
  );
  if (!policy) return undefined;

  const policyNumber = `POL-${orgSlug.toUpperCase()}-${Date.now()}-${nextSeq()}`;
  const coverage = buildCoverageFigures();
  const issued = await attempt(tally, 'policyIssuance', () =>
    postAs(app, actors.placement.token, `/policies/${policy.id}/issuance`, {
      policyNumber,
      issuedPremium: money(premium),
      schedule: { limits: coverage.limits, sumsInsured: coverage.sumsInsured },
      documents: [],
    }),
  );
  if (!issued) return undefined;

  // Maker/checker: the checker must be a DIFFERENT user than whoever placed
  // the cover (Placement) — see policy.controller.ts's own comment.
  const checked = await attempt(tally, 'policyChecking', () =>
    postAs(app, actors.policyCheck.token, `/policies/${policy.id}/checking`, {
      requestedCoverage: { limits: coverage.limits, sumsInsured: coverage.sumsInsured },
    }),
  );
  if (!checked) return undefined;

  const delivered = await attempt(tally, 'policyDelivery', () =>
    postAs(app, actors.sales.token, `/policies/${policy.id}/delivery`, {
      method: pick(['email', 'portal', 'courier', 'in_person']),
      recipient: uniqueEmail('client-contact'),
    }),
  );
  if (!delivered) return undefined;

  await attempt(tally, 'policyAcknowledgeReceipt', () =>
    postAs(app, actors.sales.token, `/policies/${policy.id}/delivery/acknowledge-receipt`, {}),
  );

  return { customerId, policyId: policy.id, policyNumber, premium, inceptionDaysAgo };
}

async function maybeInvoicePolicy(
  app: INestApplication<App>,
  actors: Actors,
  policyId: string,
  premium: number,
  tally: Tally,
): Promise<void> {
  // taxAmount and feesAmount must both be `<= premiumAmount` (server-enforced
  // against Policy.issuedPremium) — keep both as small fractions of the
  // premium rather than an unrelated fixed range, so this never 422s on a
  // small policy.
  await attempt(tally, 'invoice', () =>
    postAs(app, actors.finance.token, '/invoices', {
      policyId,
      taxAmount: money(Math.max(1, Math.round(premium * 0.16))),
      feesAmount: money(Math.max(1, Math.round(premium * 0.02))),
      dueDate: isoDateDaysFromNow(30),
    }),
  );
}

async function maybeClaimPolicy(
  app: INestApplication<App>,
  actors: Actors,
  policyId: string,
  inceptionDaysAgo: number,
  tally: Tally,
): Promise<void> {
  const claim = await attempt(tally, 'claim', () =>
    postAs<{ id: string }>(app, actors.claims.token, '/claims', {
      policyId,
      // Strictly inside cover: after inception, and never in the future.
      lossDate: isoDateDaysAgo(randomInt(1, Math.max(1, inceptionDaysAgo - 1))),
      causeOfLoss: pick([
        'Storm damage to the warehouse roof.',
        'Vehicle collision during a delivery run.',
        'Water damage from a burst pipe.',
        'Theft of stock from a storage facility.',
        'Fire damage to office equipment.',
      ]),
      lossLocation: pick(CITIES),
      estimatedLoss: money(randomInt(500, 30_000)),
    }),
  );
  if (!claim) return;
  await attempt(tally, 'claimRegistration', () =>
    postAs(app, actors.claims.token, `/claims/${claim.id}/registration`, {
      insurerClaimReference: `INS-REF-${Date.now()}-${nextSeq()}`,
      adjuster: { name: `${pick(GIVEN_NAMES_M)} ${pick(FAMILY_NAMES)}`, firm: 'Regional Loss Adjusters LLC' },
    }),
  );
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
  const categories = ['denied_claim', 'delayed_issuance', 'premium_dispute', 'unanswered_claim', 'other'];
  for (let i = 0; i < count && customerIds.length > 0; i += 1) {
    await attempt(tally, 'complaint', () =>
      postAs(app, actors.compliance.token, '/complaints', {
        customerId: pick(customerIds),
        issue: pick([
          'The settlement offered was well below the assessed repair cost.',
          'The policy documents were delivered over three weeks late.',
          'The renewal premium increased with no explanation given.',
          'No response was received after multiple follow-up calls about an open claim.',
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
    { title: 'Phishing email targeting a claims workstation', description: 'A claims officer reported a suspicious email requesting login credentials; the link was not clicked.' },
    { title: 'Laptop left unattended in a client meeting room', description: 'A placement officer\'s laptop was briefly unattended; the screen was locked and no data was accessed.' },
    { title: 'Misdirected email containing a customer document', description: 'A policy schedule was emailed to an incorrect recipient inside the same office and was recalled promptly.' },
    { title: 'Unusual login pattern flagged for a Finance account', description: 'Multiple failed login attempts were recorded outside normal business hours.' },
    { title: 'Vendor access review overdue', description: 'A third-party vendor\'s access review was flagged as overdue during a routine compliance check.' },
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
  const types = ['reinsurer', 'loss_adjuster', 'it_cloud', 'printing_archiving', 'marketing_call_centre', 'other'];
  const names = [
    'Regional Loss Adjusters LLC', 'CloudSecure Hosting Services', 'Al-Nokhba Printing & Archiving',
    'Horizon Marketing & Call Centre', 'Jordan Reinsurance Facility', 'Apex Office Supplies',
  ];
  for (let i = 0; i < count; i += 1) {
    await attempt(tally, 'vendor', () =>
      postAs(app, actors.compliance.token, '/vendors', {
        name: `${names[i % names.length]} #${nextSeq()}`,
        vendorType: types[i % types.length],
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

async function preflight(): Promise<void> {
  const orgA = await rawPrisma.organization.findUnique({ where: { id: ORG_A_ID } });
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
  const missing = ACTOR_ROLE_DEFS.map((d) => d.key).filter((key) => !actors[key]);
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
    await proveDuplicateSpellingIsRefused(app, actors.admin.token);
  }

  console.log(`- ${NUM.employeesPerOrg} employees...`);
  await seedEmployees(app, actors, NUM.employeesPerOrg, tally);

  console.log(`- ${NUM.leadsPerOrg} leads across the funnel...`);
  const leadFunnelCustomers: SeededCustomer[] = [];
  for (let i = 0; i < NUM.leadsPerOrg; i += 1) {
    const stage =
      i < Math.round(NUM.leadsPerOrg * 0.3) ? 'CONVERTED' :
      i < Math.round(NUM.leadsPerOrg * 0.5) ? 'QUALIFIED' :
      i < Math.round(NUM.leadsPerOrg * 0.75) ? 'CONTACTED' : 'NEW';
    const customer = await seedLeadFunnel(app, actors, stage, tally);
    if (customer) leadFunnelCustomers.push(customer);
  }

  console.log(`- ${NUM.customersPerOrg} standalone customers...`);
  const standaloneCustomers: SeededCustomer[] = [];
  for (let i = 0; i < NUM.customersPerOrg; i += 1) {
    const customer = await attempt(tally, 'customer', () =>
      Math.random() < 0.55 ? createIndividualCustomer(app, actors) : createCorporateCustomer(app, actors),
    );
    if (customer) standaloneCustomers.push(customer);
    if ((i + 1) % 50 === 0) console.log(`  ...${i + 1}/${NUM.customersPerOrg}`);
  }

  const allCustomers = [...standaloneCustomers, ...leadFunnelCustomers];

  console.log(`- ${NUM.fullPipelinePerOrg} full sales-to-policy pipelines...`);
  const pipelineTargets = standaloneCustomers.slice(0, NUM.fullPipelinePerOrg);
  const policies: PipelineResult[] = [];
  for (let i = 0; i < pipelineTargets.length; i += 1) {
    const result = await runFullPipeline(app, actors, orgSlug, insurers, pipelineTargets[i].id, tally);
    if (result) policies.push(result);
    console.log(`  ...pipeline ${i + 1}/${pipelineTargets.length}${result ? ' -> ' + result.policyNumber : ' (stopped early, see errors)'}`);
  }

  console.log(`- invoices/claims on ${policies.length} issued policies...`);
  let invoicesCreated = 0;
  let claimsCreated = 0;
  for (let i = 0; i < policies.length; i += 1) {
    if (Math.random() < 0.75) {
      await maybeInvoicePolicy(app, actors, policies[i].policyId, policies[i].premium, tally);
      invoicesCreated += 1;
    }
    if (Math.random() < 0.4) {
      await maybeClaimPolicy(app, actors, policies[i].policyId, policies[i].inceptionDaysAgo, tally);
      claimsCreated += 1;
    }
  }

  console.log(`- ${NUM.complaintsPerOrg} complaints, ${NUM.incidentsPerOrg} incidents, ${NUM.vendorsPerOrg} vendors...`);
  await seedComplaints(app, actors, allCustomers.map((c) => c.id), NUM.complaintsPerOrg, tally);
  await seedIncidents(app, actors, NUM.incidentsPerOrg, tally);
  await seedVendors(app, actors, NUM.vendorsPerOrg, tally);

  // LAST, because it has to pick an insurer that already holds policies — the deactivation screen
  // is only worth looking at when its five impact counts are not all zero.
  if (actors.admin) {
    console.log('- deactivating one insurer that has live commitments...');
    await deactivateOneInsurerWithCommitments(app, orgId, actors.admin.token, tally);
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
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

it('seeds demo data for two Organizations through the real API', async () => {
  const tally = newTally();
  const app = await createTestApp();
  // Captured rather than allowed to propagate, so the release below still runs
  // and can never replace the error that actually caused it.
  let fatal: Error | undefined;
  try {
    console.log('Running preflight checks...');
    await preflight();

    console.log('Ensuring Office B exists...');
    const existingOrgB = await rawPrisma.organization.findUnique({ where: { id: ORG_B_ID } });
    if (!existingOrgB) {
      await rawPrisma.organization.create({
        data: {
          id: ORG_B_ID,
          legalName: ORG_B_LEGAL_NAME,
          legalNameAr: ORG_B_LEGAL_NAME_AR,
          subdomain: ORG_B_SUBDOMAIN,
        },
      });
    }
    // The new-office rule. Runs on every pass, not just on creation, so an
    // Office B created by an earlier version of this script also ends up with
    // one — the same reason every other step here is idempotent.
    for (const orgId of [ORG_A_ID, ORG_B_ID]) {
      await ensureOfficeAdministrator(orgId);
    }

    const orgAName =
      (await rawPrisma.organization.findUnique({ where: { id: ORG_A_ID } }))?.legalName ?? ORG_A_LABEL;

    // Each Organization is seeded independently — a hard failure in Office A
    // (e.g. its actor accounts could not be provisioned) must not prevent
    // Office B from being attempted, and vice versa.
    const summaries: OrgSeedSummary[] = [];
    for (const [orgId, orgSlug, orgLabel] of [
      [ORG_A_ID, ORG_A_SLUG, orgAName],
      [ORG_B_ID, ORG_B_SLUG, ORG_B_LEGAL_NAME],
    ] as const) {
      try {
        summaries.push(await seedOrganization(app, orgId, orgSlug, orgLabel, tally));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`\n!!! ${orgLabel} FAILED entirely: ${message}\n`);
        tally.errors.push(`[org:${orgSlug}] ${message}`);
      }
    }

    // ------------------------------------------------------------------
    // Report
    // ------------------------------------------------------------------
    const totalCreated = Object.values(tally.created).reduce((a, b) => a + b, 0);
    const totalFailed = Object.values(tally.failed).reduce((a, b) => a + b, 0);

    console.log('\n================ DEMO SEED SUMMARY ================');
    for (const summary of summaries) {
      console.log(`\n${summary.orgLabel}:`);
      console.log(`  customers: ${summary.customersCreated} (of which ${summary.leadFunnelCustomers} came through the lead funnel)`);
      console.log(`  full pipelines completed (ACTIVE-track policies): ${summary.fullPipelinesCompleted}`);
      console.log(`  invoices: ${summary.invoicesCreated}, claims: ${summary.claimsCreated}`);
      console.log(`  demo login (password for all: ${DEMO_PASSWORD}):`);
      for (const actor of Object.values(summary.actors)) {
        console.log(`    ${actor.label.padEnd(32)} ${actor.email}`);
      }
    }
    console.log(`\nRows created: ${totalCreated}  |  Failed attempts: ${totalFailed}`);
    if (totalFailed > 0) {
      console.log('\nFirst 20 failures (non-fatal — everything else above still got created):');
      for (const line of tally.errors.slice(0, 20)) console.log(`  - ${line}`);
      if (tally.errors.length > 20) console.log(`  ... and ${tally.errors.length - 20} more (see the full report file).`);
    }
    console.log('=====================================================\n');

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
            actors: Object.fromEntries(
              Object.entries(s.actors).map(([key, actor]) => [key, { email: actor.email, label: actor.label }]),
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
  if (stillLocked.length > 0) {
    throw new Error(
      `Seeding finished, but ${stillLocked.length} demo account(s) are still ` +
        `behind a six-digit prompt nobody can answer: ` +
        `${stillLocked.join(', ')}. Their TOTP secret was generated in this ` +
        `process and never shown to anyone. Clear MfaCredential and set ` +
        `mfaEnabled = false for them before demoing.`,
    );
  }
}, 30 * 60_000);
