import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { prisma } from '../prisma';
import { authenticate } from '../middleware/auth';
import { COLUMNS } from '../utils/columns';
import { buildWhere, buildOrderBy, ownerExpandedIds } from './assets';
import { formatIndianCost } from '../utils/format';
import { config } from '../config';

const router = Router();
router.use(authenticate);

// Mirror the UI exactly: same filters/search, same order, and the same assignee
// "owner group" expansion (an employee's blank-assignee peripherals are included).
async function fetchAll(query: any) {
  const ownerIds = await ownerExpandedIds(query);
  let where;
  if (ownerIds) {
    const { assignedTo, ...rest } = query;
    where = { AND: [{ id: { in: ownerIds } }, buildWhere(rest)] };
  } else {
    where = buildWhere(query);
  }
  return prisma.asset.findMany({ where, orderBy: buildOrderBy(query) });
}

// GET /api/export/xlsx — rebuild the register in the original Excel layout
router.get('/xlsx', async (req, res, next) => {
  try {
    const assets = await fetchAll(req.query);
    const wb = new ExcelJS.Workbook();
    wb.creator = config.companyName;
    wb.created = new Date();
    const ws = wb.addWorksheet('ASSET');

    // Title block (rows 1-2) mirroring the source file
    ws.mergeCells(1, 1, 1, COLUMNS.length);
    ws.getCell(1, 1).value = config.companyName;
    ws.getCell(1, 1).font = { bold: true, size: 14 };
    ws.getCell(1, 1).alignment = { horizontal: 'center' };
    ws.mergeCells(2, 1, 2, COLUMNS.length);
    ws.getCell(2, 1).value = config.reportTitle;
    ws.getCell(2, 1).font = { bold: true, size: 12 };
    ws.getCell(2, 1).alignment = { horizontal: 'center' };

    // Header row (row 3)
    const headerRow = ws.getRow(3);
    COLUMNS.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E7490' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });
    headerRow.height = 30;

    // Data rows (Cost shown with Indian grouping; all else verbatim)
    assets.forEach((a: any) => {
      const row = ws.addRow(COLUMNS.map((c) => (c.key === 'cost' ? formatIndianCost(a[c.key]) : a[c.key] ?? '')));
      row.eachCell((cell) => {
        cell.border = { top: { style: 'hair' }, bottom: { style: 'hair' }, left: { style: 'hair' }, right: { style: 'hair' } };
        cell.alignment = { vertical: 'top', wrapText: true };
      });
    });

    // Column widths
    const widths = [10, 28, 16, 14, 14, 12, 14, 12, 16, 16, 12, 30, 22, 28, 12];
    ws.columns.forEach((col, i) => (col.width = widths[i] || 16));
    ws.views = [{ state: 'frozen', ySplit: 3 }];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Fixed_Asset_Register_${Date.now()}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    next(e);
  }
});

// GET /api/export/pdf — full register, landscape, multi-page, header/footer
router.get('/pdf', async (req, res, next) => {
  try {
    const assets = await fetchAll(req.query);
    const generatedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

    // Landscape, all 11 columns. Each row auto-sizes to its wrapped content with
    // comfortable padding; long values (serial/asset codes, remarks) wrap to
    // multiple lines and are never clipped. Serial & remarks columns are widened.
    const ROW_FONT = 7;
    const HEADER_FONT = 7;
    const PAD_V = 5;          // vertical padding inside each cell
    const PAD_H = 4;          // horizontal padding inside each cell
    const LINE_GAP = 1;
    const MIN_ROW_H = 16;
    const HEADER_H = 30;
    const printCols = COLUMNS.filter((c) =>
      ['assetId', 'description', 'category', 'purchaseDate', 'vendor', 'cost', 'location', 'serialNumber', 'assignedTo', 'complaints', 'remarks'].includes(c.key)
    );
    const colWidth: Record<string, number> = {
      assetId: 46, description: 90, category: 54, purchaseDate: 50, vendor: 56,
      cost: 56, location: 50, serialNumber: 106, assignedTo: 96, complaints: 82, remarks: 92,
    };
    const numericCols = new Set(['cost']); // right-aligned; all others left-aligned
    // Display only (data unchanged): collapse stray line breaks so wrapping is
    // driven by column width rather than newlines embedded in the source text.
    const cellText = (v: any) => (v == null ? '' : String(v).replace(/[\r\n]+/g, ' '));

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Fixed_Asset_Register_${Date.now()}.pdf"`);
    doc.pipe(res);

    // The built-in PDF fonts (Helvetica) have no Indian-Rupee glyph (₹), so it
    // would silently drop. Embed Nirmala UI (bundled under assets/fonts) which
    // contains ₹; fall back to Helvetica if the font file is ever missing.
    let BODY = 'Helvetica';
    let BODY_BOLD = 'Helvetica-Bold';
    const fontDir = [
      path.join(process.cwd(), 'assets', 'fonts'),
      path.join(__dirname, '..', '..', 'assets', 'fonts'),
    ].find((d) => fs.existsSync(path.join(d, 'NirmalaUI-Regular.ttf')));
    if (fontDir) {
      doc.registerFont('Body', path.join(fontDir, 'NirmalaUI-Regular.ttf'));
      doc.registerFont('Body-Bold', path.join(fontDir, 'NirmalaUI-Bold.ttf'));
      BODY = 'Body';
      BODY_BOLD = 'Body-Bold';
    }

    // Company logo for the page header (bundled under assets/); skipped if missing.
    const logoPath = [
      path.join(process.cwd(), 'assets', 'logo.png'),
      path.join(__dirname, '..', '..', 'assets', 'logo.png'),
    ].find((p) => fs.existsSync(p));

    const pageLeft = doc.page.margins.left;
    const pageRight = doc.page.width - doc.page.margins.right;
    const tableWidth = printCols.reduce((s, c) => s + colWidth[c.key], 0);

    let pageNo = 0;
    const drawPageChrome = () => {
      pageNo += 1;
      // Letterhead CENTERED as a unit: [logo][company name / report title]. Measure
      // the text so the whole logo+title group is centred on the page.
      const logoW = 50, logoH = 46, gap = 12;
      doc.font(BODY_BOLD).fontSize(14);
      const nameW = doc.widthOfString(config.companyName);
      doc.font(BODY_BOLD).fontSize(11);
      const titleW = doc.widthOfString(config.reportTitle);
      const textW = Math.max(nameW, titleW);
      const groupW = logoW + gap + textW;
      const startX = pageLeft + Math.max(0, (pageRight - pageLeft - groupW) / 2);
      if (logoPath) { try { doc.image(logoPath, startX, 14, { fit: [logoW, logoH] }); } catch { /* ignore bad image */ } }
      const tx = startX + logoW + gap;
      doc.fontSize(14).font(BODY_BOLD).fillColor('#0E7490').text(config.companyName, tx, 20, { align: 'left', width: textW + 4 });
      // Subtitle centred beneath the company name.
      doc.fontSize(11).font(BODY_BOLD).fillColor('#155E75').text(config.reportTitle, tx, 40, { align: 'center', width: textW + 4 });
      doc.fontSize(8).font(BODY).fillColor('#666').text(`Generated: ${generatedAt}`, pageLeft, 64, { align: 'right', width: pageRight - pageLeft });
      doc.fillColor('#000');
    };

    // Vertical column separators spanning a y..y+h band (left edge + each boundary).
    const drawVerticals = (yTop: number, h: number, color: string) => {
      let vx = pageLeft;
      doc.strokeColor(color).lineWidth(0.5);
      doc.moveTo(vx, yTop).lineTo(vx, yTop + h).stroke();
      printCols.forEach((c) => { vx += colWidth[c.key]; doc.moveTo(vx, yTop).lineTo(vx, yTop + h).stroke(); });
    };

    const drawHeaderRow = (yy: number) => {
      doc.rect(pageLeft, yy, tableWidth, HEADER_H).fill('#0E7490');
      doc.fillColor('#FFFFFF').fontSize(HEADER_FONT).font(BODY_BOLD);
      let x = pageLeft;
      printCols.forEach((c) => {
        const w = colWidth[c.key] - 2 * PAD_H;
        const th = doc.heightOfString(c.header, { width: w, lineGap: LINE_GAP });
        doc.text(c.header, x + PAD_H, yy + Math.max(0, (HEADER_H - th) / 2), {
          width: w, lineGap: LINE_GAP, align: numericCols.has(c.key) ? 'right' : 'left',
        });
        x += colWidth[c.key];
      });
      drawVerticals(yy, HEADER_H, '#22D3EE'); // subtle separators on the dark header band
      doc.fillColor('#000').font(BODY);
      return yy + HEADER_H;
    };

    const footer = () => {
      // Must sit fully ABOVE the bottom margin — any text crossing it makes PDFKit
      // auto-insert a blank page (one per footer). Measure the line height so this
      // holds for ANY font (the tall embedded font previously overflowed at -10).
      doc.fontSize(8).font(BODY).fillColor('#666');
      const label = `Page ${pageNo}`;
      const fh = doc.heightOfString(label, { lineBreak: false });
      const fy = doc.page.height - doc.page.margins.bottom - fh - 2; // 2pt clearance
      doc.text(label, pageLeft, fy, { align: 'right', width: pageRight - pageLeft, lineBreak: false });
      doc.fillColor('#000');
    };

    // A "section title" row carries text only in Asset ID (e.g. "ELECTRICAL
    // ASSETS"), with every other column blank. Rendered as a centred heading.
    const isSection = (a: any) =>
      a.assetId != null && String(a.assetId).trim() !== '' &&
      ['description', 'category', 'purchaseDate', 'vendor', 'cost', 'location', 'serialNumber', 'assignedTo', 'complaints', 'remarks']
        .every((f) => a[f] == null || String(a[f]).trim() === '');

    const bottom = doc.page.height - doc.page.margins.bottom - 16;
    let y = 0;
    let pageInited = false;

    // Draw page chrome + column header, lazily.
    const initPage = () => { drawPageChrome(); y = drawHeaderRow(78); pageInited = true; };

    // Call immediately BEFORE drawing a block. The page header is only drawn when
    // there is real content to place beneath it, so the PDF can never contain a
    // header-only (or blank) page, and never starts a page that stays empty.
    const reserve = (needed: number) => {
      if (!pageInited) { initPage(); return; }
      if (y + needed > bottom) { footer(); doc.addPage(); pageInited = false; initPage(); }
    };

    assets.forEach((a: any, idx: number) => {
      // Section heading — bold, centred, larger — followed by a repeated column
      // header so each section reads as its own table.
      if (isSection(a)) {
        const title = String(a.assetId).trim();
        const topPad = 16, titleH = 22, botPad = 10;
        const blockH = topPad + titleH + botPad;
        // Keep the heading + its column header (+ at least one row) together.
        reserve(blockH + HEADER_H + MIN_ROW_H);
        doc.font(BODY_BOLD).fontSize(16).fillColor('#0E7490')
          .text(title, pageLeft, y + topPad, { width: pageRight - pageLeft, align: 'center' });
        doc.font(BODY).fillColor('#000');
        y += blockH;
        y = drawHeaderRow(y); // repeat the table header beneath the section title
        return;
      }

      // Data row — height auto-sizes to the tallest wrapped cell + padding.
      doc.font(BODY).fontSize(ROW_FONT);
      let contentH = 0;
      printCols.forEach((c) => {
        const measured = c.key === 'cost' ? formatIndianCost(a[c.key]) : cellText(a[c.key]);
        const h = doc.heightOfString(measured, { width: colWidth[c.key] - 2 * PAD_H, lineGap: LINE_GAP });
        contentH = Math.max(contentH, h);
      });
      const rowH = Math.max(MIN_ROW_H, contentH + 2 * PAD_V);

      reserve(rowH);

      if (idx % 2 === 1) doc.rect(pageLeft, y, tableWidth, rowH).fill('#ECFEFF');
      let x = pageLeft;
      doc.font(BODY).fontSize(ROW_FONT).fillColor('#000');
      printCols.forEach((c) => {
        const w = colWidth[c.key] - 2 * PAD_H;
        const txt = c.key === 'cost' ? formatIndianCost(a[c.key]) : cellText(a[c.key]);
        const h = doc.heightOfString(txt, { width: w, lineGap: LINE_GAP });
        // Vertically centre the (possibly multi-line) value within the row.
        doc.fillColor('#000').text(txt, x + PAD_H, y + Math.max(PAD_V, (rowH - h) / 2), {
          width: w, lineGap: LINE_GAP, align: numericCols.has(c.key) ? 'right' : 'left',
        });
        x += colWidth[c.key];
      });
      // grid: column separators + bottom border for an even, professional look
      drawVerticals(y, rowH, '#DDDDDD');
      doc.strokeColor('#DDDDDD').lineWidth(0.5).moveTo(pageLeft, y + rowH).lineTo(pageLeft + tableWidth, y + rowH).stroke();
      y += rowH;
    });

    if (!pageInited) {
      // No records at all — show the header once with an empty-state note rather
      // than emitting a blank first page.
      initPage();
      doc.font(BODY).fontSize(9).fillColor('#666').text('No asset records.', pageLeft, y + 10, { width: pageRight - pageLeft, align: 'center' });
      doc.fillColor('#000');
    }
    footer(); // footer on the final (last content) page only
    doc.end();
  } catch (e) {
    next(e);
  }
});

export default router;
