/** Project material transport limits; these do not change report or enterprise-material limits. */
export const PROJECT_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const PROJECT_UPLOAD_JSON_MAX_BYTES = Math.ceil(PROJECT_UPLOAD_MAX_BYTES / 3) * 4 + 65_536;
export const PROJECT_TEXT_UPLOAD_EXTENSIONS: readonly string[] = ['.csv', '.tsv', '.json', '.md', '.markdown', '.txt'];
export const PROJECT_UPLOAD_EXTENSIONS: readonly string[] = [
  ...PROJECT_TEXT_UPLOAD_EXTENSIONS,
  '.pdf', '.doc', '.docx', '.rtf', '.html', '.htm', '.mhtml', '.mht',
  '.ppt', '.pptx', '.xls', '.xlsx', '.xlsm', '.odt', '.ods', '.odp',
];
export const PROJECT_UPLOAD_ACCEPT = PROJECT_UPLOAD_EXTENSIONS.join(',');

export function isProjectUploadName(name: string): boolean {
  const cleaned = name.trim(), dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 ? cleaned.slice(dot).toLowerCase() : '';
  return Boolean(name.trim()) && name.length <= 200 && !/[\\/\u0000-\u001f\u007f]/.test(name) && PROJECT_UPLOAD_EXTENSIONS.includes(extension);
}
