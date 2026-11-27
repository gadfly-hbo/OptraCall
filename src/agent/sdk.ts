// The product has one official SDK import surface. Sessions may run in separate
// OS environments; their reasoning loop and persistence remain Pi's implementation.
export * from '@earendil-works/pi-coding-agent';
// The same pinned official Pi package's public standalone MCP client lets the
// Host verify/connect an account without creating an extra analysis session.
export { McpClient, StreamableHttpTransport } from '@earendil-works/pi-mcp';
export type { McpTransport, AuthProvider, Tool as PiMcpTool, CallToolResult as PiMcpCallToolResult, McpClientOptions, StreamableHttpTransportOptions } from '@earendil-works/pi-mcp';
export { McpOAuthProvider as PiMcpOAuthProvider, OAuthCallbackServer as PiOAuthCallbackServer, authorizeMcp as authorizePiMcp, OAuthIssuerMismatchError as PiOAuthIssuerMismatchError, OAuthError as PiOAuthError } from '@earendil-works/pi-mcp/oauth';
export type { McpOAuthState as PiMcpOAuthState, McpOAuthStateStore as PiMcpOAuthStateStore, AuthorizationServerMetadata as PiAuthorizationServerMetadata } from '@earendil-works/pi-mcp/oauth';

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
