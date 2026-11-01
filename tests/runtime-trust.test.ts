import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runtimeEnvironment } from '../scripts/runtime-process.ts';

test('Host and SDK child environments consume the trusted bundled CA option without inherited TLS or preload overrides', () => {
  const env = runtimeEnvironment({ PATH: process.env.PATH, NODE_OPTIONS: '--require=UNTRUSTED_PRELOAD', NODE_TLS_REJECT_UNAUTHORIZED: '0', SSL_CERT_FILE: '/untrusted/roots.pem' });
  const program = `
    const tls=require('node:tls'),crypto=require('node:crypto');
    const digest=kind=>crypto.createHash('sha256').update([...tls.getCACertificates(kind)].sort().join('\\n')).digest('hex');
    console.log(JSON.stringify({options:process.env.NODE_OPTIONS,disabledTls:process.env.NODE_TLS_REJECT_UNAUTHORIZED,extraFile:process.env.SSL_CERT_FILE,defaultRoots:digest('default'),bundledRoots:digest('bundled'),count:tls.getCACertificates('default').length}));
  `;
  const result = spawnSync(process.execPath, ['-e', program], { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.options, '--use-bundled-ca');
  assert.equal(observed.disabledTls, undefined); assert.equal(observed.extraFile, undefined);
  assert.equal(observed.defaultRoots, observed.bundledRoots); assert.ok(observed.count > 0);
});
