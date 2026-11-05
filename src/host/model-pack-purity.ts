import path from 'node:path';
import { API } from 'typescript/unstable/sync';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import { SyntaxKind, isIdentifier, isImportDeclaration, isExportDeclaration, isCallExpression, isPropertyAccessExpression, isStringLiteralLikeNode } from 'typescript/unstable/ast';
import { ModelPackError } from './model-pack-error.ts';

/** v1 exports have a pure module followed by an MPS Host-owned CLI adapter.
 * Only the pure module is evaluated by this consumer; CLI never gets capabilities. */
export function pureModelSource(source: string): string {
  const marker = '// --- Host 追加的 CLI 包装（确定性代码，非 agent 产物）---';
  const at = source.indexOf(marker), core = at < 0 ? source : source.slice(0, at);
  const root = path.resolve('.model-pack-parser'), config = path.join(root,'tsconfig.json'), file = path.join(root,'predict.mjs');
  const fs = createVirtualFileSystem({[config]:JSON.stringify({compilerOptions:{noLib:true,noResolve:true,allowJs:true},files:[file]}),[file]:source});
  const api = new API({cwd:process.cwd(),fs}); let snapshot;
  const reject = (reason: string): never => { throw new ModelPackError('PURITY_REJECTED',400,'purity_scan',reason); };
  try {
    snapshot=api.updateSnapshot({openProjects:[config]}); const program=snapshot.getProject(config)?.program, ast=program?.getSourceFile(file);
    if (!ast || program!.getSyntacticDiagnostics(file).length) reject('predict.mjs 语法不合法');
    const forbidden = new Set(['eval','Function','AsyncFunction','GeneratorFunction','Date','Temporal','global','globalThis','fetch','WebSocket','XMLHttpRequest','require','module','exports','WebAssembly','Deno','Bun','SharedArrayBuffer','Atomics','WeakRef','FinalizationRegistry','setTimeout','setInterval','setImmediate','queueMicrotask','performance','crypto','Intl']);
    function visit(node: any, parent?: any) {
      const cli=at>=0 && node.getStart(ast)>=at;
      if (isImportDeclaration(node) || isExportDeclaration(node) && node.moduleSpecifier) {
        const spec=node.moduleSpecifier;
        if (!cli || !spec || !isStringLiteralLikeNode(spec) || !['node:fs','node:url'].includes(spec.text)) reject('模型纯计算模块不允许 import 或包外依赖');
      }
      if (isCallExpression(node) && node.expression.kind===SyntaxKind.ImportKeyword) reject('不允许动态 import');
      if (isIdentifier(node) && node.text==='Math' && !cli) {
        const stable=new Set(['abs','acos','acosh','asin','asinh','atan','atanh','atan2','ceil','cbrt','expm1','clz32','cos','cosh','exp','floor','fround','hypot','imul','log','log1p','log2','log10','max','min','pow','round','sign','sin','sinh','sqrt','tan','tanh','trunc','E','LN10','LN2','LOG10E','LOG2E','PI','SQRT1_2','SQRT2']);
        if (!parent || !isPropertyAccessExpression(parent) || parent.expression!==node || !stable.has(parent.name.text)) reject('Math 仅允许直接使用确定性成员，不允许 random、计算索引或转交对象');
      }
      if (isIdentifier(node)) {
        if (forbidden.has(node.text) || !cli && ['process','console','Buffer'].includes(node.text)) reject(`禁止能力或非确定性标识: ${node.text}`);
        if (['constructor','__proto__'].includes(node.text)) reject('不允许原型构造器访问');
      }
      if (isStringLiteralLikeNode(node) && ['constructor','__proto__'].includes(node.text)) reject('不允许原型构造器访问');
      if (node.kind===SyntaxKind.ThisKeyword) reject('不允许 this 全局能力访问');
      if (isPropertyAccessExpression(node) && node.expression.getText(ast)==='Math' && node.name.text==='random') reject('禁止 Math.random');
      node.forEachChild((child:any)=>visit(child,node));
    }
    ast!.forEachChild((child:any)=>visit(child,ast));
  } catch(error) { if(error instanceof ModelPackError) throw error; reject('纯度解析器不可用，拒绝导入'); }
  finally { snapshot?.dispose(); api.close(); }
  if (!/\bexport\s+(?:async\s+)?function\s+predict\s*\(|\bexport\s+(?:const|let)\s+predict\s*=/.test(core)) reject('必须导出 predict(rows)');
  return core;
}
