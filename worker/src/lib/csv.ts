/** UTF-8 BOM. Without it Excel mangles any non-ASCII in an exported name. */
export const BOM = '\uFEFF';

/**
 * RFC 4180 cell.
 *
 * Two separate jobs:
 *  1. quoting -- wrap when the value contains a comma, quote, CR or LF, and
 *     double any embedded quote.
 *  2. formula neutralisation -- a cell starting = + - @ or a control char is
 *     executed by Excel and Sheets when the file is opened. An album title or
 *     an email local-part is attacker-influenced text, so it gets a leading
 *     apostrophe. This is the OWASP CSV-injection guard, and it is why the
 *     export is safe to double-click.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',') + '\r\n';
}
