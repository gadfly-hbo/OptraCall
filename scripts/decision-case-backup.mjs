import { backupCaseStorage } from '../src/host/case-backup.ts';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--data-root' || args[2] !== '--projects-root' || !args[1] || !args[3]) {
  process.stderr.write('Usage: node scripts/decision-case-backup.mjs --data-root <stopped-Host-data-root> --projects-root <projects-root>\n');
  process.exitCode = 2;
} else {
  try {
    const result = await backupCaseStorage({ dataRoot: args[1], projectsRoot: args[3] });
    process.stdout.write(JSON.stringify({ backupPath: result.backupPath, storeId: result.manifest.storeId, scope: result.manifest.scope, files: result.manifest.files.length }) + '\n');
  } catch (error) {
    process.stderr.write(`Case structure backup failed: ${error.code ?? error.message}\n`);
    process.exitCode = 1;
  }
}
