import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { API } from 'typescript/unstable/sync';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import { checkPinnedSdk } from './check-pi-sdk.mjs';
import { SyntaxKind, NodeFlags, isImportDeclaration, isExportDeclaration, isImportEqualsDeclaration, isImportTypeNode, isCallExpression, isNewExpression, isStringLiteralLikeNode, isIdentifier, isPropertyAccessExpression, isElementAccessExpression, isBinaryExpression, isVariableDeclaration, isFunctionDeclaration, isIfStatement, isBlock, isThrowStatement } from 'typescript/unstable/ast';

// These are entry-point/capability exceptions, not a blanket exemption for Host
// or tests. Changes require the same review as the session Interface.
const projectAgentOwners = new Set([
  'src/host/agent-sessions.ts',
  'tests/agent-sessions.test.ts',
  'tests/analysis-python.test.ts', // DB01/02/05: real Pi, synthetic provider and private environment/profile lifecycle.
  'tests/project-runtime.test.ts',
  'tests/agent-candidate-runtime.test.ts', // M3.1 isolated synthetic SDK proof only.
  'tests/personal-context-runtime.test.ts', // M4 isolated direct/nested SDK + callback transport proof only.
  'tests/sdk-tool-context-runtime.test.ts', // R1 frozen-source/qualification proof through the existing ProjectAgent seam only.
  'tests/sdk-network-compat.test.ts', // R3 loopback MCP/controlled TLS through the unchanged worker/transport entry only.
  'tests/semantic-context-runtime.test.ts', // L1 isolated SDK callback/nested/cancellation/auxiliary-failure proof; no product runtime ownership.
  'tests/experience-learning-runtime.test.ts', // M6 isolated ordinary cross-Case read/candidate qualification proof only.
  'tests/case-decision-runtime.test.ts', // M5 isolated SDK/Case callback scope proof; not a product runtime owner.
  'tests/model-http-environment.test.ts', // OR01/OR02: controlled SDK worker transport and safe native receipt boundary.
  'tests/requirement-runtime.test.ts',
  'tests/host-recovery.test.ts',
  // Captures real runtime callbacks to verify stale editor events after restore.
  'tests/project-session-guards.test.ts',
  // Isolated real-native provenance assertions; never a product runtime owner.
  'tests/semantic-provenance.test.ts',
  // AV08: isolated real SDK verification of canonical history and tool denial.
  'tests/protected-session.test.ts',
  // MO05: real SDK close acknowledgement while an ordinary response is held.
  'tests/managed-execution-stop-held.test.ts',
  'tests/subagent-runtime.test.ts', // SA01-SA04: isolated real SDK foreground delegation and parent cleanup.
  'tests/native-search-runtime.test.ts', // WEB01/02: loopback native-provider blocks and SDK continuation.
  'tests/model-pack-agent-flow.test.ts', // MP04/07: isolated real SDK/loopback provider proof; never product runtime ownership.
  'tests/deep-research-skill.test.ts', // DR03: isolated real SDK delegation through the shipped deep-research skill; never a product runtime owner.
]);
const sdkConsumers = new Set(['src/agent/project-session.ts', 'src/agent/runtime.ts', 'src/agent/browser-ui-context.ts']);
// Exact native tool/resource helpers, without session/runtime constructors.
const toolSdkConsumers = new Map([
  ['src/agent/tool-context-adapter.ts', new Set()], // R1 public types only; self-owned resource projection, no runtime constructors.
  ['src/agent/model-pack-tools.ts', new Set(['defineTool'])], // MP04/07: declarative tools only, no session constructors.
  ['src/host/native-session-snapshot.ts', new Set(['SessionManager', 'parseSessionEntries'])], // M3.1 guarded inMemory projection only; no open/create.
  ['src/agent/subagent.ts', new Set(['defineTool', 'parseFrontmatter'])], // Data discovery/tool schema only; SDK constructors remain in project-session.
  ['src/agent/native-search.ts', new Set()], // Protocol hooks only; no SDK constructor or independent loop.
  ['src/agent/protected-tools.ts', new Set(['createReadToolDefinition', 'createWriteToolDefinition', 'createEditToolDefinition', 'createBashToolDefinition', 'createGrepToolDefinition', 'createFindToolDefinition', 'createLsToolDefinition', 'createCodemodeExtension'])],
  ['src/agent/protected-tool-process.ts', new Set(['createReadTool', 'createWriteTool', 'createEditTool', 'createBashTool', 'createGrepTool', 'createFindTool', 'createLsTool', 'createCodemodeExtension'])],
  // MO02: native-only file executor and exact SDK equivalence fixture; no session/model capability.
  ['src/agent/protected-file-process.ts', new Set(['createReadTool', 'createWriteTool', 'createEditTool', 'createLsTool'])],
  ['src/agent/protected-bash-operations.ts', new Set()], // Public operations type only; no SDK value capability.
  ['tests/protected-file-process.test.ts', new Set(['createReadTool'])],
  ['tests/protected-bash-operations.test.ts', new Set(['createBashTool'])],
  ['src/agent/protected-skills.ts', new Set()],
  // SIM01: declarative simulation tool definitions only; no session/model capability.
  ['extensions/business-plugins/sim-lab/tools/simulation-tools.ts', new Set(['defineTool'])],
  ['tests/protected-skills.test.ts', new Set(['loadSkillsFromDir'])],
]);
const historyReaders = new Set(['src/host/project-history.ts', 'tests/project-migration.test.ts', 'tests/project-runtime.test.ts', 'tests/project-host.test.ts']);
// Verification is a Host-owned profile adapter like requirements; business
// Extensions still receive only owner-bound ports and cannot register domains.
// The verification Host also owns the separate, no-execution draft profile.
// decision-board extraction follows the same Host-owned adapter pattern.
const domainRegistrars = new Set(['src/host/server.ts', 'src/host/requirement-sessions.ts', 'src/host/verification-sessions.ts', 'src/host/verification-host.ts', 'src/host/decision-board-sessions.ts', 'src/host/ppt-refiner-sessions.ts', 'src/host/sap-method-sessions.ts', 'tests/agent-sessions.test.ts', 'tests/agent-session-execution.test.ts', 'tests/subagent-runtime.test.ts']); // SA03/SAM11: exact Host/public-domain registrations, never SDK runtime ownership.
const connectionProbeOwners = new Set(['src/host/server.ts', 'tests/fixtures/runtime-cases.mjs']);
// Launcher/update tests load their isolated fixture checkout by absolute URL.
const checkoutLoaders = new Set(['scripts/trial-launcher.mjs', 'tests/trial-launcher.test.ts', 'tests/trial-update.test.ts']);
const sdkPackageName = '(?:(?:@earendil-works/|@mariozechner/)?pi-(?:coding-agent|agent-core|ai|codemode|mcp|tui|telemetry))';
const sdkPackage = new RegExp(`^${sdkPackageName}(?:/|$)`);
const installedSdkPackage = new RegExp(`(?:^|/)node_modules/${sdkPackageName}(?:/|$)`);
const pinnedMcpPath = '../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/config.js';

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
    return { source: node.arguments[0] && isStringLiteralLikeNode(node.arguments[0]) ? node.arguments[0].text : undefined, names: ['*'], valueModule: node.arguments[0]?.getText() === "`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`" };
  }
}

function canonicalSource(file, source) {
  return source.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), source)).replace(/\.(?:[cm]?js|tsx?)$/, '.ts') : source;
}

/** Check a source at the same seam used by the repository check and fixtures. */
function inspectParsedSource(filePath, source, sourceFile) {
  const file = filePath.replaceAll('\\', '/').replace(/^\.\//, ''), violations = [];
  const fail = (pos, reason) => violations.push({ file, line: source.slice(0, pos).split('\n').length, reason });
  // Bounded lexical declarations/aliases, not interprocedural or dynamic taint.
  const functions = new Set([SyntaxKind.FunctionDeclaration, SyntaxKind.FunctionExpression, SyntaxKind.ArrowFunction, SyntaxKind.MethodDeclaration, SyntaxKind.GetAccessor, SyntaxKind.SetAccessor, SyntaxKind.Constructor]);
  const blocks = new Set([SyntaxKind.Block, SyntaxKind.CaseBlock, SyntaxKind.ModuleBlock, SyntaxKind.CatchClause, SyntaxKind.ForStatement, SyntaxKind.ForInStatement, SyntaxKind.ForOfStatement]);
  const scopes = new WeakMap();
  function bindName(name, owner, binding, redeclaration = false) {
    if (!name) return;
    if (isIdentifier(name)) {
      if (!redeclaration || binding.initializer || !owner.bindings.has(name.text)) owner.bindings.set(name.text, binding);
    } else for (const element of name.elements ?? []) bindName(element.name, owner, { scope: binding.scope });
  }
  function index(node, scope, parent) {
    if (isFunctionDeclaration(node) && node.name) scope.bindings.set(node.name.text, { scope });
    if (functions.has(node.kind) || blocks.has(node.kind)) scope = { parent: scope, functionScope: functions.has(node.kind), bindings: new Map() };
    scopes.set(node, scope);
    if (isVariableDeclaration(node) || node.kind === SyntaxKind.Parameter) {
      let owner = scope;
      const functionVariable = isVariableDeclaration(node) && parent?.kind === SyntaxKind.VariableDeclarationList && !(parent.flags & NodeFlags.BlockScoped);
      if (functionVariable) while (owner.parent && !owner.functionScope) owner = owner.parent;
      bindName(node.name, owner, { initializer: node.initializer, scope }, functionVariable);
    }
    node.forEachChild(child => index(child, scope, node));
  }
  index(sourceFile, { functionScope: true, bindings: new Map() });
  function unwrap(node) {
    while (node && [SyntaxKind.ParenthesizedExpression, SyntaxKind.NonNullExpression, SyntaxKind.AsExpression, SyntaxKind.TypeAssertionExpression, SyntaxKind.SatisfiesExpression].includes(node.kind)) node = node.expression;
    return node;
  }
  function sdkDefinition(expression, scope = scopes.get(expression), seen = new Set()) {
    const node = unwrap(expression);
    if (!node) return false;
    if (isCallExpression(node)) {
      const callee = unwrap(node.expression);
      return isPropertyAccessExpression(callee) && callee.name.text === 'getToolDefinition';
    }
    if (!isIdentifier(node)) return false;
    while (scope) {
      const binding = scope.bindings.get(node.text);
      if (binding) {
        if (seen.has(binding)) return false;
        seen.add(binding);
        return sdkDefinition(binding.initializer, binding.scope, seen);
      }
      scope = scope.parent;
    }
    return false;
  }
  function pinnedLoaderImport(node, ancestors) {
    const fn = [...ancestors].reverse().find(isFunctionDeclaration);
    if (!fn || fn.name?.text !== 'getSdkMcpConfigLoader' || !fn.body || !isCallExpression(node) || node.expression.kind !== SyntaxKind.ImportKeyword) return false;
    return fn.body.statements.some(statement => {
      if (!isIfStatement(statement) || statement.getStart(sourceFile) >= node.getStart(sourceFile)) return false;
      const condition = statement.expression;
      const rejection = isBlock(statement.thenStatement) ? statement.thenStatement.statements[0] : statement.thenStatement;
      return isBinaryExpression(condition) && condition.operatorToken.kind === SyntaxKind.ExclamationEqualsEqualsToken && isIdentifier(condition.left) && condition.left.text === 'VERSION' && isStringLiteralLikeNode(condition.right) && condition.right.text === '1.4.0' && rejection && isThrowStatement(rejection);
    });
  }
  function visit(node, ancestors = []) {
    const pos = node.getStart(sourceFile);
    if (isNewExpression(node) && isIdentifier(node.expression) && node.expression.text === 'ProjectAgent' && !projectAgentOwners.has(file)) fail(pos, 'ProjectAgent construction belongs to the shared lifecycle implementation');
    const left = isBinaryExpression(node) ? unwrap(node.left) : undefined;
    const callee = isCallExpression(node) ? unwrap(node.expression) : undefined;
    if (left && node.operatorToken.kind >= SyntaxKind.FirstAssignment && node.operatorToken.kind <= SyntaxKind.LastAssignment && (isPropertyAccessExpression(left) || isElementAccessExpression(left)) && sdkDefinition(left.expression)) fail(pos, 'SDK-owned tool definitions must not be changed; provide a Host-owned definition through public registration');
    if (callee && isPropertyAccessExpression(callee) && isIdentifier(unwrap(callee.expression)) && ((unwrap(callee.expression).text === 'Object' && ['assign', 'defineProperty', 'defineProperties'].includes(callee.name.text)) || (unwrap(callee.expression).text === 'Reflect' && callee.name.text === 'set')) && sdkDefinition(node.arguments[0])) fail(pos, 'SDK-owned tool definitions must not be changed through reflection');
    const ref = moduleReference(node);
    if (ref) checkReference(ref, pos, node, ancestors);
    node.forEachChild(child => visit(child, [...ancestors, node]));
  }
  function checkReference(ref, pos, node, ancestors) {
    if (ref.source === undefined) {
      // MP06: the exact value-only executor imports its verified pure core as an
      // encoded data module. No file/SDK path or arbitrary module argument is allowed.
      if (file === 'src/host/model-pack-runner.mjs' && ref.valueModule) return;
      // The trial updater intentionally resolves its own checked-out script.
      if (!checkoutLoaders.has(file)) fail(pos, 'non-literal module loading requires a reviewed entry point');
      return;
    }
    const target = canonicalSource(file, ref.source), names = ref.names;
    if ((sdkPackage.test(ref.source) || installedSdkPackage.test(ref.source.replaceAll('\\', '/'))) && file !== 'src/agent/sdk.ts') fail(pos, 'the SDK package is imported only by src/agent/sdk.ts');
    if (file === 'src/agent/sdk.ts' && (sdkPackage.test(ref.source) || installedSdkPackage.test(ref.source.replaceAll('\\', '/'))) && ref.source !== '@earendil-works/pi-coding-agent' && !(ref.source === pinnedMcpPath && (!names.length || pinnedLoaderImport(node, ancestors)))) fail(pos, 'only the public SDK and pinned lazy MCP loader behind VERSION 1.4.0 are reviewed');
    if (target === 'src/agent/sdk.ts' && !sdkConsumers.has(file)) {
      const tools = toolSdkConsumers.get(file);
      if (tools ? names.some(name => !tools.has(name)) : !historyReaders.has(file) || names.some(name => name !== 'SessionManager')) fail(pos, 'SDK access requires an approved runtime or native-history reader');
    }
    if (target === 'src/agent/project-runtime.ts' && names.some(name => ['ProjectAgent', '*', 'default'].includes(name)) && !projectAgentOwners.has(file)) fail(pos, 'features use an injected session port, not ProjectAgent');
    if (target === 'src/agent/project-session.ts' && !['scripts/project-entry.mjs', 'tests/fixtures/sdk-network-worker.mjs'].includes(file)) fail(pos, 'native session execution belongs to the dedicated process entry');
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
  const violations = [...await checkAgentSessionBoundary(process.cwd()), ...await checkPinnedSdk(process.cwd())];
  for (const violation of violations) console.error(`${violation.file}:${violation.line}: ${violation.reason}`);
  if (violations.length) process.exitCode = 1;
  else console.log('Agent session integration boundary and pinned SDK materials: PASS (official archive check is separate)');
}
