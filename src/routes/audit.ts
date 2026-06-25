import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// GET /api/audit — paginated activity history with optional filters
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '30'), 10)));

    const where: Prisma.AuditLogWhereInput = {};
    if (req.query.action) where.action = String(req.query.action) as any;
    if (req.query.entity) where.entity = String(req.query.entity);
    if (req.query.search) {
      where.OR = [
        { summary: { contains: String(req.query.search), mode: 'insensitive' } },
        { userName: { contains: String(req.query.search), mode: 'insensitive' } },
      ];
    }

    const [total, data] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // The stored userName is a denormalised snapshot from action time, so it can
    // be stale after a user is renamed. Resolve each log's name from the Users
    // table by userId for display; fall back to the stored name only when the
    // user no longer exists (so history survives user deletion).
    const userIds = [...new Set(data.map((d) => d.userId).filter((id): id is string => !!id))];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    const resolved = data.map((d) => ({
      ...d,
      userName: (d.userId && nameById.get(d.userId)) || d.userName,
    }));

    res.json({ data: resolved, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
  } catch (e) {
    next(e);
  }
});

export default router;
