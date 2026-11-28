/** UI input protection only; this does not own Agent operations or sessions. */
const guards = new Set<() => Promise<boolean>>();
export function registerWorkspaceInputGuard(guard: () => Promise<boolean>): () => void {
  guards.add(guard);
  return () => { guards.delete(guard); };
}
export async function flushWorkspaceInputs(): Promise<boolean> {
  const results = await Promise.allSettled([...guards].map(guard => guard()));
  return results.every(result => result.status === 'fulfilled' && result.value);
}
