import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoardRequestError, addManualItem, addTask, adoptItem, dismissItem, extractReport, readBoard, saveFeedback, setTaskStatus, stopExtraction, type BoardItemView, type BoardReportView, type BoardTaskView, type BoardView } from './decision-board-client.ts';
import { EVIDENCE_CONFIDENCE, type EvidenceLevel, type Priority } from '../types.ts';

const EVIDENCE_CLASS: Record<string, string> = { '数据支撑': 'ev-data', '多源佐证': 'ev-multi', '逻辑推断': 'ev-logic', '经验假设': 'ev-exp' };
const PRIORITY_LABEL: Record<string, string> = { high: '高优', medium: '中优', low: '低优' };
const TASK_STATUS_LABEL: Record<string, string> = { todo: '待办', doing: '进行中', done: '已完成' };
const kb = (bytes: number) => bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;

function BoardDialog({ title, error, children, onClose }: { title: string; error?: string | null; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); }, []);
  return <dialog ref={ref} className="catalog-dialog board-dialog" aria-labelledby="board-dialog-title" onClose={onClose}>
    <div className="dialog-heading"><h2 id="board-dialog-title">{title}</h2><button className="icon-button" aria-label="关闭" onClick={() => ref.current?.close()}>✕</button></div>
    {error && <p className="board-error" role="alert">{error}</p>}
    {children}
  </dialog>;
}

export function DecisionBoardPage() {
  const [board, setBoard] = useState<BoardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState('all');
  const [evidenceFilter, setEvidenceFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [pending, setPending] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  const [dismissTarget, setDismissTarget] = useState<BoardItemView | null>(null);
  const [taskTarget, setTaskTarget] = useState<BoardItemView | null>(null);
  const [feedbackTask, setFeedbackTask] = useState<{ task: BoardTaskView; item: BoardItemView } | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, []);

  const load = useCallback(async () => {
    try { setBoard(await readBoard()); setError(null); }
    catch (caught) { setError(caught instanceof BoardRequestError ? caught.message : '决策看板读取失败，请检查本地服务后重试。'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 4000);
    return () => clearInterval(timer);
  }, [load]);

  const run = async (key: string, operation: () => Promise<unknown>) => {
    if (pending) return;
    setPending(key);
    try { await operation(); await load(); setError(null); }
    catch (caught) { setError(caught instanceof BoardRequestError ? caught.message : '决策看板操作未完成，请重试。'); await load().catch(() => {}); }
    finally { setPending(null); }
  };

  const projects = board?.projects ?? [];
  const items = useMemo(() => (board?.items ?? []).filter(item =>
    (projectFilter === 'all' || item.projectId === projectFilter)
    && (evidenceFilter === 'all' || item.evidenceLevel === evidenceFilter)
    && (priorityFilter === 'all' || item.priority === priorityFilter)
    && (sourceFilter === 'all' || item.sourceKind === sourceFilter)), [board, projectFilter, evidenceFilter, priorityFilter, sourceFilter]);
  const projectName = (id: string) => projects.find(project => project.id === id)?.name ?? id;
  const projectArchived = (id: string) => projects.find(project => project.id === id)?.archivedAt != null;
  const sourceReport = (item: BoardItemView) => item.extractionId ? board?.reports.find(report => report.projectId === item.projectId && report.extraction?.id === item.extractionId) : undefined;
  const reports = (board?.reports ?? []).filter(report => projectFilter === 'all' || report.projectId === projectFilter);
  const suggested = items.filter(item => item.status === 'suggested');
  const dismissed = items.filter(item => item.status === 'dismissed');
  const adopted = items.filter(item => item.status === 'adopted');
  const reviewTasks = adopted.flatMap(item => item.tasks.filter(task => task.status === 'done').map(task => ({ task, item })));

  return <div className="decision-page board-page">
    <div className="decision-heading"><div><p className="eyebrow">DECISION BOARD</p><h1 ref={title} tabIndex={-1}>决策看板</h1><p>跨项目汇总分析报告，把判断、行动与反馈放在同一处。</p></div></div>
    {error && <p className="board-error" role="alert">{error}</p>}
    {board && <section className="decision-stats board-stats" aria-label="看板统计">
      <div><span>报告<small>060_reports</small></span><strong>{board.stats.reports}<small>份</small></strong><p>各项目已保存的报告文件</p></div>
      <div><span>待判断<small>含人工补充</small></span><strong>{board.stats.suggested}<small>项</small></strong><p>其中高优 {board.stats.highPrioritySuggested} 项</p></div>
      <div><span>已采纳<small>行动跟进</small></span><strong>{board.stats.adopted}<small>项</small></strong><p>可拆解任务并跟进</p></div>
    </section>}

    <div className="board-toolbar">
      <label className="sr-only" htmlFor="board-project-filter">按项目过滤</label>
      <select id="board-project-filter" value={projectFilter} onChange={event => setProjectFilter(event.target.value)}>
        <option value="all">全部项目</option>
        {projects.map(project => <option key={project.id} value={project.id}>{project.name}{project.archivedAt ? '（已归档）' : ''}</option>)}
      </select>
      <label className="sr-only" htmlFor="board-evidence-filter">按证据等级过滤</label>
      <select id="board-evidence-filter" value={evidenceFilter} onChange={event => setEvidenceFilter(event.target.value)}>
        <option value="all">全部证据</option>{Object.keys(EVIDENCE_CLASS).map(level => <option key={level} value={level}>{level}</option>)}
      </select>
      <label className="sr-only" htmlFor="board-priority-filter">按优先级过滤</label>
      <select id="board-priority-filter" value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)}>
        <option value="all">全部优先级</option>{Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <label className="sr-only" htmlFor="board-source-filter">按来源过滤</label>
      <select id="board-source-filter" value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}>
        <option value="all">全部来源</option><option value="extracted">模型抽取</option><option value="manual">人工补充</option>
      </select>
      <span className="spacer" />
      {board && board.stats.dismissed > 0 && <label className="board-chip" id="dismissed-toggle"><input type="checkbox" id="show-dismissed" checked={showDismissed} onChange={event => setShowDismissed(event.target.checked)} />已驳回 <span id="dismissed-count">{board.stats.dismissed}</span></label>}
      <button className="secondary-button" onClick={() => setManualOpen(true)}>补充建议</button>
    </div>

    <section className="board-reports" aria-label="项目报告">
      <h3>项目报告（{reports.length}）{board?.stats.runningExtractions ? ` · 抽取中 ${board.stats.runningExtractions}` : ''}</h3>
      <p className="board-context-note">每次抽取只读取一份报告；证据标签是模型对报告内容的判断，尚不代表独立核验。</p>
      {!board ? <div className="board-report-list"><div className="board-empty">正在读取项目报告…</div></div>
        : !reports.length ? <div className="board-report-list"><div className="board-empty">还没有项目报告。在项目工作台让分析任务输出报告，或从对话回复“保存为最终报告”，报告会出现在各项目的 060_reports 中。</div></div>
        : <div className="board-report-list">{reports.map(report => <ReportRow key={`${report.projectId}/${report.relativePath}`} report={report} archived={projectArchived(report.projectId)} disabled={pending !== null} onExtract={() => run(`extract:${report.relativePath}`, () => extractReport(report.projectId, report.relativePath))} onStop={() => report.extraction && run(`stop:${report.relativePath}`, () => stopExtraction(report.extraction!.id))} />)}</div>}
    </section>

    <div className="decision-section-heading"><h2>从建议到结果</h2><span>{projects.filter(project => project.archivedAt === null).length} 个活跃项目 · {projects.filter(project => project.archivedAt !== null).length} 个已归档</span></div>
    <p className="board-context-note">采纳记录由用户决定；任务完成与业务效果分别回录。</p>
    <section className="decision-board" aria-label="决策泳道">
      <div className="decision-lane review">
        <div className="decision-lane-heading"><h3><span aria-hidden="true">◇</span>判断建议</h3><span>{suggested.length} 项待判断</span></div>
        {!suggested.length && !(showDismissed && dismissed.length) ? <div className="board-lane-empty">暂无待判断建议。从上方报告触发“抽取建议”，或点“补充建议”登记报告外的判断。</div>
          : <>
            {suggested.map(item => <ItemCard key={item.id} item={item} report={sourceReport(item)} projectName={projectName(item.projectId)} disabled={pending !== null}
              onAdopt={() => run(`adopt:${item.id}`, () => adoptItem(item.id))}
              onDismiss={() => setDismissTarget(item)} />)}
            {showDismissed && dismissed.map(item => <ItemCard key={item.id} item={item} report={sourceReport(item)} projectName={projectName(item.projectId)} disabled={pending !== null} />)}
          </>}
      </div>
      <div className="decision-lane action">
        <div className="decision-lane-heading"><h3><span aria-hidden="true">↗</span>行动跟进</h3><span>{adopted.length} 项已采纳</span></div>
        {!adopted.length ? <div className="board-lane-empty">采纳建议后在这里拆解任务：负责人、截止日与执行状态。</div>
          : adopted.map(item => <ItemCard key={item.id} item={item} report={sourceReport(item)} projectName={projectName(item.projectId)} disabled={pending !== null}
            onAddTask={() => setTaskTarget(item)}
            onTaskStatus={(taskId, status) => run(`task:${taskId}`, () => setTaskStatus(taskId, status))}
            onFeedback={task => setFeedbackTask({ task, item })}
            onDismiss={() => setDismissTarget(item)} />)}
      </div>
      <div className="decision-lane feedback">
        <div className="decision-lane-heading"><h3><span aria-hidden="true">↻</span>结果复盘</h3><span>{reviewTasks.length} 项任务已完成</span></div>
        {!reviewTasks.length ? <div className="board-lane-empty">任务完成后回录反馈：结果、指标变化与评分，形成复盘记录。</div>
          : reviewTasks.map(({ task, item }) => <article className="decision-card" key={task.id}>
            <div className="board-card-top"><span className="board-chip">任务{TASK_STATUS_LABEL[task.status]}</span>{task.feedback && <span className="board-chip run" aria-label={`用户反馈评分 ${task.feedback.score} 分`}>{'★'.repeat(task.feedback.score)}{'☆'.repeat(5 - task.feedback.score)}</span>}</div>
            <h4>{task.title}</h4>
            <p className="card-source">所属：{item.title} · {projectName(item.projectId)}{task.owner ? ` · 负责人 ${task.owner}` : ''}{task.dueDate ? ` · 截止 ${task.dueDate}` : ''}</p>
            {task.feedback ? <div className="board-task-feedback">
              <p>用户回录：{task.feedback.adopted ? '按建议执行' : '未按原建议执行'}{task.feedback.outcome ? ` · ${task.feedback.outcome}` : ''}{task.feedback.metricDelta ? ` · 指标变化 ${task.feedback.metricDelta}` : ''}</p>
              {task.feedback.review && <p>复盘：{task.feedback.review}</p>}
            </div> : <p className="card-source">尚未回录反馈。</p>}
            <footer className="card-actions"><button disabled={pending !== null} onClick={() => setFeedbackTask({ task, item })}>{task.feedback ? '更新反馈' : '回录反馈'}</button></footer>
          </article>)}
      </div>
    </section>

    {dismissTarget && <DismissDialog item={dismissTarget} error={error} onClose={() => setDismissTarget(null)} onSubmit={reason => run(`dismiss:${dismissTarget.id}`, async () => { await dismissItem(dismissTarget.id, reason); setDismissTarget(null); })} />}
    {taskTarget && <TaskDialog item={taskTarget} error={error} onClose={() => setTaskTarget(null)} onSubmit={input => run(`addtask:${taskTarget.id}`, async () => { await addTask(taskTarget.id, input); setTaskTarget(null); })} />}
    {feedbackTask && <FeedbackDialog task={feedbackTask.task} error={error} onClose={() => setFeedbackTask(null)} onSubmit={input => run(`feedback:${feedbackTask.task.id}`, async () => { await saveFeedback(feedbackTask.task.id, input); setFeedbackTask(null); })} />}
    {manualOpen && board && <ManualDialog error={error} projects={projects.filter(project => project.archivedAt === null)} onClose={() => setManualOpen(false)} onSubmit={input => run('manual', async () => { await addManualItem(input); setManualOpen(false); })} />}
  </div>;
}

function ReportRow({ report, archived, disabled, onExtract, onStop }: { report: BoardReportView; archived: boolean; disabled: boolean; onExtract: () => void; onStop: () => void }) {
  const extraction = report.extraction;
  return <div className="board-report-row">
    <span className="report-name">{report.name}</span>
    <span className="report-project">{report.projectName}{archived ? '（已归档）' : ''}</span>
    <span className="report-bytes">{kb(report.bytes)}</span>
    {report.availability === 'missing' ? <span className="board-chip fail">报告文件不存在</span>
      : report.availability === 'changed' ? <span className="board-chip warn">报告已变化 · 建议重新抽取</span> : null}
    {extraction === null ? <span className="board-chip">未抽取</span>
      : extraction.status === 'running' ? <span className="board-chip run">抽取中…</span>
      : extraction.status === 'completed' ? <span className="board-chip">已抽取 {extraction.itemCount ?? 0} 条</span>
      : extraction.status === 'failed' ? <span className="board-chip fail">抽取失败</span>
      : extraction.status === 'cancelled' ? <span className="board-chip">已取消</span>
      : <span className="board-chip warn">抽取已中断</span>}
    {extraction && <span className="report-input">本次抽取输入：1 份报告</span>}
    <span className="report-actions">
      {extraction?.status === 'running'
        ? <button disabled={disabled} onClick={onStop}>停止</button>
        : <button className="primary-button" disabled={disabled || archived || report.availability === 'missing'} title={archived ? '项目已归档，恢复后可抽取' : undefined} onClick={onExtract}>{extraction ? '重新抽取' : '抽取建议'}</button>}
    </span>
  </div>;
}

function ItemCard({ item, report, projectName: name, disabled, onAdopt, onDismiss, onAddTask, onTaskStatus, onFeedback }: {
  item: BoardItemView; report?: BoardReportView; projectName: string; disabled: boolean;
  onAdopt?: () => void; onDismiss?: () => void; onAddTask?: () => void;
  onTaskStatus?: (taskId: string, status: string) => void; onFeedback?: (task: BoardTaskView) => void;
}) {
  const openTasks = item.tasks.filter(task => task.status !== 'done');
  const manual = item.sourceKind === 'manual';
  const mappedReference = item.evidenceLevel !== null && EVIDENCE_CONFIDENCE[item.evidenceLevel] === item.confidence;
  const reportName = report ? report.name : item.reportId !== null ? '原抽取报告名称未知' : '来源报告未知';
  return <article className="decision-card">
    <div className="board-card-top">
      <span className={`board-chip pr-${item.priority}`}>{PRIORITY_LABEL[item.priority]}</span>
      <span className="board-chip">{item.evidenceLevel ? `${manual ? '固定标签' : '模型标签'}：${item.evidenceLevel}` : '证据标签未知'}</span>
      <span className="board-chip">{manual ? '人工' : '抽取'}</span>
    </div>
    <h4>{item.title}</h4>
    <p>{item.rationale}</p>
    {item.expectedImpact && <p className="board-impact">预期效果：{item.expectedImpact}</p>}
    {item.status === 'dismissed' && item.dismissedReason && <p className="card-dismissed-reason">驳回理由：{item.dismissedReason}</p>}
    {!manual && <p className="board-source-report">{report ? `抽取自：${reportName}` : reportName}</p>}
    <details className="board-evidence"><summary>来源与依据{item.evidence ? `（${item.evidence.facts.length} 项报告依据）` : ''}</summary>
      {manual ? <p className="reasoning">人工补充；经验假设为固定标签。</p> : <>
        <p className="reasoning">{report ? `抽取报告：${report.relativePath}` : reportName}</p>
        {item.extractionId && item.reportId !== null && <p className="reasoning">本次抽取输入：1 份报告</p>}
        <p className="reasoning">同一报告的多处引文，不代表独立多源验证。</p>
      </>}
      <p className="board-reference-value">{item.confidence === null ? '参考值未知' : `${mappedReference ? '标签参考值' : '已存参考值'} ${item.confidence}`}</p>
      {item.confidence !== null && <p className="reasoning">{mappedReference ? '参考值按证据标签映射，不是模型自报概率或已验证正确率。' : '参考值来源未知，不能作为已验证正确率。'}</p>}
      {item.evidence ? <>
        {item.evidence.facts.map((fact, index) => <div className="fact" key={index}><p>{fact.text}</p>{fact.quote && <blockquote>{fact.quote}</blockquote>}</div>)}
        <p className="reasoning">{manual ? '补充说明' : '模型推导'}：{item.evidence.reasoning}</p>
      </> : <p className="reasoning">未记录证据与推导。</p>}
    </details>
    {onAddTask && item.tasks.length > 0 && <div className="board-tasks">{openTasks.map(task => <div className="board-task" key={task.id}>
      <p className="task-title">{task.title}</p>
      <p className="task-meta">{TASK_STATUS_LABEL[task.status]}{task.owner ? ` · ${task.owner}` : ''}{task.dueDate ? ` · 截止 ${task.dueDate}` : ''}</p>
      <div className="task-actions">
        {task.status === 'todo' && <button disabled={disabled} onClick={() => onTaskStatus?.(task.id, 'doing')}>开始</button>}
        {task.status !== 'done' && <button disabled={disabled} onClick={() => onTaskStatus?.(task.id, 'done')}>完成</button>}
        {task.status === 'doing' && <button disabled={disabled} onClick={() => onTaskStatus?.(task.id, 'todo')}>退回待办</button>}
      </div>
    </div>)}</div>}
    <footer className="card-actions">
      <span className="card-source">{name}{item.reportId === null ? ' · 报告外补充' : ''}</span>
      {onAdopt && <button className="primary-button" disabled={disabled} onClick={onAdopt}>采纳</button>}
      {onAddTask && <button disabled={disabled} onClick={onAddTask}>添加任务</button>}
      <button disabled={disabled} onClick={onDismiss}>驳回</button>
    </footer>
  </article>;
}

function DismissDialog({ item, error, onClose, onSubmit }: { item: BoardItemView; error?: string | null; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  const valid = [...reason.trim()].length >= 2;
  return <BoardDialog title="驳回建议" error={error} onClose={onClose}>
    <p className="card-source">{item.title} · 驳回后不能直接改为采纳，可重新抽取或人工补充。</p>
    <form className="board-form" onSubmit={event => { event.preventDefault(); if (valid) onSubmit(reason.trim()); }}>
      <label htmlFor="dismiss-reason">驳回理由（必填，至少 2 字）</label>
      <textarea id="dismiss-reason" value={reason} onChange={event => setReason(event.target.value)} placeholder="例如：范围外 / 证据不足 / 已有同类行动" />
      {!valid && reason.length > 0 && <p className="form-error">请填写至少 2 个字符的理由。</p>}
      <div className="board-dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={!valid}>确认驳回</button></div>
    </form>
  </BoardDialog>;
}

function TaskDialog({ item, error, onClose, onSubmit }: { item: BoardItemView; error?: string | null; onClose: () => void; onSubmit: (input: { title: string; owner?: string; dueDate?: string; priority?: string; note?: string }) => void }) {
  const [title, setTitle] = useState(''), [owner, setOwner] = useState(''), [dueDate, setDueDate] = useState(''), [priority, setPriority] = useState(item.priority), [note, setNote] = useState('');
  return <BoardDialog title="添加行动任务" error={error} onClose={onClose}>
    <p className="card-source">所属建议：{item.title}</p>
    <form className="board-form" onSubmit={event => { event.preventDefault(); if (title.trim()) onSubmit({ title: title.trim(), owner: owner.trim() || undefined, dueDate: dueDate || undefined, priority, note: note.trim() || undefined }); }}>
      <label htmlFor="task-title">任务标题（必填）</label>
      <input id="task-title" value={title} onChange={event => setTitle(event.target.value)} required />
      <label htmlFor="task-owner">负责人</label>
      <input id="task-owner" value={owner} onChange={event => setOwner(event.target.value)} placeholder="选填" />
      <label htmlFor="task-due">截止日期</label>
      <input id="task-due" type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} />
      <label htmlFor="task-priority">优先级</label>
      <select id="task-priority" value={priority} onChange={event => setPriority(event.target.value as Priority)}>{Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <label htmlFor="task-note">备注</label>
      <input id="task-note" value={note} onChange={event => setNote(event.target.value)} placeholder="选填" />
      <div className="board-dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={!title.trim()}>添加任务</button></div>
    </form>
  </BoardDialog>;
}

function FeedbackDialog({ task, error, onClose, onSubmit }: { task: BoardTaskView; error?: string | null; onClose: () => void; onSubmit: (input: { adopted: boolean; outcome: string; metricDelta: string; review: string; score: number }) => void }) {
  const existing = task.feedback;
  const [adopted, setAdopted] = useState(existing?.adopted ?? true), [outcome, setOutcome] = useState(existing?.outcome ?? ''), [metricDelta, setMetricDelta] = useState(existing?.metricDelta ?? ''), [review, setReview] = useState(existing?.review ?? ''), [score, setScore] = useState(existing?.score ?? 3);
  return <BoardDialog title={existing ? '更新反馈' : '回录反馈'} error={error} onClose={onClose}>
    <p className="card-source">任务：{task.title}{existing ? ' · 再次提交会覆盖原反馈' : ''}</p>
    <form className="board-form" onSubmit={event => { event.preventDefault(); onSubmit({ adopted, outcome: outcome.trim(), metricDelta: metricDelta.trim(), review: review.trim(), score }); }}>
      <label htmlFor="feedback-adopted">是否按建议执行</label>
      <select id="feedback-adopted" value={adopted ? 'yes' : 'no'} onChange={event => setAdopted(event.target.value === 'yes')}><option value="yes">按建议执行</option><option value="no">未按原建议执行</option></select>
      <label htmlFor="feedback-outcome">执行结果</label>
      <input id="feedback-outcome" value={outcome} onChange={event => setOutcome(event.target.value)} placeholder="例如：召回权益已上线" />
      <label htmlFor="feedback-metric">指标变化</label>
      <input id="feedback-metric" value={metricDelta} onChange={event => setMetricDelta(event.target.value)} placeholder="例如：复购率 +2.4%" />
      <label htmlFor="feedback-review">复盘</label>
      <textarea id="feedback-review" value={review} onChange={event => setReview(event.target.value)} placeholder="适用条件、修正意见与后续学习" />
      <label htmlFor="feedback-score">评分（1–5）</label>
      <select id="feedback-score" value={score} onChange={event => setScore(Number(event.target.value))}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select>
      <div className="board-dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" type="submit">保存反馈</button></div>
    </form>
  </BoardDialog>;
}

function ManualDialog({ projects, error, onClose, onSubmit }: { projects: { id: string; name: string }[]; error?: string | null; onClose: () => void; onSubmit: (input: { projectId: string; title: string; rationale: string; expectedImpact?: string; priority?: string }) => void }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? ''), [title, setTitle] = useState(''), [rationale, setRationale] = useState(''), [expectedImpact, setExpectedImpact] = useState(''), [priority, setPriority] = useState('medium');
  return <BoardDialog title="人工补充建议" error={error} onClose={onClose}>
    <p className="card-source">登记报告外的经验判断；证据固定为“经验假设”，与抽取项同样走采纳 / 驳回闭环。</p>
    <form className="board-form" onSubmit={event => { event.preventDefault(); if (projectId && title.trim() && rationale.trim()) onSubmit({ projectId, title: title.trim(), rationale: rationale.trim(), expectedImpact: expectedImpact.trim() || undefined, priority }); }}>
      <label htmlFor="manual-project">归属项目（必填）</label>
      <select id="manual-project" value={projectId} onChange={event => setProjectId(event.target.value)}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
      <label htmlFor="manual-title">建议标题（必填）</label>
      <input id="manual-title" value={title} onChange={event => setTitle(event.target.value)} required />
      <label htmlFor="manual-rationale">理由（必填）</label>
      <textarea id="manual-rationale" value={rationale} onChange={event => setRationale(event.target.value)} required />
      <label htmlFor="manual-impact">预期效果</label>
      <input id="manual-impact" value={expectedImpact} onChange={event => setExpectedImpact(event.target.value)} placeholder="选填" />
      <label htmlFor="manual-priority">优先级</label>
      <select id="manual-priority" value={priority} onChange={event => setPriority(event.target.value as Priority)}>{Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <div className="board-dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={!projects.length || !title.trim() || !rationale.trim()}>补充建议</button></div>
    </form>
  </BoardDialog>;
}
