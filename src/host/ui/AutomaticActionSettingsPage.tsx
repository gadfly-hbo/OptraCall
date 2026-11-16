import { useCallback, useEffect, useRef, useState } from 'react';
import type { AutomaticActionNodes, AutomaticActionSettings, AutomaticActionSettingsUpdate, AutomaticActionNode } from '../automatic-action-settings-types.ts';
import { automaticActionNodes } from '../automatic-action-settings-types.ts';
import { AutomaticActionSettings as SettingsForm, AutomaticActionSwitch } from './AutomaticActionSettings.tsx';
import { readAutomaticActions, readAutomaticActionOperation, updateAutomaticActions, AutomaticActionRequestError } from './automatic-actions-client.ts';
const intentKey = 'optracall.global-automatic-settings.pending.v1';
function pendingIntent(): AutomaticActionSettingsUpdate | undefined {
  const raw = sessionStorage.getItem(intentKey); if (!raw) return;
  const stored = JSON.parse(raw), input = stored?.input;
  if (stored.version !== 1 || !input || Object.keys(input).sort().join(',') !== 'expectedRevision,nodes,operationId' || typeof input.operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.operationId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !input.nodes || Object.keys(input.nodes).length !== 5 || automaticActionNodes.some(node => typeof input.nodes[node] !== 'boolean')) throw new Error('原设置操作记录不可核对，已保留；请勿覆盖。');
  return input;
}
async function fingerprint(input: AutomaticActionSettingsUpdate) {
  const bytes = new TextEncoder().encode(JSON.stringify([input.expectedRevision, ...automaticActionNodes.map(node => input.nodes[node])]));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}
function useSettings(active = true) {
  const [value, setValue] = useState<AutomaticActionSettings | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [pending, setPending] = useState<AutomaticActionSettingsUpdate>();
  const mounted = useRef(true), serial = useRef(0), intent = useRef<AutomaticActionSettingsUpdate | undefined>(undefined);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; serial.current++; }; }, []);
  const refresh = useCallback(async () => {
    const n = ++serial.current;
    try {
      const original = pendingIntent(); intent.current = original;
      const [next, receipt] = await Promise.all([readAutomaticActions(), original ? readAutomaticActionOperation(original.operationId) : Promise.resolve(undefined)]);
      if (!mounted.current || n !== serial.current) return;
      setValue(next); setPending(original);
      if (!original) { setError(''); return; }
      if (receipt?.operation) {
        if (receipt.operation.fingerprint !== await fingerprint(original)) throw new Error('原操作内容身份不一致；输入与原编号保留，未覆盖。');
        if (!mounted.current || n !== serial.current) return;
        sessionStorage.removeItem(intentKey); intent.current = undefined; setPending(undefined); setError('');
      } else setError('原设置操作结果仍待核对。保留原选择和编号；重新读取不会写入或执行任务。');
    } catch (fault) { if (mounted.current && n === serial.current) setError(fault instanceof Error ? fault.message : '自动设置读取未完成。'); }
  }, []);
  useEffect(() => { if (!active) return; void refresh(); const focus = () => { void refresh(); }; window.addEventListener('focus', focus); window.addEventListener('optracall-automatic-settings', focus); return () => { window.removeEventListener('focus', focus); window.removeEventListener('optracall-automatic-settings', focus); }; }, [active, refresh]);
  const submit = async (input: AutomaticActionSettingsUpdate) => {
    setBusy(true); setError('');
    try {
      const result = await updateAutomaticActions(input);
      if (mounted.current) { sessionStorage.removeItem(intentKey); setValue(result.settings); setPending(undefined); intent.current = undefined; window.dispatchEvent(new Event('optracall-automatic-settings')); }
    } catch (fault) {
      if (mounted.current) {
        if (fault instanceof AutomaticActionRequestError && fault.status >= 400 && fault.status < 500 && fault.code !== 'automatic_action_operation_conflict') { sessionStorage.removeItem(intentKey); setPending(undefined); intent.current = undefined; await refresh(); }
        setError(fault instanceof Error ? fault.message : '设置结果未知；请先读取原结果。');
      }
    } finally { if (mounted.current) setBusy(false); }
  };
  const change = async (nodes: AutomaticActionNodes) => {
    if (!value || busy || intent.current) return;
    const input = { operationId: crypto.randomUUID(), expectedRevision: value.revision, nodes };
    try { if (pendingIntent()) { await refresh(); return; } sessionStorage.setItem(intentKey, JSON.stringify({ version: 1, input })); }
    catch (fault) { setError(fault instanceof Error ? fault.message : '无法保留本次操作编号，设置尚未发送。'); return; }
    intent.current = input; setPending(input); await submit(input);
  };
  const retry = async () => { if (busy || !intent.current) return; await refresh(); if (intent.current) await submit(intent.current); };
  return { value, busy, error, pending, change, refresh, retry };
}
function PendingSettings({ state }: { state: ReturnType<typeof useSettings> }) {
  return <>{state.pending && <div className="case-message"><p>原全局设置操作待核：<code>{state.pending.operationId}</code></p><details><summary>原选择（未自动重发）</summary><pre>{JSON.stringify(state.pending.nodes, null, 2)}</pre></details><button type="button" className="text-button" disabled={state.busy} onClick={() => { void state.retry(); }}>按原编号重试此设置</button></div>}{state.error && <p className="case-error" role="alert">{state.error}</p>}</>;
}
export function AutomaticActionSettingsPage({ active = true }: { active?: boolean }) {
  const state = useSettings(active);
  return <div>{state.value ? <SettingsForm value={state.value} busy={state.busy} disabled={!!state.pending} onChange={state.change} /> : <p role="status">正在读取全局自动设置…</p>}<PendingSettings state={state} /><button type="button" className="text-button" disabled={state.busy} onClick={() => { void state.refresh(); }}>重新读取全局设置</button></div>;
}
export function AutomaticActionLocalSwitch({ node, disabled = false }: { node: AutomaticActionNode; disabled?: boolean }) {
  const state = useSettings();
  return <div>{state.value && <AutomaticActionSwitch value={state.value} node={node} onChange={state.change} disabled={disabled || !!state.pending} busy={state.busy} />}<PendingSettings state={state} />{state.error && <button type="button" className="text-button" disabled={state.busy} onClick={() => { void state.refresh(); }}>读取原设置</button>}</div>;
}
