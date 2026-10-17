import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __ibmsPrisma: PrismaClient | undefined;
}

/**
 * The OWNER connection — `DATABASE_URL`, the role that owns the tables.
 *
 * Used by `prisma migrate`, `prisma/seed.ts`, and anything else that
 * legitimately needs to reach across every Organization at once. Postgres
 * exempts a table's owner from that table's own RLS policies, so queries made
 * through this client are NOT row-level filtered. That is deliberate and is
 * exactly why the running API does not use it — see `createAppPrismaClient`.
 */
export const prisma = globalThis.__ibmsPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__ibmsPrisma = prisma;
}

/**
 * Multi-tenancy Phase 2 step 8 — a client on a DIFFERENT database role.
 *
 * The API runs as a non-owner role (`ibms_app`) precisely so that Postgres
 * applies the row-level security policies to it. Connecting the API as the
 * table owner would leave every policy silently inert — spec §1's "critical
 * mechanical detail", and the reason this factory exists at all rather than
 * everything sharing the singleton above.
 *
 * A separate client (not `prisma.$extends`) is required because the role is
 * part of the connection string: the same pool cannot be two roles at once.
 */
export function createAppPrismaClient(url: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url } } });
}

export * from "@prisma/client";
export * from "./password-policy";

/**
 * MODULE 0-ب, item 1 half B — every organization gets a default Branch and Department at creation.
 * Exported here because there are three creation paths in two packages: the two provider registration
 * routes in `apps/api` and the provider organization in `prisma/seed.ts`.
 */
export {
  DEFAULT_BRANCH,
  DEFAULT_DEPARTMENT,
  ensureDefaultOrgUnits,
  type OrgUnitWriter,
} from "./default-org-units";
