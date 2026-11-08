import { useEffect, useRef, useState } from 'react';
import { catalogCategories, catalogItems, catalogMeta, filterCatalog, type CatalogCategory, type CatalogEntry, type CatalogItem } from './catalog-data.ts';
import { tradeAreaVersionText, useTradeAreaStatus } from './TaskCapabilities.tsx';
import { SkillEvaluationPanel } from './SkillEvaluation.tsx';
import { BoardViewSwitch } from './CaseBoard.tsx';

type PlannedCatalogItem = Exclude<CatalogItem, { status: '已接入' }>;

function CatalogDetails({ item, onClose }: { item: PlannedCatalogItem; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="catalog-dialog" aria-labelledby="catalog-detail-title" onClose={onClose}>
    <div className="dialog-heading"><span className={`catalog-symbol ${item.category}`} aria-hidden="true">{catalogMeta[item.category].symbol}</span><button className="icon-button" aria-label="关闭规划详情" onClick={() => dialog.current?.close()}>✕</button></div>
    <p className="eyebrow">{catalogMeta[item.category].label} · {item.id}</p><h2 id="catalog-detail-title">{item.name}</h2><p className="detail-summary">{item.description}</p>
    <div className="catalog-tags">{item.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
    <dl className="detail-metadata"><div><dt>当前状态</dt><dd>{item.status} · 未接入</dd></div><div><dt>参考来源</dt><dd>{item.source}</dd></div></dl>
    <div className="detail-note"><h3>接入边界</h3><p>{item.note}</p></div><p className="detail-footer">此处只展示规划说明，不安装、连接或运行能力。</p>
    <button className="secondary-button dialog-close" onClick={() => dialog.current?.close()}>关闭详情</button>
  </dialog>;
}

export function CatalogPage({ category, mode, onModeChange, onCategoryChange, onOpenEntry, onBack }: {
  category: CatalogCategory;
  mode: 'cards' | 'list';
  onModeChange: (mode: 'cards' | 'list') => void;
  onCategoryChange: (category: CatalogCategory) => void;
  onOpenEntry: (entry: CatalogEntry) => void;
  onBack: () => void;
}) {
  const tradeAreaStatus = useTradeAreaStatus();
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('全部');
  const [selected, setSelected] = useState<PlannedCatalogItem | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const meta = catalogMeta[category];
  const items = filterCatalog(category, query, tag);
  const all = catalogItems.filter(item => item.category === category);
  const availableCount = all.filter(item => item.status === '已接入').length;
  const tags = ['全部', ...new Set(all.flatMap(item => item.tags))];
  useEffect(() => { setQuery(''); setTag('全部'); setSelected(null); title.current?.focus(); }, [category]);
  return <div className="catalog-page">
    <div className="page-heading catalog-market-heading"><div><h1>插件市场</h1><p>查看工作台已有的能力入口与规划。</p></div></div>
    <div className="catalog-tabs" role="group" aria-label="插件市场分类">{catalogCategories.map(key => <button key={key} type="button" aria-pressed={category === key} className={category === key ? 'active' : ''} onClick={() => onCategoryChange(key)}><span aria-hidden="true">{catalogMeta[key].symbol}</span>{catalogMeta[key].label}</button>)}</div>
    <div className="catalog-module-heading"><div><h2 ref={title} tabIndex={-1}>{meta.label}</h2><p>{meta.description}</p></div><button type="button" className="text-button" onClick={onBack}>返回工作区 →</button></div>
    <div className="catalog-toolbar">
      <label className="catalog-search"><span aria-hidden="true">⌕</span><span className="sr-only">搜索{meta.label}</span><input ref={searchInput} value={query} placeholder={`搜索${meta.label}、标签或编号`} onChange={event => setQuery(event.target.value)} /></label>
      <label className="catalog-filter"><span>业务标签</span><select value={tag} onChange={event => setTag(event.target.value)}>{tags.map(value => <option key={value}>{value}</option>)}</select></label>
      <BoardViewSwitch value={mode} onChange={onModeChange} label="显示方式" />
    </div>
    <div className="catalog-result-count" role="status">{query || tag !== '全部' ? `找到 ${items.length} 项` : `${all.length} 项 · ${availableCount} 项已接入 · ${all.length - availableCount} 项规划中`}</div>
    {items.length ? <ul className={`catalog-results ${mode === 'cards' ? 'catalog-grid' : 'catalog-list'}`} role="list">{items.map(item => <li key={item.id}>
      <article className={`catalog-card ${item.status === '已接入' ? 'is-available' : 'is-planned'}`}>
        <span className={`catalog-symbol ${category}`} aria-hidden="true">{meta.symbol}</span>
        <span className={item.status === '已接入' ? 'available-badge' : 'planned-badge'}>{item.status === '已接入' ? '已接入' : `${item.status} · 未接入`}</span>
        <div className="catalog-card-content">
          <h3>{item.name}</h3><p>{item.description}</p>
          <div className="catalog-tags">{item.tags.map(value => <span key={value}>{value}</span>)}</div>
          {item.skill && <SkillEvaluationPanel name={item.name} evaluation={item.skill.evaluation} />}
          {item.category === 'connectors' && item.status === '已接入' && <p className="connector-card-note">{item.note}</p>}
        </div>
        <div className="catalog-card-bottom">
          <span className={item.id === 'trade-area-mcp' ? 'connector-version-chip' : undefined}>{item.id === 'trade-area-mcp' ? tradeAreaVersionText(tradeAreaStatus) : item.id}</span>
          {item.status === '已接入'
            ? <button type="button" className={`catalog-open-button${category === 'connectors' ? ' connector-open-button' : ''}`} aria-label={`${category === 'connectors' ? '到项目任务使用' : '打开'}${item.name}`} onClick={() => onOpenEntry(item.entry)}>{category === 'connectors' ? '到项目任务使用' : '打开'} <span aria-hidden="true">→</span></button>
            : <button type="button" aria-label={`查看${item.name}规划`} onClick={() => setSelected(item)}>查看规划 <span aria-hidden="true">↗</span></button>}
        </div>
      </article>
    </li>)}</ul> : <div className="catalog-empty"><span aria-hidden="true">⌕</span><h3>没有找到匹配的功能或规划</h3><p>试试其他关键词，或清除当前筛选。</p><button type="button" className="secondary-button" onClick={() => { setQuery(''); setTag('全部'); searchInput.current?.focus(); }}>清除筛选</button></div>}
    <footer className="catalog-page-footer"><span>已接入功能可直接打开，规划条目可查看说明。</span> <span>浏览目录不安装、连接或运行能力。</span></footer>
    {selected && <CatalogDetails item={selected} onClose={() => setSelected(null)} />}
  </div>;
}
