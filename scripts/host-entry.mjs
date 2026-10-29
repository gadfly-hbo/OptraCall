import { configureHttpTransport } from './http-transport.mjs';

if (process.env.OPTRACALL_HOST_ISOLATED !== '1') throw new Error('Use npm run host or npm run dev to start the Host.');
const transport = configureHttpTransport();
try {
  const { runHost } = await import('../src/host/main.ts');
  await runHost(transport);
} catch (error) {
  await transport.close();
  process.stderr.write('OptraCall Host could not start. Check runtime and port availability.\n');
  if (error && typeof error === 'object' && 'code' in error) process.stderr.write(`Startup code: ${String(error.code).replace(/[^A-Z0-9_]/gi, '').slice(0, 80)}\n`);
  if (error?.code === 'ERR_ACCESS_DENIED' && typeof error.resource === 'string' && error.resource.startsWith('/')) process.stderr.write(`Denied startup path: ${error.resource.replace(/[\r\n]/g, '').slice(0, 500)}\n`);
  process.exitCode = 1;
}
