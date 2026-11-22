import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { messageText, nativeMessageText, type NativeContent, type NativeMessage } from './project-types.ts';
import { BrandMark } from './BrandMark.tsx';
import './conversation-collapse.css';

type FoldChoice = 'expanded' | 'collapsed';
const STORE_KEY = 'optracall.transcript-collapse.v1';
const STORE_LIMIT = 245_760;
const memory = new Map<string, FoldChoice>();

function readStore(): Record<string, string> {
  try {
    if (typeof sessionStorage === 'undefined') return {};
    return JSON.parse(sessionStorage.getItem(STORE_KEY) || '{}') as Record<string, string>;
  } catch { return {}; }
}
function writeStore(value: Record<string, string>) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    let entries = Object.entries(value);
    let serialized = JSON.stringify(Object.fromEntries(entries));
    while (serialized.length > STORE_LIMIT && entries.length > 1) {
      entries = entries.slice(1);
      serialized = JSON.stringify(Object.fromEntries(entries));
    }
    sessionStorage.setItem(STORE_KEY, serialized);
  } catch { /* storage unavailable: memory keeps this session working */ }
}

/** Fold choices are scoped by conversation and message identity; different conversations never share entries. */
export const foldStore = {
  get(conversationKey: string, identity: string): FoldChoice | undefined {
    const key = `${conversationKey}::${identity}`;
    const cached = memory.get(key);
    if (cached) return cached;
    const value = readStore()[key];
    if (value === 'expanded' || value === 'collapsed') { memory.set(key, value); return value; }
    return undefined;
  },
  set(conversationKey: string, identity: string, choice: FoldChoice) {
    const key = `${conversationKey}::${identity}`;
    memory.set(key, choice);
    writeStore({ ...readStore(), [key]: choice });
  },
};

const stableHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, '0');
};

/** Native entry ids are authoritative; older messages and streaming tails fall back to a stable position+text key. */
export function messageIdentity(message: NativeMessage, index: number): string {
  if (typeof message.nativeEntryId === 'string' && message.nativeEntryId) return `native:${message.nativeEntryId}`;
  return `#${index}:${message.role}:${stableHash(messageText(message) || nativeMessageText(message) || message.toolName || '')}`;
}

export type ProcessStep = { key: string; kind: 'tool' | 'note'; toolName?: string; command?: string; output?: string; isError?: boolean; pending?: boolean };
export type ConversationEntry = { message: NativeMessage; index: number };
export type ConversationItem =
  | { kind: 'user'; message: NativeMessage; index: number; identity: string }
  | { kind: 'process'; identity: string; steps: ProcessStep[]; entries: ConversationEntry[] }
  | { kind: 'body'; message: NativeMessage; index: number; identity: string }
  | { kind: 'custom'; message: NativeMessage; index: number; identity: string };

const toolCallsOf = (message: NativeMessage): NativeContent[] => Array.isArray(message.content) ? message.content.filter((part: NativeContent) => part.type === 'toolCall') : [];
const resultTextOf = (message: NativeMessage): string => nativeMessageText(message) || message.output || '';

/**
 * One turn = everything between user messages. Tool calls and their results collapse into
 * process steps; text-bearing assistant messages and custom display messages stay as body
 * items, each preceded by the process accumulated since the previous body boundary.
 */
export function groupConversation(messages: readonly NativeMessage[], { includeToolDetails = false } = {}): ConversationItem[] {
  const items: ConversationItem[] = [];
  let steps: ProcessStep[] = [];
  let entries: ConversationEntry[] = [];
  const pending = new Map<string, { step: ProcessStep; entries: ConversationEntry[] }>();
  const flush = () => {
    const first = entries[0];
    if (!first) return;
    items.push({ kind: 'process', identity: `process:${messageIdentity(first.message, first.index)}`, steps, entries });
    steps = []; entries = [];
  };
  const addCalls = (message: NativeMessage, index: number, calls: NativeContent[]) => {
    entries.push({ message, index });
    for (const part of calls) {
      const step: ProcessStep = { key: `call:${index}:${steps.length}`, kind: 'tool', toolName: part.name, pending: true };
      steps.push(step);
      if (part.id) pending.set(part.id, { step, entries });
    }
  };
  messages.forEach((message, index) => {
    if (message.role === 'user') {
      flush(); pending.clear();
      items.push({ kind: 'user', message, index, identity: messageIdentity(message, index) });
      return;
    }
    if (message.role === 'toolResult' || message.role === 'bashExecution') {
      const { toolCallId, toolName, command, isError } = message;
      const paired = toolCallId ? pending.get(toolCallId) : undefined;
      const details = includeToolDetails ? { command, output: resultTextOf(message) } : {};
      if (paired) {
        paired.entries.push({ message, index });
        Object.assign(paired.step, { toolName: paired.step.toolName ?? toolName, isError, pending: false, ...details });
        pending.delete(toolCallId!);
      } else {
        entries.push({ message, index });
        steps.push({ key: `result:${index}`, kind: 'tool', toolName: toolName ?? (message.role === 'bashExecution' ? 'bash' : '工具结果'), isError, ...details });
      }
      return;
    }
    if (message.role === 'custom') {
      flush();
      items.push({ kind: 'custom', message, index, identity: messageIdentity(message, index) });
      return;
    }
    if (message.role === 'assistant') {
      const calls = toolCallsOf(message);
      if (calls.length) addCalls(message, index, calls);
      if (!messageText(message).trim()) {
        if (!calls.length) { entries.push({ message, index }); steps.push({ key: `note:${index}`, kind: 'note' }); }
        return;
      }
      flush();
      items.push({ kind: 'body', message, index, identity: messageIdentity(message, index) });
      return;
    }
    items.push({ kind: 'body', message, index, identity: messageIdentity(message, index) });
  });
  flush();
  return items;
}

export function AssistantOutcome({ message }: { message: NativeMessage }) {
  if (message.stopReason === 'aborted') return <p className="message-meta">已停止 · 部分输出已保留</p>;
  if (message.stopReason === 'error') return <p className="message-meta failed-meta">此条回复未完成</p>;
  return null;
}

export const isPartialAssistantReply = (message: NativeMessage) => message.stopReason === 'aborted' || message.stopReason === 'error';

export function AgentAuthor({ model, status, compact = false }: { model?: string; status?: string; compact?: boolean }) {
  return <div className={`message-author ${compact ? 'msg-author' : ''}`}>
    {compact
      ? <span className="brand-mark brand-mark-xs" aria-hidden="true"><span /><i /></span>
      : <BrandMark small />}
    <strong>OptraCall</strong>
    {model ? <span>{model}</span> : null}
    {status ? <span>{status}</span> : null}
  </div>;
}

/** Long content collapses to `lines` of preview; the toggle only appears when the content actually overflows. */
export function Foldable({ conversationKey, identity, lines, className, children }: { conversationKey: string; identity: string; lines: number; className?: string; children: ReactNode }) {
  const contentId = useId();
  const content = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(() => foldStore.get(conversationKey, identity) === 'expanded');
  const [readableHeight, setReadableHeight] = useState<number>();
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const hiddenControls = new Set<HTMLElement>();
    const updatePreview = (height?: number) => {
      setReadableHeight(height);
      const cutoff = expanded || height === undefined ? Infinity : element.getBoundingClientRect().top + height;
      for (const control of hiddenControls) {
        if (element.contains(control) && control.getBoundingClientRect().top >= cutoff) continue;
        control.inert = false;
        hiddenControls.delete(control);
      }
      if (cutoff === Infinity) return;
      for (const control of element.querySelectorAll<HTMLElement>('a[href], pre, [tabindex]')) {
        if (control.inert || control.getBoundingClientRect().top < cutoff) continue;
        control.inert = true;
        hiddenControls.add(control);
      }
    };
    const measure = () => {
      // Read actual text fragments so wrapping, inline markup and block spacing are reflected in the preview.
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      const fragments: DOMRect[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width > 0 && rect.height > 0) fragments.push(rect);
        }
      }
      fragments.sort((first, second) => first.top - second.top);
      const bottoms: number[] = [];
      for (const rect of fragments) {
        const last = bottoms.length - 1;
        if (last >= 0 && rect.top < bottoms[last]!) bottoms[last] = Math.max(bottoms[last]!, rect.bottom);
        else bottoms.push(rect.bottom);
      }
      if (bottoms.length <= lines) {
        updatePreview();
        return;
      }
      let cutoff = bottoms[lines - 1]!;
      // When the preview reaches a table, keep its header with the first data row.
      for (const table of element.querySelectorAll('table')) {
        if (table.getBoundingClientRect().top >= cutoff) continue;
        const firstRow = table.tBodies[0]?.rows[0];
        if (firstRow) cutoff = Math.max(cutoff, firstRow.getBoundingClientRect().bottom);
      }
      updatePreview(cutoff < bottoms.at(-1)! ? Math.ceil(cutoff - element.getBoundingClientRect().top) + 1 : undefined);
    };
    measure();
    let frame: number | undefined;
    const scheduleMeasure = () => {
      frame ??= requestAnimationFrame(() => { frame = undefined; measure(); });
    };
    const sizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduleMeasure);
    sizeObserver?.observe(element);
    const contentObserver = new MutationObserver(scheduleMeasure);
    contentObserver.observe(element, { childList: true, subtree: true, characterData: true });
    return () => {
      sizeObserver?.disconnect();
      contentObserver.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      for (const control of hiddenControls) control.inert = false;
    };
  }, [expanded, lines]);
  const toggle = () => setExpanded(value => {
    const next = !value;
    foldStore.set(conversationKey, identity, next ? 'expanded' : 'collapsed');
    return next;
  });
  const collapsed = !expanded && readableHeight !== undefined;
  return <div className={['fold', collapsed ? 'collapsed' : '', className].filter(Boolean).join(' ')} style={collapsed ? { ['--fold-readable-height' as string]: `${readableHeight}px` } : undefined}>
    <div className="fold-viewport"><div className="fold-inner" ref={content} id={contentId}>{children}</div></div>
    {readableHeight !== undefined && <button type="button" className="fold-toggle" aria-expanded={expanded} aria-controls={contentId} onClick={toggle}><span className="t-label">{expanded ? '收起' : '展开全文'}</span><span className="chev" aria-hidden="true">⌄</span></button>}
  </div>;
}

function DefaultStep({ step }: { step: ProcessStep }) {
  if (step.kind === 'note') {
    return <div className="process-step"><span className="step-dot" aria-hidden="true" /><div className="step-note">过程条目 · 无可见输出</div></div>;
  }
  const failed = step.isError === true;
  const status = <>{step.toolName ?? '工具'}{failed ? ' · 执行失败' : step.pending ? ' · 等待结果' : ' · 执行结果'}</>;
  return <div className="process-step">
    <span className={`step-dot ${failed ? 'err' : step.pending ? '' : 'ok'}`} aria-hidden="true" />
    {step.command || step.output !== undefined ? <details className={`tool-message ${failed ? 'tool-error' : ''}`}>
      <summary>{status}</summary>
      {step.command && <code>{step.command}</code>}
      <pre>{step.output?.trim() ? step.output : '无文本输出。'}</pre>
    </details> : <div>{status}</div>}
  </div>;
}

export function ProcessGroup({ conversationKey, identity, steps, entries = [] }: { conversationKey: string; identity: string; steps: ProcessStep[]; entries?: ConversationEntry[] }) {
  const stepsId = useId();
  const [expanded, setExpanded] = useState(() => foldStore.get(conversationKey, identity) === 'expanded');
  const failureCount = steps.filter(step => step.isError).length;
  const toggle = () => setExpanded(value => {
    const next = !value;
    foldStore.set(conversationKey, identity, next ? 'expanded' : 'collapsed');
    return next;
  });
  return <><div className="process-group">
    <button type="button" className="process-toggle" aria-expanded={expanded} aria-controls={stepsId} onClick={toggle}>
      <span className="p-glyph" aria-hidden="true" />
      <span>推理过程</span>
      <span className="p-count">· {steps.length} 步</span>
      {failureCount > 0 && <span className="failed-meta">· {failureCount} 步失败</span>}
      <span className="chev" aria-hidden="true">⌄</span>
    </button>
    <div className="process-steps" id={stepsId} hidden={!expanded}>
      {steps.map(step => <DefaultStep key={step.key} step={step} />)}
    </div>
  </div>{entries.filter(({ message }) => message.role === 'assistant' && !messageText(message).trim()).map(({ message, index }) => <AssistantOutcome key={messageIdentity(message, index)} message={message} />)}</>;
}
