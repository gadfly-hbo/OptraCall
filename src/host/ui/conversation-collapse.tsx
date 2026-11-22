import { Fragment, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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

export type ProcessStep = { key: string; kind: 'tool' | 'note'; toolName?: string; command?: string; output?: string; isError?: boolean; pending?: boolean; text?: string };
export type ConversationEntry = { message: NativeMessage; index: number };
export type ConversationItem =
  | { kind: 'user'; message: NativeMessage; index: number; identity: string }
  | { kind: 'process'; identity: string; steps: ProcessStep[]; entries: ConversationEntry[] }
  | { kind: 'body'; message: NativeMessage; index: number; identity: string }
  | { kind: 'custom'; message: NativeMessage; index: number; identity: string };

const toolCallsOf = (message: NativeMessage): NativeContent[] => Array.isArray(message.content) ? message.content.filter((part: NativeContent) => part.type === 'toolCall') : [];
const resultTextOf = (message: NativeMessage): string => nativeMessageText(message) || message.output || '';
const noteTextOf = (message: NativeMessage): string => Array.isArray(message.content) ? contentTextParts(message).join('') : '';

function contentTextParts(message: NativeMessage): string[] {
  return (Array.isArray(message.content) ? message.content : []).filter(part => part.type !== 'toolCall' && typeof part.text === 'string').map(part => part.text ?? '');
}

/**
 * One turn = everything between user messages. Tool calls and their results collapse into
 * process steps; text-bearing assistant messages and custom display messages stay as body
 * items, each preceded by the process accumulated since the previous body boundary.
 */
export function groupConversation(messages: readonly NativeMessage[]): ConversationItem[] {
  const items: ConversationItem[] = [];
  let turn = 0, segment = 0;
  let steps: ProcessStep[] = [];
  let entries: ConversationEntry[] = [];
  let pending = new Map<string, ProcessStep>();
  const flush = () => {
    if (!steps.length) return;
    items.push({ kind: 'process', identity: `process:${turn}:${segment}`, steps: [...steps], entries: [...entries] });
    steps = []; entries = []; segment++;
  };
  const addCall = (message: NativeMessage, index: number) => {
    entries.push({ message, index });
    for (const part of toolCallsOf(message)) {
      const step: ProcessStep = { key: `call:${index}:${part.id ?? part.name ?? steps.length}`, kind: 'tool', toolName: part.name, pending: true };
      steps.push(step);
      if (typeof part.id === 'string' && part.id) pending.set(part.id, step);
    }
  };
  messages.forEach((message, index) => {
    if (message.role === 'user') {
      flush(); pending = new Map();
      items.push({ kind: 'user', message, index, identity: messageIdentity(message, index) });
      turn++; segment = 0;
      return;
    }
    if (message.role === 'toolResult' || message.role === 'bashExecution') {
      entries.push({ message, index });
      const paired = typeof message.toolCallId === 'string' ? pending.get(message.toolCallId) : undefined;
      if (paired) {
        paired.toolName = paired.toolName ?? message.toolName;
        paired.command = paired.command ?? message.command;
        paired.output = resultTextOf(message);
        paired.isError = message.isError === true;
        paired.pending = false;
        pending.delete(message.toolCallId!);
      } else {
        steps.push({ key: `result:${index}`, kind: 'tool', toolName: message.toolName ?? (message.role === 'bashExecution' ? 'bash' : '工具结果'), command: message.command, output: resultTextOf(message), isError: message.isError === true });
      }
      return;
    }
    if (message.role === 'custom') {
      flush();
      items.push({ kind: 'custom', message, index, identity: messageIdentity(message, index) });
      return;
    }
    if (message.role === 'assistant') {
      const text = messageText(message);
      if (!text) {
        const note = noteTextOf(message);
        if (toolCallsOf(message).length) addCall(message, index);
        else { entries.push({ message, index }); steps.push({ key: `note:${index}`, kind: 'note', text: note }); }
        return;
      }
      addCall(message, index);
      flush();
      items.push({ kind: 'body', message, index, identity: messageIdentity(message, index) });
      return;
    }
    items.push({ kind: 'body', message, index, identity: messageIdentity(message, index) });
  });
  flush();
  return items;
}

export function AgentAuthor({ model, compact = false }: { model?: string; compact?: boolean }) {
  return <div className={`message-author ${compact ? 'msg-author' : ''}`}>
    {compact
      ? <span className="brand-mark brand-mark-xs" aria-hidden="true"><span /><i /></span>
      : <BrandMark small />}
    <strong>OptraCall</strong>
    {model ? <span>{model}</span> : null}
  </div>;
}

/** Long content collapses to `lines` of preview; the toggle only appears when the content actually overflows. */
export function Foldable({ conversationKey, identity, lines, className, children }: { conversationKey: string; identity: string; lines: number; className?: string; children: ReactNode }) {
  const contentId = useId();
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(() => foldStore.get(conversationKey, identity) === 'expanded');
  const [overflow, setOverflow] = useState(true);
  useLayoutEffect(() => {
    const boxElement = box.current, contentElement = content.current;
    if (!boxElement || !contentElement) return;
    const measure = () => {
      const fontSize = parseFloat(getComputedStyle(boxElement).fontSize) || 14;
      setOverflow(contentElement.scrollHeight > lines * 1.85 * fontSize + 2);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(contentElement);
    return () => observer?.disconnect();
  });
  const toggle = () => setExpanded(value => {
    const next = !value;
    foldStore.set(conversationKey, identity, next ? 'expanded' : 'collapsed');
    return next;
  });
  const collapsed = !expanded && overflow;
  return <div className={['fold', collapsed ? 'collapsed' : '', className].filter(Boolean).join(' ')} style={{ ['--fold-lines' as string]: String(lines) }}>
    <div className="fold-viewport" ref={box}><div className="fold-inner" ref={content} id={contentId}>{children}</div></div>
    {overflow && <button type="button" className="fold-toggle" aria-expanded={expanded} aria-controls={contentId} onClick={toggle}><span className="t-label">{expanded ? '收起' : '展开全文'}</span><span className="chev" aria-hidden="true">⌄</span></button>}
  </div>;
}

function DefaultStep({ step }: { step: ProcessStep }) {
  if (step.kind === 'note') {
    return <div className="process-step"><span className="step-dot" aria-hidden="true" /><div className="step-note">{step.text?.trim() ? step.text : '过程条目 · 无可见输出'}</div></div>;
  }
  const failed = step.isError === true;
  return <div className="process-step">
    <span className={`step-dot ${failed ? 'err' : step.pending ? '' : 'ok'}`} aria-hidden="true" />
    <details className={`tool-message ${failed ? 'tool-error' : ''}`}>
      <summary>{step.toolName ?? '工具'}{failed ? ' · 执行失败' : step.pending ? ' · 等待结果' : ' · 执行结果'}</summary>
      {step.command && <code>{step.command}</code>}
      <pre>{step.output?.trim() ? step.output : step.pending ? '本步没有结果回执（运行中或已中断）。' : '无文本输出。'}</pre>
    </details>
  </div>;
}

export function ProcessGroup({ conversationKey, identity, steps, renderStep }: { conversationKey: string; identity: string; steps: ProcessStep[]; renderStep?: (step: ProcessStep) => ReactNode }) {
  const stepsId = useId();
  const [expanded, setExpanded] = useState(() => foldStore.get(conversationKey, identity) === 'expanded');
  const toggle = () => setExpanded(value => {
    const next = !value;
    foldStore.set(conversationKey, identity, next ? 'expanded' : 'collapsed');
    return next;
  });
  return <div className="process-group">
    <button type="button" className="process-toggle" aria-expanded={expanded} aria-controls={stepsId} onClick={toggle}>
      <span className="p-glyph" aria-hidden="true" />
      <span>推理过程</span>
      <span className="p-count">· {steps.length} 步</span>
      <span className="chev" aria-hidden="true">⌄</span>
    </button>
    <div className="process-steps" id={stepsId} hidden={!expanded}>
      {steps.map(step => <Fragment key={step.key}>{renderStep ? renderStep(step) : <DefaultStep step={step} />}</Fragment>)}
    </div>
  </div>;
}
