/** Shared file/position contract. Pure data validation; never parses or analyses a source file. */
export const INPUT_MAX_BYTES = 50 * 1024 * 1024;
export const EVIDENCE_FILE_MAX_BYTES = 50 * 1024 * 1024;
export const EVIDENCE_TOTAL_MAX_BYTES = 100 * 1024 * 1024;
export const INPUT_EXTENSIONS = ['.csv', '.tsv', '.json', '.md', '.xlsx'];
export const EVIDENCE_EXTENSIONS = ['.csv', '.tsv', '.json', '.md', '.txt', '.py', '.sql'];
export type DataContextInputFormat = 'csv' | 'tsv' | 'json' | 'xlsx' | 'markdown' | 'unsupported';
export function dataContextInputFormat(sourcePath: string): DataContextInputFormat {
  const lower = sourcePath.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.tsv')) return 'tsv';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.md')) return 'markdown';
  return 'unsupported';
}

/** Canonical, finite A1 source coordinates; sheet identity is a separate literal string. */
export function normalizeXlsxRange(value: string): string {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})(?::([A-Z]{1,3})([1-9][0-9]{0,6}))?$/.exec(value);
  const invalid = () => { throw new Error('invalid_data_context_xlsx_range'); };
  if (!match) return invalid();
  const column = (name: string) => [...name].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
  const startColumn = column(match[1]!), startRow = Number(match[2]), endColumn = match[3] ? column(match[3]) : startColumn, endRow = match[4] ? Number(match[4]) : startRow;
  if (startColumn > 16384 || endColumn > 16384 || startRow > 1048576 || endRow > 1048576 || startColumn > endColumn || startRow > endRow) return invalid();
  return value;
}
