"""Studio formal-source snapshots: genuine official library, synthetic sources."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from scripts.fourbase_l2.identity import canonical, claim_id, edge_id, ref_identity
from scripts.fourbase_l2.query import query_graph
from scripts.fourbase_l2.readmodel import SnapshotError, SnapshotStore
from scripts.fourbase_l2.studio_build import build


class Authority:
    def __init__(self):
        self.state = 'available'

    def check_many(self, refs):
        return [{'state': self.state, 'gaps': []} for _ in refs]


class StudioSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='studio-v2-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.authority = Authority()
        self.ref = {'kind': 'studio-source', 'systemId': 'retail', 'assetId': 'ontology',
                    'version': '1', 'publishedHash': 'a' * 64, 'projectId': 'construction'}
        self.source = {'ref': self.ref, 'kind': 'ontology', 'title': '退款归属',
                       'body': json.dumps({'entities': [{'key': 'refund', 'text': '退款', 'label': 'EVENT'},
                                                       {'key': 'store', 'text': '门店', 'label': 'ORG'}],
                                           'relationships': [{'source': 'refund', 'target': 'store', 'predicate': '归属'}]}, ensure_ascii=False)}

    def make(self):
        return build({'type': 'build', 'runRoot': str(self.root), 'sources': [self.source]}, self.authority)

    def test_v2_source_nodes_must_keep_the_exact_published_hash_assertion(self):
        result = self.make()
        receipt = json.loads((self.root / 'snapshots' / result['snapshotId'] / 'receipt.json').read_text())
        store = SnapshotStore(self.root, self.authority)
        logical = store.load(result['snapshotId']).query()
        nodes, edges = copy.deepcopy((logical['nodes'], logical['edges']))
        for item in nodes + edges:
            for ref in item['metadata']['sourceRefs']:
                ref.pop('publishedHash')
        with self.assertRaises(SnapshotError):
            store.write(nodes, edges, json.loads((self.root / 'snapshots' / result['snapshotId'] / 'ontology.json').read_text()), receipt['inputs'], format_version=2)

    def test_explicit_business_relation_keeps_predicate_and_rechecks_withdrawn_sources(self):
        result = self.make()
        store = SnapshotStore(self.root, self.authority)
        view = store.load(result['snapshotId'])
        graph = view.query()
        refund = next(node['id'] for node in graph['nodes'] if node['content'] == '退款')
        found = query_graph(view, {'action': 'graph', 'operation': 'neighbors', 'nodeId': refund, 'relationTypes': ['asserted_relation']})
        self.assertEqual(len(found['edges']), 1)
        self.assertEqual(found['edges'][0]['metadata']['predicate'], '归属')
        self.assertEqual(found['edges'][0]['metadata']['sourceRefs'][0], self.ref)
        self.authority.state = 'forbidden'
        withdrawn = query_graph(view, {'action': 'graph', 'operation': 'find', 'query': '退款'})
        self.assertEqual(withdrawn['nodes'], [])
        self.assertIn('source-ineligible-results-excluded', withdrawn['gaps'])

    def test_same_text_with_distinct_local_keys_keeps_both_graph_relations(self):
        projection = json.loads(self.source['body'])
        projection['entities'].append({'key': 'prior_refund', 'text': '退款', 'label': 'EVENT'})
        projection['relationships'].append({'source': 'prior_refund', 'target': 'store', 'predicate': '旧口径归属'})
        self.source['body'] = json.dumps(projection, ensure_ascii=False)

        result = self.make()
        graph = SnapshotStore(self.root, self.authority).load(result['snapshotId']).query()
        refunds = {node['metadata'].get('studioEntityKey'): node['id']
                   for node in graph['nodes'] if node['content'] == '退款'}
        relations = [edge for edge in graph['edges'] if edge['type'] == 'asserted_relation']

        self.assertEqual(set(refunds), {None, 'prior_refund'})
        self.assertEqual(len(relations), 2)
        self.assertEqual({edge['source']: edge['metadata']['predicate'] for edge in relations},
                         {refunds[None]: '归属', refunds['prior_refund']: '旧口径归属'})

        snapshot = self.root / 'snapshots' / result['snapshotId']
        inputs = json.loads((snapshot / 'receipt.json').read_text())['inputs']
        ontology = json.loads((snapshot / 'ontology.json').read_text())
        invalid_metadata = {'studioEntityKey': 'undeclared_refund',
                            'sourceRefs': [{**self.ref, 'assetId': 'other-source'}],
                            'claimKind': 'engineering-interpretation'}
        for field, value in invalid_metadata.items():
            with self.subTest(field=field):
                nodes, edges = copy.deepcopy((graph['nodes'], graph['edges']))
                node = next(node for node in nodes if node['metadata'].get('studioEntityKey') == 'prior_refund')
                previous_id = node['id']
                meta = node['metadata']
                meta[field] = value
                node['id'] = claim_id(node['type'], meta['sourceRefs'], meta['buildSources'], inputs, meta['claimKind'],
                                      node['content'], studio_entity_key=meta['studioEntityKey'])
                for edge in edges:
                    if edge['source'] == previous_id:
                        edge['source'] = node['id']
                        edge['id'] = edge_id(edge['source'], edge['target'], edge['type'], edge['metadata'], inputs)
                with self.assertRaisesRegex(SnapshotError, 'invalid_studio_entity_key'):
                    SnapshotStore(self.root, self.authority).write(nodes, edges, ontology, inputs, format_version=2)

    def test_a_v2_projection_does_not_relax_v1_scene_contract(self):
        result = self.make()
        store = SnapshotStore(self.root, self.authority)
        receipt = json.loads((self.root / 'snapshots' / result['snapshotId'] / 'receipt.json').read_text())
        logical = store.load(result['snapshotId']).query()
        with self.assertRaises(SnapshotError):
            store.write(logical['nodes'], logical['edges'], {'classes': [{'name': 'Statement'}, {'name': 'SourceRevision'}], 'properties': []}, receipt['inputs'])


if __name__ == '__main__':
    unittest.main()
