"""Approved D13 finite queries over the actual copied S3 54/63 graph."""
import copy
import json
import os
import unittest
from pathlib import Path

from scripts.fourbase_l2.identity import canonical, ref_identity
from scripts.fourbase_l2.query import parse_query, query_graph
from scripts.fourbase_l2.readmodel import SnapshotError, SnapshotStore

FIXTURE = Path(os.environ['FOURBASE_L2_AUTHORITY_RUN']) if os.environ.get('FOURBASE_L2_AUTHORITY_RUN') else Path(__file__).resolve().parents[2] / '.local/fourbase-l2-s3/sc01s-v0.1/run-s3-fixture-s4'


class Authority:
    def __init__(self):
        self.states = {}
        self.calls = []

    def check_many(self, refs):
        self.calls.append(copy.deepcopy(refs))
        return [{'state': self.states.get(canonical(ref_identity(r)), 'available'),
                 'gaps': [] if r.get('publishedHash') else ['hash-not-declared']} for r in refs]


class GraphQueries(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.build = json.loads((FIXTURE / 'evidence/scene-v2-corrected-build.json').read_text())
        cls.keys = cls.build['keys']

    def setUp(self):
        self.authority = Authority()
        self.view = SnapshotStore(FIXTURE, self.authority).load(self.build['snapshotId'])

    def query(self, operation, **fields):
        return query_graph(self.view, {'action': 'graph', 'operation': operation, **fields}, self.build['inputIdentities'])

    def test_parser_rejects_array_or_object_directions_with_stable_request_code(self):
        for direction in [['out'], {'direction': 'out'}]:
            with self.subTest(direction=direction), self.assertRaises(SnapshotError) as caught:
                parse_query({'action': 'graph', 'operation': 'neighbors', 'nodeId': 'node', 'direction': direction})
            self.assertEqual(caught.exception.code, 'invalid_query_request')

    def test_definition_keeps_exact_original_refs_and_conditions(self):
        result = self.query('definition', nodeId=self.keys['C03'])
        node = result['nodes'][0]
        self.assertEqual(node['id'], self.keys['C03'])
        self.assertIn('支付', node['content'])
        self.assertTrue(any(r.get('metricName') == 'retail_refund_amount' and r['version'] == '0.1.0' for r in node['metadata']['sourceRefs']))
        for key, expected in [('real-maturity', 'unknown'), ('comparability', 'required-not-established'), ('quantity-dispute', 'disputed')]:
            self.assertEqual(self.query('definition', nodeId=self.keys[key])['nodes'][0]['metadata']['conditionState'], expected)

    def test_find_normalizes_phrase_and_sorts_ids_without_guessing_synonyms(self):
        result = self.query('find', query='  c03  ')
        self.assertIn(self.keys['C03'], [n['id'] for n in result['nodes']])
        self.assertEqual([n['id'] for n in result['nodes']], sorted(n['id'] for n in result['nodes']))
        self.assertEqual(self.query('find', query='never-seen-business-synonym')['nodes'], [])
        self.assertTrue(all(n['type'] == 'Condition' for n in self.query('find', query='未知', nodeTypes=['Condition'])['nodes']))

    def test_neighbors_keeps_parallel_edges_and_subtraction_roles(self):
        result = self.query('neighbors', nodeId=self.keys['C04'], direction='out')
        parallel = [e for e in result['edges'] if e['target'] == self.keys['C04-concept'] and e['type'] == 'version_of']
        self.assertEqual(len(parallel), 2)
        self.assertEqual(len({e['id'] for e in parallel}), 2)
        self.assertEqual({e['metadata']['operandRole']: e['target'] for e in result['edges'] if e['type'] == 'depends_on'},
                         {'minuend': self.keys['C02'], 'subtrahend': self.keys['C03']})
        self.assertEqual(len(self.query('neighbors', nodeId=self.keys['C04'], relationTypes=['version_of'])['edges']), 2)

    def test_method_has_four_groups_and_all_three_dependencies(self):
        definition = self.query('definition', nodeId=self.keys['method'])['nodes'][0]
        self.assertEqual(set(json.loads(definition['content'])['content']), {'conditions', 'logic', 'judgment', 'limits'})
        result = self.query('dependencies', nodeId=self.keys['method'], depth=1)
        self.assertEqual({e['target'] for e in result['edges'] if e['source'] == self.keys['method']}, {self.keys[k] for k in ['C02', 'C03', 'C04']})
        self.assertFalse(result['exhausted'])
        self.assertIn('depth-limit', result['gaps'])

    def assert_paths(self, result):
        nodes = {n['id'] for n in result['nodes']}
        edges = {e['id']: e for e in result['edges']}
        for path in result['paths']:
            self.assertEqual(len(path['steps']) + 1, len(path['nodeIds']))
            self.assertTrue(set(path['nodeIds']) <= nodes)
            for index, step in enumerate(path['steps']):
                edge = edges[step['edgeId']]
                endpoints = [edge['source'], edge['target']]
                if step['direction'] == 'reverse':
                    endpoints.reverse()
                self.assertEqual(endpoints, path['nodeIds'][index:index + 2])

    def test_impact_retains_two_approved_chains_with_original_direction(self):
        result = self.query('impact', nodeId=self.keys['field-orders.order_id'], depth=4)
        self.assert_paths(result)
        paths = {tuple(p['nodeIds']) for p in result['paths'] if p['nodeIds'][-1] == self.keys['method']}
        self.assertEqual(paths, {(self.keys['field-orders.order_id'], self.keys['C03'], self.keys['method']),
                                 (self.keys['field-orders.order_id'], self.keys['C03'], self.keys['C04'], self.keys['method'])})
        self.assertTrue(result['exhausted'])
        shallow = self.query('impact', nodeId=self.keys['field-orders.order_id'], depth=2)
        self.assertFalse(shallow['exhausted'])
        self.assertEqual(shallow['depthReached'], 2)
        self.assertFalse(any(p['nodeIds'][-1] == self.keys['C04'] for p in self.query('impact', nodeId=self.keys['C05'], depth=4)['paths']))

    def test_parallel_dependency_paths_are_not_collapsed_by_node_sequence(self):
        graph = self.view.query()
        edge = next(e for e in graph['edges'] if e['source'] == self.keys['C04'] and e['type'] == 'depends_on')
        duplicate = copy.deepcopy(edge)
        duplicate['id'] += ':independent-provenance'
        graph['edges'].append(duplicate)
        class QualifiedView:
            def query(self):
                return copy.deepcopy(graph)
        result = query_graph(QualifiedView(), {'action': 'graph', 'operation': 'dependencies', 'nodeId': self.keys['C04']})
        self.assert_paths(result)
        same = [p for p in result['paths'] if p['nodeIds'] == [edge['source'], edge['target']]]
        self.assertEqual(len(same), 2)
        self.assertNotEqual(same[0]['steps'], same[1]['steps'])

    def test_source_is_internal_qualified_semantics_not_frozen_data_dump(self):
        result = self.query('source', sourceHandle='host-only-not-interpreted-by-python')
        self.assertEqual((len(result['nodes']), len(result['edges'])), (54, 63))
        fields = [n for n in result['nodes'] if n['type'] == 'FieldRole']
        self.assertEqual(len({p for n in fields for p in json.loads(n['content'])['pointers']}), 337)
        text = json.dumps(result)
        self.assertNotIn('relativePath', text)
        self.assertNotIn(str(FIXTURE), text)
        self.assertNotIn('synthetic_net_controls": [', text)
        source = result['nodes'][0]['metadata']['buildSources'][0]
        self.assertEqual(len(source['sha256']), 64)
        self.assertIn(source['nature'], ['asset-publication', 'engineering-design', 'synthetic-data', 'deidentified-source'])

    def test_current_source_filtering_precedes_all_matching_and_traversal(self):
        enterprise = self.build['refs']['enterprise']
        self.authority.states[canonical(ref_identity(enterprise))] = 'disabled'
        definition = self.query('definition', nodeId=self.keys['C04'])
        self.assertEqual(definition['nodes'], [])
        self.assertEqual(definition['state'], 'partial')
        for result in [definition, self.query('find', query='零售量'), self.query('impact', nodeId=self.keys['field-orders.order_id'], depth=4)]:
            self.assertNotIn(enterprise['materialId'], json.dumps(result))
            self.assertNotIn(self.keys['C04'], [n['id'] for n in result['nodes']])

    def test_unknown_hash_gap_is_preserved_without_inventing_hash(self):
        result = self.query('definition', nodeId=self.keys['C04'])
        self.assertIn('source-validation-gap', result['gaps'])

    def test_bounds_and_cycle_keep_complete_units_and_report_incomplete(self):
        graph = {'state': 'available', 'gaps': [], 'nodes': [], 'edges': []}
        meta = {'sourceRefs': [], 'buildSources': [], 'claimKind': 'engineering-interpretation', 'conditions': [], 'limitations': [], 'businessTime': []}
        for i in range(205):
            graph['nodes'].append({'id': f'n{i:03}', 'type': 'MetricVersion', 'content': 'finite', 'metadata': meta})
            if i:
                graph['edges'].append({'id': f'e{i:03}', 'source': 'n000', 'target': f'n{i:03}', 'type': 'depends_on', 'metadata': meta})
        class QualifiedView:
            def query(self):
                return copy.deepcopy(graph)
        result = query_graph(QualifiedView(), {'action': 'graph', 'operation': 'dependencies', 'nodeId': 'n000', 'depth': 4})
        self.assertLessEqual(len(result['nodes']), 200)
        self.assertLessEqual(len(result['edges']), 500)
        self.assertFalse(result['exhausted'])
        self.assertIn('node-limit', result['gaps'])
        self.assert_paths(result)

        graph['nodes'] = graph['nodes'][:200]
        graph['edges'] = []
        for i in range(1, 200):
            for provenance in range(3):
                graph['edges'].append({'id': f'e{i:03}-{provenance}', 'source': 'n000', 'target': f'n{i:03}', 'type': 'depends_on', 'metadata': meta})
        limited = query_graph(QualifiedView(), {'action': 'graph', 'operation': 'dependencies', 'nodeId': 'n000', 'depth': 4})
        self.assertEqual(len(limited['edges']), 500)
        self.assertEqual(len(limited['paths']), 500)
        self.assertFalse(limited['exhausted'])
        self.assertIn('edge-limit', limited['gaps'])
        self.assert_paths(limited)

        graph['nodes'] = graph['nodes'][:3]
        graph['edges'] = [{'id': f'cycle-{i}', 'source': f'n{i:03}', 'target': f'n{(i + 1) % 3:03}', 'type': 'depends_on', 'metadata': meta} for i in range(3)]
        cyclic = query_graph(QualifiedView(), {'action': 'graph', 'operation': 'dependencies', 'nodeId': 'n000', 'depth': 4})
        self.assertTrue(cyclic['exhausted'])
        self.assertEqual(cyclic['depthReached'], 2)
        self.assertTrue(all(len(p['nodeIds']) == len(set(p['nodeIds'])) for p in cyclic['paths']))
        self.assert_paths(cyclic)
