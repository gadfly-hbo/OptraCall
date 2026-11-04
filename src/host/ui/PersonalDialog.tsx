import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
const captureFocus = () => document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
export function PersonalDialog({ title, subtitle, children, footer, drawer = false, busy = false, returnFocus, fallbackFocus, onClose }: {
  title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; drawer?: boolean; busy?: boolean; returnFocus?: HTMLElement | null; fallbackFocus?: HTMLElement | null; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(() => {
    const trigger = returnFocus ?? captureFocus(), dialog = ref.current;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      requestAnimationFrame(() => {
        const target = trigger?.isConnected ? trigger : fallbackFocus;
        if (!target?.isConnected || target.matches(':disabled') || target.closest('dialog:not([open]), [hidden], [inert]')) return;
        const topDialog = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
        if (topDialog && !topDialog.contains(target)) return;
        target.focus({ preventScroll: true });
      });
    };
  }, []);
  return <dialog ref={ref} className={`pr-dialog ${drawer ? 'pr-drawer' : ''}`} aria-labelledby={`${id}-title`} aria-busy={busy || undefined} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="pr-dialog-head"><div><h2 id={`${id}-title`}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="pr-close" type="button" aria-label={`关闭${title}`} disabled={busy} onClick={onClose}>×</button></header>
    <div className="pr-dialog-body">{children}</div>{footer && <footer className="pr-dialog-footer">{footer}</footer>}
  </dialog>;
}
