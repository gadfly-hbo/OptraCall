// The product has one official SDK import surface. Sessions may run in separate
// OS environments; their reasoning loop and persistence remain Pi's implementation.
export * from '@earendil-works/pi-coding-agent';

import { VERSION, type LoadedMcpConfig } from '@earendil-works/pi-coding-agent';

/** IN06: Codex owns this read-only exception for the exact 1.4.0 installation layout.
 * The public SDK exposes the config type but not its loader; reuse that parser until
 * a user-selected SDK version exposes it publicly. See the Pi adaptation repair spec. */
export async function getSdkMcpConfigLoader(): Promise<(options: { agentDir: string; cwd: string; projectTrusted: boolean }) => LoadedMcpConfig> {
  if (VERSION !== '1.4.0') throw new Error('mcp_config_sdk_version_unsupported');
  let config: typeof import('../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/config.js');
  try {
    config = await import('../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/config.js');
  } catch {
    throw new Error('mcp_config_sdk_loader_unavailable');
  }
  if (typeof config.loadMcpConfig !== 'function') throw new Error('mcp_config_sdk_loader_unavailable');
  return config.loadMcpConfig;
}
