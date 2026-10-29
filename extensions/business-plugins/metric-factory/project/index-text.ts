import path from 'node:path';
import { createMetricLibrary, MetricLibraryFault, type LibraryEntry } from '../library/store.ts';
import { createProjectEnablement, EnablementFault, type EnablementRecord } from './enablement.ts';
import { parseSapDraft, type SapDocument } from '../sap/validate.ts';

export type MetricIndexInput = { dataRoot: string; projectId: string };
export type MetricIndexSources = { enabled: readonly EnablementRecord[]; read: (id: string, version: string) => { entry: LibraryEntry; document: SapDocument; file: string } | undefined };

/** Soft guidance only: an index line per enabled package, never the full definitions. */
export function renderMetricIndexText(sources: MetricIndexSources): string | undefined {
  if (!sources.enabled.length) return undefined;
  const lines = ['本项目已启用指标资产；引用口径时注明指标名与版本：'];
  for (const record of sources.enabled) {
    const loaded = sources.read(record.packageId, record.version);
    if (!loaded) {
      lines.push(`- ${record.packageId}@${record.version}：库中暂不可读，引用前请先核对指标资产页。`);
      continue;
    }
    lines.push(`- ${loaded.entry.id}@${loaded.entry.version}：${loaded.document.metrics.map(metric => `${metric.name} ${metric.display_name}`).join(' · ')}`);
    if (loaded.document.scenarios.length) lines.push(`  场景：${loaded.document.scenarios.map(scenario => `${scenario.id} ${scenario.title}`).join(' · ')}`);
    lines.push(`  完整定义：${loaded.file}`);
  }
  lines.push('按需用 read/grep 读取完整定义；分析结论引用口径时注明所用指标与版本。');
  return lines.join('\n');
}

/** Corrupted enablement or library degrades to no index; session startup must never fail here. */
export function metricIndexText(input: MetricIndexInput): string | undefined {
  try {
    const enabled = createProjectEnablement(path.join(input.dataRoot, 'projects', input.projectId)).list();
    if (!enabled.length) return undefined;
    const libraryRoot = path.join(input.dataRoot, 'metric-assets');
    const library = createMetricLibrary(libraryRoot);
    return renderMetricIndexText({
      enabled,
      read: (id, version) => {
        try {
          const { entry, canonicalYaml } = library.read(id, version);
          return { entry, document: parseSapDraft(new Uint8Array(Buffer.from(canonicalYaml, 'utf8'))), file: library.filePath(id, version) };
        } catch (error) {
          if (error instanceof MetricLibraryFault) return undefined;
          throw error;
        }
      },
    });
  } catch (error) {
    if (error instanceof EnablementFault || error instanceof MetricLibraryFault) return undefined;
    throw error;
  }
}
