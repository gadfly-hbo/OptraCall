import { useEffect, useState, type ReactNode } from 'react';
import type { CaseDecisionIssue, CaseStrategyChoiceValue } from '../case-decision-types.ts';
import { caseIssueTimeline } from './case-decisions-client.ts';
import type { CaseIssueTimeline } from './case-board-navigation-model.ts';
import { projectCaseIssueProgress } from './case-issue-progress.ts';
import { readDecisionRequests, type CaseDecisionRequestView } from './workspace-daily-client.ts';
import { CaseDialog, caseDate, caseError } from './CaseDialogs.tsx';
import './daily-case-history.css';

type Props = {
  caseId: string; revision: number; issues: readonly CaseDecisionIssue[]; selectedIssueId: string;
  onSelectIssue(issueId: string): void; onReturnCurrent(): void; children?: ReactNode;
};
type Round = CaseIssueTimeline['rounds'][number];
type Source = { owner: string; title: string; paragraphs: string[]; facts: [string, string][] };
const choiceNames: Record<CaseStrategyChoiceValue, string> = { trial: '试行', adjust: '调整', continue: '继续', defer: '暂缓', no_action: '本次不行动', gather_evidence: '补证', reject: '不采用', stop_considering: '停止考虑' };

/** Read the original issue timeline; navigation never adopts, writes or starts an Agent. */
export function DailyCaseHistory({ caseId, revision, issues, selectedIssueId, onSelectIssue, onReturnCurrent, children }: Props) {
  const owner = `${caseId}/${selectedIssueId}@${revision}`;
  const issue = issues.find(value => value.id === selectedIssueId && value.caseId === caseId);
  const [snapshot, setSnapshot] = useState<{ owner: string; timeline: CaseIssueTimeline; requests?: CaseDecisionRequestView[]; requestError?: string }>();
  const [failure, setFailure] = useState<{ owner: string; message: string }>();
  const [retry, setRetry] = useState(0);
  const [historical, setHistorical] = useState<{ owner: string; choiceId: string }>();
  const [source, setSource] = useState<Source>();
  useEffect(() => {
    let alive = true;
    setSnapshot(undefined); setFailure(undefined); setHistorical(undefined); setSource(undefined);
    if (!issue) return;
    void Promise.allSettled([caseIssueTimeline(caseId, selectedIssueId), readDecisionRequests(caseId)]).then(([timeline, requests]) => {
      if (!alive) return;
      if (timeline.status === 'rejected') { setFailure({ owner, message: caseError(timeline.reason) }); return; }
      if (timeline.value.issue.id !== selectedIssueId || timeline.value.issue.caseId !== caseId) {
        setFailure({ owner, message: '原轮次记录与所选事项不一致，请重新读取。' }); return;
      }
      if (requests.status === 'rejected' && requests.reason?.status === 403) {
        setFailure({ owner, message: '当前身份无权读取本 Case，已清除历史内容。' }); return;
      }
      setSnapshot({ owner, timeline: timeline.value, ...(requests.status === 'fulfilled'
        ? { requests: requests.value.requests }
        : { requestError: '当前请求暂不可读取，当前轮次状态待核。' }) });
    });
    return () => { alive = false; };
  }, [caseId, selectedIssueId, revision, Boolean(issue), retry]);
  const loaded = snapshot?.owner === owner && issue ? snapshot : undefined;
  const timeline = loaded?.timeline;
  const progress = projectCaseIssueProgress(timeline, loaded?.requests);
  const viewedRound = historical?.owner === owner ? timeline?.rounds.find(round => round.choice.choiceId === historical.choiceId) : undefined;
  const viewedNumber = viewedRound && timeline ? timeline.rounds.indexOf(viewedRound) + 1 : null;
  const error = failure?.owner === owner ? failure.message : '';
  function showChoice(round: Round) {
    setSource({ owner, title: '当时保存的取舍', paragraphs: [choiceNames[round.choice.choice], round.choice.reason || '原理由未记录。', ...(round.choice.nextStep ? [`当时记录的下一步：${round.choice.nextStep}`] : [])], facts: [
      ['事项', issue!.title], ['取舍时间', caseDate(round.choice.occurredAt)], ['选择身份', round.choice.choiceId],
      ['原方案', `${round.choice.strategyRef.recordId} · v${round.choice.strategyRef.revision}`],
      ['前一选择', round.choice.previousChoiceId ?? '首轮'], ['操作回执', round.choice.operationId],
    ] });
  }
  function showAction(round: Round, action: Round['actions'][number]) {
    setSource({ owner, title: '原授权与行动记录', paragraphs: [action.title, ...action.authorizations.map(value => `${caseDate(value.time)} · ${value.decision === 'authorize' ? '授权' : value.decision} · ${value.scope}`)], facts: [
      ['原项目', action.projectId], ['原行动', action.taskId], ['原事项选择', round.choice.choiceId],
      ['授权记录', action.authorizations.map(value => value.id).join('、') || '暂无可读授权'],
      ['当前有效授权', action.currentAuthorizationId ?? '当前无有效授权'],
    ] });
  }
  function showObservation(round: Round, action: Round['actions'][number], observation: Round['actions'][number]['feedback'][number]) {
    setSource({ owner, title: '反馈原记录', paragraphs: [observation.outcome || '原观察结果未填写。', observation.effect, observation.metricDelta, observation.review].filter(Boolean), facts: [
      ['原行动', observation.actionTitle], ['原项目', action.projectId], ['原选择', round.choice.choiceId],
      ['反馈修订', observation.revisionId], ['准确授权', observation.authorizationId], ['观察日期', observation.observationDate || '未记录'], ['来源与范围', observation.sourceScope || '未记录'], ['回录时间', caseDate(observation.observedAt)],
    ] });
  }
  function showReview(round: Round) {
    const review = round.review;
    if (!review) return;
    setSource({ owner, title: '本轮复盘原记录', paragraphs: [review.observation, review.judgement, review.nextStep], facts: [
      ['保存时间', caseDate(review.createdAt)], ['选择身份', review.choiceId], ['原项目', review.reply.projectId],
      ['原任务', review.reply.taskId], ['原会话', review.reply.sessionId], ['原回复', review.reply.messageId],
      ['原回复摘要', review.reply.expectedTextSha256], ['保存回执', review.operationId],
    ] });
  }
  const returnCurrent = () => { setHistorical(undefined); setSource(undefined); onReturnCurrent(); };
  return <section className="daily-case-tab-page daily-case-history" aria-label="历史与轮次">
    <header className="daily-history-heading"><div><h2>历史与轮次</h2><p>原取舍、行动、观察和复盘按轮次保留。</p></div>
      {issues.length > 0 && <label>事项<select value={issue?.id ?? ''} onChange={event => onSelectIssue(event.target.value)} aria-label="历史事项">
        {!issue && <option value="">选择事项</option>}{issues.filter(value => value.caseId === caseId).map(value => <option key={value.id} value={value.id}>{value.title}</option>)}
      </select></label>}
    </header>
    {!issues.length ? <p className="daily-history-note">当前 Case 尚无事项历史。浏览现有项目不会自动建立事项。</p> : !issue ? <p className="daily-history-note">请选择需要回看的事项。</p> : error ? <div role="alert" className="daily-history-note"><p>{error}</p><button type="button" className="secondary-button" onClick={() => setRetry(value => value + 1)}>重新读取历史</button></div> : !timeline ? <p role="status">正在读取原事项轮次…</p> : <>
      {loaded?.requestError && <p role="status" className="daily-history-note">{loaded.requestError}</p>}
      {viewedRound ? <>
        <div className="daily-history-banner"><span>正在查看已保存轮次 · 只读</span><button type="button" className="text-button" onClick={returnCurrent}>返回当前工作</button></div>
        <p className="daily-history-meta">{issue.title} ／ 第 {viewedNumber} 轮</p>
        <h3 className="daily-history-round-title">{viewedRound.strategy?.payload.title || '原方案暂不可读取'}</h3>
        <p className="daily-history-meta">{caseDate(viewedRound.choice.occurredAt)} · 保留当时的记录与未知</p>
        <div className="daily-history-details">
          <section><h4>当时的取舍</h4><div><p>{choiceNames[viewedRound.choice.choice]}{viewedRound.choice.reason ? ` · ${viewedRound.choice.reason}` : ' · 原理由未记录'}</p><button type="button" className="text-button" onClick={() => showChoice(viewedRound)}>查看当时保存内容 ↗</button></div></section>
          <section><h4>当时的下一步</h4><div><p>{viewedRound.choice.nextStep || '当时未单独记录下一步。'}</p><p className="daily-history-meta">这是人的安排，不代表已经授权或执行行动。</p></div></section><section><h4>授权与行动</h4><div>{viewedRound.actions.length ? viewedRound.actions.map(action => <div key={`${action.projectId}/${action.taskId}`}><p>{action.title}</p>{action.authorizations.map(value => <p key={value.id} className="daily-history-meta">{caseDate(value.time)} · {value.decision === 'authorize' ? '授权' : value.decision} · {value.scope}</p>)}<button type="button" className="text-button" onClick={() => showAction(viewedRound, action)}>查看这条授权记录 ↗</button></div>) : <p>{viewedRound.historyLimited ? '原行动记录部分不可读取。' : '本轮没有可读的授权行动记录。'}</p>}</div></section>
          <section><h4>实际观察</h4><div>{viewedRound.actions.some(action => action.feedback.length) ? viewedRound.actions.flatMap(action => action.feedback.map(observation => <div key={`${action.taskId}/${observation.revisionId}`}><p>{observation.outcome || '原观察结果未填写。'}</p><p className="daily-history-meta">{observation.observationDate ? `观察日期：${observation.observationDate}` : '观察日期未记录'} · 回录于 {caseDate(observation.observedAt)}</p>{observation.sourceScope && <p className="daily-history-meta">来源与范围：{observation.sourceScope}</p>}<button type="button" className="text-button" onClick={() => showObservation(viewedRound, action, observation)}>查看反馈原记录 ↗</button></div>)) : <p>{viewedRound.actions.some(action => action.observationTimeLimited || action.quotedFeedbackLimited) ? '部分原观察暂不可核对。' : '本轮尚无准确关联的原观察。'}</p>}</div></section>
          <section><h4>本轮复盘</h4><div>{viewedRound.review ? <><p>{viewedRound.review.judgement}</p><p>{viewedRound.review.nextStep}</p><button type="button" className="text-button" onClick={() => showReview(viewedRound)}>查看本轮复盘原记录 ↗</button></> : <p>{viewedRound.reviewSaved || viewedRound.reviewObservationLimited ? '复盘已经保存，原依据暂不可读取。' : '本轮尚未保存复盘。'}</p>}</div></section>
        </div>
        <p className="daily-history-note">本轮内容仅供回看。返回当前工作后，原事项中的草稿仍会保留。</p>
        <button type="button" className="primary-button" onClick={returnCurrent}>返回当前轮 →</button>
        <button type="button" className="text-button" onClick={() => setHistorical(undefined)}>回到轮次列表</button>
      </> : <>
        <p className="daily-history-lead">当前查看「{issue.title}」。历史轮次只读，可返回当前工作继续。</p>
        <div className="daily-history-list">
          <article className="daily-history-row current"><span className="daily-history-meta">{progress.roundLabel} · 当前轮</span><h3>{progress.phase}</h3><p>{progress.pendingChoiceRequest?.text || timeline.rounds.at(-1)?.choice.reason || '本事项尚无已保存的取舍理由。'}</p><button type="button" className="text-button" onClick={returnCurrent}>回到当前轮继续 →</button></article>
          {[...timeline.rounds].reverse().map((round, index) => <article className="daily-history-row" key={round.choice.choiceId}>
            <span className="daily-history-meta">第 {timeline.rounds.length - index} 轮 · {caseDate(round.choice.occurredAt)} · 已保存</span><h3>取舍：{choiceNames[round.choice.choice]}</h3><p>{round.choice.reason || '原理由未记录。'}</p>
            <button type="button" className="text-button" onClick={() => showChoice(round)}>查看当时保存内容 ↗</button>
            <button type="button" className="text-button" onClick={() => { setSource(undefined); setHistorical({ owner, choiceId: round.choice.choiceId }); }}>查看该轮完整记录 →</button>
            {round.actions.flatMap(action => action.feedback.map(observation => <div className="daily-history-observation" key={`${action.taskId}/${observation.revisionId}`}><span className="daily-history-meta">{observation.observationDate ? `观察日期：${observation.observationDate}` : '观察日期未记录'} · 回录于 {caseDate(observation.observedAt)}</span><h4>实际观察</h4><p>{observation.outcome || '原观察结果未填写。'}</p>{observation.sourceScope && <p className="daily-history-meta">来源与范围：{observation.sourceScope}</p>}<button type="button" className="text-button" onClick={() => showObservation(round, action, observation)}>查看反馈原记录 ↗</button></div>))}
            {(round.historyLimited || round.reviewObservationLimited || round.actions.some(action => action.quotedFeedbackLimited || action.observationTimeLimited)) && <p className="daily-history-meta">部分原记录暂不可读取，保留该轮身份。</p>}
          </article>)}
        </div>
        <p className="daily-history-note">查看历史不覆盖当前轮；后续保存不会改写上一轮的原取舍。</p>
      </>}
    </>}
    {children && !error && <details className="daily-history-legacy"><summary>其他 Case 记录与管理历史</summary>{children}</details>}
    {source?.owner === owner && loaded && <CaseDialog title={source.title} subtitle={issue?.title} onClose={() => setSource(undefined)}>
      <div className="daily-history-source">{source.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}<dl>{source.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>
    </CaseDialog>}
  </section>;
}
