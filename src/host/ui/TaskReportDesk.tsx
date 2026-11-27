import { useEffect, useId, useRef, useState } from 'react';
import type { CaseRecord } from '../case-types.ts';
import type { DataContextSummary } from '../project-data-context-types.ts';
import { caseStatusLabel } from './CaseDialogs.tsx';
import * as caseApi from './case-client.ts';
import { conclusionCandidates, type ConclusionCandidates } from './conclusion-review-client.ts';
import * as pdcApi from './project-data-context-client.ts';
import { useViewport } from './ResponsiveWorkspacePanel.tsx';
import { readSavedReport } from './runtime-client.ts';

export type DeskReportCandidate = ConclusionCandidates['reports'][number];

const reportKeyOf = ({ relativePath, sha256 }: DeskReportCandidate) => `${relativePath}#${sha256 ?? ''}`;

export interface DeskEvidenceItem {
  index: number;
  id: string;
  title: string;
  kindLabel: string;
  statusLabel: string;
  needsReview?: boolean;
  citationId?: string;
  path: string;
  sha256?: string;
  bytes?: number;
  limitText: string;
  isXlsx?: boolean;
  read: () => Promise<string>;
}

export interface TaskReportDeskPersistedState {
  selectedReportKey?: string;
  selectedSourceId?: string;
  mobileDrawerOpen?: boolean;
}

export interface TaskReportDeskProps {
  projectId: string;
  projectName: string;
  taskId: string;
  taskName: string;
  taskTypeLabel?: string;
  initialReport?: DeskReportCandidate;
  sourceCase?: { caseId: string; caseTitle?: string };
  persistedState?: TaskReportDeskPersistedState;
  onPersistedStateChange?: (next: TaskReportDeskPersistedState) => void;
  onReportChange?: (report?: DeskReportCandidate) => void;
  onSwitchToChat: () => void;
  onOpenProject: () => void;
  onOpenCase: (caseId: string) => void;
  onOpenFiles: (trigger: HTMLButtonElement) => void;
  onOpenConclusionReview: (trigger: HTMLButtonElement) => void;
}

function buildEvidenceItems(
  projectId: string,
  reportPath: string,
  reportSha256: string,
  summary: DataContextSummary | null,
  basisFiles: readonly { relativePath: string }[],
): DeskEvidenceItem[] {
  const items: Omit<DeskEvidenceItem, 'index'>[] = [];
  const citations =
    summary?.citations.filter(
      record => record.report.originalPath === reportPath && record.report.sha256 === reportSha256,
    ) ?? [];

  for (const record of citations) {
    items.push({
      id: `decl:${record.citationId}`,
      title: `固定来源声明 · ${record.citationId.slice(0, 8)}`,
      kindLabel: '固定来源声明',
      statusLabel: '已固定',
      citationId: record.citationId,
      path: record.report.originalPath,
      sha256: record.report.sha256,
      bytes: record.report.bytes,
      limitText: '声明引用记录作者当时的来源说明，不自动证明模型实际采用或业务因果成立。',
      read: async () => {
        const { record: verified } = await pdcApi.readProjectDataCitation(projectId, record.citationId);
        if (
          verified.projectId !== projectId ||
          verified.citationId !== record.citationId ||
          verified.report.originalPath !== reportPath ||
          verified.report.sha256 !== reportSha256
        ) {
          throw new Error('固定来源身份未能核对。');
        }
        return [verified.declaration || '来源未声明', verified.revisionReason].filter(Boolean).join('\n\n');
      },
    });

    record.attachments.forEach((attachment, attIndex) => {
      items.push({
        id: `att:${record.citationId}:${attIndex}:${attachment.sha256}`,
        title: attachment.originalPath.split('/').at(-1) || attachment.originalPath,
        kindLabel: '固定附件',
        statusLabel: '已固定',
        citationId: record.citationId,
        path: attachment.originalPath,
        sha256: attachment.sha256,
        bytes: attachment.bytes,
        limitText: '按引用固定快照字节回读；即使当前工作目录同名文件变更或删除，也不会静默替换为其他文件。',
        read: async () =>
          pdcApi.projectDataEvidenceText(
            await pdcApi.readCitationEvidenceBytes(projectId, record.citationId, attachment, attIndex),
          ),
      });
    });

    for (const selection of record.selections) {
      const dataset = summary?.datasets.find(value => value.dataset.datasetId === selection.datasetId);
      const version = dataset?.versions.find(
        value =>
          value.projectId === projectId &&
          value.datasetId === selection.datasetId &&
          value.inputVersionId === selection.inputVersionId,
      );
      const description = selection.descriptionRevisionId
        ? dataset?.descriptions.find(
            value =>
              value.projectId === projectId &&
              value.datasetId === selection.datasetId &&
              value.inputVersionId === selection.inputVersionId &&
              value.descriptionRevisionId === selection.descriptionRevisionId,
          )
        : undefined;

      if (!version) {
        items.push({
          id: `inp-missing:${record.citationId}:${selection.datasetId}:${selection.inputVersionId}`,
          title: `原输入版本 · ${selection.inputVersionId.slice(0, 8)}`,
          kindLabel: '精确输入',
          statusLabel: '待核定',
          needsReview: true,
          citationId: record.citationId,
          path: `数据集 ${selection.datasetId} / 输入 ${selection.inputVersionId}`,
          sha256: undefined,
          limitText: '原输入版本记录缺失或暂不可核定；保留准确引用标识，不改用最新版本。',
          read: async () => {
            throw new Error('这份原输入版本无法核定；引用保留，不改用最新版本。');
          },
        });
      } else {
        const isXlsx = version.sourcePath.toLowerCase().endsWith('.xlsx');
        items.push({
          id: `inp:${record.citationId}:${selection.datasetId}:${version.inputVersionId}`,
          title: version.sourcePath.split('/').at(-1) || version.sourcePath,
          kindLabel: '固定输入',
          statusLabel: '已固定',
          citationId: record.citationId,
          path: version.sourcePath,
          sha256: version.sha256,
          bytes: version.bytes,
          isXlsx,
          limitText:
            description?.observation.limitations ||
            '按精确输入版本回读；公式缓存新鲜度及是否重算不能据读取成功推断。',
          read: async () => {
            const bytes = await pdcApi.readProjectDataEvidenceBytes(
              projectId,
              selection.datasetId,
              selection.inputVersionId,
              version,
            );
            if (isXlsx) {
              pdcApi.downloadProjectDataBytes(bytes, version.sourcePath.split('/').at(-1)!);
              return `已核对固定 XLSX 原件字节（${version.bytes.toLocaleString()} 字节，SHA-256 ${version.sha256}），并触发本机下载。`;
            }
            return pdcApi.projectDataEvidenceText(bytes);
          },
        });
      }
    }

    items.push({
      id: `rep:${record.citationId}`,
      title: `固定报告快照 · ${record.report.originalPath.split('/').at(-1)}`,
      kindLabel: '固定报告快照',
      statusLabel: '已固定',
      citationId: record.citationId,
      path: record.report.originalPath,
      sha256: record.report.sha256,
      bytes: record.report.bytes,
      limitText: '即使原路径文件后续被覆盖或删除，固定报告快照仍按记录时的 SHA-256 核对回读。',
      read: async () =>
        pdcApi.projectDataEvidenceText(
          await pdcApi.readCitationEvidenceBytes(projectId, record.citationId, record.report),
        ),
    });
  }

  // When no fixed citations exist yet, expose current basis files honestly as unpinned materials.
  if (items.length === 0) {
    for (const basis of basisFiles) {
      if (basis.relativePath === reportPath) continue;
      items.push({
        id: `basis:${basis.relativePath}`,
        title: basis.relativePath.split('/').at(-1) || basis.relativePath,
        kindLabel: '当前普通材料',
        statusLabel: '未固定',
        needsReview: true,
        path: basis.relativePath,
        limitText: '当前普通文件路径可变化，未声明与本报告的固定采用关系。',
        read: async () => (await pdcApi.readCurrentProjectDataText(projectId, basis.relativePath)).text,
      });
    }
  }

  return items.map((item, idx) => ({ ...item, index: idx + 1 }));
}

async function readLinkedReportCases(
  projectId: string, taskId: string, report: DeskReportCandidate, signal: AbortSignal,
): Promise<{ cases: CaseRecord[]; error?: string }> {
  const status = await caseApi.status(signal);
  if (status.state === 'uninitialized') return { cases: [] };
  if (status.state !== 'ready') throw new Error('Case 记录暂不可读取。');
  const index = await caseApi.list(signal);
  const ids = new Set(index.projectLinks.filter(link => link.projectId === projectId).map(link => link.caseId));
  const cases: CaseRecord[] = [];
  let error: string | undefined;
  for (const id of ids) {
    signal.throwIfAborted();
    try {
      const detail = await caseApi.detail(id, signal);
      if (detail.case.id !== id) throw new Error('Case 记录身份不匹配。');
      const linked = detail.artifacts.some(artifact =>
        artifact.caseId === id && artifact.projectId === projectId && artifact.taskId === taskId &&
        !artifact.unlinkedAt && artifact.availability === 'available' &&
        ((artifact.relativePath === report.relativePath && artifact.observedSha256 === report.sha256) ||
          (artifact.adoptedVersion?.sourceRelativePath === report.relativePath &&
            artifact.adoptedVersion.sourceSha256 === report.sha256))
      );
      if (linked) cases.push(detail.case);
    } catch {
      error = '部分 Case 暂不可读取。当前只显示已核对的关联。';
    }
  }
  return { cases, error };
}

export function TaskReportDesk({
  projectId,
  projectName,
  taskId,
  taskName,
  taskTypeLabel,
  initialReport,
  sourceCase,
  persistedState,
  onPersistedStateChange,
  onReportChange,
  onSwitchToChat,
  onOpenProject,
  onOpenCase,
  onOpenFiles,
  onOpenConclusionReview,
}: TaskReportDeskProps) {
  const selectId = useId();
  const isNarrow = useViewport('(max-width: 1050px)');
  const [candidates, setCandidates] = useState<ConclusionCandidates>();
  const [selected, setSelected] = useState<DeskReportCandidate | undefined>(initialReport);
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [candidateError, setCandidateError] = useState('');
  const [revision, setRevision] = useState(0);

  const [reportBody, setReportBody] = useState<{ key: string; text: string }>();
  const [readingReport, setReadingReport] = useState(false);
  const [reportError, setReportError] = useState('');

  const [summary, setSummary] = useState<DataContextSummary | null>(null);
  const [loadingEvidence, setLoadingEvidence] = useState(false);
  const [evidenceListError, setEvidenceListError] = useState('');

  const [readerTab, setReaderTab] = useState<'evidence' | 'cases'>('evidence');
  const [selectedSourceId, setSelectedSourceId] = useState<string | undefined>(persistedState?.selectedSourceId);
  const [sourceReadState, setSourceReadState] = useState<{
    id: string;
    loading: boolean;
    text?: string;
    error?: string;
  }>();
  const [mobileOpen, setMobileOpen] = useState(Boolean(persistedState?.mobileDrawerOpen));

  const [caseRefresh, setCaseRefresh] = useState(0);
  const [caseResult, setCaseResult] = useState<{
    key: string;
    cases: CaseRecord[];
    error?: string;
  }>();

  const originTriggerRef = useRef<HTMLElement | null>(null);
  const defaultOpenTriggerRef = useRef<HTMLButtonElement | null>(null);
  const desktopDetailHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const mobileDetailHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const mobileDialogRef = useRef<HTMLDialogElement | null>(null);
  const sourceEpochRef = useRef(0);

  const syncPersisted = (patch: Partial<TaskReportDeskPersistedState>) => {
    onPersistedStateChange?.({
      selectedReportKey: selected ? reportKeyOf(selected) : persistedState?.selectedReportKey,
      selectedSourceId,
      mobileDrawerOpen: mobileOpen,
      ...patch,
    });
  };

  // 1. Load report candidates for this task.
  useEffect(() => {
    const controller = new AbortController();
    setLoadingCandidates(true);
    setCandidateError('');
    void conclusionCandidates(projectId, taskId, controller.signal)
      .then(value => {
        if (controller.signal.aborted) return;
        setCandidates(value);
        setSelected(previous => {
          if (previous) return previous;
          if (persistedState?.selectedReportKey) {
            const fromPersisted = value.reports.find(item => reportKeyOf(item) === persistedState.selectedReportKey);
            if (fromPersisted) return fromPersisted;
          }
          const pre = value.preselected;
          return (
            value.reports.find(item => item.relativePath === pre?.relativePath && item.sha256 === pre?.sha256) ??
            value.reports.find(item => item.reviewable && item.sha256) ??
            value.reports[0]
          );
        });
      })
      .catch(fault => {
        if (!controller.signal.aborted) {
          setCandidateError(fault instanceof Error ? fault.message : '暂时无法核对本任务的报告列表。');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingCandidates(false);
      });
    return () => controller.abort();
  }, [projectId, taskId, revision]);

  const current =
    selected && candidates
      ? candidates.reports.find(item => reportKeyOf(item) === reportKeyOf(selected)) ?? selected
      : selected;
  const currentKey = current ? reportKeyOf(current) : '';

  // 2. Automatically read exact pinned report bytes AND project data-context citations when `current` changes.
  useEffect(() => {
    if (!current?.sha256) {
      setReportBody(undefined);
      setSummary(null);
      return;
    }
    onReportChange?.(current);
    const controller = new AbortController();
    setReadingReport(true);
    setReportError('');
    setLoadingEvidence(true);
    setEvidenceListError('');

    void readSavedReport(projectId, current.relativePath, current.sha256, controller.signal)
      .then(text => {
        if (!controller.signal.aborted) {
          setReportBody({ key: reportKeyOf(current), text });
        }
      })
      .catch(fault => {
        if (!controller.signal.aborted) {
          setReportBody(undefined);
          setReportError(
            fault instanceof Error
              ? fault.message
              : '这版报告当前路径无法按原 SHA-256 读取，未以其他版本替代。',
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setReadingReport(false);
      });

    void pdcApi
      .readProjectDataContext(projectId)
      .then(ctx => {
        if (!controller.signal.aborted) setSummary(ctx);
      })
      .catch(fault => {
        if (!controller.signal.aborted) {
          setSummary(null);
          setEvidenceListError(pdcApi.projectDataError(fault));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingEvidence(false);
      });

    return () => controller.abort();
  }, [projectId, currentKey, revision]);

  const evidenceItems =
    current?.sha256
      ? buildEvidenceItems(
          projectId,
          current.relativePath,
          current.sha256,
          summary,
          candidates?.basisFiles ?? [],
        )
      : [];

  const activeSource =
    evidenceItems.find(item => item.id === selectedSourceId) ??
    evidenceItems[0];

  function readSource(source: DeskEvidenceItem) {
    const ticket = ++sourceEpochRef.current;
    setSourceReadState({ id: source.id, loading: true });
    void source.read().then(text => {
      if (sourceEpochRef.current === ticket) setSourceReadState({ id: source.id, loading: false, text });
    }).catch(fault => {
      if (sourceEpochRef.current === ticket) {
        setSourceReadState({ id: source.id, loading: false, error: pdcApi.projectDataError(fault) });
      }
    });
  }

  useEffect(() => {
    if (!activeSource) {
      setSourceReadState(undefined);
    } else if (activeSource.isXlsx) {
      setSourceReadState({
        id: activeSource.id, loading: false,
        text: `固定 XLSX 数据文件（${activeSource.bytes?.toLocaleString() ?? 0} 字节）。点击下方按钮可按精确版本下载核对。`,
      });
    } else {
      readSource(activeSource);
    }
    return () => { sourceEpochRef.current++; };
  }, [activeSource?.id, revision]);

  // 4. Synchronize mobile `<dialog>` modal state cleanly.
  useEffect(() => {
    const dialog = mobileDialogRef.current;
    if (!dialog) return;
    if (isNarrow && mobileOpen) {
      if (!dialog.open) {
        try {
          dialog.showModal();
        } catch {
          dialog.setAttribute('open', '');
        }
      }
      requestAnimationFrame(() => mobileDetailHeadingRef.current?.focus({ preventScroll: true }));
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isNarrow, mobileOpen]);

  const restoreOriginFocus = () => {
    const target = originTriggerRef.current;
    requestAnimationFrame(() => {
      if (target?.isConnected && target.getClientRects().length > 0) {
        target.focus({ preventScroll: true });
      } else if (defaultOpenTriggerRef.current?.isConnected && defaultOpenTriggerRef.current.getClientRects().length > 0) {
        defaultOpenTriggerRef.current.focus({ preventScroll: true });
      }
    });
  };

  const closeEvidenceToOrigin = () => {
    if (mobileOpen) {
      setMobileOpen(false);
      syncPersisted({ mobileDrawerOpen: false });
    }
    restoreOriginFocus();
  };

  const selectEvidenceSource = (item: DeskEvidenceItem, trigger?: HTMLElement | null) => {
    if (trigger && !trigger.closest('[data-reader-host]')) {
      originTriggerRef.current = trigger;
    }
    setReaderTab('evidence');
    setSelectedSourceId(item.id);
    if (isNarrow) {
      setMobileOpen(true);
      syncPersisted({ selectedSourceId: item.id, mobileDrawerOpen: true });
    } else {
      syncPersisted({ selectedSourceId: item.id });
      requestAnimationFrame(() => desktopDetailHeadingRef.current?.focus({ preventScroll: true }));
    }
  };

  const openMobileEvidenceDrawer = (trigger: HTMLElement) => {
    originTriggerRef.current = trigger;
    setMobileOpen(true);
    syncPersisted({ mobileDrawerOpen: true });
  };

  const sourceFailed = Boolean(activeSource && sourceReadState?.id === activeSource.id && sourceReadState.error);
  const caseLookupKey = JSON.stringify([projectId, taskId, currentKey, revision, caseRefresh]);
  const caseLookup = caseResult?.key === caseLookupKey ? caseResult : undefined;
  const linkedCases = caseLookup?.cases;
  const caseError = caseLookup?.error;
  const caseBusy = readerTab === 'cases' && !caseLookup;

  useEffect(() => {
    if (readerTab !== 'cases') return;
    const controller = new AbortController();
    const { signal } = controller;
    setCaseResult(undefined);
    if (!current?.sha256) {
      setCaseResult({ key: caseLookupKey, cases: [] });
      return;
    }
    void readLinkedReportCases(projectId, taskId, current, signal).then(result => {
      if (!signal.aborted) setCaseResult({ key: caseLookupKey, ...result });
    }).catch(fault => {
      if (!signal.aborted) {
        setCaseResult({
          key: caseLookupKey, cases: [],
          error: fault instanceof Error ? fault.message : 'Case 记录暂不可读取。',
        });
      }
    });
    return () => controller.abort();
  }, [readerTab, caseLookupKey]);

  const renderReaderBody = (mobile: boolean) => (
    <>
      <div className="pv-reader-heading">
        <h3 tabIndex={-1}>报告与依据</h3>
        {mobile && (
          <button
            type="button"
            className="pv-dismiss"
            aria-label="关闭并返回来源"
            onClick={closeEvidenceToOrigin}
          >
            ×
          </button>
        )}
      </div>
      <div className="pv-reader-body">
        <nav className="pv-reader-tabs" aria-label="阅读侧栏">
          <button
            type="button"
            aria-pressed={readerTab === 'evidence'}
            onClick={() => setReaderTab('evidence')}
          >
            本次依据 <small>{evidenceItems.length}</small>
          </button>
          <button
            type="button"
            aria-pressed={readerTab === 'cases'}
            onClick={() => setReaderTab('cases')}
          >
            关联 Case <small>{linkedCases ? linkedCases.length : '核对'}</small>
          </button>
        </nav>

        {readerTab === 'evidence' ? (
          <>
            {loadingEvidence && <p className="pv-reader-note" role="status">正在读取固定来源与依据…</p>}
            {evidenceListError && <p className="cnr-notice error" role="alert">{evidenceListError}</p>}
            {!loadingEvidence && evidenceItems.length === 0 ? (
              <p className="pv-reader-empty">当前报告版本尚未记录固定依据或可选项目材料。</p>
            ) : (
              <>
                <div className="pv-source-list" role="region" aria-label="引用来源">
                  {evidenceItems.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className="pv-source-row"
                      aria-pressed={activeSource?.id === item.id}
                      onClick={event => selectEvidenceSource(item, event.currentTarget)}
                    >
                      <span className="pv-index">{String(item.index).padStart(2, '0')}</span>
                      <span>
                        <strong>{item.title}</strong>
                        <small>
                          {item.kindLabel}
                          {item.citationId ? ` · 引用 ${item.citationId.slice(0, 8)}` : ''}
                          {item.sha256 ? ` · ${item.sha256.slice(0, 8)}` : ' · 未固定'}
                        </small>
                      </span>
                      <b aria-hidden="true">↗</b>
                    </button>
                  ))}
                </div>

                {activeSource && (
                  <section className="pv-source-detail" aria-label="选中依据的原文及版本">
                    <div>
                      <span className={`pv-evidence-state ${activeSource.needsReview || sourceFailed ? 'needs-review' : ''}`}>
                        {sourceFailed ? '原件异常' : activeSource.statusLabel}
                      </span>
                      <small>依据 [{activeSource.index}]</small>
                    </div>
                    <h4
                      ref={mobile ? mobileDetailHeadingRef : desktopDetailHeadingRef}
                      tabIndex={-1}
                    >
                      {activeSource.title}
                    </h4>

                    <dl className="pv-source-meta-dl">
                      <dt>所属项目</dt>
                      <dd><code>{projectId}</code></dd>
                      <dt>引用标识</dt>
                      <dd>{activeSource.citationId ? <code>{activeSource.citationId}</code> : '未绑定固定引用'}</dd>
                      <dt>文件路径</dt>
                      <dd><code>{activeSource.path}</code></dd>
                      <dt>准确版本</dt>
                      <dd>{activeSource.sha256 ? <code>SHA-256 {activeSource.sha256}</code> : '未固定 SHA-256'}</dd>
                    </dl>

                    {sourceReadState?.id === activeSource.id && sourceReadState.loading ? (
                      <p className="pv-reader-note" role="status">正在按准确版本读取原文…</p>
                    ) : sourceReadState?.id === activeSource.id && sourceReadState.error ? (
                      <div className="cnr-notice error" role="alert">
                        <strong>无法读取该依据原文：</strong>{sourceReadState.error}
                        <div>已保留原项目、引用标识、路径与版本，未替换为其他文件。</div>
                      </div>
                    ) : (
                      <>
                        <pre
                          className="pv-evidence-pre"
                          tabIndex={0}
                          aria-label={`依据原文 · ${activeSource.title}`}
                        >
                          {sourceReadState?.id === activeSource.id ? sourceReadState.text : ''}
                        </pre>
                      </>
                    )}

                    {activeSource.isXlsx && (
                      <button type="button" className="secondary-button"
                        disabled={sourceReadState?.id === activeSource.id && sourceReadState.loading}
                        onClick={() => readSource(activeSource)}
                      >下载这份固定 XLSX 原件</button>
                    )}
                    <details>
                      <summary>适用范围与限制</summary>
                      <p>{activeSource.limitText}</p>
                    </details>
                  </section>
                )}
              </>
            )}
          </>
        ) : (
          <section className="pv-linked-cases" aria-label="本版报告关联 Case">
            <button
              type="button"
              className="text-button"
              disabled={caseBusy}
              onClick={() => setCaseRefresh(value => value + 1)}
            >
              {caseBusy ? '正在核对…' : '重新核对关联 Case'}
            </button>
            {caseError && <p className="cnr-notice error" role="alert">{caseError}</p>}
            {linkedCases?.map(record => (
              <div className="cnr-version" key={record.id}>
                <strong>{record.title}</strong>
                <small>修订 {record.revision} · {caseStatusLabel[record.status]}</small>
                <button type="button" className="secondary-button" onClick={() => onOpenCase(record.id)}>
                  查看关联 Case
                </button>
              </div>
            ))}
            {linkedCases?.length === 0 && !caseError && (
              <p className="pv-reader-empty">暂未查到与本任务及这版报告 SHA-256 相符的 Case 产物引用。</p>
            )}
          </section>
        )}

        <button
          type="button"
          className="pv-text-action pv-reader-return"
          onClick={closeEvidenceToOrigin}
        >
          ← 返回来源位置
        </button>
      </div>
    </>
  );

  const reportTitle = current
    ? current.relativePath.split('/').at(-1)?.replace(/\.md$/i, '') || current.relativePath
    : '结论报告';

  return (
    <div className="pv-desk-scroll">
      <section className="pv-view pv-task-view" aria-label="任务结论报告与依据工作台">
        <div className="pv-task-returns">
          <button type="button" className="text-button" onClick={onOpenProject}>
            ← 返回原项目
          </button>
          {sourceCase && (
            <button
              type="button"
              className="text-button pv-return-source-case"
              onClick={() => onOpenCase(sourceCase.caseId)}
            >
              ← 返回来源 Case · {sourceCase.caseTitle || sourceCase.caseId}
            </button>
          )}
        </div>

        <header className="pv-header">
          <div>
            <p className="eyebrow">
              {projectName}
              <span aria-hidden="true"> / </span>
              {taskTypeLabel || '任务报告'}
            </p>
            <h1>{taskName}</h1>
          </div>
          <div className="pv-header-controls">
            {candidates && candidates.reports.length > 0 && (
              <div className="pv-version-picker">
                <label htmlFor={selectId} className="sr-only">切换已保存报告版本</label>
                <select
                  id={selectId}
                  aria-label="切换已保存报告版本"
                  value={selected ? reportKeyOf(selected) : ''}
                  onChange={event => {
                    const next = candidates.reports.find(item => reportKeyOf(item) === event.target.value);
                    setSelected(next);
                    setSelectedSourceId(undefined);
                    syncPersisted({ selectedReportKey: next ? reportKeyOf(next) : undefined, selectedSourceId: undefined });
                    onReportChange?.(next);
                  }}
                >
                  {selected && !candidates.reports.some(item => reportKeyOf(item) === reportKeyOf(selected)) && (
                    <option value={reportKeyOf(selected)}>先前定位 · {selected.relativePath}</option>
                  )}
                  {candidates.reports.map(item => (
                    <option key={reportKeyOf(item)} value={reportKeyOf(item)}>
                      {item.relativePath} · {item.sha256?.slice(0, 10) ?? '待核'}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              type="button"
              className="text-button"
              disabled={loadingCandidates || readingReport}
              onClick={() => setRevision(value => value + 1)}
            >
              只读刷新
            </button>
            {current?.sha256 && (
              <span className="pv-report-status">
                <i aria-hidden="true" />
                报告版本 · {current.sha256.slice(0, 8)}
              </span>
            )}
          </div>
        </header>

        <div className="pv-analysis-desk">
          <nav className="pv-work-tabs" aria-label="任务工作区">
            <div>
              <button type="button" aria-pressed={false} onClick={onSwitchToChat}>
                <span className="pv-chat-icon" aria-hidden="true" />
                任务对话
              </button>
              <button type="button" aria-pressed={true}>
                <span className="pv-paper-icon" aria-hidden="true" />
                结论报告
              </button>
            </div>
            <button
              ref={defaultOpenTriggerRef}
              type="button"
              className="pv-open-evidence"
              aria-haspopup="dialog"
              aria-expanded={isNarrow ? mobileOpen : undefined}
              onClick={event => openMobileEvidenceDrawer(event.currentTarget)}
            >
              本次依据 <small>{evidenceItems.length}</small>
              <span aria-hidden="true">↗</span>
            </button>
          </nav>

          <div className="pv-workspace">
            <section className="pv-reading-pane" aria-label="本版报告">
              {loadingCandidates && <p role="status">正在核对已保存报告版本…</p>}
              {candidateError && <p className="cnr-notice error" role="alert">{candidateError}</p>}

              {!loadingCandidates && !current ? (
                <div className="pv-blank-task">
                  <h2>本任务尚无已保存报告</h2>
                  <p>可在任务对话中将回复保存至 060_reports，随后在此并排核对报告与依据。</p>
                  <button type="button" className="secondary-button" onClick={onSwitchToChat}>
                    返回任务对话
                  </button>
                </div>
              ) : current ? (
                <article className="pv-report" aria-label="结论报告">
                  <header>
                    <p className="pv-doc-meta">
                      <span className="pv-paper-icon" aria-hidden="true" /> 分析报告
                      <span>{current.sha256 ? `SHA-256 ${current.sha256.slice(0, 12)}` : '版本待核'}</span>
                    </p>
                    <h2>{reportTitle}</h2>
                    <p>
                      <code>{current.relativePath}</code>
                      <span aria-hidden="true"> · </span>
                      项目 <code>{projectId}</code>
                      {evidenceItems.length > 0 && (
                        <span className="pv-inline-citations" aria-label="报告引用快捷定位">
                          {evidenceItems.map(item => (
                            <button
                              key={item.id}
                              type="button"
                              className="pv-citation"
                              aria-label={`依据 ${item.index}，${item.title}`}
                              onClick={event => selectEvidenceSource(item, event.currentTarget)}
                            >
                              [{item.index}]
                            </button>
                          ))}
                        </span>
                      )}
                    </p>
                  </header>

                  {readingReport && <p role="status">正在读取本版报告原文…</p>}
                  {reportError && (
                    <div className="cnr-notice error" role="alert">
                      <strong>当前报告路径未能通过版本核对：</strong>{reportError}
                      <div>
                        原定位保留：项目 <code>{projectId}</code> · 路径 <code>{current.relativePath}</code> · 期望 SHA-256 <code>{current.sha256}</code>。若已登记固定来源，仍可在「报告与依据」中回读固定报告快照。
                      </div>
                    </div>
                  )}

                  {reportBody && reportBody.key === currentKey && (
                    <pre
                      className="pv-report-pre"
                      tabIndex={0}
                      aria-label={current.relativePath}
                    >
                      {reportBody.text}
                    </pre>
                  )}

                  {evidenceItems.length > 0 && (
                    <section className="pv-report-refs" aria-label="准确来源">
                      <h3>准确来源</h3>
                      {evidenceItems.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={event => selectEvidenceSource(item, event.currentTarget)}
                        >
                          <span>[{item.index}]</span>
                          <strong>{item.title}</strong>
                          <small>
                            {item.kindLabel}
                            {item.citationId ? ` · ${item.citationId.slice(0, 8)}` : ''}
                            {item.sha256 ? ` · ${item.sha256.slice(0, 8)}` : ''}
                          </small>
                          <b aria-hidden="true">↗</b>
                        </button>
                      ))}
                    </section>
                  )}

                  <div className="pv-resources" aria-label="任务资料与审查">
                    <button type="button" onClick={event => onOpenFiles(event.currentTarget)}>项目文件</button>
                    <span aria-hidden="true">·</span>
                    <button type="button" onClick={event => onOpenConclusionReview(event.currentTarget)}>审查结论与建议</button>
                    {sourceCase && (
                      <>
                        <span aria-hidden="true">·</span>
                        <button type="button" className="pv-text-action" onClick={() => onOpenCase(sourceCase.caseId)}>
                          返回来源 Case →
                        </button>
                      </>
                    )}
                  </div>
                </article>
              ) : null}
            </section>

            {!isNarrow && (
              <aside
                className="pv-reader-desktop"
                data-reader-host
                aria-label="报告与依据"
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    closeEvidenceToOrigin();
                  }
                }}
              >
                {renderReaderBody(false)}
              </aside>
            )}
          </div>
        </div>

        <dialog
          ref={mobileDialogRef}
          className="pv-reader-mobile"
          data-reader-host
          aria-label="报告与依据"
          onCancel={event => {
            event.preventDefault();
            closeEvidenceToOrigin();
          }}
        >
          {isNarrow && mobileOpen ? renderReaderBody(true) : null}
        </dialog>
      </section>
    </div>
  );
}
