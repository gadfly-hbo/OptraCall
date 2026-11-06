import { formatAssertionGain, formatMetricValue, formatRate, formatRelativeChange, type SkillEvaluation } from './skill-evaluation.ts';

const outcomes = { effective: '有效', ineffective: '未达标', inconclusive: '未判定' } as const;

export function SkillEvaluationPanel({ name, evaluation }: { name: string; evaluation?: SkillEvaluation }) {
  const needsReevaluation = !!evaluation?.revisedSinceEvaluation && !evaluation.coversEngineeringRevisions;
  const verdict = evaluation ? `${outcomes[evaluation.outcome]}${evaluation.provisional ? '·暂定' : ''}` : '';
  const status = !evaluation ? '数据待补' : needsReevaluation ? '修正版待复测' : `测评${verdict}`;
  const judgments = evaluation?.judgments;
  const judged = judgments ? judgments.wins + judgments.ties + judgments.losses : 0;
  return <details className="skill-evaluation" aria-label={`${name}用户测评`}>
    <summary><span>用户测评</span><span className={needsReevaluation ? 'skill-evaluation-pending' : ''}>{status}</span><span aria-hidden="true">⌄</span></summary>
    <div className="skill-evaluation-body">
      {!evaluation ? <p>暂未提供该 skill 的用户对照测评回执。</p> : <>
        <p className="skill-evaluation-verdict">{needsReevaluation ? '原候选测评' : '用户测评'}：{verdict}</p>
        <p className="skill-evaluation-label">断言通过率 · {evaluation.assertions.basis}</p>
        <p className="skill-evaluation-comparison">{formatMetricValue(evaluation.assertions.baseline, 'percent')} <span aria-hidden="true">→</span><span className="sr-only">至</span> <strong>{formatMetricValue(evaluation.assertions.variant, 'percent')}</strong></p>
        <p className="skill-evaluation-gain">{formatAssertionGain(evaluation.assertions)}</p>
        <dl className="skill-evaluation-primary">
          <div><dt>激活率</dt><dd>{formatRate(evaluation.activation.activated, evaluation.activation.total)} <small>{evaluation.activation.activated}/{evaluation.activation.total}</small></dd></div>
          <div><dt>耗时</dt><dd>{formatRelativeChange(evaluation.seconds)}</dd></div>
          <div><dt>Token</dt><dd>{formatRelativeChange(evaluation.tokens)}</dd></div>
        </dl>
        {needsReevaluation && <p className="skill-evaluation-pending">测评对应原候选；修正版未复测。</p>}
        {evaluation.coversEngineeringRevisions && <p className="skill-evaluation-footnote">用户已确认结论覆盖本轮工程修正后的交付版。</p>}
        <dl className="skill-evaluation-details">
          <div><dt>日期／样本</dt><dd>{evaluation.date} · {evaluation.sampleCount} 项</dd></div>
          <div><dt>对照</dt><dd>未装 skill → 装 skill</dd></div>
          <div><dt>已判定胜率</dt><dd>{formatRate(judgments!.wins, judged)}（{judgments!.wins}/{judged}）<small>{judgments!.wins} 胜 · {judgments!.ties} 平 · {judgments!.losses} 负 · {judgments!.undetermined} 未判定；分母为已判定的 {judged} 项</small></dd></div>
          <div><dt>平均耗时</dt><dd>{formatMetricValue(evaluation.seconds.baseline, 'seconds')} → {formatMetricValue(evaluation.seconds.variant, 'seconds')}</dd></div>
          <div><dt>平均 Token</dt><dd>{formatMetricValue(evaluation.tokens.baseline, 'tokens')} → {formatMetricValue(evaluation.tokens.variant, 'tokens')}</dd></div>
          <div><dt>被测版本</dt><dd><code>{evaluation.testedRevision}</code></dd></div>
        </dl>
        {evaluation.limitations && <p className="skill-evaluation-footnote">{evaluation.limitations}</p>}
        <p className="skill-evaluation-footnote">用户提供的测评结论，仅代表本次样本。M 为百万 Token，用量增量不等于账单费用。</p>
      </>}
    </div>
  </details>;
}
