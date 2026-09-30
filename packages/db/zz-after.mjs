import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const SUCCESSORS = {
  'vendor.manage': ['vendor.read','vendor.create','vendor.update','vendor.deactivate'],
  'document.manage': ['document.read','document.create'],
  'role.manage': ['role.create','role.update','role.deactivate'],
  'insurer.relationship.manage': ['insurer.create','insurer.update','insurer.deactivate','insurance-line.create','insurance-line.update'],
  'needs-assessment.create': ['needs-assessment.update'],
  'risk-profile.create': ['risk-profile.update'],
};
const all = Object.values(SUCCESSORS).flat();
const rows = await prisma.$queryRawUnsafe(`
  SELECT p.code, count(*)::int AS role_rows, array_agg(DISTINCT r.name ORDER BY r.name) AS names
  FROM "RolePermission" rp
  JOIN "Permission" p ON p.id = rp."permissionId"
  JOIN "Role" r ON r.id = rp."roleId"
  WHERE p.code = ANY($1::text[])
  GROUP BY p.code ORDER BY p.code
`, all);
for (const r of rows) console.log(`${r.code.padEnd(26)} ${String(r.role_rows).padStart(3)} role rows  ${r.names.join(', ')}`);
const gone = await prisma.$queryRawUnsafe(`
  SELECT count(*)::int AS n FROM "Permission"
  WHERE code IN ('vendor.manage','document.manage','role.manage','insurer.relationship.manage')`);
const totals = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "Permission"`);
const grants = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "RolePermission"`);
console.log(`\numbrellas remaining: ${gone[0].n}`);
console.log(`catalogue: ${totals[0].n} permissions, ${grants[0].n} grants`);
await prisma.$disconnect();
