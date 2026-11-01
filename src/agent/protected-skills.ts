import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { Skill } from './sdk.ts';

/** Snapshot only discovered skill resources, never the surrounding auth root. */
export function snapshotProtectedSkills(skills: readonly Skill[], destination: string) {
  const copied: Skill[] = [], unavailable: string[] = [];
  for (const skill of skills) {
    try {
      const source = realpathSync(skill.baseDir), file = realpathSync(skill.filePath);
      if (path.dirname(file) !== source || source === path.parse(source).root || source === process.env.HOME || !/^skill\.md$/i.test(path.basename(file))) throw new Error('not a dedicated skill directory');
      let bytes = 0, entries = 0;
      const files: { relative: string; data: Buffer; executable: boolean }[] = [];
      const scan = (from: string) => {
        const stat = lstatSync(from);
        if (++entries > 10_000 || stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))) throw new Error('unsafe skill resource');
        if (/^(auth|credentials|models|settings)\.json$|^\.env(?:\.|$)/i.test(path.basename(from))) throw new Error('private configuration is not a skill resource');
        if (stat.isDirectory()) {
          for (const name of readdirSync(from).sort()) scan(path.join(from, name));
        } else {
          const data = readFileSync(from); bytes += data.length;
          if (bytes > 32 * 1024 * 1024) throw new Error('skill resource exceeds snapshot size');
          if (data.length !== stat.size || lstatSync(from).mtimeMs !== stat.mtimeMs) throw new Error('skill changed during snapshot');
          files.push({ relative: path.relative(source, from), data, executable: Boolean(stat.mode & 0o111) });
        }
      };
      scan(source);
      const digest = createHash('sha256').update(file);
      for (const entry of files) digest.update(entry.relative).update('\0').update(entry.data);
      const target = path.join(destination, digest.digest('hex').slice(0, 24));
      if (!existsSync(target)) {
        // Stage outside the granted read root. A rejected/partial skill never
        // becomes readable merely because another skill was accepted.
        const staging = mkdtempSync(path.join(path.dirname(destination), '.skill-snapshot-'));
        try {
          for (const entry of files) {
            const output = path.join(staging, entry.relative);
            mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
            writeFileSync(output, entry.data, { flag: 'wx', mode: entry.executable ? 0o700 : 0o600 });
          }
          renameSync(staging, target);
        } finally { if (existsSync(staging)) rmSync(staging, { recursive: true }); }
      }
      copied.push({ ...skill, baseDir: target, filePath: path.join(target, path.basename(file)) });
    } catch { unavailable.push(skill.name); }
  }
  return { skills: copied, unavailable };
}
