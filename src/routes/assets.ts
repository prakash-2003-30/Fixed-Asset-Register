import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { recordAudit, diff, assetAuditChanges } from '../utils/audit';
import { ALL_FIELDS, normaliseStatus } from '../utils/columns';

const router = Router();
router.use(authenticate);

const SORTABLE = new Set([...ALL_FIELDS, 'seq', 'status', 'createdAt', 'updatedAt']);

const assetSchema = z.object({
  assetId: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  purchaseDate: z.string().nullable().optional(),
  vendor: z.string().nullable().optional(),
  cost: z.string().nullable().optional(), // stored as text to preserve values exactly
  location: z.string().nullable().optional(),
  expectedLife: z.number().nullable().optional(),
  depreciationMethod: z.string().nullable().optional(),
  accumulatedDepreciation: z.number().nullable().optional(),
  bookValue: z.number().nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  assignedTo: z.string().nullable().optional(),
  complaints: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
});

// Shared so the export endpoints produce the EXACT same row set + order as the
// list/UI (same search, filters, sort). Exported for use in export.ts.
export function buildWhere(q: any): Prisma.AssetWhereInput {
  const and: Prisma.AssetWhereInput[] = [];

  if (q.search) {
    const s = String(q.search);
    const textFields = [
      'assetId', 'description', 'category', 'purchaseDate', 'vendor', 'location',
      'depreciationMethod', 'serialNumber', 'assignedTo', 'complaints', 'remarks', 'status',
    ];
    and.push({
      OR: textFields.map((f) => ({ [f]: { contains: s, mode: 'insensitive' } })) as any,
    });
  }
  for (const f of ['category', 'location', 'vendor', 'status', 'assignedTo'] as const) {
    const val = q[f];
    // A repeated query param (e.g. ?location=New Office&location=New office) arrives
    // as an array; match any of the variants. A single value is an exact match.
    if (Array.isArray(val) && val.length) and.push({ [f]: { in: val.map(String) } });
    else if (val) and.push({ [f]: { equals: String(val) } });
  }
  return and.length ? { AND: and } : {};
}

// Default is insertion order ("seq"). A requested sort column is honoured, with
// "seq" always the stable tiebreaker. Identical logic drives list + export.
export function buildOrderBy(q: any): Prisma.AssetOrderByWithRelationInput[] {
  let sortBy = String(q.sortBy || 'seq');
  if (!SORTABLE.has(sortBy)) sortBy = 'seq';
  const sortDir = String(q.sortDir || 'asc') === 'desc' ? 'desc' : 'asc';
  const orderBy: Prisma.AssetOrderByWithRelationInput[] = [{ [sortBy]: sortDir } as Prisma.AssetOrderByWithRelationInput];
  if (sortBy !== 'seq') orderBy.push({ seq: 'asc' });
  return orderBy;
}

// When an assignee filter is active, expand it to that employee's whole asset
// group: blank-assignee rows inherit the employee named above them (in insertion
// order) — the same grouping shown by the merged "Assigned To" cell. So filtering
// by an employee returns their laptop AND the headset/peripheral rows under it.
// Returns the matching asset ids, or null when no assignee filter is set.
export async function ownerExpandedIds(q: any): Promise<string[] | null> {
  const f = q.assignedTo;
  if (!f) return null;
  const wanted = new Set((Array.isArray(f) ? f : [f]).map((v: any) => String(v).trim()));
  const all = await prisma.asset.findMany({ orderBy: { seq: 'asc' }, select: { id: true, assignedTo: true } });
  let last = '';
  const ids: string[] = [];
  for (const a of all) {
    const name = (a.assignedTo ?? '').trim();
    if (name) last = name;
    if (wanted.has(name || last)) ids.push(a.id);
  }
  return ids;
}

// GET /api/assets — list with search/filter/sort/pagination
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize || '25'), 10)));
    const orderBy = buildOrderBy(req.query);

    // Assignee filter expands to the employee's full asset group (incl. their
    // blank-assignee peripherals); other filters/search still apply on top.
    const ownerIds = await ownerExpandedIds(req.query);
    let where: Prisma.AssetWhereInput;
    if (ownerIds) {
      const { assignedTo, ...rest } = req.query as any;
      where = { AND: [{ id: { in: ownerIds } }, buildWhere(rest)] };
    } else {
      where = buildWhere(req.query);
    }
    const [total, rows] = await Promise.all([
      prisma.asset.count({ where }),
      prisma.asset.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({ data: rows, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
  } catch (e) {
    next(e);
  }
});

// GET /api/assets/filters — distinct values to populate filter dropdowns
router.get('/filters', async (_req, res, next) => {
  try {
    const fields = ['category', 'location', 'vendor', 'status', 'assignedTo'] as const;
    const out: Record<string, string[]> = {};
    for (const f of fields) {
      const rows = await prisma.asset.findMany({
        distinct: [f],
        select: { [f]: true },
        orderBy: { [f]: 'asc' },
      });
      out[f] = [...new Set(rows.map((r: any) => r[f]).filter((v: unknown) => v != null && v !== ''))] as string[];
    }
    res.json(out);
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    res.json(asset);
  } catch (e) {
    next(e);
  }
});

// Asset IDs eligible for number-based grouping must STRICTLY match /^[A-F]-\d{2}$/:
// a SINGLE uppercase letter A–F, a dash, and exactly TWO digits (e.g. A-02, F-14).
// Returns the two-digit number, or null for any other format — AA-02, BB-02, CC-02,
// AB-02, ABC-02, LAP-02, IT-02, A-2, a-02 — which is excluded from grouping.
function groupNumber(assetId?: string | null): string | null {
  if (!assetId) return null;
  const m = String(assetId).trim().match(/^[A-F]-(\d{2})$/);
  return m ? m[1] : null;
}

// POST /api/assets — create (EDITOR+)
router.post('/', requireRole('EDITOR'), async (req, res, next) => {
  try {
    const data = assetSchema.parse(req.body);

    // Number-based grouping applies ONLY to Asset IDs of the form [A-F]-## (single
    // letter A–F + two-digit number). Such an asset is inserted directly BELOW the
    // LAST existing asset that (a) belongs to the same employee, (b) is itself an
    // [A-F]-## id, and (c) shares the same two-digit number — i.e. the employee's
    // same-number group. The employee "owns" their named rows plus the blank
    // continuation rows beneath them (forward-fill); matching is case-insensitive.
    // Anything else (other id formats, no assignee, or no matching group) follows
    // the normal flow and is appended to the end.
    const newNum = groupNumber(data.assetId);
    const assignee = (data.assignedTo ?? '').trim().toLowerCase();
    let seq: number | null = null;
    if (newNum != null && assignee) {
      const all = await prisma.asset.findMany({ orderBy: { seq: 'asc' }, select: { seq: true, assetId: true, assignedTo: true } });
      let owner = '';
      let lastSeq: number | null = null;
      for (const a of all) {
        const name = (a.assignedTo ?? '').trim();
        if (name) owner = name;
        if (owner.toLowerCase() === assignee && groupNumber(a.assetId) === newNum) lastSeq = a.seq;
      }
      if (lastSeq != null) {
        // Make room: shift everything after that group's last row down by one.
        await prisma.asset.updateMany({ where: { seq: { gt: lastSeq } }, data: { seq: { increment: 1 } } });
        seq = lastSeq + 1;
      }
    }
    if (seq == null) {
      const maxSeq = await prisma.asset.aggregate({ _max: { seq: true } });
      seq = (maxSeq._max.seq ?? -1) + 1;
    }

    const created = await prisma.asset.create({
      data: { ...data, seq, status: normaliseStatus(data.remarks), createdById: req.user!.id, updatedById: req.user!.id },
    });
    await recordAudit({
      action: 'CREATE',
      entity: 'Asset',
      entityId: created.id,
      summary: `Created asset ${created.assetId || created.description || created.id}`,
      changes: assetAuditChanges(created, 'create'), // full snapshot of created fields
      user: req.user,
    });
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

// PUT /api/assets/:id — update (EDITOR+)
router.put('/:id', requireRole('EDITOR'), async (req, res, next) => {
  try {
    const existing = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Asset not found' });
    const data = assetSchema.parse(req.body);
    const updated = await prisma.asset.update({
      where: { id: req.params.id },
      data: { ...data, status: normaliseStatus(data.remarks), updatedById: req.user!.id },
    });
    const changes = diff(existing, updated, [...ALL_FIELDS, 'status']);
    await recordAudit({
      action: 'UPDATE',
      entity: 'Asset',
      entityId: updated.id,
      summary: `Updated asset ${updated.assetId || updated.description || updated.id}`,
      changes,
      user: req.user,
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/assets/:id — delete (ADMIN only)
router.delete('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const existing = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Asset not found' });
    await prisma.asset.delete({ where: { id: req.params.id } });
    await recordAudit({
      action: 'DELETE',
      entity: 'Asset',
      entityId: existing.id,
      summary: `Deleted asset ${existing.assetId || existing.description || existing.id}`,
      changes: assetAuditChanges(existing, 'delete'), // snapshot of details before deletion
      user: req.user,
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// POST /api/assets/import — bulk import rows parsed from Excel (EDITOR+)
const importSchema = z.object({ rows: z.array(assetSchema) });
router.post('/import', requireRole('EDITOR'), async (req, res, next) => {
  try {
    const { rows } = importSchema.parse(req.body);
    // Imported rows append to the end of the insertion order, in the given order.
    const maxSeq = await prisma.asset.aggregate({ _max: { seq: true } });
    let nextSeq = (maxSeq._max.seq ?? -1) + 1;
    const coerced = rows.map((r) => {
      const o: any = { ...r };
      o.seq = nextSeq++;
      o.status = normaliseStatus(o.remarks);
      o.createdById = req.user!.id;
      o.updatedById = req.user!.id;
      return o;
    });
    const result = await prisma.asset.createMany({ data: coerced });
    await recordAudit({
      action: 'IMPORT',
      entity: 'Asset',
      summary: `Imported ${result.count} asset record(s) from Excel`,
      user: req.user,
    });
    res.status(201).json({ imported: result.count });
  } catch (e) {
    next(e);
  }
});

export default router;
