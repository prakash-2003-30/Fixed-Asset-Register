import { PrismaClient, Role, type User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

// Inline copy of the status normaliser (seed runs standalone)
function normaliseStatus(remarks?: string | null): string {
  const r = (remarks || '').trim().toLowerCase();
  if (!r) return 'Unknown';
  if (r.includes('damage')) return 'Damaged';
  if (r.includes('dispos')) return 'Disposed';
  if (r.includes('not')) return 'Not in use';
  if (r.includes('use')) return 'In use';
  return remarks!.trim();
}

const NUMBER_FIELDS = ['cost', 'expectedLife', 'accumulatedDepreciation', 'bookValue'];

async function main() {
  console.log('Seeding users...');
  const users = [
    { name: 'System Admin', email: 'admin@hikehealth.com', role: Role.ADMIN, password: 'Admin@123' },
    { name: 'Asset Editor', email: 'editor@hikehealth.com', role: Role.EDITOR, password: 'Editor@123' },
    { name: 'Report Viewer', email: 'viewer@hikehealth.com', role: Role.VIEWER, password: 'Viewer@123' },
  ];
  let admin: User | undefined;
  for (const u of users) {
    const created = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { name: u.name, email: u.email, role: u.role, password: await bcrypt.hash(u.password, 10) },
    });
    if (u.role === Role.ADMIN) admin = created;
  }

  const existing = await prisma.asset.count();
  if (existing > 0) {
    console.log(`Assets already present (${existing}); skipping asset seed.`);
    return;
  }

  console.log('Seeding assets from data/assets.json...');
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'assets.json'), 'utf-8')) as any[];
  const data = raw.map((r) => {
    const o: any = { ...r };
    for (const f of NUMBER_FIELDS) {
      if (o[f] !== undefined && o[f] !== null && o[f] !== '') o[f] = Number(o[f]);
      else o[f] = null;
    }
    o.status = normaliseStatus(o.remarks);
    o.createdById = admin?.id ?? null;
    o.updatedById = admin?.id ?? null;
    return o;
  });
  const result = await prisma.asset.createMany({ data });
  console.log(`Seeded ${result.count} assets.`);

  await prisma.auditLog.create({
    data: { action: 'IMPORT', entity: 'Asset', summary: `Initial seed: imported ${result.count} assets from FA register`, userId: admin?.id, userName: admin?.name },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
