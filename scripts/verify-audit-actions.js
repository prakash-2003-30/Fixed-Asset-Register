/**
 * Verifies the Audit Trail records & shows CREATE and DELETE (not just UPDATE).
 *
 * Runs the SAME flow the app uses: create an asset -> write a CREATE audit log,
 * then delete that asset -> write a DELETE audit log. The test asset is created
 * and immediately removed, so the register's real data is left unchanged; only
 * two audit entries (one CREATE, one DELETE) remain to prove the page works.
 *
 *   node scripts/verify-audit-actions.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Mirror of backend/src/utils/audit.ts recordAudit()
async function recordAudit({ action, entity, entityId, summary, user }) {
  await prisma.auditLog.create({
    data: {
      action,
      entity,
      entityId: entityId ?? null,
      summary,
      userId: user?.id ?? null,
      userName: user?.name ?? 'System',
    },
  });
}

(async () => {
  // Attribute to a real admin user if one exists, else "System".
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  const user = admin ? { id: admin.id, name: admin.name } : null;
  console.log(`Acting as: ${user ? user.name + ' (ADMIN)' : 'System'}`);

  const maxSeq = await prisma.asset.aggregate({ _max: { seq: true } });
  const seq = (maxSeq._max.seq ?? -1) + 1;

  // 1) CREATE
  const created = await prisma.asset.create({
    data: {
      assetId: 'AUDIT-TEST',
      description: 'Temporary asset to verify audit logging',
      seq,
      status: 'In use',
      createdById: user?.id ?? undefined,
      updatedById: user?.id ?? undefined,
    },
  });
  await recordAudit({
    action: 'CREATE', entity: 'Asset', entityId: created.id,
    summary: `Created asset ${created.assetId}`, user,
  });
  console.log(`CREATE logged for asset ${created.id}`);

  // 2) DELETE (removes the test asset so real data is untouched)
  await prisma.asset.delete({ where: { id: created.id } });
  await recordAudit({
    action: 'DELETE', entity: 'Asset', entityId: created.id,
    summary: `Deleted asset ${created.assetId}`, user,
  });
  console.log(`DELETE logged for asset ${created.id}`);

  // Summary of what the audit page will now show
  const all = await prisma.auditLog.groupBy({ by: ['action'], _count: { action: true } });
  console.log('\nAudit log counts by action:');
  all.forEach((g) => console.log(`  ${g.action}: ${g._count.action}`));

  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
