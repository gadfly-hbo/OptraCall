import { useEffect, useMemo, useState } from 'react';
import type { ClientProject, ClientTask } from '../../../../src/host/ui/project-types.ts';
import * as client from './simlab-client.ts';
import { ENGINE_VERSION } from '../types.ts';
import { snapshotRules } from '../kernel/model-rules.ts';
import type { DraftRecord, RunRecord, SnapshotRecord, StressRow, SimVariant, SimParameters, SimPerturbation } from './simlab-client.ts';

const money = (v: number) => (v < 0 ? '−¥' : '¥') + Math.abs(Math.round(v)).toLocaleString('zh-CN');
const num = (v: number) => Math.round(v).toLocaleString('zh-CN');
const pct = (v: number) => (v * 100).toFixed(1) + '%';
const signedMoney = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '±') + money(Math.abs(v)).replace('¥', '¥');
const shortHash = (hash: string) => `${hash.slice(0, 8)}…${hash.slice(-4)}`;

type Tab = 'params' | 'results' | 'compare' | 'stress' | 'task';
const TABS: { id: Tab; label: string }[] = [
  { id: 'params', label: '方案与参数' }, { id: 'results', label: '推演结果' },
  { id: 'compare', label: '方案对比' }, { id: 'stress', label: '扰动分析' }, { id: 'task', label: '任务联动' },
];
const PARAM_FIELDS: { key: keyof SimParameters; label: string; step?: string }[] = [
  { key: 'days', label: '推演窗口（天，7–90）' }, { key: 'demand', label: '日均基础需求（件）' },
  { key: 'inventory', label: '期初现货库存（件）' }, { key: 'capacity', label: '每日发货产能（件）' },
  { key: 'leadTime', label: '采购提前期（天）' }, { key: 'promoStart', label: '活动开始日' },
  { key: 'promoEnd', label: '活动结束日' }, { key: 'promoLift', label: '活动需求提升（%）' },
  { key: 'price', label: '商品单价（元）' }, { key: 'cost', label: '商品进价（元）' },
  { key: 'fulfillmentCost', label: '单件履约成本（元）' }, { key: 'holdingCost', label: '单件日仓储费（元）', step: '0.01' },
  { key: 'cash', label: '期初可用现金（元）' }, { key: 'maxWait', label: '订单等待上限（天）' },
  { key: 'cashThreshold', label: '现金预警线（元）' },
];
type VariantForm = { id: string; name: string; openingExtraStock: string; acceptanceCap: string; promoStart: string; promoEnd: string; promoLiftScale: string };
const fromVariant = (v: SimVariant): VariantForm => ({
  id: v.id, name: v.name, openingExtraStock: String(v.openingExtraStock),
  acceptanceCap: v.acceptanceCap === null ? '' : String(v.acceptanceCap),
  promoStart: v.promoWindow ? String(v.promoWindow.start) : '', promoEnd: v.promoWindow ? String(v.promoWindow.end) : '',
  promoLiftScale: v.promoLiftScale === undefined ? '' : String(v.promoLiftScale),
});
const toVariant = (f: VariantForm): SimVariant => ({
  id: f.id, name: f.name, openingExtraStock: Number(f.openingExtraStock || 0),
  acceptanceCap: f.acceptanceCap.trim() === '' ? null : Number(f.acceptanceCap),
  ...(f.promoStart.trim() && f.promoEnd.trim() ? { promoWindow: { start: Number(f.promoStart), end: Number(f.promoEnd) } } : {}),
  ...(f.promoLiftScale.trim() ? { promoLiftScale: Number(f.promoLiftScale) } : {}),
});
const formOf = (p: SimParameters): Record<string, string> => Object.fromEntries(PARAM_FIELDS.map(f => [f.key, String(p[f.key])]));
const COMPARE_FIELDS = [
  { key: 'shipped', label: '发货（件）', format: num },
  { key: 'inventory', label: '期末库存（件）', format: num },
  { key: 'backlog', label: '积压（件）', format: num },
  { key: 'cash', label: '现金（元）', format: money },
  { key: 'contribution', label: '贡献毛利（元）', format: money },
] as const;

export function SimLabPage({ projects, onOpenTask, onBack }: {
  projects: ClientProject[];
  onOpenTask: (project: ClientProject, task: ClientTask) => void;
  onBack: () => void;
}) {
  const [projectId, setProjectId] = useState(() => (projects.filter(p => !p.archivedAt).at(-1) ?? projects.at(-1))?.id ?? '');
  const project = projects.find(p => p.id === projectId), archived = Boolean(project?.archivedAt);
  const [drafts, setDrafts] = useState<DraftRecord[]>([]), [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [draftId, setDraftId] = useState(''), [loadedDraft, setDraft] = useState<DraftRecord>(), [runs, setRuns] = useState<RunRecord[]>([]);
  const draft = loadedDraft?.projectId === projectId && loadedDraft.id === draftId ? loadedDraft : undefined;
  const draftProjectId = drafts.find(d => d.id === draftId)?.projectId;
  const [tab, setTab] = useState<Tab>('params'), [variantId, setVariantId] = useState('');
  const [compareMetric, setCompareMetric] = useState<typeof COMPARE_FIELDS[number]['key']>('cash');
  const [form, setForm] = useState<Record<string, string>>({}), [shocks, setShocks] = useState({ demandShock: true, supplyShock: true });
  const [variantForms, setVariantForms] = useState<VariantForm[]>([]);
  const [stressRows, setStressRows] = useState<StressRow[]>([]), [stressDim, setStressDim] = useState('demand'), [stressMag, setStressMag] = useState('25'), [stressScope, setStressScope] = useState('all');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false), [createName, setCreateName] = useState('');
  const [freezeOpen, setFreezeOpen] = useState(false);
  useEffect(() => {
    if (!projectId) return;
    let current = true;
    setDrafts([]); setSnapshots([]); setDraftId(''); setDraft(undefined); setRuns([]); setError(''); setNotice(''); setStressRows([]); setFreezeOpen(false); setCreateOpen(false);
    void Promise.all([client.listDrafts(projectId), client.listSnapshots(projectId)]).then(([d, s]) => {
      if (!current) return;
      setDrafts(d.drafts); setSnapshots(s.snapshots);
      if (d.drafts.length) setDraftId(d.drafts.at(-1)!.id);
    }).catch(e => { if (current) setError(e instanceof Error ? e.message : '读取失败'); });
    return () => { current = false; };
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !draftId || draftProjectId !== projectId) return;
    let current = true;
    setDraft(undefined); setRuns([]); setError(''); setNotice('');
    void Promise.all([client.getDraft(projectId, draftId), client.listRuns(projectId, draftId)]).then(([d, r]) => {
      if (!current) return;
      setDraft(d.draft); setRuns(r.runs);
      setForm(formOf(d.draft.parameters));
      setShocks({ demandShock: d.draft.parameters.demandShock, supplyShock: d.draft.parameters.supplyShock });
      setVariantForms(d.draft.variants.map(fromVariant));
      setVariantId(d.draft.variants[0]?.id ?? '');
      setStressRows([]);
    }).catch(e => { if (current) setError(e instanceof Error ? e.message : '读取失败'); });
    return () => { current = false; };
  }, [projectId, draftId, draftProjectId]);

  const latestRun = useMemo(() => [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0], [runs]);
  const stale = Boolean(latestRun && draft && latestRun.draftRevision !== draft.revision);
  const currentResult = latestRun?.results[variantId];
  const selectedVariant = draft?.variants.find(variant => variant.id === variantId);
  const effectivePromo = selectedVariant?.promoWindow ?? (draft ? { start: draft.parameters.promoStart, end: draft.parameters.promoEnd } : undefined);
  const effectiveLift = draft ? draft.parameters.promoLift * (selectedVariant?.promoLiftScale ?? 1) : 0;
  const parameters = (): SimParameters => {
    const values = Object.fromEntries(PARAM_FIELDS.map(f => [f.key, Number(form[f.key])]));
    return { ...values, ...shocks } as SimParameters;
  };

  const save = async (runAfter: boolean) => {
    if (!projectId || !draft || archived) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const updated = await client.updateDraft(projectId, draft.id, {
        name: draft.name, parameters: parameters(), variants: variantForms.map(toVariant), expectedRevision: draft.revision,
      });
      setDraft(updated.draft); setDrafts(previous => previous.map(d => d.id === updated.draft.id ? updated.draft : d));
      if (runAfter) {
        const ran = await client.runDraft(projectId, draft.id);
        setRuns(previous => [ran.run, ...previous]); setTab('results');
        setNotice(`已保存并运行（revision ${updated.draft.revision} · ${ran.run.id}）`);
      } else setNotice(`草稿已保存（revision ${updated.draft.revision}）`);
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const rerun = async () => {
    if (!projectId || !draft || archived) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const ran = await client.runDraft(projectId, draft.id);
      setRuns(previous => [ran.run, ...previous]); setTab('results');
      setNotice(`已按当前草稿重新运行（${ran.run.id}）· 同输入同输出`);
    } catch (e) { setError(e instanceof Error ? e.message : '运行失败'); }
    finally { setBusy(false); }
  };
  const createDraft = async () => {
    if (!createName.trim() || !projectId) return;
    setBusy(true); setError('');
    try {
      const created = await client.createDraft(projectId, { name: createName.trim() });
      setDrafts(previous => [...previous, created.draft]); setDraftId(created.draft.id);
      setCreateOpen(false); setCreateName(''); setTab('params');
    } catch (e) { setError(e instanceof Error ? e.message : '创建失败'); }
    finally { setBusy(false); }
  };
  const runStress = async () => {
    if (!projectId || !draft) return;
    const mag = Number(stressMag);
    if (!Number.isFinite(mag)) { setError('扰动幅度须为数值。'); return; }
    const perturbation: SimPerturbation = stressDim === 'demand' ? { demandMultiplier: 1 + mag / 100 }
      : stressDim === 'capacity' ? { capacityMultiplier: 1 + mag / 100 }
      : stressDim === 'lead' ? { leadTimeDelta: Math.round(mag) } : { priceMultiplier: 1 + mag / 100 };
    setBusy(true); setError('');
    try {
      const result = await client.stressDraft(projectId, draft.id, { perturbation, ...(stressScope === 'all' ? {} : { variantIds: [stressScope] }) });
      setStressRows(previous => [...previous, ...result.rows]);
    } catch (e) { setError(e instanceof Error ? e.message : '扰动失败'); }
    finally { setBusy(false); }
  };
  const freeze = async () => {
    if (!projectId || !draft || !latestRun) return;
    setBusy(true); setError('');
    try {
      const frozen = await client.freezeSnapshot(projectId, draft.id, { runId: latestRun.id, variantId, expectedRevision: draft.revision });
      setSnapshots(previous => [frozen.snapshot, ...previous]);
      setFreezeOpen(false); setNotice(`已固化 ${frozen.snapshot.id} · 快照不可改写；Case／决策板接入待完成`);
    } catch (e) { setError(e instanceof Error ? e.message : '固化失败'); setFreezeOpen(false); }
    finally { setBusy(false); }
  };

  const simulationTasks = projects.flatMap(p => p.tasks.filter(t => t.simulationTools).map(task => ({ project: p, task })));
  const writeDisabled = busy || archived;

  return <div className="simlab-page">
    <header className="plugin-page-heading">
      <div><p className="eyebrow">OPTRACALL · 经营推演</p><h1>经营推演</h1>
        <p className="detail-summary">把备货与促销假设展开成可审计的逐日账本；探索自由，固化从严。确定性假设模型，不是预测。</p></div>
      <div className="plugin-heading-actions">
        <select aria-label="选择项目" value={projectId} disabled={busy} onChange={event => setProjectId(event.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.archivedAt ? '（已归档）' : ''}</option>)}</select>
        <span className="sim-chip">引擎 {ENGINE_VERSION}</span>
        <button className="secondary-button" onClick={onBack}>返回能力目录</button>
      </div>
    </header>
    {error && <div className="global-notice" role="alert"><span>{error}</span><button className="text-button" onClick={() => setError('')}>关闭提示</button></div>}
    {notice && <p className="project-notice" role="status">{notice}</p>}
    {archived && <div className="archive-banner" role="status">项目已归档，当前为只读查看；恢复项目后可继续推演。</div>}

    <div className="simlab-layout">
      <aside className="simlab-rail">
        <section className="rail-section">
          <h3>推演草稿 <button className="text-button" disabled={writeDisabled} onClick={() => setCreateOpen(true)}>＋ 新建</button></h3>
          {!drafts.length && <p className="rail-empty">暂无草稿。新建草稿开始探索性推演。</p>}
          {drafts.filter(d => d.projectId === projectId).map(d => <button key={d.id} disabled={busy} className={`rail-draft ${d.id === draftId ? 'selected' : ''}`} onClick={() => setDraftId(d.id)}>
            <strong>{d.name}</strong><span>{d.variants.length} 个变体 · 窗口 {d.parameters.days} 天 · rev {d.revision}</span>
          </button>)}
        </section>
        <section className="rail-section">
          <h3>已固化快照</h3>
          {!snapshots.length && <p className="rail-empty">尚无快照。固化是把探索性结果变成正式决策证据，由你确认。</p>}
          {snapshots.map(s => <details key={s.id} className="rail-snapshot">
            <summary><span className="snap-id">{s.id}</span> {s.name}<span className="snap-meta">{s.frozenAt.slice(0, 10)} 固化 · {s.engineVersion}</span></summary>
            <div className="snap-body">
              <span>变体：{s.variant.name} · 窗口 {s.parameters.days} 天</span>
              <span>贡献毛利 {money(s.result.summary.contribution)} · 最低现金 {money(s.result.summary.minCash)}</span>
              <span>履约率 {pct(s.result.summary.fulfillmentRate)} · 期末库存 {num(s.result.summary.closingInventory)} 件</span>
              <span>输入摘要 {shortHash(s.inputHash)} · 运行 {s.runId} / 草稿 rev {s.draftRevision}</span>
              {(() => { const model = snapshotRules(s); return <div>
                <p>{model.disclaimer}</p>
                {model.status === 'known' && <><p>口径：{model.caliber!.procurement}；{model.caliber!.cashRule}；{model.caliber!.contribution}。</p>
                  <p>活动窗 D{model.effective.promoWindow.start}–D{model.effective.promoWindow.end}，需求 +{model.effective.promoLift}%；D0 额外现货 {model.effective.openingExtraStock} 件；日承接上限 {model.effective.acceptanceCap ?? '不限'}。</p>
                  <p>未建模：{model.unmodeled!.join('、')}。</p></>}
              </div>; })()}
              <span className="sim-chip frozen">不可变 · Case／决策板接入待完成</span>
            </div>
          </details>)}
        </section>
      </aside>

      <main className="simlab-main">
        {!draft ? <div className="simlab-empty">
          <h2>从一份推演草稿开始</h2>
          <p>草稿包含参数与任意多个方案变体；探索性推演不设门槛，零模型费用。固化快照时才需要你确认。</p>
          <button className="primary-button" disabled={writeDisabled} onClick={() => setCreateOpen(true)}>新建推演草稿</button>
        </div> : <>
          <nav className="sim-tabs" aria-label="推演视图">{TABS.map(t => <button key={t.id} className={`sim-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>)}</nav>

          {tab === 'params' && <section>
            <div className="panel-heading"><h2>{draft.name}</h2>
              <div className="panel-actions">
                <button className="secondary-button" disabled={writeDisabled} onClick={() => void save(false)}>保存草稿</button>
                <button className="primary-button" disabled={writeDisabled} onClick={() => void save(true)}>保存并运行</button>
              </div></div>
            <div className="param-grid">
              {PARAM_FIELDS.map(f => <label key={f.key}>{f.label}<input type="number" step={f.step ?? '1'} value={form[f.key] ?? ''} disabled={writeDisabled} onChange={event => setForm(previous => ({ ...previous, [f.key]: event.target.value }))} /></label>)}
              <label className="param-check"><input type="checkbox" checked={shocks.demandShock} disabled={writeDisabled} onChange={event => setShocks(previous => ({ ...previous, demandShock: event.target.checked }))} />需求冲击（D8–21 ×1.3）</label>
              <label className="param-check"><input type="checkbox" checked={shocks.supplyShock} disabled={writeDisabled} onChange={event => setShocks(previous => ({ ...previous, supplyShock: event.target.checked }))} />供给延迟（补货 +3 天）</label>
            </div>
            <div className="panel-heading"><h2>方案变体（{variantForms.length} / 8）</h2>
              <button className="secondary-button" disabled={writeDisabled || variantForms.length >= 8} onClick={() => setVariantForms(previous => {
                let sequence = previous.length + 1;
                while (previous.some(variant => variant.id === `variant-${sequence}`)) sequence++;
                return [...previous, { id: `variant-${sequence}`, name: `方案 ${sequence}`, openingExtraStock: '0', acceptanceCap: '', promoStart: '', promoEnd: '', promoLiftScale: '' }];
              })}>添加变体</button></div>
            <p className="panel-hint">变体上限是资源边界不是分析限制；更多方案可拆分新草稿。留空的可选字段表示不覆盖草稿默认值。</p>
            <div className="variant-list">{variantForms.map((v, index) => <div className="variant-card" key={v.id}>
              <div className="variant-row">
                <label>名称<input value={v.name} disabled={writeDisabled} onChange={event => setVariantForms(previous => previous.map((x, i) => i === index ? { ...x, name: event.target.value } : x))} /></label>
                <label>D0 额外现货（件）<input type="number" value={v.openingExtraStock} disabled={writeDisabled} onChange={event => setVariantForms(previous => previous.map((x, i) => i === index ? { ...x, openingExtraStock: event.target.value } : x))} /></label>
                <label>日承接上限（件，空=不限）<input type="number" value={v.acceptanceCap} disabled={writeDisabled} onChange={event => setVariantForms(previous => previous.map((x, i) => i === index ? { ...x, acceptanceCap: event.target.value } : x))} /></label>
                <button className="text-button" disabled={writeDisabled || variantForms.length <= 1} onClick={() => setVariantForms(previous => previous.filter((_, i) => i !== index))}>移除</button>
              </div>
              <div className="variant-row">
                <label>活动开始日（可选）<input type="number" value={v.promoStart} disabled={writeDisabled} onChange={event => setVariantForms(previous => previous.map((x, i) => i === index ? { ...x, promoStart: event.target.value } : x))} /></label>
                <label>活动结束日（可选）<input type="number" value={v.promoEnd} disabled={writeDisabled} onChange={event => setVariantForms(previous => previous.map((x, i) => i === index ? { ...x, promoEnd: event.target.value } : x))} /></label>
                <label>活动力度系数（0–1，可选）<input type="number" step="0.1" value={v.promoLiftScale} disabled={writeDisabled} onChange={event => setVariantForms(previous => previous.map((x, i) => i === index ? { ...x, promoLiftScale: event.target.value } : x))} /></label>
                <span className="variant-id">id: {v.id}</span>
              </div>
            </div>)}</div>
          </section>}

          {tab === 'results' && <section>
            <div className="panel-heading"><h2>推演结果 <span className="sim-chip explore">探索性</span></h2>
              <div className="panel-actions">
                <select aria-label="选择变体" value={variantId} onChange={event => setVariantId(event.target.value)}>{draft.variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
                <button className="secondary-button" disabled={writeDisabled} onClick={() => void rerun()}>重新运行</button>
                <button className="primary-button" disabled={writeDisabled || !latestRun || stale} title={stale ? '草稿已修改，请先重新运行' : undefined} onClick={() => setFreezeOpen(true)}>固化当前结果为快照</button>
              </div></div>
            {stale && <p className="sim-warning" role="status">草稿已在运行后修改（运行 rev {latestRun?.draftRevision} ≠ 当前 rev {draft.revision}）。结果为历史探索记录，固化前请重新运行。</p>}
            {!latestRun ? <div className="simlab-empty"><p>尚未运行。到「方案与参数」保存并运行，或点「重新运行」。</p></div> : currentResult && <>
              <div className="stat-grid">
                <div className="stat-card"><span>贡献毛利</span><strong>{money(currentResult.summary.contribution)}</strong><small>发货 ×（单价−进价−履约）</small></div>
                <div className={`stat-card ${currentResult.summary.minCash < draft.parameters.cashThreshold ? 'alert' : ''}`}><span>最低现金{currentResult.summary.minCash < draft.parameters.cashThreshold ? ' ⚠' : ''}</span><strong>{money(currentResult.summary.minCash)}</strong><small>第 {currentResult.summary.minCashDay} 天 · 预警线 {money(draft.parameters.cashThreshold)}</small></div>
                <div className="stat-card"><span>期末库存</span><strong>{num(currentResult.summary.closingInventory)} 件</strong><small>在途 {num(currentResult.summary.inTransit)} 件</small></div>
                <div className="stat-card"><span>履约率</span><strong>{pct(currentResult.summary.fulfillmentRate)}</strong><small>取消率 {pct(currentResult.summary.cancelRate)} · 断货 {currentResult.summary.stockoutDays} 天</small></div>
              </div>
              <div className="ledger-wrap"><div className="ledger-scroll"><table>
                <thead><tr><th>日</th><th>需求</th><th>承接</th><th>发货</th><th>取消</th><th>积压</th><th>期末库存</th><th>现金</th><th>贡献</th></tr></thead>
                <tbody>{currentResult.rows.map(row => <tr key={row.day} className={row.promoActive ? 'promo-row' : ''}>
                  <td>D{row.day}</td><td>{num(row.demand)}</td><td>{num(row.accepted)}</td><td>{num(row.shipped)}</td>
                  <td>{num(row.cancelled)}</td><td>{num(row.backlog)}</td><td>{num(row.inventory)}</td>
                  <td className={row.cash < 0 ? 'negative' : row.cash < draft.parameters.cashThreshold ? 'cash-warn' : ''}>{money(row.cash)}</td>
                  <td>{money(row.contribution)}</td></tr>)}</tbody>
              </table></div>
              <div className="ledger-footer">
                <span className={`sim-chip ${currentResult.conservation ? 'frozen' : 'fail'}`}>守恒校验 {currentResult.validDays}/{draft.parameters.days} 天{currentResult.conservation ? '通过' : '未通过'}</span>
                <span>{latestRun.id} · 草稿 rev {latestRun.draftRevision}</span>
                <span>输入摘要 {shortHash(currentResult.inputHash)}</span>
                <span className="sim-chip explore">探索性结果 · 同输入同输出</span>
              </div></div>
            </>}
          </section>}

          {tab === 'compare' && <section>
            <div className="panel-heading"><h2>方案对比</h2><p className="panel-hint">同一份草稿参数下各变体的并排结果；绿色为该行最优，期末库存无最优方向。</p></div>
            {!latestRun ? <div className="simlab-empty"><p>尚未运行。</p></div> : <div className="ledger-wrap"><table className="compare-table">
              <thead><tr><th>指标</th>{draft.variants.map(v => <th key={v.id}>{v.name}</th>)}</tr></thead>
              <tbody>{([
                { label: '贡献毛利', get: (s: RunRecord['results'][string]['summary']) => s.contribution, fmt: money, best: 'max' },
                { label: '最低现金', get: (s: RunRecord['results'][string]['summary']) => s.minCash, fmt: money, best: 'max' },
                { label: '最低现金出现日', get: (s: RunRecord['results'][string]['summary']) => s.minCashDay, fmt: (v: number) => 'D' + v, best: null },
                { label: '期末库存（件）', get: (s: RunRecord['results'][string]['summary']) => s.closingInventory, fmt: num, best: null },
                { label: '履约率', get: (s: RunRecord['results'][string]['summary']) => s.fulfillmentRate, fmt: pct, best: 'max' },
                { label: '取消率', get: (s: RunRecord['results'][string]['summary']) => s.cancelRate, fmt: pct, best: 'min' },
              ] as const).map(row => {
                const values = draft.variants.map(v => latestRun.results[v.id] ? row.get(latestRun.results[v.id]!.summary) : NaN);
                const validValues = values.filter(v => !Number.isNaN(v));
                const bestValue = row.best === 'max' ? Math.max(...validValues) : row.best === 'min' ? Math.min(...validValues) : undefined;
                return <tr key={row.label}><td>{row.label}</td>{draft.variants.map((v, i) => {
                  const value = values[i]!;
                  const warn = row.label === '最低现金' && value < draft.parameters.cashThreshold;
                  return <td key={v.id} className={bestValue !== undefined && value === bestValue ? 'best' : ''}>{Number.isNaN(value) ? '—' : row.fmt(value)}{warn ? ' ⚠' : ''}</td>;
                })}</tr>;
              })}</tbody>
            </table></div>}
            {latestRun && <>
              <div className="panel-heading"><h3>逐日方案差异</h3><label>对比指标<select aria-label="逐日对比指标" value={compareMetric} onChange={event => setCompareMetric(event.target.value as typeof compareMetric)}>
                {COMPARE_FIELDS.map(field => <option key={field.key} value={field.key}>{field.label}</option>)}
              </select></label></div>
              <p className="panel-hint">每列显示当日数值及相对首个方案的差值；首个方案仅作差值基准。</p>
              <div className="ledger-wrap"><div className="ledger-scroll"><table aria-label="逐日方案差异">
                <thead><tr><th>日</th>{draft.variants.map((variant, index) => <th key={variant.id}>{variant.name}{index === 0 ? '（差值基准）' : ''}</th>)}</tr></thead>
                <tbody>{Array.from({ length: latestRun.results[draft.variants[0]!.id]?.rows.length ?? 0 }, (_, dayIndex) => {
                  const baseline = latestRun.results[draft.variants[0]!.id]?.rows[dayIndex]?.[compareMetric];
                  const format = COMPARE_FIELDS.find(field => field.key === compareMetric)!.format;
                  return <tr key={dayIndex}><td>D{dayIndex + 1}</td>{draft.variants.map((variant, index) => {
                    const value = latestRun.results[variant.id]?.rows[dayIndex]?.[compareMetric];
                    const delta = value !== undefined && baseline !== undefined ? value - baseline : undefined;
                    return <td key={variant.id}>{value === undefined ? '—' : format(value)}{index > 0 && delta !== undefined && <small> · Δ {delta > 0 ? '+' : delta < 0 ? '−' : '±'}{format(Math.abs(delta))}</small>}</td>;
                  })}</tr>;
                })}</tbody>
              </table></div></div>
            </>}
            <p className="panel-hint">指标是引擎输出的标准汇总数据；哪个指标重要、结论如何解读，由你在分析与决策中判断，本页不预设结论。</p>
          </section>}

          {tab === 'stress' && <section>
            <div className="panel-heading"><h2>扰动分析</h2><p className="panel-hint">维度与幅度自定义（引擎能力范围内校验），不预置固定清单。</p></div>
            <div className="stress-builder">
              <label>扰动维度<select value={stressDim} onChange={event => setStressDim(event.target.value)}>
                <option value="demand">日均需求（%）</option><option value="capacity">日产能（%）</option>
                <option value="lead">提前期（天）</option><option value="price">商品单价（%）</option></select></label>
              <label>幅度（可正可负）<input type="number" value={stressMag} onChange={event => setStressMag(event.target.value)} /></label>
              <label>应用范围<select value={stressScope} onChange={event => setStressScope(event.target.value)}>
                <option value="all">全部变体</option>{draft.variants.map(v => <option key={v.id} value={v.id}>仅{v.name}</option>)}</select></label>
              <button className="primary-button" disabled={writeDisabled} onClick={() => void runStress()}>运行扰动</button>
              <button className="secondary-button" onClick={() => setStressRows([])}>清空</button>
            </div>
            <div className="ledger-wrap"><div className="ledger-scroll"><table>
              <thead><tr><th>扰动</th><th>变体</th><th>贡献毛利 Δ</th><th>最低现金 Δ</th><th>履约率 Δ</th><th>阈值变化</th></tr></thead>
              <tbody>{stressRows.length ? stressRows.map((row, i) => <tr key={i}>
                <td>{Object.entries(row.perturbation).map(([k, v]) => `${k}=${v}`).join(' ')}</td><td>{row.variantName}</td>
                <td className={row.after.contribution - row.base.contribution >= 0 ? 'delta-pos' : 'delta-neg'}>{signedMoney(row.after.contribution - row.base.contribution)}</td>
                <td className={row.after.minCash - row.base.minCash >= 0 ? 'delta-pos' : 'delta-neg'}>{signedMoney(row.after.minCash - row.base.minCash)}</td>
                <td className={row.after.fulfillmentRate - row.base.fulfillmentRate >= 0 ? 'delta-pos' : 'delta-neg'}>{(row.after.fulfillmentRate - row.base.fulfillmentRate >= 0 ? '+' : '−') + Math.abs((row.after.fulfillmentRate - row.base.fulfillmentRate) * 100).toFixed(1) + 'pp'}</td>
                <td>{[row.cashTurnedNegative ? '现金转负' : '', row.crossedCashThreshold ? '跌破预警线' : ''].filter(Boolean).join(' · ') || '—'}</td>
              </tr>) : <tr><td colSpan={6} className="rail-empty">尚无扰动结果；设置维度与幅度后运行。</td></tr>}</tbody>
            </table></div></div>
          </section>}

          {tab === 'task' && <section>
            <div className="panel-heading"><h2>任务联动</h2><p className="panel-hint">同一批推演资产，Agent 在项目任务中用工具完成；固化的章在你手上。</p></div>
            <div className="task-tools-note">
              <p>Agent 可用工具（任务级显式开启后生效）：</p>
              <p>{['simulation_inspect', 'simulation_draft', 'simulation_run', 'simulation_stress', 'simulation_evidence'].map(name => <span key={name} className="sim-chip tool">{name}</span>)}</p>
              <p className="panel-hint">开启方式：新建任务时勾选「经营推演工具」，或在任务空闲时切换「Pi 能力与命令」中的开关；下次打开会话或发送消息时生效，历史保留。受管任务与封闭文本资源不提供推演工具。固化不设 Agent 工具，Agent 给出建议后由你在本页确认；它可通过 simulation_evidence 读到回执。</p>
            </div>
            {!simulationTasks.length ? <div className="simlab-empty"><p>还没有开启经营推演工具的任务。新建任务时勾选，或在任务内打开开关。</p></div>
              : simulationTasks.map(({ project: p, task }) => <div className="task-link-card" key={task.id}>
                <div><strong>{task.name}</strong><span>{p.name}{p.archivedAt ? '（已归档）' : ''} · {task.configuration.model}</span></div>
                <button className="secondary-button" onClick={() => onOpenTask(p, task)}>打开任务</button>
              </div>)}
          </section>}
        </>}
      </main>
    </div>

    <footer className="simlab-disclaimer"><strong>边界声明：</strong>本页面为确定性假设模型，输出是「假设的严谨展开」，不是现实预测、概率、优化推荐或因果效果。v1 未建模：退货退款、多仓、账期、税费、固定成本、日内现金流、概率分布与随机仿真。</footer>

    {createOpen && <div className="sim-dialog-backdrop" role="presentation"><div className="sim-dialog" role="dialog" aria-modal="true" aria-labelledby="sim-create-title">
      <h2 id="sim-create-title">新建推演草稿</h2>
      <label>草稿名称<input autoFocus value={createName} maxLength={80} placeholder="例如：双十一备货方案对比" onChange={event => setCreateName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void createDraft(); }} /></label>
      <p className="panel-hint">从默认参数与三个参考变体起步，可自由修改。</p>
      <div className="dialog-actions"><button className="secondary-button" onClick={() => setCreateOpen(false)}>取消</button><button className="primary-button" disabled={busy || !createName.trim()} onClick={() => void createDraft()}>创建草稿</button></div>
    </div></div>}

    {freezeOpen && latestRun && currentResult && draft && <div className="sim-dialog-backdrop" role="presentation"><div className="sim-dialog" role="dialog" aria-modal="true" aria-labelledby="sim-freeze-title">
      <h2 id="sim-freeze-title">固化快照</h2>
      <p className="panel-hint">一次性确认口径、参数与结果。变体：<strong>{draft.variants.find(v => v.id === variantId)?.name}</strong></p>
      <h4>口径（随快照冻结）</h4>
      <ul className="freeze-caliber">
        <li>窗口 {draft.parameters.days} 天 · FIFO 发货 · 订单等待 {draft.parameters.maxWait} 天后取消</li>
        <li>每 7 天按 7 天基础需求量补货，提前期 {draft.parameters.leadTime} 天{draft.parameters.supplyShock ? '（含供给延迟 +3 天）' : ''}，采购当日付款</li>
        <li>活动窗 D{effectivePromo?.start}–D{effectivePromo?.end}，需求 +{effectiveLift}%{draft.parameters.demandShock ? ' · D8–21 需求冲击 ×1.3' : ''} · 现金口径：发货确认收入</li>
        <li>D0 额外现货 {selectedVariant?.openingExtraStock} 件（按进价扣款）；日承接上限 {selectedVariant?.acceptanceCap ?? '不限'}。</li>
        <li>贡献毛利 = 发货 ×（单价 − 进价 − 履约成本）</li>
      </ul>
      <div className="freeze-metrics">
        <div><span>贡献毛利</span><strong>{money(currentResult.summary.contribution)}</strong></div>
        <div><span>最低现金（D{currentResult.summary.minCashDay}）</span><strong>{money(currentResult.summary.minCash)}</strong></div>
        <div><span>期末库存</span><strong>{num(currentResult.summary.closingInventory)} 件</strong></div>
        <div><span>履约率</span><strong>{pct(currentResult.summary.fulfillmentRate)}</strong></div>
      </div>
      <p className="panel-hint">{latestRun.engineVersion} · {latestRun.id} · 输入摘要 {shortHash(currentResult.inputHash)} · 守恒 {currentResult.validDays}/{draft.parameters.days} 天通过</p>
      <p className="freeze-immutable">固化后快照不可改写；后续修改草稿并重新推演，将生成新的快照。</p>
      <div className="dialog-actions"><button className="secondary-button" disabled={busy} onClick={() => setFreezeOpen(false)}>取消</button><button className="primary-button" disabled={busy} onClick={() => void freeze()}>确认固化</button></div>
    </div></div>}
  </div>;
}
