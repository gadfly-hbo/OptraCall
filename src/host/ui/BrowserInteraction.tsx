import { useEffect, useRef, useState, type Ref } from 'react';
import type { BrowserUIRequest, BrowserUIResponse } from './project-types.ts';

export function BrowserInteraction({ request, onAnswer, onLater, onStop, onRestoreFocus }: { request: BrowserUIRequest; onAnswer: (response: BrowserUIResponse) => Promise<void>; onLater: () => void; onStop: () => Promise<void>; onRestoreFocus: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), firstInput = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [value, setValue] = useState(request.prefill ?? ''), [selection, setSelection] = useState('');
  const [working, setWorking] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.current?.open) dialog.current?.showModal();
    requestAnimationFrame(() => { if (firstInput.current) firstInput.current.focus(); else dialog.current?.querySelector<HTMLButtonElement>('[data-initial-focus]')?.focus(); });
    return () => { mounted.current = false; dialog.current?.close(); requestAnimationFrame(() => { if (trigger?.isConnected && trigger !== document.body && !trigger.matches(':disabled')) trigger.focus(); else onRestoreFocus(); }); };
  }, []);
  const perform = async (operation: () => Promise<void>) => {
    if (working) return;
    setWorking(true); setError('');
    try { await operation(); }
    catch { if (mounted.current) setError('回应尚未确认，请检查项目连接后重试。'); }
    finally { if (mounted.current) setWorking(false); }
  };
  const answer = (response: Omit<BrowserUIResponse, 'id'>) => perform(() => onAnswer({ id: request.id, ...response }));
  const titleId = 'pi-interaction-title', descriptionId = 'pi-interaction-description';
  return <dialog ref={dialog} className="catalog-dialog pi-interaction" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={working} onCancel={event => { event.preventDefault(); if (!working) void answer({ cancelled: true }); }}>
    <p className="eyebrow">Pi 等待你的回应</p>
    <h2 id={titleId}>{request.title}</h2>
    <p id={descriptionId} className="detail-summary">{request.message || (request.method === 'select' ? '请选择一项，Pi 会根据你的回应继续。' : request.method === 'confirm' ? '请确认是否继续。' : '输入内容后，Pi 会继续当前任务。')}</p>
    <form onSubmit={event => { event.preventDefault(); if (!working) void answer({ value: request.method === 'select' ? selection : value }); }}>
      {request.method === 'select' && <fieldset className="pi-choice-list" disabled={working}><legend className="sr-only">{request.title}</legend>{(request.options ?? []).map((option, index) => <label key={`${index}:${option}`}><input ref={index === 0 ? firstInput as Ref<HTMLInputElement> : undefined} type="radio" name="pi-choice" value={option} checked={selection === option} onChange={() => setSelection(option)} required /><span>{option}</span></label>)}</fieldset>}
      {request.method === 'input' && <div className="field"><label htmlFor="pi-interaction-value">回应内容</label><input ref={firstInput as Ref<HTMLInputElement>} id="pi-interaction-value" value={value} placeholder={request.placeholder} disabled={working} onChange={event => setValue(event.target.value)} /></div>}
      {request.method === 'editor' && <div className="field"><label htmlFor="pi-interaction-value">编辑内容</label><textarea ref={firstInput as Ref<HTMLTextAreaElement>} id="pi-interaction-value" value={value} rows={8} disabled={working} onChange={event => setValue(event.target.value)} /></div>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="pi-interaction-actions">
        {request.method === 'confirm' ? <><button className="secondary-button" type="button" disabled={working} onClick={() => { void answer({ value: false }); }}>不继续</button><button data-initial-focus className="primary-button" type="button" disabled={working} onClick={() => { void answer({ value: true }); }}>{working ? '正在回应…' : '确认继续'}</button></> : <><button className="secondary-button" type="button" disabled={working} onClick={() => { void answer({ cancelled: true }); }}>取消回应</button><button className="primary-button" type="submit" disabled={working || (request.method === 'select' && !selection)}>{working ? '正在回应…' : '提交回应'}</button></>}
      </div>
    </form>
    <div className="pi-interaction-secondary"><button className="text-button" type="button" disabled={working} onClick={onLater}>稍后回应</button><button className="text-button" type="button" disabled={working} onClick={() => { void perform(onStop); }}>停止当前任务</button></div>
    <p className="detail-footer">你的回应只交给当前项目的 Pi 扩展，不会新建对话或重新发送任务。</p>
  </dialog>;
}
