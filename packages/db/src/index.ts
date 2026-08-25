import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __ibmsPrisma: PrismaClient | undefined;
}

export const prisma = globalThis.__ibmsPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__ibmsPrisma = prisma;
}

export * from '@prisma/client';
