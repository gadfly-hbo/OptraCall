import { useEffect, useId, useRef, useState } from 'react';
import { readUsageContextSettings, readUsageContextOperation, saveUsageContextSettings, sameUsageContext, usageContextJournal, UsageContextRequestError } from './usage-context-client.ts';
import type { UsageContext, UsageContextSettings, UsageContextUpdate } from './usage-context-client.ts';
export const usageKindLabels = { organization: '组织', department: '部门／业务模块', personal: '个人' };
export function UsageContextFields({ value, onChange, disabled, id }: { value: UsageContext | null; onChange: (value: UsageContext | null) => void; disabled?: boolean; id: string }) {
  return <><div className="field"><label htmlFor={`${id}-kind`}>使用用途</label><select id={`${id}-kind`} disabled={disabled} value={value?.kind || ''} onChange={event => onChange(event.target.value ? { kind: event.target.value as UsageContext['kind'], background: value?.background || '' } : null)}><option value="">暂不设置 · 仍可直接工作</option>{Object.entries(usageKindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></div>{value && <div className="field"><label htmlFor={`${id}-background`}>背景（可选）</label><textarea id={`${id}-background`} disabled={disabled} maxLength={4000} rows={3} value={value.background} onChange={event => onChange({ ...value, background: event.target.value })} placeholder="说明本次讨论对象或已有背景，不要求填完整规划。" /></div>}</>;
}
export function UsageContextSettingsPage() {
  const id = useId(), alive = useRef(true), serial = useRef(0), dirty = useRef(false);
  const [settings, setSettings] = useState<UsageContextSettings>(), [draft, setDraft] = useState<UsageContext | null>(null), [busy, setBusy] = useState(false), [pending, setPending] = useState<UsageContextUpdate>(), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [journal] = useState(() => { try { return { value: usageContextJournal(window.sessionStorage), error: '' }; } catch { return { value: undefined, error: '无法保留设置操作编号，请核对浏览器存储权限后再保存。' }; } });
  const refresh = async () => {
    const ticket = ++serial.current; setError('');
    try {
      if (!journal.value) throw new Error(journal.error);
      const original = journal.value.read();
      const [next, result] = await Promise.all([readUsageContextSettings(), original ? readUsageContextOperation(original.operationId) : Promise.resolve(undefined)]);
      if (!alive.current || ticket !== serial.current) return;
      setSettings(next); setPending(original);
      if (original && result?.operation) {
        const operation = result.operation;
        if (operation.operationId !== original.operationId || operation.revision !== original.expectedRevision + 1 || !sameUsageContext(operation.context, original.context)) throw new Error('原设置操作内容不一致，输入与编号保持，未采用其他回执。');
        journal.value.settle(original.operationId); setPending(undefined); dirty.current = false; setDraft(next.context); setNotice('已核对原设置保存结果。当前讨论与历史工作未改写。'); window.dispatchEvent(new Event('optracall-usage-context'));
      } else if (original) { setDraft(original.context); setError('原设置结果仍待核对；输入与编号保留，没有重复保存。'); }
      else if (!dirty.current) setDraft(next.context);
    } catch (fault) { if (alive.current && ticket === serial.current) setError(fault instanceof Error ? fault.message : '用途设置读取未完成。'); }
  };
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; ++serial.current; }; }, []);
  const save = async () => {
    if (!settings || !journal.value || busy || pending) return;
    const input = { operationId: crypto.randomUUID(), expectedRevision: settings.revision, context: draft };
    try { journal.value.remember(input); } catch (fault) { setError(fault instanceof Error ? fault.message : '原操作编号无法保存。'); return; }
    setPending(input); setBusy(true); setError(''); setNotice('');
    try { const result = await saveUsageContextSettings(input); if (!alive.current) return; if (result.operationRevision !== input.expectedRevision + 1) throw new Error('设置回执版本不一致，原输入保持，请核对原操作。'); journal.value.settle(input.operationId); setPending(undefined); setSettings(result.settings); setDraft(result.settings.context); dirty.current = false; setNotice('已保存默认用途；已开始讨论、目标与已确认方案保持原范围。'); window.dispatchEvent(new Event('optracall-usage-context')); }
    catch (fault) { if (alive.current) { if (fault instanceof UsageContextRequestError && !fault.uncertain && !fault.code.includes('operation_conflict')) { journal.value.settle(input.operationId); setPending(undefined); } setError(fault instanceof Error ? fault.message : '设置保存结果未知。'); } }
    finally { if (alive.current) setBusy(false); }
  };
  return <section className="usage-context-settings" aria-labelledby={`${id}-title`}>
    <div className="page-heading"><div><h2 id={`${id}-title`}>使用用途</h2><p>保存默认讨论对象与背景，当前工作可以明确不同用途。</p></div></div>
    {!settings && !error && <p role="status">正在读取默认用途…</p>}
    <form className="config-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <UsageContextFields id={id} value={draft} disabled={!settings || busy || Boolean(pending)} onChange={value => { dirty.current = true; setDraft(value); setNotice(''); }} />
      <p className="field-help">用途不代表身份、组织职级或资源权限。未设置不阻断工作；切换默认只影响新背景，不改写历史目标、Case、授权或已确认项目方案。</p>
      <div className="sg-row">
        <button type="submit" className="primary-button" disabled={!settings || busy || Boolean(pending)}>{busy ? '正在保存…' : '保存默认用途'}</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => { void refresh(); }}>重新读取默认用途</button>
      </div>
      {pending && <div className="sg-unknown">
        <p>原设置操作结果待核，选择保持，未自动重发。</p>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => { void refresh(); }}>核对原保存结果</button>
        <details><summary>原操作编号</summary><code>{pending.operationId}</code></details>
      </div>}
      {notice && <p className="case-notice" role="status">{notice}</p>}
      {error && <p className="case-error" role="alert">{error}</p>}
    </form>
  </section>;
}
