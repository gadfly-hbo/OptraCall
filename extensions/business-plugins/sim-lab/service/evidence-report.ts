import type { SnapshotRecord } from '../types.ts';
import { snapshotRules } from '../kernel/model-rules.ts';

/** Export frozen values only; this is an evidence document, never a fresh simulation or a recommendation. */
export function snapshotReport(snapshot: SnapshotRecord): string {
  return [
    `# 经营推演证据 · ${snapshot.id} · ${snapshot.name.replaceAll('\n', ' ')}`,
    '', '确定性假设模型：不是现实预测、概率、优化推荐或因果效果。指标不预设经营结论。',
    '', `项目：${snapshot.projectId}`, `快照：${snapshot.id} · 固化于 ${snapshot.frozenAt}`,
    `草稿：${snapshot.draftId} · revision ${snapshot.draftRevision} · 运行 ${snapshot.runId}`,
    `方案：${snapshot.variant.id} · ${snapshot.variant.name.replaceAll('\n', ' ')}`,
    `引擎：${snapshot.engineVersion}`, `引擎输入 SHA-256：${snapshot.inputHash}`,
    '', '## 固定汇总指标', '', '| 指标 | 冻结值 |', '| --- | --- |',
    ...Object.entries(snapshot.result.summary).map(([key, value]) => `| ${key} | ${value === null ? '无' : value} |`),
    '', '## 完整快照、口径与边界', '', '以下为快照原记录及按所记引擎身份解析的规则；文件本身另有独立字节SHA-256，不能与引擎输入摘要混用。',
    '', '```json', JSON.stringify({ snapshot, model: snapshotRules(snapshot) }, null, 2), '```', '',
  ].join('\n');
}
