// Offline engineering material checks; no SDK module is executed.
import path from 'node:path';
import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { findPackageJSON } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const sdk = '@earendil-works/pi-coding-agent';
const piPackages = ['pi-coding-agent', 'pi-agent-core', 'pi-ai', 'pi-codemode', 'pi-mcp', 'pi-tui', 'pi-telemetry'].map(name => '@earendil-works/' + name);
const sdkDependencies = {
  [sdk]: ['@earendil-works/pi-agent-core', '@earendil-works/pi-ai', '@earendil-works/pi-codemode', '@earendil-works/pi-mcp', '@earendil-works/pi-tui'],
  '@earendil-works/pi-agent-core': ['@earendil-works/pi-ai'],
  '@earendil-works/pi-ai': ['@earendil-works/pi-telemetry'],
};
const officialArchive = (name, version) => `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`;
const validIntegrity = value => {
  if (typeof value !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(value)) return false;
  const bytes = Buffer.from(value.slice(7), 'base64');
  return bytes.length === 64 && bytes.toString('base64') === value.slice(7);
};
const piReference = /(?:@earendil-works\/|@mariozechner\/|\b)pi-(?:coding-agent|agent-core|ai|codemode|mcp|tui|telemetry)(?:\b|@|\/)/;

export function inspectPinnedSdkMaterials(materials) {
  const violations = [];
  const fail = (file, reason) => violations.push({ file, line: 1, reason });
  if (materials.manifest?.dependencies?.[sdk] !== '1.4.0') fail('package.json', 'SDK dependency must be exactly @earendil-works/pi-coding-agent@1.4.0');
  if (materials.manifest?.dependencies?.undici !== '8.12.2' || materials.manifest?.overrides?.undici !== '8.12.2') fail('package.json', 'HTTP dependency and override must remain exactly undici@8.12.2');
  if (materials.lock?.packages?.['']?.dependencies?.[sdk] !== '1.4.0' || materials.lock?.packages?.['']?.dependencies?.undici !== '8.12.2' || materials.lock?.lockfileVersion !== 3) fail('package-lock.json', 'Root lock declarations must match the pinned SDK and HTTP dependencies');
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) for (const [name, value] of Object.entries(materials.manifest?.[field] ?? {})) {
    if (piReference.test(name) && (name !== sdk || field !== 'dependencies' || value !== '1.4.0') || typeof value === 'string' && /^(?:npm:|file:|link:|workspace:|git)/.test(value) && piReference.test(value)) fail('package.json', 'Pi aliases and alternative dependencies are prohibited');
  }
  function inspectOverrides(value, field) {
    if (!value || typeof value !== 'object') return;
    for (const [name, target] of Object.entries(value)) {
      if (piReference.test(name) || typeof target === 'string' && piReference.test(target) || /^(?:undici)(?:@|$)/.test(name) && target !== '8.12.2') fail('package.json', `${field} cannot replace or patch pinned SDK dependencies`);
      if (target && typeof target === 'object') inspectOverrides(target, field);
    }
  }
  inspectOverrides(materials.manifest?.overrides, 'overrides');
  inspectOverrides(materials.manifest?.resolutions, 'resolutions');
  inspectOverrides(materials.manifest?.pnpm?.overrides, 'pnpm.overrides');
  inspectOverrides(materials.manifest?.pnpm?.patchedDependencies, 'pnpm.patchedDependencies');
  for (const [name, command] of Object.entries(materials.manifest?.scripts ?? {})) {
    if (typeof command !== 'string') continue;
    // Ignore only an explicit standard-stream callee, retaining its arguments
    // so nested filesystem mutations still participate in this bounded check.
    const mutationText = command.replace(/\bprocess\s*\.\s*(?:stdout|stderr)\s*\.\s*writev?(?=\s*\()/g, 'standardStreamOutput');
    if (piReference.test(name + ' ' + command) && /\b(?:sed|perl|patch|mv|(?:cp|rm|write(?:File|v)?|appendFile|f?truncate|copyFile|rename|unlink)(?:Sync)?|createWriteStream)\b/.test(mutationText)) fail('package.json', `Known SDK installation patch mechanism in script ${name}`);
  }
  for (const item of materials.patchFiles ?? []) if (piReference.test(item.file + '\n' + item.source)) fail(item.file, 'Patch material targets a pinned official Pi package');
  for (const name of piPackages) {
    const entry = materials.lock?.packages?.['node_modules/' + name];
    if (entry?.version !== '1.4.0' || entry.resolved !== officialArchive(name, '1.4.0') || !validIntegrity(entry.integrity) || entry.link) fail('package-lock.json', `${name} requires the official 1.4.0 archive and SHA-512 integrity`);
  }
  for (const [location, entry] of Object.entries(materials.lock?.packages ?? {})) {
    const name = /(?:^|\/)node_modules\/(@earendil-works\/pi-[^/]+)$/.exec(location)?.[1];
    if (name && (!piPackages.includes(name) || entry.version !== '1.4.0' || entry.resolved !== officialArchive(name, '1.4.0') || !validIntegrity(entry.integrity) || entry.link)) fail('package-lock.json', `Nested official Pi lock material is not pinned and official: ${location}`);
  }
  const root = path.resolve(materials.root), nodeModules = path.join(root, 'node_modules');
  const packages = new Map((materials.packages ?? []).map(item => [item.directory, item]));
  const resolutions = materials.resolutions ?? [];
  const inspectResolution = (from, name) => {
    const resolution = resolutions.find(item => item.from === from && item.name === name);
    const target = resolution && packages.get(resolution.directory);
    if (!target || target.manifest?.name !== name || from === root && target.directory !== path.join(nodeModules, name)) fail('node_modules/' + name + '/package.json', `Actual resolution of ${name} from ${from} is missing or substituted`);
  };
  for (const name of [...piPackages, 'undici']) inspectResolution(root, name);
  for (const item of packages.values()) {
    const { name = 'missing-package-name', version } = item.manifest ?? {}, expected = name === 'undici' ? '8.12.2' : '1.4.0';
    const relative = path.relative(root, item.directory).replaceAll('\\', '/');
    const entry = materials.lock?.packages?.[relative];
    if (!piPackages.includes(name) && name !== 'undici' || version !== expected || item.symlink || item.realDirectory !== item.directory || !item.directory.startsWith(nodeModules + path.sep) || path.resolve(item.directory) !== item.directory) fail(relative + '/package.json', 'Actual SDK dependency name/version/path must match the unlinked pinned installation');
    if (entry?.version !== expected || entry.resolved !== officialArchive(name, expected) || !validIntegrity(entry.integrity) || entry.link || entry.name && entry.name !== name) fail('package-lock.json', `Resolved installation ${relative} has no matching official locked material`);
    for (const dependency of sdkDependencies[name] ?? []) {
      if (item.manifest.dependencies?.[dependency] !== '1.4.0' || entry?.dependencies?.[dependency] !== '1.4.0') fail(relative + '/package.json', `${name} must retain its fixed official dependency ${dependency}@1.4.0`);
      inspectResolution(item.directory, dependency);
    }
    if (name === sdk) inspectResolution(item.directory, 'undici');
  }
  return violations;
}

/** Read only the pinned package closure and known patch locations; never import SDK code. */
export async function checkPinnedSdk(root) {
  root = path.resolve(root);
  const violations = [], packages = [], resolutions = [], patchFiles = [];
  const fail = (file, reason) => violations.push({ file, line: 1, reason });
  const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
  try {
    const manifest = await readJson(path.join(root, 'package.json'));
    const lock = await readJson(path.join(root, 'package-lock.json'));
    async function resolvePinned(name, from) {
      try {
        const file = findPackageJSON(name, pathToFileURL(path.join(from, 'package.json')));
        if (!file) throw new Error('package_metadata_unavailable');
        const directory = path.dirname(file);
        const nodeModules = path.join(root, 'node_modules');
        if (!directory.startsWith(nodeModules + path.sep) || from === root && directory !== path.join(nodeModules, name)) throw new Error('package_metadata_substituted');
        resolutions.push({ from, name, directory });
        if (packages.some(item => item.directory === directory)) return;
        let symlink = (await lstat(file)).isSymbolicLink(), cursor = directory;
        while (cursor === nodeModules || cursor.startsWith(nodeModules + path.sep)) {
          symlink ||= (await lstat(cursor)).isSymbolicLink();
          cursor = path.dirname(cursor);
        }
        const realDirectory = await realpath(directory);
        if (symlink || realDirectory !== directory) throw new Error('package_metadata_linked');
        packages.push({ directory, realDirectory, symlink, manifest: await readJson(file) });
      } catch (error) { fail('node_modules/' + name + '/package.json', `Pinned package metadata cannot be resolved (${error.code ?? 'unavailable'})`); }
    }
    for (const name of [...piPackages, 'undici']) await resolvePinned(name, root);
    for (let index = 0; index < packages.length; index++) {
      const item = packages[index];
      for (const name of [...(sdkDependencies[item.manifest.name] ?? []), ...(item.manifest.name === sdk ? ['undici'] : [])]) await resolvePinned(name, item.directory);
    }
    async function readPatches(relative, depth = 0) {
      const directory = path.join(root, relative);
      let entries;
      try {
        if ((await lstat(directory)).isSymbolicLink()) { fail(relative, 'Patch directories cannot be symlink substitutes'); return; }
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const entry of entries) {
        const file = path.posix.join(relative, entry.name);
        if (entry.isSymbolicLink()) { fail(file, 'Patch materials cannot be symlink substitutes'); continue; }
        if (entry.isDirectory()) {
          if (depth >= 4) fail(file, 'Patch material depth exceeds the bounded engineering check');
          else await readPatches(file, depth + 1);
        } else if (entry.isFile()) {
          if ((await lstat(path.join(root, file))).size > 2 * 1024 * 1024) fail(file, 'Patch material exceeds the bounded engineering check');
          else patchFiles.push({ file, source: await readFile(path.join(root, file), 'utf8') });
        }
      }
    }
    await readPatches('patches'); await readPatches('.yarn/patches');
    return [...violations, ...inspectPinnedSdkMaterials({ root, manifest, lock, packages, resolutions, patchFiles })];
  } catch (error) {
    fail('package.json', `Pinned SDK materials could not be read (${error.code ?? 'invalid_material'})`);
    return violations;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = await checkPinnedSdk(process.cwd());
  for (const violation of violations) console.error(`${violation.file}:${violation.line}: ${violation.reason}`);
  if (violations.length) process.exitCode = 1;
  else console.log('Pinned official Pi SDK materials: PASS (offline metadata only; archive verification is separate)');
}
