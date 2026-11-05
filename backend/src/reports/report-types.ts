/**
 * THE REPORT CONTRACT
 * ─────────────────────────────────────────────────────────────────────────────
 * Every report in this platform — nine of them, CSV or PDF — is produced as the
 * same object: `ReportTable`. One builder produces it, one CSV writer and one PDF
 * writer consume it.
 *
 * That is not tidiness for its own sake. It means the CSV and the PDF of a report
 * cannot disagree, because they are two renderings of one array; and it means a
 * test can assert a report's totals against the dashboard and the ledger without
 * parsing a PDF.
 *
 * Money is carried in **kobo** (integers) and rendered twice: as a plain naira
 * decimal for CSV (so a spreadsheet can sum the column) and as ₦-formatted text
 * for the PDF (so a human can read it). Rounding happens once, at render time.
 */
export interface ReportColumn {
  /** Key into each row. */
  key: string;
  label: string;
  align?: 'left' | 'right';
  /** Render as ₦ in the PDF and as a plain naira decimal in the CSV. */
  money?: boolean;
  /** Relative width hint for the PDF layout (defaults to 1). */
  weight?: number;
}

export interface ReportRow {
  [key: string]: string | number | null;
}

export interface ReportTotal {
  label: string;
  /** Kobo for money totals, a raw number for counts. */
  value: number | bigint;
  money?: boolean;
  /** Totals that must not be added up by the reader (e.g. "net"). */
  emphasis?: boolean;
}

export interface ReportTable {
  type: string;
  title: string;
  /** One sentence a reader can quote, stating what the numbers are. */
  subtitle: string;
  meta: Array<{ label: string; value: string }>;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportTotal[];
  /** Set when the dataset was cut short, so nobody mistakes a sample for a census. */
  truncated?: { shown: number; total: number };
}

export const REPORT_CATALOGUE = [
  {
    type: 'DAILY_DELIVERIES',
    title: 'Daily deliveries',
    description: 'Bookings, completions, cancellations and delivered revenue for every day in the period.',
    formats: ['CSV', 'PDF'],
  },
  {
    type: 'MONTHLY_DELIVERIES',
    title: 'Monthly deliveries',
    description: 'The same measures rolled up by month — the view a board actually asks for.',
    formats: ['CSV', 'PDF'],
  },
  {
    type: 'REVENUE',
    title: 'Revenue by provider and day',
    description: 'Settled payments with gateway fees and the net that actually reached the company.',
    formats: ['CSV', 'PDF'],
  },
  {
    type: 'RIDER_EARNINGS',
    title: 'Rider earnings',
    description: 'Gross, commission and net per rider, split by what is still on hold and what has cleared.',
    formats: ['CSV', 'PDF'],
  },
  {
    type: 'CUSTOMERS',
    title: 'Customers',
    description: 'Who is booking, how much they have spent, and when they were last active.',
    formats: ['CSV', 'PDF'],
  },
  {
    type: 'CANCELLATIONS',
    title: 'Cancellations',
    description: 'Every cancelled delivery with its reason, who cancelled it and when.',
    formats: ['CSV', 'PDF'],
  },
  {
    type: 'RIDER_PERFORMANCE',
    title: 'Rider performance',
    description: 'Completion rate, average delivery time, acceptance rate and ratings per rider.',
    formats: ['CSV', 'PDF'],
  },
  {
    type: 'ZONE_PERFORMANCE',
    title: 'Zone performance',
    description: 'Deliveries and revenue per service zone, with average trip distance.',
    formats: ['CSV', 'PDF'],
  },
  {
    type: 'FINANCIAL_SUMMARY',
    title: 'Financial summary',
    description:
      'Collected, refunded, rider cost, gateway fees and net — read from the ledger, so it reconciles with the finance screen.',
    formats: ['CSV', 'PDF'],
  },
] as const;

export type ReportTypeName = (typeof REPORT_CATALOGUE)[number]['type'];
export type ReportFormat = 'CSV' | 'PDF';

/** How many rows a `preview` will render before it stops. */
export const PREVIEW_ROW_LIMIT = 25;

/** Hard cap on rows inside one file: a report is not a database dump. */
export const MAX_REPORT_ROWS = 5000;
