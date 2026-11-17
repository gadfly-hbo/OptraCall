import { useEffect, useState } from 'react';
import type { StrategyDiscussionSource } from '../../../../src/host/strategy-discussion-types.ts';
export type PreviewScope = { mode: 'project-background' | 'selected-only'; excludedSources: StrategyDiscussionSource[] };
const params = new URL(location.href).searchParams;
let scope: PreviewScope = { mode: ['legacy', 'selected-empty'].includes(params.get('scopeScenario') || '') ? 'selected-only' : 'project-background', excludedSources: [] };
export const isBaseline = params.get('before') === '1';
if (isBaseline) scope.mode = 'selected-only';
export function previewScope(): PreviewScope { return structuredClone(scope); }
export function Pm01Scope({ projectId, locked }: { projectId: string; locked: boolean }) {
  const [value, setValue] = useState(scope.mode);
  const change = (next: PreviewScope['mode']) => { scope = { ...scope, mode: next }; setValue(next); window.dispatchEvent(new Event('pm01-preview-scope')); };
  return <div className="field pm01-scope"><label htmlFor="pm01-source-mode">本次背景使用范围</label><select id="pm01-source-mode" value={value} disabled={!projectId || locked} onChange={event => change(event.target.value as PreviewScope['mode'])}><option value="project-background">在本项目获准背景内自主查找</option><option value="selected-only">仅使用我手选的资料</option></select><p className="case-help">{!projectId ? '尚未明确资料项目：不开放项目背景，仍可围绕当前说明与准确目标讨论。' : value === 'project-background' ? 'Agent可在本次明确的项目背景与原权限内发现并按需读取。手选是优先参考或补充，不是逐项读取审批。' : '仅限下方明确手选的资料；空清单表示本次不使用项目背景，不自动转为项目范围。'}</p>{params.get('scopeScenario') === 'legacy' && <p className="case-help">原讨论保持原手选范围；只有你明确调整本次范围后，后续请求才采用新选择。旧消息与来源不改写。</p>}<p className="case-help">目录可见不代表正文已读；不会试连活库、读取业务明细或增加资料权限。</p></div>;
}
export function Pm01SourceOptions({ availableSources, sources, onSourcesChange, locked }: { availableSources: StrategyDiscussionSource[]; sources: StrategyDiscussionSource[]; onSourcesChange(value: StrategyDiscussionSource[]): void; locked: boolean }) {
  const [current, setCurrent] = useState(previewScope);
  useEffect(() => { const update = () => setCurrent(previewScope()); window.addEventListener('pm01-preview-scope', update); return () => window.removeEventListener('pm01-preview-scope', update); }, []);
  const exclude = (source: StrategyDiscussionSource, excluded: boolean) => { scope = { ...scope, excludedSources: excluded ? [...scope.excludedSources.filter(item => item.id !== source.id), source] : scope.excludedSources.filter(item => item.id !== source.id) }; if (excluded) onSourcesChange(sources.filter(item => item.id !== source.id)); setCurrent(previewScope()); window.dispatchEvent(new Event('pm01-preview-scope')); };
  return <div className="pm01-source-options">{availableSources.map(source => { const excluded = current.excludedSources.some(item => item.id === source.id), selected = sources.some(item => item.id === source.id && item.sha256 === source.sha256); return <div className="pm01-source-row" key={`${source.id}:${source.sha256}`}><div><strong>{source.title}</strong><p className="sg-muted">准确版 {source.version} · 目录项，尚不代表已读取</p></div><label><input type="checkbox" checked={selected} disabled={locked || excluded} onChange={event => onSourcesChange(event.target.checked ? [...sources, source] : sources.filter(item => item.id !== source.id))} />{current.mode === 'selected-only' ? '本次使用' : '优先参考'}</label><label><input type="checkbox" checked={excluded} disabled={locked} onChange={event => exclude(source, event.target.checked)} />排除</label></div>; })}<p className="sg-muted">{current.mode === 'selected-only' ? `本次仅限 ${sources.length} 份手选背景。` : `手选优先参考 ${sources.length} 份；未手选不等于排除。`} 明确排除 {current.excludedSources.length} 项。发送前及实际读取时仍核当前资格与准确版本。</p></div>;
}
