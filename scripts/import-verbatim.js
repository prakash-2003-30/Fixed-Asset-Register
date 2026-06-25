/**
 * Wipes the assets collection and re-imports the ASSET sheet of
 * "1. FA register.xlsx" EXACTLY as it appears — same row order, blank rows,
 * duplicate Asset IDs, line breaks and spacing preserved.
 *
 * Reads the FORMATTED cell text (what Excel displays, e.g. "31-Mar-25",
 * "25,000"), which reproduces a copy-paste of the sheet byte-for-byte.
 *
 * Columns captured (the 11 requested), by source column letter:
 *   A Asset ID | B Asset Description | C Category | D Purchase Date | E Vendor |
 *   F Cost (₹ / $) | G Location | L Serial Number / Tag | M Assigned To |
 *   N Complaints / Recover Date | O Remarks
 */
const path = require('path');
const XLSX = require(path.join('c:/Users/PRAKASH/Downloads/fixed-asset-register/fixed-asset-register/frontend/node_modules/xlsx'));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const FILE = 'C:/Users/PRAKASH/Downloads/1. FA register.xlsx';
const HEADER_ROW = 3;            // 1-based; data starts at row 4
const COLS = {                   // model field -> source column letter
  assetId: 'A', description: 'B', category: 'C', purchaseDate: 'D', vendor: 'E',
  cost: 'F', location: 'G', serialNumber: 'L', assignedTo: 'M', complaints: 'N', remarks: 'O',
};

// Status derivation (kept only for the dashboard; not one of the 11 displayed columns).
function normaliseStatus(remarks) {
  const r = (remarks || '').trim().toLowerCase();
  if (!r) return 'Unknown';
  if (r.includes('damage')) return 'Damaged';
  if (r.includes('dispos')) return 'Disposed';
  if (r.includes('not')) return 'Not in use';
  if (r.includes('use')) return 'In use';
  return remarks.trim();
}

// Exact formatted text of a cell, preserving spacing/line breaks; null if empty.
function cellText(ws, colLetter, row) {
  const cell = ws[`${colLetter}${row}`];
  if (!cell) return null;
  let v = cell.w != null ? cell.w : (cell.v != null ? String(cell.v) : null);
  if (v == null) return null;
  return v === '' ? null : v;
}

function rowIsEmpty(rec) {
  return Object.values(rec).every((v) => v == null);
}

(async () => {
  const wb = XLSX.readFile(FILE, { cellNF: true, cellText: true });
  const ws = wb.Sheets['ASSET '];
  if (!ws) throw new Error('ASSET sheet not found');
  const range = XLSX.utils.decode_range(ws['!ref']);

  // Find the last row with content in ANY of our 11 columns. The sheet's stored
  // dimension is bloated to ~1M rows, so cap the scan well past the real data.
  const SCAN_MAX = Math.min(range.e.r + 1, HEADER_ROW + 5000);
  let lastRow = HEADER_ROW;
  for (let r = HEADER_ROW + 1; r <= SCAN_MAX; r++) {
    const any = Object.values(COLS).some((col) => cellText(ws, col, r) != null);
    if (any) lastRow = r;
  }

  // Build records for every row from 4..lastRow (blank rows included verbatim).
  const docs = [];
  let seq = 0;
  for (let r = HEADER_ROW + 1; r <= lastRow; r++) {
    const rec = {};
    for (const [field, col] of Object.entries(COLS)) rec[field] = cellText(ws, col, r);
    if (rowIsEmpty(rec)) continue; // skip fully-blank rows — keep only rows with data
    docs.push({
      seq: seq++,
      ...rec,
      status: normaliseStatus(rec.remarks),
      createdById: null,
      updatedById: null,
    });
  }

  const before = await prisma.asset.count();
  await prisma.asset.deleteMany({});
  await prisma.asset.createMany({ data: docs });
  const after = await prisma.asset.count();

  const blanks = docs.filter((d) => rowIsEmpty({ assetId: d.assetId, description: d.description, category: d.category, purchaseDate: d.purchaseDate, vendor: d.vendor, cost: d.cost, location: d.location, serialNumber: d.serialNumber, assignedTo: d.assignedTo, complaints: d.complaints, remarks: d.remarks })).length;
  const withId = docs.filter((d) => d.assetId != null).length;

  console.log(`Source rows 4..${lastRow}  ->  imported ${docs.length} rows`);
  console.log(`  rows with an Asset ID: ${withId}`);
  console.log(`  fully-blank rows:      ${blanks}`);
  console.log(`DB count: ${before} -> ${after}`);
  console.log('\nFirst 6 rows (seq | assetId | description | cost | assignedTo):');
  docs.slice(0, 6).forEach((d) => console.log(`  ${String(d.seq).padStart(3)} | ${JSON.stringify(d.assetId)} | ${JSON.stringify(d.description)} | ${JSON.stringify(d.cost)} | ${JSON.stringify(d.assignedTo)}`));

  await prisma.$disconnect();
})().catch(async (e) => { console.error('FAILED:', e.message); await prisma.$disconnect(); process.exit(1); });
