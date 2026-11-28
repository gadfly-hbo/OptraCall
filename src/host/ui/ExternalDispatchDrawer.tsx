import { useEffect, useState } from 'react';
import type { ExternalAssetRef } from '../external-work-types.ts';
import { authorizeExternalWork, externalDispatchErrorText, type ExternalAuthorizeResult, type ExternalDispatchGrantInput } from './external-dispatch-client.ts';
import './external-dispatch.css';

/**
 * 外派授权抽屉（冻结 Demo 授权抽屉的生产实现）：右侧 540px（≤620px 全宽）。
 * 业务目标可编辑、工作片段只读、接单方式 select（WorkBuddy 未验证禁用）、
 * 执行者/仓库按真实任务连接展示、资产勾选可缩小、期限 select、
 * 确切内容 dl 快照；Escape 关闭、焦点恢复由开启方保留。
 */

export type ExternalDispatchDrawerProps = {
  open: boolean;
  projectId: string;
  taskId: string;
  taskName: string;
  piece: string;
  repositories: string[];
  enterprise?: string;
  assets?: ExternalAssetRef[];
  sourceCaseRef?: { caseId: string; issueId: string };
  workbuddyReady?: boolean;
  busy?: boolean;
  onClose(): void;
  onChooseInternal(): void;
  onAuthorized(result: ExternalAuthorizeResult): void;
};

const assetLabel = (asset: ExternalAssetRef): string => `${asset.id} ${asset.version}`;

export function ExternalDispatchDrawer({ open, projectId, taskId, taskName, piece, repositories, enterprise, assets, sourceCaseRef, workbuddyReady, busy, onClose, onChooseInternal, onAuthorized }: ExternalDispatchDrawerProps) {
  const [goal, setGoal] = useState('');
  const [repository, setRepository] = useState(repositories[0] ?? '');
  const [enterpriseInput, setEnterpriseInput] = useState(enterprise ?? '');
  const [expiry, setExpiry] = useState('24');
  const [selectedAssets, setSelectedAssets] = useState<ExternalAssetRef[]>(assets ?? []);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setSelectedAssets(assets ?? []); setRepository(repositories[0] ?? ''); setEnterpriseInput(enterprise ?? ''); }, [open]);
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const onKey = (event: unknown) => { if ((event as { key?: string }).key === 'Escape' && !working) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, working]);
  if (!open) return null;
  const ready = goal.trim().length > 0 && repository.length > 0 && enterpriseInput.trim().length > 0;
  const confirm = async () => {
    if (!ready || working) { setError(!repository.trim() ? '本任务还没有可用的 GitHub 仓库绑定；请先在任务账号连接开启 GitHub 协作。' : !enterpriseInput.trim() ? '外派授权需要明确的企业范围；请在原项目核对后填写。' : '请先填写业务目标。'); return; }
    setWorking(true); setError('');
    const grant: ExternalDispatchGrantInput = {
      goal: goal.trim(),
      scope: piece,
      forbidden: '',
      allowedExecutors: ['generic-agent'],
      repository: { stableId: repository, visibility: 'private' },
      assetRefs: selectedAssets,
      enterprise: enterpriseInput.trim(),
      validUntil: new Date(Date.now() + Number(expiry) * 3_600_000).toISOString(),
      summary: piece,
      deliveryCriteria: '按业务目标与范围核对交付；如实报告已做/未做/失败/未知事项与实际使用的资产引用；不代外部宣称完成。',
      autoResumeAllowed: true,
      ...(sourceCaseRef ? { sourceCaseRef } : {}),
    };
    try { onAuthorized(await authorizeExternalWork(projectId, taskId, grant)); }
    catch (fault) { setError(externalDispatchErrorText(fault)); }
    finally { setWorking(false); }
  };
  return <div className="ed-drawer-backdrop" role="presentation">
    <section className="ed-drawer" role="dialog" aria-modal="true" aria-label="确认外派范围">
      <header className="ed-drawer-head">
        <div><h2>确认 GitHub 外派范围</h2><p>默认通用接单；不自动触发 WorkBuddy。</p></div>
        <button type="button" className="icon-button" aria-label="关闭抽屉" disabled={working} onClick={onClose}>×</button>
      </header>
      <div className="ed-drawer-body">
        <div className="ed-callout">发布后由获准的通用 Agent 认证领取，回交原任务核验。你仍可取消；取消是零外部动作。</div>
        <div className="ed-form-field">
          <label htmlFor="ed-goal">业务目标</label>
          <textarea id="ed-goal" value={goal} rows={3} maxLength={4000} onChange={event => setGoal(event.target.value)} placeholder={`为「${taskName}」写下这次外派要达成的业务目标`} />
        </div>
        <div className="ed-form-field">
          <strong>工作片段</strong>
          <p>{piece}</p>
          <small className="ed-muted">只处理该片段约定内容；不改生产、不联系客户、不扩范围、不发布正式资产。</small>
        </div>
        <div className="ed-form-field">
          <label htmlFor="ed-mode">接单方式</label>
          <select id="ed-mode" value="github" onChange={() => {}}>
            <option value="github">GitHub Issue 通用接单（默认）</option>
            <option value="workbuddy" disabled={!workbuddyReady}>可选：远程触发已在线的 WorkBuddy（{workbuddyReady ? '已验证配置' : '联合验证未通过，不可启用'}）</option>
          </select>
          <p className="ed-muted">WorkBuddy 是可选适配；API 在线或单项授权不能代替真实联合测试。此处仅展示真实台账中的验证状态。</p>
        </div>
        <div className="ed-form-field">
          <strong>允许的执行者</strong>
          <p>已批准通用 Agent 集合 · 首个认证有效领取；GitHub 留言不授予身份或资产权限。</p>
          <label htmlFor="ed-repository">GitHub 私有业务仓库</label>
          {repositories.length ? <select id="ed-repository" value={repository} onChange={event => setRepository(event.target.value)}>
            {repositories.map(item => <option key={item} value={item}>{item}</option>)}
          </select> : <p className="ed-callout amber" data-tone="amber">本任务还没有已核验的 GitHub 协作绑定；请先在任务账号连接开启，再确认外派。</p>}
          <label htmlFor="ed-enterprise">企业范围</label>
          <input id="ed-enterprise" value={enterpriseInput} maxLength={200} autoComplete="off" onChange={event => setEnterpriseInput(event.target.value)} placeholder="外派授权必须明确企业范围" />
        </div>
        <div className="ed-form-field">
          <strong>获准资产 · 可缩小</strong>
          {(assets ?? []).length ? assets!.map(asset => <label className="ed-check" key={`${asset.authority}/${asset.id}@${asset.version}`}>
            <input type="checkbox" checked={selectedAssets.some(item => item.id === asset.id && item.version === asset.version && item.hash === asset.hash)} onChange={event => setSelectedAssets(previous => event.target.checked ? [...previous, asset] : previous.filter(item => !(item.id === asset.id && item.version === asset.version && item.hash === asset.hash)))} />
            <span>{assetLabel(asset)}<small className="ed-muted">只读 · 精确版本 {asset.hash.slice(0, 8)}</small></span>
          </label>) : <p className="ed-muted">本轮未提供可授资产；外部执行者不读取任何资产正文，仅按工单与交付标准执行。</p>}
        </div>
        <div className="ed-form-field">
          <label htmlFor="ed-expiry">期限</label>
          <select id="ed-expiry" value={expiry} onChange={event => setExpiry(event.target.value)}>
            <option value="24">24 小时或工作结束，以先到为准</option>
            <option value="8">8 小时或工作结束，以先到为准</option>
            <option value="2">2 小时或工作结束，以先到为准</option>
          </select>
        </div>
        <section className="ed-auth-preview" aria-label="确切内容快照">
          <h3>确切内容快照</h3>
          <dl>
            <div><dt>业务目标</dt><dd>{goal.trim() || '（尚未填写）'}</dd></div>
            <div><dt>工作片段</dt><dd>{piece}</dd></div>
            <div><dt>接单方式</dt><dd>GitHub Issue 通用接单</dd></div>
            <div><dt>执行者</dt><dd>已批准通用 Agent 集合（首个认证有效领取）</dd></div>
            <div><dt>仓库</dt><dd>{repository || '（尚未选择）'} · private</dd></div>
            <div><dt>资产</dt><dd>{selectedAssets.length ? `${selectedAssets.length} 项精确版本 · 只读` : '无 · 不读取资产'}</dd></div>
            <div><dt>期限</dt><dd>{expiry} 小时或工作结束，以先到为准</dd></div>
            {sourceCaseRef && <div><dt>来源 Case</dt><dd>{sourceCaseRef.caseId} / {sourceCaseRef.issueId}</dd></div>}
          </dl>
        </section>
        {error && <p className="ed-notice" data-tone="error" role="alert">{error}</p>}
      </div>
      <footer className="ed-drawer-foot">
        <button type="button" className="secondary-button" disabled={working} onClick={onChooseInternal}>在 OptraCall 内完成</button>
        <button type="button" className="secondary-button" disabled={working} onClick={onClose}>取消</button>
        <button type="button" className="primary-button" disabled={!ready || working || Boolean(busy)} onClick={() => void confirm()}>{working ? '正在确认…' : '确认外派，范围内自主推进'}</button>
      </footer>
    </section>
  </div>;
}
