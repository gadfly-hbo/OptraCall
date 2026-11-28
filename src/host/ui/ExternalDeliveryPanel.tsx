import { useEffect, useState } from 'react';
import type { ExternalAssetRef, ExternalDeliveryRef, ReviewDecision } from '../external-work-types.ts';
import { externalDispatchErrorText, readTaskExternalDeliveries, type ExternalDeliveryWorkEntry } from './external-dispatch-client.ts';
import { externalWorkStatusView, type WorkStatusTone } from './ExternalWorkPanel.tsx';
import './external-dispatch.css';

/**
 * 交付与验收页（冻结 Demo #delivery 的生产实现）：外部交付，核验后接回原任务。
 * 全部内容来自真实 Host 台账——交付保全事实（字节/链接/缺件）、外部声明事实（done/notDone/
 * failed/unknown）与原 Agent 的 ReviewDecision 分开显示；GitHub 关闭不等于验收完成，
 * 本页不代外部宣称专业质量，也不把外部交付伪造成 native 成果。
 */

export type ExternalDeliveryPanelProps = {
  projectId: string;
  taskId: string;
  taskName: string;
  onSwitchPanel(panel: 'chat' | 'report' | 'external' | 'delivery' | 'assets'): void;
};

const bytesLabel = (bytes: number) => `${bytes} B`;
const fileKind = (name: string) => {
  const ext = name.includes('.') ? name.split('.').pop()! : '';
  return ext && ext.length <= 4 ? ext.toUpperCase().slice(0, 4) : 'FILE';
};
const shortId = (value: string) => value.length > 18 ? `${value.slice(0, 18)}…` : value;

type Tone = WorkStatusTone;
type VerificationRow = { item: string; declaration: string; state: { label: string; tone: Tone } };

const reviewedState = (review: ReviewDecision | undefined): { label: string; tone: Tone } =>
  review?.decision === 'accepted' ? { label: '已验证', tone: 'green' }
  : review?.decision === 'needs-supplement' ? { label: '需补充', tone: 'amber' }
  : review?.decision === 'rejected' ? { label: '未通过', tone: 'red' }
  : { label: '待核验', tone: 'gray' };

/** Verification rows are composed strictly from the delivery's reported facts; nothing is inferred. */
function verificationRows(delivery: ExternalDeliveryRef, review: ReviewDecision | undefined): VerificationRow[] {
  const rows: VerificationRow[] = [];
  for (const item of delivery.facts.done) rows.push({ item, declaration: '外部声明已完成', state: reviewedState(review) });
  for (const item of delivery.facts.unknown) rows.push({ item, declaration: '外部声称未知', state: { label: 'UNKNOWN · 外部声称未知', tone: 'amber' } });
  for (const item of delivery.facts.failed) rows.push({ item, declaration: '外部报告失败', state: { label: '失败 · 外部报告', tone: 'red' } });
  for (const item of delivery.facts.notDone) rows.push({ item, declaration: '外部声明未执行', state: { label: '未验证', tone: 'gray' } });
  if (!rows.length) rows.push({ item: '外部未提供分类事实', declaration: '清单无 done/notDone/failed/unknown 条目', state: { label: '未验证', tone: 'gray' } });
  return rows;
}

function ManifestSection({ delivery, review }: { delivery: ExternalDeliveryRef; review: ReviewDecision | undefined }) {
  const preserved = delivery.preservation === 'preserved';
  const overall: { tone: Tone; text: string } = preserved ? { tone: 'green', text: '已保全产物的本机字节保全与摘要核对通过；内容验收另由原任务 Agent 判断。' }
    : delivery.preservation === 'failed' ? { tone: 'red', text: `附件未通过完整性或保全核验${delivery.preservationReason ? `（${delivery.preservationReason}）` : ''}；失败材料保留可查，不接受、不冒充完整。` }
    : delivery.preservation === 'link-only' ? { tone: 'amber', text: '本交付仅有外部链接，字节未在本机保全；链接失效或后来变更不等于原材料已保存。' }
    : { tone: 'amber', text: '附件保全状态待核；每件产物都须完成本机字节保全与摘要核对，当前不允许自动接受。' };
  return <div className="section-space">
    <h3>附件 manifest <span className="ed-muted">· 外部来源 / revision {delivery.revision}</span></h3>
    <div className="ed-callout" data-tone={overall.tone} role="status">{overall.text}</div>
    <div className="ed-manifest">
      {(delivery.storage ?? []).map(entry => <div className="ed-manifest-item" key={entry.logicalPath}>
        <span className="ed-file-icon" aria-hidden="true">{fileKind(entry.logicalPath)}</span>
        <div>
          <strong>{entry.logicalPath}</strong>
          <p>revision {delivery.revision} · 已保存字节 · {bytesLabel(entry.bytes)}</p>
          <p className="ed-mono">本机保全摘要 sha256：{entry.sha256}</p>
          {review && <p>核验状态：{reviewedState(review).label}</p>}
        </div>
      </div>)}
      {(delivery.links ?? []).map(entry => <div className="ed-manifest-item" key={entry.logicalPath}>
        <span className="ed-file-icon" aria-hidden="true">LINK</span>
        <div>
          <strong>{entry.logicalPath}</strong>
          <p>仅链接 · 未保全（不冒充字节已验；仅登记，未下载）</p>
          <p className="ed-mono">{entry.url}</p>
          <p>摘要核对：未核对（尚无本机字节）</p>
        </div>
      </div>)}
      {!delivery.storage?.length && !delivery.links?.length && <p className="ed-muted">本交付未登记任何附件条目{delivery.preservationReason ? `（${delivery.preservationReason}）` : ''}。</p>}
    </div>
    <p className="ed-muted">清单承诺 sha256：<span className="ed-mono">{delivery.manifestHash}</span>{preserved ? ' · 与本机保全字节核对一致' : ' · 待与本机保全字节核对'}</p>
  </div>;
}

function DeliveryCard({ work, delivery }: { work: ExternalDeliveryWorkEntry; delivery: ExternalDeliveryRef }) {
  const review = work.reviews.filter(item => item.deliveryId === delivery.deliveryId).at(-1);
  const rows = verificationRows(delivery, review);
  return <section className="ed-card" aria-label={`外部交付 ${delivery.deliveryId}`}>
    <div className="ed-card-head"><h2>外部来源 · 工作片段交付{work.deliveries.length > 1 ? ` · revision ${delivery.revision}` : ''}</h2>{review ? <span className="ed-pill" data-tone={reviewedState(review).tone}>{reviewedState(review).label}</span> : <span className="ed-pill" data-tone="gray">待验收</span>}</div>
    <div className="ed-card-body">
      {delivery.late && <div className="ed-callout red" data-tone="red" role="alert">迟到交付已隔离保存，属于待核材料。原授权已撤回，不接受、不复活原工作。</div>}
      <div className="ed-row-wrap section-space">
        <span className="ed-pill" data-tone="gray">GitHub Closed ≠ 验收完成</span>
        <span className="ed-pill" data-tone={review?.decision === 'accepted' ? 'green' : 'amber'}>{review?.decision === 'accepted' ? 'Agent 已接受这一片段' : review ? 'Agent 已给出核验结论' : 'Agent 尚未接受'}</span>
        {delivery.preservation !== 'preserved' && <span className="ed-pill" data-tone={delivery.preservation === 'failed' ? 'red' : 'amber'}>{delivery.preservation === 'failed' ? '保全未通过' : delivery.preservation === 'link-only' ? '仅链接 · 待保全' : '保全待核'}</span>}
      </div>
      <div className="ed-table-wrap section-space" tabIndex={0} role="region" aria-label="交付核验表">
        <table>
          <thead><tr><th scope="col">检查项</th><th scope="col">外部交付声明</th><th scope="col">原任务核验状态</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={`${row.item}-${index}`}>
            <td>{row.item}</td>
            <td>{row.declaration}</td>
            <td><span className="ed-pill" data-tone={row.state.tone}>{row.state.label}</span></td>
          </tr>)}</tbody>
        </table>
      </div>
      <ManifestSection delivery={delivery} review={review} />
    </div>
  </section>;
}

function ConclusionCard({ work, onBackToTask }: { work: ExternalDeliveryWorkEntry; onBackToTask(): void }) {
  const review = work.reviews.at(-1);
  return <section className="ed-card" aria-label="Agent 的验收结论">
    <div className="ed-card-head"><h2>Agent 的验收结论</h2><span className="ed-pill" data-tone="gray">原任务判断</span></div>
    <div className="ed-card-body">
      <p className="ed-status-text">{review
        ? `${review.decision === 'accepted' ? '已接受' : review.decision === 'needs-supplement' ? '需补充' : '未接受'}：${review.reason}`
        : '收到附件不表示专业质量通过。原任务 Agent 会在获准范围内核查内容、准确引用与未知事项；GitHub 的关闭状态不能替代验收。'}</p>
      {review?.decision === 'accepted' && <>
        <div className="ed-callout section-space">接收成果只把这一片段接回原任务。若要沉淀为语义或分析资产，请沿既有候选、核定与发布流程处理；本页不产生正式资产，也不替换当前版本。</div>
        <div className="ed-actions section-space">
          <button type="button" className="secondary-button" onClick={onBackToTask}>提交资产候选</button>
          <button type="button" className="primary-button" onClick={onBackToTask}>继续原任务 →</button>
        </div>
        <p className="ed-muted">提交资产候选沿原任务由原 Agent 经既有候选流程提出。</p>
      </>}
    </div>
  </section>;
}

export function ExternalDeliveryPanel({ projectId, taskId, taskName, onSwitchPanel }: ExternalDeliveryPanelProps) {
  const [view, setView] = useState<{ works: ExternalDeliveryWorkEntry[] }>();
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setView(undefined); setError('');
    readTaskExternalDeliveries(projectId, taskId, controller.signal)
      .then(value => { if (!controller.signal.aborted) { setView(value); setError(''); } })
      .catch(fault => { if (!controller.signal.aborted && (fault as Error).name !== 'AbortError') setError(externalDispatchErrorText(fault)); });
    return () => controller.abort();
  }, [projectId, taskId, nonce]);
  const works = view?.works ?? [];
  const references: ExternalAssetRef[] = [];
  for (const work of works) for (const delivery of work.deliveries) for (const ref of delivery.assetsUsed) {
    if (!references.some(item => item.authority === ref.authority && item.id === ref.id && item.version === ref.version && item.hash === ref.hash)) references.push(ref);
  }
  return <div className="external-work-page">
    <div className="external-work-scroll">
      <header className="page-heading external-work-heading">
        <div><p className="eyebrow">DELIVERY &amp; ACCEPTANCE</p><h1>外部交付，核验后接回原任务</h1><p>以下附件均为外部来源；原任务 Agent 接受后沿原保存工具形成任务成果。原任务：{taskName}</p></div>
        <button type="button" className="text-button" onClick={() => onSwitchPanel('external')}>← 协作进展</button>
      </header>
      {error && <div className="ed-notice" data-tone="error" role="alert">{error}<button type="button" className="text-button" onClick={() => setNonce(value => value + 1)}>重读交付台账</button></div>}
      {!view && !error && <p className="ed-notice" role="status">正在读取交付台账…</p>}
      {view && !works.length && <section className="ed-card" aria-label="交付空状态">
        <div className="ed-card-body">
          <h2>尚未取得可验收的交付</h2>
          <p className="ed-lead">尚未授权外派，或外派工作还没有回交产物。先在原任务确认目标与必要权限。</p>
          <div className="ed-actions section-space">
            <button type="button" className="secondary-button" onClick={() => onSwitchPanel('external')}>返回外部协作</button>
            <button type="button" className="primary-button" onClick={() => onSwitchPanel('chat')}>继续查看原任务 →</button>
          </div>
        </div>
      </section>}
      {view && works.length > 0 && <div className="external-work-grid">
        <div className="ed-stack">
          {works.map(work => {
            const status = externalWorkStatusView({
              workId: work.workId, revision: work.revision, status: work.status, summary: work.summary, grantId: work.grant?.grantId ?? '', grantVersion: work.grant?.grantVersion ?? 1, createdAt: work.createdAt,
              publications: work.publications, claim: work.claim, deliveryCount: work.deliveries.length, reviewCount: work.reviews.length,
              latestReview: work.reviews.length ? { decision: work.reviews.at(-1)!.decision, reason: work.reviews.at(-1)!.reason } : null,
            });
            const sorted = [...work.deliveries].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
            const primary = [...sorted].reverse().find(delivery => !delivery.late) ?? sorted.at(-1);
            const older = sorted.filter(delivery => delivery !== primary && !delivery.late);
            const late = sorted.filter(delivery => delivery.late);
            return <div className="ed-stack" key={work.workId}>
              <section className="ed-card" aria-label={`交付工作 ${work.summary}`}>
                <div className="ed-card-body">
                  <div className="ed-row-wrap"><h2 style={{ margin: 0, fontSize: 16 }}>{work.summary}</h2><span className="ed-pill" data-tone={status.tone}>{status.label}</span></div>
                  <p className="ed-muted">交付标准：{work.deliveryCriteria}</p>
                </div>
              </section>
              {primary && <DeliveryCard work={work} delivery={primary} />}
              {late.map(delivery => <div className="ed-callout amber" data-tone="red" key={delivery.deliveryId} role="alert">迟到交付已隔离保存，属于待核材料。原授权已撤回，不接受、不复活原工作。交付 {shortId(delivery.deliveryId)} · revision {delivery.revision} · 保全状态 {delivery.preservation}。</div>)}
              {older.length > 0 && <section className="ed-old-delivery" aria-label="旧交付保留">
                <strong>旧交付保留可查</strong>
                <p className="ed-muted">同 work 的历史交付与核验记录原样保留；revision 更新使用新的有效领取，在原工单追加回传，原授权未增权。</p>
                {older.map(delivery => {
                  const oldReview = work.reviews.filter(item => item.deliveryId === delivery.deliveryId).at(-1);
                  return <details className="ed-preview section-space" key={delivery.deliveryId}>
                    <summary>查看旧交付 · revision {delivery.revision} · {shortId(delivery.deliveryId)}</summary>
                    <dl><div><dt>交付身份</dt><dd className="ed-mono">{delivery.deliveryId}</dd></div><div><dt>保全状态</dt><dd>{delivery.preservation}{delivery.preservationReason ? ` · ${delivery.preservationReason}` : ''}</dd></div><div><dt>清单承诺</dt><dd className="ed-mono">{delivery.manifestHash}</dd></div><div><dt>核验结论</dt><dd>{oldReview ? `${oldReview.decision} · ${oldReview.reason}` : '尚未核验'}</dd></div><div><dt>回传时间</dt><dd>{delivery.createdAt}</dd></div></dl>
                  </details>;
                })}
              </section>}
              <ConclusionCard work={work} onBackToTask={() => onSwitchPanel('chat')} />
            </div>;
          })}
        </div>
        <aside className="ed-stack">
          <section className="ed-card" aria-label="交付声明的实际引用">
            <div className="ed-card-head"><h2>交付声明的实际引用</h2></div>
            <div className="ed-card-body">
              {references.length ? references.map(ref => <div className="ed-list-row" key={`${ref.authority}/${ref.id}@${ref.version}`}>
                <div><strong>{ref.authority}/{ref.id}</strong><small>{ref.version} · <span className="ed-mono">{ref.hash}</span></small></div>
              </div>) : <p className="ed-muted">尚无获准资产的实际引用记录，交付不作资产采用声明。</p>}
              <button type="button" className="text-button section-space" onClick={() => onSwitchPanel('assets')}>查看资产取用 → 核对来源、版本与读取记录</button>
            </div>
          </section>
          <section className="ed-card" aria-label="验收范围">
            <div className="ed-card-body"><h3>验收范围</h3><p className="ed-muted">Host 校验身份、权限、清单与保存回执。原任务 Agent 判断专业内容与适用性；重要业务取舍回到用户及原 Case。</p></div>
          </section>
        </aside>
      </div>}
    </div>
  </div>;
}
