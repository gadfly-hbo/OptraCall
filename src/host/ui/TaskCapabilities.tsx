import { useEffect, useState } from 'react';
import { TASK_CAPABILITIES, type TaskCapability, type TaskCapabilities } from '../task-capabilities.ts';
import type { TradeAreaStatus } from '../trade-area-status.ts';
import { readTradeAreaStatus } from './runtime-client.ts';

type Status = TradeAreaStatus | 'unavailable' | undefined;
export function useTradeAreaStatus(): Status {
  const [status, setStatus] = useState<Status>();
  useEffect(() => {
    const abort = new AbortController();
    const refresh = () => { void readTradeAreaStatus(abort.signal).then(value => { if (!abort.signal.aborted) setStatus(value); }).catch(() => { if (!abort.signal.aborted) setStatus('unavailable'); }); };
    refresh(); window.addEventListener('focus', refresh);
    return () => { abort.abort(); window.removeEventListener('focus', refresh); };
  }, []);
  return status;
}
export function tradeAreaVersionText(status: Status): string {
  if (!status) return '正在读取本机数据版本…';
  if (status === 'unavailable') return '暂时无法读取本机数据版本';
  if (!status.available) return '尚无可用本机快照，请先显式导入数据';
  const version = status.dataVersion;
  return `v${version.generatedAt.slice(0, 10)} · ${version.digest.slice(0, 12)} · ${version.total} 家 · ${version.engineVersion} · 来源 ${version.sourceHead.slice(0, 12)}`;
}
export function TaskCapabilityList({ settings, disabled, onChange, context }: { settings: TaskCapabilities; disabled: boolean; onChange: (capability: TaskCapability, enabled: boolean) => void; context: 'create' | 'session' }) {
  const status = useTradeAreaStatus();
  const [showWeatherExplanation, setShowWeatherExplanation] = useState(false);
  return <fieldset className="task-capability-list" disabled={disabled}>
    <legend>任务能力{context === 'session' ? '（仅空闲时可切换）' : ''}</legend>
    {TASK_CAPABILITIES.map(capability => {
      const id = `${context}-${capability.id}`;
      return <label className="task-capability-row" key={capability.id} htmlFor={id}>
        <input id={id} type="checkbox" checked={Boolean(settings[capability.id])} aria-labelledby={`${id}-label`} aria-describedby={`${id}-help`} onChange={event => { if (capability.id === 'weatherTools' && event.target.checked) setShowWeatherExplanation(true); onChange(capability.id, event.target.checked); }} />
        <span><strong id={`${id}-label`}>{capability.label}</strong><small id={`${id}-help`}>{capability.description}</small></span>
      </label>;
    })}
    {showWeatherExplanation && settings.weatherTools && <aside className="weather-egress-note" role="note" aria-label="天气连接器出境说明">
      <strong>开启后，天气查询会发送到外部服务</strong>
      <p>目标仅为 <code>archive-api.open-meteo.com</code>。城市名在本机转为坐标，仅发送坐标、日期区间、天气字段和固定时区；该连接器请求不发送项目文件、对话正文或商圈档案。</p>
      <p>无密钥、无账号；免费 API 仅限非商业用途，按 <a href="https://open-meteo.com/en/terms" target="_blank" rel="noreferrer">Open-Meteo 条款</a>使用。查询结果会进入所选任务模型上下文。</p>
      <p>本次启用只说明一次，查询时不逐次确认。可在任务空闲时关闭；在途查询可使用停止按钮取消。</p>
    </aside>}
    <p className="connector-data-version" role="status">商圈数据版本：{tradeAreaVersionText(status)}</p>
    <p className="task-capability-help">默认关闭，仅对本任务生效。开启后由 Agent 自主选用；受管执行及封闭出稿不提供这些工具。工具结果和出处会进入所选任务模型上下文。</p>
  </fieldset>;
}
