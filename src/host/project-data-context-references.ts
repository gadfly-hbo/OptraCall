import path from 'node:path';
import fs from 'node:fs/promises';
import { createMetricLibrary, MetricLibraryFault } from '../../extensions/business-plugins/metric-factory/library/store.ts';
import { EnterpriseMaterialsError, type EnterpriseMaterialsStore } from './enterprise-materials-store.ts';
import type { ProjectStore } from './project-store.ts';
import { readSavedTaskEntry } from './project-history.ts';
import { ProjectDataContextFault } from './project-data-context-store.ts';
import type { DataContextConceptRef, DataContextSapRef, ValidateDataContextReferences } from './project-data-context-types.ts';
import { concept, sap, list } from './project-data-context-validation.ts';

export type DataContextSourceStatus = 'available' | 'disabled' | 'missing' | 'corrupt' | 'unknown';
export type DataContextSourceStatuses = { concepts: { ref: DataContextConceptRef; status: DataContextSourceStatus }[]; metrics: { ref: DataContextSapRef; status: DataContextSourceStatus }[] };

/** Resolve native authorities; this validates identity and availability, never business truth. */
export function createProjectDataContextReferences(options: { dataRoot: string; projects: ProjectStore; enterpriseMaterials: EnterpriseMaterialsStore }) {
  const library = createMetricLibrary(path.join(options.dataRoot, 'metric-assets'));
  const readConcept = async (ref: DataContextConceptRef) => {
    const metadata = await options.enterpriseMaterials.referenceIndex(), material = metadata.materials.find(value => value.materialId === ref.materialId);
    if (metadata.storeId !== ref.storeId) throw new ProjectDataContextFault('data_context_concept_store_mismatch');
    if (!material) throw new EnterpriseMaterialsError('enterprise_material_not_found', 404);
    const revision = await options.enterpriseMaterials.readRevision(ref.materialId, ref.revisionId);
    if (ref.location) {
      const { start, end } = ref.location;
      const boundary = (index: number) => !(index > 0 && index < revision.body.length && /[\uD800-\uDBFF]/.test(revision.body[index - 1]!) && /[\uDC00-\uDFFF]/.test(revision.body[index]!));
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > revision.body.length || !boundary(start) || !boundary(end)) throw new ProjectDataContextFault('data_context_invalid_concept_range');
    }
    return { storeId: metadata.storeId, enabled: material.enabled, revision };
  };
  const validate: ValidateDataContextReferences = async (projectId, references) => {
    const project = await options.projects.get(projectId);
    for (const ref of references.conceptRefs) {
      try {
        if (!(await readConcept(ref)).enabled) throw new ProjectDataContextFault('data_context_concept_disabled');
      } catch (error) { if (error instanceof ProjectDataContextFault) throw error; throw new ProjectDataContextFault('data_context_concept_unavailable'); }
    }
    for (const ref of references.sapRefs) {
      try {
        const publication = library.read(ref.packageId, ref.version);
        if (!publication.entry.metricNames.includes(ref.metricName) || (ref.publishedHash !== null && ref.publishedHash !== publication.entry.bytesSha256)) throw new ProjectDataContextFault('data_context_sap_mismatch');
      } catch (error) { if (error instanceof ProjectDataContextFault) throw error; throw new ProjectDataContextFault('data_context_sap_unavailable'); }
    }
    for (const evidence of references.nativeEvidence) {
      const task = project.tasks.find(item => item.id === evidence.taskId);
      if (!task) throw new ProjectDataContextFault('data_context_native_evidence_invalid');
      try { await readSavedTaskEntry(project, task, { sessionId: evidence.nativeSessionId, entryId: evidence.entryId }); }
      catch { throw new ProjectDataContextFault('data_context_native_evidence_invalid'); }
    }
    for (const evidence of references.artifactEvidence) {
      if (!/^(020_clean|060_reports)\//.test(evidence.path)) throw new ProjectDataContextFault('data_context_invalid_artifact_evidence');
      const current = await options.projects.observeFile(projectId, evidence.path);
      if (current.sha256 !== evidence.sha256) throw new ProjectDataContextFault('data_context_artifact_evidence_changed');
    }
  };
  return {
    validate,
    async conceptSource(value: unknown) {
      const result = await readConcept(concept(value));
      return { storeId: result.storeId, revision: result.revision };
    },
    /** Explicit, read-only projection of exact authorities. It never changes historical refs. */
    async statuses(input: { conceptRefs: unknown; sapRefs: unknown }): Promise<DataContextSourceStatuses> {
      const concepts: DataContextSourceStatuses['concepts'] = [], metrics: DataContextSourceStatuses['metrics'] = [];
      for (const ref of list(input.conceptRefs, concept)) {
        let status: DataContextSourceStatus;
        try { status = (await readConcept(ref)).enabled ? 'available' : 'disabled'; }
        catch (error) {
          status = error instanceof EnterpriseMaterialsError ? /not_found|source_missing/.test(error.code) ? 'missing' : 'corrupt'
            : error instanceof ProjectDataContextFault ? 'corrupt' : 'unknown';
        }
        concepts.push({ ref, status });
      }
      for (const ref of list(input.sapRefs, sap)) {
        let status: DataContextSourceStatus = 'unknown';
        try {
          const entry = library.list().find(value => value.id === ref.packageId && value.version === ref.version);
          if (!entry || !entry.metricNames.includes(ref.metricName)) status = 'missing';
          else {
            try {
              const publication = library.read(ref.packageId, ref.version);
              status = ref.publishedHash !== null && ref.publishedHash !== publication.entry.bytesSha256 ? 'corrupt' : 'available';
            } catch (error) {
              if (error instanceof MetricLibraryFault) {
                try { await fs.lstat(library.filePath(entry.id, entry.version)); status = 'corrupt'; }
                catch (fileError) { status = (fileError as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unknown'; }
              } else throw error;
            }
          }
        } catch (error) { status = error instanceof MetricLibraryFault ? 'corrupt' : 'unknown'; }
        metrics.push({ ref, status });
      }
      return { concepts, metrics };
    },
    async choices() {
      const metadata = await options.enterpriseMaterials.referenceIndex();
      const concepts: { storeId: string; materialId: string; revisionId: string; title: string }[] = [];
      for (const material of metadata.materials.filter(value => value.enabled)) {
        for (const revision of material.revisions) concepts.push({ storeId: metadata.storeId, materialId: material.materialId, revisionId: revision.revisionId, title: `${revision.title} · 修订${revision.number}` });
      }
      const metrics = library.list().flatMap(item => item.metricNames.map(metricName => ({ packageId: item.id, version: item.version, metricName, publishedHash: item.bytesSha256 })));
      return { concepts, metrics };
    },
  };
}
