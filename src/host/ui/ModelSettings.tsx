import { useEffect, useRef, useState } from 'react';
import type { PublicModelConfiguration } from './project-types.ts';
import { clearConfiguration, HostRequestError, importCredentials, saveConfiguration, selectConfiguration, testConnection } from './runtime-client.ts';

type Fields = { id?: string; name: string; provider: string; api: string; baseUrl: string; model: string; thinkingLevel?: string };
const empty: Fields = { name: '', provider: 'openai-compatible', api: 'openai-completions', baseUrl: '', model: '' };
const fieldsOf = (value: PublicModelConfiguration): Fields => ({ id: value.id, name: value.name, provider: value.provider, api: value.api, baseUrl: value.baseUrl, model: value.model, ...(value.thinkingLevel ? { thinkingLevel: value.thinkingLevel } : {}) });
export function ModelSettings({ configurations, selectedId, hostStatus, onChange, onBack, backLabel }: { configurations: PublicModelConfiguration[]; selectedId: string | null; hostStatus: 'loading' | 'ready' | 'unavailable'; onChange: () => Promise<void>; onBack: () => void; backLabel: string }) {
  const initial = configurations.find(value => value.id === selectedId) ?? configurations[0];
  const [editingId, setEditingId] = useState(initial?.id ?? 'custom-new');
  const current = configurations.find(value => value.id === editingId);
  const [draft, setDraft] = useState<Fields>(initial ? fieldsOf(initial) : empty);
  const [apiKey, setApiKey] = useState(''); const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'save' | 'test' | 'clear' | 'select' | 'import' | null>(null);
  const [notice, setNotice] = useState(''); const [failure, setFailure] = useState(''); const [tested, setTested] = useState(false);
  const title = useRef<HTMLHeadingElement>(null); const importInput = useRef<HTMLInputElement>(null); const controller = useRef<AbortController | null>(null);
  useEffect(() => { title.current?.focus(); return () => controller.current?.abort(); }, []);
  useEffect(() => { if (current && !dirty) setDraft(fieldsOf(current)); }, [current, dirty]);
  const update = (field: keyof Fields, value: string) => { setDraft(previous => ({ ...previous, [field]: value })); setDirty(true); setErrors({}); setNotice(''); setFailure(''); setTested(false); };
  const task = () => { controller.current?.abort(); const next = new AbortController(); controller.current = next; return next; };
  const report = (error: unknown) => { if (error instanceof DOMException && error.name === 'AbortError') { setNotice('连接测试已取消，已请求停止。'); return; } if (error instanceof HostRequestError) { setErrors(error.fields); setFailure(error.message); } else setFailure('本地服务暂时不可用，请重试。'); };
  const choose = async (id: string) => {
    setEditingId(id); const value = configurations.find(item => item.id === id); setDraft(value ? fieldsOf(value) : empty); setApiKey(''); setDirty(false); setErrors({}); setFailure(''); setNotice(''); setTested(false);
    if (!value) return;
    setBusy('select'); const next = task(); try { await selectConfiguration(id, next.signal); await onChange(); } catch (error) { report(error); } finally { setBusy(null); }
  };
  const field = (name: 'name' | 'baseUrl' | 'model', label: string, placeholder: string) => <div className="field"><label htmlFor={`config-${name}`}>{label}<span className="required" aria-hidden="true">必填</span></label><input id={`config-${name}`} value={draft[name]} disabled={Boolean(busy)} required placeholder={placeholder} maxLength={name === 'name' ? 80 : name === 'model' ? 200 : 2000} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `error-${name}` : undefined} onChange={event => update(name, event.target.value)} />{errors[name] && <p className="field-error" id={`error-${name}`}>{errors[name]}</p>}</div>;
  return <div className="settings-page">
    <button className="text-button back-button" onClick={onBack}><span aria-hidden="true">←</span>{backLabel}</button>
    <div className="page-heading"><div><p className="eyebrow">工作台设置</p><h1 ref={title} tabIndex={-1}>模型配置</h1><p>选择模型，或导入已有 Pi 凭据。</p></div><span className={`status-badge ${tested ? 'connection-ok' : ''}`}><span />{busy === 'test' ? '正在测试' : tested ? '单次测试已响应' : '尚未测试'}</span></div>
    <div className="settings-note"><span aria-hidden="true">◇</span><p>配置与密钥保存在本机，重启后继续使用。凭据文件采用本地明文和系统文件权限保护；密钥不回读到浏览器。保存、导入和选择模型不会调用模型。</p></div>
    {hostStatus !== 'ready' && <div className="host-status" role="status"><p>{hostStatus === 'loading' ? '正在读取本地配置…' : '本地服务尚未就绪，请启动应用后重试。'}</p><button className="secondary-button" onClick={() => { void onChange(); }} disabled={hostStatus === 'loading'}>重新读取配置</button></div>}
    <div className="model-config-toolbar"><div className="field"><label htmlFor="model-profile">模型配置</label><select id="model-profile" value={editingId} disabled={Boolean(busy)} onChange={event => { void choose(event.target.value); }}>{configurations.map(value => <option key={value.id} value={value.id}>{value.name}{value.hasApiKey ? ' · 已配置' : ' · 需填写密钥'}</option>)}<option value="custom-new">添加自定义模型</option></select></div><button className="secondary-button" type="button" disabled={Boolean(busy) || hostStatus !== 'ready'} onClick={() => importInput.current?.click()}>{busy === 'import' ? '正在导入…' : '导入 Pi 凭据'}</button><input ref={importInput} type="file" accept="application/json,.json" hidden aria-label="导入 Pi 凭据文件" onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      setNotice(''); setFailure(''); setErrors({}); setTested(false);
      if (file.size > 256 * 1024) { setFailure('凭据文件过大，请选择 Pi auth.json。'); return; }
      const next = task(); setBusy('import');
      try { let credentials: unknown; try { credentials = JSON.parse(await file.text()); } catch { throw new HostRequestError('请选择有效的 Pi auth.json 文件。'); } await importCredentials(credentials, next.signal); credentials = undefined; await onChange(); setApiKey(''); setDirty(false); setNotice('指定 Provider 的凭据已通过配置保存入口导入，原 Pi 文件保持独立；尚未测试连接。'); } catch (error) { report(error); } finally { setBusy(null); }
    }} /></div>
    <form className="config-form" noValidate autoComplete="off" onSubmit={async event => {
      event.preventDefault(); setNotice(''); setFailure(''); setTested(false); const nextErrors: Record<string, string> = {};
      if (!draft.name.trim()) nextErrors.name = '请输入配置名称。'; if (!draft.model.trim() || /\s/.test(draft.model.trim())) nextErrors.model = '请输入准确的模型名称。';
      try { const url = new URL(draft.baseUrl); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(); } catch { nextErrors.baseUrl = '请输入不包含账户或查询参数的 HTTP(S) 地址。'; }
      if (!apiKey.trim() && (!current?.hasApiKey || current.baseUrl !== draft.baseUrl.trim())) nextErrors.apiKey = '首次配置或更换服务地址时，请输入密钥。';
      setErrors(nextErrors); if (Object.keys(nextErrors).length) { setFailure('请修正标记的字段后再保存。'); requestAnimationFrame(() => document.getElementById(Object.keys(nextErrors)[0] === 'apiKey' ? 'config-key' : `config-${Object.keys(nextErrors)[0]}`)?.focus()); return; }
      const next = task(); setBusy('save'); try { const saved = await saveConfiguration({ ...draft, apiKey }, next.signal); await selectConfiguration(saved.id, next.signal); setApiKey(''); setEditingId(saved.id); setDraft(fieldsOf(saved)); setDirty(false); await onChange(); setNotice('配置已保存到本机，密钥不回显；尚未测试连接。'); } catch (error) { report(error); } finally { setBusy(null); }
    }}>
      <div className="form-heading"><div><h2>连接信息</h2><p>{current && !current.provider.startsWith('custom-') ? '采用 Pi SDK 原生模型和供应商协议。' : '自定义 OpenAI 兼容 Chat Completions。'}</p></div><button className="text-button" type="button" disabled={Boolean(busy)} onClick={() => { setEditingId('custom-new'); setDraft({ name: '我的模型', provider: 'openai-compatible', api: 'openai-completions', baseUrl: 'https://api.example.invalid/v1', model: 'demo-model' }); setApiKey(''); setDirty(true); setErrors({}); setFailure(''); setNotice(''); setTested(false); }}>填入示例</button></div>
      {field('name', '配置名称', '例如：我的对话模型')}
      <div className="field"><label htmlFor="config-provider">供应商协议</label><input id="config-provider" value={draft.api === 'anthropic-messages' ? 'Anthropic Messages' : 'OpenAI Chat Completions'} readOnly /></div>
      {field('baseUrl', '服务地址', 'https://api.example.invalid/v1')}{field('model', '模型名称', '填写服务支持的准确模型名称')}
      <div className="field"><label htmlFor="config-key">API Key<span className="field-tag">{current?.hasApiKey ? '已保存于本机' : '尚未填写'}</span></label><input id="config-key" type="password" value={apiKey} disabled={Boolean(busy)} maxLength={8192} autoComplete="off" placeholder={current?.hasApiKey ? '留空保留当前密钥；更换地址需重填' : '输入密钥，仅发送给本地 Host'} aria-invalid={Boolean(errors.apiKey)} aria-describedby={errors.apiKey ? 'error-apiKey' : 'key-help'} onChange={event => { setApiKey(event.target.value); setDirty(true); setFailure(''); setErrors({}); setNotice(''); setTested(false); }} />{errors.apiKey ? <p className="field-error" id="error-apiKey">{errors.apiKey}</p> : <p className="field-help" id="key-help">保存后输入框清空。同一供应商的两个原生模型共用该供应商密钥。</p>}</div>
      <div className="connection-row"><div><h3>连接测试</h3><p id="connection-help">{dirty ? '请先保存修改，再测试连接。' : '仅主动点击时发送固定短句，不包含项目内容。'}</p></div>{busy === 'test' ? <button className="secondary-button" type="button" onClick={() => controller.current?.abort()}>取消测试</button> : <button className="secondary-button" type="button" disabled={Boolean(busy) || dirty || !current?.hasApiKey || hostStatus !== 'ready'} aria-describedby="connection-help" onClick={async () => { if (!current) return; const next = task(); setBusy('test'); setNotice(''); setFailure(''); setTested(false); try { await selectConfiguration(current.id, next.signal); const result = await testConnection(current.revision, next.signal); setTested(true); setNotice(result.message); } catch (error) { report(error); } finally { setBusy(null); } }}>测试连接</button>}</div>
      {failure && <p role="alert" className="field-error">{failure}</p>}<p className="save-status" role="status">{notice || '新项目使用所选模型。已有项目保留创建时的模型配置，运行中不会自动切换。'}</p>
      <div className="form-footer"><button className="text-button clear-config" type="button" disabled={!current?.hasApiKey || Boolean(busy) || hostStatus !== 'ready'} onClick={async () => { if (!current) return; const next = task(); setBusy('clear'); setFailure(''); setNotice(''); setTested(false); try { await clearConfiguration(current.provider, next.signal); setApiKey(''); setDirty(false); await onChange(); setNotice('此供应商凭据已清除，关联运行已停止；项目和历史仍保留，需重新配置后继续。'); } catch (error) { report(error); } finally { setBusy(null); } }}>清除此供应商凭据</button><button className="primary-button" type="submit" disabled={Boolean(busy) || hostStatus !== 'ready'}>{busy === 'save' ? '正在保存…' : '保存配置'}</button></div>
    </form>
  </div>;
}
