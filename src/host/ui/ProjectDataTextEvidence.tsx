/** Original decoded text stays authoritative; friendly lines are an optional reading aid. */
export function ProjectDataTextEvidence({ text }: { text: string }) {
  let end = Math.min(text.length, 40_000);
  if (end < text.length && end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
  const preview = text.slice(0, end), lines = preview.split(/\r\n|\r|\n/, 301).slice(0, 300);
  return <>
    <p className="pdc-help">原文 UTF-16 [0, {end}) / {text.length}。{end < text.length ? '当前为片段，固定文件仍完整保存。' : '本次已读取完整原文。'}BOM、换行和 emoji 保留；文字行号不是数据记录数。</p>
    <pre className="pdc-evidence">{preview}</pre>
    <details className="pdc-friendly-lines"><summary>友好行号 · 仅供阅读</summary><p className="pdc-help">最多显示前 300 行；精确引用仍使用上面的原文 UTF-16 半开位置。</p><ol>{lines.map((line, index) => <li key={index}><span>{line || '\u200b'}</span></li>)}</ol></details>
  </>;
}
