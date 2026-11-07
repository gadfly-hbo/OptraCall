"""Build immutable v2 read models from exact, eligible formal Studio sources.

Structured projection is explicit in a source JSON body. Text alone remains a
source-qualified statement; it is never silently extracted or promoted to fact.
"""
import contextlib
import copy
import hashlib
import importlib.metadata
import io
import json
import os
import uuid
from pathlib import Path

from .identity import canonical, claim_id, edge_id, ref_identity, stable_id
from .readmodel import SnapshotStore, SnapshotError
from .studio_extract import read_message, send
from .worker import HostAuthorityProxy


def metadata(ref, input_key, **extra):
    return {'sourceRefs': [copy.deepcopy(ref)], 'buildSources': [{'inputKey': input_key, 'locator': '/body'}],
            'claimKind': 'source-projection', 'conditions': [], 'limitations': ['source-qualified-projection-not-business-proof'],
            'businessTime': [], **extra}


def build(command, authority):
    if not isinstance(command, dict) or set(command) - {'type', 'runRoot', 'sources', 'snapshotId'} or command['type'] != 'build':
        raise SnapshotError('invalid_build_request')
    sources = command['sources']
    if not isinstance(sources, list) or not 0 < len(sources) <= 256:
        raise SnapshotError('invalid_build_sources')
    run = Path(command['runRoot']).absolute()
    if run != run.resolve() or any(path.is_symlink() for path in [run, *run.parents]) or not run.is_dir():
        raise SnapshotError('unsafe_build_root')
    if importlib.metadata.version('semantica') != '0.7.0':
        raise SnapshotError('unsupported_component_version')
    store = SnapshotStore(run, authority)
    inputs_root = run / 'inputs'
    inputs_root.mkdir(mode=0o700, exist_ok=True)
    store._directory(inputs_root)
    refs, inputs, nodes, edges = [], [], [], []
    source_keys = set()
    for source in sources:
        if (not isinstance(source, dict) or set(source) != {'ref', 'title', 'body', 'kind'}
                or not all(isinstance(source.get(key), str) and source[key] for key in ('title', 'body', 'kind'))
                or len(source['body'].encode('utf-8')) > 256 * 1024):
            raise SnapshotError('invalid_build_source')
        ref = source['ref']
        if not isinstance(ref, dict) or ref.get('kind') not in {'studio-source', 'sap', 'sap-method', 'enterprise', 'data-input', 'data-description'} or (ref.get('kind') in {'studio-source', 'sap', 'sap-method'} and not ref.get('publishedHash')):
            raise SnapshotError('invalid_studio_source')
        key = canonical(ref_identity(ref))
        if key in source_keys:
            raise SnapshotError('duplicate_build_source')
        source_keys.add(key); refs.append(ref)
    checks = authority.check_many(refs)
    if len(checks) != len(refs) or any(check['state'] != 'available' for check in checks):
        raise SnapshotError('source_not_eligible_for_build')
    for source in sources:
        ref = source['ref']
        raw = (json.dumps(source, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8')
        digest = hashlib.sha256(raw).hexdigest()
        input_key = 'studio-' + digest
        relative = 'inputs/' + input_key + '.json'
        path = run / relative
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        except FileExistsError:
            if store._read(path) != raw:
                raise SnapshotError('build_input_conflict')
        else:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(raw)
        inputs.append({'inputKey': input_key, 'relativePath': relative, 'sha256': digest, 'bytes': len(raw), 'nature': 'asset-publication'})
        source_node_id = stable_id('SourceRevision', ref_identity(ref))
        source_meta = metadata(ref, input_key, assetKind=source['kind'], actualMethod='structured-source')
        nodes.append({'id': source_node_id, 'type': 'SourceRevision', 'content': source['title'] + '\n' + source['body'], 'metadata': source_meta})
        try:
            projection = json.loads(source['body'])
        except ValueError:
            projection = None
        if isinstance(projection, dict) and ('entities' in projection or 'relationships' in projection):
            entities = projection.get('entities', [])
            relationships = projection.get('relationships', [])
            if not isinstance(entities, list) or not isinstance(relationships, list) or not entities:
                raise SnapshotError('invalid_source_projection')
        else:
            entities, relationships = [{'key': 'source-statement', 'text': source['body'], 'label': source['kind']}], []
        local = {}
        for entity in entities:
            if (not isinstance(entity, dict) or set(entity) - {'key', 'text', 'label'}
                    or not all(isinstance(entity.get(k), str) and entity[k] for k in ('key', 'text', 'label'))
                    or entity['key'] in local):
                raise SnapshotError('invalid_source_entity')
            meta = metadata(ref, input_key, assetKind=entity['label'], actualMethod='structured-source')
            node_id = claim_id('Statement', [ref], meta['buildSources'], inputs, meta['claimKind'], entity['text'])
            # Distinct declared entities must not silently collapse identities.
            if node_id in {node['id'] for node in nodes}:
                raise SnapshotError('duplicate_source_entity')
            nodes.append({'id': node_id, 'type': 'Statement', 'content': entity['text'], 'metadata': meta})
            local[entity['key']] = node_id
            edge_meta = metadata(ref, input_key)
            edges.append({'id': edge_id(node_id, source_node_id, 'has_source', edge_meta, inputs), 'source': node_id, 'target': source_node_id, 'type': 'has_source', 'metadata': edge_meta})
        for relation in relationships:
            if (not isinstance(relation, dict) or set(relation) - {'source', 'target', 'predicate', 'weak'}
                    or not all(isinstance(relation.get(k), str) and relation[k] for k in ('source', 'target', 'predicate'))
                    or relation['source'] not in local or relation['target'] not in local
                    or ('weak' in relation and type(relation['weak']) is not bool)):
                raise SnapshotError('invalid_source_relation')
            weak = bool(relation.get('weak')) or relation['predicate'].lower() in {'related_to', 'co_occurs', 'cooccurs'}
            meta = metadata(ref, input_key, predicate=relation['predicate'], weak=weak, actualMethod='structured-source')
            if weak:
                meta['limitations'].append('weak-relation-clue-only')
            source_id, target_id = local[relation['source']], local[relation['target']]
            edges.append({'id': edge_id(source_id, target_id, 'asserted_relation', meta, inputs), 'source': source_id, 'target': target_id, 'type': 'asserted_relation', 'metadata': meta})
    from semantica.kg.graph_builder import GraphBuilder
    from semantica.ontology.engine import OntologyEngine
    graph = GraphBuilder(merge_entities=False, resolve_conflicts=False).build(
        {'entities': copy.deepcopy(nodes), 'relationships': copy.deepcopy(edges)}, extract=False,
        extract_relations=False, extract_triplets=False)
    if ({item.get('id') for item in graph['entities']} != {item['id'] for item in nodes}
            or len(graph['relationships']) != len(edges)):
        raise SnapshotError('official_graph_build_incomplete')
    ontology = OntologyEngine(base_uri='https://example.invalid/optracall/studio/', min_occurrences=1).from_data(
        {'entities': copy.deepcopy(nodes), 'relationships': copy.deepcopy(edges)}, name='StudioFormalSourceOntology',
        min_occurrences=1, build_hierarchy=False)
    snapshot_id = store.write(nodes, edges, ontology, inputs, snapshot_id=command.get('snapshotId'), format_version=2)
    if any(check['state'] != 'available' for check in authority.check_many(refs)):
        raise SnapshotError('source_changed_during_build')
    return {'formatVersion': 2, 'snapshotId': snapshot_id, 'sourceRefs': refs,
            'counts': {'nodes': len(nodes), 'edges': len(edges)}, 'component': {'name': 'semantica', 'version': '0.7.0'}}


def main():
    import sys
    incoming, outgoing = sys.stdin, sys.stdout
    try:
        command = read_message(incoming)
        authority = HostAuthorityProxy(incoming, outgoing)
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = build(command, authority)
        send(outgoing, {'type': 'result', 'result': result})
        incoming.readline(2 * 1024 * 1024 + 1)
        return 0
    except Exception:
        send(outgoing, {'type': 'error', 'code': 'build_failed'})
        return 1


if __name__ == '__main__':
    import sys
    sys.exit(main())
