/**
 * Seeds the Vendor collection with the curated allowlist so the "Add New Asset"
 * Vendor dropdown is populated out of the box. Idempotent: existing names
 * (case-insensitive) are skipped, so re-running adds only what's missing.
 *
 *   node scripts/seed-vendors.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SEED = ['KB Systems', 'JK Infotech', 'VM Electricals', 'Rasi Systems', 'Sri Mathi Traders'];

(async () => {
  const existing = await prisma.vendor.findMany();
  const have = new Set(existing.map((v) => v.name.toLowerCase()));
  let added = 0;
  for (const name of SEED) {
    if (have.has(name.toLowerCase())) continue;
    await prisma.vendor.create({ data: { name } });
    added++;
    console.log(`+ ${name}`);
  }
  console.log(`\nVendors seeded: ${added} added, ${existing.length} already present.`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
