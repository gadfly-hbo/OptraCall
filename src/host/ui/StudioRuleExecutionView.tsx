import type { ReactNode } from 'react';
import type { StudioAsset, StudioPublicationPreview, StudioSourceRef } from '../../../extensions/business-plugins/studio/contracts.ts';
import type { FoundationContent } from '../../../extensions/business-plugins/studio/foundation.ts';
import type { StudioRuleReceipt } from '../studio-rule-reasoning.ts';

type ReadSource = (ref: StudioSourceRef) => void;

function ExactSources({ refs, onReadSource }: { refs: StudioSourceRef[]; onReadSource?: ReadSource }) {
  return <ul className="studio-source-list studio-rule-sources">{refs.map((ref, index) => <li key={`${ref.authority}:${ref.id}:${ref.version}:${index}`}>
    {onReadSource ? <button type="button" className="text-button" onClick={() => onReadSource(ref)}>{ref.title || ref.id} · {ref.version}</button> : <span>{ref.title || ref.id} · {ref.version}</span>}
    <span className="studio-meta">{ref.authority}</span>
    <details><summary>准确来源身份</summary><pre>{JSON.stringify(ref, null, 2)}</pre></details>
  </li>)}</ul>;
}

function RuleTable({ headings, children }: { headings: string[]; children: ReactNode }) {
  return <div className="studio-table-wrap"><table className="studio-rule-table" data-columns={headings.length}><thead><tr>{headings.map(heading => <th key={heading} scope="col">{heading}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

const publicationPurposeLabels = { 'definition-reference': '定义参考', 'rule-execution': '规则执行', 'metric-calculation': '指标计算' };

export function StudioRulePublicationView({ preview, onReadSource }: { preview: Pick<StudioPublicationPreview, 'purposes' | 'executionSummaries'>; onReadSource?: ReadSource }) {
  if (!preview.purposes?.length && !preview.executionSummaries?.length) return null;
  return <section className="studio-foundation-section studio-rule-execution" aria-label="准确发布用途与规则范围">
    <h3>本次发布用途</h3><div className="studio-actions">{preview.purposes?.map(purpose => <span className="studio-badge" key={purpose}>{publicationPurposeLabels[purpose] || '用途待核'}</span>)}</div>
    <p className="studio-meta">以下是本预览冻结的用途与事实条件。正式发布、引擎执行与实际使用分别核定；旧报告和运行中任务保留原依据。</p>
    {preview.executionSummaries?.map(summary => <details key={`${summary.assetId}:${summary.revision}:${summary.sha256}`}><summary>{summary.assetId} · r{summary.revision} · {summary.ruleItemIds.length} 个规则条目</summary>
      <p className="studio-meta">{summary.engine.name} {summary.engine.version} · {summary.contractVersion}<br />规则条目：{summary.ruleItemIds.join('、')}</p>
      <RuleTable headings={['事实与字段', '粒度、时间与覆盖', '冻结来源与 Binding']}>
        {summary.factRequirements.map(requirement => <tr key={requirement.requirementId}><td><strong>{requirement.requirementId}</strong><p>{requirement.fields.join('、')}</p><p>{requirement.kind === 'observed' ? '观察事实' : '外部计算事实'}</p></td><td>{requirement.grain} · {requirement.unit}<p>{requirement.timeBasis}</p><p>{requirement.coverage}</p></td><td><ExactSources refs={[requirement.sourceRef, requirement.bindingRef, ...(requirement.calculationRefs || [])]} onReadSource={onReadSource} /></td></tr>)}
      </RuleTable><p className="studio-meta">准确源稿 SHA-256 {summary.sha256}</p>
    </details>)}
    {preview.purposes?.includes('rule-execution') && !preview.executionSummaries?.length && <p className="studio-note is-warning">本预览未提供可核定的规则执行快照，相关用途待核；不从用途名称推断执行资格。</p>}
  </section>;
}

/** UI invalidation for changed selected asset identities. The Host still validates the full fingerprint. */
export function studioRulePreviewChanged(preview: Pick<StudioPublicationPreview, 'items'>, assets: StudioAsset[]): boolean {
  return preview.items.some(item => {
    const asset = assets.find(asset => asset.id === item.assetId);
    if (!asset || (asset.candidateRevision ?? asset.formalRevision) !== item.revision) return true;
    return !asset.revisions.some(revision => revision.revision === item.revision && revision.sha256 === item.sha256);
  });
}

/** Read-only projection of one parsed source revision. It never runs or grades a rule. */
export function StudioRuleExecutionView({ profile, sourceRef, onReadSource, publication = false }: { profile: FoundationContent; sourceRef?: StudioSourceRef; onReadSource?: ReadSource; publication?: boolean }) {
  if (profile.contentProfile !== 'studio-foundation/2') return null;
  const execution = profile.ruleExecution;
  if (!execution) return <p className="studio-note">尚未选择规则执行表示；可读定义与原三类资产继续沿本准确版本使用。</p>;
  return <section className="studio-foundation-section studio-rule-execution" aria-label="可执行规则与事实条件">
    <div className="studio-row"><h3>可执行规则与事实条件</h3><span className="studio-badge">声明式范围</span></div>
    <p className="studio-meta">有限事实、无环依赖、正向合取。{publication ? '发布仅对应本准确版本与用途，不代表已执行。' : '本页展示准确源稿中的表示，不代表已执行。'}实际结论与完成范围见本次工具调用回执；作者状态与独立核验分别保留。</p>
    <p className="studio-meta">{execution.engine.name} {execution.engine.version} · {execution.contractVersion}</p>
    {sourceRef && <ExactSources refs={[sourceRef]} onReadSource={onReadSource} />}
    <div className="studio-rule-definitions">{execution.rules.map(rule => {
      const item = profile.items.find(item => item.itemId === rule.ruleItemId);
      return <article key={rule.ruleId} className="studio-rule-definition">
        <h4>{item?.name || rule.ruleItemId}</h4><p>{item?.definition || '可读规则定义待核。'}</p>
        <p className="studio-meta">规则 {rule.ruleId} · 原条目 {rule.ruleItemId}</p>
        {item && <ExactSources refs={[item.sourceRef]} onReadSource={onReadSource} />}
        <details><summary>查看本版条件与显式结论</summary><p className="studio-meta">条件为正向合取；未推出不等于显式不符合。</p>
          <ul>{rule.conditions.map((condition, index) => <li key={index}><code>{condition}</code></li>)}</ul>
          <p>显式结论：<code>{rule.conclusion}</code></p>
        </details>
      </article>;
    })}</div>
    <h4>所需事实</h4><p className="studio-meta">缺失保持未知。事实需求和来源声明不代表事实已核实，金额、日期及聚合仍沿原获准计算工具。</p>
    <RuleTable headings={['事实与字段', '身份、粒度与时间', '准确输入与 Binding']}>
      {execution.factRequirements.map(requirement => <tr key={requirement.requirementId}>
        <td><strong>{requirement.requirementId}</strong><p><code>{requirement.predicate}</code></p><p>{requirement.kind === 'observed' ? '观察事实' : '外部计算事实'}</p><p>{requirement.fields.join('、')}</p></td>
        <td>粒度：{requirement.grain}<br />单位：{requirement.unit}<br />时间基准：{requirement.timeBasis}<p>覆盖与缺失：{requirement.coverage}</p></td>
        <td><ExactSources refs={[requirement.sourceRef, requirement.bindingRef]} onReadSource={onReadSource} />{requirement.calculationRefs?.length ? <><p className="studio-meta">原计算依据</p><ExactSources refs={requirement.calculationRefs} onReadSource={onReadSource} /></> : null}</td>
      </tr>)}
    </RuleTable>
    <details className="studio-rule-predicates"><summary>谓词、对象身份与支持范围</summary>
      <RuleTable headings={['谓词与命名空间', '对应条目', '参数与类型']}>
        {execution.predicates.map(predicate => <tr key={`${predicate.namespace}:${predicate.predicate}`}><td><code>{predicate.predicate}</code><p>{predicate.namespace}</p></td><td><code>{predicate.itemId}</code></td><td>{predicate.arguments.map(argument => <p key={argument.name}><code>{argument.name}</code> → {argument.itemId} · {argument.valueType}</p>)}</td></tr>)}
      </RuleTable>
      <p className="studio-meta">不支持递归、否定即失败、聚合／数值公式、任意函数或业务动作。当前表示不自动取得企业正式资格。</p>
    </details>
    {execution.constraints && <details className="studio-rule-constraints"><summary>所选用途的 SHACL 约束与依据</summary><p className="studio-meta">类型／关系／字段约束校验与规则执行分别记录，不代替企业政策正确性。</p><pre>{execution.constraints.shapes}</pre><ExactSources refs={execution.constraints.sourceRefs} onReadSource={onReadSource} /></details>}
  </section>;
}

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 2000 && value.every(text);
const completionLabels = { complete: '完整', incomplete: '未完成', unsupported: '不支持', cancelled: '已取消', failed: '失败' } as const;
const assessmentLabels = { derived: '已推出', 'explicit-negative': '显式不符合', 'insufficient-facts': '事实不足', conflict: '冲突', 'not-derived': '未推出' } as const;
const provenanceLabels: Record<string, string> = { complete: '本范围已保留官方返回的规则与前提', 'primary-rule-with-merged-premises': '仅返回主要规则，前提可能合并多个推导', 'not-executed': '尚未执行' };
const premisesLabels: Record<string, string> = { 'engine-reported-union': '引擎合并返回的前提，不代表同一次推导全部必需', 'engine-reported-premises': '引擎实际返回的前提' };
const limitationLabels: Record<string, string> = {
  'official-primary-rule-only-premises-may-merge-alternative-derivations': '官方只返回主要规则，前提可能合并多个推导；不代表同一次推导全部必需。',
  'input-coverage-incomplete': '输入覆盖不完整，缺口保留；不能输出完整有效总数。',
  'iteration-budget-cannot-guarantee-closure': '达到本次推导资源边界，不能证明本范围推导完整。',
  'conclusion-budget-exceeded': '返回的结论达到数量上限，仅代表本次实际返回范围。',
  'structural-constraint-violations-not-business-policy-judgment': '结构约束发现缺口；这与企业政策是否正确分别核对。',
};
type ReceiptSummary = StudioRuleReceipt;
function recordedSource(value: unknown): StudioSourceRef | undefined {
  if (!object(value) || !['enterprise', 'rap', 'data', 'sap-metric', 'sap-method', 'studio-source', 'task', 'case'].includes(String(value.authority)) || !text(value.id) || !text(value.version)) return;
  if (value.sha256 !== undefined && (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256))) return;
  for (const key of ['title', 'projectId', 'taskId', 'locator']) if (value[key] !== undefined && !text(value[key])) return;
  return { authority: value.authority as StudioSourceRef['authority'], id: value.id, version: value.version, ...(value.sha256 ? { sha256: value.sha256 as string } : {}), ...Object.fromEntries(['title', 'projectId', 'taskId', 'locator'].filter(key => value[key] !== undefined).map(key => [key, value[key]])) };
}

function recordedConstraints(value: Record<string, unknown>): Record<string, unknown> | undefined {
  if (typeof value.conforms !== 'boolean') return;
  const report: Record<string, unknown> = { conforms: value.conforms };
  for (const key of ['violation_count', 'warning_count']) {
    if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isSafeInteger(value[key]) || value[key] < 0)) return;
    if (value[key] !== undefined) report[key] = value[key];
  }
  const fields = ['focus_node', 'result_path', 'constraint', 'severity', 'message', 'value', 'shape', 'explanation', 'min_count', 'max_count', 'datatype', 'class_'];
  for (const key of ['violations', 'warnings', 'infos']) {
    const entries = value[key];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.length > 2000 || !entries.every(object)) return;
    report[key] = entries.map(entry => Object.fromEntries(fields.filter(field => entry[field] === null || ['string', 'number', 'boolean'].includes(typeof entry[field])).map(field => [field, entry[field]])));
  }
  return report;
}

function recordedFact(value: unknown): NonNullable<StudioRuleReceipt['factEvidence']>[number] | undefined {
  if (!object(value) || !['factId', 'statement', 'requirementId', 'locator'].every(key => text(value[key])) || !['observed', 'external-computation'].includes(String(value.kind)) || !Array.isArray(value.sourceRefs) || value.sourceRefs.length > 2000) return;
  const bindingRef = recordedSource(value.bindingRef), sourceRefs = value.sourceRefs.map(recordedSource);
  if (!bindingRef || sourceRefs.some(ref => !ref)) return;
  return { factId: value.factId as string, statement: value.statement as string, requirementId: value.requirementId as string, locator: value.locator as string, kind: value.kind as 'observed' | 'external-computation', bindingRef, sourceRefs: sourceRefs as StudioSourceRef[] };
}

/** A display guard for saved, possibly old payloads. Unknown fields never become evidence. */
function receiptSummary(value: unknown): ReceiptSummary | undefined {
  if (!object(value) || !object(value.identity) || !text(value.completion) || !Object.hasOwn(completionLabels, value.completion)) return;
  const identity = value.identity;
  for (const key of ['requestId', 'operationId', 'projectId', 'taskId', 'purpose', 'contractVersion', 'inputFingerprint']) if (!text(identity[key])) return;
  if (identity.enterpriseId !== undefined && !text(identity.enterpriseId)) return;
  if (!object(identity.engine) || identity.engine.name !== 'semantica' || identity.engine.version !== '0.7.0' || identity.contractVersion !== 'studio-rule-execution/1' || !strings(identity.ruleItemIds) || !Array.isArray(identity.sourceRefs) || identity.sourceRefs.length > 2000) return;
  if (!object(value.component) || value.component.name !== 'semantica' || value.component.version !== '0.7.0' || value.contractVersion !== 'studio-rule-execution/1' || typeof value.engineInvoked !== 'boolean' || value.factVerification !== 'agent-projection-not-independent-verification') return;
  const ruleRef = recordedSource(identity.ruleRef), factsRef = identity.factsRef === undefined ? undefined : recordedSource(identity.factsRef), sourceRefs = identity.sourceRefs.map(recordedSource);
  if (!ruleRef || identity.factsRef !== undefined && !factsRef || sourceRefs.some(ref => !ref)) return;
  if (!Array.isArray(value.conclusions) || value.conclusions.length > 2000 || !value.conclusions.every(item => object(item) && text(item.statement) && text(item.ruleId) && strings(item.premises) && (item.ruleItemId === undefined || text(item.ruleItemId)) && (item.confidence === undefined || typeof item.confidence === 'number' && Number.isFinite(item.confidence)))) return;
  if (!Array.isArray(value.assessments) || value.assessments.length > 2000 || !value.assessments.every(item => object(item) && text(item.targetId) && text(item.state) && Object.hasOwn(assessmentLabels, item.state))) return;
  if (!strings(value.limitations) || value.completion === 'complete' && !value.engineInvoked) return;
  const constraints = object(value.constraints) ? recordedConstraints(value.constraints) : undefined;
  if (value.constraints !== undefined && !constraints) return;
  let inputCoverage: StudioRuleReceipt['inputCoverage'];
  if (value.inputCoverage !== undefined) {
    const coverage = value.inputCoverage;
    if (!object(coverage) || typeof coverage.complete !== 'boolean' || !['detail', 'cutoffAt', 'businessTime'].every(key => text(coverage[key])) || !strings(coverage.missingRequirementIds)) return;
    inputCoverage = { complete: coverage.complete, detail: coverage.detail as string, cutoffAt: coverage.cutoffAt as string, businessTime: coverage.businessTime as string, missingRequirementIds: coverage.missingRequirementIds };
  }
  let factEvidence: StudioRuleReceipt['factEvidence'];
  if (value.factEvidence !== undefined) {
    if (!Array.isArray(value.factEvidence) || value.factEvidence.length > 2000) return;
    const facts = value.factEvidence.map(recordedFact); if (facts.some(fact => !fact)) return;
    factEvidence = facts as StudioRuleReceipt['factEvidence'];
  }
  return {
    identity: { requestId: identity.requestId as string, operationId: identity.operationId as string, ...(identity.enterpriseId ? { enterpriseId: identity.enterpriseId as string } : {}), projectId: identity.projectId as string, taskId: identity.taskId as string, purpose: identity.purpose as string, ruleRef, ruleItemIds: identity.ruleItemIds, ...(factsRef ? { factsRef } : {}), sourceRefs: sourceRefs as StudioSourceRef[], engine: { name: identity.engine.name, version: identity.engine.version }, contractVersion: identity.contractVersion, inputFingerprint: identity.inputFingerprint as string },
    completion: value.completion as StudioRuleReceipt['completion'], component: { name: 'semantica', version: '0.7.0' }, contractVersion: 'studio-rule-execution/1', engineInvoked: value.engineInvoked, factVerification: value.factVerification,
    conclusions: value.conclusions.map(item => ({ statement: item.statement, ruleId: item.ruleId, ...(item.ruleItemId ? { ruleItemId: item.ruleItemId } : {}), premises: item.premises, ...(typeof item.confidence === 'number' ? { confidence: item.confidence } : {}), ...(text(item.provenanceCompleteness) ? { provenanceCompleteness: item.provenanceCompleteness } : {}), ...(text(item.premisesNature) ? { premisesNature: item.premisesNature } : {}) })),
    assessments: value.assessments.map(item => ({ targetId: item.targetId, state: item.state })),
    ...(constraints ? { constraints } : {}), limitations: value.limitations,
    ...(inputCoverage ? { inputCoverage } : {}), ...(factEvidence ? { factEvidence } : {}),
    ...(text(value.provenanceQuality) ? { provenanceQuality: value.provenanceQuality } : {}),
  };
}

/** Only the original returned receipt is rendered; expanding it never executes or fetches. */
export function StudioRuleReceiptView({ receipt, historical = true, onReadSource }: { receipt: unknown; historical?: boolean; onReadSource?: ReadSource }) {
  const value = receiptSummary(receipt);
  if (!value) return <section className="studio-rule-receipt"><h3>规则工具调用</h3><p className="studio-note is-warning">规则调用回执未能核定 · UNKNOWN。原记录保持，不从成功文本补造规则、事实或结论。</p></section>;
  const { identity } = value;
  return <section className="studio-rule-receipt" aria-label="规则工具调用">
    <div className="studio-row"><h3>规则工具调用</h3><span className={`studio-badge${value.completion === 'failed' ? ' is-error' : value.completion !== 'complete' ? ' is-warning' : ''}`}>{completionLabels[value.completion]}</span></div>
    <p className="studio-meta">{historical ? '当时工具返回的固定历史回执；后续发布不替换本次规则与输入。' : '本次工具返回的准确回执。'}工具执行、作者采用和独立核验分别记录。</p>
    {value.completion !== 'complete' && <p className="studio-note is-warning">本次未取得完整业务结论；已返回范围与限制保留，不代表完整零结论。</p>}
    <dl className="studio-definition"><dt>用途</dt><dd>{identity.purpose}</dd><dt>原项目任务</dt><dd>{identity.projectId} / {identity.taskId}{identity.enterpriseId && <><br />企业 {identity.enterpriseId}</>}</dd><dt>引擎</dt><dd>{identity.engine.name} {identity.engine.version} · {value.engineInvoked ? '实际已调用' : '未调用'}</dd><dt>事实性质</dt><dd>Agent 提供的事实投影，未因调用而获得独立核验。</dd><dt>约束校验</dt><dd>{value.constraints ? value.constraints.conforms ? '约束通过' : '约束不通过' : '约束未运行／未提供回执'}</dd></dl>
    <ExactSources refs={[identity.ruleRef, ...(identity.factsRef ? [identity.factsRef] : []), ...identity.sourceRefs]} onReadSource={onReadSource} />
    {value.inputCoverage && <section><h4>输入覆盖与截止</h4><span className={`studio-badge${value.inputCoverage.complete ? '' : ' is-warning'}`}>{value.inputCoverage.complete ? '声明覆盖完整' : '覆盖不完整'}</span><p className="studio-meta">沿本次输入的覆盖声明，不代表独立核验。</p><dl className="studio-definition"><dt>输入范围</dt><dd>{value.inputCoverage.detail}</dd><dt>提取截止</dt><dd>{value.inputCoverage.cutoffAt}</dd><dt>业务时间</dt><dd>{value.inputCoverage.businessTime}</dd><dt>缺少的事实</dt><dd>{value.inputCoverage.missingRequirementIds.join('、') || '本输入未声明缺项'}</dd></dl></section>}
    {value.factEvidence && <details><summary>本次事实投影与记录定位</summary><p className="studio-meta">观察事实与外部计算事实沿原输入声明，派生结论另列；下列定位不因工具调用变成独立核验。</p><RuleTable headings={['本次事实', '性质与记录定位', '准确来源与 Binding']}>{value.factEvidence.map(fact => <tr key={fact.factId}><td><strong>{fact.factId}</strong><p><code>{fact.statement}</code></p></td><td>{fact.kind === 'observed' ? '观察事实' : '外部计算事实'}<p>{fact.requirementId}</p><p>{fact.locator}</p></td><td><ExactSources refs={[...fact.sourceRefs, fact.bindingRef]} onReadSource={onReadSource} /></td></tr>)}</RuleTable></details>}
    <h4>对目标的判断</h4><p className="studio-meta">未推出不等于显式不符合；事实不足与冲突分别保留。</p>
    {value.assessments.length ? <RuleTable headings={['目标', '实际判断']}>
      {value.assessments.map((assessment, index) => <tr key={index}><td>{assessment.targetId}</td><td><span className={`studio-badge${assessment.state === 'conflict' ? ' is-error' : assessment.state === 'insufficient-facts' || assessment.state === 'not-derived' ? ' is-warning' : ''}`}>{assessmentLabels[assessment.state]}</span></td></tr>)}
    </RuleTable> : <p className="studio-meta">本回执未提供目标判断，不推定全部不符合。</p>}
    <details><summary>查看官方返回的结论、规则与前提</summary><p className="studio-meta">字段沿官方原返回展示；前提的完整性及规则对应范围以本回执限制为准，不从置信字段推断经营正确性。</p>
      {value.conclusions.length ? value.conclusions.map((conclusion, index) => <article key={index} className="studio-rule-definition"><p><code>{conclusion.statement}</code></p><p className="studio-meta">官方返回规则标识：{conclusion.ruleId}{conclusion.ruleItemId && ` · 原条目 ${conclusion.ruleItemId}`}</p><p className="studio-meta">官方返回前提</p><ul>{conclusion.premises.map((premise, index) => <li key={index}><code>{premise}</code></li>)}</ul>{conclusion.provenanceCompleteness && <p className="studio-meta">前提覆盖记录：{provenanceLabels[conclusion.provenanceCompleteness] || '原回执的前提覆盖尚未解释，见准确身份。'}</p>}{conclusion.premisesNature && <p className="studio-meta">前提性质：{premisesLabels[conclusion.premisesNature] || '原回执的前提性质尚未解释，见准确身份。'}</p>}</article>) : <p className="studio-meta">本回执未返回派生结论；结合完成状态与事实条件核对。</p>}
    </details>
    {value.constraints && <details><summary>实际 SHACL 约束回执</summary><pre>{JSON.stringify(value.constraints, null, 2)}</pre></details>}
    {value.limitations.length > 0 && <section><h4>实际范围与限制</h4><ul>{value.limitations.map((limitation, index) => <li key={index}>{limitationLabels[limitation] || limitation}</li>)}</ul></section>}
    <details><summary>原执行回执与准确身份</summary><p className="studio-meta">以下为原回执中可核定的字段；不回读当前来源或自动恢复当前使用资格。</p><pre>{JSON.stringify(value, null, 2)}</pre></details>
  </section>;
}
