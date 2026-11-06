import json
import os
import unittest
from pathlib import Path
import yaml
from fourbase_l2.sc01s import make_sc01s_graph


class SceneConstructionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        run = Path(os.environ['OPTRACALL_S3_RUN'])
        repo = Path(os.environ['OPTRACALL_REPO'])
        a = json.loads((run/'evidence/initial-asset-receipt.json').read_text())
        m = json.loads((run/'evidence/initial-m2-receipt.json').read_text())
        cls.refs = {'metrics': [{'kind':'sap', **x} for x in a['refs']['metrics']], 'method': a['refs']['method'],
                    'enterprise': {'kind':'enterprise', **m['conceptRef']},
                    'input': {'kind':'data-input', **{k:m[k] for k in ['projectId','datasetId','inputVersionId']}},
                    'description': {'kind':'data-description', **{k:m[k] for k in ['projectId','datasetId','inputVersionId','descriptionRevisionId']}}}
        cls.assets = {'metric_document': yaml.safe_load((run/'asset-root/metric-assets/optracall-sc01s-retail/0.1.0.sap.yaml').read_text()),
                      'method': a['methodSaved']['version'], 'input': m['freeze']['record'], 'description':m['description']['record'],
                      'enterprise': {'title':'SC-01S 脱敏定义与合成字段说明','body':'Engineering source revision, no business answers'}}
        base=repo/'openspec/changes/fourbase-l2-rollout'
        cls.documents={'metric-excerpt':json.loads((base/'data/metric-candidates.v0.1.json').read_text()),
                       'synthetic-input':json.loads((base/'data/sc01-synthetic-v0.1/input.json').read_text())}
        cls.inputs={key:'a'*64 for key in ['metric-publication','method-publication','enterprise-revision','input-version','m2-description','metric-excerpt','synthetic-input']}

    def graph(self):
        return make_sc01s_graph(self.refs,self.assets,self.documents,self.inputs)

    def test_three_actual_metric_versions_and_method(self):
        graph=self.graph()
        metrics=[n for n in graph['entities'] if n['type']=='MetricVersion']
        self.assertEqual(3,len(metrics))
        self.assertEqual(1,len([n for n in graph['entities'] if n['type']=='MethodVersion']))
        self.assertTrue(all(any(r.get('metricName') in {'terminal_sales_amount','retail_refund_amount','net_retail_sales'} for r in n['metadata']['sourceRefs']) for n in metrics))

    def test_net_subtraction_direction_and_parallel_provenance(self):
        graph=self.graph(); nodes={n['id']:n for n in graph['entities']}
        net=next((n for n in nodes.values() if n['type']=='MetricVersion' and any(r.get('metricName')=='net_retail_sales' for r in n['metadata']['sourceRefs'])),None)
        self.assertIsNotNone(net)
        deps=[e for e in graph['relationships'] if e['source']==net['id'] and e['type']=='depends_on']
        self.assertEqual({'minuend','subtrahend'},{e['metadata'].get('operandRole') for e in deps})
        expresses=[e for e in graph['relationships'] if e['source']==net['id'] and e['type']=='version_of']
        self.assertEqual(2,len(expresses))
        self.assertNotEqual(expresses[0]['id'],expresses[1]['id'])

    def test_ambiguity_unknowns_field_roles_and_no_answers(self):
        graph=self.graph()
        unknown=[n for n in graph['entities'] if n['type']=='Condition' and n['metadata'].get('conditionState')=='unknown']
        self.assertGreaterEqual(len(unknown),2)
        self.assertTrue(any(e['type']=='potential_conflict' for e in graph['relationships']))
        self.assertTrue(any(n['type']=='FieldRole' and '/refunds/0/order_id' in n['content'] for n in graph['entities']))
        serialized=json.dumps(graph,ensure_ascii=False)
        for answer in ['133000','118000','-15000','SYN-ORDER-01-A-01']:
            self.assertNotIn(answer,serialized)

    def test_unadopted_concepts_do_not_become_formal_asset_relations(self):
        graph=self.graph();nodes={n['id']:n for n in graph['entities']}
        for edge in graph['relationships']:
            if edge['type'] in {'depends_on','requires','has_source'}:
                self.assertNotEqual('MetricConcept',nodes[edge['source']]['type'])


if __name__=='__main__': unittest.main()
