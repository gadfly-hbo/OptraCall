import { useEffect, useRef, useState } from 'react';
import { manualMeta, manualSections, type HelpBlock } from './help-content.ts';
import { manualMarkdown } from './help-document.ts';

function Block({ block }: { block: HelpBlock }) {
  switch (block.kind) {
    case 'text': return <p>{block.text}</p>;
    case 'steps': return <ol className="help-steps">{block.items.map((item, index) => <li key={index}>{item}</li>)}</ol>;
    case 'list': return <ul>{block.items.map((item, index) => <li key={index}>{item}</li>)}</ul>;
    case 'prompt': return <div className="help-example"><h3>{block.title}</h3><p>手动复制到任务中，核对后再发送。</p><pre><code>{block.text}</code></pre></div>;
    case 'note': return <aside className="help-note"><h3>{block.title}</h3><p>{block.text}</p></aside>;
    case 'table': return <div className="help-table-scroll" tabIndex={0} role="region" aria-label="手册对照表"><table><thead><tr>{block.headers.map((header, index) => <th key={index} scope="col">{header}</th>)}</tr></thead><tbody>{block.rows.map((row, index) => <tr key={index}>{row.map((value, column) => <td key={column}>{value}</td>)}</tr>)}</tbody></table></div>;
  }
}

export function HelpPage({ open, onBack }: { open: boolean; onBack: () => void }) {
  const [chapter, setChapter] = useState(0), [downloadUrl, setDownloadUrl] = useState<string>();
  const page = useRef<HTMLElement>(null), title = useRef<HTMLHeadingElement>(null), chapterTitle = useRef<HTMLHeadingElement>(null);
  const section = manualSections[chapter];
  useEffect(() => {
    if (open) title.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const url = URL.createObjectURL(new Blob([manualMarkdown()], { type: 'text/markdown;charset=utf-8' }));
    setDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [open]);
  const selectChapter = (index: number) => {
    setChapter(index);
    requestAnimationFrame(() => { if (page.current) page.current.scrollTop = 0; chapterTitle.current?.focus({ preventScroll: true }); });
  };
  return <section id="product-help" ref={page} className="help-page" hidden={!open} aria-labelledby="help-title" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onBack(); } }}>
    <header className="help-heading"><div><p className="eyebrow">使用指南</p><h1 id="help-title" ref={title} tabIndex={-1}>{manualMeta.title}</h1><p>{manualMeta.description}</p><span className="help-version">更新于 {manualMeta.updatedAt}</span></div><div className="help-actions"><button className="secondary-button" type="button" onClick={onBack}>返回原页面</button>{downloadUrl && <a className="secondary-button" href={downloadUrl} download="OptraCall-操作手册.md">下载完整手册</a>}</div></header>
    <div className="help-layout"><nav className="help-toc" aria-label="手册目录"><p>阅读目录</p><ol>{manualSections.map((item, index) => <li key={item.id}><button type="button" aria-current={index === chapter ? 'page' : undefined} onClick={() => selectChapter(index)}><span>{String(index + 1).padStart(2, '0')}</span>{item.title}</button></li>)}</ol></nav>
      <div className="help-reader"><label className="help-section-picker">选择手册章节<select value={chapter} onChange={event => selectChapter(Number(event.target.value))}>{manualSections.map((item, index) => <option value={index} key={item.id}>{index + 1}. {item.title}</option>)}</select></label>
        <article aria-labelledby="help-chapter-title"><p className="help-progress">第 {chapter + 1} / {manualSections.length} 章</p><h2 id="help-chapter-title" ref={chapterTitle} tabIndex={-1}>{section.title}</h2><p className="help-summary">{section.summary}</p>{section.blocks.map((block, index) => <Block key={`${section.id}-${index}`} block={block} />)}</article>
        <footer className="help-pagination"><button type="button" className="text-button" disabled={chapter === 0} onClick={() => selectChapter(chapter - 1)}>← 上一章</button><button type="button" className="text-button" disabled={chapter === manualSections.length - 1} onClick={() => selectChapter(chapter + 1)}>下一章 →</button></footer>
      </div>
    </div>
  </section>;
}
