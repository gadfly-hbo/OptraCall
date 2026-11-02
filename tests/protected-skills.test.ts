import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadSkillsFromDir } from '../src/agent/sdk.ts';
import { snapshotProtectedSkills } from '../src/agent/protected-skills.ts';

test('protected skill snapshots keep complete safe resources and immutable old versions', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'optracall-protected-skills-')), source = path.join(root, 'skills'), destination = path.join(root, 'snapshots');
  const leaf = path.join(source, 'example'); mkdirSync(path.join(leaf, 'scripts'), { recursive: true, mode: 0o700 }); mkdirSync(destination, { mode: 0o700 });
  const original = '---\nname: example\ndescription: A generic fixture\n---\nRead scripts/helper.py as needed.\n';
  writeFileSync(path.join(leaf, 'SKILL.md'), original); writeFileSync(path.join(leaf, 'scripts/helper.py'), 'print(42)\n', { mode: 0o700 });
  const loaded = loadSkillsFromDir({ dir: source, source: 'test' }).skills;
  assert.equal(loaded.length, 1);
  const one = snapshotProtectedSkills(loaded, destination); assert.equal(one.skills.length, 1); assert.deepEqual(one.unavailable, []);
  assert.equal(readFileSync(one.skills[0].filePath, 'utf8'), original);
  assert.equal(readFileSync(path.join(one.skills[0].baseDir, 'scripts/helper.py'), 'utf8'), 'print(42)\n');
  writeFileSync(path.join(leaf, 'SKILL.md'), original + 'A new version.\n');
  const two = snapshotProtectedSkills(loaded, destination); assert.equal(two.skills.length, 1); assert.notEqual(two.skills[0].filePath, one.skills[0].filePath);
  assert.equal(readFileSync(one.skills[0].filePath, 'utf8'), original);
});

test('unsafe skill attachments never become visible as a partial accepted snapshot', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'optracall-protected-skills-')), source = path.join(root, 'skills'), destination = path.join(root, 'snapshots'), leaf = path.join(source, 'unsafe');
  mkdirSync(leaf, { recursive: true, mode: 0o700 }); mkdirSync(destination, { mode: 0o700 });
  writeFileSync(path.join(leaf, 'SKILL.md'), '---\nname: unsafe\ndescription: Fixture\n---\nNever copy private files.\n');
  const secret = path.join(root, 'auth.json'); writeFileSync(secret, 'PRIVATE'); symlinkSync(secret, path.join(leaf, 'attachment'));
  const loaded = loadSkillsFromDir({ dir: source, source: 'test' }).skills;
  const result = snapshotProtectedSkills(loaded, destination);
  assert.equal(result.skills.length, 0); assert.deepEqual(result.unavailable, ['unsafe']); assert.deepEqual(readdirSync(destination), []);
  assert.equal(readFileSync(secret, 'utf8'), 'PRIVATE');
});

test('PPT skill discovery and protected snapshot retain the real page-order helper and complete assets', () => {
  const codeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const source = path.join(codeRoot, 'extensions/analysis-assets');
  const skill = loadSkillsFromDir({ dir: source, source: 'project' }).skills.find(item => item.name === 'ppt-report');
  assert.ok(skill, 'the actual repository asset must be discoverable by the locked SDK');
  const destination = mkdtempSync(path.join(os.tmpdir(), 'optracall-ppt-snapshot-'));
  const result = snapshotProtectedSkills([skill], destination);
  assert.deepEqual(result.unavailable, []); assert.equal(result.skills.length, 1);
  for (const relative of ['SKILL.md', 'scripts/pptx_parts.py', 'scripts/splice_slide.py', 'references/design-system.md']) {
    assert.deepEqual(readFileSync(path.join(result.skills[0]!.baseDir, relative)), readFileSync(path.join(skill.baseDir, relative)), relative);
  }
});

test('TF01: the three forecast skills load from the analysis-assets directory and snapshot intact', () => {
  const codeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const source = path.join(codeRoot, 'extensions/analysis-assets');
  const { skills } = loadSkillsFromDir({ dir: source, source: 'project' });
  const byName = new Map(skills.map(item => [item.name, item]));
  for (const name of ['target-forecast', 'coupon-forecast', 'roi-forecast']) {
    const skill = byName.get(name);
    assert.ok(skill, `${name} must be discoverable by the locked SDK; got ${skills.map(item => item.name).join(',')}`);
    assert.equal(skill.baseDir, path.join(source, name), `${name} must resolve to its analysis-assets directory`);
    assert.ok((skill.description ?? '').length > 30, `${name} must carry an activation description`);
  }
  const destination = mkdtempSync(path.join(os.tmpdir(), 'optracall-tf-snapshot-'));
  const picked = ['target-forecast', 'coupon-forecast', 'roi-forecast'].map(name => byName.get(name)!);
  const result = snapshotProtectedSkills(picked, destination);
  assert.deepEqual(result.unavailable, []); assert.equal(result.skills.length, 3);
  for (const skill of result.skills) assert.ok(readFileSync(path.join(skill.baseDir, 'SKILL.md'), 'utf8').length > 0);
});
