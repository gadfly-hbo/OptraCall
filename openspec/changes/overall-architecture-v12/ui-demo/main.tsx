// Review-only prototype: actual App and CSS; browser-only synthetic API state.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { installDemoStub, setDemoFailure, getDemoSnapshot } from './stub.ts';
import './demo.css';

installDemoStub();
function Controls() {
  const params = new URL(location.href).searchParams;
  const baseline = params.get('baseline') === '1';
  const [failure, setFailure] = useState('none'), [inspect, setInspect] = useState(false);
  const [snapshot, setSnapshot] = useState<unknown>();
  const navigate = (key: string, value: string) => { const url = new URL(location.href); url.searchParams.set(key, value); url.searchParams.delete('project'); url.searchParams.delete('task'); url.searchParams.delete('studio'); location.href = url.href; };
  return <aside className="demo-controls" aria-label="工程演示控制"><strong>交互演示 · 合成资料</strong><span>原 App / 3a529a0</span><label>对照 <select aria-label="演示版本" value={baseline ? '1' : '0'} onChange={event => navigate('baseline', event.target.value)}><option value="0">v1.2 增量</option><option value="1">现有界面基线</option></select></label><label>场景 <select aria-label="合成场景" value={params.get('scenario') || 'bsc-history'} onChange={event => navigate('scenario', event.target.value)}><option value="bsc-history">服饰组织 · 已有 BSC 历史</option><option value="no-bsc">服饰组织 · 仅 GSA</option><option value="department">部门 · 上层未知</option><option value="personal">个人 · 家庭与事业</option></select></label><label>下一次目标保存 <select aria-label="保存异常演示" value={failure} onChange={event => { const value = event.target.value as 'none' | 'conflict' | 'unknown'; setFailure(value); setDemoFailure(value); }}><option value="none">正常</option><option value="conflict">版本冲突</option><option value="unknown">结果 UNKNOWN</option></select></label><button type="button" onClick={() => { localStorage.removeItem('optracall-v12-demo-purpose.v1'); location.reload(); }}>重置合成状态</button><button type="button" aria-expanded={inspect} onClick={() => { setSnapshot(getDemoSnapshot()); setInspect(!inspect); }}>查看演示状态</button>{inspect && <dialog open className="demo-state"><button type="button" onClick={() => setInspect(false)}>关闭状态</button><p>仅查看本页内存替身；没有 Host、Pi、真实配置或业务数据。</p><pre>{JSON.stringify(snapshot, null, 2)}</pre></dialog>}</aside>;
}
createRoot(document.getElementById('demo-controls')!).render(<Controls />);
await import('../../../../src/host/ui/main.tsx');
