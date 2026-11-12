import type { FrameworkDocument } from '../contract/validate.ts';
import type { FrameworkProposalView } from '../contract/framework-review.ts';
import './analysis-framework.css';

const publicStatus: Record<FrameworkProposalView['publicSearch']['status'], string> = {
  not_searched: '本轮未调用搜索',
  unavailable: '当前配置不支持搜索',
  sources: '已取得公开来源',
  empty: '未找到公开来源',
  failed: '搜索失败',
  cancelled: '搜索已停止',
  unknown: '搜索结果未确认',
};
const proposalStatus = { pending: '待确认', confirmed: '已确认', stale: '依据已变化' } as const;
const extentLabel = { metadata: '提供元数据', fragment: '提供相关片段', full: '提供正文' } as const;
const sourceGroups = [
  { label: '需求依据', kinds: ['rap'] },
  { label: '已发布 SAP', kinds: ['sap', 'sap-method'] },
  { label: '数据、概念与知识', kinds: ['data-input', 'data-description', 'data-citation', 'data-evidence', 'enterprise'] },
  { label: '企业历史与记忆', kinds: ['personal', 'case-decision', 'case-choice', 'report'] },
];

function sourceLink(raw: string) {
  try {
    const url = new URL(raw);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href;
  } catch { /* a source can still be shown as text */ }
  return undefined;
}

function FrameworkSourceList({ sources, evidence }: {
  sources: FrameworkProposalView['sources'];
  evidence: NonNullable<FrameworkProposalView['assessment']>['evidence'];
}) {
  if (!sources.length) return <p className="re-help">本轮暂无可展开的内部来源。</p>;
  const other = sources.filter(source => !sourceGroups.some(group => group.kinds.includes(source.kind)));
  const groups = sourceGroups.map(group => ({ label: group.label, items: sources.filter(source => group.kinds.includes(source.kind)) }));
  return [...groups, { label: '其他依据', items: other }].filter(group => group.items.length > 0).map(group => <details className="re-framework-source" key={group.label}>
    <summary>{group.label}</summary>
    <ul>
      {group.items.map(source => <li key={source.id}>
        <strong>{source.title}</strong>
        <p className="re-help">版本 {source.version} · {extentLabel[source.extent]}</p>
        {evidence?.filter(item => item.sourceId === source.id).map((item, index) => <p key={index}>{item.claim}</p>)}
        <details><summary>精确来源</summary><pre className="re-framework-locator">{JSON.stringify(source.locator, null, 2)}</pre></details>
      </li>)}
    </ul>
  </details>);
}

function FrameworkContent({ framework, assessment }: { framework: FrameworkDocument; assessment?: FrameworkProposalView['assessment'] }) {
  const gaps = assessment?.gaps ?? [];
  const followups = [...new Set([...framework.openQuestions, ...framework.risks])].filter(item => !gaps.includes(item));
  return <>
    {assessment && <div className="re-framework-assessment">
      <section><h3>是否值得做</h3><p>{assessment.value}</p></section>
      <section><h3>当前能分析到哪里</h3><p>{assessment.feasibility}</p></section>
    </div>}
    {gaps.length > 0 && <section className="re-framework-section re-framework-gaps">
      <h3>关键证据缺口</h3>
      <ul>{gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>
    </section>}
    <section className="re-framework-section">
      <h3>分析范围与口径</h3>
      {assessment?.scope && <p>{assessment.scope}</p>}
      {framework.metrics.length > 0 && <dl>{framework.metrics.map((metric, index) => <div key={index}>
        <dt>{metric.name}</dt>
        <dd>{metric.definition}{metric.dimensions.length > 0 && <span> · 维度 {metric.dimensions.join('、')}</span>}{metric.source && <span> · {metric.source}</span>}</dd>
      </div>)}</dl>}
      {framework.dataNeeds.length > 0 && <details className="re-framework-source">
        <summary>拟用资料与字段</summary>
        <ul>{framework.dataNeeds.map((need, index) => <li key={index}>
          <strong>{need.table}</strong><p>{need.fields.join('、')}{need.purpose && ` · ${need.purpose}`}</p>
        </li>)}</ul>
      </details>}
    </section>
    {framework.analysisPaths.length > 0 && <section className="re-framework-section">
      <h3>本轮要回答的问题</h3>
      <ul>{framework.analysisPaths.map((path, index) => <li key={index}>
        <strong>{path.question}</strong>
        {path.hypothesis && <p>待验证假设 {path.hypothesis}</p>}
        {path.method && <p>拟比较 {path.method}</p>}
        {path.requiredData.length > 0 && <p>拟用 {path.requiredData.join('、')}</p>}
        {path.expectedOutput && <p>交付 {path.expectedOutput}</p>}
      </li>)}</ul>
    </section>}
    {framework.reportFramework.length > 0 && <details className="re-framework-source re-framework-section">
      <summary>预期报告结构</summary>
      <ul>{framework.reportFramework.map((section, index) => <li key={index}>
        <strong>{section.section}</strong>
        <p>{section.purpose}</p>
        {section.keyQuestions.length > 0 && <p>关键问题 {section.keyQuestions.join('、')}</p>}
        {section.evidence.length > 0 && <p>拟用证据 {section.evidence.join('、')}</p>}
        {section.zeroHallucinationCheck && <p>核对 {section.zeroHallucinationCheck}</p>}
      </li>)}</ul>
    </details>}
    {followups.length > 0 && <section className="re-framework-section">
      <h3>待验证的假设与证据缺口</h3>
      <ul>{followups.map(item => <li key={item}>{item}</li>)}</ul>
    </section>}
  </>;
}

export function AnalysisFramework({ proposal, busy, confirming, historical, onConfirm, onEdit }: {
  proposal: FrameworkProposalView;
  busy?: boolean;
  confirming?: boolean;
  historical?: boolean;
  onConfirm?: () => void;
  onEdit?: () => void;
}) {
  const search = proposal.publicSearch;
  const comparison = search.status === 'sources' ? proposal.assessment?.publicComparability : undefined;
  const searchStatus = comparison?.status === 'insufficient' ? '已检索，未找到足够可比案例'
    : comparison?.status === 'unknown' ? '可比性待核' : publicStatus[search.status];
  const canConfirm = proposal.status === 'pending' && Boolean(proposal.framework);
  return <div className="re-framework-layout">
    <article className="panel re-framework-paper" aria-label={historical ? '历史分析框架' : '本轮分析框架'}>
      <header className="re-panel-head">
        <h2>{historical ? '历史分析框架' : '本轮分析框架'}</h2>
        <span className={`re-pill ${proposal.status === 'confirmed' ? 'ok' : 'warn'}`} role="status">{proposalStatus[proposal.status]}</span>
      </header>
      <p className="re-help re-framework-version">框架版本 <span>{proposal.version}</span> · {proposal.selectedRap ? `基于 RAP ${proposal.selectedRap.version}` : '基于当前需求工作稿'}</p>
      {proposal.repairAttempts === 1 && <p className="re-help">输出已在同一会话修正一次格式。</p>}
      {proposal.status === 'stale' && <div className="re-stale-banner" role="status">
        <strong>{historical ? '此版本的依据已变化。' : '此版本已失效，请核对变化后重新生成。'}</strong>
        {!!proposal.changes?.length && <ul>{proposal.changes.map((change, index) => <li key={index}>{change}</li>)}</ul>}
      </div>}
      {proposal.framework ? <FrameworkContent framework={proposal.framework} assessment={proposal.assessment} /> : <p className="re-help">此版本当前没有可展示的框架内容。</p>}
      {!historical && canConfirm && <footer className="re-framework-actions">
        <p className="re-help">确认本版后，可在检查与交付中核对送入条件。</p>
        <div className="re-actions">
          <button type="button" className="text-button" disabled={busy} onClick={onEdit}>返回工作稿</button>
          <button type="button" className="primary-button" disabled={busy} onClick={onConfirm}>{confirming ? '确认中…' : '确认分析框架'}</button>
        </div>
      </footer>}
    </article>
    <aside className="panel re-framework-evidence" aria-label="框架依据">
      <h2>框架依据</h2>
      {proposal.selectedRap && <p className="re-help">{proposal.selectedRap.title} · RAP {proposal.selectedRap.version}{proposal.selectedRap.readable === false ? ' · 原版当前不可读' : proposal.selectedRap.extent === 'fragment' ? ' · 本轮提供片段' : ''}</p>}
      <FrameworkSourceList sources={proposal.sources} evidence={proposal.assessment?.evidence} />
      <details className="re-framework-source">
        <summary>公开行业案例 · {searchStatus}</summary>
        {search.findings && <p><strong>待核线索</strong> · {search.findings}</p>}
        {search.issues?.includes('failed') && <p className="re-help">本轮部分检索失败。</p>}
        {search.issues?.includes('unknown') && <p className="re-help">本轮部分检索结果未确认。</p>}
        {comparison && <p><strong>可比性判断</strong> · {comparison.note}</p>}
        {search.sources.length > 0 && <ul>{search.sources.map((source, index) => {
          const link = sourceLink(source.url);
          return <li key={index}>
            {link ? <a href={link} target="_blank" rel="noopener noreferrer">{source.title}</a> : <strong>{source.title}</strong>}
            <p className="re-help">发布 {source.publishedAt ?? '未知'} · 检索 {source.retrievedAt ?? '未知'}</p>
            {source.excerpt && <p>{source.excerpt}</p>}
          </li>;
        })}</ul>}
      </details>
    </aside>
  </div>;
}
