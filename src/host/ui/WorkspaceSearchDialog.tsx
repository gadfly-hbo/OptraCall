import { useEffect, useRef, useState } from 'react';
import type { CaseRecord } from '../case-types.ts';
import type { ClientProject } from './project-types.ts';
import { filterWorkspaceSearchItems, type WorkspaceSearchTarget } from './workspace-home-model.ts';

export interface WorkspaceSearchDialogProps {
  open: boolean;
  projects: ClientProject[];
  cases: CaseRecord[];
  onClose: () => void;
  onSelect: (target: WorkspaceSearchTarget) => void;
}

export function WorkspaceSearchDialog({ open, projects, cases, onClose, onSelect }: WorkspaceSearchDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const results = filterWorkspaceSearchItems({ query, projects, cases });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setQuery('');
      setSelectedIndex(0);
      dialog.showModal();
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const choose = (target: WorkspaceSearchTarget) => {
    onSelect(target);
    onClose();
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className="workspace-search-dialog"
      aria-label="搜索工作区"
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
      onClick={event => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="ws-search-head">
        <label className="sr-only" htmlFor="workspace-quick-search">搜索模块、Case、项目、任务或设置</label>
        <input
          ref={inputRef}
          id="workspace-quick-search"
          type="search"
          placeholder="搜索模块、Case、项目、任务或设置（只读定位）"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              if (results.length) setSelectedIndex(index => (index + 1) % results.length);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              if (results.length) setSelectedIndex(index => (index - 1 + results.length) % results.length);
            } else if (event.key === 'Enter' && results[selectedIndex]) {
              event.preventDefault();
              choose(results[selectedIndex]!);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <button type="button" className="text-button" onClick={onClose}>关闭</button>
      </div>

      {results.length ? (
        <ul className="ws-search-list" role="listbox" aria-label="搜索结果">
          {results.map((item, index) => (
            <li key={item.id} role="option" aria-selected={index === selectedIndex}>
              <button
                type="button"
                className="ws-search-item"
                aria-selected={index === selectedIndex}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => choose(item)}
              >
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.subtitle}</small>
                </span>
                <span className="ws-search-group">{item.group}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="ws-search-empty" role="status">
          <p>没有在当前获准范围内找到「{query}」。</p>
          <button type="button" className="secondary-button" onClick={onClose}>清空并退出搜索</button>
        </div>
      )}

      <footer className="ws-search-foot">
        <span>↑↓ 选择 · Enter 进入 · Esc 关闭</span>
        <span>只读定位 · 不触发写入</span>
      </footer>
    </dialog>
  );
}
