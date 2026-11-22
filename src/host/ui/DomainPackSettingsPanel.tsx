import { useCallback, useEffect, useRef, useState } from 'react';
import { PersonalDialog } from './PersonalDialog.tsx';
import {
  listDomainReferences,
  readDomainReferenceOriginal,
  registerDomainReference,
  registerRepoTemplate,
  type BuiltinTemplateSummary,
  type DomainReferenceRecord,
} from './member-pack-client.ts';
import type {
  DomainReferenceDomain,
  DomainReferenceEvidenceNature,
  DomainReferenceRoute,
  DomainReferenceVisibility,
} from '../../../extensions/business-plugins/studio/enterprise-pack.ts';

const domainLabels: Record<DomainReferenceDomain, string> = {
  member: '会员领域',
  product: '商品领域',
  store: '门店领域',
  supply: '供应链领域',
  marketing: '营销领域',
  enterprise: '企业标杆',
  benchmark: '第三方研究',
  other: '其他领域',
};

const natureLabels: Record<DomainReferenceEvidenceNature, string> = {
  'generic-draft': '通用参考草案',
  'public-benchmark': '公开披露标杆',
  'third-party-research': '第三方公开研究',
  'enterprise-official': '企业正式制度',
  'synthetic-fixture': '合成演练样例',
};

export function DomainPackSettingsPanel({ onOpenStudio }: { onOpenStudio?: () => void }) {
  const [references, setReferences] = useState<DomainReferenceRecord[]>([]);
  const [templates, setTemplates] = useState<BuiltinTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [registerOpen, setRegisterOpen] = useState(false);
  const [sourceId, setSourceId] = useState('DAP-MEMBER-001');
  const [version, setVersion] = useState('0.1');
  const [title, setTitle] = useState('会员领域包（通用）');
  const [domain, setDomain] = useState<DomainReferenceDomain>('member');
  const [routeChoice, setRouteChoice] = useState<'domain' | 'enterprise' | 'both'>('domain');
  const [maintainer, setMaintainer] = useState('通用模板维护方');
  const [scope, setScope] = useState('会员身份去重、有效购买、首购队列、观察窗与退款处理');
  const [evidenceNature, setEvidenceNature] = useState<DomainReferenceEvidenceNature>('generic-draft');
  const [restrictions, setRestrictions] = useState('通用参考草案，不替代目标企业正式依据');
  const [locator, setLocator] = useState('synthetic://member-domain-asset-package.md');
  const [visibility, setVisibility] = useState<DomainReferenceVisibility>('shared');
  const [contentBody, setContentBody] = useState('');

  const [originalDialog, setOriginalDialog] = useState<{
    record: DomainReferenceRecord;
    text?: string;
    sha256?: string;
    error?: string;
    loading: boolean;
  }>();
  const mounted = useRef(true);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const data = await listDomainReferences(undefined, signal);
      if (mounted.current && !signal?.aborted) {
        setReferences(data.references);
        setTemplates(data.builtinTemplates);
      }
    } catch (fault) {
      if (mounted.current && !signal?.aborted) {
        setError(fault instanceof Error ? fault.message : '领域资产包参考目录暂不可读。');
      }
    } finally {
      if (mounted.current && !signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => { mounted.current = false; controller.abort(); };
  }, [refresh]);

  const handleRegisterTemplate = async (templateId: 'T01' | 'T02' | 'T03' | 'T04') => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await registerRepoTemplate(templateId, crypto.randomUUID());
      await refresh();
      setNotice(
        res.outcome === 'created'
          ? `已核验原文 SHA-256 并登记仓库参考 ${res.record.sourceId} v${res.record.version}。`
          : res.outcome === 'reused'
            ? `已找到相同来源与版本（${res.record.sourceId} v${res.record.version}），复用原登记记录，未重复登记。`
            : `检测到同源同版异文（${res.record.sourceId} v${res.record.version}），保留原获准版本并将异文列为待核冲突。`,
      );
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '仓库参考登记未能完成。');
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterCustom = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const routes: DomainReferenceRoute[] = routeChoice === 'both' ? ['enterprise', 'domain'] : [routeChoice];
      const res = await registerDomainReference({
        requestId: crypto.randomUUID(),
        sourceId: sourceId.trim(),
        version: version.trim(),
        title: title.trim(),
        domain,
        routes,
        maintainer: maintainer.trim(),
        scope: scope.trim(),
        evidenceNature,
        evidenceRestrictions: restrictions.split(/[；;\n]/).map(s => s.trim()).filter(Boolean),
        locator: locator.trim(),
        visibility,
        ...(contentBody.trim() ? { contentBody } : { missingFields: ['原件正文尚未接入，暂不具备原文可回查资格'] }),
      });
      await refresh();
      setRegisterOpen(false);
      setNotice(
        res.outcome === 'created'
          ? `已登记 ${res.record.sourceId} v${res.record.version}（${res.record.contentStatus === 'available' ? '原文可回查' : '待补原件'}）。`
          : res.outcome === 'reused'
            ? `同源同版 ${res.record.sourceId} v${res.record.version} 已存在且摘要一致，已合并路线并复用原登记。`
            : `同源同版 ${res.record.sourceId} v${res.record.version} 正文摘要不同：已保留原获准版本，本次异文记入待核冲突。`,
      );
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '参考登记未能完成。');
    } finally {
      setBusy(false);
    }
  };

  const openOriginal = async (record: DomainReferenceRecord) => {
    setOriginalDialog({ record, loading: true });
    try {
      const data = await readDomainReferenceOriginal(record.id);
      if (mounted.current) {
        setOriginalDialog({ record: data.record, text: data.text, sha256: data.sha256, loading: false });
      }
    } catch (fault) {
      if (mounted.current) {
        setOriginalDialog({
          record,
          loading: false,
          error: fault instanceof Error ? fault.message : '原件正文当前不可回查，保留待补或原状态。',
        });
      }
    }
  };

  const visible = references.filter(item => {
    if (domainFilter !== 'all' && item.domain !== domainFilter) return false;
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return `${item.sourceId} ${item.version} ${item.title} ${item.maintainer} ${item.scope} ${item.locator}`.toLowerCase().includes(needle);
  });

  return (
    <section className="case-board capability-settings" aria-labelledby="settings-domain-pack-title">
      <header className="case-board-heading">
        <div>
          <h2 id="settings-domain-pack-title">领域资产包</h2>
          <p>按来源身份、准确版本与正文 SHA-256 登记行业与领域参考。同源同版只登记一次，异文保留待核，新旧版并存；参考登记不替代目标企业正式依据。</p>
        </div>
        <div className="studio-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setRegisterOpen(true)}>登记参考来源</button>
          {onOpenStudio && <button type="button" className="primary-button" onClick={onOpenStudio}>进入企业 Studio 建设</button>}
        </div>
      </header>

      {error && <p className="case-message case-error" role="alert">{error}</p>}
      {notice && <p className="case-message" role="status">{notice}</p>}

      {templates.length > 0 && (
        <section className="project-plan-section" aria-label="仓库内置公开参考模板">
          <h3>仓库内置公开参考（核验正文 SHA-256 后登记）</h3>
          <div className="report-action-row">
            {templates.map(tpl => (
              <button
                key={tpl.sourceId}
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => { void handleRegisterTemplate(tpl.sourceId); }}
              >
                登记 {tpl.sourceId} · {tpl.title} (v{tpl.version})
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="studio-filterbar">
        <label className="studio-search">
          <span className="sr-only">搜索已登记参考来源</span>
          <input
            type="search"
            value={query}
            placeholder="搜索来源编号、名称、版本、维护者或范围"
            onChange={event => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">按领域筛选</span>
          <select value={domainFilter} onChange={event => setDomainFilter(event.target.value)}>
            <option value="all">全部领域</option>
            {Object.entries(domainLabels).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      {loading && <p role="status">正在读取已登记的领域参考目录…</p>}
      {!loading && visible.length === 0 && (
        <p className="case-message">尚无已登记的领域参考来源。可登记仓库内置 Nike T03/T04 公开参考或自定义/合成参考来源。</p>
      )}

      {visible.length > 0 && (
        <div className="studio-table-wrap">
          <table className="studio-foundation-table">
            <thead>
              <tr>
                <th>来源与版本</th>
                <th>领域与路线</th>
                <th>维护者与适用范围</th>
                <th>证据性质与限制</th>
                <th>原文状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(ref => (
                <tr key={ref.id}>
                  <td>
                    <strong>{ref.title}</strong>
                    <p className="studio-meta"><code>{ref.sourceId}</code> · v{ref.version}</p>
                    <p className="studio-meta">{ref.locator}</p>
                  </td>
                  <td>
                    <span>{domainLabels[ref.domain]}</span>
                    <p className="studio-meta">
                      {ref.routes.length > 1 ? '企业线 + 会员/领域线共引' : ref.routes[0] === 'enterprise' ? '企业线' : '领域线'}
                    </p>
                  </td>
                  <td>
                    <span>{ref.maintainer}</span>
                    <p className="studio-meta">{ref.scope}</p>
                  </td>
                  <td>
                    <span>{natureLabels[ref.evidenceNature]}</span>
                    {ref.evidenceRestrictions.length > 0 && (
                      <p className="studio-meta">{ref.evidenceRestrictions.join('；')}</p>
                    )}
                  </td>
                  <td>
                    {ref.conflicts.some(c => c.status === 'pending') ? (
                      <span className="studio-badge is-warning">同版异文待核 ({ref.conflicts.length})</span>
                    ) : ref.contentStatus === 'available' ? (
                      <span className="studio-badge is-success">原文可回查</span>
                    ) : (
                      <span className="studio-badge">待补原件</span>
                    )}
                    {ref.contentSha256 && <p className="studio-meta"><code>{ref.contentSha256.slice(0, 12)}…</code></p>}
                  </td>
                  <td>
                    <button type="button" className="text-button" onClick={() => { void openOriginal(ref); }}>
                      查看原文与摘要
                    </button>
                    {onOpenStudio && (
                      <button type="button" className="text-button" onClick={onOpenStudio}>
                        进入企业包
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {registerOpen && (
        <PersonalDialog
          drawer
          title="登记领域参考来源"
          subtitle="同源同版摘要一致自动复用；异文保留原版并记入待核冲突"
          busy={busy}
          onClose={() => setRegisterOpen(false)}
          footer={
            <>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => setRegisterOpen(false)}>取消</button>
              <button type="submit" form="domain-ref-register-form" className="primary-button" disabled={busy}>核对并登记</button>
            </>
          }
        >
          <form id="domain-ref-register-form" onSubmit={event => { void handleRegisterCustom(event); }}>
            <label className="studio-field"><span>来源编号（如 DAP-MEMBER-001）</span><input required value={sourceId} onChange={e => setSourceId(e.target.value)} /></label>
            <label className="studio-field"><span>发布方版本</span><input required value={version} onChange={e => setVersion(e.target.value)} /></label>
            <label className="studio-field"><span>名称</span><input required value={title} onChange={e => setTitle(e.target.value)} /></label>
            <label className="studio-field">
              <span>所属领域</span>
              <select value={domain} onChange={e => setDomain(e.target.value as DomainReferenceDomain)}>
                {Object.entries(domainLabels).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            <label className="studio-field">
              <span>引用路线</span>
              <select value={routeChoice} onChange={e => setRouteChoice(e.target.value as 'domain' | 'enterprise' | 'both')}>
                <option value="domain">领域线</option>
                <option value="enterprise">企业线</option>
                <option value="both">两条路线共引</option>
              </select>
            </label>
            <label className="studio-field"><span>维护者</span><input required value={maintainer} onChange={e => setMaintainer(e.target.value)} /></label>
            <label className="studio-field"><span>适用范围</span><textarea required rows={2} value={scope} onChange={e => setScope(e.target.value)} /></label>
            <label className="studio-field">
              <span>证据性质</span>
              <select value={evidenceNature} onChange={e => setEvidenceNature(e.target.value as DomainReferenceEvidenceNature)}>
                {Object.entries(natureLabels).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            <label className="studio-field"><span>证据限制（分号分隔）</span><input value={restrictions} onChange={e => setRestrictions(e.target.value)} /></label>
            <label className="studio-field"><span>原文定位</span><input required value={locator} onChange={e => setLocator(e.target.value)} /></label>
            <label className="studio-field">
              <span>可见范围</span>
              <select value={visibility} onChange={e => setVisibility(e.target.value as DomainReferenceVisibility)}>
                <option value="public">公开参考</option>
                <option value="shared">共享参考</option>
              </select>
            </label>
            <label className="studio-field">
              <span>原文正文（留空则记为待补原件，不授予原文可回查资格）</span>
              <textarea rows={5} value={contentBody} onChange={e => setContentBody(e.target.value)} placeholder="粘贴获准原文或合成演练文本…" />
            </label>
          </form>
        </PersonalDialog>
      )}

      {originalDialog && (
        <PersonalDialog
          drawer
          title={`${originalDialog.record.title} · v${originalDialog.record.version}`}
          subtitle={`${originalDialog.record.sourceId} · ${originalDialog.record.locator}`}
          onClose={() => setOriginalDialog(undefined)}
          footer={<button type="button" className="secondary-button" onClick={() => setOriginalDialog(undefined)}>关闭</button>}
        >
          <dl className="studio-definition">
            <dt>证据性质</dt><dd>{natureLabels[originalDialog.record.evidenceNature]}</dd>
            <dt>限制说明</dt><dd>{originalDialog.record.evidenceRestrictions.join('；') || '无另列限制'}</dd>
            <dt>完整 SHA-256</dt><dd><code>{originalDialog.sha256 || originalDialog.record.contentSha256 || '待补原件（无正文摘要）'}</code></dd>
          </dl>
          {originalDialog.record.conflicts.length > 0 && (
            <div className="studio-note is-warning">
              <strong>同源同版异文待核（保留原获准版本，未静默替换）</strong>
              {originalDialog.record.conflicts.map(c => (
                <p key={c.id}>异文 SHA-256: <code>{c.incomingSha256}</code> · {c.note}（{c.detectedAt}）</p>
              ))}
            </div>
          )}
          {originalDialog.loading ? (
            <p role="status">正在核验原文摘要…</p>
          ) : originalDialog.error ? (
            <p className="studio-note is-warning">{originalDialog.error}</p>
          ) : (
            <pre className="studio-source-text">{originalDialog.text}</pre>
          )}
        </PersonalDialog>
      )}
    </section>
  );
}
