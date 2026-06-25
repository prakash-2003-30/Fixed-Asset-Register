/**
 * Deletes rows where EVERY one of the 11 data columns is blank (null/empty).
 * Rows with at least one value are kept, in their existing order. The frontend's
 * "#" column is positional, so it renumbers 1,2,3,... automatically afterwards.
 *
 * Dry-run by default; pass --apply to delete.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const FIELDS = ['assetId', 'description', 'category', 'purchaseDate', 'vendor', 'cost', 'location', 'serialNumber', 'assignedTo', 'complaints', 'remarks'];
const blank = (v) => v == null || String(v).trim() === '';

(async () => {
  const all = await prisma.asset.findMany();
  const empties = all.filter((a) => FIELDS.every((f) => blank(a[f])));
  const keep = all.length - empties.length;

  console.log(`Total rows: ${all.length}`);
  console.log(`Fully-blank rows to remove: ${empties.length}`);
  console.log(`Rows that will remain: ${keep}`);

  if (APPLY && empties.length) {
    const res = await prisma.asset.deleteMany({ where: { id: { in: empties.map((e) => e.id) } } });
    console.log(`\nAPPLIED — deleted ${res.count} blank rows. Remaining: ${await prisma.asset.count()}`);
  } else if (!APPLY) {
    console.log('\nDRY-RUN — re-run with --apply to delete.');
  }
  await prisma.$disconnect();
})().catch(async (e) => { console.error('FAILED:', e.message); await prisma.$disconnect(); process.exit(1); });
