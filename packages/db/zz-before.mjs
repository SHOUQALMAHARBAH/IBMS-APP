import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const rows = await prisma.$queryRawUnsafe(`
  SELECT p.code, count(*)::int AS roles, array_agg(r.name ORDER BY r.name) AS role_names
  FROM "RolePermission" rp
  JOIN "Permission" p ON p.id = rp."permissionId"
  JOIN "Role" r ON r.id = rp."roleId"
  WHERE p.code IN ('vendor.manage','document.manage','role.manage','insurer.relationship.manage',
                   'needs-assessment.create','risk-profile.create')
  GROUP BY p.code ORDER BY p.code
`);
for (const r of rows) console.log(`${r.code.padEnd(30)} ${String(r.roles).padStart(3)} role rows  ${r.role_names.join(', ')}`);
const totals = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS permissions FROM "Permission"`);
const grants = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS grants FROM "RolePermission"`);
console.log(`catalogue: ${totals[0].permissions} permissions, ${grants[0].grants} grants`);
await prisma.$disconnect();
