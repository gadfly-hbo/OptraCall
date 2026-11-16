import { useEffect, useId, useRef } from 'react';
import { automaticActionNodes } from '../automatic-action-settings-types.ts';
import type { AutomaticActionNode, AutomaticActionNodes, AutomaticActionSettings as Settings } from '../automatic-action-settings-types.ts';
import './automatic-action-settings.css';

const descriptions: Record<AutomaticActionNode, { label: string; detail: string }> = {
  save: { label: '报告保存', detail: '将适用成果保存到原项目，并返回准确入口。明确要求的交付保存继续有效。' },
  review: { label: '审查与修订', detail: '按准确稿件审查，意见回原 Agent 核实；修订另存并按适用范围复查。' },
  ir: { label: 'IR 方法提炼', detail: '正常收尾时判断沿用、修订或无复用价值，保存候选；正式发布仍由人决定。' },
  case: { label: 'Case 反馈', detail: '在本次准确 Case 范围内整理判断及待决定事项，保留人的明确表达与来源。' },
  assets: { label: '资产沉淀', detail: '沿原资产与反馈入口整理已发现的问题；IR 关闭时不绕道重新提炼方法。' },
};
interface SharedProps {
  value: Settings;
  onChange: (nodes: AutomaticActionNodes) => void | Promise<void>;
  busy?: boolean;
  disabled?: boolean;
}

/** A local entry edits the same Host-owned global settings as the settings page. */
export function AutomaticActionSwitch({ value, node, onChange, busy = false, disabled = false }: SharedProps & { node: AutomaticActionNode }) {
  return <label className="automatic-action-switch">
    <input type="checkbox" checked={value.nodes[node]} disabled={busy || disabled} onChange={event => { void onChange({ ...value.nodes, [node]: event.currentTarget.checked }); }} />
    <span>{descriptions[node].label}<small>全局设置</small></span>
  </label>;
}

export function AutomaticActionSettings({ value, onChange, busy = false, disabled = false, error = '' }: SharedProps & { error?: string }) {
  const id = useId(), total = useRef<HTMLInputElement>(null);
  const enabled = automaticActionNodes.filter(node => value.nodes[node]).length;
  const partial = enabled > 0 && enabled < automaticActionNodes.length;
  useEffect(() => { if (total.current) total.current.indeterminate = partial; }, [partial]);
  return <section className="automatic-action-settings" aria-labelledby={`${id}-title`} aria-busy={busy}>
    <header><h2 id={`${id}-title`}>自动模式</h2><p>一份全局选择，项目和任务中的局部入口修改同一设置。</p></header>
    {error && <p className="automatic-action-error" role="alert">{error}</p>}
    <fieldset disabled={busy || disabled}>
      <legend>自动衔接</legend>
      <label className="automatic-action-total">
        <input ref={total} type="checkbox" checked={enabled === automaticActionNodes.length} aria-checked={partial ? 'mixed' : enabled === automaticActionNodes.length} onChange={event => {
          const on = event.currentTarget.checked;
          void onChange({ save: on, review: on, ir: on, case: on, assets: on });
        }} />
        <span>全局总控 · {partial ? `部分开启（${enabled}/5）` : enabled === 5 ? '全部开启' : '全部关闭'}</span>
      </label>
      <p className="automatic-action-hint">新增代办初始关闭，选择持续沿用。动作开始前读取当前值，并核对本次授权和适用性。</p>
      <div className="automatic-action-list">{automaticActionNodes.map(node => <div key={node} className="automatic-action-item">
        <AutomaticActionSwitch value={value} node={node} onChange={onChange} busy={busy} disabled={disabled} />
        <p>{descriptions[node].detail}</p>
      </div>)}</div>
    </fieldset>
    <p className="automatic-action-hint">开启不会补跑或唤醒历史任务；关闭不强杀已开始的动作。立即中止请用原停止入口，停止／取消后不再自动续跑或整理。</p>
    <p className="automatic-action-hint">必要交付、Agent 自查及所选方法检查继续有效。开关不扩大资料权限、经营动作授权或正式发布权限。</p>
  </section>;
}
