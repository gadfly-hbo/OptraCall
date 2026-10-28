import { configureHttpTransport } from './http-transport.mjs';
process.umask(0o077);
const transport = configureHttpTransport();
try {
  const { runProjectSession } = await import('../src/agent/project-session.ts');
  await runProjectSession(transport);
} catch {
  await transport.close();
  process.exitCode = 1;
  if (process.connected) process.disconnect();
}
