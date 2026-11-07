"""Studio formal-source snapshots: genuine official library, synthetic sources."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from scripts.fourbase_l2.identity import canonical, ref_identity
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

    def test_a_v2_projection_does_not_relax_v1_scene_contract(self):
        result = self.make()
        store = SnapshotStore(self.root, self.authority)
        receipt = json.loads((self.root / 'snapshots' / result['snapshotId'] / 'receipt.json').read_text())
        logical = store.load(result['snapshotId']).query()
        with self.assertRaises(SnapshotError):
            store.write(logical['nodes'], logical['edges'], {'classes': [{'name': 'Statement'}, {'name': 'SourceRevision'}], 'properties': []}, receipt['inputs'])


if __name__ == '__main__':
    unittest.main()
