import { useEffect, useState } from 'react';
import type { ExternalAssetRef } from '../external-work-types.ts';
import { externalDispatchErrorText, readExternalDispatchSettings, readTaskExternalAssets, type ExternalAssetWorkEntry, type ExternalDispatchSettings } from './external-dispatch-client.ts';
import './external-dispatch.css';

/**
 * 资产依据页（冻结 Demo #assets 的生产实现）：外部读取的是获准依据。
 * 获准资产表来自真实 grant 的精确 allowlist（authority/id/准确版本/hash，绝不回退 latest）；
 * 引用记录来自交付声明的实际使用，读取回执只证交付内容与范围、不证专业正确；
 * 入口与可用性卡读取真实设置事实（受保护入口未挂载时如实显示），失败保留说明按 spec §7 固定陈述。
 */

export type ExternalAssetAccessPanelProps = {
  projectId: string;
  taskId: string;
  taskName: string;
  onSwitchPanel(panel: 'chat' | 'report' | 'external' | 'delivery' | 'assets'): void;
  onOpenSettings?(): void;
};

const scopeOf = (authority: string): string => authority === 'sap-metric' ? '已发布指标 · 只读'
  : authority === 'sap-method' ? '已发布方法 · 只读'
  : authority === 'studio-source' ? 'Studio 语义资产 · 只读'
  : authority === 'enterprise' ? '企业目录条目 · 只读'
  : '授权范围内 · 只读';

function refKey(ref: ExternalAssetRef) { return `${ref.authority}/${ref.id}@${ref.version}#${ref.hash}`; }

export function ExternalAssetAccessPanel({ projectId, taskId, taskName, onSwitchPanel, onOpenSettings }: ExternalAssetAccessPanelProps) {
  const [view, setView] = useState<{ works: ExternalAssetWorkEntry[] }>();
  const [settings, setSettings] = useState<ExternalDispatchSettings>();
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(0);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setView(undefined); setError('');
    Promise.all([
      readTaskExternalAssets(projectId, taskId, controller.signal),
      readExternalDispatchSettings(controller.signal).catch(() => undefined),
    ])
      .then(([assets, settingsView]) => { if (!controller.signal.aborted) { setView(assets); setSettings(settingsView); setError(''); } })
      .catch(fault => { if (!controller.signal.aborted && (fault as Error).name !== 'AbortError') setError(externalDispatchErrorText(fault)); });
    return () => controller.abort();
  }, [projectId, taskId, nonce]);
  const works = view?.works ?? [];
  const allowlist: ExternalAssetRef[] = [];
  for (const work of works) for (const ref of work.grant?.assetRefs ?? []) {
    if (!allowlist.some(item => refKey(item) === refKey(ref))) allowlist.push(ref);
  }
  const references = works.flatMap(work => work.references);
  const current = allowlist[Math.min(selected, Math.max(allowlist.length - 1, 0))];
  return <div className="external-work-page">
    <div className="external-work-scroll">
      <header className="page-heading external-work-heading">
        <div><p className="eyebrow">ASSET ACCESS</p><h1>外部读取的是获准依据</h1><p>语义、指标、方法与数据映射留在实际 OptraCall 运行端；经受保护入口只读提供。原任务：{taskName}</p></div>
        <button type="button" className="text-button" onClick={() => onSwitchPanel('external')}>← 协作进展</button>
      </header>
      {error && <div className="ed-notice" data-tone="error" role="alert">{error}<button type="button" className="text-button" onClick={() => setNonce(value => value + 1)}>重读资产依据</button></div>}
      {!view && !error && <p className="ed-notice" role="status">正在读取资产依据…</p>}
      {view && <div className="external-work-grid">
        <div className="ed-stack">
          <section className="ed-card" aria-label="获准资产">
            <div className="ed-card-head"><h2>本次获准资产</h2><span className="ed-pill" data-tone="gray">准确版本 · 只读</span></div>
            <div className="ed-card-body">
              <div className="ed-callout">外部执行者在本任务范围内按需读取，无需你逐条批准。这里只读提供获准依据，不分发凭据、Skill 包或执行工具。</div>
              {allowlist.length ? <>
                <div className="ed-asset-tabs section-space" role="group" aria-label="选择资产">
                  {allowlist.map((ref, index) => <button key={refKey(ref)} type="button" className={`ed-asset-choice${index === Math.min(selected, allowlist.length - 1) ? ' active' : ''}`} aria-pressed={index === Math.min(selected, allowlist.length - 1)} onClick={() => setSelected(index)}>{ref.id.split('-').pop()} · {ref.version}</button>)}
                </div>
                <div className="ed-table-wrap section-space" tabIndex={0} role="region" aria-label="获准资产表">
                  <table>
                    <thead><tr><th scope="col">资产 / 准确版本</th><th scope="col">出处</th><th scope="col">范围</th></tr></thead>
                    <tbody>{allowlist.map(ref => <tr key={refKey(ref)}>
                      <td><strong>{ref.authority}/{ref.id}</strong><br /><span className="ed-muted">{ref.version}</span></td>
                      <td>{ref.authority}</td>
                      <td>{scopeOf(ref.authority)}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
                {current && <div className="section-space ed-asset-detail">
                  <h3>{current.authority}/{current.id} · {current.version}</h3>
                  <dl className="ed-meta">
                    <div><dt>准确版本</dt><dd>{current.version}（固定；错误读取不会覆盖这份内容或原报告）</dd></div>
                    <div><dt>出处</dt><dd>{current.authority}</dd></div>
                    <div><dt>引用</dt><dd className="ed-mono">{current.authority}/{current.id}@{current.version}</dd></div>
                    <div><dt>摘要</dt><dd className="ed-mono">{current.hash}</dd></div>
                    <div><dt>范围</dt><dd>{scopeOf(current.authority)}；语义、指标、方法与数据映射留在实际运行端</dd></div>
                  </dl>
                  <p className="ed-muted">原文内容留在实际 OptraCall 运行端，经保护入口按精确版本只读提供；绝不静默回退 latest。</p>
                </div>}
              </> : <p className="ed-muted section-space">本次未授权外部读取任何资产。</p>}
            </div>
          </section>
          <section className="ed-card" aria-label="实际引用记录">
            <div className="ed-card-head"><h2>实际引用记录</h2><span className="ed-pill" data-tone="gray">{references.length} 条</span></div>
            <div className="ed-card-body">
              {references.length ? <>
                {references.map(entry => <div className="ed-list-row" key={entry.deliveryId}>
                  <div><strong>交付 {entry.deliveryId.slice(0, 12)}… · revision {entry.revision}</strong><small>{entry.assetsUsed.map(ref => `${ref.authority}/${ref.id}@${ref.version}`).join('、') || '未声明资产引用'} · 保全 {entry.preservation}</small></div>
                  <span className="ed-pill" data-tone="gray">交付声明引用</span>
                </div>)}
                <p className="ed-muted">引用来自交付声明；读取回执只证交付内容与范围，不证专业正确或实际采用。</p>
              </> : <p className="ed-muted">尚无外部读取回执；资产被列出不等于已经读取或采用。</p>}
            </div>
          </section>
        </div>
        <aside className="ed-stack">
          <section className="ed-card" aria-label="入口与可用性">
            <div className="ed-card-head"><h2>入口与可用性</h2><span className="ed-pill" data-tone={settings?.core.protectedMcp.available ? 'green' : 'amber'}>{settings?.core.protectedMcp.available ? '受保护入口就绪' : '入口待接入'}</span></div>
            <div className="ed-card-body">
              <dl className="ed-meta">
                <div><dt>资产所在</dt><dd>当前实际运行的 OptraCall 实例</dd></div>
                <div><dt>对外入口</dt><dd>{settings?.core.protectedMcp.available ? '受保护入口已挂载' : `受保护入口尚未挂载（${settings?.core.protectedMcp.reason ?? '待接入'}）`}</dd></div>
                <div><dt>运行条件</dt><dd>实例在线，执行者身份与本任务授权均有效</dd></div>
                <div><dt>开放能力</dt><dd>资产只读；另有工作领取、续租与交付权限，不开放任意文件或执行</dd></div>
              </dl>
              {onOpenSettings && <button type="button" className="text-button section-space" onClick={onOpenSettings}>按需查看连接与执行方式设置 →</button>}
            </div>
          </section>
          <section className="ed-card" aria-label="失败时保留已有依据">
            <div className="ed-card-body"><h3>失败时保留已有依据</h3><p className="ed-muted">错版本、撤回或离线都有明确结果，不会静默取最新版；也不会用另一项目的资产填补。原报告和历史引用继续保留。</p></div>
          </section>
          <section className="ed-card" aria-label="返回原任务">
            <div className="ed-card-body">
              <div className="ed-actions">
                <button type="button" className="text-button" onClick={() => onSwitchPanel('delivery')}>查看交付与验收 →</button>
                <button type="button" className="text-button" onClick={() => onSwitchPanel('chat')}>返回原任务</button>
              </div>
            </div>
          </section>
        </aside>
      </div>}
    </div>
  </div>;
}
