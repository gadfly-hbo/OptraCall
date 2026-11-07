"""Immutable native Semantica snapshots for isolated S3 engineering.

Original Stores retain authority. No Runtime, product tool, latest pointer or
business inference is introduced here.
"""
import copy
import hashlib
import json
import os
import stat
import uuid
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path, PurePosixPath

from .identity import claim_id, edge_id, ref_identity, stable_id

COMPONENT = {'name': 'semantica', 'version': '0.7.0',
             'wheelSha256': 'faf27d6259ae813ddb44c5213e2f8867592f27e6e3d6b47cea10f1844513799f'}
NODE_TYPES = {'MetricConcept', 'MetricVersion', 'MethodVersion', 'SourceRevision', 'Statement', 'Condition', 'InputVersion', 'FieldRole'}
STUDIO_EDGE_TYPES = {'asserted_relation'}
EDGE_TYPES = {'version_of', 'depends_on', 'has_source', 'requires', 'maps_to', 'describes_input', 'distinct_from', 'potential_conflict'}
METRICS = {'terminal_sales_amount', 'retail_refund_amount', 'net_retail_sales'}
NATURES = {'deidentified-source', 'synthetic-data', 'asset-publication', 'engineering-design'}
RESERVED = {'id', 'type', 'content', 'valid_from', 'valid_until', 'properties', 'metadata', 'source', 'target', 'source_id', 'target_id', 'familyId', 'family_id', 'weight'}


class SnapshotError(ValueError):
    """A stable error code containing no source body or locator."""
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def _require(condition, code):
    if not condition:
        raise SnapshotError(code)


def _boundary(operation):
    @wraps(operation)
    def guarded(*args, **kwargs):
        try:
            return operation(*args, **kwargs)
        except SnapshotError:
            raise
        except (OSError, ValueError, TypeError, KeyError, IndexError, OverflowError):
            raise SnapshotError('invalid_snapshot') from None
    return guarded


def _string(value):
    return isinstance(value, str) and bool(value)


def _hash(value):
    return isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdef' for c in value)


def _uuid(value):
    _require(isinstance(value, str) and str(uuid.UUID(value)) == value, 'invalid_snapshot_id')
    return value


def _json(data):
    def pairs(values):
        result = {}
        for key, value in values:
            _require(key not in result, 'duplicate_json_key')
            result[key] = value
        return result
    def invalid_constant(_):
        raise SnapshotError('invalid_json')
    return json.loads(data.decode('utf-8'), object_pairs_hook=pairs, parse_constant=invalid_constant)


def _new_graph():
    from semantica.context.context_graph import ContextGraph
    return ContextGraph(advanced_analytics=False, node_embeddings=False,
                        extract_entities=False, extract_relationships=False)


def _checks(authority, refs):
    if not refs:
        return []
    try:
        result = (authority.check_many(copy.deepcopy(refs)) if hasattr(authority, 'check_many')
                  else [authority.check(copy.deepcopy(ref)) for ref in refs])
        _require(isinstance(result, list) and len(result) == len(refs), 'invalid_authority_result')
        _require(all(isinstance(i, dict) and _string(i.get('state')) for i in result), 'invalid_authority_result')
        return result
    except SnapshotError:
        raise
    except Exception:
        raise SnapshotError('authority_unavailable') from None


def _all_refs(nodes, edges):
    return [ref for item in [*nodes, *edges] for ref in item['metadata']['sourceRefs']]


def _check_hash_assertions(refs):
    known = {}
    for ref in refs:
        key, value = ref_identity(ref), ref.get('publishedHash')
        if value is not None:
            _require(key not in known or known[key] == value, 'source_hash_conflict')
            known[key] = value


class SnapshotView:
    """Fixed graph identity, with current authority checked for every read."""
    def __init__(self, graph, authority, nodes, edges, input_check):
        self._graph, self._authority = graph, authority
        self._nodes, self._edges = nodes, edges
        self._input_check = input_check

    @_boundary
    def query(self, node_ids=None):
        self._input_check()
        if node_ids is not None:
            _require(isinstance(node_ids, (list, tuple, set)) and all(_string(k) for k in node_ids), 'invalid_query_ids')
        requested = set(node_ids) if node_ids is not None else None
        candidates = [n for n in self._nodes if requested is None or n['id'] in requested]
        selected = {n['id'] for n in candidates}
        edges = [e for e in self._edges if e['source'] in selected and e['target'] in selected]
        try:
            results = iter(_checks(self._authority, _all_refs(candidates, edges)))
            allowed, has_gap = {}, False
            for item in [*candidates, *edges]:
                checks = [next(results) for _ in item['metadata']['sourceRefs']]
                allowed[item['id']] = all(i['state'] == 'available' for i in checks)
                has_gap |= any(bool(i.get('gaps')) for i in checks if i['state'] == 'available')
        except SnapshotError:
            return {'state': 'partial', 'nodes': [], 'edges': [], 'gaps': ['authority-unavailable']}
        visible = [n for n in candidates if allowed[n['id']]]
        visible_ids = {n['id'] for n in visible}
        visible_edges = [e for e in edges if allowed[e['id']] and e['source'] in visible_ids and e['target'] in visible_ids]
        excluded = len(visible) != len(candidates) or len(visible_edges) != len(edges)
        missing = requested is not None and not requested <= selected
        gaps = (['source-ineligible-results-excluded'] if excluded else [])
        gaps += ['requested-nodes-unavailable'] if missing else []
        gaps += ['source-validation-gap'] if has_gap else []
        return {'state': 'partial' if excluded or missing else 'available',
                'nodes': copy.deepcopy(visible), 'edges': copy.deepcopy(visible_edges), 'gaps': gaps}


class SnapshotStore:
    @_boundary
    def __init__(self, run_root, authority):
        supplied = Path(run_root).absolute()
        _require(not supplied.is_symlink(), 'unsafe_run_root')
        self.run_root = supplied.resolve()
        _require(self.run_root.is_dir(), 'missing_run_root')
        self.authority = authority

    def _directory(self, path):
        relative = path.relative_to(self.run_root)
        current = self.run_root
        _require(stat.S_ISDIR(current.lstat().st_mode) and not current.is_symlink(), 'unsafe_run_root')
        for part in relative.parts:
            _require(part not in ('', '.', '..'), 'unsafe_path')
            current /= part
            mode = current.lstat().st_mode
            _require(stat.S_ISDIR(mode) and not stat.S_ISLNK(mode), 'unsafe_directory')

    def _read(self, path):
        self._directory(path.parent)
        before = path.lstat()
        _require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, 'unsafe_file')
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as stream:
            actual = os.fstat(stream.fileno())
            _require(stat.S_ISREG(actual.st_mode) and actual.st_nlink == 1 and
                     (actual.st_dev, actual.st_ino) == (before.st_dev, before.st_ino), 'unsafe_file')
            return stream.read()

    def _inputs(self, inputs):
        _require(isinstance(inputs, list) and inputs, 'invalid_inputs')
        keys, paths, documents = set(), set(), {}
        for item in inputs:
            _require(isinstance(item, dict) and set(item) == {'inputKey', 'relativePath', 'sha256', 'bytes', 'nature'}, 'invalid_input_record')
            key, relative = item['inputKey'], item['relativePath']
            _require(_string(key) and key not in keys, 'duplicate_input_key')
            _require(_string(relative) and '\\' not in relative, 'unsafe_input_path')
            parts = PurePosixPath(relative).parts
            _require(len(parts) >= 2 and parts[0] == 'inputs' and all(p not in ('.', '..', '') for p in parts)
                     and str(PurePosixPath(relative)) == relative and relative not in paths, 'unsafe_input_path')
            _require(_hash(item['sha256']) and type(item['bytes']) is int and item['bytes'] >= 0 and item['nature'] in NATURES, 'invalid_input_record')
            data = self._read(self.run_root / relative)
            _require(len(data) == item['bytes'] and hashlib.sha256(data).hexdigest() == item['sha256'], 'input_integrity_mismatch')
            keys.add(key); paths.add(relative)
            documents[key] = (_json(data) if relative.endswith('.json') else data.decode('utf-8'), relative)
        return documents

    def _metadata(self, item, documents):
        meta = item.get('metadata')
        required = {'sourceRefs', 'buildSources', 'claimKind', 'conditions', 'limitations', 'businessTime'}
        _require(isinstance(meta, dict) and required <= set(meta) and not RESERVED.intersection(meta), 'invalid_metadata')
        _require(isinstance(meta['sourceRefs'], list) and isinstance(meta['buildSources'], list)
                 and (meta['sourceRefs'] or meta['buildSources']), 'missing_provenance')
        for ref in meta['sourceRefs']:
            ref_identity(ref)
        _require(meta['claimKind'] in {'source-projection', 'engineering-interpretation', 'synthetic-assumption'}, 'invalid_claim_kind')
        for key in ('conditions', 'limitations'):
            _require(isinstance(meta[key], list) and all(_string(v) for v in meta[key]), 'invalid_metadata')
        _require(isinstance(meta['businessTime'], list), 'invalid_business_time')
        for time in meta['businessTime']:
            _require(isinstance(time, dict) and set(time) == {'text', 'source'} and all(_string(v) for v in time.values()), 'invalid_business_time')
        if 'candidateLocator' in meta:
            _require(_string(meta['candidateLocator']), 'invalid_candidate_locator')
        if item['type'] == 'Condition':
            _require(meta.get('conditionState') in {'stated', 'required-not-established', 'unknown', 'disputed'}, 'invalid_condition_state')
        else:
            _require('conditionState' not in meta, 'invalid_condition_state')
        for source in meta['buildSources']:
            _require(isinstance(source, dict) and set(source) == {'inputKey', 'locator'}
                     and source.get('inputKey') in documents and _string(source.get('locator')), 'invalid_build_source')
            doc, relative = documents[source['inputKey']]
            locator = source['locator']
            if relative.endswith('.json'):
                _require(locator.startswith('/'), 'invalid_json_pointer')
                for component in locator[1:].split('/'):
                    _require(not any(component[i:i+2] not in ('~0', '~1') for i, c in enumerate(component) if c == '~'), 'invalid_json_pointer')
                    component = component.replace('~1', '/').replace('~0', '~')
                    if isinstance(doc, list):
                        _require(component.isdigit() and (component == '0' or not component.startswith('0')), 'invalid_json_pointer')
                        doc = doc[int(component)]
                    else:
                        doc = doc[component]
            elif relative.endswith('.md'):
                headings = {line.lstrip('#').strip() for line in doc.splitlines() if line.startswith('#')}
                _require(locator.lstrip('#').strip() in headings, 'unresolved_build_locator')
            else:
                raise SnapshotError('unsupported_build_source_format')

    def _structure(self, nodes, edges, inputs, documents, format_version=1):
        if format_version == 2:
            return self._studio_structure(nodes, edges, inputs, documents)
        _require(format_version == 1, 'unsupported_format')
        return self._structure_v1(nodes, edges, inputs, documents)

    def _studio_structure(self, nodes, edges, inputs, documents):
        """Formal Studio sources projected without the historical SC-01 fixture quota."""
        _require(isinstance(nodes, list) and nodes and len(nodes) <= 4096
                 and isinstance(edges, list) and len(edges) <= 8192, 'invalid_graph_structure')
        by_id = {}
        for node in nodes:
            _require(isinstance(node, dict) and set(node) == {'id', 'type', 'content', 'metadata'}
                     and node.get('type') in NODE_TYPES and _string(node.get('content'))
                     and _string(node.get('id')) and node['id'] not in by_id, 'invalid_node')
            self._metadata(node, documents)
            meta = node['metadata']
            _require(meta['sourceRefs'] and all(ref.get('kind') in {'studio-source', 'sap', 'sap-method', 'enterprise', 'data-input', 'data-description'} and (ref.get('kind') not in {'studio-source', 'sap', 'sap-method'} or _hash(ref.get('publishedHash'))) for ref in meta['sourceRefs']), 'invalid_studio_source')
            if node['type'] == 'SourceRevision':
                _require(len(meta['sourceRefs']) == 1, 'missing_exact_node_identity')
                expected = stable_id('SourceRevision', ref_identity(meta['sourceRefs'][0]))
            else:
                expected = claim_id(node['type'], meta['sourceRefs'], meta['buildSources'], inputs, meta['claimKind'], node['content'])
            _require(node['id'] == expected, 'node_identity_mismatch')
            by_id[node['id']] = node
        seen = set()
        for edge in edges:
            _require(isinstance(edge, dict) and set(edge) == {'id', 'source', 'target', 'type', 'metadata'}
                     and all(_string(edge.get(k)) for k in ('id', 'source', 'target', 'type'))
                     and edge['type'] in EDGE_TYPES | STUDIO_EDGE_TYPES and edge['id'] not in seen
                     and edge['source'] in by_id and edge['target'] in by_id, 'invalid_edge')
            self._metadata(edge, documents)
            meta = edge['metadata']
            _require(meta['sourceRefs'] and all(ref.get('kind') in {'studio-source', 'sap', 'sap-method', 'enterprise', 'data-input', 'data-description'} and (ref.get('kind') not in {'studio-source', 'sap', 'sap-method'} or _hash(ref.get('publishedHash'))) for ref in meta['sourceRefs']), 'invalid_studio_source')
            if edge['type'] == 'asserted_relation':
                _require(_string(meta.get('predicate')) and len(meta['predicate']) <= 256
                         and by_id[edge['source']]['type'] == by_id[edge['target']]['type'] == 'Statement', 'invalid_asserted_relation')
            if edge['type'] == 'has_source':
                _require(by_id[edge['target']]['type'] == 'SourceRevision', 'invalid_edge_direction')
            if edge['type'] == 'maps_to':
                _require(_string(meta.get('roleText')), 'missing_field_role')
            _require(edge['id'] == edge_id(edge['source'], edge['target'], edge['type'], meta, inputs), 'edge_identity_mismatch')
            seen.add(edge['id'])
        refs = _all_refs(nodes, edges)
        _check_hash_assertions(refs)
        return refs

    def _structure_v1(self, nodes, edges, inputs, documents):
        _require(isinstance(nodes, list) and isinstance(edges, list), 'invalid_graph_structure')
        _require(all(ref.get('kind') != 'studio-source' for ref in _all_refs(nodes, edges)), 'unsupported_source_ref')
        by_id = {}
        identity_kinds = {'MetricVersion': {'sap'}, 'MethodVersion': {'sap-method'},
                          'SourceRevision': {'enterprise', 'data-description'}, 'InputVersion': {'data-input'}, 'MetricConcept': {'sap'}}
        for node in nodes:
            _require(isinstance(node, dict) and set(node) == {'id', 'type', 'content', 'metadata'}
                     and _string(node['id']) and node['type'] in NODE_TYPES and _string(node['content']), 'invalid_node')
            _require(node['id'] not in by_id, 'duplicate_node')
            self._metadata(node, documents)
            meta, kind = node['metadata'], node['type']
            refs = meta['sourceRefs']
            matching = [r for r in refs if r['kind'] in identity_kinds.get(kind, set())]
            if kind in {'MetricVersion', 'MethodVersion', 'SourceRevision', 'InputVersion'}:
                # Other necessary references are provenance, not competing node
                # identities. Select the own exact Ref by its declared key and
                # retain every other Ref for hash checks and current admission.
                owned = {ref_identity(r) for r in matching if stable_id(kind, ref_identity(r)) == node['id']}
                _require(len(owned) == 1, 'missing_exact_node_identity')
                expected = stable_id(kind, next(iter(owned)))
            elif kind == 'MetricConcept' and matching:
                owned = {(r['packageId'], r['metricName']) for r in matching
                         if stable_id(kind, ['metric-concept', r['packageId'], r['metricName']]) == node['id']}
                _require(len(owned) == 1, 'ambiguous_concept_identity')
                package, metric = next(iter(owned))
                expected = stable_id(kind, ['metric-concept', package, metric])
            else:
                expected = claim_id(kind, refs, meta['buildSources'], inputs, meta['claimKind'], node['content'])
            _require(expected == node['id'], 'node_identity_mismatch')
            by_id[node['id']] = node
        compatible = {
            'version_of': ({'MetricVersion'}, {'MetricConcept'}),
            'depends_on': ({'MetricVersion', 'MethodVersion'}, {'MetricVersion'}),
            'has_source': ({'MetricVersion', 'MethodVersion', 'Statement', 'FieldRole'}, {'SourceRevision'}),
            'requires': ({'MetricVersion', 'MethodVersion'}, {'Condition'}),
            'maps_to': ({'FieldRole'}, {'MetricVersion'}),
            'describes_input': ({'FieldRole', 'Statement'}, {'InputVersion'}),
            'distinct_from': ({'Statement', 'MetricConcept'}, {'Statement', 'MetricConcept'}),
            'potential_conflict': ({'Statement', 'MetricConcept'}, {'Statement', 'MetricConcept'}),
        }
        seen = set()
        for edge in edges:
            _require(isinstance(edge, dict) and set(edge) == {'id', 'source', 'target', 'type', 'metadata'}
                     and all(_string(edge[k]) for k in ('id', 'source', 'target', 'type')) and edge['type'] in EDGE_TYPES, 'invalid_edge')
            _require(edge['id'] not in seen, 'duplicate_edge')
            _require(edge['source'] in by_id and edge['target'] in by_id, 'missing_edge_endpoint')
            self._metadata(edge, documents)
            source_types, target_types = compatible[edge['type']]
            _require(by_id[edge['source']]['type'] in source_types and by_id[edge['target']]['type'] in target_types, 'invalid_edge_direction')
            if edge['type'] == 'maps_to':
                _require(_string(edge['metadata'].get('roleText')), 'missing_field_role')
            _require(edge['id'] == edge_id(edge['source'], edge['target'], edge['type'], edge['metadata'], inputs), 'edge_identity_mismatch')
            seen.add(edge['id'])
        refs = _all_refs(nodes, edges)
        _check_hash_assertions(refs)
        core, core_refs = {}, {}
        for node in nodes:
            if node['type'] == 'MetricVersion':
                ref = next(r for r in node['metadata']['sourceRefs'] if r['kind'] == 'sap'
                           and stable_id('MetricVersion', ref_identity(r)) == node['id'])
                if ref['metricName'] in METRICS:
                    _require(ref['metricName'] not in core, 'duplicate_core_metric')
                    core[ref['metricName']] = node['id']
                    core_refs[ref['metricName']] = ref
        _require(set(core) == METRICS and sum(n['type'] == 'MetricVersion' for n in nodes) == 3
                 and sum(n['type'] == 'MethodVersion' for n in nodes) == 1, 'missing_core_assets')
        _require(len({(ref['packageId'], ref['version']) for ref in core_refs.values()}) == 1, 'inconsistent_core_publication')
        for name, node_id in core.items():
            targets = {e['target'] for e in edges if e['type'] == 'version_of' and e['source'] == node_id}
            _require(targets == {stable_id('MetricConcept', ['metric-concept', core_refs[name]['packageId'], name])}, 'missing_version_concept')
        net = core['net_retail_sales']
        for name, role in (('terminal_sales_amount', 'minuend'), ('retail_refund_amount', 'subtrahend')):
            _require(any(e['type'] == 'depends_on' and e['source'] == net and e['target'] == core[name]
                         and e['metadata'].get('operandRole') == role for e in edges), 'missing_core_operand')
        method_id = next(n['id'] for n in nodes if n['type'] == 'MethodVersion')
        method_targets = {e['target'] for e in edges if e['source'] == method_id and e['type'] == 'depends_on'}
        _require(set(core.values()) <= method_targets, 'missing_method_dependency')
        for edge in edges:
            if 'operandRole' in edge['metadata']:
                _require(edge['type'] == 'depends_on' and edge['source'] == net
                         and (edge['target'], edge['metadata']['operandRole']) in {
                             (core['terminal_sales_amount'], 'minuend'), (core['retail_refund_amount'], 'subtrahend')}, 'invalid_operand_role')
        return refs

    def _ontology(self, ontology, nodes):
        _require(isinstance(ontology, dict) and isinstance(ontology.get('classes'), list)
                 and ontology['classes'] and isinstance(ontology.get('properties'), list), 'invalid_ontology')
        def normalized(value):
            return ''.join(c.lower() for c in str(value) if c.isalnum())
        classes = {normalized(i.get('name')) for i in ontology['classes'] if isinstance(i, dict)}
        _require({normalized(n['type']) for n in nodes} <= classes, 'missing_ontology_class')

    def _native_logical(self, raw, snapshot_id):
        _require(isinstance(raw, dict) and set(raw) == {'graph_id', 'nodes', 'edges', 'links'}
                 and raw['graph_id'] == snapshot_id and raw['links'] == []
                 and isinstance(raw['nodes'], list) and isinstance(raw['edges'], list), 'invalid_native_graph')
        nodes, edges = [], []
        for node in raw['nodes']:
            _require(isinstance(node, dict) and set(node) == {'id', 'type', 'properties'}
                     and isinstance(node['properties'], dict) and 'content' in node['properties'], 'invalid_native_node')
            meta = copy.deepcopy(node['properties'])
            content = meta.pop('content')
            nodes.append({'id': node['id'], 'type': node['type'], 'content': content, 'metadata': meta})
        for edge in raw['edges']:
            _require(isinstance(edge, dict) and set(edge) == {'id', 'familyId', 'source_id', 'target_id', 'type', 'weight', 'properties'}
                     and isinstance(edge['properties'], dict) and type(edge['weight']) in (int, float)
                     and edge['weight'] == 1 and edge['familyId'] == edge['id'], 'invalid_native_edge')
            edges.append({'id': edge['id'], 'source': edge['source_id'], 'target': edge['target_id'],
                          'type': edge['type'], 'metadata': copy.deepcopy(edge['properties'])})
        return nodes, edges

    @_boundary
    def write(self, entities, relationships, ontology, inputs, snapshot_id=None, *, format_version=1):
        _require(type(format_version) is int and format_version in (1, 2), 'unsupported_format')
        snapshot_id = _uuid(str(uuid.uuid4()) if snapshot_id is None else snapshot_id)
        nodes, edges, ontology, inputs = copy.deepcopy((entities, relationships, ontology, inputs))
        documents = self._inputs(inputs)
        refs = self._structure(nodes, edges, inputs, documents, format_version)
        self._ontology(ontology, nodes)
        _require(all(i['state'] == 'available' for i in _checks(self.authority, refs)), 'source_not_eligible_for_build')
        snapshots = self.run_root / 'snapshots'
        if not snapshots.exists():
            snapshots.mkdir()
        self._directory(snapshots)
        root = snapshots / snapshot_id
        _require(not root.exists() and not root.is_symlink(), 'snapshot_already_exists')
        root.mkdir(exist_ok=False)
        graph = _new_graph()
        graph.graph_id = snapshot_id
        _require(graph.add_nodes(nodes) == len(nodes) and graph.add_edges(edges) == len(edges), 'native_build_incomplete')
        graph.save_to_file(root / 'graph.json')
        with (root / 'ontology.json').open('x', encoding='utf-8') as stream:
            stream.write(json.dumps(ontology, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
        graph_bytes, ontology_bytes = self._read(root / 'graph.json'), self._read(root / 'ontology.json')
        read_nodes, read_edges = self._native_logical(_json(graph_bytes), snapshot_id)
        _require(read_nodes == nodes and read_edges == edges and _json(ontology_bytes) == ontology, 'native_roundtrip_mismatch')
        self._structure(read_nodes, read_edges, inputs, documents, format_version)
        receipt = {'formatVersion': format_version, 'snapshotId': snapshot_id, 'graphId': snapshot_id,
                   'builtAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'), 'component': dict(COMPONENT),
                   'files': {kind: {'name': kind + '.json', 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
                             for kind, data in (('graph', graph_bytes), ('ontology', ontology_bytes))}, 'inputs': inputs}
        # Publish exclusively and last. Failures retain the fresh directory.
        with (root / 'receipt.json').open('x', encoding='utf-8') as stream:
            stream.write(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
        self.load(snapshot_id)
        return snapshot_id

    @_boundary
    def load(self, snapshot_id):
        snapshot_id = _uuid(snapshot_id)
        root = self.run_root / 'snapshots' / snapshot_id
        self._directory(root)
        receipt = _json(self._read(root / 'receipt.json'))
        _require(isinstance(receipt, dict) and set(receipt) == {'formatVersion', 'snapshotId', 'graphId', 'builtAt', 'component', 'files', 'inputs'}, 'invalid_receipt')
        _require(type(receipt['formatVersion']) is int and receipt['formatVersion'] in (1, 2), 'unsupported_format')
        _require(receipt['snapshotId'] == receipt['graphId'] == snapshot_id, 'snapshot_identity_mismatch')
        _require(receipt['component'] == COMPONENT, 'component_identity_mismatch')
        built_at = datetime.fromisoformat(receipt['builtAt'].replace('Z', '+00:00'))
        _require(built_at.tzinfo is not None and built_at.utcoffset().total_seconds() == 0, 'invalid_built_at')
        _require(isinstance(receipt['files'], dict) and set(receipt['files']) == {'graph', 'ontology'}, 'invalid_file_receipt')
        files = {}
        for kind in ('graph', 'ontology'):
            record = receipt['files'][kind]
            _require(isinstance(record, dict) and set(record) == {'name', 'sha256', 'bytes'}
                     and record['name'] == kind + '.json' and _hash(record['sha256'])
                     and type(record['bytes']) is int and record['bytes'] >= 0, 'invalid_file_receipt')
            files[kind] = self._read(root / record['name'])
            _require(len(files[kind]) == record['bytes'] and hashlib.sha256(files[kind]).hexdigest() == record['sha256'], 'file_integrity_mismatch')
        documents = self._inputs(receipt['inputs'])
        nodes, edges = self._native_logical(_json(files['graph']), snapshot_id)
        refs = self._structure(nodes, edges, receipt['inputs'], documents, receipt['formatVersion'])
        self._ontology(_json(files['ontology']), nodes)
        # Disabled/known-error history may reopen; new queries still exclude it.
        _require(all(i['state'] in {'available', 'disabled', 'excluded', 'forbidden', 'known-error'}
                     for i in _checks(self.authority, refs)), 'source_identity_unavailable')
        _require(self._read(root / 'graph.json') == files['graph'], 'snapshot_changed_during_load')
        graph = _new_graph()
        graph.load_from_file(root / 'graph.json')
        actual_nodes = []
        for expected in nodes:
            actual = graph.find_node(expected['id'])
            _require(isinstance(actual, dict), 'native_load_incomplete')
            meta = actual['metadata']
            if 'content' in meta:
                _require(meta.pop('content') == actual['content'], 'native_content_conflict')
            actual_nodes.append(actual)
        actual_edges = [{k: e[k] for k in ('id', 'source', 'target', 'type', 'metadata')} for e in graph.find_edges()]
        _require(graph.graph_id == snapshot_id and len(graph.nodes) == len(nodes)
                 and actual_nodes == nodes and actual_edges == edges, 'native_roundtrip_mismatch')
        fixed_inputs = copy.deepcopy(receipt['inputs'])
        return SnapshotView(graph, self.authority, actual_nodes, actual_edges, lambda: self._inputs(fixed_inputs))
