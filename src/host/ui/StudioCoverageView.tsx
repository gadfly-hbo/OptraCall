import { useEffect, useMemo, useRef, useState } from 'react';
import type { StudioSourceRef } from '../../../extensions/business-plugins/studio/contracts.ts';
import { coverageColumns, coverageRefIdentity } from '../../../extensions/business-plugins/studio/coverage.ts';
import type { CoverageObservation } from '../../../extensions/business-plugins/studio/coverage.ts';
import { PersonalDialog } from './PersonalDialog.tsx';
import { readStudioCoverage } from './studio-api.ts';
import type { StudioFoundation } from './studio-api.ts';
import {
  coverageCellKey, coverageColumnLabels, coverageFirstReference, coverageFramework, coverageRows,
  projectCoverageReport, studioCoverageEntries,
} from './studio-coverage-view.ts';
import type { CoverageReadResult, CoverageReferenceEntry } from './studio-coverage-view.ts';
import './StudioCoverageView.css';

type Phase = 'idle' | 'loading' | 'error' | 'settled';
type ReadSource = (ref: StudioSourceRef, returnFocus?: HTMLElement | null) => void;
type Detail = { kind: 'cell' | 'reference'; key: string } | { kind: 'focus' };
const evidenceLabels = { 'not-reviewed': '未调查／未核', located: '已见证据', partial: '部分支持', missing: '待补资料', 'not-applicable': '不适用（须有理由）' };
const questionLabels = { missing: '缺资料', 'possible-conflict': '待核矛盾', dependency: '用途依赖', 'business-decision': '业务决定' };
const categoryLabels: Record<string, string> = { 主数据: '含主数据条目', 指标体系: '含指标关联', 本体: '含本体定义', 资料: '来源资料', 方法: '方法输入' };
const identityLabels = { formal: '正式修订', candidate: '建设侧候选', history: '历史修订' };
const contains = (entry: CoverageReferenceEntry, query: string) => [entry.ref.title, entry.ref.id, entry.ref.version, entry.ref.authority, ...entry.categories].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());

function Source({ value, onReadSource }: { value: StudioSourceRef; onReadSource?: ReadSource }) {
  return <button type="button" className="text-button studio-coverage-source" disabled={!onReadSource} onClick={() => onReadSource?.(value)}>{value.title || value.id} · {value.version}<span className="studio-meta">{value.authority} · {value.id}</span></button>;
}
function Observation({ value, coord, onReadSource }: { value: CoverageObservation; coord?: string; onReadSource?: ReadSource }) {
  return <article className="studio-coverage-observation"><h4>{value.subjectLabel} <span className="studio-badge">{evidenceLabels[value.evidenceStatus]}</span></h4>
    <p>{value.description}</p><p className="studio-meta">观察 {value.id}{value.reason ? ' · 判断理由：' + value.reason : ''}</p>
    {value.annotations.filter(annotation => !coord || coverageCellKey(annotation.cell) === coord).map((annotation, index) => <p className="studio-meta" key={index}>{coverageCellKey(annotation.cell)} · 标注理由：{annotation.reason}</p>)}
    {!value.annotations.length && <p className="studio-meta">未标坐标；保留观察，不自动分配。</p>}
    {value.sourceSelection && <div className="studio-coverage-selection"><p className="studio-meta">原内容内定位：{value.sourceSelection.itemId ? '条目 ' + value.sourceSelection.itemId : ''}{value.sourceSelection.metricName ? ' 指标 ' + value.sourceSelection.metricName : ''}{value.sourceSelection.fragmentLocator ? ' 片段 ' + value.sourceSelection.fragmentLocator : ''}。以下为报告所记引用，原文须沿准确读者查看。</p><Source value={value.sourceSelection.sourceRef} onReadSource={onReadSource} /></div>}
    <ul className="studio-foundation-evidence">{value.evidenceRefs.map((ref, index) => <li key={index}><Source value={ref} onReadSource={onReadSource} /></li>)}</ul>
  </article>;
}

interface ContentProps {
  value?: CoverageReadResult; phase?: Phase; error?: string; identity?: 'candidate' | 'formal' | 'history';
  onRetry?: () => void; onReadSource?: ReadSource; onBuild?: (goal?: string) => void; onOpenWorkItems?: () => void; onOpenUsage?: () => void; onModalChange?: (open: boolean) => void;
}
/** Framework is static; all enterprise evidence is projected only from this current qualified response. */
export function StudioCoverageContent({ value, phase = 'idle', error, identity, onRetry, onReadSource, onBuild, onOpenWorkItems, onOpenUsage, onModalChange }: ContentProps) {
  const projection = projectCoverageReport(phase === 'settled' ? value : undefined);
  const report = projection ? value?.report : undefined;
  const [tab, setTab] = useState<'panorama' | 'inventory' | 'checks'>('panorama');
  const [inventory, setInventory] = useState<'materials' | 'assets' | 'methods' | 'unclassified' | 'questions'>('materials');
  const [query, setQuery] = useState(''), [detail, setDetail] = useState<Detail>();
  const detailTrigger = useRef<HTMLElement | null>(null);
  const [viewFocus, setViewFocus] = useState<string[]>(coverageFirstReference.slice()), [focusDraft, setFocusDraft] = useState<string[]>([]);
  const allRefs = projection ? [...projection.materials, ...projection.assets, ...projection.methods, ...projection.unclassified] : [];
  const reportFocus = new Set(report?.focusCells.map(coverageCellKey));
  const unknown = !projection;
  const selectedCell = detail?.kind === 'cell' ? coverageFramework.find(cell => cell.key === detail.key) : undefined;
  const selectedReference = detail?.kind === 'reference' ? allRefs.find(ref => ref.key === detail.key) : undefined;
  useEffect(() => { onModalChange?.(Boolean(detail)); return () => onModalChange?.(false); }, [Boolean(detail), onModalChange]);
  const openDetail = (next: Detail) => {
    if (!detail) detailTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDetail(next);
  };
  const readSource: ReadSource = ref => { const returnFocus = detail && detailTrigger.current?.isConnected ? detailTrigger.current : undefined; setDetail(undefined); onReadSource?.(ref, returnFocus); };
  const openCell = (key: string) => openDetail({ kind: 'cell', key });
  const coordLinks = (keys: string[]) => keys.length ? <div className="studio-coverage-coordinate-links">{keys.map(key => <button type="button" key={key} className="text-button" onClick={() => openCell(key)}>{key} · {coverageFramework.find(cell => cell.key === key)?.title}</button>)}</div> : <p className="studio-meta">未标坐标，未自动填入任何格。</p>;
  const refRows = (entries: CoverageReferenceEntry[]) => <div className="studio-table-wrap"><table className="studio-coverage-inventory"><thead><tr><th scope="col">准确来源版本</th><th scope="col">资料／关联内容</th><th scope="col">已标坐标</th><th scope="col">反查</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.key}><td><strong>{entry.ref.title || entry.ref.id}</strong><p className="studio-meta">{entry.ref.authority} · {entry.ref.id} · {entry.ref.version}</p></td><td>{entry.categories.map(category => categoryLabels[category]).join('、') || '类别未核'}</td><td>{entry.cells.join('、') || '未标注'}</td><td><button type="button" className="text-button" onClick={() => openDetail({ kind: 'reference', key: entry.key })}>查看准确引用与坐标</button></td></tr>)}</tbody></table></div>;
  const buildGoal = report ? '请沿当前企业获准资料与准确来源，核查范围“' + report.scope.purpose + '”并另存新的资料盘点候选；保留旧报告及其依据。自主选择工具，不要求补满36格，不自动标记issue或发布。' : '请从当前企业获准资料和共享经营范围出发，自主盘点已有资料与三类资产，按studio-coverage/1另存候选，保留准确来源、未调查与限制；不以单一道分析题裁剪范围，不要求补满36格，不自动发布。';

  return <section className="studio-coverage-view" aria-label="36格全景">
    <div className="studio-row"><div><h2>36格全景</h2><p className="studio-meta">从范围识别到运行实例，按六问查看完整框架；格子不是资产、建设阶段或完成分。</p></div><div className="studio-actions"><button type="button" className="secondary-button" disabled={!onRetry || phase === 'loading'} onClick={onRetry}>重新核对准确报告</button><button type="button" className="secondary-button" disabled={!onOpenUsage} onClick={onOpenUsage}>普通分析与使用记录</button><button type="button" className="primary-button" disabled={!onBuild} onClick={() => onBuild?.(buildGoal)}>沿建设任务盘点</button></div></div>
    <div className="studio-coverage-summary">
      <div><span>完整框架</span><strong>36格</strong><span>首批参考范围 14 格（建议）</span></div>
      <div><span>报告关注</span><strong>{report ? reportFocus.size + ' 格' : '未知'}</strong><span>当前查看高亮 {viewFocus.length} 格，仅影响查看</span></div>
      <div><span>资料数量</span><strong>{projection ? projection.materials.length + ' 个已分类准确版本' : '未知'}</strong><span>方法另计；同版多格只计一次</span></div>
      <div><span>三类关联资产</span><strong>{projection ? projection.assets.length + ' 个准确修订' : '未知'}</strong><span>{projection ? ['主数据', '指标体系', '本体'].map(category => categoryLabels[category] + ' ' + projection.assets.filter(asset => asset.categories.includes(category)).length).join('／') + '；标签可重叠，' + projection.unclassified.length + ' 个来源类别未核' : '当前依据尚不可展示'}</span></div>
    </div>
    {phase === 'loading' ? <p className="studio-note" role="status">正在按当前资格读取此准确报告。格含义可查看，企业资料和资产数量未知。</p>
      : phase === 'error' ? <div className="studio-note is-warning" role="alert"><p>{error || '读取失败。'} 未使用上次成功的报告证据。可重试，原引用与普通分析保持。</p><button type="button" className="secondary-button" disabled={!onRetry} onClick={onRetry}>重试读取</button></div>
      : unknown ? <div className="studio-note is-warning"><p>{value?.status === 'unsupported' ? '未知报告格式，不支持结构视图。' : value?.status === 'invalid' ? '报告结构存在问题，当前不形成覆盖结论。' : value?.status === 'unavailable' ? '此准确报告或其必需依据当前不可读，未从旧缓存恢复。' : '尚未选择可读盘点报告。'} 下方仅解释框架；报告证据与数量未知，首批14仅为参考建议。</p>{value?.error && <details><summary>查看读取限制详情</summary><p className="studio-meta">{value.error}</p></details>}{value?.issues?.length ? <ul>{value.issues.map((issue, index) => <li key={index}>{issue.path} · {issue.detail}</li>)}</ul> : null}{value?.text !== undefined && value.status !== 'unavailable' && <details><summary>按原资格查看准确原文</summary><pre className="studio-source-text">{value.text}</pre></details>}<p>损坏、未知版本或失权不能借重试、候选生成或新视图恢复；需核定原来源或另存合格修订。普通分析仍可沿其他合格来源继续。</p></div>
      : <div className="studio-note"><p>{identity ? identityLabels[identity] + ' · ' : ''}报告 {value?.assetId} · r{value?.revision} · 用途：{report?.scope.purpose}</p><p className="studio-meta">纳入：{report?.scope.included.join('；') || '未列明'}；排除：{report?.scope.excluded.join('；') || '未列明'}。期间：{report?.scope.validFrom || '未核'} → {report?.scope.validTo || '未核'}。候选可见不代表普通供给或发布，准确来源与历史仍沿原机制。</p></div>}
    <nav className="studio-foundation-nav" aria-label="覆盖报告查看">{([['panorama', '36格全景'], ['inventory', '资料与资产'], ['checks', '联合核查']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {tab === 'panorama' && <>
      <div className="studio-row"><p className="studio-meta">紫色边框：首批参考14格；“报告关注”单独标明；其余格仍可查看。未重点关注不等于不适用、缺资料或未完成。</p><button type="button" className="text-button" onClick={() => { setFocusDraft(viewFocus.slice()); openDetail({ kind: 'focus' }); }}>调整查看高亮</button></div>
      <div className="studio-table-wrap studio-coverage-matrix-scroll" tabIndex={0} aria-label="可在容器内横向滚动的完整36格矩阵"><table className="studio-coverage-matrix"><thead><tr><th scope="col">行视角</th>{coverageColumns.map((column, index) => <th key={column} scope="col">{column}<span>{coverageColumnLabels[index]}</span></th>)}</tr></thead><tbody>{coverageRows.map((row, r) => <tr key={row.name}><th scope="row">R{r + 1} {row.name}</th>{coverageColumns.map(column => {
        const key = 'R' + (r + 1) + ':' + column, cell = coverageFramework.find(cell => cell.key === key)!, data = projection?.cells.get(key);
        const materials = data?.references.filter(ref => ref.categories.includes('资料')).length, assets = data?.references.filter(ref => ref.categories.some(category => ['主数据', '指标体系', '本体'].includes(category))).length;
        return <td key={key}><button type="button" data-coverage-cell={key} className={'studio-coverage-cell' + (coverageFirstReference.includes(key) ? ' is-first-reference' : '') + (viewFocus.includes(key) ? ' is-view-highlight' : '')} aria-label={key + ' ' + cell.title} onClick={() => openCell(key)}><span className="studio-coverage-code">{key}</span><strong>{cell.title}</strong><span>{coverageFirstReference.includes(key) ? '首批参考关注' : '本轮未重点建设'}{reportFocus.has(key) ? ' · 报告关注' : ''}</span><span>{data ? materials + ' 已分类资料 · ' + assets + ' 资产 · ' + data.observations.length + ' 观察' : '资料未知 · 资产未知'}</span></button></td>;
      })}</tr>)}</tbody></table></div><p className="studio-meta">各格可重复引用同一准确版本；格内、列内计数不能相加为全局合计。未标注不表示企业没有相应业务。</p>
    </>}
    {tab === 'inventory' && <section className="studio-foundation-section"><h3>资料与三类资产分别核对</h3>{!projection ? <p className="studio-note">当前报告清单未知，未展示缓存资料。可查看36格静态含义或沿原分析继续。</p> : <>
      <div className="studio-filter" aria-label="盘点引用类别">{([['materials', '资料版本'], ['assets', '三类资产'], ['methods', '方法输入（另计）'], ['unclassified', '类别未核'], ['questions', '六问摘要']] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={inventory === key} onClick={() => { setInventory(key); setQuery(''); }}>{label}</button>)}</div>
      <label className="studio-search"><span className="sr-only">搜索当前报告准确来源</span><input type="search" value={query} placeholder="搜索来源名称、准确版本或类别" onChange={event => setQuery(event.target.value)} /></label>
      {inventory === 'questions' ? <div className="studio-table-wrap"><table className="studio-coverage-inventory"><thead><tr><th>六问</th><th>已标资料准确版本</th><th>关联资产修订</th><th>对应坐标</th></tr></thead><tbody>{coverageColumns.map((column, index) => {
        const coords = coverageFramework.filter(cell => cell.cell.column === column).map(cell => cell.key), references = allRefs.filter(ref => ref.cells.some(key => coords.includes(key)));
        return <tr key={column}><th scope="row">{column} {coverageColumnLabels[index]}</th><td>{references.filter(ref => ref.categories.includes('资料')).length}</td><td>{references.filter(ref => projection.assets.some(asset => asset.key === ref.key)).length}</td><td>{coordLinks(coords)}</td></tr>;
      })}</tbody></table><p className="studio-meta">不同列引用同一版本，各列数量不能相加。详情始终按具体坐标，不共用列兜底证据。</p></div> : <>
        <p className="studio-meta">本报告此集合 {projection[inventory].length} 个准确版本；当前匹配 {projection[inventory].filter(ref => contains(ref, query)).length} 个。{inventory === 'assets' && '含主数据条目／含指标关联／含本体定义可多标签，分类数量不可相加。'}未标材料保留在清单，不为凑格数分配。</p>
        {projection[inventory].filter(ref => contains(ref, query)).length ? refRows(projection[inventory].filter(ref => contains(ref, query))) : <div className="studio-empty"><h4>{query ? '没有匹配来源' : '本报告此集合没有已记录引用'}</h4><p>这是已读报告中的记录情况，不能解释为企业没有资料或资产。</p>{query && <button type="button" className="text-button" onClick={() => setQuery('')}>清除搜索</button>}</div>}
      </>}
    </>}</section>}
    {tab === 'checks' && <section className="studio-foundation-section"><h3>待核观察与原工作项</h3><p className="studio-meta">合法地区、渠道或期间版本差异可并存；同对象、范围、期间及含义重叠的矛盾才列待核。定义参考不强制Binding；计算／执行用途核原必要依赖。疑点不自动mark-issue、撤回或发布。</p>{report ? <>
      {report.questions.length ? report.questions.map(question => <article key={question.id} className="studio-coverage-observation"><h4>{questionLabels[question.kind]} · {question.id}</h4><p>{question.detail}</p><p>影响：{question.impact}</p><p className="studio-meta">关联观察：{question.observationIds.join('、') || '未指定'}{question.workItemId ? ' · 原工作项 ' + question.workItemId : ' · 尚未关联原工作项'}</p>{question.evidenceRefs.map((ref, index) => <Source key={index} value={ref} onReadSource={readSource} />)}<button type="button" className="text-button" disabled={!onOpenWorkItems} onClick={onOpenWorkItems}>打开原工作项列表</button></article>) : <p className="studio-meta">本报告未记录问题；不等于已经完成业务核验。</p>}
      <h4>方法与限制</h4>{projection?.methods.map(method => <Source key={method.key} value={method.ref} onReadSource={readSource} />)}{!report.methodRefs.length && <p className="studio-meta">本报告未声明采用方法，不能声称已按指定方法完成。</p>}<ul>{report.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>
    </> : <p className="studio-note">当前报告不可展示，不能核定其中的观察或问题。</p>}<button type="button" className="secondary-button" disabled={!onBuild} onClick={() => onBuild?.(buildGoal)}>由原建设任务核查与补充</button></section>}
    <p className="studio-meta studio-coverage-use-note">普通分析无需先选格、建立报告或补齐资料。Agent沿原catalog／read-source／reason自主使用合格正式资产，原使用详情与历史保留准确依据；查看格子不构成实际使用证明。</p>
    {detail && <PersonalDialog title={selectedCell ? selectedCell.key + ' · ' + selectedCell.title : selectedReference ? '准确引用与反向坐标' : '调整当前查看高亮'} drawer onClose={() => setDetail(undefined)} footer={<><button type="button" className="secondary-button" onClick={() => setDetail(undefined)}>关闭</button>{detail.kind === 'focus' && <button type="button" className="primary-button" onClick={() => { setViewFocus(focusDraft); setDetail(undefined); }}>应用查看高亮</button>}</>}>
      {selectedCell && <><dl className="studio-definition"><dt>具体含义</dt><dd>{selectedCell.perspective} · {selectedCell.title}</dd><dt>本轮边界</dt><dd>{coverageFirstReference.includes(selectedCell.key) ? '首批参考关注' : '本轮未重点建设'}；不表示不适用或缺资料。</dd><dt>报告关注</dt><dd>{report ? reportFocus.has(selectedCell.key) ? '本报告已列关注' : '本报告未列关注' : '未知；只有静态参考建议'}</dd></dl>
        {!projection ? <p className="studio-note">当前报告证据及数量未知，不显示上次成功资料。框架含义不是企业事实。</p> : <>
          {projection.cells.get(selectedCell.key)!.observations.length ? projection.cells.get(selectedCell.key)!.observations.map(observation => <Observation key={observation.id} value={observation} coord={selectedCell.key} onReadSource={readSource} />) : <p className="studio-note">本报告未标注此格证据。调查状态、资料缺口和业务适用性未知，不能从空格推出企业不存在相应内容。</p>}
          <h3>本格显式关联的准确引用</h3>{projection.cells.get(selectedCell.key)!.references.length ? refRows(projection.cells.get(selectedCell.key)!.references) : <p className="studio-meta">本报告此格已标注0个来源；没有按同列其他格补入。</p>}
          <p className="studio-meta">格不是资产，不设四维成熟度。定义、映射、可计算及实际使用，须按准确关联资产回原记录核定；报告观察不是独立核验。</p>
        </>}</>}
      {selectedReference && <><dl className="studio-definition"><dt>原权威</dt><dd>{selectedReference.ref.authority}</dd><dt>准确身份</dt><dd>{selectedReference.ref.id} · {selectedReference.ref.version}</dd><dt>归属与定位</dt><dd>{selectedReference.ref.projectId || '未提供项目'} / {selectedReference.ref.taskId || '未提供任务'} / {selectedReference.ref.locator || '未提供原定位'}</dd><dt>来源指纹</dt><dd>{selectedReference.ref.sha256 || '来源未提供，不补造'}</dd><dt>关联内容</dt><dd>{selectedReference.categories.map(category => categoryLabels[category]).join('、') || '类别未核'}；一版多格全局只计一次。</dd></dl><Source value={selectedReference.ref} onReadSource={readSource} /><h3>反向关联坐标</h3>{coordLinks(selectedReference.cells)}<h3>本报告引用它的观察</h3>{report?.observations.filter(observation => selectedReference.observationIds.includes(observation.id)).map(observation => <Observation key={observation.id} value={observation} onReadSource={readSource} />)}{!selectedReference.observationIds.length && <p className="studio-meta">仅作为本报告依据列出，未标到观察或格子。</p>}</>}
      {detail.kind === 'focus' && <><p>只调整当前查看高亮。首批参考14、报告关注、原资产、发布资格和完整36格均不变化。</p><div className="studio-coverage-focus-options">{coverageFramework.map(cell => <label key={cell.key}><input type="checkbox" value={cell.key} checked={focusDraft.includes(cell.key)} onChange={event => setFocusDraft(values => event.target.checked ? [...values, cell.key] : values.filter(value => value !== cell.key))} />{cell.key} · {cell.title}</label>)}</div></>}
    </PersonalDialog>}
  </section>;
}

export function StudioCoverageView({ foundation, loading, onReadSource, onBuild, onOpenWorkItems, onOpenUsage, onModalChange, onRefresh }: {
  foundation?: StudioFoundation; loading?: boolean; onReadSource?: (systemId: string, ref: StudioSourceRef, returnFocus?: HTMLElement | null) => void;
  onBuild: (goal?: string, systemId?: string) => void; onOpenWorkItems?: (systemId: string) => void; onOpenUsage?: (systemId?: string) => void; onModalChange?: (open: boolean) => void; onRefresh?: () => void;
}) {
  const entries = useMemo(() => studioCoverageEntries(foundation), [foundation]);
  const [target, setTarget] = useState(''), [retry, setRetry] = useState(0);
  const selected = entries.find(entry => entry.key === target) || entries[0];
  const scope = useMemo(() => ({ foundation, enterpriseId: foundation?.enterprise.id, key: selected?.key }), [foundation, selected?.key]);
  const [read, setRead] = useState<{ scope: typeof scope; phase: Phase; value?: CoverageReadResult; error?: string }>();
  const generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController(), current = ++generation.current;
    if (!selected || !scope.enterpriseId) { setRead(undefined); return () => controller.abort(); }
    setRead({ scope, phase: 'loading' });
    void readStudioCoverage(selected.systemId, selected.assetId, selected.revision, controller.signal).then(value => {
      if (controller.signal.aborted || current !== generation.current) return;
      if (coverageRefIdentity(value.ref) !== coverageRefIdentity(selected.ref) || value.report && value.report.scope.enterpriseId !== scope.enterpriseId) throw new Error('报告响应与当前企业或准确引用不符；未展示来源。');
      setRead({ scope, phase: 'settled', value });
    }).catch(error => {
      if (!controller.signal.aborted && current === generation.current) setRead({ scope, phase: 'error', error: error instanceof Error ? error.message : '准确报告读取失败。' });
    });
    return () => { controller.abort(); };
  }, [scope, retry]);
  const current = read?.scope === scope ? read : undefined;
  return <div className="studio-coverage-container"><label className="studio-field studio-coverage-report-picker"><span>当前查看的准确盘点报告</span><select aria-label="当前查看的准确盘点报告" value={selected?.key || ''} disabled={!entries.length || loading} onChange={event => setTarget(event.target.value)}>{!entries.length && <option value="">尚无已发现的盘点报告</option>}{entries.map(entry => <option key={entry.key} value={entry.key}>{entry.title} · {identityLabels[entry.identity]} r{entry.revision} · {entry.systemId}</option>)}</select></label>{!entries.length && onRefresh && <button type="button" className="text-button" disabled={loading} onClick={onRefresh}>重新读取原资产目录</button>}
    <StudioCoverageContent key={scope.enterpriseId + ':' + selected?.key} value={current?.value} phase={current?.phase || (selected || loading ? 'loading' : 'idle')} error={current?.error} identity={selected?.identity} onRetry={selected ? () => setRetry(value => value + 1) : undefined} onBuild={goal => onBuild(goal, selected?.systemId)} onOpenUsage={onOpenUsage ? () => onOpenUsage(selected?.systemId) : undefined} onModalChange={onModalChange} onReadSource={selected && onReadSource ? (ref, returnFocus) => onReadSource(ref.authority === 'studio-source' ? ref.locator || selected.systemId : selected.systemId, ref, returnFocus) : undefined} onOpenWorkItems={selected && onOpenWorkItems ? () => onOpenWorkItems(selected.systemId) : undefined} />
  </div>;
}
