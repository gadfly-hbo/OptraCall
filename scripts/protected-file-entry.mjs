// A fixed native-file executor, never a model or session runtime.
process.umask(0o077);
const { runProtectedFileProcess } = await import('../src/agent/protected-file-process.ts');
runProtectedFileProcess();
