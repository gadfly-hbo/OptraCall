import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeckMeta, VersionEntry } from '../types.ts';
import { createDeck, readDeck, setPageLock, revertDeck, exportDeck, runTurn, renderDeck, readImage, type DeckView } from './refiner-client.ts';
import './refiner.css';

type ChatMessage = { who: 'user' | 'agent'; text: string; note?: string };

function usePageImages(deckId: string, version: number) {
  const [images, setImages] = useState<Record<string, string>>({});
  const load = useCallback(async (names: string[]) => {
    const next: Record<string, string> = {};
    for (const name of names) {
      try { next[name] = (await readImage(deckId, name)).dataUrl; } catch { /* image not rendered yet */ }
    }
    setImages(next);
  }, [deckId]);
  useEffect(() => { setImages({}); }, [deckId, version]);
  return { images, load };
}

export function RefinerPage({ initialDeckId, onBack }: { initialDeckId?: string; onBack: () => void }) {
  const [deckId, setDeckId] = useState(initialDeckId ?? '');
  const [view, setView] = useState<DeckView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ id: '', sourcePptx: '', title: '', reportPath: '' });
  const openDeck = useCallback(async (id: string) => {
    setBusy(true); setError('');
    try {
      const deck = await readDeck(id);
      setView(deck); setDeckId(id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { if (initialDeckId) void openDeck(initialDeckId); }, [initialDeckId, openDeck]);

  if (!view) {
    return <div className="refiner-page">
      <header className="refiner-header"><button className="secondary-button" onClick={onBack}>返回</button><h1>PPT 逐页精修</h1></header>
      <p className="refiner-note">从候选版 PPTX 开始逐页精修：读取 deck 后选页对话修改，md 报告只读锚定，差异清单随终版导出。</p>
      <section className="refiner-form">
        <h2>打开精修 deck</h2>
        <label>deck 标识（deck-xxx）<input value={deckId} onChange={e => setDeckId(e.target.value)} placeholder="deck-demo" /></label>
        <button className="primary-button" disabled={busy || !deckId} onClick={() => void openDeck(deckId)}>打开</button>
        <h2>或从候选版新建</h2>
        {(['id', 'sourcePptx', 'title', 'reportPath'] as const).map(key => <label key={key}>{({ id: 'deck 标识', sourcePptx: '候选版 PPTX 绝对路径', title: '标题', reportPath: 'md 报告锚点绝对路径' })[key]}<input value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}
        <button className="secondary-button" disabled={busy} onClick={async () => {
          setBusy(true); setError('');
          try { const created = await createDeck(form); await openDeck(created.meta.id); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
        }}>创建并打开</button>
        {error && <p className="refiner-error">{error}</p>}
      </section>
    </div>;
  }
  return <RefinerWorkbench view={view} refresh={() => openDeck(deckId)} onBack={() => { setView(null); setDeckId(''); }} />;
}

function RefinerWorkbench({ view, refresh, onBack }: { view: DeckView; refresh: () => Promise<void>; onBack: () => void }) {
  const deckId = view.meta.id;
  const latest = view.versions[view.versions.length - 1];
  const [selected, setSelected] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [rendered, setRendered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([{ who: 'agent', text: '选中一页后用对话修改；只动该页，未改页与锁定页字节不变。数字改动会与 md 报告核对。' }]);
  const [input, setInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportInfo, setExportInfo] = useState('');
  const { images, load } = usePageImages(deckId, latest?.version ?? 0);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    void (async () => {
      try { const files = (await renderDeck(deckId)).files; setPageCount(files.filter(f => f.startsWith('slide-')).length); setRendered(true); await load(files); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    })();
  }, [deckId, load]);

  const afterMutation = async () => {
    await refresh();
    try { const files = (await renderDeck(deckId)).files; await load(files); } catch { /* keep old images */ }
  };
  const locked = view.meta.lockedPages.includes(selected);
  const diffs = view.versions.flatMap(v => v.diffs.map(d => ({ version: v.version, ...d })));

  return <div className="refiner-page">
    <header className="refiner-header">
      <button className="secondary-button" onClick={onBack}>返回</button>
      <h1>{view.meta.title}</h1>
      <span className="chip accent">md 锚点 · 只读</span>
      <span className="chip">当前 v{latest?.version ?? 1}</span>
      <span className="spacer" />
      <button className="secondary-button" onClick={() => setHistoryOpen(true)}>版本历史</button>
      <button className="primary-button" disabled={busy} onClick={async () => {
        setBusy(true); setError(''); setExportInfo('');
        try {
          const out = await exportDeck(deckId, { outDir: `${view.deckPath.replace(/\/deck\.pptx$/, '')}/exports`, fileName: 'final.pptx' });
          setExportInfo(`已导出：${out.pptx}（差异清单 ${out.diff}）`);
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
      }}>导出终版</button>
    </header>
    {error && <p className="refiner-error">{error}</p>}
    {exportInfo && <p className="refiner-export-info">{exportInfo}</p>}
    <div className="refiner-body">
      <aside className="refiner-grid" aria-label="页网格">
        {Array.from({ length: pageCount }, (_, i) => i + 1).map(page => {
          const name = `thumb-${String(page).padStart(2, '0')}.png`;
          return <button key={page} className={`grid-item ${selected === page ? 'selected' : ''} ${view.meta.lockedPages.includes(page) ? 'locked' : ''}`} onClick={() => setSelected(page)} aria-pressed={selected === page}>
            {images[name] ? <img src={images[name]} alt={`第 ${page} 页缩略图`} /> : <span className="thumb-placeholder">P{page}</span>}
            <span className="grid-meta"><strong>P{page}</strong>{view.meta.lockedPages.includes(page) ? '锁定' : ''}{latest?.pages.includes(page) ? '· 本轮修改' : ''}</span>
          </button>;
        })}
        {!rendered && <p className="refiner-note">页图渲染中…</p>}
      </aside>
      <section className="refiner-stage">
        <div className="stage-image">
          {images[`slide-${String(selected).padStart(2, '0')}.png`]
            ? <img src={images[`slide-${String(selected).padStart(2, '0')}.png`]} alt={`第 ${selected} 页预览`} />
            : <span className="thumb-placeholder">第 {selected} 页（渲染后显示）</span>}
        </div>
        <div className="stage-toolbar">
          <span>P{selected}{locked ? ' · 已锁定' : ''}</span>
          <span className="spacer" />
          <button className="secondary-button" onClick={async () => {
            try { await setPageLock(deckId, selected, !locked); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
          }}>{locked ? '解锁本页' : '锁定本页'}</button>
          <button className="secondary-button" onClick={async () => { try { const files = (await renderDeck(deckId)).files; await load(files); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }}>重新渲染</button>
        </div>
        <p className="refiner-note">md 锚点（只读）：{view.meta.sourceReport}</p>
      </section>
      <section className="refiner-chat">
        <div className="chat-log" aria-live="polite">
          {chat.map((m, i) => <div key={i} className={`msg ${m.who}`}><span className="who">{m.who === 'user' ? '我' : 'Agent · 精修会话'}</span><p>{m.text}</p>{m.note && <p className="msg-note">{m.note}</p>}</div>)}
        </div>
        <form className="chat-input-row" onSubmit={async e => {
          e.preventDefault();
          if (!input.trim() || locked || busy) return;
          const text = input.trim();
          setInput(''); setBusy(true); setError('');
          setChat(prev => [...prev, { who: 'user', text }]);
          try {
            const result = await runTurn(deckId, text, crypto.randomUUID());
            setChat(prev => [...prev, { who: 'agent', text: result.reply, note: result.snapshot ? `已存版本 v${result.snapshot.version}` : '（无内容变化）' }]);
            await afterMutation();
          } catch (err) { setChat(prev => [...prev, { who: 'agent', text: `未完成：${err instanceof Error ? err.message : String(err)}` }]); }
          finally { setBusy(false); }
        }}>
          <input value={input} onChange={e => setInput(e.target.value)} disabled={locked || busy} placeholder={locked ? '该页已锁定，解锁后才能修改' : '描述对本页的修改'} aria-label="修改指令" />
          <button className="primary-button" disabled={locked || busy || !input.trim()}>{busy ? '修改中…' : '发送'}</button>
        </form>
        <div className="diff-panel">
          <h3>改动记录 · 与 md 报告的差异</h3>
          {diffs.length ? diffs.map((d, i) => <div key={i} className="diff-item"><strong>P{d.page}</strong><span>v{d.version} · {d.kind} · {d.summary}（锚点 {d.anchor}）</span></div>) : <p className="refiner-note">暂无差异</p>}
        </div>
      </section>
    </div>
    {historyOpen && <div className="refiner-dialog-backdrop" role="dialog" aria-label="版本历史">
      <div className="refiner-dialog">
        <h2>版本历史</h2>
        <p className="refiner-note">每轮修改自动存快照，可回退任意版（回退前自动保存当前状态）。</p>
        {[...view.versions].reverse().map(v => <div key={v.version} className="version-row">
          <strong>v{v.version}</strong><span className="version-desc">{v.summary}</span>
          {v.version === latest?.version ? <span className="chip ok">当前</span> : <button className="secondary-button" onClick={async () => {
            try { await revertDeck(deckId, v.version); setHistoryOpen(false); await afterMutation(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
          }}>回退到此版</button>}
        </div>)}
        <button className="secondary-button" onClick={() => setHistoryOpen(false)}>关闭</button>
      </div>
    </div>}
  </div>;
}
