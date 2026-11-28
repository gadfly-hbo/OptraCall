import { useEffect, useState } from 'react';
import type { CaseArtifactView } from '../case-types.ts';
import { HostRequestError, readSavedReport } from './runtime-client.ts';
import { StrategyDiscussionReply } from './StrategyDiscussionReply.tsx';

/** Read the original project file through the existing permission and exact-hash route. */
export type ArtifactReadState = 'loading' | 'ready' | 'forbidden' | 'unavailable' | 'changed';
export function DailyArtifactPreview({ artifact, onReadState }: { artifact: CaseArtifactView; onReadState?: (state: ArtifactReadState) => void }) {
  const [content, setContent] = useState<string | null>(null), [error, setError] = useState('');
  const textFile = /\.(md|markdown|txt|csv|tsv|json|ya?ml|log)$/i.test(artifact.relativePath);
  const readable = artifact.availability === 'available' && textFile && (artifact.observedBytes ?? 0) <= 1024 * 1024;
  useEffect(() => {
    const controller = new AbortController();
    setContent(null); setError('');
    if (readable) {
      onReadState?.('loading');
      void readSavedReport(artifact.projectId, artifact.relativePath, artifact.observedSha256 ?? '', controller.signal).then(value => {
        if (!controller.signal.aborted) { setContent(value); onReadState?.('ready'); }
      }, failure => { if (!controller.signal.aborted) {
        setContent(null); setError(failure instanceof Error ? failure.message : '原文暂不可读取。');
        onReadState?.(failure instanceof HostRequestError && failure.status === 403 ? 'forbidden' : failure instanceof HostRequestError && failure.status === 409 ? 'changed' : 'unavailable');
      } });
    }
    return () => controller.abort();
  }, [artifact.projectId, artifact.relativePath, artifact.observedSha256, readable]);
  return <section className="daily-artifact-preview" aria-label="资料原文">
    <h3>{artifact.observedSha256 ? '原引用版本的内容' : '当前文件内容'}</h3>
    {!artifact.observedSha256 && <p className="case-help">这条引用未固定内容摘要；当前文件不能代表历史版本。</p>}
    {!readable ? <p className="case-help">{artifact.availability !== 'available' ? '原文件当前不可作为引用时的版本读取，请核对下方来源状态。' : !textFile ? '此格式请通过下方原文件下载入口查看。' : '文件较大，请下载原文件查看完整内容。'}</p>
      : error ? <p role="alert" className="case-message">{error}</p>
      : content === null ? <p role="status" className="case-help">正在读取原文件…</p>
      : <>{/\.(md|markdown)$/i.test(artifact.relativePath) ? <StrategyDiscussionReply text={content.slice(0, 100_000)} /> : <pre>{content.slice(0, 100_000)}</pre>}{content.length > 100_000 && <p className="case-help">这里只展示前 100,000 个字符；完整原文可从下方下载。</p>}</>}
  </section>;
}
