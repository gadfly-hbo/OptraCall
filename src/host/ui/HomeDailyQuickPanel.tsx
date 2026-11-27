import { useEffect, useId, useRef, useState } from 'react';
import type { HomePendingProjection } from '../home-pending.ts';
import type { CaseDirectoryEntry } from '../case-directory.ts';
import type { PrepareDraftPayload, WorkspaceDraftRecord } from '../workspace-draft-store.ts';
import type { ThreeBranchCreateResult } from '../case-creation-orchestrator.ts';
import {
  createCaseThreeBranch,
  discardWorkspaceDraft,
  listWorkspaceDrafts,
  readCaseDirectory,
  readHomePending,
  saveWorkspaceDraft,
} from './workspace-daily-client.ts';
import { BusinessRoleConversation } from './BusinessRoleConversation.tsx';
import { caseError } from './CaseDialogs.tsx';

type GoalSummary = { goalId: string; version: number; title: string; status: string; strategies: string[] };

type Props = {
  refreshToken?: number;
  onOpenCase: (caseId: string, issueId?: string) => void;
  onCreateCase: () => void;
  onOpenAllProjects: () => void;
};

/**
 * Daily workspace home panel (DW08–DW14 / FR04 / FR06):
 * - Explicit requests ("待处理事项", never "待你确认") + visible unresolvedRequests ("已替代 / 待核请求"),
 *   separate from externalWaiting and pendingOperations ("原操作待核").
 * - Auto-persisted light input (survives navigation/reload without clicking save).
 * - Optional user-triggered `{role:'goal-draft', draftId, scope}` Agent panel (manual path works without any model).
 * - Explicit target issue picker when carrying over a fragment (never silently forces issues[0]).
 * - Unified three-branch Case creation & partial-success recovery wired to POST /api/workspace/create-case.
 */
export function HomeDailyQuickPanel({ refreshToken = 0, onOpenCase, onCreateCase, onOpenAllProjects }: Props) {
  const [projection, setProjection] = useState<HomePendingProjection | null>(null);
  const [loadError, setLoadError] = useState('');
  const [draftId, setDraftId] = useState('home-prepare-default');
  const [draftRev, setDraftRev] = useState(0);
  const [rawInput, setRawInput] = useState('');
  const [savedDrafts, setSavedDrafts] = useState<WorkspaceDraftRecord<PrepareDraftPayload>[]>([]);
  const [matches, setMatches] = useState<CaseDirectoryEntry[] | null>(null);
  const [selectedIssues, setSelectedIssues] = useState<Record<string, string>>({});
  const [searching, setSearching] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentDraftId] = useState(() => crypto.randomUUID());
  const [prepOpen, setPrepOpen] = useState(false);
  const [goals, setGoals] = useState<GoalSummary[]>([]);
  const [prepTitle, setPrepTitle] = useState('');
  const [prepDesc, setPrepDesc] = useState('');
  const [selectedGoalKey, setSelectedGoalKey] = useState('');
  const [selectedStrategy, setSelectedStrategy] = useState('');
  const [createResult, setCreateResult] = useState<ThreeBranchCreateResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const inputId = useId();
  const dirtyRef = useRef(false);
  const latestInputRef = useRef('');
  latestInputRef.current = rawInput;

  useEffect(() => {
    let alive = true;
    setLoadError('');
    void readHomePending().then(
      data => { if (alive) setProjection(data); },
      err => { if (alive) setLoadError(caseError(err)); },
    );
    void listWorkspaceDrafts<PrepareDraftPayload>('prepare').then(
      ({ drafts }) => {
        if (!alive) return;
        setSavedDrafts(drafts);
        const latest = drafts.find(d => d.id === 'home-prepare-default') ?? drafts[0];
        if (latest) {
          setDraftId(latest.id);
          setDraftRev(latest.revision);
          setRawInput(latest.payload.rawInput ?? '');
          setPrepTitle(latest.payload.title ?? '');
          setPrepDesc(latest.payload.description ?? '');
          if (latest.payload.selectedGoal) {
            setSelectedGoalKey(`${latest.payload.selectedGoal.goalId}@${latest.payload.selectedGoal.version}`);
            setSelectedStrategy(latest.payload.selectedGoal.strategy);
          }
        }
      },
      () => {},
    );
    return () => { alive = false; };
  }, [refreshToken]);

  async function loadGoals() {
    try {
      const res = await fetch('/api/strategy/goals', { headers: { 'x-optracall-client': '1' } });
      if (!res.ok) return;
      const body = await res.json() as { goals?: { id: string; versions: { goalId: string; version: number; title: string; status: string; strategies?: string[] }[] }[] };
      const flat: GoalSummary[] = [];
      for (const g of body.goals ?? []) {
        const v = g.versions.at(-1);
        if (v) flat.push({ goalId: v.goalId, version: v.version, title: v.title, status: v.status, strategies: v.strategies ?? [] });
      }
      setGoals(flat);
    } catch { /* manual fallback */ }
  }

  async function persistPrepareDraft(nextText: string, extra?: Partial<PrepareDraftPayload>) {
    try {
      const prev = savedDrafts.find(d => d.id === draftId)?.payload;
      const res = await saveWorkspaceDraft<PrepareDraftPayload>('prepare', draftId, draftRev, {
        rawInput: nextText,
        title: extra?.title ?? (prepTitle || prev?.title || nextText.slice(0, 60)),
        description: extra?.description ?? (prepDesc || nextText),
        selectedGoal: extra?.selectedGoal !== undefined ? extra.selectedGoal : (prev?.selectedGoal ?? null),
        adoptOperationId: prev?.adoptOperationId ?? crypto.randomUUID(),
        createOperationId: prev?.createOperationId ?? crypto.randomUUID(),
        adoptionReceipt: prev?.adoptionReceipt ?? null,
        creationReceipt: prev?.creationReceipt ?? null,
        creationState: prev?.creationState ?? 'idle',
        targetLocation: prev?.targetLocation ?? null,
      });
      setDraftRev(res.draft.revision);
      setSavedDrafts(old => [res.draft, ...old.filter(d => d.id !== res.draft.id)]);
      dirtyRef.current = false;
      setError('');
      return res.draft;
    } catch (e) {
      setError(caseError(e));
      return null;
    }
  }

  // Auto-persist light input (debounced 400ms) so navigation/reload never loses text
  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = setTimeout(() => { void persistPrepareDraft(latestInputRef.current); }, 400);
    return () => clearTimeout(timer);
  }, [rawInput]);

  async function flushBeforeNav(action: () => void) {
    if (dirtyRef.current && latestInputRef.current.trim()) {
      await persistPrepareDraft(latestInputRef.current);
    }
    action();
  }

  async function organizeAndFind() {
    if (!rawInput.trim()) { setError('先写下一句话或背景，再整理与查找。'); return; }
    setSearching(true); setError(''); setNotice('');
    try {
      await persistPrepareDraft(rawInput);
      // Fetch visible directory (unfiltered bounded list so natural-language sentences still see real Cases)
      const dir = await readCaseDirectory(undefined, 20);
      setMatches(dir.items);
      if (!dir.items.length) setNotice('当前获准 Case 中暂无匹配项，可直接人工准备新 Case 或点击“请 Agent 整理与推荐”。');
    } catch (e) {
      setError(caseError(e));
    } finally {
      setSearching(false);
    }
  }

  async function carryToCase(entry: CaseDirectoryEntry) {
    const chosenIssueId = selectedIssues[entry.caseId] ?? '';
    if (entry.issues.length > 0 && !chosenIssueId) {
      setError(`请先为「${entry.title}」明确选择一个目标事项，再带入片段。`);
      return;
    }
    try {
      await persistPrepareDraft(rawInput);
      const fragId = `frag-${crypto.randomUUID()}`;
      await saveWorkspaceDraft('carry-over', fragId, 0, {
        originalText: rawInput.trim(),
        origin: { kind: 'home-input', label: '工作台首页轻输入', ref: draftId },
        targetCaseId: entry.caseId,
        targetIssueId: chosenIssueId || null,
        appendedAt: null,
      });
      setNotice(`已保留待带入片段，正在打开「${entry.title}」（不会自动覆盖既有草稿或发送）。`);
      onOpenCase(entry.caseId, chosenIssueId || undefined);
    } catch (e) {
      setError(caseError(e));
    }
  }

  async function runThreeBranchCreate(resumeDraft?: WorkspaceDraftRecord<PrepareDraftPayload>) {
    const targetDraft = resumeDraft ?? savedDrafts.find(d => d.id === draftId);
    const goalFromKey = goals.find(g => `${g.goalId}@${g.version}` === selectedGoalKey);
    const goalId = resumeDraft?.payload.adoptionReceipt?.goalId ?? resumeDraft?.payload.selectedGoal?.goalId ?? goalFromKey?.goalId;
    const version = resumeDraft?.payload.adoptionReceipt?.version ?? resumeDraft?.payload.selectedGoal?.version ?? goalFromKey?.version;
    const strategy = resumeDraft?.payload.adoptionReceipt?.strategy ?? resumeDraft?.payload.selectedGoal?.strategy ?? selectedStrategy;
    const title = (resumeDraft?.payload.title || prepTitle || rawInput.slice(0, 60)).trim();
    const description = resumeDraft?.payload.description || prepDesc || rawInput;
    if (!goalId || !version || !strategy || !title) {
      setError('请填写 Case 名称，并选择准确的目标版本与具体策略。');
      return;
    }
    setCreating(true); setError(''); setNotice('');
    try {
      const res = await createCaseThreeBranch({
        draftId: resumeDraft?.id ?? draftId,
        title,
        description,
        rawInput: resumeDraft?.payload.rawInput ?? rawInput,
        adoptOperationId: targetDraft?.payload.adoptOperationId ?? crypto.randomUUID(),
        createOperationId: targetDraft?.payload.createOperationId ?? crypto.randomUUID(),
        goal: {
          goalId, version, strategy,
          alreadyAdopted: Boolean(resumeDraft?.payload.adoptionReceipt) || goalFromKey?.status === 'adopted',
        },
      });
      setCreateResult(res);
      if (res.branch === 'created') {
        setNotice(`Case「${res.createdCase.title}」已创建${res.replayedFromOperation ? '（已核对原操作回执）' : ''}。`);
      } else if (res.branch === 'continue') {
        setNotice(res.isClosed
          ? `该准确 G/S 已有已结束 Case「${res.existingCase.title}」，未自动重开；新名称与输入已保留在草稿中。`
          : `该准确 G/S 已有 Case「${res.existingCase.title}」，新名称与输入已保留，可明确继续。`);
      } else {
        setNotice('目标采纳回执已保留，但 Case 创建未完成；可核对原操作后继续创建，不会重复采纳。');
      }
      const latest = await listWorkspaceDrafts<PrepareDraftPayload>('prepare');
      setSavedDrafts(latest.drafts);
    } catch (e) {
      setError(caseError(e));
    } finally {
      setCreating(false);
    }
  }

  async function discardCurrentDraft() {
    try {
      await discardWorkspaceDraft('prepare', draftId);
      setRawInput('');
      setPrepTitle('');
      setPrepDesc('');
      setDraftRev(0);
      dirtyRef.current = false;
      setMatches(null);
      setCreateResult(null);
      setSavedDrafts(old => old.filter(d => d.id !== draftId));
      setNotice('已放弃此准备草稿；已保存的目标与 Case 均保留。');
    } catch (e) {
      setError(caseError(e));
    }
  }

  const activeGoal = goals.find(g => `${g.goalId}@${g.version}` === selectedGoalKey);
  const partialDrafts = savedDrafts.filter(d => d.payload.creationState === 'partial_failed' || d.payload.creationState === 'partial_unknown');

  return <section className="home-daily-panel" aria-label="Decision Case 日常工作台">
    <div className="home-daily-quick-input" role="region" aria-label="轻输入与准备">
      <div className="home-daily-row">
        <label htmlFor={inputId}><strong>先记下一句话、找归属或准备新 Case</strong></label>
        <div className="home-daily-actions">
          <button type="button" className="text-button" onClick={() => { void flushBeforeNav(onOpenAllProjects); }}>全部项目</button>
          <button type="button" className="secondary-button" onClick={() => {
            const next = !prepOpen;
            setPrepOpen(next);
            if (next) {
              if (!prepTitle && rawInput.trim()) setPrepTitle(rawInput.trim().slice(0, 60));
              if (!prepDesc && rawInput.trim()) setPrepDesc(rawInput.trim());
              void loadGoals();
            }
          }}>{prepOpen ? '收起统一准备' : '准备新 Case'}</button>
          <button type="button" className="text-button" onClick={() => { void flushBeforeNav(onCreateCase); }}>打开原建案表单</button>
        </div>
      </div>
      <textarea
        id={inputId}
        rows={2}
        value={rawInput}
        onChange={e => { dirtyRef.current = true; setRawInput(e.target.value); }}
        onBlur={() => { if (dirtyRef.current && rawInput.trim()) void persistPrepareDraft(rawInput); }}
        placeholder="例如：华东三家门店首周复购波动，想核对是否继续扩围…"
      />
      <div className="home-daily-actions">
        <button type="button" className="primary-button" disabled={searching || !rawInput.trim()} onClick={() => { void organizeAndFind(); }}>{searching ? '正在查找获准 Case…' : '查找获准 Case'}</button>
        <button type="button" className="secondary-button" onClick={() => { void persistPrepareDraft(rawInput); setAgentOpen(v => !v); }}>{agentOpen ? '收起整理 Agent' : '请 Agent 整理与推荐（可选）'}</button>
        <button type="button" className="secondary-button" disabled={!rawInput.trim()} onClick={() => { void persistPrepareDraft(rawInput).then(d => { if (d) setNotice('输入已持久保存。'); }); }}>保存草稿</button>
        {(rawInput || draftRev > 0) && <button type="button" className="text-button" onClick={() => { void discardCurrentDraft(); }}>放弃草稿</button>}
      </div>
      {notice && <p className="case-notice" role="status">{notice}</p>}
      {error && <p className="case-error" role="alert">{error}</p>}

      {agentOpen && <div className="home-daily-agent-box" role="region" aria-label="创建前整理 Agent">
        <p className="case-help">使用 `{`role:'goal-draft'`}` 独立草稿会话；可读取获准 Case 目录给出有依据的建议，不自动建案或采纳目标。</p>
        <BusinessRoleConversation
          owner={{ role: 'goal-draft', draftId: agentDraftId, scope: { kind: 'personal', id: 'home-prepare', name: '日常准备' } }}
          openingPrompt={rawInput}
          showInlineTitle={false}
        />
      </div>}

      {prepOpen && <div className="home-daily-prepare-box" role="region" aria-label="三分支 Case 准备">
        <label>Case 名称<input type="text" value={prepTitle} onChange={e => setPrepTitle(e.target.value)} maxLength={80} placeholder="输入 Case 标题" /></label>
        <label>问题背景<textarea rows={2} value={prepDesc} onChange={e => setPrepDesc(e.target.value)} placeholder="补充背景（已有 Case 时会保留）" /></label>
        <label>准确目标版本
          <select value={selectedGoalKey} onChange={e => { setSelectedGoalKey(e.target.value); setSelectedStrategy(''); }}>
            <option value="">请选择目标版本</option>
            {goals.map(g => <option key={`${g.goalId}@${g.version}`} value={`${g.goalId}@${g.version}`}>{g.title}（v{g.version} · {g.status === 'adopted' ? '已采纳' : '候选'}）</option>)}
          </select>
        </label>
        {activeGoal && <label>该版具体策略
          <select value={selectedStrategy} onChange={e => setSelectedStrategy(e.target.value)}>
            <option value="">请选择具体策略</option>
            {activeGoal.strategies.map(st => <option key={st} value={st}>{st}</option>)}
          </select>
        </label>}
        <div className="home-daily-actions">
          <button type="button" className="primary-button" disabled={creating || !selectedGoalKey || !selectedStrategy || !prepTitle.trim()} onClick={() => { void runThreeBranchCreate(); }}>
            {creating ? '正在提交…' : activeGoal?.status === 'adopted' ? '创建或继续 Case' : '明确采纳此 G/S 并创建 Case'}
          </button>
        </div>
        {createResult?.branch === 'continue' && <div className="case-message" role="status">
          <p>{createResult.isClosed ? '原 Case 已结束，未自动重开；新名称与输入已保留。' : '该准确 G/S 已有 Case，新名称与输入已保留。'}</p>
          <button type="button" className="secondary-button" onClick={() => onOpenCase(createResult.existingCase.id)}>打开原 Case「{createResult.existingCase.title}」</button>
        </div>}
        {createResult?.branch === 'created' && <div className="case-message" role="status">
          <button type="button" className="secondary-button" onClick={() => onOpenCase(createResult.createdCase.id)}>进入已创建 Case「{createResult.createdCase.title}」</button>
        </div>}
      </div>}

      {matches && <div className="home-daily-matches" aria-label="获准 Case 候选">
        {matches.length === 0 ? <p className="case-help">无匹配 Case，可点击“准备新 Case”继续。</p> : matches.map(entry => (
          <div key={entry.caseId} className="home-daily-match-row">
            <div>
              <strong>{entry.title}</strong>
              {entry.issues.length > 0 ? (
                <label className="case-help"> 目标事项：
                  <select aria-label={`选择 ${entry.title} 的目标事项`} value={selectedIssues[entry.caseId] ?? ''} onChange={e => setSelectedIssues(old => ({ ...old, [entry.caseId]: e.target.value }))}>
                    <option value="">请选择目标事项</option>
                    {entry.issues.map(i => <option key={i.issueId} value={i.issueId}>{i.title}</option>)}
                  </select>
                </label>
              ) : <p className="case-help">暂无独立事项（进入后可建立事项）</p>}
            </div>
            <div className="home-daily-actions">
              <button type="button" className="secondary-button" onClick={() => { void carryToCase(entry); }}>带入所选事项</button>
              <button type="button" className="text-button" onClick={() => { void flushBeforeNav(() => onOpenCase(entry.caseId, selectedIssues[entry.caseId] || undefined)); }}>直接继续</button>
            </div>
          </div>
        ))}
      </div>}

      {partialDrafts.map(draft => (
        <div key={draft.id} className="case-pending-operations" role="status">
          <strong>有未完成的 Case 创建草稿：{draft.payload.title || draft.id}</strong>
          <p className="case-help">已采纳目标 {draft.payload.adoptionReceipt?.goalId ?? draft.payload.selectedGoal?.goalId}@v{draft.payload.adoptionReceipt?.version ?? draft.payload.selectedGoal?.version} 保留；重试会先核原操作，不重复采纳。</p>
          <div className="home-daily-actions">
            <button type="button" className="secondary-button" disabled={creating} onClick={() => { void runThreeBranchCreate(draft); }}>核对原操作并继续创建</button>
            <button type="button" className="text-button" onClick={() => { void discardWorkspaceDraft('prepare', draft.id).then(() => setSavedDrafts(old => old.filter(d => d.id !== draft.id))); }}>仅放弃草稿（保留已采纳目标）</button>
          </div>
        </div>
      ))}
    </div>

    {loadError && <p className="case-error" role="alert">待处理事项读取失败：{loadError}</p>}

    {projection && <div className="home-daily-grid">
      <div className="home-daily-card" role="region" aria-label={projection.pendingHeading}>
        <h3>{projection.pendingHeading}（{projection.pending.length}）</h3>
        {projection.pending.length === 0 ? (
          <p className="case-help">暂无明确待回应的取舍或观察请求；查看或普通报告不会自动生成待办。</p>
        ) : (
          <ul className="home-daily-list">
            {projection.pending.map(item => (
              <li key={`${item.requestId}@${item.revision}`} className="home-daily-item">
                <div>
                  <span className="case-issue-badge case-issue-badge-req">{item.actionLabel}</span>
                  <strong>{item.caseTitle} · {item.issueTitle}</strong>
                  <p>{item.text}</p>
                  <p className="case-help">承担人：{item.assignee.label}（来源：{item.assignee.source}） · 提出于 {item.requestedAt.slice(0, 16)}{item.dueDate ? ` · 期限 ${item.dueDate}` : ''}</p>
                </div>
                <button type="button" className="secondary-button" onClick={() => { void flushBeforeNav(() => onOpenCase(item.caseId, item.issueId)); }}>前往原事项回应</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {projection.unresolvedRequests.length > 0 && (
        <div className="home-daily-card" role="region" aria-label="已替代或待核请求">
          <h3>已替代 / 待核请求（{projection.unresolvedRequests.length}）</h3>
          <p className="case-help">以下请求因换轮被替代或来源待核，未视为已回应。</p>
          <ul className="home-daily-list">
            {projection.unresolvedRequests.map(item => (
              <li key={`${item.requestId}@${item.revision}`} className="home-daily-item">
                <div>
                  <span className="case-issue-badge">{item.status === 'superseded' ? '已替代' : '待核'}</span>
                  <strong>{item.caseTitle} · {item.issueTitle}</strong>
                  <p>{item.text}</p>
                </div>
                <button type="button" className="text-button" onClick={() => { void flushBeforeNav(() => onOpenCase(item.caseId, item.issueId)); }}>核对原事项</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {projection.externalWaiting.length > 0 && (
        <div className="home-daily-card" role="region" aria-label="外部等待">
          <h3>外部等待（{projection.externalWaiting.length}）</h3>
          <ul className="home-daily-list">
            {projection.externalWaiting.map(w => (
              <li key={w.caseId} className="home-daily-item">
                <div><strong>{w.caseTitle}</strong><p className="case-help">{w.reason}</p></div>
                <button type="button" className="text-button" onClick={() => { void flushBeforeNav(() => onOpenCase(w.caseId, w.issueId ?? undefined)); }}>查看</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {projection.pendingOperations.length > 0 && (
        <div className="home-daily-card" role="region" aria-label="原操作待核">
          <h3>原操作待核（{projection.pendingOperations.length}）</h3>
          <p className="case-help">以下为未确认完成的技术操作，与经营取舍请求分开显示。</p>
          <ul className="home-daily-list">
            {projection.pendingOperations.map(op => (
              <li key={op.operationId} className="home-daily-item">
                <span>{op.kind} · {op.phase}</span>
                {op.caseId && <button type="button" className="text-button" onClick={() => { void flushBeforeNav(() => onOpenCase(op.caseId!)); }}>核对</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>}
  </section>;
}
