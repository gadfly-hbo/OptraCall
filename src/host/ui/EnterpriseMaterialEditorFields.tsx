import type { Ref } from 'react';
import type { EnterpriseMaterialFields } from '../enterprise-materials-types.ts';

/** Shared by the original Enterprise editor and personal notes; Enterprise owns these fields. */
export function EnterpriseMaterialEditorFields({ fields, onChange, idPrefix, readOnly = false, disabled = false, tried = false, titleRef, bodyRequired = false }: {
  fields: EnterpriseMaterialFields; onChange: (key: keyof EnterpriseMaterialFields, value: string) => void;
  idPrefix: string; readOnly?: boolean; disabled?: boolean; tried?: boolean; titleRef?: Ref<HTMLInputElement>; bodyRequired?: boolean;
}) {
  const field = (key: Exclude<keyof EnterpriseMaterialFields, 'sourceFileId'>, label: string, multiline = false) => {
    const invalid = tried && (key === 'title' ? !fields.title.trim() : key === 'body' && bodyRequired ? !fields.body.trim() : false);
    return <label className={`eb-field ${key === 'body' ? 'eb-wide' : ''}`} htmlFor={`${idPrefix}-${key}`}>
      <span>{label}{key === 'title' || key === 'body' && bodyRequired ? ' *' : ''}</span>
      {multiline ? <textarea id={`${idPrefix}-${key}`} value={fields[key]} rows={12} readOnly={readOnly} disabled={disabled} required={bodyRequired} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${idPrefix}-${key}-error` : undefined} placeholder="原文；没有取得正文时保留为空，并登记来源文件。" onChange={event => onChange(key, event.target.value)} />
        : <input id={`${idPrefix}-${key}`} ref={key === 'title' ? titleRef : undefined} value={fields[key]} required={key === 'title'} readOnly={readOnly} disabled={disabled} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${idPrefix}-${key}-error` : undefined} placeholder={key === 'title' ? '给资料一个便于找到的名称' : '未知可留空'} onChange={event => onChange(key, event.target.value)} />}
      {invalid && <small id={`${idPrefix}-${key}-error`} className="eb-error">{key === 'title' ? '请填写资料标题。' : '人工笔记／整理请填写正文。'}</small>}
    </label>;
  };
  return <div className="eb-fields">{field('title', '资料标题')}{field('category', '类别')}{field('source', '来源说明')}{field('owner', '维护人')}{field('scope', '适用范围')}{field('effectiveTime', '业务生效时间说明')}{field('body', '资料正文', true)}</div>;
}
