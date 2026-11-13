import type { ReactNode } from 'react';
import type { StudioAssetKind, StudioAssetRevision, StudioSourceRef, StudioUseRecord } from '../../../extensions/business-plugins/studio/contracts.ts';
import { parseFoundationContent } from '../../../extensions/business-plugins/studio/foundation.ts';
import type { FoundationContent, FoundationTarget } from '../../../extensions/business-plugins/studio/foundation.ts';
import type { StudioFoundation, StudioFoundationItem } from './studio-api.ts';
import { StudioRuleExecutionView } from './StudioRuleExecutionView.tsx';
import './StudioFoundationView.css';

export type StudioFoundationSection = 'overview' | 'assets' | 'reference' | 'checks';
const sections = [['overview', '体系总览'], ['assets', '三类资产'], ['reference', '参考与内化'], ['checks', '关联核验']] as const;
const states = [['definition', '定义'], ['mapping', '映射'], ['computation', '可计算'], ['use', '实际使用']] as const;
const statusText = { pass: '通过', fail: '不通过', unknown: '未知', pending: '待核' };
const itemKindText = { entity: '实体', attribute: '属性', key: '标识', 'value-domain': '值域', event: '事件', rule: '规则', dimension: '维度', time: '业务时间', concept: '概念' };
const relationText = { catalog: '目录归类', 'formula-dependency': '公式依赖', 'statistical-decomposition': '统计分解', 'analysis-use': '分析用途', domain: '领域关系' };
const adaptationText = { adopt: '直接采用', modify: '修改采用', exclude: '排除', add: '企业新增', pending: '待核' };
type ReadSource = (ref: StudioSourceRef) => void;

function Source({ value, onReadSource, children }: { value: StudioSourceRef; onReadSource?: ReadSource; children?: ReactNode }) {
  return <><button type="button" className="text-button studio-foundation-source" disabled={!onReadSource} onClick={() => onReadSource?.(value)}>{children || value.title || value.id} · {value.version}</button><span className="studio-meta">{value.authority}</span></>;
}
function Sources({ refs, onReadSource }: { refs: StudioSourceRef[]; onReadSource?: ReadSource }) {
  return refs.length ? <ul className="studio-foundation-evidence">{refs.map((ref, index) => <li key={index}><Source value={ref} onReadSource={onReadSource} /></li>)}</ul> : <span className="studio-meta">未记录依据</span>;
}
function Target({ value, onReadSource }: { value: FoundationTarget; onReadSource?: ReadSource }) {
  if (value.kind === 'item') return <code>{value.itemId}</code>;
  if (value.kind === 'external-item') return <><code>{value.itemRef.itemId}</code><br /><Source value={value.itemRef.sourceRef} onReadSource={onReadSource} /></>;
  return <><strong>{value.metricRef.metricName}</strong>{value.metricRef.scenario && <p className="studio-meta">场景：{value.metricRef.scenario}</p>}<br /><Source value={value.metricRef.sourceRef} onReadSource={onReadSource} /></>;
}
function Table({ headings, children }: { headings: string[]; children: ReactNode }) {
  return <div className="studio-table-wrap"><table className="studio-foundation-content-table"><thead><tr>{headings.map(text => <th scope="col" key={text}>{text}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}
function exactUse(use: StudioUseRecord, ref: StudioSourceRef) {
  return use.sources.some(source => source.authority === ref.authority && source.id === ref.id && source.version === ref.version && (!ref.sha256 || source.sha256 === ref.sha256) && (!source.locator || !ref.locator || source.locator === ref.locator));
}
function Readiness({ profile, sourceRef, uses = [], onReadSource }: { profile: FoundationContent; sourceRef?: StudioSourceRef; uses?: StudioUseRecord[]; onReadSource?: ReadSource }) {
  const matching = sourceRef ? uses.filter(use => exactUse(use, sourceRef)) : [];
  return <section className="studio-foundation-section"><h3>四项状态与实际依据</h3><p className="studio-meta">作者记录与正式发布身份分别显示。正文中的状态声明不代表独立核验；以下缺项保持待核。</p><div className="studio-foundation-readiness">{states.map(([key, title]) => {
    const value = profile.readiness?.[key];
    return <article key={key}><h4>{title}</h4><p><span className={`studio-badge${value?.status === 'fail' ? ' is-error' : ' is-warning'}`}>作者记录：{value ? statusText[value.status] : '待核'}</span></p><p>{value?.detail || '尚未记录本项核查。'}</p>{value?.scope && <p className="studio-meta">核查范围：{value.scope}</p>}{value && <Sources refs={value.evidenceRefs} onReadSource={onReadSource} />}{key === 'use' && <p className="studio-meta">{matching.length ? `有 ${matching.length} 条绑定本准确版本的实际使用记录；质量结论见原作者评估。` : '尚无绑定本准确版本的实际使用记录。'}独立使用核验待核。</p>}</article>;
  })}</div>{matching.map(use => <details key={use.id} className="studio-foundation-use"><summary>原使用记录 · {use.report.title || use.report.id} · {use.report.version}</summary><p>{use.result}</p><p className="studio-meta">{use.projectId} / {use.taskId} · 原记录状态 {use.verification} · {use.createdAt}</p><Sources refs={[use.report, ...use.sources]} onReadSource={onReadSource} />{use.assessments?.map((assessment, index) => <section className="studio-assessment" key={index}><h4>作者评估 · {statusText[assessment.status]}</h4><p>{assessment.result}</p><Sources refs={[assessment.report, ...assessment.sources]} onReadSource={onReadSource} /></section>)}</details>)}</section>;
}
function References({ profile, onReadSource }: { profile: FoundationContent; onReadSource?: ReadSource }) {
  return <section className="studio-foundation-section"><h3>逐项内化差异</h3>{profile.adaptations?.length ? <Table headings={['参考条目', '内化动作', '企业条目与理由', '依据']}>{profile.adaptations.map((item, index) => <tr key={index}><td>{item.referenceRef ? <><code>{item.referenceRef.itemId}</code><br /><Source value={item.referenceRef.sourceRef} onReadSource={onReadSource} /></> : '无参考条目（企业新增或待补）'}</td><td>{adaptationText[item.action]}</td><td><code>{item.targetItemId || '未指定企业条目'}</code><p>{item.reason}</p></td><td><Sources refs={item.evidenceRefs} onReadSource={onReadSource} /></td></tr>)}</Table> : <p className="studio-meta">尚未记录参考模板与企业条目的内化差异；未将参考知识当作企业事实。</p>}</section>;
}
export interface StudioFoundationContentProps {
  body: string; complete?: boolean; sourceRef?: StudioSourceRef; uses?: StudioUseRecord[];
  onReadSource?: ReadSource; section?: StudioFoundationSection | 'publication';
}
/** A read-only projection of an explicitly versioned original source, never another editable model. */
export function StudioFoundationContent({ body, complete = true, sourceRef, uses, onReadSource, section }: StudioFoundationContentProps) {
  if (!complete) return <p className="studio-note is-warning">部分正文不能形成完整结构核验；请沿准确原文继续读取。</p>;
  const parsed = parseFoundationContent(body);
  if (parsed.kind === 'legacy') return null;
  if (parsed.kind !== 'supported' || !parsed.profile) return <section className="studio-note is-warning"><h3>{parsed.kind === 'unsupported' ? '未知内容约定' : '结构存在缺口'}</h3><p>原文保留可读，当前不将其视为已核验的三类资产结构。</p><ul>{parsed.issues.map((issue, index) => <li key={index}>{issue.path} · {issue.detail}</li>)}</ul></section>;
  const profile = parsed.profile;
  if (section === 'publication') return <section className="studio-foundation-section"><h3>本准确版本的三类结构摘要</h3><p>{profile.items.length} 个主数据与语义条目 · {profile.metricLinks?.length || 0} 个准确指标引用 · {profile.relations?.length || 0} 条本体关系 · {profile.bindingLinks?.length || 0} 项字段映射</p><p className="studio-meta">适用范围：{profile.scope || '沿本预览原资产范围核对'}<br />内化差异：{profile.adaptations?.map(item => `${adaptationText[item.action]} ${item.targetItemId || item.referenceRef?.itemId || '未指明条目'}`).join('；') || '未记录'}</p>{profile.metricLinks?.map((link, index) => <p key={index}><strong>{link.metricRef.metricName}</strong> · <Source value={link.metricRef.sourceRef} onReadSource={onReadSource} /></p>)}<p className="studio-meta">本摘要只解释此预览固定的源内容；发布资格、原检查与模块实际结果沿原记录核对。定义、数据可计算和实际使用的结论不互相替代。</p><StudioRuleExecutionView profile={profile} sourceRef={sourceRef} onReadSource={onReadSource} publication /></section>;
  if (section === 'reference') return <References profile={profile} onReadSource={onReadSource} />;
  if (section === 'checks') return <><StudioRuleExecutionView profile={profile} sourceRef={sourceRef} onReadSource={onReadSource} /><Readiness profile={profile} sourceRef={sourceRef} uses={uses} onReadSource={onReadSource} /></>;
  return <div className="studio-foundation-content"><p className="studio-meta">内容约定 {profile.contentProfile} · 适用范围：{profile.scope || '未单独记录，沿原资产范围核对'}</p>
    <section className="studio-foundation-section"><h3>条目与身份</h3>{profile.items.length ? <Table headings={['条目与类型', '定义与粒度', '范围与时间', '准确来源']}>{profile.items.map(item => <tr key={item.itemId}><td><strong>{item.name || item.itemId}</strong><p className="studio-meta"><code>{item.itemId}</code> · {itemKindText[item.kind]}</p>{item.parentItemId && <p className="studio-meta">归属条目 {item.parentItemId}</p>}</td><td>{item.definition}<p className="studio-meta">粒度：{item.grain || '未记录'}<br />值类型：{item.valueType || '未记录'}</p></td><td>{item.scope || '未记录条目范围'}<p className="studio-meta">业务时间：{item.validFrom || '未知'} → {item.validTo || '未知'}<br />证据性质：{item.evidenceNature || '未记录'}</p></td><td><Source value={item.sourceRef} onReadSource={onReadSource} /></td></tr>)}</Table> : <p className="studio-meta">尚无条目；不以空结构代表建模完成。</p>}</section>
    <section className="studio-foundation-section"><h3>数据分析指标体系</h3><p className="studio-meta">这里只展示体系索引与准确引用。指标定义、公式和 IR 仍由原 SAP 专业区管理。</p>{profile.metricLinks?.length ? <Table headings={['准确指标', '统计对象、事件与规则', '维度与业务时间', 'Binding']}>{profile.metricLinks.map((link, index) => <tr key={index}><td><strong>{link.metricRef.metricName}</strong><p className="studio-meta">场景：{link.metricRef.scenario || '未限定'}</p><Source value={link.metricRef.sourceRef} onReadSource={onReadSource} /></td><td>对象：{link.entityItemIds?.join('、') || '未记录'}<br />事件：{link.eventItemIds?.join('、') || '未记录'}<br />规则：{link.ruleItemIds?.join('、') || '未记录'}</td><td>{link.dimensions?.map(value => `${value.name} → ${value.itemId}`).join('；') || '未记录维度'}<br />时间：{link.timeItemIds?.join('、') || '未记录'}</td><td>{link.bindingRef ? <Source value={link.bindingRef} onReadSource={onReadSource} /> : '尚未关联准确映射'}</td></tr>)}</Table> : <p className="studio-meta">尚未关联准确 SAP 指标，未生成第二份公式。</p>}</section>
    <section className="studio-foundation-section"><h3>本体关系与约束</h3>{profile.relations?.length ? <Table headings={['关系类型', '起点 → 终点', '范围、时间与语义', '依据']}>{profile.relations.map(relation => <tr key={relation.relationId}><td>{relationText[relation.type]}<p className="studio-meta">{relation.relationId}</p></td><td><Target value={relation.from} onReadSource={onReadSource} /><p aria-hidden="true">↓</p><Target value={relation.to} onReadSource={onReadSource} /></td><td>{relation.detail || '未记录说明'}<p className="studio-meta">范围：{relation.scope || '未记录'}<br />时间：{relation.validFrom || '未知'} → {relation.validTo || '未知'}<br />角色：{relation.role || '未记录'}{relation.mutuallyExclusive !== undefined && <><br />互斥：{relation.mutuallyExclusive ? '是' : '否'}</>}{relation.complete !== undefined && <><br />穷尽：{relation.complete ? '是' : '否'}</>}{relation.additive !== undefined && <><br />可加：{relation.additive ? '是' : '否'}</>}</p></td><td><Sources refs={relation.evidenceRefs} onReadSource={onReadSource} /></td></tr>)}</Table> : <p className="studio-meta">尚未记录本体关系与约束。</p>}</section>
    <section className="studio-foundation-section"><h3>实际数据映射</h3>{profile.bindingLinks?.length ? <Table headings={['字段与准确来源', '对应条目与粒度', '映射条件', '依据']}>{profile.bindingLinks.map((link, index) => <tr key={index}><td><code>{link.field}</code><br /><Source value={link.sourceRef} onReadSource={onReadSource} /></td><td><code>{link.itemId}</code><p>{link.grain}</p></td><td>{link.detail}</td><td><Sources refs={link.evidenceRefs} onReadSource={onReadSource} /></td></tr>)}</Table> : <p className="studio-meta">尚未记录字段映射；定义可成立不代表当前数据可计算。</p>}</section>
    <StudioRuleExecutionView profile={profile} sourceRef={sourceRef} onReadSource={onReadSource} />
    <References profile={profile} onReadSource={onReadSource} /><Readiness profile={profile} sourceRef={sourceRef} uses={uses} onReadSource={onReadSource} />
  </div>;
}

export function StudioFoundationNavigation({ section, onSelect, disabled }: { section: StudioFoundationSection; onSelect: (section: StudioFoundationSection) => void; disabled?: boolean }) {
  return <nav className="studio-foundation-nav" aria-label="企业基础层内容">{sections.map(([key, label]) => <button key={key} type="button" aria-pressed={section === key} disabled={disabled} onClick={() => onSelect(key)}>{label}</button>)}</nav>;
}
interface FoundationEntry { systemId: string; assetId: string; kind: StudioAssetKind; revision: StudioAssetRevision; identity: '候选' | '正式'; ref: StudioSourceRef; uses: StudioUseRecord[]; restriction?: string }
function foundationEntries(foundation?: StudioFoundation): FoundationEntry[] {
  return foundation?.systems.flatMap(system => system.assets.flatMap(asset => [...new Set([asset.formalRevision, asset.candidateRevision].filter((value): value is number => value !== null))].flatMap(number => {
    const revision = asset.revisions.find(value => value.revision === number);
    if (!revision || parseFoundationContent(revision.body).kind === 'legacy') return [];
    const issue = asset.issueHistory?.find(value => value.affectedRevision === number) || (asset.issue?.affectedRevision === number ? asset.issue : undefined);
    return [{ systemId: system.id, assetId: asset.id, kind: asset.kind, revision, identity: (number === asset.candidateRevision && number !== asset.formalRevision ? '候选' : '正式') as FoundationEntry['identity'], ref: { authority: 'studio-source' as const, id: asset.id, version: String(number), sha256: revision.sha256, projectId: system.projectId, locator: system.id, title: revision.title }, uses: system.uses, restriction: issue?.reason }];
  }))) || [];
}
export function StudioFoundationView({ foundation, section, loading, catalogItems, onReadSource, onOpenAsset, onBuild, onRefresh }: { foundation?: StudioFoundation; section: StudioFoundationSection; loading?: boolean; catalogItems?: StudioFoundationItem[]; onReadSource: (systemId: string, ref: StudioSourceRef) => void; onOpenAsset: (systemId: string, assetId: string) => void; onBuild: () => void; onRefresh?: () => void }) {
  if (!foundation) return <section className="studio-foundation-view" aria-label={sections.find(([key]) => key === section)?.[1]} aria-busy={Boolean(loading)}>{loading ? <p role="status" className="studio-meta">正在读取本企业准确资产…</p> : <div className="studio-empty"><h2>尚未取得资产范围</h2><p>当前读取结果未知，不能据此判断企业没有资产或建设尚未开始。可重新读取原资产目录。</p><button type="button" className="secondary-button" disabled={!onRefresh} onClick={onRefresh}>重新读取资产</button></div>}</section>;
  const filtered = section === 'assets' && catalogItems !== undefined;
  const entries = foundationEntries(foundation).filter(entry => !filtered || catalogItems.some(item => item.authority === 'studio-source' && item.id === entry.assetId && (!(item.systemId || item.ref?.locator) || (item.systemId || item.ref?.locator) === entry.systemId)));
  const profiles = entries.flatMap(entry => { const value = parseFoundationContent(entry.revision.body); return value.profile ? [{ entry, profile: value.profile }] : []; });
  const counts = [profiles.reduce((sum, value) => sum + value.profile.items.length, 0), profiles.reduce((sum, value) => sum + (value.profile.metricLinks?.length || 0), 0), profiles.reduce((sum, value) => sum + (value.profile.relations?.length || 0), 0)];
  return <section className="studio-foundation-view" aria-label={sections.find(([key]) => key === section)?.[1]}>
    {section === 'overview' && <><div className="studio-foundation-summary">{[['主数据模型', '对象、身份、属性、粒度与业务时间'], ['数据分析指标体系', '体系索引关联原 SAP 准确指标'], ['本体', '关系类型、业务规则与约束']].map(([title, description], index) => <article key={title}><h2>{title}</h2><strong>{counts[index]}</strong><p>{description}</p><p className="studio-meta">结构条目记录数，候选与正式分别保留，不代表建设完成。</p></article>)}</div><p className="studio-note">先明确企业基础层的范围，同时建设主数据、指标体系和本体。普通分析 Agent 按需发现正式资产；实际使用、质量核验和后续修订保留各自依据。</p></>}
    {section === 'reference' && <><div className="studio-foundation-routes"><section><h2>行业 → 标杆企业 → 目标企业</h2><p>通用行业的主数据、指标体系与本体，结合有出处的标杆企业参考，再由目标企业获准资料核定。</p></section><section><h2>领域 → 标杆业务域 → 目标部门</h2><p>通用领域的主数据、指标体系与本体，结合标杆业务域参考，与行业路线交叉核定。</p></section></div><p className="studio-meta">以下只展示本企业真实引用和逐项差异。模板需作为获准来源关联；不会把知识参考自动登记为企业事实。</p></>}
    {section === 'checks' && <p className="studio-note">Host 负责结构、引用、版本与权限；Agent 核对业务和样本。结构可解析、作者记录、实际使用和独立核验分别显示，未记录的结论保持待核。</p>}
    {!entries.length ? <div className="studio-empty"><h2>{filtered ? '没有匹配的结构资产' : '尚无显式的三类资产结构'}</h2>{filtered ? <p>可调整当前分类或搜索。企业资料、SAP 指标、方法与普通文本资产仍在下方原权威列表中查看。</p> : <><p>已有普通文本资产仍在“三类资产”的原资产列表中查看。建设可从企业范围与资料出发，无需先指定单个分析问题。</p><button type="button" className="secondary-button" onClick={onBuild}>表达建设目标</button></>}</div> : <div className="studio-foundation-entry-list">{entries.map(entry => {
      const parsed = parseFoundationContent(entry.revision.body), profile = parsed.profile;
      return <article className="studio-foundation-entry" key={`${entry.systemId}:${entry.assetId}:${entry.revision.revision}`}><div className="studio-row"><div><h2>{entry.revision.title}</h2><p className="studio-meta">{entry.assetId} · {entry.identity} r{entry.revision.revision} · 范围：{entry.revision.scope || '未记录'}{entry.kind === 'binding' ? ' · 数据映射原资产' : ''}</p></div><button type="button" className="text-button" onClick={() => onOpenAsset(entry.systemId, entry.assetId)}>在原体系查看修订与影响</button></div>
        {entry.restriction && <p className="studio-note is-warning">此准确版本已确认的问题：{entry.restriction}。原身份保留，相关用途依原资格限制核对。</p>}
        {section === 'overview' ? <><p className="studio-meta">{profile ? `${profile.items.length} 个条目 · ${profile.metricLinks?.length || 0} 个指标引用 · ${profile.relations?.length || 0} 条关系 · ${profile.adaptations?.length || 0} 项内化差异` : '内容约定尚不具备结构展示资格。'}</p>{profile && <Readiness profile={profile} sourceRef={entry.ref} uses={entry.uses} onReadSource={ref => onReadSource(entry.systemId, ref)} />}</> : <><StudioFoundationContent body={entry.revision.body} sourceRef={entry.ref} uses={entry.uses} section={section} onReadSource={ref => onReadSource(entry.systemId, ref)} />{section === 'checks' && <section className="studio-foundation-section"><h3>本版结构与原检查记录</h3><p className="studio-meta">结构解析：{parsed.kind === 'supported' ? '支持当前约定' : '存在缺口或未知约定'}。解析不代替来源可读、权限或业务核验。</p>{entry.revision.checks.length ? entry.revision.checks.map((check, index) => <p key={index}><span className={`studio-badge${check.status === 'fail' ? ' is-error' : ' is-warning'}`}>记录：{statusText[check.status]}</span> {check.name} · {check.detail}</p>) : <p className="studio-meta">本准确版本尚未保存检查记录；检查主体和覆盖范围依原回执核对。</p>}</section>}</>}
      </article>;
    })}</div>}
  </section>;
}
