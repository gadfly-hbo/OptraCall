import { createHash } from 'node:crypto';
import type { SemanticItem, SemanticTarget } from '../../extensions/business-plugins/semantic-context/types.ts';
import { parseSemanticQueryInput } from '../../extensions/business-plugins/semantic-context/reader.ts';
import type { FrameworkSourceReference } from '../../extensions/business-plugins/requirements-elaboration/contract/framework-review.ts';
import type { SemanticContextReadPort } from '../agent/semantic-context.ts';
import { canonical } from './project-data-context-io.ts';
import { SemanticContextFault, type RequirementSourceScope, type SemanticContextService } from './semantic-context-service.ts';

type SourceAuthorization = { approvedTargets?: readonly SemanticTarget[]; signal?: AbortSignal; assertCurrent?: () => void };
type SourceChange = { id: string; status: 'changed' | 'unavailable' };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const readable = (item: SemanticItem) => item.state === 'available' || item.state === 'partial';

function versionOf(target: SemanticTarget): string {
  switch (target.kind) {
    case 'sap':
    case 'sap-method': return String(target.version);
    case 'case-decision': return String(target.revision);
    case 'enterprise': return target.revisionId;
    case 'personal': return target.target.type === 'retained' ? target.target.revisionId : target.target.candidate.entryId;
    case 'data-input': return target.inputVersionId;
    case 'data-description': return target.descriptionRevisionId;
    case 'data-citation':
    case 'data-evidence': return target.citationId;
    case 'case-choice': return target.choiceId;
    case 'source': return '';
  }
}

/** Only original authority reads can produce a proposal citation. A catalog hit is a locator. */
export function createRequirementFrameworkSources(options: {
  semantic: () => Pick<SemanticContextService, 'queryRequirement'>;
  experienceLearningEnabled: boolean;
}) {
  const scopeFor = (authorization: SourceAuthorization): RequirementSourceScope => ({
    caseHistory: options.experienceLearningEnabled,
    approvedTargets: (authorization.approvedTargets ?? []).map(target => structuredClone(target)),
  });

  function begin(authorization: SourceAuthorization = {}) {
    const scope = scopeFor(authorization);
    const supplied = new Map<string, FrameworkSourceReference>();
    const read: SemanticContextReadPort = async (action, input, context) => {
      const assertCurrent = () => { authorization.signal?.throwIfAborted(); context.signal.throwIfAborted(); context.assertCurrent(); authorization.assertCurrent?.(); };
      assertCurrent();
      const query = parseSemanticQueryInput({ ...input, action });
      const result = await options.semantic().queryRequirement(query, scope, { signal: context.signal, assertCurrent });
      assertCurrent();
      const references: FrameworkSourceReference[] = [];
      if (query.action !== 'find') {
        for (const item of [...result.items, ...result.unknownTime]) {
          if (!readable(item) || item.sha256 === null || item.title === null) continue;
          const target = item.target, digest = item.sha256;
          const id = `raf-source-${sha(canonical({ target, digest }))}`;
          const extent = !item.range || item.range.start === item.range.end ? 'metadata' :
            item.range.start === 0 && item.range.end === item.range.total && item.state === 'available' ? 'full' : 'fragment';
          references.push({ id, target, kind: target.kind, title: item.title, version: versionOf(target), digest, extent });
        }
      }
      const text = JSON.stringify({
        ...result, ...(references.length ? { frameworkSourceIds: references.map(({ id, target, extent }) => ({ id, target, extent })) } : {}),
      });
      if (text.length > 32_768 || Buffer.byteLength(JSON.stringify({ text, details: result })) > 256 * 1024)
        throw new SemanticContextFault('semantic_context_payload_limit', 413);
      for (const ref of references) {
        const previous = supplied.get(ref.id);
        if (!previous || previous.extent === 'metadata' || ref.extent === 'full') supplied.set(ref.id, ref);
      }
      return { content: [{ type: 'text', text }], details: result };
    };
    return { read, references: (ids?: readonly string[]) => [...supplied.values()].filter(ref => !ids || ids.includes(ref.id)) };
  }

  async function revalidate(references: readonly FrameworkSourceReference[], authorization: SourceAuthorization = {}): Promise<SourceChange[]> {
    // Proposal records are Host-issued; their exact previously approved reads
    // carry the only project locators available when reopened or sent later.
    const scope = scopeFor({ approvedTargets: authorization.approvedTargets ?? references.map(ref => ref.target) });
    const changes: SourceChange[] = [];
    for (const reference of references) {
      authorization.signal?.throwIfAborted();
      try {
        const result = await options.semantic().queryRequirement({ action: 'read', target: reference.target }, scope, { signal: authorization.signal });
        const item = result.items[0];
        if (item?.state === 'hash-conflict' || item && readable(item) && item.sha256 !== reference.digest) changes.push({ id: reference.id, status: 'changed' });
        else if (!item || !readable(item)) changes.push({ id: reference.id, status: 'unavailable' });
      } catch {
        authorization.signal?.throwIfAborted();
        changes.push({ id: reference.id, status: 'unavailable' });
      }
    }
    return changes;
  }

  return { begin, revalidate };
}
