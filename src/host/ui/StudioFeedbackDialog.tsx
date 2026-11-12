import { useEffect, useRef, useState } from 'react';
import { PersonalDialog } from './PersonalDialog.tsx';
import type { ClientProject, ClientTask, NativeMessage } from './project-types.ts';
import { listStudioSystems, readStudioOperation, StudioRequestError, writeStudioSystem } from './studio-api.ts';
import type { StudioSystem } from './studio-api.ts';

/** A reply reference is resolved by Host; the browser never supplies replacement report text. */
export function StudioFeedbackDialog({ project, task, message, initialSystemId, onClose, onOpenSystem }: {
  project: ClientProject; task: ClientTask; message: NativeMessage; initialSystemId?: string; onClose: () => void; onOpenSystem: (systemId: string) => void;
}) {
  const [systems, setSystems] = useState<StudioSystem[]>([]), [systemId, setSystemId] = useState(initialSystemId || '');
  const [mode, setMode] = useState<'feedback' | 'contribution'>('feedback'), [candidateKind, setCandidateKind] = useState<'concept' | 'rule' | 'binding' | 'sap-metric' | 'sap-method'>('rule'), [contributionScope, setContributionScope] = useState<'enterprise' | 'task'>('enterprise'), [candidateBody, setCandidateBody] = useState(''), [applicableScope, setApplicableScope] = useState('');
  const [title, setTitle] = useState(''), [problem, setProblem] = useState(''), [working, setWorking] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [pending, setPending] = useState<{ requestId: string; systemId: string; mode: 'feedback' | 'contribution' }>(), [savedSystemId, setSavedSystemId] = useState(''), [discard, setDiscard] = useState(false);
  const mounted = useRef(true), trigger = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const exact = Boolean(message.nativeEntryId && message.nativeSessionId), dirty = Boolean((title.trim() || problem.trim() || candidateBody.trim() || applicableScope.trim()) && !savedSystemId);
  useEffect(() => { const controller = new AbortController(); mounted.current = true;
    void listStudioSystems(controller.signal, project.id).then(values => { if (!controller.signal.aborted) { setSystems(values); if (initialSystemId && !values.some(item => item.id === initialSystemId)) { setSystemId(''); setNotice('原关联体系当前未能在可读目录核对，请明确选择；原回复保持。'); } } }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '体系目录暂不可读。'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { mounted.current = false; controller.abort(); };
  }, [initialSystemId, project.id]);
  const close = () => { if (working) return; if (pending) { setError('反馈保存结果仍为UNKNOWN，请先核对原请求。输入与原回复保持。'); return; } if (dirty && !discard) { setDiscard(true); return; } onClose(); };
  const save = async () => {
    if (!exact || !systemId || working || pending) return;
    if (!title.trim() || !problem.trim()) { setError('请填写主题与问题依据。'); return; }
    if (mode === 'contribution' && (!candidateBody.trim() || !applicableScope.trim())) { setError('请明确候选内容及适用范围；也可以回原分析任务请 Agent 自主整理。'); return; }
    const requestId = crypto.randomUUID(), targetSystemId = systemId;
    setWorking(true); setError(''); setNotice('');
    try {
      const origin = { projectId: project.id, taskId: task.id, sessionId: message.nativeSessionId, messageId: message.nativeEntryId };
      const value = mode === 'contribution'
        ? await writeStudioSystem(targetSystemId, 'contributions', { requestId, origin, scope: contributionScope, baseSystemRevision: systems.find(system => system.id === targetSystemId)?.revision, candidate: { kind: candidateKind, title: title.trim(), body: candidateBody, scope: applicableScope.trim(), reason: problem.trim() } })
        : await writeStudioSystem(targetSystemId, 'feedback', { requestId, title: title.trim(), problem: problem.trim(), origin });
      if (mounted.current) { setSavedSystemId(value.id); setNotice(mode === 'contribution' ? '任务贡献候选已保存并关联准确原回复；未发布、未覆盖基础标准，后续核查与再用另记。' : '反馈已保存并关联原回复。原报告与准确引用保持；接手、源问题核查、修订和再次使用仍分别记实。'); }
    } catch (error) { if (mounted.current) { if (error instanceof StudioRequestError && error.uncertain) setPending({ requestId, systemId: targetSystemId, mode }); setError(error instanceof Error ? error.message : '反馈保存未完成。'); } }
    finally { if (mounted.current) setWorking(false); }
  };
  const inspect = async () => {
    if (!pending || working) return; setWorking(true); setError('');
    try { const value = await readStudioOperation(pending.requestId); if (!mounted.current) return;
      if (value.status === 'unknown') { setNotice('原反馈请求仍UNKNOWN，未重放，也未启动建设会话。'); return; }
      if (value.status === 'succeeded' && value.systemId !== pending.systemId) { setError('原保存回执的体系归属尚未核定，保持原请求和输入。'); return; }
      setPending(undefined);
      if (value.status === 'succeeded') { setSavedSystemId(pending.systemId); setNotice(pending.mode === 'contribution' ? '已核原任务贡献保存成功，未重复保存、未发布或验证解决。' : '已核原反馈保存成功，未重新写入，也未自动开始修订。'); }
      else setError(value.error || '原反馈请求已核失败，输入保持，可修正后明确保存。');
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : '原请求尚未核定。'); }
    finally { if (mounted.current) setWorking(false); }
  };
  return <PersonalDialog drawer title={mode === 'contribution' ? '整理为任务贡献候选' : '反馈到原资产体系'} subtitle="先定位本次使用问题，源资产缺陷或长期缺口再回原体系。" busy={working} returnFocus={trigger.current} onClose={close} footer={<><button type="button" className="secondary-button" disabled={working || Boolean(pending)} onClick={close}>返回原分析</button>{savedSystemId ? <button type="button" className="primary-button" onClick={() => onOpenSystem(savedSystemId)}>{mode === 'contribution' ? '查看任务贡献候选' : '查看原体系反馈'}</button> : <button type="submit" form="studio-native-feedback" className="primary-button" disabled={working || loading || Boolean(pending) || !exact || !systemId}>{mode === 'contribution' ? '保存任务贡献候选' : '保存反馈关联'}</button>}</>}>
    <div className="studio-panel-tabs" aria-label="分析发现的处理方式"><button type="button" aria-pressed={mode === 'feedback'} disabled={working || Boolean(pending) || Boolean(savedSystemId)} onClick={() => setMode('feedback')}>记录问题反馈</button><button type="button" aria-pressed={mode === 'contribution'} disabled={working || Boolean(pending) || Boolean(savedSystemId)} onClick={() => setMode('contribution')}>整理为任务贡献</button></div>
    <form id="studio-native-feedback" onSubmit={event => { event.preventDefault(); void save(); }}>
      {error && <div className="studio-note is-error" role="alert">{error}</div>}{notice && <div className="studio-note" role="status">{notice}</div>}
      {!exact && <div className="studio-note is-warning">这条回复尚无已核定的持久原生身份。请等待保存并重读原回复；不提交替代正文或伪造来源。</div>}
      {loading && <p role="status">正在核对本项目所属企业的可用体系…</p>}
      {!loading && !systems.length && <p className="studio-note is-warning">当前项目尚无可关联的本企业体系。可先在 Studio 核定企业与体系归属；不借用其他企业，也不伪造候选来源。</p>}
      <label className="studio-field" htmlFor="studio-feedback-target"><span>接收本次发现的原体系</span><select id="studio-feedback-target" value={systemId} disabled={working || Boolean(pending) || Boolean(savedSystemId)} required onChange={event => setSystemId(event.target.value)}><option value="">选择本企业的明确体系</option>{systems.map(system => <option key={system.id} value={system.id}>{system.name}</option>)}</select></label>
      <label className="studio-field" htmlFor="studio-native-feedback-title"><span>反馈主题</span><input id="studio-native-feedback-title" required maxLength={200} value={title} disabled={working || Boolean(pending) || Boolean(savedSystemId)} onChange={event => { setTitle(event.target.value); setDiscard(false); }} /></label>
      <label className="studio-field" htmlFor="studio-native-feedback-problem"><span>问题、证据与当前处理</span><textarea id="studio-native-feedback-problem" required rows={6} value={problem} disabled={working || Boolean(pending) || Boolean(savedSystemId)} onChange={event => { setProblem(event.target.value); setDiscard(false); }} placeholder="说明本次结果哪里需要核查、你提供的新情况或已采取的临时处理…" /></label>
      {mode === 'contribution' && <fieldset disabled={working || Boolean(pending) || Boolean(savedSystemId)} className="studio-contribution-fields"><legend>明确本次候选，不修改企业正式标准</legend><label className="studio-field"><span>贡献范围</span><select value={contributionScope} onChange={event => setContributionScope(event.target.value as 'enterprise' | 'task')}><option value="enterprise">企业候选，待核后纳入</option><option value="task">仅本案约定，保留本任务</option></select></label><label className="studio-field"><span>候选类别</span><select value={candidateKind} onChange={event => setCandidateKind(event.target.value as typeof candidateKind)}><option value="rule">业务规则</option><option value="concept">语义与主数据</option><option value="binding">数据映射</option><option value="sap-metric">SAP 指标</option><option value="sap-method">分析方法</option></select></label><label className="studio-field"><span>候选内容</span><textarea rows={6} value={candidateBody} onChange={event => setCandidateBody(event.target.value)} placeholder="明确希望补充或修订的内容；仍需按准确依据核对。" /></label><label className="studio-field"><span>适用范围与限制</span><textarea rows={2} value={applicableScope} onChange={event => setApplicableScope(event.target.value)} placeholder="说明适用对象、时间和本案限制；未知不要补成企业标准。" /></label><p className="studio-meta">这是可选人工补充；普通分析仍由 Agent 自主选择工具并整理贡献。原报告与实际读取依据由 Host 按真实会话和消息身份回读，不由此表补造已读或已采用。</p></fieldset>}
      <dl className="studio-definition"><dt>原分析任务</dt><dd>{project.name} / {task.name}</dd><dt>引用方式</dt><dd>Host 按真实原生会话与消息身份回读准确报告，并关联实际资产版本；浏览器不上传替代报告正文。</dd></dl>
      <div className="studio-note">保存反馈不等于全局确错、停用或已后台修复。主建设 Agent 未运行时保留“已记录，待继续建设”；立即完善仍是后续可选动作。归档建设项目不自动恢复或写入。</div>
      {pending && <div className="studio-note is-warning" role="alert"><strong>反馈保存结果 UNKNOWN</strong><p>原请求 {pending.requestId} 保留；核对前不换体系、不重发。</p><button type="button" className="secondary-button" disabled={working} onClick={() => { void inspect(); }}>核对原反馈保存结果</button></div>}
      {discard && !pending && <div className="studio-note is-warning"><p>有未保存的反馈文字，原分析报告与历史不受影响。</p><div className="studio-actions"><button type="button" className="secondary-button" onClick={() => setDiscard(false)}>继续填写</button><button type="button" className="text-button" onClick={onClose}>明确放弃本次未保存反馈</button></div></div>}
    </form>
  </PersonalDialog>;
}
