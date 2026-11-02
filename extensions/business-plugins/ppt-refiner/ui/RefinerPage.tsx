import { useCallback, useEffect, useRef, useState } from 'react';
import type { VersionEntry } from '../types.ts';
import { createDeck, listDecks, readDeck, setPageLock, revertDeck, exportDeck, runTurn, stopPendingTurn, renderDeck, readImage, RefinerRequestError, type DeckSummary, type DeckView, type RefinerSource, type TurnResult } from './refiner-client.ts';
import './refiner.css';

export type { RefinerSource } from './refiner-client.ts';
export type RefinerLeaveGuard = () => Promise<boolean>;
type ChatMessage = { who: 'user' | 'agent'; text: string; note?: string };
type PendingTurn = { request: Promise<TurnResult>; completion: Promise<boolean>; transportUnknown: boolean };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const imageName = (kind: 'slide' | 'thumb', page: number) => kind + '-' + String(page).padStart(2, '0') + '.png';

function usePageImages(deckId: string) {
  const [images, setImages] = useState<Record<string, string>>({});
  const generation = useRef(0);
  const clear = useCallback(() => { generation.current++; setImages({}); }, []);
  const load = useCallback(async (names: string[]) => {
    const ticket = ++generation.current;
    const next: Record<string, string> = {};
    for (const name of names) next[name] = (await readImage(deckId, name)).dataUrl;
    if (ticket === generation.current) setImages(next);
  }, [deckId]);
  useEffect(() => { clear(); return () => { generation.current++; }; }, [deckId, clear]);
  return { images, load, clear };
}

export function RefinerPage({ initialDeckId, source, onBack, onNavigationGuard, onDeckChange }: {
  initialDeckId?: string;
  source?: RefinerSource;
  onBack: () => void;
  onNavigationGuard?: (guard: RefinerLeaveGuard | null) => void;
  onDeckChange?: (deckId: string | undefined) => void;
}) {
  const [view, setView] = useState<DeckView | null>(null);
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const createOperation = useRef<{ key: string; id: string; task: Promise<string> } | null>(null);
  const openDeck = useCallback(async (id: string) => {
    const deck = await readDeck(id);
    setView(deck);
    onDeckChange?.(deck.meta.id);
    return deck;
  }, [onDeckChange]);
  const refreshList = useCallback(async () => { setDecks((await listDecks()).decks); }, []);
  useEffect(() => {
    let active = true;
    setBusy(true); setError('');
    let task: Promise<unknown>;
    if (initialDeckId) task = openDeck(initialDeckId);
    else if (source) {
      const key = JSON.stringify(source);
      if (createOperation.current?.key !== key) {
        const id = 'deck-' + crypto.randomUUID();
        const task = createDeck({ ...source, id }).then(value => value.meta.id);
        createOperation.current = { key, id, task };
      }
      task = createOperation.current.task.then(id => active ? openDeck(id) : undefined);
    } else task = listDecks().then(value => { if (active) setDecks(value.decks); });
    void task.catch(reason => { if (active) setError(errorText(reason)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [source, initialDeckId, openDeck]);
  useEffect(() => { if (!view) onNavigationGuard?.(null); }, [view, onNavigationGuard]);

  if (!view) return <div className="refiner-page" aria-busy={busy}>
    <header className="refiner-header"><button className="secondary-button" onClick={onBack}>返回</button><h1>PPT 逐页精修</h1></header>
    <p className="refiner-note">从项目文件中的候选版 PPTX 选择“逐页精修”，并选择同项目的正式 md 报告作为只读锚点。</p>
    {busy && <p role="status" className="refiner-note">{source ? '正在准备项目精修会话…' : '正在读取精修记录…'}</p>}
    {error && <p role="alert" className="refiner-error">{error}</p>}
    {source && error && createOperation.current && <button className="secondary-button" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { await openDeck(createOperation.current!.id); } catch (reason) { setError('尚未读到创建结果：' + errorText(reason) + ' 可返回项目重新打开候选版；不会自动重发模型请求。'); } finally { setBusy(false); }
    }}>核对创建结果</button>}
    {!source && <section className="refiner-decks" aria-labelledby="refiner-decks-title">
      <div className="refiner-decks-heading"><h2 id="refiner-decks-title">已有精修记录</h2><button className="secondary-button" disabled={busy} onClick={async () => {
        setBusy(true); setError(''); try { await refreshList(); } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
      }}>刷新记录</button></div>
      {!busy && !decks.length && <p className="refiner-note">暂无精修记录。请在项目的 060_reports 中打开候选版 PPTX。</p>}
      <ul>{decks.map(deck => <li key={deck.meta.id}><div><strong>{deck.meta.title}</strong><p className="refiner-note">{deck.projectName ?? '来源项目待核对'}{deck.readOnly ? ' · 只读' : ''}</p></div><button className="secondary-button" disabled={busy} onClick={async () => {
        setBusy(true); setError(''); try { await openDeck(deck.meta.id); } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
      }}>打开<span className="sr-only"> {deck.meta.title}</span></button></li>)}</ul>
    </section>}
  </div>;
  return <RefinerWorkbench key={view.meta.id} view={view} refresh={() => openDeck(view.meta.id)} onBack={() => { if (source) onBack(); else { setView(null); onDeckChange?.(undefined); void refreshList().catch(reason => setError(errorText(reason))); } }} onNavigationGuard={onNavigationGuard} />;
}

function VersionHistory({ versions, currentVersion, protectionFailed, busy, readOnly, onRevert, onClose }: {
  versions: VersionEntry[]; currentVersion?: number; protectionFailed: boolean; busy: boolean; readOnly: boolean; onRevert: (version: number) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="refiner-dialog" aria-labelledby="refiner-history-title" onClose={onClose} onCancel={event => { if (busy) event.preventDefault(); }}>
    <h2 id="refiner-history-title">版本历史</h2>
    <p className="refiner-note">每轮修改自动存快照，回退前保留当前状态。旧版本的差异谱系不能核定时会明确标记。</p>
    {protectionFailed && <p className="refiner-note" role="status">保护结果尚未核定。请选择已存版本恢复工作稿，恢复前的状态与失败现场保留。</p>}
    {[...versions].reverse().map(version => <div key={version.version} className="version-row">
      <strong>v{version.version}</strong><span className="version-desc">{version.summary}</span>
      {version.version === currentVersion && <span className="chip ok">当前</span>}
      {(version.version !== currentVersion || protectionFailed) && <button className="secondary-button" disabled={busy || readOnly} onClick={() => void onRevert(version.version)}>{protectionFailed ? '恢复到此版' : '回退到此版'}</button>}
    </div>)}
    <button className="secondary-button" disabled={busy} onClick={() => dialog.current?.close()}>关闭</button>
  </dialog>;
}

function RefinerWorkbench({ view, refresh, onBack, onNavigationGuard }: {
  view: DeckView; refresh: () => Promise<DeckView>; onBack: () => void; onNavigationGuard?: (guard: RefinerLeaveGuard | null) => void;
}) {
  const deckId = view.meta.id;
  const latest = view.versions.at(-1);
  const currentVersion = view.meta.currentVersion;
  const [selected, setSelected] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [renderState, setRenderState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([{ who: 'agent', text: '选页后可对话修改，也可只读检查。锁定页保持不变；数字与事实改动会对照 md 报告，并保留差异记录。' }]);
  const [input, setInput] = useState('');
  const [inspectOnly, setInspectOnly] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportInfo, setExportInfo] = useState('');
  const [fileName, setFileName] = useState(view.meta.title.replace(/[^\w一-龥.-]/g, '_') + '_终版.pptx');
  const { images, load, clear } = usePageImages(deckId);
  const pendingTurn = useRef<PendingTurn | null>(null);
  const pendingStop = useRef<Promise<boolean> | null>(null);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const locked = view.meta.lockedPages.includes(selected);
  const readOnly = view.readOnly === true;
  const protectionFailed = view.protectionFailed === true;
  const contentBlocked = readOnly || protectionFailed;
  const writeBusy = busy || view.busy === true;
  const imageInputSupported = view.imageInputSupported !== false;
  const refreshImages = useCallback(async () => {
    clear(); setRenderState('loading');
    try {
      const files = (await renderDeck(deckId)).files;
      setPageCount(files.filter(name => name.startsWith('slide-')).length);
      await load(files); setRenderState('ready');
    } catch (reason) { setRenderState('failed'); throw reason; }
  }, [deckId, clear, load]);
  useEffect(() => { void refreshImages().catch(reason => setError(errorText(reason))); }, [refreshImages]);
  const readBack = useCallback(async () => {
    const latestView = await refresh();
    if (latestView.busy) { clear(); setRenderState('loading'); return latestView; }
    try { await refreshImages(); } catch (reason) { setError(previous => [previous, '最新版本已读回，页图暂未确认：' + errorText(reason)].filter(Boolean).join('\n')); }
    return latestView;
  }, [refresh, refreshImages, clear]);
  const reconcile = useCallback(async (pending: PendingTurn) => {
    try {
      const latestView = await readBack();
      if (pending.transportUnknown && latestView.busy !== false) {
        setError(previous => [previous, latestView.busy ? '原请求结果未知，后台仍在运行；停止尚未确认，请保留页面并使用停止按钮。' : '原请求结果未知，后台占用尚未核定；请保留页面并再次核对停止。'].filter(Boolean).join('\n'));
        return false;
      }
      if (pending.transportUnknown) setError(previous => [
        ...previous.split('\n').filter(message => !message.startsWith('原请求结果未知，后台') && !message.startsWith('停止尚未确认：') && !message.startsWith('最新保存状态尚未确认：') && !message.startsWith('已核对后台空闲及当前保存版本；')),
        '已核对后台空闲及当前保存版本；原请求结果仍未知，不会自动重发。',
      ].filter(Boolean).join('\n'));
      if (pendingTurn.current === pending) { pendingTurn.current = null; setRunning(false); setBusy(false); }
      return true;
    } catch (reason) {
      clear(); setRenderState('failed');
      setError(previous => [previous, '最新保存状态尚未确认：' + errorText(reason) + '；运行控制与离开保护继续保留。'].filter(Boolean).join('\n'));
      return false;
    }
  }, [readBack, clear]);
  const stop = useCallback(() => {
    if (pendingStop.current) return pendingStop.current;
    const pending = pendingTurn.current;
    if (!pending) return Promise.resolve(true);
    setStopping(true);
    const task = (async () => {
      try {
        await stopPendingTurn(deckId, pending.request);
        await pending.completion;
        // A transport failure may already have resolved completion(false). Recheck actual state after stop.
        return await reconcile(pending);
      }
      catch (reason) { setError('停止尚未确认：' + errorText(reason)); return false; }
      finally { setStopping(false); pendingStop.current = null; }
    })();
    pendingStop.current = task;
    return task;
  }, [deckId, reconcile]);
  const leave = useCallback(async () => !pendingTurn.current || await stop(), [stop]);
  useEffect(() => { onNavigationGuard?.(leave); return () => onNavigationGuard?.(null); }, [leave, onNavigationGuard]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (pendingTurn.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const addReply = (result: TurnResult) => {
    const outcome = result.outcome === 'cancelled' ? '已停止' : result.outcome === 'failed' ? '未完成' : '已完成';
    const saved = result.snapshot ? '已保存版本 v' + result.snapshot.version : '未新增内容版本';
    setChat(previous => [...previous, { who: 'agent', text: result.reply || outcome, note: outcome + ' · ' + saved }]);
  };
  const executeTurn = (text: string, mode: 'edit' | 'inspect', visual = false) => {
    if (!text.trim() || writeBusy || contentBlocked || pendingTurn.current) return;
    setInput(''); setBusy(true); setRunning(true); setError(''); setExportInfo('');
    setChat(previous => [...previous, { who: 'user', text }]);
    const request = runTurn(deckId, text.trim(), crypto.randomUUID(), selected, mode, visual);
    const pending: PendingTurn = { request, completion: Promise.resolve(false), transportUnknown: false };
    pendingTurn.current = pending;
    pending.completion = (async () => {
      try { addReply(await request); }
      catch (reason) {
        pending.transportUnknown = !(reason instanceof RefinerRequestError);
        if (reason instanceof RefinerRequestError && reason.turn) addReply(reason.turn);
        else setChat(previous => [...previous, { who: 'agent', text: (pending.transportUnknown ? '请求结果尚未确认：' : '请求未获执行回执：') + errorText(reason) + '。正在读回已保存版本，不会自动重发。' }]);
        setError(errorText(reason));
      }
      return reconcile(pending);
    })();
  };
  const mutate = async (operation: () => Promise<unknown>, withImages = false, recovery = false) => {
    if (writeBusy || readOnly || protectionFailed && !recovery) return false;
    setBusy(true); setError(''); setExportInfo('');
    try { await operation(); if (withImages) await readBack(); else await refresh(); return true; }
    catch (reason) { setError(errorText(reason)); return false; }
    finally { setBusy(false); }
  };
  const diffs = view.versions.flatMap(version => version.diffs.map(diff => ({ version: version.version, ...diff })));
  const closeHistory = () => { setHistoryOpen(false); requestAnimationFrame(() => historyTrigger.current?.focus()); };

  return <div className="refiner-page" aria-busy={writeBusy}>
    <header className="refiner-header">
      <button className="secondary-button" disabled={stopping || (busy && !running)} onClick={async () => { if (await leave()) onBack(); }}>{stopping ? '正在停止…' : running ? '停止并返回' : '返回'}</button>
      <h1>{view.meta.title}</h1><span className="chip accent">md 锚点 · 只读</span>
      <span className="chip">{currentVersion === undefined ? '已保存 ' + view.versions.length + ' 个版本' : '当前 v' + currentVersion}</span>
      <span className="spacer" />
      <button ref={historyTrigger} className="secondary-button" disabled={writeBusy} onClick={() => setHistoryOpen(true)}>版本历史</button>
      <label className="refiner-export-name">终版文件名<input value={fileName} disabled={writeBusy || contentBlocked} onChange={event => setFileName(event.target.value)} maxLength={150} /></label>
      <button className="primary-button" disabled={writeBusy || contentBlocked || !fileName.trim()} onClick={() => void mutate(async () => {
        const out = await exportDeck(deckId, { fileName: fileName.trim() });
        setExportInfo('已导出到当前项目 060_reports：' + out.pptx.split('/').at(-1) + '；差异清单 ' + out.diff.split('/').at(-1) + (out.diffHistoryKnown === false ? '。旧版本差异谱系尚未完整核定，请阅读清单中的说明。' : '。'));
      })}>导出终版</button>
    </header>
    {readOnly && <p className="refiner-note" role="status">{view.reason ?? '该精修记录当前只读，已有文件和版本保留。'}</p>}
    {protectionFailed && <p className="refiner-error" role="alert">保护结果尚未核定，模型执行与导出已暂停。请在版本历史中显式恢复已存版本；恢复前的状态与失败现场保留。</p>}
    {view.busy && !running && <div className="refiner-note"><p role="status">后台已有操作运行，请等待其完成后再修改或导出。</p><button className="secondary-button" disabled={busy} onClick={async () => {
      setBusy(true); try { await readBack(); } catch (reason) { setError('后台状态尚未确认：' + errorText(reason)); } finally { setBusy(false); }
    }}>核对后台状态</button></div>}
    {!imageInputSupported && <p className="refiner-note" role="status">项目模型不支持图像输入，视觉自检不可用。{!contentBlocked && '仍可进行文字编辑和只读文本检查。'}</p>}
    {error && <p className="refiner-error" role="alert">{error}</p>}
    {exportInfo && <p className="refiner-export-info" role="status">{exportInfo}</p>}
    <div className="refiner-body">
      <aside className="refiner-grid" aria-label="页网格">
        {Array.from({ length: pageCount }, (_, index) => index + 1).map(page => <button key={page} className={['grid-item', selected === page ? 'selected' : '', view.meta.lockedPages.includes(page) ? 'locked' : ''].join(' ')} onClick={() => setSelected(page)} aria-pressed={selected === page}>
          {images[imageName('thumb', page)] ? <img src={images[imageName('thumb', page)]} alt={'第 ' + page + ' 页缩略图'} /> : <span className="thumb-placeholder">P{page}</span>}
          <span className="grid-meta"><strong>P{page}</strong>{view.meta.lockedPages.includes(page) ? '锁定' : ''}{latest?.pages.includes(page) ? ' · 最近快照修改' : ''}</span>
        </button>)}
        {renderState === 'loading' && <p className="refiner-note" role="status">页图渲染中…</p>}
        {renderState === 'failed' && <p className="refiner-note">页图尚未确认，请重试渲染；已有版本记录仍保留。</p>}
      </aside>
      <section className="refiner-stage" aria-label="选中页预览">
        <div className="stage-image">{images[imageName('slide', selected)] ? <img src={images[imageName('slide', selected)]} alt={'第 ' + selected + ' 页预览'} /> : <span className="thumb-placeholder">第 {selected} 页（页图尚未确认）</span>}</div>
        <div className="stage-toolbar">
          <span>P{selected}{locked ? ' · 已锁定' : ''}</span><span className="spacer" />
          <button className="secondary-button" disabled={writeBusy || contentBlocked} onClick={() => void mutate(() => setPageLock(deckId, selected, !locked))}>{locked ? '解锁本页' : '锁定本页'}</button>
          <button className="secondary-button" disabled={writeBusy} onClick={() => { setError(''); void refreshImages().catch(reason => setError(errorText(reason))); }}>重新渲染</button>
          <button className="secondary-button" disabled={writeBusy || contentBlocked || !imageInputSupported || renderState !== 'ready'} onClick={() => executeTurn('请只读检查当前选中页的视觉效果，指出遮挡、溢出、对比和字号问题；结合页型判断留白，不修改文件。', 'inspect', true)}>视觉自检本页</button>
        </div>
        <p className="refiner-note">锚点报告：{view.meta.sourceReport.split('/').at(-1)} · 不自动改写</p>
      </section>
      <section className="refiner-chat" aria-label="精修对话">
        <div className="chat-log" role="log" aria-live="polite">{chat.map((message, index) => <div key={index} className={'msg ' + message.who}><span className="who">{message.who === 'user' ? '我' : 'Agent · 精修会话'}</span><p>{message.text}</p>{message.note && <p className="msg-note">{message.note}</p>}</div>)}</div>
        {locked && <p className="refiner-note" id="refiner-lock-help">本页已锁定，本次仅作只读问答或检查；修改前请先解锁。</p>}
        <form className="chat-input-row" onSubmit={event => { event.preventDefault(); executeTurn(input, locked || inspectOnly ? 'inspect' : 'edit'); }}>
          <input value={input} onChange={event => setInput(event.target.value)} disabled={writeBusy || contentBlocked} placeholder={locked || inspectOnly ? '描述要检查的问题' : '描述对本页的修改'} aria-label={locked || inspectOnly ? '只读检查指令' : '修改指令'} aria-describedby={locked ? 'refiner-lock-help' : undefined} />
          <button className="primary-button" disabled={writeBusy || contentBlocked || !input.trim()}>{running ? '处理中…' : '发送'}</button>
          {running && <button type="button" className="secondary-button" disabled={stopping} onClick={() => { void stop(); }}>{stopping ? '正在停止…' : '停止'}</button>}
        </form>
        <label className="refiner-inspect-option"><input type="checkbox" checked={locked || inspectOnly} disabled={writeBusy || contentBlocked || locked} onChange={event => setInspectOnly(event.target.checked)} />只读检查，不修改内容</label>
        <div className="diff-panel"><h2>历史改动记录</h2><p className="refiner-note">包含历史版本；终版实际采用范围以导出差异清单为准。</p>{diffs.length ? diffs.map((diff, index) => <div key={index} className="diff-item"><strong>P{diff.page}</strong><span>v{diff.version} · {diff.kind} · {diff.summary}（锚点 {diff.anchor}）</span></div>) : <p className="refiner-note">暂无已记录差异；旧历史未核定不代表无差异。</p>}</div>
      </section>
    </div>
    {historyOpen && <VersionHistory versions={view.versions} currentVersion={currentVersion} protectionFailed={protectionFailed} busy={writeBusy} readOnly={readOnly} onClose={closeHistory} onRevert={async version => { if (await mutate(() => revertDeck(deckId, version), true, true)) closeHistory(); }} />}
  </div>;
}
