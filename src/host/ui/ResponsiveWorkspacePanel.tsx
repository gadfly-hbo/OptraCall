import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function useViewport(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useLayoutEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    media.addEventListener('change', update);
    update();
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

type Props = {
  label: string;
  kind: 'navigation' | 'inspector';
  modal: boolean;
  onClose: () => void;
  children: ReactNode;
};

function hiddenInDetails(element: HTMLElement, dialog: HTMLDialogElement): boolean {
  for (let ancestor = element.parentElement; ancestor && ancestor !== dialog; ancestor = ancestor.parentElement) {
    if (ancestor instanceof HTMLDetailsElement && !ancestor.open && !ancestor.querySelector(':scope > summary')?.contains(element)) return true;
  }
  return false;
}

function containTab(event: KeyboardEvent) {
  const dialog = event.currentTarget as HTMLDialogElement;
  if (event.key !== 'Tab' || !(event.target instanceof Element) || event.target.closest('dialog') !== dialog) return;
  const items = [...dialog.querySelectorAll<HTMLElement>('button, a[href], input:not([type="hidden"]), select, textarea, summary, [tabindex]')]
    .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]')
      && element.closest('dialog') === dialog && !hiddenInDetails(element, dialog)
      && element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible');
  const first = items[0], last = items.at(-1);
  if (!first) return;
  const focused = document.activeElement;
  if ((event.shiftKey && (focused === first || !items.includes(focused as HTMLElement))) || (!event.shiftKey && focused === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }
}

export function ResponsiveWorkspacePanel({ label, kind, modal, onClose, children }: Props) {
  const inline = useRef<HTMLDivElement>(null), drawer = useRef<HTMLDialogElement>(null);
  const [content] = useState(() => {
    if (typeof document === 'undefined') return null;
    const element = document.createElement('div');
    element.className = 'workspace-panel-body';
    return element;
  });

  useLayoutEffect(() => {
    const panel = drawer.current;
    const destination = modal ? panel : inline.current;
    if (!content || !panel || !destination || destination === content.parentElement) return;
    // Keep the same mounted content when the viewport crosses the drawer breakpoint.
    const focused = document.activeElement;
    if (!modal && panel.open) panel.close();
    destination.append(content);
    if (modal) panel.showModal();
    if (focused instanceof HTMLElement && content.contains(focused)) focused.focus({ preventScroll: true });
    else if (modal) content.querySelector<HTMLElement>('[data-panel-focus]')?.focus({ preventScroll: true });
  }, [content, modal]);

  useLayoutEffect(() => {
    const panel = drawer.current;
    if (!panel || !modal) return;
    panel.addEventListener('keydown', containTab);
    return () => panel.removeEventListener('keydown', containTab);
  }, [modal]);

  const className = `workspace-panel workspace-panel-${kind}`;
  return <>
    <div ref={inline} className={className} hidden={modal}>{content ? null : children}</div>
    <dialog ref={drawer} className={className} aria-label={label}
      onCancel={event => { if (event.target === event.currentTarget) { event.preventDefault(); event.stopPropagation(); onClose(); } }} />
    {content && createPortal(children, content)}
  </>;
}
