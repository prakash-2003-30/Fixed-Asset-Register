/**
 * Generates an asset report grouped by employee (assignedTo).
 * Reads the live database via Prisma and writes a formatted .txt report.
 *
 * Run from the backend folder:  node scripts/report-by-employee.js
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---- helpers -------------------------------------------------------------

// Show a value or a dash when empty/null.
function val(v) {
  if (v === null || v === undefined) return '-';
  const s = String(v).trim();
  return s === '' ? '-' : s;
}

// Format a cost number with thousands separators; keep non-numbers as-is.
function fmtCost(c) {
  if (c === null || c === undefined || c === '') return '-';
  const n = Number(c);
  if (Number.isNaN(n)) return String(c);
  return n.toLocaleString('en-IN');
}

// Try to normalise a purchase date to "dd-Mon-yyyy".
// Falls back to the original string when the format is not recognised.
function fmtDate(d) {
  if (!d) return '-';
  const s = String(d).trim();
  if (s === '') return '-';

  // ISO: yyyy-mm-dd
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [, y, mo, day] = m;
    const mi = parseInt(mo, 10) - 1;
    if (mi >= 0 && mi < 12) return `${day}-${MONTHS[mi]}-${y}`;
  }

  // dd-mm-yy or dd-mm-yyyy
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (m) {
    let [, day, mo, y] = m;
    const mi = parseInt(mo, 10) - 1;
    if (y.length === 2) y = '20' + y;
    if (mi >= 0 && mi < 12) return `${day.padStart(2, '0')}-${MONTHS[mi]}-${y}`;
  }

  // Already like dd-Mon-yyyy (or anything else) -> keep original
  return s;
}

// Split a trailing memory/spec token (e.g. "16GB", "512 GB", "1TB") off the
// description. Returns { name, spec }.
function splitSpec(description) {
  if (!description) return { name: '-', spec: null };
  let text = String(description).replace(/\s+/g, ' ').trim();
  const specMatch = text.match(/\b(\d+\s?(?:GB|TB|MB))\b\s*$/i);
  let spec = null;
  if (specMatch) {
    spec = specMatch[1].replace(/\s+/g, '').toUpperCase();
    text = text.slice(0, specMatch.index).trim();
  }
  return { name: text === '' ? '-' : text, spec };
}

// Title-case a status for display ("In use" -> "In Use").
function fmtStatus(s) {
  if (!s) return '-';
  return String(s)
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function assetBlock(a, index) {
  const { name, spec } = splitSpec(a.description);
  const lines = [];
  lines.push(`${index}.`);
  lines.push(`Asset ID: ${val(a.assetId)}`);
  lines.push(`Asset Name: ${name}`);
  if (spec) lines.push(`Specification: ${spec}`);
  lines.push(`Category: ${val(a.category)}`);
  lines.push(`Purchase Date: ${fmtDate(a.purchaseDate)}`);
  lines.push(`Vendor: ${val(a.vendor)}`);
  lines.push(`Cost: ${fmtCost(a.cost)}`);
  lines.push(`Location: ${val(a.location)}`);
  lines.push(`Serial Number: ${val(a.serialNumber)}`);
  lines.push(`Remarks: ${val(a.complaints)}`);
  lines.push(`Status: ${fmtStatus(a.status)}`);
  return lines.join('\n');
}

// ---- main ----------------------------------------------------------------

(async () => {
  const assets = await prisma.asset.findMany();

  // Group by assignedTo (trimmed). Null/blank -> "Unassigned".
  const groups = new Map();
  for (const a of assets) {
    const emp = (a.assignedTo && a.assignedTo.trim()) || 'Unassigned';
    if (!groups.has(emp)) groups.set(emp, []);
    groups.get(emp).push(a);
  }

  // Sort: real employees alphabetically, "Unassigned" last.
  const names = [...groups.keys()].sort((x, y) => {
    if (x === 'Unassigned') return 1;
    if (y === 'Unassigned') return -1;
    return x.localeCompare(y);
  });

  const SEP = '-'.repeat(50);
  const blocks = [];
  for (const name of names) {
    const list = groups.get(name).sort((p, q) => String(p.assetId || '').localeCompare(String(q.assetId || '')));
    const out = [];
    out.push(`Employee: ${name}`);
    out.push(`Total Assets: ${list.length}`);
    out.push('');
    list.forEach((a, i) => {
      out.push(assetBlock(a, i + 1));
      out.push('');
    });
    blocks.push(out.join('\n').trimEnd());
  }

  const header = [
    'FIXED ASSET REGISTER — ASSETS GROUPED BY EMPLOYEE',
    `Generated from the live database`,
    `Employees: ${names.filter((n) => n !== 'Unassigned').length}` +
      (names.includes('Unassigned') ? ' (+ Unassigned)' : '') +
      `   |   Total assets: ${assets.length}`,
    SEP,
    '',
  ].join('\n');

  const report = header + blocks.join('\n\n' + SEP + '\n\n') + '\n';

  const outDir = path.join(__dirname, '..', 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'assets-by-employee.txt');
  fs.writeFileSync(outFile, report, 'utf-8');

  console.log(report);
  console.error(`\n[written to ${outFile}]`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
