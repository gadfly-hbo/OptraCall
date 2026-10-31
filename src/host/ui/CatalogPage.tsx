import { useEffect, useRef, useState } from 'react';
import { catalogCategories, catalogItems, catalogMeta, filterCatalog, type CatalogCategory, type CatalogEntry, type CatalogItem } from './catalog-data.ts';

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

export function CatalogPage({ category, onCategoryChange, onOpenEntry, onBack }: { category: CatalogCategory; onCategoryChange: (category: CatalogCategory) => void; onOpenEntry: (entry: CatalogEntry) => void; onBack: () => void }) {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('全部');
  const [selected, setSelected] = useState<PlannedCatalogItem | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const meta = catalogMeta[category];
  const items = filterCatalog(category, query, tag);
  const all = catalogItems.filter(item => item.category === category);
  const availableCount = all.filter(item => item.status === '已接入').length;
  const tags = ['全部', ...new Set(all.flatMap(item => item.tags))];
  useEffect(() => { setQuery(''); setTag('全部'); setSelected(null); title.current?.focus(); }, [category]);
  return <div className="catalog-page">
    <div className="catalog-tabs" role="group" aria-label="能力目录分类">{catalogCategories.map(key => <button key={key} aria-pressed={category === key} className={category === key ? 'active' : ''} onClick={() => onCategoryChange(key)}><span aria-hidden="true">{catalogMeta[key].symbol}</span>{catalogMeta[key].label}</button>)}</div>
    <div className="page-heading"><div><p className="eyebrow">能力目录</p><h1 ref={title} tabIndex={-1}>{meta.label}</h1><p>{meta.description}</p></div><span className="catalog-demo-label">{availableCount ? `${availableCount} 项已接入` : '规划目录 · 未接入'}</span></div>
    <div className="catalog-intro"><p>已接入功能可直接打开；灰色方块为规划中，尚未接入。</p><button className="text-button" onClick={onBack}>返回工作区 →</button></div>
    <div className="catalog-toolbar"><label className="catalog-search"><span aria-hidden="true">⌕</span><span className="sr-only">搜索{meta.label}</span><input value={query} placeholder={`搜索${meta.label}、标签或编号`} onChange={event => setQuery(event.target.value)} /></label><label className="catalog-filter"><span>业务标签</span><select value={tag} onChange={event => setTag(event.target.value)}>{tags.map(value => <option key={value}>{value}</option>)}</select></label></div>
    <div className="catalog-result-count" role="status">{query || tag !== '全部' ? `找到 ${items.length} 项` : `${all.length} 项 · ${availableCount} 项已接入 · ${all.length - availableCount} 项规划中`}</div>
    {items.length ? <div className="catalog-grid">{items.map(item => <article className={`catalog-card ${item.status === '已接入' ? 'is-available' : 'is-planned'}`} key={item.id}>
      <div className="catalog-card-top"><span className={`catalog-symbol ${category}`} aria-hidden="true">{meta.symbol}</span><span className={item.status === '已接入' ? 'available-badge' : 'planned-badge'}>{item.status === '已接入' ? '已接入' : `${item.status} · 未接入`}</span></div><h2>{item.name}</h2><p>{item.description}</p><div className="catalog-tags">{item.tags.map(value => <span key={value}>{value}</span>)}</div><div className="catalog-card-bottom"><span>{item.id}</span>{item.status === '已接入' ? <button className="catalog-open-button" aria-label={`打开${item.name}`} onClick={() => onOpenEntry(item.entry)}>打开 <span aria-hidden="true">→</span></button> : <button aria-label={`查看${item.name}规划`} onClick={() => setSelected(item)}>查看规划 <span aria-hidden="true">↗</span></button>}</div>
    </article>)}</div> : <div className="catalog-empty"><span aria-hidden="true">⌕</span><h2>没有找到匹配的功能或规划</h2><p>试试其他关键词，或清除当前筛选。</p><button className="secondary-button" onClick={() => { setQuery(''); setTag('全部'); }}>清除筛选</button></div>}
    <footer className="catalog-page-footer">规划方块只提供说明，不安装、连接或运行能力。</footer>
    {selected && <CatalogDetails item={selected} onClose={() => setSelected(null)} />}
  </div>;
}
