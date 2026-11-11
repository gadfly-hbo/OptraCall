// Pre-cutover Host admission harness. This option is not a CLI argument, HTTP
// field or production configuration. Current/default Host tests use host-entry.
import { configureHttpTransport } from '../../scripts/http-transport.mjs';
if (process.env.OPTRACALL_HOST_ISOLATED !== '1') throw new Error('Isolated Host fixture required.');
const transport = configureHttpTransport();
try {
  const { runHost } = await import('../../src/host/main.ts');
  await runHost(transport, { reviewAdmission: 'legacy' });
} catch (error) {
  await transport.close();
  process.stderr.write('Legacy admission fixture could not start.\n');
  process.exitCode = 1;
}
