import { useEffect, useState } from 'react';
import { externalDispatchErrorText, readExternalDispatchSettings, type ExternalDispatchSettings as ExternalDispatchSettingsView } from './external-dispatch-client.ts';
import './external-dispatch.css';

/**
 * 设置·连接与执行方式中的「外派与执行方式」分区（冻结 Demo #setup 的生产实现，additive 挂入
 * ServiceConnections 设置视图）。基础路径卡（GitHub／资产与工作 MCP／资源／通用联合测试）与
 * 可选适配卡（WorkBuddy API/在线、Connector、联合测试）分开显示：全部数据来自真实 Host
 * 设置事实（settingsView），未验证的可选适配保持禁用陈述，绝不显示模拟按钮或已启用假象；
 * 核心未配置不阻断内部任务。
 */

const githubStatusLabel: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'gray' }> = {
  verified: { label: '已核验', tone: 'green' },
  unverified: { label: '已保存配置 · 待核验', tone: 'amber' },
  authorizing: { label: '等待本人授权', tone: 'amber' },
  expired: { label: '授权已失效', tone: 'amber' },
  unknown: { label: '结果待核', tone: 'amber' },
  error: { label: '核验未通过', tone: 'red' },
  disconnected: { label: '未配置', tone: 'gray' },
};
const testLabel: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'gray' }> = {
  passed: { label: '通过', tone: 'green' },
  failed: { label: '未通过', tone: 'red' },
  unverified: { label: '未验证', tone: 'gray' },
};

export function ExternalDispatchSettings() {
  const [settings, setSettings] = useState<ExternalDispatchSettingsView>();
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    readExternalDispatchSettings(controller.signal)
      .then(value => { if (!controller.signal.aborted) { setSettings(value); setError(''); } })
      .catch(fault => { if (!controller.signal.aborted && (fault as Error).name !== 'AbortError') setError(externalDispatchErrorText(fault)); });
    return () => controller.abort();
  }, [nonce]);
  const github = settings ? (githubStatusLabel[settings.core.github.status] ?? githubStatusLabel.disconnected!) : githubStatusLabel.disconnected!;
  const coreReady = settings?.core.github.verified === true && settings.core.protectedMcp.available && settings.core.executorClosedLoop.verified;
  const optional = settings?.optional;
  return <section className="ed-settings" aria-label="外派与执行方式">
    <header className="ed-settings-intro">
      <h3>外派与执行方式</h3>
      <p>核心路径就绪后，获准通用 Agent 可在授权内认领外派工作；可选适配未验证时保持禁用。核心未配置不阻断内部任务。</p>
    </header>
    {error && <div className="ed-notice" data-tone="error" role="alert">{error}<button type="button" className="text-button" onClick={() => setNonce(value => value + 1)}>重读设置状态</button></div>}
    {!settings && !error && <p className="ed-notice" role="status">正在读取外派设置…</p>}
    {settings && <div className="ed-settings-grid">
      <article className="ed-card" aria-label="基础路径">
        <div className="ed-card-head"><h2>基础路径 · GitHub Issue＋资产工作 MCP</h2><span className="ed-pill" data-tone={coreReady ? 'green' : 'amber'}>{coreReady ? '核心路径就绪' : '核心路径未配置'}</span></div>
        <div className="ed-card-body">
          <p>获准通用 Agent 自主领取；不需要可选适配的账号、在线助手或其 Connector。</p>
          <dl className="ed-meta section-space">
            <div><dt>GitHub</dt><dd>{settings.core.github.verified ? `已核验 · ${settings.core.github.accountLabel ?? '当前账号'}` : `未配置（${github.label}）`} <span className="ed-pill" data-tone={github.tone}>{github.label}</span></dd></div>
            <div><dt>资产与工作 MCP</dt><dd>{settings.core.protectedMcp.available ? '受保护入口已挂载，认证通用 Agent 接入' : `未挂载（${settings.core.protectedMcp.reason ?? '待接入'}）`} <span className="ed-pill" data-tone={settings.core.protectedMcp.available ? 'green' : 'amber'}>{settings.core.protectedMcp.available ? '就绪' : '待接入'}</span></dd></div>
            <div><dt>资源</dt><dd>默认策略 1 work / 24 小时；较低已批准策略优先，超过默认需另行确认 <span className="ed-pill" data-tone="gray">默认生效</span></dd></div>
            <div><dt>通用联合测试</dt><dd>{settings.core.executorClosedLoop.verified ? '领取/查读/回交/原任务核验闭环验证通过' : `未验证（${settings.core.executorClosedLoop.reason ?? 'not_exercised'}）`} <span className="ed-pill" data-tone={settings.core.executorClosedLoop.verified ? 'green' : 'gray'}>{settings.core.executorClosedLoop.verified ? '通过' : '未验证'}</span></dd></div>
          </dl>
          <p className="ed-muted section-space">真实产品需要自己的 GitHub 连接、受保护 MCP 入口与认证接单者。未配置这些外派条件，不阻断内部任务。</p>
        </div>
      </article>
      <article className="ed-card" aria-label="可选适配">
        <div className="ed-card-head"><h2>可选适配 · WorkBuddy 在线本机助手</h2><span className="ed-pill" data-tone={optional?.ready ? 'amber' : 'gray'}>{optional?.ready ? '工程闭环通过 · 真实联调另核' : '未验证，禁用'}</span></div>
        <div className="ed-card-body">
          <p>不作为纯 GitHub 外派的前提。只在用户选用且该具体配置的真实联合测试通过后，才允许尝试远程触发；单项通过不足以启用。</p>
          <dl className="ed-meta section-space">
            <div><dt>API/在线</dt><dd>{testLabel[optional?.verification.apiOnline ?? 'unverified'].label} <span className="ed-pill" data-tone={testLabel[optional?.verification.apiOnline ?? 'unverified'].tone}>{testLabel[optional?.verification.apiOnline ?? 'unverified'].label}</span></dd></div>
            <div><dt>WorkBuddy Connector</dt><dd>{testLabel[optional?.verification.connector ?? 'unverified'].label} <span className="ed-pill" data-tone={testLabel[optional?.verification.connector ?? 'unverified'].tone}>{testLabel[optional?.verification.connector ?? 'unverified'].label}</span></dd></div>
            <div><dt>联合测试</dt><dd>{optional?.verification.joint === 'passed' ? '触发→领取→同 MCP 查读→回交→原任务核验闭环通过；真实账号联调另核' : '未验证，不允许启用'} <span className="ed-pill" data-tone={optional?.verification.joint === 'passed' ? 'green' : 'gray'}>{optional?.verification.joint === 'passed' ? '通过' : '未验证 · 禁用'}</span></dd></div>
            <div><dt>触发额度</dt><dd>每份授权最多 {optional?.quota.limit ?? 3} 次 API 触发（含修订）；submitted/UNKNOWN 占额，不跨轮次或修订重置</dd></div>
          </dl>
          <p className="ed-muted section-space">未验证状态由 Host 合同强制：任何触发请求都会被拒绝，纯 GitHub 路径不受影响、不消耗其额度。可跨机器调用，但目标助手须已授权在线且能访问受保护资产 MCP；不承诺唤醒睡眠电脑、启动退出应用或精确选定同账号多台设备。</p>
        </div>
      </article>
    </div>}
  </section>;
}
