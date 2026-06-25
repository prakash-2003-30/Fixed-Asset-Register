import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { recordAudit } from '../utils/audit';

const router = Router();
router.use(authenticate, requireRole('ADMIN'));

const userSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']),
  password: z.string().min(6).optional(),
  active: z.boolean().optional(),
});

router.get('/', async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(users);
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = userSchema.parse(req.body);
    if (!body.password) return res.status(400).json({ error: 'Password is required' });
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email.toLowerCase(),
        role: body.role,
        active: body.active ?? true,
        password: await bcrypt.hash(body.password, 10),
      },
      select: { id: true, name: true, email: true, role: true, active: true },
    });
    await recordAudit({ action: 'CREATE', entity: 'User', entityId: user.id, summary: `Created user ${user.email}`, user: req.user });
    res.status(201).json(user);
  } catch (e) {
    next(e);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const body = userSchema.partial().parse(req.body);
    const data: any = { ...body };
    if (body.email) data.email = body.email.toLowerCase();
    if (body.password) data.password = await bcrypt.hash(body.password, 10);
    else delete data.password;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, email: true, role: true, active: true },
    });
    await recordAudit({ action: 'UPDATE', entity: 'User', entityId: user.id, summary: `Updated user ${user.email}`, user: req.user });
    res.json(user);
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (req.params.id === req.user!.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    const user = await prisma.user.delete({ where: { id: req.params.id } });
    await recordAudit({ action: 'DELETE', entity: 'User', entityId: user.id, summary: `Deleted user ${user.email}`, user: req.user });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
