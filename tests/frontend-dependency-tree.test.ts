import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the complete install lock excludes picomatch, including nested and aliased copies', async () => {
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const packages: Record<string, { name?: string }> = lock.packages;
  const matches = Object.entries(packages)
    .filter(([location, entry]) => location.endsWith('/node_modules/picomatch')
      || location === 'node_modules/picomatch' || entry.name === 'picomatch')
    .map(([location]) => location);
  assert.deepEqual(matches, [], 'Reintroduced picomatch packages in the lock');
});
