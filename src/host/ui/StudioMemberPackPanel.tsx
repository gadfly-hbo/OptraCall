import { useCallback, useEffect, useRef, useState } from 'react';
import { PersonalDialog } from './PersonalDialog.tsx';
import type { ClientProject } from './project-types.ts';
import type { StudioSystem } from './studio-api.ts';
import {
  confirmPackPreview,
  createResourceGrant,
  ensureEnterprisePack,
  listEnterprisePacks,
  listResourceGrants,
  preparePackPreview,
  reconcilePackReceipt,
  revokeResourceGrant,
  type EnterpriseDomainPack,
  type EnterprisePackPreview,
  type ResourceAuthorizationGrant,
} from './member-pack-client.ts';
import type { ResourceGrantOperation } from '../../../extensions/business-plugins/studio/enterprise-pack.ts';

const businessStatusText = { active: '已开展', not_launched: '未开展', unknown: '开展情况待核' };
const supportStatusText = {
  ready: '具备建设基础',
  definition_only: '仅可定口径',
  limited_calc: '可做受限计算',
  gap_material: '待补资料',
  gap_decision: '待业务裁定',
  not_needed: '本期无需建设',
};
const tierText = {
  'definition-reference': '定义参考',
  'limited-calculation': '受限计算',
  'formal-calculation': '正式计算',
};
const feedbackCategoryText = {
  task_miscalculation: '本次计算误算（原任务更正）',
  shared_refund_mapping: '共享退款映射（回原资产）',
  sap_formula: 'SAP 指标公式（回 SAP）',
  member_policy: '会员域政策规则（回会员域）',
  case_decision: '经营决定（保留在 Case）',
  ad_hoc_assumption: '临时假设（保留在原任务）',
};
const opText: Record<ResourceGrantOperation, string> = {
  'read-definition': '查阅定义',
  'cite-summary': '引用获准汇总',
  'read-detail-recalculate': '读取明细重算',
};

export interface StudioMemberPackPanelProps {
  enterpriseId: string;
  enterpriseName?: string;
  systems: StudioSystem[];
  projects: ClientProject[];
  currentProjectId?: string;
  onBuildGoal?: (goal: string, systemId?: string) => void;
  onOpenTask?: (projectId: string, taskId: string) => void;
}

export function StudioMemberPackPanel({
  enterpriseId,
  enterpriseName,
  systems,
  projects,
  currentProjectId,
  onBuildGoal,
  onOpenTask,
}: StudioMemberPackPanelProps) {
  const [pack, setPack] = useState<EnterpriseDomainPack | null>(null);
  const [grants, setGrants] = useState<ResourceAuthorizationGrant[]>([]);
  const [readOnlyRollback, setReadOnlyRollback] = useState(false);
  const [subTab, setSubTab] = useState<'panorama' | 'draft' | 'publication' | 'history' | 'grants'>('panorama');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [goalInput, setGoalInput] = useState('');
  const [activePreview, setActivePreview] = useState<EnterprisePackPreview | null>(null);
  const [decisionMap, setDecisionMap] = useState<Record<string, string>>({});

  // Grant form state
  const [grantProjectId, setGrantProjectId] = useState('');
  const [grantOp, setGrantOp] = useState<ResourceGrantOperation>('read-definition');
  const [grantStores, setGrantStores] = useState('');
  const [grantGrain, setGrantGrain] = useState('store-month');
  const [grantSummaryVer, setGrantSummaryVer] = useState('1');
  const [grantBasis, setGrantBasis] = useState('企业资料原权责方授权');

  const mounted = useRef(true);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const [packRes, grantRes] = await Promise.all([
        listEnterprisePacks(enterpriseId, 'member-operations', signal),
        listResourceGrants(enterpriseId, undefined, signal),
      ]);
      if (mounted.current && !signal?.aborted) {
        setPack(packRes.packs[0] ?? null);
        setReadOnlyRollback(packRes.readOnlyRollback);
        setGrants(grantRes.grants);
      }
    } catch (fault) {
      if (mounted.current && !signal?.aborted) {
        setError(fault instanceof Error ? fault.message : '会员运营资产包暂不可读。');
      }
    } finally {
      if (mounted.current && !signal?.aborted) setLoading(false);
    }
  }, [enterpriseId]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => { mounted.current = false; controller.abort(); };
  }, [refresh]);

  const writableProjects = projects.filter(p => !p.archivedAt);
  const primarySystem = systems[0];

  const handleInitPack = async () => {
    if (busy || !primarySystem) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await ensureEnterprisePack({
        requestId: crypto.randomUUID(),
        enterpriseId,
        systemId: primarySystem.id,
        ...(currentProjectId && writableProjects.some(p => p.id === currentProjectId) ? { projectId: currentProjectId } : {}),
        domain: 'member-operations',
        name: `${enterpriseName || '本企业'} · 会员运营资产包`,
      });
      setPack(res.pack);
      setNotice(`已定位企业会员运营包 ${res.pack.packCode}（跨项目保持同一身份）。`);
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '未能建立会员运营资产包。');
    } finally {
      setBusy(false);
    }
  };

  const handlePreparePreview = async () => {
    if (!pack || busy || !pack.purposes.length) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const nextNum = pack.packRevisions.length;
      const version = nextNum === 0 ? '1.0' : `1.${nextNum}`;
      const previousVersion = pack.packRevisions.at(-1)?.version;
      const decisions = pack.purposes.flatMap(p =>
        p.decisionChoices.map(c => ({
          purposeId: p.id,
          choiceId: c.id,
          selectedKey: decisionMap[`${p.id}:${c.id}`] ?? c.selectedKey ?? c.options[0]?.key ?? '',
          decidedBy: '企业会员运营负责人',
        })),
      );
      const res = await preparePackPreview(pack.id, {
        requestId: crypto.randomUUID(),
        ...(currentProjectId && writableProjects.some(p => p.id === currentProjectId) ? { projectId: currentProjectId } : {}),
        version,
        ...(previousVersion ? { previousVersion } : {}),
        purposeIds: pack.purposes.map(p => p.id),
        decisions,
        policyEffectiveFrom: pack.purposes[0]?.policyEffectiveFrom || new Date().toISOString().slice(0, 10),
        dataCutoffAt: pack.purposes[0]?.dataCutoffAt || new Date().toISOString().slice(0, 10),
        summary: `会员运营资产包 v${version} 按用途发布预览`,
      });
      setPack(res.pack);
      setActivePreview(res.preview);
      setSubTab('publication');
      setNotice(`已生成一份发布预览 v${version}，确认前可核对每个用途的范围、例外与权限。`);
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '准备发布预览未能完成。');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmPreview = async (preview: EnterprisePackPreview) => {
    if (!pack || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const receipts = preview.purposeSnapshots.flatMap((pm, pmIdx) =>
        pm.dependencies.map((dep, idx) => ({
          requestId: `P-${preview.version}-${pmIdx + 1}-${idx + 1}`,
          authority: dep.role === 'summary-result' ? 'studio-source' : dep.role,
          targetRef: dep.ref,
          status: 'succeeded' as const,
          detail: `原权威已确认准确版本 ${dep.ref.id}@${dep.ref.version}`,
          purposeIds: [pm.purposeId],
        })),
      );
      const res = await confirmPackPreview(pack.id, {
        requestId: crypto.randomUUID(),
        ...(currentProjectId && writableProjects.some(p => p.id === currentProjectId) ? { projectId: currentProjectId } : {}),
        previewId: preview.id,
        fingerprint: preview.fingerprint,
        confirmedBy: '企业会员运营负责人',
        moduleReceipts: receipts,
      });
      setPack(res.pack);
      setActivePreview(null);
      setNotice(`已完成 v${res.revision.version} 分项发布确认；首次独立使用仍需在新分析任务中分别验证。`);
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '确认发布未能完成。');
    } finally {
      setBusy(false);
    }
  };

  const handleReconcile = async (version: string, requestId: string, authority: string, targetRef: unknown, purposeIds: string[]) => {
    if (!pack || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await reconcilePackReceipt(pack.id, {
        requestId: crypto.randomUUID(),
        ...(currentProjectId && writableProjects.some(p => p.id === currentProjectId) ? { projectId: currentProjectId } : {}),
        version,
        receipt: {
          requestId,
          authority,
          targetRef,
          status: 'succeeded',
          detail: '核查原权威请求回执与目标指纹一致，补记成功并保留原未知/失败记录',
          purposeIds,
        },
      });
      setPack(res.pack);
      setNotice(`已核查原回执 ${requestId} 并更新依赖用途资格；历史轨迹完整保留。`);
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '核查原回执未能完成。');
    } finally {
      setBusy(false);
    }
  };

  const handleAddGrant = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !grantProjectId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const ops: ResourceGrantOperation[] = grantOp === 'read-definition'
        ? ['read-definition']
        : grantOp === 'cite-summary'
          ? ['read-definition', 'cite-summary']
          : ['read-definition', 'read-detail-recalculate'];
      const stores = grantStores.split(/[、,，\s]+/).map(s => s.trim()).filter(Boolean);
      await createResourceGrant({
        requestId: crypto.randomUUID(),
        enterpriseId,
        grantor: '企业资料原权责方',
        grantBasis: grantBasis.trim() || '项目资源授权',
        subjectType: 'project',
        subjectId: grantProjectId,
        resourceKind: grantOp === 'read-definition' ? 'definition' : grantOp === 'cite-summary' ? 'summary' : 'detail',
        operations: ops,
        scope: {
          ...(stores.length ? { stores } : {}),
          ...(grantOp === 'cite-summary' ? { summaryAssetId: 'authorized-summary', summaryVersion: grantSummaryVer.trim() || '1', summaryAuthority: '总部经营分析中心', grain: grantGrain.trim() || 'store-month' } : {}),
        },
      });
      await refresh();
      setNotice('已保存 Host 资源授权记录；客户端角色名不产生权限，实际取用均按此记录核验。');
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '保存资源授权未能完成。');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeGrant = async (grantId: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await revokeResourceGrant(grantId, '权限复核撤回', crypto.randomUUID());
      await refresh();
      setNotice('已撤回该项资源授权；后续查询与翻页将立即停止供给受影响项，原历史报告保留。');
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '撤回授权未能完成。');
    } finally {
      setBusy(false);
    }
  };

  const latestRevision = pack?.packRevisions.find(r => r.status === 'active') ?? pack?.packRevisions.at(-1);

  return (
    <section className="studio-record studio-member-pack" aria-label="企业会员运营资产包">
      <div className="studio-row">
        <div>
          <h3>企业会员运营资产包 {pack ? `· ${pack.packCode}` : ''}</h3>
          <p className="studio-meta">
            同一企业包承接企业线与会员线两条路线；跨人跨项目保持同一包身份，按用途发布、三层鉴权并保留原报告与修订历史。
          </p>
        </div>
        {!pack && primarySystem && !readOnlyRollback && (
          <button type="button" className="primary-button" disabled={busy} onClick={() => { void handleInitPack(); }}>
            初始化本企业会员运营包
          </button>
        )}
      </div>

      {readOnlyRollback && (
        <div className="studio-note is-warning" role="status">
          当前以回退只读模式运行（<code>--disable-member-pack</code>）：已有包版本、回执与历史依据保留只读，新写入与供给已停止。
        </div>
      )}
      {error && <div className="studio-note is-error" role="alert">{error}</div>}
      {notice && <div className="studio-note" role="status">{notice}</div>}
      {loading && <p className="studio-meta" role="status">正在核对本企业会员运营资产包…</p>}

      {!loading && !pack && !primarySystem && (
        <p className="studio-meta">先在本企业建立一个体系，即可承接会员运营资产包；点名用途可直接发起建设，无需先填全景。</p>
      )}

      {pack && (
        <>
          <nav className="studio-foundation-nav" aria-label="会员运营资产包视图">
            {([
              ['panorama', '覆盖与全景'],
              ['draft', `建设草案 (${pack.entries.length} 条 / ${pack.purposes.length} 用途)`],
              ['publication', `一份预览与分项回执 (${pack.packRevisions.length})`],
              ['history', `反馈、修订与历史 (${pack.feedbackItems.length})`],
              ['grants', `三层资源授权 (${grants.filter(g => !g.revokedAt).length})`],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={subTab === key} onClick={() => setSubTab(key)}>
                {label}
              </button>
            ))}
          </nav>

          {subTab === 'panorama' && (
            <div className="studio-member-pack-section">
              <div className="studio-row">
                <label className="studio-field" style={{ flex: 1 }}>
                  <span>本轮建设目标（宽目标出全景，点名用途如门店复购/身份归属/生日券/活跃/沉睡可直达）</span>
                  <input
                    value={goalInput}
                    placeholder="例如：盘点会员运营现状并给首批建设建议，或直接建设门店首购 30 日复购率"
                    onChange={e => setGoalInput(e.target.value)}
                  />
                </label>
                {onBuildGoal && (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={readOnlyRollback}
                    onClick={() => onBuildGoal(goalInput.trim() || '请按获准资料梳理本企业会员运营全景与首批建设建议，区分已开展/未开展/待核及用途缺口。', pack.systemId)}
                  >
                    在建设任务中推进
                  </button>
                )}
              </div>

              {pack.panorama ? (
                <>
                  <div className="studio-note">
                    <strong>本企业会员运营全景 · v{pack.panorama.version}</strong>
                    <p className="studio-meta">
                      {pack.panorama.brand} · {pack.panorama.channel} · 期间 {pack.panorama.period} · 资料截止 {pack.panorama.dataCutoffAt} · 经营目的：{pack.panorama.decisionPurpose}
                    </p>
                  </div>
                  {pack.panorama.recommendations.length > 0 && (
                    <section className="studio-record">
                      <h4>首批建设建议</h4>
                      {pack.panorama.recommendations.map(rec => (
                        <article key={rec.purposeKey} className="studio-coverage">
                          <div className="studio-row">
                            <strong>{rec.title}</strong>
                            <span className="studio-badge">{rec.ownerRole}</span>
                          </div>
                          <p>{rec.priorityReason}</p>
                          <p className="studio-meta">可先交付：{rec.deliverableNow} · 最小补证：{rec.minimumEvidence}</p>
                          <p className="studio-meta">完成条件：{rec.completionCriteria}</p>
                        </article>
                      ))}
                    </section>
                  )}
                  <section className="studio-record">
                    <h4>按经营问题查看业务现状与用途缺口</h4>
                    {pack.panorama.issues.map(iss => (
                      <details key={iss.id} className="studio-coverage">
                        <summary>
                          <strong>{iss.problemName}</strong> · {businessStatusText[iss.businessStatus]} · {supportStatusText[iss.assetSupportStatus]} ({iss.factOrInference === 'fact' ? '事实' : '推断'})
                        </summary>
                        <p>{iss.summary}</p>
                        <p className="studio-meta">对决定的影响：{iss.decisionImpact} · 下一步：{iss.nextStep}</p>
                        {iss.evidence.length > 0 && (
                          <ul>
                            {iss.evidence.map((ev, idx) => (
                              <li key={idx} className="studio-meta">
                                {ev.sourceRef.title || ev.sourceRef.id} ({ev.locator}) · 范围：{ev.scope}
                              </li>
                            ))}
                          </ul>
                        )}
                      </details>
                    ))}
                  </section>
                </>
              ) : (
                <p className="studio-meta">尚无全景记录。可在上方输入宽目标由 Pi Agent 盘点，或直接从已点名用途开始建设。</p>
              )}
            </div>
          )}

          {subTab === 'draft' && (
            <div className="studio-member-pack-section">
              <h4>两条路线合入同一企业草案</h4>
              {pack.entries.length > 0 ? (
                <div className="studio-table-wrap">
                  <table className="studio-foundation-table">
                    <thead>
                      <tr>
                        <th>业务问题与路线</th>
                        <th>采用动作</th>
                        <th>本企业决定与依据</th>
                        <th>生效期与例外</th>
                        <th>原权威维护</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pack.entries.map(entry => (
                        <tr key={entry.id}>
                          <td>
                            <strong>{entry.title}</strong>
                            <p className="studio-meta">{entry.routes.join(' + ')} · <code>{entry.entryKey}</code></p>
                          </td>
                          <td>{entry.action}</td>
                          <td>
                            <p>{entry.enterpriseBasis}</p>
                            <p className="studio-meta">范围：{entry.scope}{entry.decisionOwner ? ` · 负责人：${entry.decisionOwner}` : ''}</p>
                          </td>
                          <td>
                            <p className="studio-meta">{entry.validFrom || '未定'} → {entry.validTo || '长期'}</p>
                            {entry.exceptions.length > 0 && (
                              <p className="studio-meta">局部例外 {entry.exceptions.length} 项</p>
                            )}
                          </td>
                          <td>{entry.authorityRef ? `${entry.authorityRef.authority} · ${entry.authorityRef.id}@${entry.authorityRef.version}` : '企业包条目'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="studio-meta">尚未沉淀企业内化条目。</p>
              )}

              <h4>本包已建用途（跨项目同范围自动去重）</h4>
              {pack.purposes.length > 0 ? (
                <div className="studio-table-wrap">
                  <table className="studio-foundation-table">
                    <thead>
                      <tr>
                        <th>用途</th>
                        <th>层级与主体</th>
                        <th>范围、窗口与截止</th>
                        <th>缺口与排除</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pack.purposes.map(purpose => (
                        <tr key={purpose.id}>
                          <td>
                            <strong>{purpose.limitedCalculationName || purpose.title}</strong>
                            <p className="studio-meta"><code>{purpose.id}</code> · {purpose.purposeKey}</p>
                            {purpose.decisionChoices.map(c => (
                              <div key={c.id} className="studio-meta">
                                <span>取舍：{c.question}</span>
                                <select
                                  aria-label={c.question}
                                  value={decisionMap[`${purpose.id}:${c.id}`] ?? c.selectedKey ?? ''}
                                  onChange={e => setDecisionMap(prev => ({ ...prev, [`${purpose.id}:${c.id}`]: e.target.value }))}
                                >
                                  <option value="">待负责人选定</option>
                                  {c.options.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
                                </select>
                              </div>
                            ))}
                          </td>
                          <td>
                            <span>{tierText[purpose.tier]}</span>
                            <p className="studio-meta">统计单位：{purpose.subjectUnit}{purpose.windowDays ? ` · ${purpose.windowDays}日` : ''}</p>
                          </td>
                          <td>
                            <span>{purpose.scope.scopeKey}</span>
                            <p className="studio-meta">生效 {purpose.policyEffectiveFrom || '未定'} · 截止 {purpose.dataCutoffAt || '未核'}</p>
                            {purpose.availableHistoryDays !== undefined && purpose.observationWindowDays !== undefined && purpose.availableHistoryDays < purpose.observationWindowDays && (
                              <p className="studio-badge is-warning">历史 {purpose.availableHistoryDays}天 &lt; 所需 {purpose.observationWindowDays}天（待核）</p>
                            )}
                          </td>
                          <td>
                            <p className="studio-meta">排除：{purpose.exclusions.join('；') || '无'}</p>
                            <p className="studio-meta">缺口：{purpose.remainingGaps.join('；') || '无'}</p>
                          </td>
                          <td>{purpose.workItemStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="studio-meta">尚无已建用途。</p>
              )}

              {!readOnlyRollback && pack.purposes.length > 0 && (
                <div className="studio-actions">
                  <button type="button" className="primary-button" disabled={busy} onClick={() => { void handlePreparePreview(); }}>
                    生成一份发布预览
                  </button>
                </div>
              )}
            </div>
          )}

          {subTab === 'publication' && (
            <div className="studio-member-pack-section">
              {activePreview && (
                <PersonalDialog
                  drawer
                  title={`确认发布预览 · v${activePreview.version}`}
                  subtitle={`指纹 ${activePreview.fingerprint.slice(0, 12)}… · 事件生效 ${activePreview.policyEffectiveFrom || '未定'} · 资料截止 ${activePreview.dataCutoffAt || '未核'}`}
                  busy={busy}
                  onClose={() => setActivePreview(null)}
                  footer={
                    <>
                      <button type="button" className="secondary-button" disabled={busy} onClick={() => setActivePreview(null)}>返回</button>
                      <button type="button" className="primary-button" disabled={busy || readOnlyRollback} onClick={() => { void handleConfirmPreview(activePreview); }}>
                        确认并按用途发布
                      </button>
                    </>
                  }
                >
                  <p>{activePreview.summary}</p>
                  {activePreview.decisions.length > 0 && (
                    <section className="studio-record">
                      <h4>已冻结的业务取舍</h4>
                      <ul>
                        {activePreview.decisions.map(d => (
                          <li key={`${d.purposeId}:${d.choiceId}`}>{d.label}{d.decidedBy ? `（${d.decidedBy}）` : ''}</li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <section className="studio-record">
                    <h4>按用途发布的范围与限制</h4>
                    <ul>
                      {activePreview.purposeSnapshots.map(pm => (
                        <li key={pm.purposeId}>
                          <strong>{pm.limitedCalculationName || pm.title}</strong> · {tierText[pm.tier]} · 状态：{pm.status}
                          {pm.suspensionReason && <p className="studio-meta">限制：{pm.suspensionReason}</p>}
                        </li>
                      ))}
                    </ul>
                  </section>
                </PersonalDialog>
              )}

              {latestRevision ? (
                <>
                  <div className="studio-note">
                    <strong>当前发布版 v{latestRevision.version}</strong> · 状态：{latestRevision.status} · 清单摘要 <code>{latestRevision.manifestSha256.slice(0, 12)}…</code>
                    <p className="studio-meta">发布成功不等于企业首次真实使用已通过；请在新分析任务独立验证。</p>
                  </div>
                  <h4>各用途目录供给资格</h4>
                  <ul>
                    {latestRevision.purposeManifests.map(pm => (
                      <li key={pm.purposeId}>
                        <strong>{pm.limitedCalculationName || pm.title}</strong>（{tierText[pm.tier]}）·{' '}
                        <span className={`studio-badge ${pm.status === 'eligible' ? 'is-success' : 'is-warning'}`}>{pm.status}</span>
                        {pm.suspensionReason && <p className="studio-meta">{pm.suspensionReason}</p>}
                      </li>
                    ))}
                  </ul>
                  <h4>原权威分项发布回执（按发生顺序留存）</h4>
                  <div className="studio-table-wrap">
                    <table className="studio-foundation-table">
                      <thead>
                        <tr><th>原请求</th><th>原维护方</th><th>准确目标</th><th>结果</th><th>核查操作</th></tr>
                      </thead>
                      <tbody>
                        {latestRevision.moduleReceipts.map(r => (
                          <tr key={r.receiptId}>
                            <td><code>{r.requestId}</code></td>
                            <td>{r.authority}</td>
                            <td>{r.targetRef.title || r.targetRef.id}@{r.targetRef.version}</td>
                            <td><span className={`studio-badge ${r.status === 'succeeded' ? 'is-success' : 'is-warning'}`}>{r.status}</span> · {r.detail}</td>
                            <td>
                              {r.status !== 'succeeded' && !readOnlyRollback && (
                                <button
                                  type="button"
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() => { void handleReconcile(latestRevision.version, r.requestId, r.authority, r.targetRef, r.purposeIds); }}
                                >
                                  查原回执并恢复
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="studio-meta">尚无已确认的包发布版本。请先在建设草案中准备发布预览。</p>
              )}
            </div>
          )}

          {subTab === 'history' && (
            <div className="studio-member-pack-section">
              <h4>版本与升级影响</h4>
              {pack.packRevisions.length > 0 ? (
                <ul>
                  {[...pack.packRevisions].reverse().map(rev => (
                    <li key={rev.version}>
                      <strong>v{rev.version}</strong>（{rev.status}）· 截止 {rev.dataCutoffAt || '未核'} · 确认于 {rev.confirmedAt}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="studio-meta">暂无历史版本。</p>
              )}

              <h4>反馈与归属分流（同题同版追加证据）</h4>
              {pack.feedbackItems.length > 0 ? (
                <ul>
                  {pack.feedbackItems.map(fb => (
                    <li key={fb.id}>
                      <strong>{fb.feedbackCode} · {fb.title}</strong>（v{fb.packVersion} · {feedbackCategoryText[fb.category]} · 状态 {fb.status}）
                      <p className="studio-meta">已归集原回复证据 {fb.reports.length} 条；处理归属：{fb.targetAuthority}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="studio-meta">暂无从分析回复提交的反馈。</p>
              )}

              <h4>独立使用与核验记录</h4>
              {pack.useRecords.length > 0 ? (
                <ul>
                  {pack.useRecords.map(u => (
                    <li key={u.id}>
                      <strong>{u.reportRef.title || u.reportRef.id}</strong>（v{u.packVersion} · {u.accessLevel} · 独立核验：{u.independentVerification.status}）
                      <p className="studio-meta">{u.independentVerification.verdictDetail}</p>
                      {u.impactNotes?.map((note, idx) => (
                        <p key={idx} className="studio-meta">影响说明（v{note.newPackVersion}）：{note.note}</p>
                      ))}
                      {onOpenTask && (
                        <button type="button" className="text-button" onClick={() => onOpenTask(u.projectId, u.taskId)}>
                          查看原分析任务
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="studio-meta">尚无已记录的独立使用依据。</p>
              )}
            </div>
          )}

          {subTab === 'grants' && (
            <div className="studio-member-pack-section">
              <p className="studio-meta">Host 按此授权记录核验定义查阅、汇总引用与明细重算权限；客户端提交的角色名不产生权限。</p>
              {grants.length > 0 ? (
                <div className="studio-table-wrap">
                  <table className="studio-foundation-table">
                    <thead>
                      <tr><th>授权项目/主体</th><th>允许操作</th><th>范围与粒度</th><th>状态</th><th>操作</th></tr>
                    </thead>
                    <tbody>
                      {grants.map(g => (
                        <tr key={g.id}>
                          <td>{projects.find(p => p.id === g.subjectId)?.name || g.subjectId}</td>
                          <td>{g.operations.map(op => opText[op]).join('、')}</td>
                          <td>
                            {g.scope.stores?.length ? `门店：${g.scope.stores.join('、')}` : '无门店明细范围'}
                            {g.scope.grain ? ` · 粒度：${g.scope.grain}` : ''}
                            {g.scope.summaryVersion ? ` · 汇总 v${g.scope.summaryVersion}` : ''}
                          </td>
                          <td>{g.revokedAt ? `已撤回 (${g.revokedReason || ''})` : '有效'}</td>
                          <td>
                            {!g.revokedAt && (
                              <button type="button" className="text-button" disabled={busy} onClick={() => { void handleRevokeGrant(g.id); }}>
                                撤回授权
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="studio-meta">尚未为具体项目配置细粒度资源授权；未配置时沿用普通项目既有授权边界。</p>
              )}

              <form onSubmit={e => { void handleAddGrant(e); }} className="studio-record">
                <h4>新增项目资源授权</h4>
                <label className="studio-field">
                  <span>被授权项目</span>
                  <select required value={grantProjectId} onChange={e => setGrantProjectId(e.target.value)}>
                    <option value="">选择本企业项目</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="studio-field">
                  <span>最高操作层次</span>
                  <select value={grantOp} onChange={e => setGrantOp(e.target.value as ResourceGrantOperation)}>
                    <option value="read-definition">仅查阅正式定义（不提供汇总/明细）</option>
                    <option value="cite-summary">引用已授权汇总（需匹配期间与粒度）</option>
                    <option value="read-detail-recalculate">读取获准门店明细并重算</option>
                  </select>
                </label>
                {grantOp === 'cite-summary' && (
                  <>
                    <label className="studio-field"><span>汇总粒度</span><input value={grantGrain} onChange={e => setGrantGrain(e.target.value)} /></label>
                    <label className="studio-field"><span>汇总版本</span><input value={grantSummaryVer} onChange={e => setGrantSummaryVer(e.target.value)} /></label>
                  </>
                )}
                {grantOp === 'read-detail-recalculate' && (
                  <label className="studio-field"><span>允许读取的门店（顿号或逗号分隔）</span><input value={grantStores} onChange={e => setGrantStores(e.target.value)} placeholder="如：星桥直营店、柳岸直营店" /></label>
                )}
                <label className="studio-field"><span>授权依据</span><input required value={grantBasis} onChange={e => setGrantBasis(e.target.value)} /></label>
                <button type="submit" className="secondary-button" disabled={busy || !grantProjectId}>保存资源授权</button>
              </form>
            </div>
          )}
        </>
      )}
    </section>
  );
}
