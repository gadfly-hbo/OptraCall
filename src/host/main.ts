import { createHost } from './server.ts';
import { SDK_VERSION } from '../agent/runtime.ts';
import path from 'node:path';
import os from 'node:os';
import { loadSemanticGraphConfiguration } from './semantic-graph-config.ts';

export async function runHost(transport: { version: string; close: () => Promise<void> }): Promise<void> {
  const values = new Map(process.argv.slice(2).map(value => { const index = value.indexOf('='); return index < 0 ? [value, undefined] : [value.slice(0, index), value.slice(index + 1)]; }));
  if ([...values.keys()].some(key => !['--port', '--ui-port', '--connection-timeout-ms', '--data-root', '--projects-root', '--ui-root', '--instance-id', '--semantic-config', '--studio-python', '--disable-case-decisions', '--disable-experience-learning', '--disable-sap-methods'].includes(key ?? ''))) throw new Error('Unknown Host argument.');
  const port = Number(values.get('--port') ?? 4175), uiPort = Number(values.get('--ui-port') ?? 4173), timeout = Number(values.get('--connection-timeout-ms') ?? 15_000);
  if (![port, uiPort, timeout].every(Number.isInteger) || port < 0 || port > 65_535 || uiPort < 1 || uiPort > 65_535 || timeout < 50 || timeout > 60_000) throw new Error('Invalid Host argument.');
  const instanceId = values.get('--instance-id'); if (instanceId && !/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(instanceId)) throw new Error('Invalid instance identity.');
  if (values.has('--disable-case-decisions') && values.get('--disable-case-decisions') !== undefined) throw new Error('Invalid Host argument.');
  if (values.has('--disable-experience-learning') && values.get('--disable-experience-learning') !== undefined) throw new Error('Invalid Host argument.');
  if (values.has('--disable-sap-methods') && values.get('--disable-sap-methods') !== undefined) throw new Error('Invalid Host argument.');
  if (values.has('--semantic-config') && !values.get('--semantic-config')) throw new Error('Invalid Host argument.');
  const studioPython = values.get('--studio-python'); if (values.has('--studio-python') && (!studioPython || !path.isAbsolute(studioPython) || studioPython.includes('\0'))) throw new Error('Invalid Studio Python path.');
  const semanticGraph = await loadSemanticGraphConfiguration({ file: values.get('--semantic-config'), codeRoot: process.cwd(), dataRoot: values.get('--data-root') ?? path.join(os.homedir(), '.optracall'), projectsRoot: values.get('--projects-root') ?? path.join(os.homedir(), 'OptraCallProjects') });
  const effectiveStudioPython = studioPython ?? semanticGraph?.python;
  const host = createHost({ cwd: process.cwd(), uiPorts: [uiPort, uiPort === 4173 ? 4174 : uiPort], transportVersion: transport.version, connectionTimeoutMs: timeout, dataRoot: values.get('--data-root'), projectsRoot: values.get('--projects-root'), staticUiRoot: values.get('--ui-root'), instanceId, caseDecisionsEnabled: !values.has('--disable-case-decisions'), experienceLearningEnabled: !values.has('--disable-experience-learning'), sapMethodsEnabled: !values.has('--disable-sap-methods'), ...(effectiveStudioPython ? { studioPython: effectiveStudioPython } : {}), ...(semanticGraph ? { semanticGraph } : {}) });
  if ('ready' in host) await host.ready;
  await new Promise<void>((resolve, reject) => { host.server.once('error', reject); host.server.listen(port, '127.0.0.1', resolve); });
  const address = host.server.address();
  if (!address || typeof address === 'string') throw new Error('Host address unavailable.');
  process.stdout.write(`${JSON.stringify({ kind: 'host-ready', port: address.port, sdkVersion: SDK_VERSION, transportVersion: transport.version })}\n`);
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { if (closing) return; closing = true; const timer = setTimeout(() => process.exit(1), 8000); void host.close().then(() => transport.close()).then(() => { clearTimeout(timer); process.exit(0); }).catch(() => process.exit(1)); });
}
