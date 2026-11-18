/** Browser-tab recovery metadata only; never a native publication receipt. */
export interface MetricPublicationAttempt {
  attemptId: string; packageId: string; version: string; packageFingerprint: string;
  projectId: string; path: string; reviewer: string; attemptedAt: string; enterpriseId?: string;
}
type AttemptStorage = Pick<Storage, 'getItem' | 'setItem'>;
const key = 'optracall.metric-publication-attempts.v1';
const isAttempt = (value: unknown): value is MetricPublicationAttempt => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return ['attemptId', 'packageId', 'version', 'projectId', 'path', 'reviewer', 'attemptedAt'].every(name => typeof item[name] === 'string' && item[name].length > 0)
    && typeof item.packageFingerprint === 'string' && /^sha256:[a-f0-9]{64}$/.test(item.packageFingerprint)
    && (item.enterpriseId === undefined || typeof item.enterpriseId === 'string');
};
export function readMetricPublicationAttempts(storage?: AttemptStorage): MetricPublicationAttempt[] {
  const raw = storage?.getItem(key);
  if (raw === null || raw === undefined) return [];
  const value = JSON.parse(raw) as { schemaVersion?: unknown; attempts?: unknown };
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.attempts) || !value.attempts.every(isAttempt)) throw new Error('本标签页的原发布尝试暂存未能核对；保留原记录，未以空记录覆盖。');
  return value.attempts;
}
export function saveMetricPublicationAttempts(storage: AttemptStorage | undefined, attempts: MetricPublicationAttempt[]): void {
  if (!storage) throw new Error('本标签页暂存不可用，未发送发布请求。');
  const raw = JSON.stringify({ schemaVersion: 1, attempts });
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error('本标签页未能读回发布尝试暂存，未发送发布请求。');
}
