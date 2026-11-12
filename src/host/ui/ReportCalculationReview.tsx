import { useEffect, useRef, useState } from 'react';
import type { ReportCalculationRunReceipt } from '../../agent/report-calculation-review.ts';
import type { ReportCalculationMaterial, ReportCalculationMaterialReceipt } from '../report-calculation-materials.ts';

const outcomeLabel: Record<ReportCalculationRunReceipt['outcome'], string> = {
  not_delegated: '本次未委派',
  completed: '意见已交回',
  failed: '复核未完成',
  cancelled: '复核已取消',
  unknown: '复核状态未知',
};
const materialLabel: Record<ReportCalculationMaterial['state'], string> = {
  provided: '已准备',
  truncated: '部分准备',
  unavailable: '未准备',
  'version-conflict': '版本冲突',
  metadata: '仅准备元数据',
};
type Summary = ReportCalculationRunReceipt & { sourceStatus?: 'unavailable' };
type Receipt = ReportCalculationMaterialReceipt & { sha256: string };
type MaterialRead = {
  receipt: Receipt;
  material: ReportCalculationMaterial;
  text: string | null;
  rangeUtf16: { start: number; end: number; total: number } | null;
  continuationStart: number | null;
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function readSummary(value: unknown): Summary | undefined {
  if (!object(value) || value.contract !== 'foreground-report-calculation-v1' || typeof value.requestId !== 'string'
    || typeof value.outcome !== 'string' || !Object.hasOwn(outcomeLabel, value.outcome)) return;
  return value as Summary;
}

function readReceipt(value: unknown, summary: Summary, projectId: string, taskId: string): Receipt | undefined {
  if (!object(value) || value.type !== 'optracall.report-calculation-materials' || typeof value.reviewId !== 'string'
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) || !object(value.owner)
    || value.owner.projectId !== projectId || value.owner.taskId !== taskId || value.owner.requestId !== summary.requestId
    || !Array.isArray(value.materials) || !value.materials.every(item => object(item) && typeof item.id === 'string'
      && typeof item.state === 'string' && Object.hasOwn(materialLabel, item.state) && object(item.locator))) return;
  return value as Receipt;
}

const rangeText = (range: ReportCalculationMaterial['rangeUtf16']) => range
  ? `字符 ${range.start}–${range.end} / ${range.total}（UTF-16）`
  : '正文范围未记录';
const materialPath = (material: ReportCalculationMaterial) => typeof material.locator.path === 'string'
  ? material.locator.path : material.id;

export function ReportCalculationReview({ projectId, taskId, value }: { projectId: string; taskId: string; value: unknown }) {
  const summary = readSummary(value);
  if (!summary) return null;
  const receipt = readReceipt(summary.receipt, summary, projectId, taskId);
  return <CalculationReviewRecord key={`${projectId}/${taskId}/${summary.requestId}/${receipt?.sha256}/${summary.sourceStatus}`}
    projectId={projectId} taskId={taskId} summary={summary} receipt={receipt} />;
}

function CalculationReviewRecord({ projectId, taskId, summary, receipt }: {
  projectId: string; taskId: string; summary: Summary; receipt?: Receipt;
}) {
  const [preview, setPreview] = useState<MaterialRead | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const available = summary.sourceStatus !== 'unavailable';
  const report = receipt?.materials.find(item => item.kind === 'report' && item.id === 'report');
  async function readInitial(start = 0) {
    if (!available || !receipt || !report) return;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setLoading(true); setError(''); setPreview(null);
    const query = new URLSearchParams({ expectedReceiptSha256: receipt.sha256, start: String(start), length: '20000' });
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/report-calculation-reviews/${encodeURIComponent(summary.requestId)}/${encodeURIComponent(receipt.reviewId)}/materials/${encodeURIComponent(report.id)}?${query}`, {
        mode: 'same-origin', credentials: 'omit', cache: 'no-store', headers: { 'x-optracall-client': '1' }, signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? '固定初稿当前无法读取。');
      const checked = readReceipt(result.receipt, summary, projectId, taskId);
      if (!checked || checked.sha256 !== receipt.sha256 || checked.reviewId !== receipt.reviewId || result.material?.id !== report.id
        || result.text !== null && typeof result.text !== 'string') throw new Error('初稿身份未能核对，请重新读取。');
      const range = result.rangeUtf16;
      if (typeof result.text === 'string' && (!object(range) || ![range.start, range.end, range.total].every(Number.isSafeInteger)
        || range.start !== start || Number(range.end) - start !== result.text.length || Number(range.end) > Number(range.total)
        || result.continuationStart !== null && result.continuationStart !== range.end)) throw new Error('初稿回读范围未能核对。');
      if (!controller.signal.aborted) setPreview(result as MaterialRead);
    } catch (fault) {
      if (!controller.signal.aborted) setError(fault instanceof Error ? fault.message : '固定初稿当前无法读取。');
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }
  return <details className="pdc-selected" onToggle={event => {
    if (!event.currentTarget.open) { operation.current?.abort(); setLoading(false); setPreview(null); setError(''); }
  }}>
    <summary>报告计算复核 · {outcomeLabel[summary.outcome]}</summary>
    <p className="pdc-help">父请求 {summary.requestId}</p>
    {!available ? <p className="pdc-help">原始材料当前不可读取，此版意见已隐藏。</p> : <>
      {report && <p>固定初稿 {materialPath(report)}</p>}
      {receipt && <details><summary>已准备的材料与范围</summary>
        <p className="pdc-help">此准备回执本身未核实实际提供范围。材料是否被阅读或理解未获证明。</p>
        <ul>{receipt.materials.map(material => <li key={material.id}>
          <p>{materialPath(material)} · {materialLabel[material.state]}</p>
          <p className="pdc-help">{rangeText(material.rangeUtf16)}</p>
          {material.limitations?.map((limitation, index) => <p className="pdc-help" key={index}>{limitation}</p>)}
        </li>)}</ul>
      </details>}
      {report && receipt && !['unavailable', 'version-conflict'].includes(report.state) && <button type="button" className="text-button" disabled={loading} onClick={() => void readInitial()}>查看固定初稿</button>}
      {loading && <p className="pdc-help" role="status">正在读取固定初稿…</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {preview && <div>
        <p className="pdc-help">固定初稿原文 · 本次回读 {rangeText(preview.rangeUtf16)}</p>
        {preview.text === null ? <p className="pdc-help">本次没有可回读的正文。</p> : <pre className="re-stream">{preview.text}</pre>}
        {preview.continuationStart !== null && <button type="button" className="text-button" disabled={loading} onClick={() => void readInitial(preview.continuationStart!)}>读取下一段</button>}
      </div>}
    </>}
  </details>;
}
