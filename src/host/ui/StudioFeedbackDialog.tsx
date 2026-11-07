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
  const [title, setTitle] = useState(''), [problem, setProblem] = useState(''), [working, setWorking] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [pending, setPending] = useState<{ requestId: string; systemId: string }>(), [savedSystemId, setSavedSystemId] = useState(''), [discard, setDiscard] = useState(false);
  const mounted = useRef(true), trigger = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const exact = Boolean(message.nativeEntryId && message.nativeSessionId), dirty = Boolean((title.trim() || problem.trim()) && !savedSystemId);
  useEffect(() => { const controller = new AbortController(); mounted.current = true;
    void listStudioSystems(controller.signal).then(values => { if (!controller.signal.aborted) { setSystems(values); if (initialSystemId && !values.some(item => item.id === initialSystemId)) { setSystemId(''); setNotice('原关联体系当前未能在可读目录核对，请明确选择；原回复保持。'); } } }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '体系目录暂不可读。'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { mounted.current = false; controller.abort(); };
  }, [initialSystemId]);
  const close = () => { if (working) return; if (pending) { setError('反馈保存结果仍为UNKNOWN，请先核对原请求。输入与原回复保持。'); return; } if (dirty && !discard) { setDiscard(true); return; } onClose(); };
  const save = async () => {
    if (!exact || !systemId || working || pending) return;
    if (!title.trim() || !problem.trim()) { setError('请填写反馈主题与问题依据。'); return; }
    const requestId = crypto.randomUUID(), targetSystemId = systemId;
    setWorking(true); setError(''); setNotice('');
    try {
      const value = await writeStudioSystem(targetSystemId, 'feedback', { requestId, title: title.trim(), problem: problem.trim(), origin: { projectId: project.id, taskId: task.id, sessionId: message.nativeSessionId, messageId: message.nativeEntryId } });
      if (mounted.current) { setSavedSystemId(value.id); setNotice('反馈已保存并关联原回复。原报告与准确引用保持；接手、源问题核查、修订和再次使用仍分别记实。'); }
    } catch (error) { if (mounted.current) { if (error instanceof StudioRequestError && error.uncertain) setPending({ requestId, systemId: targetSystemId }); setError(error instanceof Error ? error.message : '反馈保存未完成。'); } }
    finally { if (mounted.current) setWorking(false); }
  };
  const inspect = async () => {
    if (!pending || working) return; setWorking(true); setError('');
    try { const value = await readStudioOperation(pending.requestId); if (!mounted.current) return;
      if (value.status === 'unknown') { setNotice('原反馈请求仍UNKNOWN，未重放，也未启动建设会话。'); return; }
      if (value.status === 'succeeded' && value.systemId !== pending.systemId) { setError('原保存回执的体系归属尚未核定，保持原请求和输入。'); return; }
      setPending(undefined);
      if (value.status === 'succeeded') { setSavedSystemId(pending.systemId); setNotice('已核原反馈保存成功，未重新写入，也未自动开始修订。'); }
      else setError(value.error || '原反馈请求已核失败，输入保持，可修正后明确保存。');
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : '原请求尚未核定。'); }
    finally { if (mounted.current) setWorking(false); }
  };
  return <PersonalDialog drawer title="反馈到原资产体系" subtitle="先定位本次使用问题，源资产缺陷或长期缺口再回原体系。" busy={working} returnFocus={trigger.current} onClose={close} footer={<><button type="button" className="secondary-button" disabled={working || Boolean(pending)} onClick={close}>返回原分析</button>{savedSystemId ? <button type="button" className="primary-button" onClick={() => onOpenSystem(savedSystemId)}>查看原体系反馈</button> : <button type="submit" form="studio-native-feedback" className="primary-button" disabled={working || loading || Boolean(pending) || !exact || !systemId}>保存反馈关联</button>}</>}>
    <form id="studio-native-feedback" onSubmit={event => { event.preventDefault(); void save(); }}>
      {error && <div className="studio-note is-error" role="alert">{error}</div>}{notice && <div className="studio-note" role="status">{notice}</div>}
      {!exact && <div className="studio-note is-warning">这条回复尚无已核定的持久原生身份。请等待保存并重读原回复；不提交替代正文或伪造来源。</div>}
      {loading && <p role="status">正在读取有权访问的体系目录…</p>}
      <label className="studio-field" htmlFor="studio-feedback-target"><span>接收反馈的原体系</span><select id="studio-feedback-target" value={systemId} disabled={working || Boolean(pending) || Boolean(savedSystemId)} required onChange={event => setSystemId(event.target.value)}><option value="">请选择明确体系</option>{systems.map(system => <option key={system.id} value={system.id}>{system.name}</option>)}</select></label>
      <label className="studio-field" htmlFor="studio-native-feedback-title"><span>反馈主题</span><input id="studio-native-feedback-title" required maxLength={200} value={title} disabled={working || Boolean(pending) || Boolean(savedSystemId)} onChange={event => { setTitle(event.target.value); setDiscard(false); }} /></label>
      <label className="studio-field" htmlFor="studio-native-feedback-problem"><span>问题、证据与当前处理</span><textarea id="studio-native-feedback-problem" required rows={6} value={problem} disabled={working || Boolean(pending) || Boolean(savedSystemId)} onChange={event => { setProblem(event.target.value); setDiscard(false); }} placeholder="说明本次结果哪里需要核查、你提供的新情况或已采取的临时处理…" /></label>
      <dl className="studio-definition"><dt>原分析任务</dt><dd>{project.name} / {task.name}</dd><dt>引用方式</dt><dd>Host 按真实原生会话与消息身份回读准确报告，并关联实际资产版本；浏览器不上传替代报告正文。</dd></dl>
      <div className="studio-note">保存反馈不等于全局确错、停用或已后台修复。主建设 Agent 未运行时保留“已记录，待继续建设”；立即完善仍是后续可选动作。归档建设项目不自动恢复或写入。</div>
      {pending && <div className="studio-note is-warning" role="alert"><strong>反馈保存结果 UNKNOWN</strong><p>原请求 {pending.requestId} 保留；核对前不换体系、不重发。</p><button type="button" className="secondary-button" disabled={working} onClick={() => { void inspect(); }}>核对原反馈保存结果</button></div>}
      {discard && !pending && <div className="studio-note is-warning"><p>有未保存的反馈文字，原分析报告与历史不受影响。</p><div className="studio-actions"><button type="button" className="secondary-button" onClick={() => setDiscard(false)}>继续填写</button><button type="button" className="text-button" onClick={onClose}>明确放弃本次未保存反馈</button></div></div>}
    </form>
  </PersonalDialog>;
}
