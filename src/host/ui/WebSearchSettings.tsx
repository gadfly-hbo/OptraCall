import { useEffect, useRef, useState } from 'react';
import type { SearchProvider } from '../web-search.ts';
import { readWebSearchSettings, saveWebSearchOrder, type WebSearchOrder, type WebSearchSettingsResponse } from './runtime-client.ts';

const defaultOrder: WebSearchOrder = ['minimax', 'deepseek'];
const providers: Record<SearchProvider, { name: string; model: string }> = {
  minimax: { name: 'MiniMax', model: 'MiniMax M3.1 Flash' },
  deepseek: { name: 'DeepSeek', model: 'DeepSeek Flash' },
};
const sameOrder = (left: WebSearchOrder, right: WebSearchOrder) => left[0] === right[0] && left[1] === right[1];
const orderLabel = (order: WebSearchOrder) => order.map(provider => providers[provider].name).join(' → ');

export function WebSearchSettings({ active, onModelSettings }: { active: boolean; onModelSettings: () => void }) {
  const [settings, setSettings] = useState<WebSearchSettingsResponse>();
  const [draft, setDraft] = useState<WebSearchOrder>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [readFailed, setReadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [notice, setNotice] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const savePending = useRef<Promise<void> | undefined>(undefined);

  useEffect(() => { if (active) heading.current?.focus(); }, [active]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true);
    setReadFailed(false);
    // A tab opened during a save must read the resulting server state.
    void (async () => {
      try {
        await savePending.current;
        if (controller.signal.aborted) return;
        const value = await readWebSearchSettings(controller.signal);
        if (!controller.signal.aborted) {
          setSettings(value);
          setDraft(current => current && sameOrder(current, value.order) ? undefined : current);
        }
      } catch {
        if (!controller.signal.aborted) {
          setSettings(undefined);
          setReadFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [active, reload]);

  const order = draft ?? settings?.order;
  const busy = loading || saving;
  const dirty = Boolean(settings && order && !sameOrder(order, settings.order));
  const reloadSettings = () => { setSaveFailed(false); setNotice(''); setReload(value => value + 1); };
  const move = (provider: SearchProvider, direction: -1 | 1) => {
    if (!order || busy) return;
    const next = order.indexOf(provider) + direction;
    if (next < 0 || next >= order.length) return;
    const updated: WebSearchOrder = [order[1], order[0]];
    setDraft(settings && sameOrder(updated, settings.order) ? undefined : updated);
    setNotice('');
    requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(`button[data-provider="${provider}"]:not(:disabled)`)?.focus());
  };
  const restore = () => {
    const alreadySaved = settings && sameOrder(defaultOrder, settings.order);
    setDraft(alreadySaved ? undefined : defaultOrder);
    setNotice(alreadySaved ? '已回到保存的默认顺序。' : '已恢复默认顺序草稿。');
    requestAnimationFrame(() => (alreadySaved ? list.current?.querySelector<HTMLButtonElement>('button:not(:disabled)') : saveButton.current)?.focus());
  };
  const save = () => {
    if (!order || !dirty || busy || savePending.current) return;
    setSaving(true);
    setSaveFailed(false);
    setNotice('');
    savePending.current = saveWebSearchOrder(order).then(value => {
      setSettings(value);
      setDraft(undefined);
      setNotice('搜索顺序已保存。');
    }).catch(() => {
      setSaveFailed(true);
    }).finally(() => {
      savePending.current = undefined;
      setSaving(false);
    });
  };

  const credentialBadge = (provider: SearchProvider) => settings
    ? <span className={`web-search-badge ${settings.configured[provider] ? 'is-configured' : 'is-missing'}`}>{settings.configured[provider] ? '已配置' : '未配置'}</span>
    : null;

  return <div className="web-search-settings">
    <div className="page-heading"><div><h2 ref={heading} tabIndex={-1}>网络检索</h2><p>设置 Agent 发起关键词搜索时使用的服务顺序。</p></div></div>
    {loading && <p className="host-status" role="status">正在读取网络检索设置…</p>}
    {readFailed && <div className="host-status" role="alert"><p>未能读取网络检索设置。</p><button type="button" className="secondary-button" onClick={reloadSettings}>重新读取设置</button></div>}
    {settings && order && <section className="config-form web-search-box" aria-labelledby="web-search-order-title" aria-busy={busy}>
      <h3 id="web-search-order-title">搜索顺序</h3>
      <p>按已保存顺序处理搜索。首选缺少凭据或遇到线路错误时，尝试备用服务。</p>
      <ol ref={list} className="web-search-order" aria-label="搜索服务优先顺序">
        {order.map((provider, index) => <li key={provider} className="web-search-route">
          <span className="web-search-rank" aria-hidden="true">{index + 1}</span>
          <div>
            <div className="web-search-route-title"><strong>{providers[provider].name}</strong><span className="web-search-badge">{index === 0 ? '首选' : '备用'}</span>{credentialBadge(provider)}</div>
            <p>凭据来源：模型设置 · {providers[provider].model}</p>
            {!settings.configured[provider] && <button type="button" className="text-button" onClick={onModelSettings} aria-label={`前往模型设置配置 ${providers[provider].model} 凭据`}>前往模型设置</button>}
          </div>
          <div className="web-search-route-actions">
            <button type="button" className="secondary-button" data-provider={provider} disabled={busy || index === 0} onClick={() => move(provider, -1)} aria-label={`上移 ${providers[provider].name}`}>↑ 上移</button>
            <button type="button" className="secondary-button" data-provider={provider} disabled={busy || index === order.length - 1} onClick={() => move(provider, 1)} aria-label={`下移 ${providers[provider].name}`}>↓ 下移</button>
          </div>
        </li>)}
      </ol>
      <div className="web-search-save">
        <p>已保存顺序：<strong>{orderLabel(settings.order)}</strong></p>
        <div className="web-search-route-actions">
          <button type="button" className="secondary-button" disabled={busy || sameOrder(order, defaultOrder)} onClick={restore}>恢复默认顺序</button>
          <button ref={saveButton} type="button" className="primary-button" disabled={busy || !dirty} onClick={save}>{saving ? '正在保存…' : '保存顺序'}</button>
        </div>
      </div>
      <p>配置状态表示凭据是否存在。连通性需以实际请求为准。</p>
      {notice && <p className="save-status" role="status">{notice}</p>}
      {saveFailed && <div className="host-status" role="alert"><p>未能确认已保存。重新读取设置后可核对当前顺序。</p><button type="button" className="secondary-button" onClick={reloadSettings}>重新读取设置</button></div>}
    </section>}
    <section className="config-form web-search-box" aria-labelledby="web-fetch-title">
      <div className="web-search-route-title"><h3 id="web-fetch-title">网页读取 · DeepSeek Fetch</h3>{credentialBadge('deepseek')}</div>
      <p>按 URL 打开网页并读取 Markdown 内容。凭据来源：模型设置 · DeepSeek Flash。</p>
      <p>网页读取使用独立线路，搜索顺序只用于关键词检索。</p>
    </section>
  </div>;
}
