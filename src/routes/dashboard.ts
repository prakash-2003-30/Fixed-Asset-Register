import { Router } from 'express';
import { prisma } from '../prisma';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/', async (_req, res, next) => {
  try {
    const [total, byCategoryRaw, byLocationRaw, byStatusRaw, byVendorRaw, costRows, recentAdded, recentUpdated] =
      await Promise.all([
        prisma.asset.count(),
        prisma.asset.groupBy({ by: ['category'], _count: { _all: true } }),
        prisma.asset.groupBy({ by: ['location'], _count: { _all: true } }),
        prisma.asset.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.asset.groupBy({ by: ['vendor'], _count: { _all: true } }),
        // Cost is stored as text (to preserve values exactly), so sum it in JS by
        // parsing the numeric portion; non-numeric values (e.g. "Complimendary") count as 0.
        prisma.asset.findMany({ select: { cost: true } }),
        prisma.asset.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
        prisma.asset.findMany({ orderBy: { updatedAt: 'desc' }, take: 5 }),
      ]);

    const tally = (rows: any[], key: string) =>
      rows
        .map((r) => ({ label: r[key] ?? 'Unspecified', count: r._count._all }))
        .sort((a, b) => b.count - a.count);

    const status = tally(byStatusRaw, 'status');
    const active = status.filter((s) => /use/i.test(s.label) && !/not/i.test(s.label)).reduce((a, b) => a + b.count, 0);
    const disposed = status
      .filter((s) => /dispos|damag|not/i.test(s.label))
      .reduce((a, b) => a + b.count, 0);

    const totalCost = costRows.reduce((sum, r) => {
      const n = parseFloat(String(r.cost ?? '').replace(/[^0-9.]/g, ''));
      return sum + (Number.isNaN(n) ? 0 : n);
    }, 0);

    res.json({
      total,
      totalCost,
      totalBookValue: 0,
      active,
      disposed,
      byCategory: tally(byCategoryRaw, 'category'),
      byLocation: tally(byLocationRaw, 'location'),
      byStatus: status,
      byVendor: tally(byVendorRaw, 'vendor'),
      recentAdded,
      recentUpdated,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
