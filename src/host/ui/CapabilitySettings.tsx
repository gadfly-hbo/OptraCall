import { useEffect, useState } from 'react';
import { catalogItems } from './catalog-data.ts';
import { SkillEvaluationPanel } from './SkillEvaluation.tsx';
import { tradeAreaVersionText, useTradeAreaStatus } from './TaskCapabilities.tsx';
import './capability-settings.css';
export interface SkillCapabilityMetadata { id: string; title: string; description?: string; version: string; sha256: string; source: string; bundled?: boolean; dependencies?: string[] }
export interface SkillCapabilitiesSnapshot { skills: SkillCapabilityMetadata[]; diagnostics: { type: string; message: string }[] }
export type TaskCapabilityDestination = 'plan' | 'requirement' | 'reports' | 'refiner' | 'simlab' | 'model-pack' | 'permissions' | 'connections';
export function TaskCapabilityNavigation({ onOpen }: { onOpen(destination: TaskCapabilityDestination): void }) {
  const entries: { destination: TaskCapabilityDestination; label: string }[] = [{ destination: 'plan', label: '项目方案与 Skill 改选' }, { destination: 'requirement', label: '局部需求与 RAP' }, { destination: 'reports', label: '报告与 PPT 生成' }, { destination: 'refiner', label: 'PPT 精修与原版本' }, { destination: 'simlab', label: '方案比较与经营推演' }, { destination: 'model-pack', label: '预测模型与原注册表' }, { destination: 'permissions', label: '任务能力与显式启用' }, { destination: 'connections', label: '项目资料与连接授权' }];
  return <details className="task-context-options task-capability-navigation"><summary>报告、方案比较与专业能力</summary><nav className="report-action-row" aria-label="任务业务与能力入口">{entries.map(entry => <button type="button" className="text-button" key={entry.destination} onClick={() => onOpen(entry.destination)}>{entry.label}</button>)}</nav><p className="case-help">打开原工作位置不会发送分析请求，也不授予额外权限。已有记录、版本和待核状态沿原页面保留。</p></details>;
}
export async function readSkillCapabilities(): Promise<SkillCapabilitiesSnapshot> {
  const response = await fetch('/api/capabilities/skills', { method: 'GET', mode: 'same-origin', credentials: 'omit', cache: 'no-store', headers: { 'x-optracall-client': '1' } });
  if (!response.ok) throw new Error('当前 Skill 资料暂不可读，原配置和已选引用仍保留。');
  return response.json();
}
const dependencyDeclarations: Record<string, string> = { 'ppt-report': '按该 Skill 随包依赖说明核对 PPT 生成工具链。', 'target-forecast': '声明依赖 Python 与 openpyxl。', 'coupon-forecast': '声明依赖 Python；表格导入另需 openpyxl。', 'roi-forecast': '声明依赖 Python。', 'data-analysis': '声明依赖 python3 标准库。', 'deep-research': '检索路线取决于当前模型与网络配置。' };
export function SkillCapabilitySettings({ active = true, initial, onProject, onModelSettings }: { active?: boolean; initial?: SkillCapabilitiesSnapshot; onProject(): void; onModelSettings(): void }) {
  const [snapshot, setSnapshot] = useState(initial), [error, setError] = useState('');
  useEffect(() => { if (!active) return; let live = true; void readSkillCapabilities().then(value => { if (live) { setSnapshot(value); setError(''); } }, fault => { if (live) setError(fault instanceof Error ? fault.message : 'Skill 资料暂不可读。'); }); return () => { live = false; }; }, [active]);
  return <section className="case-board capability-settings" aria-labelledby="skill-settings-title"><header className="case-board-heading"><div><h2 id="skill-settings-title">Skill 资料与依赖</h2><p>实际 Pi 资源目录的只读元信息；来源可见不代表已选、已采用或已执行。</p></div><button type="button" className="text-button" onClick={onProject}>项目方案中查看与改选</button></header>
    {error && <p className="case-message case-error" role="alert">{error}</p>}{!snapshot && !error && <p role="status">正在读取当前实际 Skill 目录…</p>}
    {snapshot?.skills.map(skill => { const bundled = skill.bundled === true; const builtin = bundled ? catalogItems.find(item => item.skill && item.id === skill.id) : undefined; const approval = builtin?.skill?.approval; const approved = approval?.packageSha256 === skill.sha256; return <article className="project-plan-section" key={`${skill.source}:${skill.sha256}`}><h3>{builtin?.name || skill.title}</h3><p>{skill.description || builtin?.description}</p><dl className="detail-metadata"><div><dt>当前来源</dt><dd><code>{skill.source}</code></dd></div><div><dt>固定版本</dt><dd><code>{skill.version}</code></dd></div><div><dt>内容身份</dt><dd><code>{skill.sha256}</code></dd></div></dl><p>{skill.dependencies?.join('；') || (bundled ? dependencyDeclarations[skill.id] : undefined) || '依赖以该 Skill 原指引为准。'} 未在此执行依赖检查，当前环境可用性为 UNKNOWN。</p>{approved && approval && <p className="case-message">用户已确认本版通过 · 未运行对照测评。{approval.date} · {approval.version}</p>}{builtin?.skill && <><p className="case-help">原回执仅对应历史被测版本；当前来源或版本变化不代表重新测评，也不推定结论覆盖新版。</p><SkillEvaluationPanel name={builtin.name} evaluation={builtin.skill.evaluation} historical={Boolean(approval)} /></>}</article>; })}
    {snapshot && !snapshot.skills.length && <p className="case-message">本次实际目录未列出 Skill。原方案与历史引用保留，未自动安装或替换。</p>}{snapshot?.diagnostics.map((item, index) => <p className="case-message" key={index}>{item.type}：{item.message}</p>)}
    <p className="case-help">内置能力随产品版本维护，其他来源沿原 Pi 资源机制。此页不安装、升级或重新关联资源。</p><button type="button" className="text-button" onClick={onModelSettings}>核对模型与检索配置</button>
  </section>;
}
export function ConnectorCapabilitySettings({ onSharedConnections, onProjectSources, onHelp }: { onSharedConnections(): void; onProjectSources(): void; onHelp(): void }) {
  const status = useTradeAreaStatus();
  return <section className="case-board" aria-labelledby="connector-settings-title"><header className="case-board-heading"><div><h2 id="connector-settings-title">连接配置</h2><p>共享环境配置与项目授权、任务显式启用分别管理；查看本页不会查询业务数据。</p></div><button type="button" className="text-button" onClick={onProjectSources}>返回项目资料与任务授权</button></header>
    <section className="project-plan-section"><h3>数据库与数据仓库</h3><p>沿原 PostgreSQL／MySQL 共享连接管理。测试连接不等于项目已授权，项目资料区继续核范围、预算、模型出口和任务继承。</p><button type="button" className="secondary-button" onClick={onSharedConnections}>管理共享数据库连接</button></section>
    <section className="project-plan-section"><h3>商圈数据</h3><p role="status">{tradeAreaVersionText(status)}</p><p>原本机快照继续使用；没有快照时按原导入说明处理，不因入口迁移重新导入。任务空闲时显式启用商圈工具；环境存在不代表范围获准。</p><button type="button" className="text-button" onClick={onHelp}>查看原使用与缺配置说明</button></section>
    <section className="project-plan-section"><h3>历史天气</h3><p>沿原 Open-Meteo 历史日级连接，无密钥或账号配置。本页不发天气请求，网络与服务可用性尚未核实。</p><p>在任务空闲时显式启用；原出境说明和使用条件仍在任务能力入口展示，结果进入所选模型上下文。</p><button type="button" className="text-button" onClick={onProjectSources}>到原任务核对启用与范围</button></section>
  </section>;
}
export function CapabilityPlansSettings({ onProject }: { onProject(): void }) {
  return <section className="case-board" aria-labelledby="capability-plans-title"><header className="case-board-heading"><div><h2 id="capability-plans-title">能力接入规划</h2><p>只保留原有未接入事项的说明，不安装、不运行，也不将规划转成建设任务。</p></div><button type="button" className="text-button" onClick={onProject}>提出本项目实际诉求</button></header>
    {catalogItems.filter(item => item.status !== '已接入').map(item => <details key={item.id} className="project-plan-section"><summary>{item.id} · {item.name} · {item.status} · 尚未接入</summary><p>{item.description}</p><p>{item.note}</p><p className="case-help">原参考来源：{item.source}</p></details>)}
  </section>;
}
