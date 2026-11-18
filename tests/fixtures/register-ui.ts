import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'rolldown/utils';

const projectRoot = new URL('../../', import.meta.url).href;

// UI sources use JSX and TypeScript parameter properties. Let Node load the
// rest of the test graph normally, and leave stylesheet rendering to browsers.
registerHooks({
  load(url, context, nextLoad) {
    const relative = url.startsWith(projectRoot) ? url.slice(projectRoot.length) : '';
    if (!/^(?:src\/host\/ui|extensions\/business-plugins\/[^/]+\/ui)\//.test(relative)) return nextLoad(url, context);
    if (/\.tsx?$/.test(url)) {
      const file = fileURLToPath(url);
      const { code, errors } = transformSync(file, readFileSync(file, 'utf8'), { jsx: { runtime: 'automatic' } });
      if (errors.length) throw new Error(errors.map(error => error.message).join('\n'));
      return { format: 'module', source: code, shortCircuit: true };
    }
    if (url.endsWith('.css')) {
      return { format: 'module', source: '', shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
