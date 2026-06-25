/**
 * Backfills the `assignedTo` field for assets that came in blank because the
 * source register merged the "Assigned To" cell across each employee's block.
 *
 * Forward-fills the employee name down each block (blank => employee above),
 * using the ORIGINAL row order from data/assets.json.
 *
 * Dry-run by default. Pass --apply to write the changes to the database.
 * Only fills rows that are currently null/empty; never overwrites an existing
 * assignee, so manual edits are safe.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

const norm = (v) => (v == null ? '' : String(v).trim());

(async () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'assets.json'), 'utf-8'));

  // Forward-fill assignedTo in source order.
  let last = '';
  const filled = raw.map((r) => {
    const a = norm(r.assignedTo);
    if (a) last = a;
    return { ...r, _filledAssignee: a || last };
  });

  // Build the list of changes: rows where source was blank but forward-fill gives a name.
  const changes = filled.filter((r) => !norm(r.assignedTo) && r._filledAssignee);

  console.log(`Source rows: ${raw.length}`);
  console.log(`Rows needing a backfilled assignee: ${changes.length}\n`);

  let updated = 0, skipped = 0, notFound = 0;
  for (const r of changes) {
    // Match the DB doc uniquely by the immutable-ish source fields.
    const match = {
      assetId: r.assetId ?? null,
      description: r.description ?? null,
      purchaseDate: r.purchaseDate ?? null,
      cost: r.cost ?? null,
    };
    const docs = await prisma.asset.findMany({ where: match });

    if (docs.length === 0) { notFound++; console.log(`  [no-match] ${r.assetId} "${norm(r.description)}"`); continue; }

    // Only fill those still blank (don't clobber manual edits).
    const blanks = docs.filter((d) => !norm(d.assignedTo));
    if (blanks.length === 0) { skipped++; continue; }

    console.log(`  ${r.assetId || '(no id)'} "${norm(r.description).slice(0, 28)}"  ->  ${r._filledAssignee}${docs.length > 1 ? `  [${blanks.length}/${docs.length} docs]` : ''}`);

    if (APPLY) {
      for (const d of blanks) {
        await prisma.asset.update({ where: { id: d.id }, data: { assignedTo: r._filledAssignee } });
        updated++;
      }
    }
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY-RUN'}  |  to update: ${changes.length - skipped - notFound}  | updated: ${updated}  | already-set(skipped): ${skipped}  | no-match: ${notFound}`);
  if (!APPLY) console.log('\nRe-run with  --apply  to write these changes.');

  await prisma.$disconnect();
})().catch(async (e) => { console.error('FAILED:', e.message); await prisma.$disconnect(); process.exit(1); });
