import path from 'node:path';
import { readSnapshotManifest, readSnapshotFile, snapshotVersion } from '../../extensions/connectors/trade-area-mcp/snapshot.ts';
import type { DataVersion } from '../../extensions/connectors/trade-area-mcp/types.ts';

export type TradeAreaStatus = { available: true; dataVersion: DataVersion } | { available: false; reason: 'data_unavailable' };
/** A version receipt, never district data, credential content or private filesystem paths. */
export function readTradeAreaStatus(dataRoot: string): TradeAreaStatus {
  try {
    const root = path.join(dataRoot, 'connectors/trade-area'), manifest = readSnapshotManifest(root);
    for (const entry of manifest.files) readSnapshotFile(root, manifest, entry.path);
    return { available: true, dataVersion: snapshotVersion(manifest) };
  } catch { return { available: false, reason: 'data_unavailable' }; }
}
