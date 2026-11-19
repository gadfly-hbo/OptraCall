import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './conversation-drawer.css';

type ConversationDrawerProps = {
  title: string;
  children: ReactNode;
  className?: string;
  showInlineTitle?: boolean;
};

type ScrollPosition = {item: HTMLElement; left: number; top: number};
function readScrollPositions(host: HTMLElement): ScrollPosition[] {
  return [host, ...host.querySelectorAll<HTMLElement>('*')]
    .filter(item => item.scrollLeft || item.scrollTop)
    .map(item => ({ item, left: item.scrollLeft, top: item.scrollTop }));
}
function restoreScrollPositions(positions: ScrollPosition[]) {
  for (const { item, left, top } of positions) {
    item.scrollLeft = left;
    item.scrollTop = top;
  }
}

export function ConversationDrawer({ title, children, className, showInlineTitle }: ConversationDrawerProps) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [content] = useState(() => {
    if (typeof document === 'undefined') return null;
    const element = document.createElement('div');
    element.className = 'workspace-conversation-content';
    return element;
  });
  const inline = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const launch = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const owner = useRef<HTMLDivElement>(null);
  const inlinePositions = useRef<ScrollPosition[]>([]);
  const expandedPositions = useRef<ScrollPosition[]>([]);

  useLayoutEffect(() => {
    const modal = drawer.current;
    const destination = expanded ? dock.current : inline.current;
    if (!content || !modal || !destination || content.parentElement === destination) return;
    const expandedPane = dock.current;
    const returning = content.parentElement === expandedPane;
    // The portal container stays the same, so React keeps the original input,
    // conversation components, and their request lifecycle mounted.
    if (returning && expandedPane) expandedPositions.current = readScrollPositions(expandedPane);
    if (expanded) inlinePositions.current = readScrollPositions(content);
    destination.append(content);
    if (expanded && !modal.open) modal.showModal();
    if (!expanded && modal.open) modal.close();
    restoreScrollPositions(expanded ? expandedPositions.current : inlinePositions.current);
    if (expanded) close.current?.focus({ preventScroll: true });
    else if (returning) launch.current?.focus({ preventScroll: true });
  }, [content, expanded]);

  useEffect(() => {
    const workspace = owner.current;
    if (!expanded || !workspace) return;
    const observer = new ResizeObserver(() => {
      if (!workspace.getClientRects().length) setExpanded(false);
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [expanded]);

  return <div ref={owner} className={['workspace-conversation', className].filter(Boolean).join(' ')}
    onClickCapture={event => {
      if (expanded && event.target instanceof Element && event.target.closest('[data-return-to-workspace]')) setExpanded(false);
    }}>
    <div className="workspace-conversation-toolbar">
      {showInlineTitle && <h3>{title}</h3>}
      <button type="button" className="text-button" ref={launch} aria-haspopup="dialog" aria-controls={id}
        aria-expanded={expanded} onClick={() => setExpanded(true)}>放大对话</button>
    </div>
    <div ref={inline} className="workspace-conversation-inline" />
    <dialog ref={drawer} id={id} className="workspace-conversation-dialog" aria-labelledby={id + '-title'}
      onKeyDown={event => event.stopPropagation()}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); setExpanded(false); }}
      onClose={event => { event.stopPropagation(); if (!event.currentTarget.open) setExpanded(false); }}>
      <header className="workspace-conversation-heading">
        <h2 id={id + '-title'}>{title}</h2>
        <button type="button" className="secondary-button" ref={close} onClick={() => setExpanded(false)}>收起对话</button>
      </header>
      <div ref={dock} className="workspace-conversation-expanded" />
    </dialog>
    {content ? createPortal(children, content) : children}
  </div>;
}
