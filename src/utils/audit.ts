import { prisma } from '../prisma';
import { Prisma } from '@prisma/client';
import type { AuditAction } from '@prisma/client';
import type { JwtPayload } from './jwt';
import { COLUMNS } from './columns';

interface AuditInput {
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  summary: string;
  changes?: Record<string, { from: unknown; to: unknown }> | null;
  user?: JwtPayload | null;
}

export async function recordAudit(input: AuditInput) {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        summary: input.summary,
        // Only set `changes` when there's an actual diff. CREATE/DELETE pass none;
        // the MongoDB provider rejects `Prisma.JsonNull` here ("provided Enum"), so
        // the field is omitted (left null) rather than explicitly nulled.
        ...(input.changes && Object.keys(input.changes).length
          ? { changes: input.changes as Prisma.InputJsonValue }
          : {}),
        userId: input.user?.id ?? null,
        userName: input.user?.name ?? 'System',
      },
    });
  } catch (e) {
    console.error('Failed to write audit log', e);
  }
}

// Build an audit "changes" snapshot of a whole asset, reusing the {from,to}
// shape so CREATE/DELETE render with the same machinery as UPDATE diffs:
//   create -> { field: { from: null, to: value } }  (a brand-new value)
//   delete -> { field: { from: value, to: null } }  (the value that existed)
// Only the 11 register columns are included, and blanks are skipped. The
// frontend shows these as an "Asset details" list (not "N field(s) changed").
export function assetAuditChanges(
  asset: Record<string, any>,
  mode: 'create' | 'delete'
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const c of COLUMNS) {
    const raw = asset[c.key];
    if (raw == null || String(raw).trim() === '') continue;
    out[c.key] = mode === 'create' ? { from: null, to: raw } : { from: raw, to: null };
  }
  return out;
}

// Compute a field-level diff between two asset objects
export function diff(
  before: Record<string, any>,
  after: Record<string, any>,
  fields: string[]
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of fields) {
    const a = before?.[f] ?? null;
    const b = after?.[f] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[f] = { from: a, to: b };
  }
  return changes;
}
