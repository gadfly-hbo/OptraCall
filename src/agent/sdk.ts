// The product has one official SDK import surface. Sessions may run in separate
// OS environments; their reasoning loop and persistence remain Pi's implementation.
export * from '@earendil-works/pi-coding-agent';

import { VERSION, type LoadedMcpConfig } from '@earendil-works/pi-coding-agent';
import { loadMcpConfig } from '../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/config.js';

/** IN06: SDK 1.4.0 exposes the config type but not its loader; reuse that exact parser.
 * This is a pinned thin import, not a second MCP config parser or Runtime. See trade-area spec. */
export async function getSdkMcpConfigLoader(): Promise<(options: { agentDir: string; cwd: string; projectTrusted: boolean }) => LoadedMcpConfig> {
  if (VERSION !== '1.4.0') throw new Error('mcp_config_sdk_version_unsupported');
  if (typeof loadMcpConfig !== 'function') throw new Error('mcp_config_sdk_loader_unavailable');
  return loadMcpConfig;
}
