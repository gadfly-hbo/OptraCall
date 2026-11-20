import type { StrategyDiscussionSource } from './strategy-discussion-types.ts';

export interface StrategyAttachmentNote { locator:string; text:string }
export interface StrategyAttachmentCitation { source:StrategyDiscussionSource; locator:string; token:string }
export interface StrategyAttachmentReplyReferences { requestId:string; entryId:string; citations:StrategyAttachmentCitation[] }
export const attachmentExtensions = ['.pdf','.docx','.xlsx','.md','.markdown','.txt','.csv','.tsv','.json'] as const;
export const strategyAttachmentLimit = 8*1024*1024;
export const strategyAttachmentKind = 'strategy-attachment';

export const attachmentErrors:Readonly<Record<string,string>>={
  strategy_attachment_format_unsupported:'请选择文字 PDF、Word DOCX、Excel XLSX 或 UTF-8 文本。',
  strategy_attachment_invalid_document:'文件格式或内容无法读取，请核对原文件。',
  strategy_attachment_expansion_limit:'文档展开后超出读取范围，请将相关章节另存为较小文档。',
  strategy_attachment_text_limit:'文档文本量超过本机读取范围，请选择相关章节。',
  strategy_attachment_pdf_unreadable:'PDF 文本无法解析，请检查密码保护或提供可读取的正文。',
  strategy_attachment_no_text:'文件中没有可读取的文字。扫描文档请提供带文字层的文件。',
  strategy_attachment_not_authorized:'当前讨论已无权读取这份材料，请核对讨论范围或项目状态。',
  strategy_attachment_original_changed:'原文件内容已变更，本引用的版本无法核对。',
  strategy_attachment_original_unavailable:'本引用对应的原文件或原版本已不可读。',
  strategy_attachment_location_unavailable:'该版本没有指定的页、工作表行、段落或文本行。',
  strategy_attachment_too_large:'每份讨论资料最多 8 MiB。',
};
