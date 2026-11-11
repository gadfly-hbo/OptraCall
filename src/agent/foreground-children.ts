type ForegroundChild = {
  session: { waitForIdle(): Promise<void> };
  dispose(): Promise<void>;
};

/** The worker's existing foreground resources share this one retirement
 * authority. Failed retirement stays owned until an explicit retry. */
export function createForegroundChildren<Child extends ForegroundChild>(onCleanupUnknown: () => void) {
  const children = new Set<Child>();
  const retirements = new Map<Child, Promise<void>>();
  const failures = new Set<Child>();
  function retire(child: Child, retryFailed = false): Promise<void> {
    if (retryFailed && failures.delete(child)) retirements.delete(child);
    let task = retirements.get(child);
    if (!task) {
      task = (async () => {
        await child.session.waitForIdle();
        await child.dispose();
        children.delete(child);
      })().then(() => { retirements.delete(child); }, error => {
        failures.add(child);
        onCleanupUnknown();
        throw error;
      });
      retirements.set(child, task);
      void task.catch(() => {});
    }
    return task;
  }
  return {
    children,
    hasFailures: () => failures.size > 0,
    retire,
    async retireAll(retryFailed = false) {
      const settled = await Promise.allSettled([...children].map(child => retire(child, retryFailed)));
      if (settled.some(result => result.status === 'rejected')) throw new Error('subagent_cleanup_unknown');
    },
  };
}
