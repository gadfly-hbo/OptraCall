import type { ConclusionReviewRecord, ConclusionReviewClaim } from './conclusion-review-contract.ts';
import { VerificationStoreError } from './verification-store.ts';

const label: Record<ConclusionReviewClaim['verdict'], string> = { supported: '证据支持', conditional: '有条件支持', insufficient: '证据不足', conflicting: '与证据冲突' };

/** Present the Agent's saved findings; the Host adds no business judgement. */
export function conclusionReviewFeedback(record: ConclusionReviewRecord): string {
  if (record.state !== 'completed' || !record.reviewResult) throw new VerificationStoreError('conclusion_review_not_completed');
  const result = record.reviewResult.output;
  const materials = new Map(record.review.materials.map(material => [material.id, material]));
  const evidenceSource = (item: ConclusionReviewClaim['evidence'][number]) => {
    const material = materials.get(item.materialId);
    return [
      `${item.materialId} · ${material?.locator ?? '来源身份未记录'}`,
      ...(material?.sha256 ? [`来源版本 SHA-256：${material.sha256}`] : []),
      ...(material?.rangeUtf16 ? [`固定包正文范围 [${material.rangeUtf16.start}, ${material.rangeUtf16.end}) / ${material.rangeUtf16.total} UTF-16`] : []),
      `审查 Agent 所引位置：${item.locator}`,
      ...(item.quote ? [`引文：${item.quote}`] : []),
    ].join(' · ');
  };
  return [
    '结论与建议审查意见（所审固定版，未自动采用）',
    `报告：${record.review.report.relativePath}\n版本 SHA-256：${record.review.report.sha256}\n审查记录：${record.verificationId}`,
    `实际审查范围：${result.scope.reviewed}`,
    ...result.claims.map((claim, index) => [
      `${index + 1}. ${label[claim.verdict]}｜${claim.location}\n原文：${claim.quote}`,
      ...(claim.evidence.length ? [`依据：${claim.evidence.map(evidenceSource).join('；')}`] : []),
      ...(claim.evidenceGaps.length ? [`缺口：${claim.evidenceGaps.join('；')}`] : []),
      ...(claim.conditions.length ? [`适用条件：${claim.conditions.join('；')}`] : []),
      `理由：${claim.reason}\n可能影响：${claim.impact}`,
    ].join('\n')),
    ...(result.scope.unreviewed.length ? [`未核查：${result.scope.unreviewed.join('；')}`] : []),
    ...(result.scope.limitations.length ? [`范围限制：${result.scope.limitations.join('；')}`] : []),
    '请原分析 Agent 根据上述所审版本和依据自行核实、补证、修改或说明分歧；如需复算，由原分析任务按需处理。此意见不代表当前新版已获审查，也不授权经营行动。',
  ].join('\n\n');
}
