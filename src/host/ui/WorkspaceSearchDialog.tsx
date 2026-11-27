import { useEffect, useRef, useState } from 'react';
import * as caseClient from './case-client.ts';
import { listProjects } from './runtime-client.ts';
import type { CaseRecord } from '../case-types.ts';
import type { ClientProject } from './project-types.ts';
import { filterWorkspaceSearchItems, type WorkspaceSearchTarget } from './workspace-home-model.ts';

export interface WorkspaceSearchDialogProps {
  onClose: () => void;
  onSelect: (target: WorkspaceSearchTarget) => void;
}

export function WorkspaceSearchDialog({ onClose, onSelect }: WorkspaceSearchDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>();

  const [cases, setCases] = useState<CaseRecord[] | null>(null);
  const [projects, setProjects] = useState<ClientProject[] | null>(null);
  const results = filterWorkspaceSearchItems({ query, projects: projects ?? [], cases: cases ?? [] });
  const selectedIndex = Math.max(0, results.findIndex(item => item.id === selectedId));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    inputRef.current?.focus();
    const controller = new AbortController();
    const { signal } = controller;
    void caseClient.status(signal)
      .then(status => status.state === 'ready' ? caseClient.list(signal) : null)
      .then(list => { if (!signal.aborted) setCases(list?.cases ?? []); })
      .catch(() => { if (!signal.aborted) setCases([]); });
    void listProjects(signal)
      .then(records => { if (!signal.aborted) setProjects(records); })
      .catch(() => { if (!signal.aborted) setProjects([]); });
    return () => controller.abort();
  }, []);

  const choose = (target: WorkspaceSearchTarget) => {
    onSelect(target);
    onClose();
  };

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
          onChange={event => { setQuery(event.target.value); setSelectedId(undefined); }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              if (results.length) setSelectedId(results[(selectedIndex + 1) % results.length]!.id);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              if (results.length) setSelectedId(results[(selectedIndex - 1 + results.length) % results.length]!.id);
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
                onMouseEnter={() => setSelectedId(item.id)}
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
          <p>{cases === null || projects === null ? '正在核对可读记录…' : `没有在当前获准范围内找到「${query}」。`}</p>
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
