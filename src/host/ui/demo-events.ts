import type { PresentationEvent } from './chat-state.ts';

// Presentation fixtures only: no model, tools, planning or agent execution.
export function startDemoFeed(
  sessionId: string,
  requestId: string,
  mode: 'normal' | 'failure',
  receive: (event: PresentationEvent) => void,
): { stop: () => void; dispose: () => void } {
  const response = '你好，我是 OptraCall。\n\n我们可以从一个问题开始，把想法说清楚，再一步步完善判断。你可以继续补充背景，也可以随时停止、调整方向。\n\n这是一段固定的界面演示回复，尚未连接真实模型。';
  const parts = response.match(/.{1,7}|\n/gu) ?? [];
  let index = 0;
  let finished = false;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  const settle = (outcome: 'completed' | 'cancelled' | 'failed', error?: string) => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    receive({ type: 'run.settled', sessionId, requestId, outcome, error });
  };
  const timer = setInterval(() => {
    if (mode === 'failure' && index === 3) {
      settle('failed', '这是预设的失败场景。已保留输入和部分回复，可以重试演示。');
      return;
    }
    const part = parts[index++];
    if (part !== undefined) receive({ type: 'text.delta', sessionId, requestId, text: part });
    else {
      receive({ type: 'message.final', sessionId, requestId, text: response });
      settle('completed');
    }
  }, 95);
  return {
    stop() {
      if (finished || stopTimer) return;
      clearInterval(timer);
      stopTimer = setTimeout(() => settle('cancelled'), 120);
    },
    dispose() {
      finished = true;
      clearInterval(timer);
      clearTimeout(stopTimer);
    },
  };
}
