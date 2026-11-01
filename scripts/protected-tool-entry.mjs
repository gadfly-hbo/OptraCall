// A tool executor, never an Agent Runtime. No model configuration or native
// session file is passed into this process.
process.umask(0o077);
const { runProtectedToolProcess } = await import('../src/agent/protected-tool-process.ts');
await runProtectedToolProcess();
