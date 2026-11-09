import PDFDocument from 'pdfkit';
import { formatNaira } from '@dispatch/shared';
import type { ReportTable } from './report-types';

/**
 * TWO RENDERINGS, ONE SOURCE
 * ─────────────────────────────────────────────────────────────────────────────
 * Both functions below take the *same* `ReportTable` object. That is the whole
 * design: a CSV and a PDF of the same report cannot disagree, because neither one
 * queries anything — they only print.
 *
 * The one intentional difference:
 *
 *   · CSV money cells are plain naira decimals (`4894.50`), so a spreadsheet can
 *     sum the column. A formatted `₦4,894.50` would arrive as text and break SUM().
 *   · PDF money cells are ₦-formatted, because a human reads them.
 *
 * Both carry the same kobo value, so the totals reconcile either way.
 */

/** 489450 kobo → "4894.50". No symbol, no thousands separator: spreadsheets. */
export function koboToPlainNaira(kobo: number | bigint): string {
  const value = typeof kobo === 'bigint' ? kobo : BigInt(Math.round(kobo));
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const naira = absolute / 100n;
  const koboPart = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${naira}.${koboPart}`;
}

const escapeCsv = (value: string): string => {
  // A reason field can legitimately contain a comma, a quote or a newline.
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
};

export function renderCsv(table: ReportTable): Buffer {
  const lines: string[] = [];

  // Provenance first. These are comment lines beginning with '#', which spreadsheets
  // ignore on import but a person reading the file in a text editor needs.
  lines.push(`# ${table.title}`);
  lines.push(`# ${table.subtitle}`);
  for (const item of table.meta) lines.push(`# ${item.label}: ${item.value}`);
  if (table.truncated) {
    lines.push(`# WARNING: showing ${table.truncated.shown} of ${table.truncated.total} rows`);
  }
  lines.push('#');
  lines.push(table.columns.map((column) => escapeCsv(column.label)).join(','));

  for (const row of table.rows) {
    lines.push(
      table.columns
        .map((column) => {
          const raw = row[column.key];
          if (raw === null || raw === undefined) return '';
          if (column.money) return koboToPlainNaira(Number(raw));
          return escapeCsv(String(raw));
        })
        .join(','),
    );
  }

  // A trailing total block, separated by a blank line, so a reader can see the
  // figures without a formula and a SUM() over the rows above still works.
  if (table.totals.length > 0) {
    lines.push('');
    lines.push('# Totals');
    for (const total of table.totals) {
      const value = total.money ? koboToPlainNaira(total.value) : String(total.value);
      lines.push(`${escapeCsv(total.label)},${value}`);
    }
  }

  // BOM so Excel opens UTF-8 (₦, é) correctly on Windows.
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

/* ───────────────────────────────── PDF ───────────────────────────────── */

const PAGE_MARGIN = 36;
const NAVY = '#0C3627';
const INK = '#1F2937';
const MUTED = '#64748B';
const LINE = '#E2E8F0';

export async function renderPdf(table: ReportTable): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: PAGE_MARGIN, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - PAGE_MARGIN * 2;

  /* header */
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(18).text('Traders Welfare Logistics', PAGE_MARGIN, PAGE_MARGIN);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(INK).text(table.title, PAGE_MARGIN, PAGE_MARGIN + 26);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(table.subtitle, PAGE_MARGIN, PAGE_MARGIN + 46, { width: contentWidth });

  let metaY = PAGE_MARGIN + 66;
  for (const item of table.meta) {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`${item.label}: ${item.value}`, PAGE_MARGIN, metaY);
    metaY += 11;
  }

  if (table.truncated) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#B45309').text(
      `Showing ${table.truncated.shown} of ${table.truncated.total} rows.`,
      PAGE_MARGIN,
      metaY,
    );
    metaY += 12;
  }

  /* totals block, above the table — a director reads the answer first */
  const totalValues = table.totals
    .map((total) => `${total.label}: ${total.money ? formatNaira(typeof total.value === 'bigint' ? total.value : BigInt(Math.round(Number(total.value)))) : total.value}`)
    .join('   ·   ');

  if (totalValues) doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(totalValues, PAGE_MARGIN, metaY, { width: contentWidth });
  let y = metaY + (totalValues ? 22 : 8);

  /* column widths from the weight hints */
  const totalWeight = table.columns.reduce((sum, column) => sum + (column.weight ?? 1), 0);
  const widths = table.columns.map((column) => ((column.weight ?? 1) / totalWeight) * contentWidth);
  const rowHeight = 16;
  const bottomLimit = doc.page.height - PAGE_MARGIN - 24;

  const drawHeaderRow = () => {
    doc.fillColor('#F1F5F9').rect(PAGE_MARGIN, y - 3, contentWidth, rowHeight).fill();
    let x = PAGE_MARGIN + 4;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
    table.columns.forEach((column, index) => {
      doc.text(column.label.toUpperCase(), x, y, {
        width: widths[index]! - 8,
        align: column.align === 'right' ? 'right' : 'left',
        lineBreak: false,
      });
      x += widths[index]!;
    });
    y += rowHeight;
  };

  drawHeaderRow();

  doc.font('Helvetica').fontSize(8);
  for (const [index, row] of table.rows.entries()) {
    if (y > bottomLimit) {
      doc.addPage();
      y = PAGE_MARGIN;
      drawHeaderRow();
      doc.font('Helvetica').fontSize(8);
    }

    if (index % 2 === 1) doc.fillColor('#FAFAFA').rect(PAGE_MARGIN, y - 3, contentWidth, rowHeight).fill();

    let x = PAGE_MARGIN + 4;
    table.columns.forEach((column, columnIndex) => {
      const raw = row[column.key];
      const text =
        raw === null || raw === undefined
          ? '—'
          : column.money
            ? formatNaira(Number(raw))
            : String(raw);
      doc.fillColor(INK).text(text, x, y, {
        width: widths[columnIndex]! - 8,
        align: column.align === 'right' ? 'right' : 'left',
        lineBreak: false,
        ellipsis: true,
      });
      x += widths[columnIndex]!;
    });
    y += rowHeight;
  }

  if (table.rows.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text('No rows matched this period.', PAGE_MARGIN, y + 4);
  } else {
    doc.moveTo(PAGE_MARGIN, y).lineTo(pageWidth - PAGE_MARGIN, y).strokeColor(LINE).stroke();
    y += 10;

    doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text('Totals', PAGE_MARGIN, y);
    y += 14;
    for (const total of table.totals) {
      const value = total.money
        ? formatNaira(typeof total.value === 'bigint' ? total.value : BigInt(Math.round(Number(total.value))))
        : String(total.value);
      doc.font(total.emphasis ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(total.emphasis ? NAVY : INK);
      doc.text(total.label, PAGE_MARGIN + 4, y, { width: contentWidth * 0.45, lineBreak: false });
      doc.text(value, PAGE_MARGIN + contentWidth * 0.45, y, { width: contentWidth * 0.5, align: 'right', lineBreak: false });
      y += 13;
    }
  }

  /* footers: every page says what it is and where it came from */
  const range = doc.bufferedPageRange();
  for (let pageIndex = 0; pageIndex < range.count; pageIndex += 1) {
    doc.switchToPage(range.start + pageIndex);
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(MUTED)
      .text(
        `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${table.type} · figures computed from the database at generation time`,
        PAGE_MARGIN,
        doc.page.height - PAGE_MARGIN + 6,
        { width: contentWidth * 0.75, lineBreak: false },
      );
    doc.text(`Page ${pageIndex + 1} of ${range.count}`, PAGE_MARGIN + contentWidth * 0.75, doc.page.height - PAGE_MARGIN + 6, {
      width: contentWidth * 0.25,
      align: 'right',
      lineBreak: false,
    });
  }

  doc.end();
  return finished;
}
