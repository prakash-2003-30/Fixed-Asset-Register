/**
 * Normalises the capitalisation of `assignedTo` so alphabetical (A–Z) sorting
 * is correct. MongoDB sorts case-sensitively (uppercase before lowercase), so a
 * name stored as "kanagavel ..." would sort AFTER "Zahir ...".
 *
 * Fix: capitalise the first letter of each word; leave the rest of each word
 * untouched (so "HIKE TEAM", "Admin Dept" etc. are unaffected).
 *
 * Dry-run by default. Pass --apply to write changes. Only updates rows whose
 * value actually changes.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const titleFirst = (s) =>
  s.replace(/\s+/g, ' ').trim().split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

(async () => {
  const assets = await prisma.asset.findMany({
    where: { NOT: [{ assignedTo: null }, { assignedTo: '' }] },
    select: { id: true, assignedTo: true },
  });

  const changes = [];
  for (const a of assets) {
    const next = titleFirst(a.assignedTo);
    if (next !== a.assignedTo) changes.push({ id: a.id, from: a.assignedTo, to: next });
  }

  // Show distinct from->to pairs
  const seen = new Set();
  for (const c of changes) {
    const key = `${c.from} => ${c.to}`;
    if (!seen.has(key)) { seen.add(key); console.log(`  "${c.from}"  ->  "${c.to}"`); }
  }

  let updated = 0;
  if (APPLY) {
    for (const c of changes) { await prisma.asset.update({ where: { id: c.id }, data: { assignedTo: c.to } }); updated++; }
  }
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY-RUN'}  | rows to change: ${changes.length}  | distinct names: ${seen.size}  | updated: ${updated}`);
  if (!APPLY) console.log('Re-run with --apply to write changes.');

  await prisma.$disconnect();
})().catch(async (e) => { console.error('FAILED:', e.message); await prisma.$disconnect(); process.exit(1); });
