import { useCallback, useEffect, useMemo, useState } from 'react';
import { CaseDialog } from '../../../../src/host/ui/CaseDialogs.tsx';
import * as client from './model-pack-client.ts';
import { metricLabel, TASK_LABELS } from '../types.ts';
import type { ModelPackImportFailure, ModelRegistryEntry } from '../types.ts';

const STAGE_ORDER: Record<ModelRegistryEntry['stage'], number> = { Production: 0, Staging: 1, Archived: 2 };
const shortHash = (hash: string) => (hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash);
const keyOf = (entry: ModelRegistryEntry) => `${entry.name}@${entry.version}`;
const formatInstalled = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/\//g, '-');
};

const IMPORT_STEPS = [
  { key: 'structure', label: '结构与 formatVersion 校验' },
  { key: 'manifest', label: 'manifest 字段合法性' },
  { key: 'purity', label: '纯度重扫（禁 fs/网络/eval/随机/时钟）' },
  { key: 'smoke', label: '沙箱冒烟（node --permission 跑一行）' },
  { key: 'install', label: '拷入快照＋注册表登记（Staging）' },
] as const;

type StepState = 'idle' | 'pass' | 'fail';
type ImportOutcome =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; model: ModelRegistryEntry }
  | { kind: 'fail'; failure: ModelPackImportFailure };

// 验货门是 Host 侧一次原子调用；这里只如实反映结果（成功＝各阶段通过，失败＝停在 detail.stage），不伪造实时进度。
function stepStates(outcome: ImportOutcome): { key: string; label: string; state: StepState; note: string }[] {
  if (outcome.kind === 'ok') {
    const { model } = outcome;
    const notes: Record<string, string> = {
      structure: '3 件齐全 · formatVersion=1',
      manifest: `${model.name} v${model.version} · ${TASK_LABELS[model.task]}`,
      purity: '0 违规（无 fs/网络/eval/随机/时钟）',
      smoke: 'predict 冒烟通过（输出含目标列）',
      install: `dataRoot/models/${model.name}/v${model.version} · Staging`,
    };
    return IMPORT_STEPS.map(step => ({ ...step, state: 'pass', note: notes[step.key] }));
  }
  if (outcome.kind === 'fail') {
    const failedIndex = IMPORT_STEPS.findIndex(step => step.key === outcome.failure.stage);
    return IMPORT_STEPS.map((step, index) => {
      if (failedIndex < 0) return { ...step, state: 'idle', note: '' };
      if (index < failedIndex) return { ...step, state: 'pass', note: '通过' };
      if (index === failedIndex) return { ...step, state: 'fail', note: outcome.failure.reason ?? '未通过' };
      return { ...step, state: 'idle', note: '' };
    });
  }
  return IMPORT_STEPS.map(step => ({ ...step, state: 'idle', note: '' }));
}

export function ModelRegistryPage({ onBack }: { onBack: () => void }) {
  const [models, setModels] = useState<ModelRegistryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [importOpen, setImportOpen] = useState(false);
  const [importPath, setImportPath] = useState('');
  const [importOutcome, setImportOutcome] = useState<ImportOutcome>({ kind: 'idle' });

  const [promoteTarget, setPromoteTarget] = useState<ModelRegistryEntry | null>(null);
  const [promoteBusy, setPromoteBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { models: listed } = await client.listModels();
      setModels(listed);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '注册表加载失败');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const rows = useMemo(() => models.slice().sort((a, b) =>
    a.name === b.name ? b.version - a.version : (STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]) || a.name.localeCompare(b.name)),
  [models]);
  const selected = useMemo(() => models.find(entry => keyOf(entry) === selectedKey), [models, selectedKey]);
  const production = models.filter(entry => entry.stage === 'Production').length;
  const staging = models.filter(entry => entry.stage === 'Staging').length;

  async function runImport() {
    const sourcePath = importPath.trim();
    if (!sourcePath) { setImportOutcome({ kind: 'fail', failure: { reason: '请填写包目录路径。' } }); return; }
    setImportOutcome({ kind: 'busy' });
    try {
      const { model } = await client.importPack(sourcePath);
      setImportOutcome({ kind: 'ok', model });
      await refresh();
      setSelectedKey(keyOf(model));
      setNotice(`${model.name} v${model.version} 已导入（Staging），快照固化于 dataRoot/models/。升 Production 由你在注册表点击确认。`);
    } catch (caught) {
      const failure = caught instanceof client.ModelPackRequestError
        ? (caught.detail ?? { reason: caught.message })
        : { reason: '导入未完成，请检查本地服务后重试。' };
      setImportOutcome({ kind: 'fail', failure });
    }
  }

  function openImport() {
    setImportPath('');
    setImportOutcome({ kind: 'idle' });
    setImportOpen(true);
  }

  async function confirmPromote() {
    if (!promoteTarget) return;
    setPromoteBusy(true);
    try {
      const { model, archived } = await client.promoteModel(promoteTarget.name, promoteTarget.version);
      await refresh();
      setSelectedKey(keyOf(model));
      setPromoteTarget(null);
      setNotice(`${model.name} v${model.version} 已升为 Production${archived ? `；旧版 v${archived.version} 已自动归档（可查不可调）` : ''}。`);
    } catch (caught) {
      setPromoteTarget(null);
      setError(caught instanceof Error ? caught.message : '晋级失败');
    } finally {
      setPromoteBusy(false);
    }
  }

  const promoteOld = promoteTarget ? models.find(entry => entry.name === promoteTarget.name && entry.stage === 'Production') : undefined;
  const steps = stepStates(importOutcome);
  const importBusy = importOutcome.kind === 'busy';

  return <div className="model-pack-page">
    <header className="plugin-page-heading">
      <div>
        <p className="eyebrow">OPTRACALL · 模型包</p>
        <h1>模型注册表</h1>
        <p className="detail-summary">导入 Model Pack Studio 训练的自包含模型包；快照存于本机 dataRoot/models/，只读不可变。训练、指标重算与效果回流在 MPS 完成，OptraCall 只消费导出包，本机沙箱执行、无网络外发。</p>
      </div>
      <div className="plugin-heading-actions">
        <button className="primary-button" onClick={openImport}>导入模型包…</button>
        <button className="secondary-button" onClick={onBack}>返回能力目录</button>
      </div>
    </header>

    {error && <div className="global-notice" role="alert"><span>{error}</span><button className="text-button" onClick={() => setError('')}>关闭提示</button></div>}
    {notice && <p className="project-notice" role="status">{notice}</p>}

    <div className="registry-toolbar">
      <span className="count">{loaded ? `共 ${models.length} 个版本 · Production ${production} · Staging ${staging}` : '正在加载注册表…'}</span>
    </div>

    <div className="table-scroll">
      <table className="registry">
        <thead>
          <tr><th>模型</th><th>版本</th><th>状态</th><th>任务型</th><th>留出指标</th><th>导入时间</th><th></th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="registry-empty">{loaded ? '尚无导入的模型包。点击「导入模型包…」选择 MPS 导出目录。' : '正在加载…'}</td></tr>}
          {rows.map(entry => {
            const isSelected = keyOf(entry) === selectedKey;
            return <tr key={keyOf(entry)} tabIndex={0} className={isSelected ? 'selected' : ''}
              onClick={() => setSelectedKey(keyOf(entry))}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedKey(keyOf(entry)); } }}>
              <td><span className="model-name">{entry.name}{entry.corrupted && <span className="corrupt-badge" title="快照哈希与注册记录不一致">损坏</span>}</span><div className="model-goal">{entry.goal || '（无目标说明）'}</div></td>
              <td><span className="version-chip">v{entry.version}</span></td>
              <td><span className={`stage-badge stage-${entry.stage}`}>{entry.stage}</span></td>
              <td><span className="task-tag">{TASK_LABELS[entry.task]}</span></td>
              <td className="metric-cell">{metricLabel(entry.metrics)}</td>
              <td className="version-chip">{formatInstalled(entry.installedAt)}</td>
              <td>{entry.stage === 'Staging' && <button className="ghost-button" onClick={event => { event.stopPropagation(); setPromoteTarget(entry); setNotice(''); }}>晋级</button>}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>

    <div className="legend">
      <span><i className="legend-dot production" />Production＝分析默认可调</span>
      <span><i className="legend-dot staging" />Staging＝Agent 显式指定版本才可调</span>
      <span><i className="legend-dot archived" />Archived＝可查不可调</span>
    </div>

    <section className="detail-panel" aria-live="polite">
      {!selected && <div className="detail-empty">点击任意模型行查看详情（manifest 全文、留出指标、数据指纹与用法）。</div>}
      {selected && <>
        <h3>{selected.name} <span className="version-chip">v{selected.version}</span></h3>
        <p className="detail-sub">
          <span className={`stage-badge stage-${selected.stage}`}>{selected.stage}</span> · {TASK_LABELS[selected.task]} · 导入于 {formatInstalled(selected.installedAt)}
        </p>
        {selected.corrupted && <div className="detail-corrupt" role="alert"><strong>快照损坏：</strong>dataRoot 内文件哈希与注册记录不一致（可能被人为改动）。此版本不可信，请从 MPS 导出目录重新导入该版本；旧记录保留可追溯。</div>}
        <div className="detail-grid">
          <div className="detail-section">
            <h4>留出指标（MPS Host 重算，随行 manifest）</h4>
            <dl className="kv">{Object.entries(selected.metrics).filter(([key]) => !key.includes(':')).map(([key, value]) => <div className="kv-row" key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
          </div>
          <div className="detail-section">
            <h4>数据指纹</h4>
            <dl className="kv">
              <div className="kv-row"><dt>sha256</dt><dd title={selected.fingerprint.sha256}>{shortHash(selected.fingerprint.sha256)}</dd></div>
              <div className="kv-row"><dt>行 × 列</dt><dd>{selected.fingerprint.rows} × {selected.fingerprint.columns.length}</dd></div>
              <div className="kv-row"><dt>列名</dt><dd>{selected.fingerprint.columns.join(', ')}</dd></div>
            </dl>
          </div>
          <div className="detail-section">
            <h4>训练信息</h4>
            <dl className="kv">
              <div className="kv-row"><dt>切分种子</dt><dd>{selected.training.splitSeed}</dd></div>
              <div className="kv-row"><dt>targets</dt><dd>{selected.training.targets.join(', ')}</dd></div>
              <div className="kv-row"><dt>训练时间</dt><dd>{selected.training.trainedAt}</dd></div>
              <div className="kv-row"><dt>来源会话</dt><dd>{selected.training.sessionRef}</dd></div>
              {selected.training.groups && <div className="kv-row"><dt>分组</dt><dd>{Object.entries(selected.training.groups).map(([group, cols]) => `${group}: ${cols.join(', ')}`).join('；')}</dd></div>}
            </dl>
          </div>
          <div className="detail-section">
            <h4>用法（usage）</h4>
            <dl className="kv">
              <div className="kv-row"><dt>inputs</dt><dd>{selected.usage.inputs.join(', ')}</dd></div>
              <div className="kv-row"><dt>outputs</dt><dd>{selected.usage.outputs.join(', ')}</dd></div>
            </dl>
            <pre className="usage-code">{`import { predict } from "dataRoot/models/${selected.name}/v${selected.version}/predict.mjs";
predict(rows)  // → 每行附加 ${selected.usage.outputs[0]} 预测键
# 或 Agent 经 modelpack_predict 工具沙箱调用`}</pre>
          </div>
        </div>
        <div className="detail-actions">
          {selected.stage === 'Staging' && <button className="primary-button" disabled={selected.corrupted} onClick={() => { setPromoteTarget(selected); setNotice(''); }}>升级为 Production</button>}
          {selected.stage === 'Production' && <span className="detail-note">当前上线版本 · 分析默认调用</span>}
          {selected.stage === 'Archived' && <span className="detail-note">已归档 · 可查不可调</span>}
          {selected.corrupted && selected.stage !== 'Archived' && <span className="detail-note warn">损坏版本不可晋级，请先重新导入</span>}
        </div>
      </>}
    </section>

    {importOpen && <CaseDialog title="导入模型包" subtitle="选择 MPS 导出的包目录（含 predict.mjs / manifest.json / README.md）。校验通过后拷入 dataRoot/models/ 固化快照，源目录随后可删。" busy={importBusy} onClose={() => setImportOpen(false)} className="model-pack-dialog">
      <div className="mp-field">
        <label htmlFor="model-pack-import-path">包目录路径</label>
        <input id="model-pack-import-path" type="text" value={importPath} spellCheck={false} disabled={importBusy}
          placeholder="/Users/…/model-mlflow/workspace/exports/<model>/v<n>"
          onChange={event => setImportPath(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !importBusy) void runImport(); }} />
        <span className="mp-help">仅接受含合法 manifest.json（formatVersion=1）的目录；Host 验货后拷入快照，不读取路径下其他内容。</span>
      </div>
      {importOutcome.kind !== 'idle' && importOutcome.kind !== 'busy' && <div className="check-steps">
        {steps.map(step => <div className={`check-step ${step.state}`} key={step.key}>
          <span className="dot">✓</span>{step.label}{step.note && <span className="step-note">{step.note}</span>}
        </div>)}
      </div>}
      {importBusy && <p className="mp-busy" role="status">正在验货并导入…（结构 → manifest → 纯度重扫 → 沙箱冒烟 → 拷入快照）</p>}
      {importOutcome.kind === 'fail' && <div className="mp-alert error" role="alert">
        <strong>导入被拒绝 · 未落任何文件，源目录未改动。</strong>
        {importOutcome.failure.stage && <div className="mp-alert-stage">失败阶段：<code>{importOutcome.failure.stage}</code></div>}
        {importOutcome.failure.reason && <div>{importOutcome.failure.reason}</div>}
        {importOutcome.failure.hint && <div className="mp-alert-hint">{importOutcome.failure.hint}</div>}
      </div>}
      {importOutcome.kind === 'ok' && <div className="mp-alert ok" role="status">
        <strong>导入成功。</strong> {importOutcome.model.name} v{importOutcome.model.version} 已入注册表（Staging）· 快照固化于 dataRoot/models/{importOutcome.model.name}/v{importOutcome.model.version} · 源目录可删。升 Production 由你在注册表点击确认。
      </div>}
      <div className="dialog-actions">
        <button className="secondary-button" onClick={() => setImportOpen(false)}>{importOutcome.kind === 'ok' ? '完成' : '关闭'}</button>
        <button className="primary-button" disabled={importBusy} onClick={() => void runImport()}>{importBusy ? '验货中…' : importOutcome.kind === 'fail' ? '重新验货' : '开始验货并导入'}</button>
      </div>
    </CaseDialog>}

    {promoteTarget && <CaseDialog title="升级为 Production" busy={promoteBusy} onClose={() => setPromoteTarget(null)} className="model-pack-dialog">
      <p className="mp-promote-sub">{promoteTarget.name} v{promoteTarget.version}（{TASK_LABELS[promoteTarget.task]} · {metricLabel(promoteTarget.metrics)}）{promoteOld ? `　·　当前 Production：v${promoteOld.version} 将自动归档` : ''}</p>
      <div className="mp-alert ok show"><strong>最小人审：</strong>模型上线是业务决定。晋级后同名旧 Production 自动归档（可查不可调）；分析工具默认只调 Production，Agent 显式指定版本才可调 Staging。</div>
      <div className="dialog-actions">
        <button className="secondary-button" disabled={promoteBusy} onClick={() => setPromoteTarget(null)}>取消</button>
        <button className="primary-button" disabled={promoteBusy} onClick={() => void confirmPromote()}>{promoteBusy ? '晋级中…' : '确认晋级'}</button>
      </div>
    </CaseDialog>}
  </div>;
}
