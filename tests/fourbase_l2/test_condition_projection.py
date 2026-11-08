"""D16 condition declarations stay distinct from method prerequisites.

Fixtures use public deidentified definitions and invented input declarations.
No original study, business answers, Host or Provider is opened.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest

from scripts.fourbase_l2.identity import canonical, ref_identity
from scripts.fourbase_l2.query import query_graph
from scripts.fourbase_l2.readmodel import NODE_TYPES, EDGE_TYPES, SnapshotError, SnapshotStore
from scripts.fourbase_l2.sc01s import make_sc01s_graph


class ConditionProjectionFixture:
    def setUp(self):
        base = Path(__file__).resolve().parents[2] / 'openspec/changes/fourbase-l2-rollout'
        self.metrics = json.loads((base / 'assets/sc01s-core.sap.json').read_bytes())
        names = ['terminal_sales_amount', 'retail_refund_amount', 'net_retail_sales']
        self.refs = {
            'metrics': [{'kind': 'sap', 'packageId': 'optracall-sc01s-retail',
                         'version': '0.1.0', 'metricName': name, 'publishedHash': 'a' * 64}
                        for name in names],
            'method': {'kind': 'sap-method', 'methodId': 'condition-fixture',
                       'version': 1, 'publishedHash': 'b' * 64},
            'enterprise': {'kind': 'enterprise', 'storeId': 'fixture',
                           'materialId': 'definitions', 'revisionId': 'one'},
            'input': {'kind': 'data-input', 'projectId': 'fixture',
                      'datasetId': 'fixture', 'inputVersionId': 'one'},
            'description': {'kind': 'data-description', 'projectId': 'fixture',
                            'datasetId': 'fixture', 'inputVersionId': 'one',
                            'descriptionRevisionId': 'one'},
        }
        self.assets = {
            'metric_document': self.metrics,
            'method': {'title': '公开条件声明工程fixture', 'sources': [],
                       'content': json.loads((base / 'assets/sc01s-reliability-method.content.json').read_bytes())},
            'enterprise': {'title': '公开脱敏定义工程fixture'},
            'input': {'inputVersionId': 'one', 'sha256': 'c' * 64},
            'description': {'descriptionRevisionId': 'one', 'mappings': [], 'statements': []},
        }
        self.documents = {
            'metric-excerpt': json.loads((base / 'data/metric-candidates.v0.1.json').read_bytes()),
            'synthetic-input': {'conditions': {'payments_complete': True, 'returns_policy': None}},
        }
        self.identities = {key: 'd' * 64 for key in [
            'metric-publication', 'method-publication', 'enterprise-revision',
            'input-version', 'm2-description', 'metric-excerpt', 'synthetic-input']}

    def build(self):
        return make_sc01s_graph(self.refs, self.assets, self.documents, self.identities)

    def query(self, graph, operation, **fields):
        class QualifiedFixture:
            def query(self):
                return {'state': 'available', 'gaps': [],
                        'nodes': copy.deepcopy(graph['entities']),
                        'edges': copy.deepcopy(graph['relationships'])}
        return query_graph(QualifiedFixture(), {'action': 'graph', 'operation': operation, **fields})

    def find(self, graph, query):
        return self.query(graph, 'find', query=query, nodeTypes=['Condition'])['nodes']


class ConditionProjectionTests(ConditionProjectionFixture, unittest.TestCase):
    def test_each_input_condition_is_separately_findable_with_its_original_value(self):
        graph = self.build()
        payment = self.find(graph, 'payments_complete')
        policy = self.find(graph, 'returns_policy')
        self.assertEqual((len(payment), len(policy)), (1, 1))
        self.assertNotEqual(payment[0]['id'], policy[0]['id'])
        self.assertEqual(json.loads(payment[0]['content']), {'payments_complete': True})
        self.assertEqual(json.loads(policy[0]['content']), {'returns_policy': None})
        for node in [payment[0], policy[0]]:
            self.assertEqual(node['metadata']['sourceRefs'], [self.refs['input']])
            self.assertEqual(node['metadata']['buildSources'], [
                {'inputKey': 'synthetic-input', 'locator': '/conditions'}])
            self.assertEqual(node['metadata']['claimKind'], 'synthetic-assumption')
            self.assertEqual(node['metadata']['conditionState'], 'stated')

    def test_task_declarations_and_general_unknowns_are_not_method_prerequisites(self):
        self.documents['synthetic-input']['conditions'] = {
            'payments_complete': False, 'returns_policy': None}
        graph = self.build()
        required = self.query(graph, 'neighbors', nodeId=graph['keys']['method'],
                              direction='out', relationTypes=['requires'])
        self.assertEqual({edge['target'] for edge in required['edges']},
                         {graph['keys']['comparability']})
        refund = self.query(graph, 'neighbors', nodeId=graph['keys']['C03'],
                            direction='out', relationTypes=['requires'])
        self.assertEqual(refund['edges'], [])
        for key in ['real-maturity', 'real-exceptions']:
            node = self.query(graph, 'definition', nodeId=graph['keys'][key])['nodes'][0]
            self.assertEqual(node['metadata']['conditionState'], 'unknown')
        for key in ['payments_complete', 'returns_policy']:
            declaration = self.find(graph, key)[0]
            self.assertTrue(any('/conditions' in scope for scope in declaration['metadata']['conditions']))
            self.assertEqual(self.query(graph, 'neighbors', nodeId=declaration['id'])['edges'], [])

    def test_original_values_remain_top_level_declarations_without_missing_key_inference(self):
        values = {'false_value': False, 'null_value': None, 'text_value': 'unknown',
                  'nested_value': {'child': [False, None, {'unchanged': 'literal'}]},
                  'slash/tilde~key': '原名与原值'}
        self.documents['synthetic-input']['conditions'] = copy.deepcopy(values)
        graph = self.build()
        declarations = [node for node in graph['entities'] if
                        node['metadata']['buildSources'] == [
                            {'inputKey': 'synthetic-input', 'locator': '/conditions'}]]
        self.assertEqual(len(declarations), 5)
        recovered = {}
        for node in declarations:
            self.assertEqual(node['metadata']['conditionState'], 'stated')
            self.assertEqual(len(json.loads(node['content'])), 1)
            recovered.update(json.loads(node['content']))
        self.assertEqual(recovered, values)
        self.assertEqual(self.find(graph, 'absent_condition'), [])
        self.assertEqual(self.find(graph, 'unchanged')[0]['content'],
                         json.dumps({'nested_value': values['nested_value']}, ensure_ascii=False))

    def test_two_source_envelopes_do_not_merge_or_choose_a_conflicting_value(self):
        self.documents['synthetic-input'] = {
            'conditions': {'shared_condition': False},
            'synthetic_assumptions': {'shared_condition': True},
        }
        nodes = self.find(self.build(), 'shared_condition')
        self.assertEqual(len(nodes), 2)
        by_locator = {n['metadata']['buildSources'][0]['locator']: n for n in nodes}
        self.assertEqual(set(by_locator), {'/conditions', '/synthetic_assumptions'})
        self.assertEqual(json.loads(by_locator['/conditions']['content']), {'shared_condition': False})
        self.assertEqual(json.loads(by_locator['/synthetic_assumptions']['content']), {'shared_condition': True})
        self.assertNotEqual(nodes[0]['id'], nodes[1]['id'])
        self.assertTrue(any('/conditions' in text for text in by_locator['/conditions']['metadata']['conditions']))
        self.assertTrue(any('/synthetic_assumptions' in text for text in by_locator['/synthetic_assumptions']['metadata']['conditions']))

    def test_empty_absent_and_non_object_conditions_do_not_invent_keys(self):
        for sample in [{}, {'conditions': {}}]:
            with self.subTest(sample=sample):
                self.documents['synthetic-input'] = sample
                graph = self.build()
                self.assertEqual([n for n in graph['entities']
                                  if n['type'] == 'Condition' and n['metadata']['sourceRefs'] == [self.refs['input']]], [])
        for value in [False, None, ['literal', False], '原形声明']:
            with self.subTest(value=value):
                self.documents['synthetic-input'] = {'conditions': value}
                graph = self.build()
                declarations = [n for n in graph['entities']
                                if n['type'] == 'Condition' and n['metadata']['sourceRefs'] == [self.refs['input']]]
                self.assertEqual(len(declarations), 1)
                self.assertEqual(json.loads(declarations[0]['content']), value)
                self.assertEqual(declarations[0]['metadata']['conditionState'], 'stated')
                self.assertEqual(self.query(graph, 'neighbors', nodeId=declarations[0]['id'])['edges'], [])

    def test_definition_dependencies_and_given_source_objects_are_preserved(self):
        original = copy.deepcopy((self.refs, self.assets, self.documents, self.identities))
        graph = self.build()
        result = self.query(graph, 'dependencies', nodeId=graph['keys']['method'], depth=1)
        self.assertEqual({e['target'] for e in result['edges']},
                         {graph['keys'][key] for key in ['C02', 'C03', 'C04']})
        self.assertFalse(any(n['type'] == 'Condition' for n in result['nodes']))
        self.assertEqual((self.refs, self.assets, self.documents, self.identities), original)
        self.assertEqual(len([n for n in graph['entities'] if n['type'] == 'MetricVersion']), 3)
        self.assertEqual(len([n for n in graph['entities'] if n['type'] == 'MethodVersion']), 1)


class DeclarationAuthority:
    """Synthetic source qualification only, independent of graph construction."""
    def __init__(self):
        self.states = {}
        self.gaps = []

    def check_many(self, refs):
        return [{'state': self.states.get(canonical(ref_identity(ref)), 'available'),
                 'gaps': list(self.gaps)} for ref in refs]


class NativeConditionProjectionTests(ConditionProjectionFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.tmp = tempfile.TemporaryDirectory(
            prefix='condition-native-', dir=os.environ.get('FOURBASE_L2_S5_TEST_ROOT'))
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'inputs').mkdir()
        self.authority = DeclarationAuthority()
        self.store = SnapshotStore(self.root, self.authority)
        self.edition = 0

    def snapshot(self):
        self.edition += 1
        version = f'input-{self.edition}'
        self.refs['input']['inputVersionId'] = version
        self.refs['description'].update(inputVersionId=version, descriptionRevisionId=f'description-{self.edition}')
        self.assets['input']['inputVersionId'] = version
        self.assets['description']['descriptionRevisionId'] = f'description-{self.edition}'
        documents = {
            **self.documents,
            'metric-publication': self.assets['metric_document'],
            'method-publication': self.assets['method'],
            'enterprise-revision': self.assets['enterprise'],
            'input-version': self.assets['input'],
            'm2-description': self.assets['description'],
        }
        records = []
        for key, document in documents.items():
            raw = (json.dumps(document, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
            relative = f'inputs/{self.edition}-{key}.json'
            (self.root / relative).write_bytes(raw)
            records.append({'inputKey': key, 'relativePath': relative,
                            'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
                            'nature': 'synthetic-data' if key == 'synthetic-input' else 'engineering-design'})
        self.identities = {r['inputKey']: r['sha256'] for r in records}
        graph = self.build()
        ontology = {'name': 'D16 public engineering declarations',
                    'classes': [{'name': name} for name in sorted(NODE_TYPES)],
                    'properties': [{'name': name} for name in sorted(EDGE_TYPES)]}
        sid = self.store.write(graph['entities'], graph['relationships'], ontology, records)
        return sid, graph, records

    def test_native_roundtrip_keeps_source_qualification_and_gap_distinct_from_paging(self):
        sid, graph, records = self.snapshot()
        view = self.store.load(sid)
        response = query_graph(view, {'action': 'graph', 'operation': 'find',
                                     'query': 'payments_complete', 'nodeTypes': ['Condition']}, records)
        self.assertEqual(json.loads(response['nodes'][0]['content']), {'payments_complete': True})
        source = response['nodes'][0]['metadata']['buildSources'][0]
        self.assertEqual(source['locator'], '/conditions')
        self.assertEqual(source['sha256'], next(r['sha256'] for r in records if r['inputKey'] == 'synthetic-input'))
        self.authority.gaps = ['synthetic-source-warning']
        limited = query_graph(view, {'action': 'graph', 'operation': 'find',
                                    'query': 'payments_complete', 'nodeTypes': ['Condition']}, records)
        self.assertEqual(limited['state'], 'partial')
        self.assertIn('source-validation-gap', limited['gaps'])
        self.assertTrue(limited['exhausted'])
        self.authority.states[canonical(ref_identity(self.refs['input']))] = 'disabled'
        withdrawn = query_graph(view, {'action': 'graph', 'operation': 'find',
                                      'query': 'payments_complete', 'nodeTypes': ['Condition']}, records)
        self.assertEqual(withdrawn['nodes'], [])
        self.assertIn('source-ineligible-results-excluded', withdrawn['gaps'])

    def test_new_snapshot_does_not_rewrite_old_snapshot_or_given_declaration(self):
        old, graph, records = self.snapshot()
        old_root = self.root / 'snapshots' / old
        original = {p.name: p.read_bytes() for p in old_root.iterdir()}
        self.documents['synthetic-input']['conditions']['payments_complete'] = False
        new, _, new_records = self.snapshot()
        self.assertNotEqual(old, new)
        self.assertEqual({p.name: p.read_bytes() for p in old_root.iterdir()}, original)
        for sid, expected, inputs in [(old, True, records), (new, False, new_records)]:
            result = query_graph(self.store.load(sid), {'action': 'graph', 'operation': 'find',
                                 'query': 'payments_complete', 'nodeTypes': ['Condition']}, inputs)
            self.assertEqual(json.loads(result['nodes'][0]['content']), {'payments_complete': expected})

    def test_modified_fixed_input_fails_instead_of_returning_old_declarations(self):
        sid, _, records = self.snapshot()
        view = self.store.load(sid)
        sample = next(r for r in records if r['inputKey'] == 'synthetic-input')
        (self.root / sample['relativePath']).write_bytes(b'{"conditions":{"payments_complete":false}}\n')
        with self.assertRaises(SnapshotError) as caught:
            query_graph(view, {'action': 'graph', 'operation': 'find',
                              'query': 'payments_complete', 'nodeTypes': ['Condition']}, records)
        self.assertEqual(caught.exception.code, 'input_integrity_mismatch')

    def test_actual_shacl_accepts_existing_states_without_promoting_them(self):
        from scripts.fourbase_l2.graph_constraints import validate_graph
        graph = self.build()
        before = copy.deepcopy(graph)
        result = validate_graph(graph['entities'], graph['relationships'], metric_refs=self.refs['metrics'])
        self.assertTrue(result['conforms'], result['violations'])
        self.assertEqual(graph, before)
        self.assertEqual({n['metadata']['conditionState'] for n in self.find(graph, 'payments_complete')}, {'stated'})


if __name__ == '__main__':
    unittest.main()
