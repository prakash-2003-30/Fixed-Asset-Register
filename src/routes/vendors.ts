import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { recordAudit } from '../utils/audit';

const router = Router();
router.use(authenticate);

// GET /api/vendors — vendor names for the "Add New Asset" Vendor dropdown.
router.get('/', async (_req, res, next) => {
  try {
    const vendors = await prisma.vendor.findMany({ orderBy: { name: 'asc' } });
    res.json(vendors.map((v) => v.name));
  } catch (e) {
    next(e);
  }
});

// POST /api/vendors — add a vendor (EDITOR+). Rejects blank names and
// case-insensitive duplicates so the dropdown never gains a repeat entry.
router.post('/', requireRole('EDITOR'), async (req, res, next) => {
  try {
    const { name: raw } = z.object({ name: z.string() }).parse(req.body);
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name) return res.status(400).json({ error: 'Vendor name is required' });

    const existing = await prisma.vendor.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    if (existing) return res.status(409).json({ error: `Vendor "${existing.name}" already exists` });

    const created = await prisma.vendor.create({ data: { name } });
    await recordAudit({
      action: 'CREATE',
      entity: 'Vendor',
      entityId: created.id,
      summary: `Added vendor ${created.name}`,
      user: req.user,
    });
    res.status(201).json({ id: created.id, name: created.name });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: e.errors[0]?.message ?? 'Invalid input' });
    next(e);
  }
});

export default router;
