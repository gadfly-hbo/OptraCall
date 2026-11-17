// Engineering demonstration only. Replies are finite synthetic examples, never Pi calls.
import { useEffect, useId, useRef, useState } from 'react';
import type { GoalDraftInput, GoalRef, GoalVersion, StrategyGoalsIndex } from '../../../../src/host/strategy-goals-types.ts';
import { CaseDialog, CaseFormError } from '../../../../src/host/ui/CaseDialogs.tsx';
import * as goalsApi from '../../../../src/host/ui/strategy-goals-client.ts';
import { getDemoScenario, ids, readTaskDemoContext, rememberDemoWorkEntrance } from './stub.ts';
import { purposeForGoal, contextForGoal, type DemoPurpose, type PurposeKind, type GoalWorkContext } from './context.ts';
export type { DemoPurpose } from './context.ts';

export const DEMO_PROPOSED = new URL(location.href).searchParams.get('baseline') !== '1';
export const DEMO_START_GOALS = !new URL(location.href).searchParams.has('project') && !new URL(location.href).searchParams.has('studio');
const purposeKey = 'optracall-v12-demo-purpose.v1';
const names: Record<PurposeKind, string> = { '': '未设置', organization: '组织', department: '部门／业务模块', personal: '个人' };
const clone = <T,>(value: T): T => structuredClone(value);
export function readDemoPurpose(): DemoPurpose {
  try { const stored = JSON.parse(localStorage.getItem(purposeKey) || 'null'); return stored && typeof stored.background === 'string' && stored.kind in names ? stored : { kind: '', background: '' }; }
  catch { return { kind: '', background: '' }; }
}
function initialPurpose(): DemoPurpose {
  const saved = readDemoPurpose(); if (saved.kind) return saved;
  const scenario = getDemoScenario();
  return scenario === 'department' ? { kind: 'department', background: '会员业务模块；上层组织与战略尚未明确，不据此获得企业资料权限。' } : scenario === 'personal' ? { kind: 'personal', background: '本人希望兼顾家庭时间与事业发展，具体承诺待本人决定。' } : { kind: 'organization', background: '云杉服饰零售组织；本次先讨论会员复购方向，不预设促销是答案。' };
}
const goalContexts = new Map<string, GoalWorkContext>();
export async function v12RememberEntrance(goal: GoalRef): Promise<void> {
  const originalIndex = await goalsApi.list();
  rememberDemoWorkEntrance(contextForGoal(goal, originalIndex, goalContexts));
}
export function V12PurposeSettings() {
  const id = useId(), [value, setValue] = useState(readDemoPurpose), [notice, setNotice] = useState('');
  return <section className="v12-purpose-settings" aria-labelledby={`${id}-title`}><div className="page-heading"><div><h2 id={`${id}-title`}>使用用途</h2><p>确定默认讨论对象与背景，也可以在当前工作中明确不同用途。</p></div></div><form className="config-form" onSubmit={event => { event.preventDefault(); localStorage.setItem(purposeKey, JSON.stringify(value)); window.dispatchEvent(new Event('v12-demo-purpose-default')); setNotice('已保存为后续工作的默认背景。已开始的讨论、目标和已确认方案保持原范围。'); }}><div className="field"><label htmlFor={`${id}-kind`}>默认用途</label><select id={`${id}-kind`} value={value.kind} onChange={event => { setValue(old => ({ ...old, kind: event.target.value as PurposeKind })); setNotice(''); }}><option value="">暂不设置 · 仍可直接工作</option>{Object.entries(names).filter(([key]) => key).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><p className="field-help">用途不代表身份、组织职级或资源权限；不要求先建设组织层级。</p></div><div className="field"><label htmlFor={`${id}-background`}>默认背景（可选）</label><textarea id={`${id}-background`} value={value.background} maxLength={2000} onChange={event => { setValue(old => ({ ...old, background: event.target.value })); setNotice(''); }} placeholder="例如：会员业务模块；或本人希望兼顾家庭与事业。" /></div><button type="submit" className="primary-button">保存默认用途</button>{notice && <p className="case-notice" role="status">{notice}</p>}<p className="field-help">切换默认只影响后续背景，不改写历史目标、Case、资料、授权或已确认项目方案。</p></form></section>;
}

const methodOptions = [
  ['ptw', '战略选择框架 / Playing to Win', '明确追求、领域、成功途径、能力与管理支持'],
  ['rumelt', 'Rumelt 战略内核', '关键挑战、指导方针与相互配合的行动'],
  ['mckinsey', '麦肯锡战略构建要素', '问题、未来、备选与资源承诺的完整性'],
  ['bcg', 'BCG 战略调色板', '依据可预测性、可塑性与压力调整方式'],
  ['bain', '贝恩核心业务与相邻增长', '核对深耕核心或相邻拓展的取舍'],
  ['bsc', 'BSC／战略地图', '按需组织同一批目标、衡量与关系'],
] as const;
type Message = { role: 'user' | 'assistant'; text: string };
function methodReply(methods: string[], purpose: DemoPurpose, text: string, original?: GoalVersion): string {
  const personal = purpose.kind === 'personal', department = purpose.kind === 'department';
  const head = personal ? '先按你本人的取舍讨论：家庭相处、健康与事业发展都可能是主动追求，不把个人生活套成企业财务树。' : department ? '先在会员业务模块的职责内讨论：服务谁、创造什么价值、能控制哪些条件。上层战略保持未知，无需先建立一家企业。' : '先比较方向：聚焦现有核心会员的持续购买，与依靠广泛折扣拉动短期回流，是两种有不同资源代价的选择。复购下降本身不能证明该促销。';
  const parts = methods.map(method => method === 'ptw' ? personal ? '按战略选择框架，把追求转成可选择的领域：优先保障固定家庭时间，或在限定时间投入一个事业方向；成功标准、所需能力与支持由你确认。这里不引入竞争对手。' : '按战略选择框架，先选择服务对象与成功途径：优先核心会员的关键尺码可得性和连续服务，而非同时扩大所有客群；需要可用库存、服务能力和一致的观察安排。该方向仍是候选。' : method === 'rumelt' ? personal ? 'Rumelt 视角把挑战收敛为时间与精力冲突；指导方针可先设为减少并行承诺，行动组合围绕固定家庭时段与一项事业试验，而不是再加一串目标。' : 'Rumelt 视角先查关键挑战：购买受阻、商品吸引力或回访质量，哪项有依据？候选方针是先处理核心会员的具体阻碍；补货、服务和观察需配合，不能把“增长”口号当战略。' : method === 'mckinsey' ? '用战略构建要素检查缺口：当前诊断、未来前提、可替代路径与资源承诺是否互相支持？现有讨论保留，只补尚未说明的资源取舍与改变方向的观察信号，不强制七步问卷。' : method === 'bcg' ? 'BCG 调色板改变制定方式：当前关键前提不稳定，宜小范围适应性探索，逐次核对变化；不是按日历自动扫描，也不因换方法改写已采用目标。若环境更可预测，再讨论规划承诺。' : method === 'bain' ? personal ? '核心与相邻增长对这次家庭取舍适用有限。可借用“先巩固已有能力”的问题，但不把家庭当市场，不虚构相邻增长机会。' : '核心与相邻增长视角先问：核心会员、主力品类和现有渠道还有哪些可改善空间？跨品类或新渠道需要额外能力和投入证据，不因为核心复购下降就默认扩张。' : 'BSC 只帮助整理同一批目标与相互关系。可按需查看原目标、指标和历史；无需凑齐四个视角，也不复制一份正式目标。');
  const missing = /没资料|资料不足|不知道|增长\s*20|增长百分之二十/.test(text) ? '\n你尚未给足承诺依据。可以继续讨论方向或补证；不会替你编造负责人、目标数值和已确认的上层战略。' : '';
  const relations = personal ? '时间安排可能增加家庭相处机会，是待验证的因果假设；工作负荷、健康与家庭协同是待核条件，替代安排仍可比较。观察窗口、实际执行与其他变化需要核对，不从采用决定推断效果成立。' : department ? '本职责内的服务改进可能减少会员办理或购买受阻，是待验证的因果假设；商品、跨部门协同和资源可得性属于待核条件。其他路径也可能贡献结果，上层战略仍保持未知。' : '改善可得性可能减少购买受阻，是因果假设；服务、商品吸引力或其他路径也可能贡献结果。比较窗口、执行质量与外部变化都需核对，逻辑一致不等于因果成立。';
  return `${head}\n\n${parts.join('\n\n')}${original ? `\n\n沿用原目标「${original.title}」v${original.version}及当时策略和来源。更换参考方法没有清空材料，也没有自动更新它。` : ''}\n\n关键关系仍待验证：${relations}${missing}`;
}
function candidateFor(purpose: DemoPurpose, bound?: GoalVersion): GoalDraftInput {
  const personal = purpose.kind === 'personal', department = purpose.kind === 'department';
  if (bound) return { title: bound.title, outcome: bound.outcome, perspective: bound.perspective, scope: clone(bound.scope), measurement: clone(bound.measurement), baseline: clone(bound.baseline), responsible: bound.responsible, ...(bound.dueAt ? { dueAt: bound.dueAt } : {}), ...(bound.bscPerspective ? { bscPerspective: bound.bscPerspective } : {}), strategies: [...(bound.strategies || []), personal ? '比较家庭相处与事业投入的可替代安排，先核对工作负荷、精力和家庭协同。' : department ? '比较本职责内的受阻情境与可行改进，上层安排未知时不补造承诺。' : '先比较关键购买阻碍与服务路径，优先补证后再作资源承诺。'], resources: [...(bound.resources || []), '不把本次目标采用作为促销、采购或其他经营执行授权。'], necessaryConditions: [...(bound.necessaryConditions || []), personal ? '可支配时间、健康、工作负荷与家庭协同待核；贡献与因果假设分别表达。' : department ? '职责边界、可独立推进的条件与协同资格待核；上层战略未知，不推定权限。' : '时段、可比人群、执行质量和外部前提待核对；贡献与因果假设分别表达。'] };
  return { title: personal ? '明确家庭与事业的当期取舍' : department ? '明确会员业务模块下一阶段重点' : '明确会员复购改善的下一阶段方向', outcome: personal ? '形成本人可选择的时间与投入安排，说明家庭及事业目标的取舍、限制与复看条件。' : '比较会员购买阻碍、服务连续性和折扣路径，形成有依据、有边界的下一阶段方向。', perspective: personal ? 'personal' : 'profit', scope: personal ? { kind: 'personal', id: 'self', name: '本人家庭与事业' } : department ? { kind: 'department', id: 'member-service', name: '会员业务模块（上层未知）' } : { kind: 'enterprise', id: ids.enterprise, name: '云杉服饰（合成）' }, measurement: { kind: 'deliverable', criterion: personal ? '本人可核对至少两种安排的取舍、所需支持与后续观察，未替本人承诺具体数值。' : '交付可对照的候选方向、各自依据与限制、资源取舍和可检验的观察安排。' }, baseline: { state: 'pending', description: personal ? '实际时间与精力基线待本人补充，不据此宣称安排已有效。' : '可比复购基线、群体与窗口待补；不承诺未经核实的增长数值。' }, responsible: '', strategies: [personal ? '先减少并行承诺，保护重要家庭时段；事业路径做有界探索。' : '先明确核心服务对象，比较购买受阻与服务连续性路径，再决定资源投入。'], resources: ['资源与重要取舍由用户明确；采用目标不授权实际经营执行。'], necessaryConditions: ['必要条件：在本次约定范围内获得可核对的观察资料；存在替代资料路径时另行说明。', '因果假设：候选安排可能改善目标；机制、时滞和其他解释仍待验证。'] };
}

export function V12StrategyDiscussion({ active, index, selected, onAdopted }: { active: boolean; index: StrategyGoalsIndex; selected?: GoalVersion; onAdopted: (ref: GoalRef) => Promise<void> }) {
  const id = useId(), [purpose, setPurpose] = useState(initialPurpose), [purposeOpen, setPurposeOpen] = useState(false), [purposeSource, setPurposeSource] = useState('沿用已有背景／默认'), [messages, setMessages] = useState<Message[]>([]), [text, setText] = useState(''), [methods, setMethods] = useState<string[]>(['ptw']), [bound, setBound] = useState<GoalVersion>(), [candidate, setCandidate] = useState<GoalDraftInput>(), [adopting, setAdopting] = useState(false), [notice, setNotice] = useState('');
  const discussionId = useRef(crypto.randomUUID()), started = useRef(false), messagesEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { const update = () => { if (!started.current && purposeSource === '沿用已有背景／默认') setPurpose(initialPurpose()); }; window.addEventListener('v12-demo-purpose-default', update); return () => window.removeEventListener('v12-demo-purpose-default', update); }, [purposeSource]);
  useEffect(() => { messagesEnd.current?.scrollIntoView({ block: 'nearest' }); }, [messages]);
  const discussGoal = (goal: GoalVersion) => {
    setBound(clone(goal));
    const inferred = purposeForGoal(goal), kind = inferred.kind;
    if (!started.current && purposeSource !== '本次明确调整') {
      const prior = goalContexts.get(`${goal.goalId}:${goal.version}`)?.purpose;
      setPurpose(clone(prior || inferred));
      setPurposeSource('沿用目标准确版');
      setNotice(`已引用原目标 v${goal.version}，本次背景沿该目标范围；全局默认未改变。`);
    } else {
      setNotice(`已引用原目标 v${goal.version}（${names[kind]}：${goal.scope.name}）；本次仍为已${started.current ? '固定' : '明确'}的${names[purpose.kind]}用途。两者范围分别保留，不自动改写目标或默认。`);
    }
    if (!text) setText(`请沿用「${goal.title}」v${goal.version}，比较下一阶段方向与关键前提。`);
  };
  const send = (input = text) => {
    if (!input.trim() || !active) return; started.current = true;
    const original = bound ? clone(bound) : undefined;
    setMessages(old => [...old, { role: 'user', text: input.trim() }, { role: 'assistant', text: methodReply(methods.length ? methods : ['ptw'], purpose, input, original) }]);
    setText(''); setCandidate(candidateFor(purpose, original)); setNotice('');
  };
  const relationshipNotes = purpose.kind === 'personal' ? {
    necessary: '为比较本次安排，需要明确本人目标与边界，再核对可支配时间、固定责任和家庭协同；替代安排可继续探索，不预先认定唯一必要路径。',
    contribution: '家庭协同、精力恢复、学习与事业机会可能并列贡献本人目标；健康和家庭相处也可以是主动改善的目标。',
    hypothesis: '固定家庭时段或减少并行承诺可能增加相处机会；工作负荷、健康与家人安排是待核条件，逻辑连贯不等于效果已成立。',
    alternatives: '调整工作节奏、降低同时投入的事项或重新安排支持都可比较；时滞、执行情况与家庭变化保持未知。',
  } : purpose.kind === 'department' ? {
    necessary: '先按已知部门／业务模块职责核对可独立推进的条件；上层组织与战略未知，不要求补建，也不假定企业资料权限。',
    contribution: '职责内服务、可得性核对和协同可能贡献会员目标；跨部门贡献需另核，不能机械分摊上层指标。',
    hypothesis: '本职责内的改进可能减少会员受阻；商品、资源与跨部门支持属于待核条件，不把贡献关系写成已证因果。',
    alternatives: '职责内调整或请求有依据的协同可比较；未知上层安排、外部变化和观察窗口保留，不自动取得资源或执行授权。',
  } : {
    necessary: '本次可核对的资料与观察条件需要明确；允许说明替代资料路径。',
    contribution: '服务、可得性与商品吸引力可并列贡献，不机械分摊。',
    hypothesis: '减少购买受阻可能帮助持续购买；尚未验证，不由箭头或采用决定证明。',
    alternatives: '需求、退货、竞争、执行质量和观察窗口均可能改变判断；支持探索但保留边界。',
  };
  return <section className="sg-panel v12-discussion" aria-labelledby={`${id}-title`}><div className="sg-row-between v12-discussion-heading"><h2 id={`${id}-title`}>与 Agent 讨论战略</h2><span className="sg-muted">先说问题，无需先选框架</span></div><p className="v12-lead">已有战略、经营计划或 GSA 可以直接沿用。重要选择集中确认，普通讨论和补证继续推进。</p>
    <div className="v12-purpose-line"><span>本次：{names[purpose.kind]} · {purposeSource}{started.current ? ' · 已固定本轮背景' : ''}</span><button type="button" className="text-button" aria-expanded={purposeOpen} onClick={() => setPurposeOpen(!purposeOpen)}>调整本次</button>{bound && <span>依据：{bound.title} · v{bound.version}</span>}</div>
    {purposeOpen && <div className="v12-purpose-edit"><div className="case-field"><label htmlFor={`${id}-purpose`}>当前工作用途</label><select id={`${id}-purpose`} value={purpose.kind} onChange={event => { setPurpose(old => ({ ...old, kind: event.target.value as PurposeKind })); setPurposeSource('本次明确调整'); }}>{Object.entries(names).map(([key, label]) => <option key={key} value={key}>{key ? label : '未设置 · 仍可继续'}</option>)}</select></div><div className="case-field"><label htmlFor={`${id}-background`}>本次背景（可选）</label><textarea id={`${id}-background`} rows={2} value={purpose.background} onChange={event => { setPurpose(old => ({ ...old, background: event.target.value })); setPurposeSource('本次明确调整'); }} /></div><p className="case-help">只调整本轮讨论；不修改全局默认、已采用目标或旧项目方案，也不增加资料权限。</p><button type="button" className="text-button" onClick={() => setPurposeOpen(false)}>收起本次设置</button></div>}
    {selected && <div className="sg-row"><span className="sg-muted">当前查看：{selected.title} · v{selected.version}</span><button type="button" className="text-button" onClick={() => discussGoal(selected)}>围绕此目标讨论</button></div>}
    {messages.length > 0 && <div className="v12-messages" aria-label="战略讨论记录" role="log">{messages.map((message, position) => <article className={`v12-message ${message.role}`} key={position}><strong>{message.role === 'user' ? '你' : 'Agent · 演示回复'}</strong><p>{message.text}</p></article>)}<div ref={messagesEnd} /></div>}
    <form className="v12-composer" onSubmit={event => { event.preventDefault(); send(); }}><label className="sr-only" htmlFor={`${id}-question`}>战略讨论问题</label><textarea id={`${id}-question`} value={text} onChange={event => setText(event.target.value)} placeholder={purpose.kind === 'personal' ? '例如：我怎样兼顾家庭时间与事业方向？希望一起比较选择。' : purpose.kind === 'department' ? '例如：会员业务模块下一年应重点做什么？目前没有明确的上层战略。' : '例如：会员复购在下降，下一阶段应聚焦哪些人、怎样改善？先比较方向。'} /><div className="sg-row-between"><span className="sg-muted">讨论与目标采用不代表经营执行授权</span><button type="submit" className="primary-button" disabled={!text.trim() || !active}>发送讨论</button></div></form>
    <details className="v12-methods"><summary>参考方法（可选） · {methods.map(method => methodOptions.find(option => option[0] === method)?.[1]).join(' ＋ ') || '由 Agent 按问题选择'}</summary><p className="case-help">这些是开放方法参考，不代表已安装或测评的 Skill。换选或组合保留本轮消息、原材料与准确目标；不强制逐题问卷。</p><div className="v12-method-options">{methodOptions.map(([key, label, description]) => <label key={key}><input type="checkbox" checked={methods.includes(key)} onChange={event => setMethods(old => event.target.checked ? [...old, key] : old.filter(value => value !== key))} /><span><strong>{label}</strong><br />{description}</span></label>)}</div>{messages.length > 0 && <button type="button" className="secondary-button" onClick={() => send('请按当前选择的参考方法继续比较；保留已有资料、讨论和原目标准确版本。')}>按当前参考继续讨论</button>}</details>
    {candidate && <section className="v12-candidate" aria-label="战略讨论候选"><span className="sg-badge pending">讨论候选 · 尚未采用</span><h3>{candidate.title}</h3><p>{candidate.outcome}</p>{!candidate.responsible && <p>责任与协同尚待你明确；可继续讨论，不代填负责人或承诺数值。</p>}<details><summary>依据、条件与因果细节</summary><p><strong>必要：</strong>{relationshipNotes.necessary}</p><p><strong>贡献：</strong>{relationshipNotes.contribution}</p><p><strong>因果假设：</strong>{relationshipNotes.hypothesis}</p><p><strong>替代路径与未知：</strong>{relationshipNotes.alternatives}</p><p>用途：{names[purpose.kind]}；{purpose.background || '未补充背景，不据此扩展授权。'}</p><p>{bound ? `原目标准确版：${bound.title} v${bound.version}。` : '本轮未引用既有目标，不编造已确认战略。'}合成讨论记录：{discussionId.current}。</p></details><button type="button" className="primary-button" onClick={() => setAdopting(true)}>核对并采用</button><p className="case-help">将讨论内容预填到原目标／GSA；核对后保存候选与明确采用，不需要重抄。</p></section>}
    {notice && <p className="case-notice" role="status">{notice}</p>}
    {adopting && candidate && <V12CandidateAdoption active={active} candidate={candidate} original={bound} index={index} onClose={() => setAdopting(false)} onAdopted={async goal => { goalContexts.set(`${goal.goalId}:${goal.version}`, { goal: { goalId: goal.goalId, version: goal.version }, purpose: clone(purpose), discussionId: discussionId.current, ...(bound ? { sourceGoal: { goalId: bound.goalId, version: bound.version } } : {}) }); await onAdopted({ goalId: goal.goalId, version: goal.version }); setAdopting(false); setCandidate(undefined); setNotice(`已采用原目标记录「${goal.title}」v${goal.version}。下方 GSA 与 Case／项目入口引用同一版；尚未授权经营执行。`); }} />}
  </section>;
}

function V12CandidateAdoption({ active, candidate, original, index, onClose, onAdopted }: { active: boolean; candidate: GoalDraftInput; original?: GoalVersion; index: StrategyGoalsIndex; onClose: () => void; onAdopted: (goal: GoalVersion) => Promise<void> }) {
  const id = useId(), [draft, setDraft] = useState(() => clone(candidate)), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [conflict, setConflict] = useState(false), [pending, setPending] = useState<{ operationId: string; phase: 'draft' | 'adopt' }>();
  const [expectedVersion, setExpectedVersion] = useState(original ? index.goals.find(record => record.id === original.goalId)?.currentVersion || original.version : 0);
  const intent = useRef<{ draftId: string; adoptId: string; saved?: GoalVersion; phase: 'draft' | 'adopt' } | undefined>(undefined);
  const change = <K extends keyof GoalDraftInput,>(key: K, value: GoalDraftInput[K]) => setDraft(old => ({ ...old, [key]: value }));
  const adopt = async (saved: GoalVersion) => { intent.current!.phase = 'adopt'; const result = await goalsApi.adopt(saved, { expectedVersion: saved.version, operationId: intent.current!.adoptId, decision: '采用本次集中核对的目标和 GSA 内容；保留待补基线与因果假设，不授权实际经营执行。' }); await onAdopted(result.goal); };
  const failure = (fault: unknown) => { setError(goalsApi.goalError(fault)); if (fault instanceof goalsApi.StrategyGoalsRequestError && fault.status === 409) { setConflict(true); } else if (!(fault instanceof goalsApi.StrategyGoalsRequestError) || fault.status >= 500) { const operation = intent.current!; setPending({ operationId: operation.phase === 'draft' ? operation.draftId : operation.adoptId, phase: operation.phase }); } };
  const save = async () => {
    if (busy || pending || conflict || !confirmed || !draft.responsible.trim()) return; setBusy(true); setError('');
    intent.current ||= { draftId: crypto.randomUUID(), adoptId: crypto.randomUUID(), phase: 'draft' };
    try {
      const input = { ...draft, source: { authority: 'task' as const, id: ids.task, version: 1, projectId: ids.project, taskId: ids.task, sha256: 'd'.repeat(64) }, operationId: intent.current.draftId };
      const result = original ? await goalsApi.revise(original.goalId, { ...input, expectedVersion }) : await goalsApi.create(input);
      intent.current.saved = result.goal; await adopt(result.goal);
    } catch (fault) { failure(fault); } finally { setBusy(false); }
  };
  const recover = async () => {
    if (!pending || busy) return; setBusy(true); setError('');
    try { const result = await goalsApi.operation(pending.operationId); if (!result.operation || !('goalId' in result.operation.result)) { setError('尚未核对到原目标保存回执；输入与原编号保留，没有重复创建。'); return; } const saved = result.operation.result as GoalVersion; setPending(undefined); if (pending.phase === 'adopt') await onAdopted(saved); else { intent.current!.saved = saved; await adopt(saved); } }
    catch (fault) { failure(fault); } finally { setBusy(false); }
  };
  const refreshVersion = async () => { if (!original) { setConflict(false); intent.current = undefined; setError(''); return; } setBusy(true); try { const latest = await goalsApi.list(); const record = latest.goals.find(record => record.id === original.goalId); if (!record) throw new Error('原目标仍不可读取。'); setExpectedVersion(record.currentVersion); setConflict(false); intent.current = undefined; setNotice(`已核对当前 v${record.currentVersion}；本轮输入与原来源 v${original.version}保留。再次确认将另存新候选，不覆盖历史。`); setError(''); } catch (fault) { setError(goalsApi.goalError(fault)); } finally { setBusy(false); } };
  return <CaseDialog active={active} title="核对并采用目标／GSA" subtitle={original ? `修订原目标 ${original.title} · 来源 v${original.version}` : '从本轮讨论形成目标候选，不新建另一套战略权威'} className="sg-dialog" busy={busy} onClose={onClose}><form className="v12-adoption-form" onSubmit={event => { event.preventDefault(); void save(); }}><p className="case-help">内容已预填。采用只确认这份目标；实际行动、资源和效果仍按原记录与授权核对。</p><fieldset disabled={busy || Boolean(pending)}><div className="case-field"><label htmlFor={`${id}-title`}>目标名称</label><input id={`${id}-title`} required value={draft.title} onChange={event => change('title', event.target.value)} /></div><div className="case-field"><label htmlFor={`${id}-outcome`}>当期结果要求</label><textarea id={`${id}-outcome`} rows={3} required value={draft.outcome} onChange={event => change('outcome', event.target.value)} /></div><p className="case-help">适用对象：{draft.scope.name}{draft.scope.kind === 'department' && !draft.scope.enterpriseId ? '；上层组织与战略未知，不要求补建企业，不新增资料权限。' : ''}</p><div className="case-field"><label htmlFor={`${id}-responsible`}>责任与协同</label><input id={`${id}-responsible`} required value={draft.responsible} placeholder="由你明确；不会自动编造负责人" onChange={event => change('responsible', event.target.value)} /></div>{draft.measurement.kind === 'deliverable' ? <div className="case-field"><label htmlFor={`${id}-criterion`}>成果核对标准</label><textarea id={`${id}-criterion`} required rows={3} value={draft.measurement.criterion} onChange={event => change('measurement', { kind: 'deliverable', criterion: event.target.value })} /></div> : <p className="case-help">沿用原 SAP 指标 {draft.measurement.sapMetric.metricName} / {draft.measurement.sapMetric.version}。当期要求：{draft.measurement.target || '未承诺新数值'}。</p>}<div className="case-field"><label htmlFor={`${id}-baseline`}>基线与待补内容</label><textarea id={`${id}-baseline`} rows={2} required value={draft.baseline.description} onChange={event => change('baseline', { ...draft.baseline, description: event.target.value })} /></div><details><summary>策略、资源与必要条件（已带入，可调整）</summary>{(['strategies', 'resources', 'necessaryConditions'] as const).map(key => <div className="case-field" key={key}><label htmlFor={`${id}-${key}`}>{key === 'strategies' ? '策略安排' : key === 'resources' ? '资源与约束' : '必要条件／待验证前提'}</label><textarea id={`${id}-${key}`} rows={3} value={draft[key]?.join('\n') || ''} onChange={event => change(key, event.target.value.split('\n').filter(Boolean))} /></div>)}</details><details><summary>BSC 视角（可选）</summary><div className="case-field"><label htmlFor={`${id}-bsc`}>沿用或补充视角</label><input id={`${id}-bsc`} value={draft.bscPerspective || ''} onChange={event => change('bscPerspective', event.target.value || undefined)} /></div><p className="case-help">不填也可采用；同一目标及原 BSC 历史不会删除。</p></details><label className="v12-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>我确认采用本次核对的目标，保留待验证前提；不授权经营执行。</span></label></fieldset><CaseFormError error={error} />{notice && <p className="case-notice" role="status">{notice}</p>}{pending && <div className="sg-unknown"><p>原操作结果待核；输入与编号保留，没有重新创建。</p><button type="button" className="secondary-button" disabled={busy} onClick={() => { void recover(); }}>核对原保存结果</button><details><summary>原操作记录</summary><code>{pending.operationId}</code></details></div>}{conflict && <button type="button" className="secondary-button" disabled={busy} onClick={() => { void refreshVersion(); }}>核对当前目标版本，保留本轮输入</button>}<div className="case-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>继续讨论</button><button type="submit" className="primary-button" disabled={busy || Boolean(pending) || conflict || !confirmed || !draft.responsible.trim()}>{busy ? '正在保存…' : '确认采用目标'}</button></div></form></CaseDialog>;
}

export function V12TaskContext({ projectId, taskId }: { projectId: string; taskId: string }) {
  if (!DEMO_PROPOSED) return null;
  const context = readTaskDemoContext(projectId, taskId); if (!context) return null;
  return <details className="case-message v12-task-context"><summary>本任务承接背景 · 合成演示</summary><p>目标准确版本：{context.goal ? `${context.goal.goalId} · v${context.goal.version}` : '本任务未绑定目标，不补造引用。'}</p><p>本次用途：{context.purpose ? names[context.purpose.kind as PurposeKind] || context.purpose.kind : '沿原工作背景'}；{context.purpose?.background || '未补充背景，不扩大授权。'}</p><p>来自原项目方案确认；{context.mode === 'create' ? '仅创建，尚未执行。' : '开始状态为演示回执，不表示真实 Pi 运行。'}</p></details>;
}
