import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { API } from 'typescript/unstable/sync';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import { SyntaxKind, isImportDeclaration, isExportDeclaration, isImportEqualsDeclaration, isImportTypeNode, isCallExpression, isNewExpression, isStringLiteralLikeNode, isIdentifier, isPropertyAccessExpression } from 'typescript/unstable/ast';

// These are entry-point/capability exceptions, not a blanket exemption for Host
// or tests. Changes require the same review as the session Interface.
const projectAgentOwners = new Set([
  'src/host/agent-sessions.ts',
  'tests/agent-sessions.test.ts',
  'tests/project-runtime.test.ts',
  'tests/requirement-runtime.test.ts',
  'tests/host-recovery.test.ts',
  // Captures real runtime callbacks to verify stale editor events after restore.
  'tests/project-session-guards.test.ts',
  // Isolated real-native provenance assertions; never a product runtime owner.
  'tests/semantic-provenance.test.ts',
]);
const sdkConsumers = new Set(['src/agent/project-session.ts', 'src/agent/runtime.ts', 'src/agent/browser-ui-context.ts']);
const historyReaders = new Set(['src/host/project-history.ts', 'tests/project-migration.test.ts', 'tests/project-runtime.test.ts', 'tests/project-host.test.ts']);
// Verification is a Host-owned profile adapter like requirements; business
// Extensions still receive only owner-bound ports and cannot register domains.
// The verification Host also owns the separate, no-execution draft profile.
const domainRegistrars = new Set(['src/host/server.ts', 'src/host/requirement-sessions.ts', 'src/host/verification-sessions.ts', 'src/host/verification-host.ts', 'tests/agent-sessions.test.ts']);
const connectionProbeOwners = new Set(['src/host/server.ts', 'tests/fixtures/runtime-cases.mjs']);
// Launcher/update tests load their isolated fixture checkout by absolute URL.
const checkoutLoaders = new Set(['scripts/trial-launcher.mjs', 'tests/trial-launcher.test.ts', 'tests/trial-update.test.ts']);
const sdkPackage = /^(?:@earendil-works\/pi-coding-agent|@mariozechner\/pi-(?:coding-agent|agent-core|ai)|pi-(?:coding-agent|agent-core|ai))(?:\/|$)/;

function valueNames(clause, isTypeOnly = false) {
  if (isTypeOnly || clause?.phaseModifier === SyntaxKind.TypeKeyword) return [];
  if (!clause) return ['*'];
  const bindings = clause.namedBindings ?? clause;
  if (!bindings.elements) return ['*'];
  return [...(clause.name ? ['default'] : []), ...bindings.elements.filter(item => !item.isTypeOnly).map(item => (item.propertyName ?? item.name).text)];
}

function moduleReference(node) {
  if (isImportDeclaration(node)) return { source: node.moduleSpecifier.text, names: valueNames(node.importClause) };
  if (isExportDeclaration(node) && node.moduleSpecifier) return { source: node.moduleSpecifier.text, names: valueNames(node.exportClause, node.isTypeOnly) };
  if (isImportEqualsDeclaration(node) && node.moduleReference.expression) return { source: node.moduleReference.expression.text, names: node.isTypeOnly ? [] : ['*'] };
  if (isImportTypeNode(node) && node.argument.literal) return { source: node.argument.literal.text, names: [] };
  if (isCallExpression(node) && (node.expression.kind === SyntaxKind.ImportKeyword || (isIdentifier(node.expression) && node.expression.text === 'require') || (isPropertyAccessExpression(node.expression) && node.expression.name.text === 'require'))) {
    return { source: node.arguments[0] && isStringLiteralLikeNode(node.arguments[0]) ? node.arguments[0].text : undefined, names: ['*'] };
  }
}

function canonicalSource(file, source) {
  return source.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), source)).replace(/\.(?:[cm]?js|tsx?)$/, '.ts') : source;
}

/** Check a source at the same seam used by the repository check and fixtures. */
function inspectParsedSource(filePath, source, sourceFile) {
  const file = filePath.replaceAll('\\', '/').replace(/^\.\//, ''), violations = [];
  const fail = (pos, reason) => violations.push({ file, line: source.slice(0, pos).split('\n').length, reason });
  function visit(node) {
    const pos = node.getStart(sourceFile);
    if (isNewExpression(node) && isIdentifier(node.expression) && node.expression.text === 'ProjectAgent' && !projectAgentOwners.has(file)) fail(pos, 'ProjectAgent construction belongs to the shared lifecycle implementation');
    const ref = moduleReference(node);
    if (ref) checkReference(ref, pos);
    node.forEachChild(visit);
  }
  function checkReference(ref, pos) {
    if (ref.source === undefined) {
      // The trial updater intentionally resolves its own checked-out script.
      if (!checkoutLoaders.has(file)) fail(pos, 'non-literal module loading requires a reviewed entry point');
      return;
    }
    const target = canonicalSource(file, ref.source), names = ref.names;
    if (sdkPackage.test(ref.source) && file !== 'src/agent/sdk.ts') fail(pos, 'the SDK package is imported only by src/agent/sdk.ts');
    if (target === 'src/agent/sdk.ts' && !sdkConsumers.has(file)) {
      if (!historyReaders.has(file) || names.some(name => name !== 'SessionManager')) fail(pos, 'SDK access requires an approved runtime or native-history reader');
    }
    if (target === 'src/agent/project-runtime.ts' && names.some(name => ['ProjectAgent', '*', 'default'].includes(name)) && !projectAgentOwners.has(file)) fail(pos, 'features use an injected session port, not ProjectAgent');
    if (target === 'src/agent/project-session.ts' && file !== 'scripts/project-entry.mjs') fail(pos, 'native session execution belongs to the dedicated process entry');
    if (target === 'src/agent/runtime.ts' && names.some(name => ['AgentRuntime', '*', 'default'].includes(name)) && !connectionProbeOwners.has(file)) fail(pos, 'the legacy AgentRuntime is reserved for the fixed connection probe');
    if (target === 'src/host/agent-sessions.ts' && names.some(name => ['createAgentSessionDomain', '*', 'default'].includes(name)) && !domainRegistrars.has(file)) fail(pos, 'Host registers domains and injects owner-bound ports into features');
    if (['node:module', 'module'].includes(ref.source) && names.some(name => ['createRequire', '*', 'default'].includes(name))) fail(pos, 'feature module loaders cannot bypass the reviewed import paths');
  }
  visit(sourceFile);
  return violations;
}

/** Parse batches in an in-memory project; no product files/config are written. */
export function inspectSessionSources(sources) {
  const virtualRoot = path.resolve(process.cwd(), '.agent-session-boundary-virtual'), config = path.join(virtualRoot, 'tsconfig.json');
  const files = sources.map(({ file }, index) => path.join(virtualRoot, `input-${index}${path.extname(file)}`));
  const fs = createVirtualFileSystem({
    [config]: JSON.stringify({ compilerOptions: { noLib: true, noResolve: true, allowJs: true, jsx: 'preserve' }, files }),
    ...Object.fromEntries(sources.map(({ source }, index) => [files[index], source])),
  });
  const api = new API({ cwd: process.cwd(), fs });
  let snapshot;
  try {
    snapshot = api.updateSnapshot({ openProjects: [config] });
    const program = snapshot.getProject(config)?.program;
    if (!program) throw new Error('Cannot open the session-boundary parser project');
    return sources.map(({ file, source }, index) => {
      const sourceFile = program.getSourceFile(files[index]);
      if (!sourceFile) throw new Error(`Cannot parse ${file}`);
      const diagnostics = program.getSyntacticDiagnostics(files[index]);
      if (diagnostics.length) return [{ file, line: 1, reason: 'source has syntax errors; session boundary cannot be verified' }];
      return inspectParsedSource(file, source, sourceFile);
    });
  } finally { snapshot?.dispose(); api.close(); }
}

export function inspectSessionSource(file, source) { return inspectSessionSources([{ file, source }])[0]; }

export async function checkAgentSessionBoundary(root) {
  const sources = [];
  async function visit(relative) {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries) {
      const file = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && /\.(?:[cm]?[jt]sx?)$/.test(entry.name)) sources.push({ file, source: await readFile(path.join(root, file), 'utf8') });
    }
  }
  for (const directory of ['src', 'extensions', 'scripts', 'tests']) await visit(directory);
  return inspectSessionSources(sources).flat();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = await checkAgentSessionBoundary(process.cwd());
  for (const violation of violations) console.error(`${violation.file}:${violation.line}: ${violation.reason}`);
  if (violations.length) process.exitCode = 1;
  else console.log('Agent session integration boundary: PASS');
}
