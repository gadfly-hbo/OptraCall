import { useEffect, useRef } from 'react';

const stages = [
  { id: 'review', label: '判断建议', summary: '待审建议', symbol: '◇' },
  { id: 'action', label: '行动跟进', summary: '待办行动', symbol: '↗' },
  { id: 'feedback', label: '结果复盘', summary: '待复盘', symbol: '↻' },
] as const;
const examples = [
  { id: 'D-01', stage: 'review', title: '先核验影响复购的关键因素', body: '接入后在此呈现来源、证据与候选解释，帮助判断是否值得采取行动。', tag: '经营判断' },
  { id: 'D-02', stage: 'review', title: '比较行动方案的成本与约束', body: '接入后对照候选策略、预期效果和未知项，保留用户的决策依据。', tag: '方案比较' },
  { id: 'D-03', stage: 'action', title: '为已采纳建议补齐行动安排', body: '接入后关联负责人、时间与执行回执；当前不会创建任何真实任务。', tag: '行动占位' },
  { id: 'D-04', stage: 'feedback', title: '回填结果，复核原来的判断', body: '接入后对照预期与实际，记录适用条件、修正意见和后续学习。', tag: '反馈占位' },
];

export function DecisionPage() {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);
  return <div className="decision-page">
    <div className="decision-heading"><div><p className="eyebrow">DECISION WORKSPACE</p><h1 ref={title} tabIndex={-1}>决策工作台</h1><p>把判断、行动与反馈放在同一处。</p></div><span className="demo-project">示例项目 · 月度经营复盘</span></div>
    <div className="decision-reserved" role="note"><span className="reserved-icon" aria-hidden="true">◇</span><div><strong>decision-platform 接入预留</strong><p>当前为虚拟示意数据，插件尚未接入。这里不读取真实报告，不执行采纳、驳回或业务行动。</p></div><span className="planned-badge">未接入</span></div>
    <section className="decision-stats" aria-label="虚拟统计">{stages.map(stage => <div key={stage.id}><span>{stage.summary}<small>示例</small></span><strong>{examples.filter(item => item.stage === stage.id).length}<small>项</small></strong><p>仅统计下方虚拟条目</p></div>)}</section>
    <div className="decision-section-heading"><h2>从建议到结果</h2><span>演示项目 · 非真实执行记录</span></div>
    <section className="decision-board" aria-label="决策大屏演示">{stages.map(stage => <div className={`decision-lane ${stage.id}`} key={stage.id}><div className="decision-lane-heading"><h3><span aria-hidden="true">{stage.symbol}</span>{stage.label}</h3><span>{examples.filter(item => item.stage === stage.id).length}</span></div>{examples.filter(item => item.stage === stage.id).map(item => <article className="decision-card" key={item.id}><div><span>{item.tag}</span><span className="decision-example">虚拟示例</span></div><h4>{item.title}</h4><p>{item.body}</p><footer><span>证据与记录 · 待接入</span><span>{item.id}</span></footer></article>)}</div>)}</section>
    <div className="decision-integration"><div><h2>为完整的决策闭环留出位置</h2><p>项目与报告 → 证据和建议 → 用户判断 → 行动与反馈</p></div><span>业务插件接入后启用</span></div>
  </div>;
}
