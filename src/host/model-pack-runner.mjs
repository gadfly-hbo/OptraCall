// Trusted value-only executor. No model gets paths, credentials, inherited file handles,
// filesystem/network grants, or a fallback without Node permissions.
import { readFileSync } from 'node:fs';
try {
  if (Number(process.versions.node.split('.')[0]) < 25 || !process.permission || process.permission.has('net') || process.permission.has('child') || process.permission.has('worker') || process.permission.has('addons')) throw new Error('sandbox_unavailable');
  const {source,rows}=JSON.parse(readFileSync(0,'utf8'));
  const module=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const output=await module.predict(rows);
  process.stdout.write(JSON.stringify(output));
} catch (error) { process.stderr.write(error?.message === 'sandbox_unavailable' ? 'sandbox_unavailable' : 'model_execution_failed'); process.exitCode=1; }
