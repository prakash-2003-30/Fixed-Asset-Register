// The 15 register columns, in the exact order/labels of the source Excel file.
export interface ColumnDef {
  key: string; // model field
  header: string; // Excel/UI header
  type: 'string' | 'number';
}

// The 11 register columns, in the exact order/labels requested. All stored as
// text so values are preserved verbatim (e.g. cost "25,000", "Complimendary").
export const COLUMNS: ColumnDef[] = [
  { key: 'assetId', header: 'Asset ID', type: 'string' },
  { key: 'description', header: 'Asset Description', type: 'string' },
  { key: 'category', header: 'Category', type: 'string' },
  { key: 'purchaseDate', header: 'Purchase Date', type: 'string' },
  { key: 'vendor', header: 'Vendor', type: 'string' },
  { key: 'cost', header: 'Cost (₹ / $)', type: 'string' },
  { key: 'location', header: 'Location', type: 'string' },
  { key: 'serialNumber', header: 'Serial Number / Tag', type: 'string' },
  { key: 'assignedTo', header: 'Assigned To', type: 'string' },
  { key: 'complaints', header: 'Complaints / Recover Date', type: 'string' },
  { key: 'remarks', header: 'Remarks', type: 'string' },
];

export const STRING_FIELDS = COLUMNS.filter((c) => c.type === 'string').map((c) => c.key);
export const NUMBER_FIELDS = COLUMNS.filter((c) => c.type === 'number').map((c) => c.key);
export const ALL_FIELDS = COLUMNS.map((c) => c.key);

// Normalise the free-text "Remarks" into a clean status bucket.
export function normaliseStatus(remarks?: string | null): string {
  const r = (remarks || '').trim().toLowerCase();
  if (!r) return 'Unknown';
  if (r.includes('damage')) return 'Damaged';
  if (r.includes('dispos')) return 'Disposed';
  if (r.includes('not')) return 'Not in use';
  if (r.includes('use')) return 'In use';
  return remarks!.trim();
}
