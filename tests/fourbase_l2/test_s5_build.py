"""S5 offline builds use exact original Store refs and control-free input bytes.

All mutable fixtures are copies under the explicitly provided S5 test root.
No Host, Agent, Provider or original evidence is opened for mutation.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from fourbase_l2.build_sc01s import build_scene, scene_refs
from fourbase_l2.graph_constraints import validate_graph
from fourbase_l2.readmodel import SnapshotError


PREPARE_INPUT = r"""
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk);
const input=JSON.parse(Buffer.concat(chunks));
const load=relative=>import(pathToFileURL(path.join(input.sourceRoot,relative)).href);
const [{ProjectStore},{ProjectDataContextStore}] = await Promise.all([
  load('src/host/project-store.ts'),load('src/host/project-data-context-store.ts')]);
const projects=new ProjectStore({dataRoot:input.dataRoot,projectsRoot:input.projectsRoot});
await projects.init();
try {
  const old=await projects.get(input.oldProjectId);
  const project=await projects.create({name:'S5 control-free builder fixture',configuration:old.configuration});
  if(project.tasks.length) throw new Error('fixture must have no task');
  const bytes=Buffer.from(input.analysisBase64,'base64');
  await fs.writeFile(path.join(project.rootPath,'020_clean/analysis-view.json'),bytes,{flag:'wx'});
  const datasetId=randomUUID(),inputVersionId=randomUUID(),descriptionRevisionId=randomUUID();
  const store=new ProjectDataContextStore({dataRoot:input.dataRoot,projects});
  const frozen=await store.freezeInput(project.id,{operationId:inputVersionId,datasetId,inputVersionId,
    baseIndexRevision:0,name:'S5 new input',sourcePath:'020_clean/analysis-view.json',
    expectedSha256:createHash('sha256').update(bytes).digest('hex'),expectedBytes:bytes.length});
  const description=await store.saveDescription(project.id,{operationId:descriptionRevisionId,
    datasetId,inputVersionId,descriptionRevisionId,baseIndexRevision:frozen.indexRevision,
    observation:{author:'unknown',format:'json',encoding:'UTF-8',recordRule:null,
      coverage:'unobserved',scannedRows:null,totalRows:null,fields:[],limitations:'Engineering fixture only',
      generatedAt:null,nativeEvidence:null,artifactEvidence:null},statements:[],mappings:[]});
  console.log(JSON.stringify({projectId:project.id,datasetId,inputVersionId,descriptionRevisionId,
    record:frozen.record,description:description.record}));
} finally { await projects.close(); }
"""

PUBLISH_METRICS = r"""
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk);
const input=JSON.parse(Buffer.concat(chunks));
const load=relative=>import(pathToFileURL(path.join(input.sourceRoot,relative)).href);
const [{createMetricLibrary},{parseSapDraft,canonicalSapYaml,preparePublication}] = await Promise.all([
  load('extensions/business-plugins/metric-factory/library/store.ts'),
  load('extensions/business-plugins/metric-factory/sap/validate.ts')]);
const document=parseSapDraft(await fs.readFile(input.original));
document.package.id='s5-test-retail';document.package.namespace='mf.s5-test-retail';
document.package.version=input.version;
document.package.fingerprint='';
document.metrics[0].definition+='；当前观测条件未知，按实际输入声明。';
const entry=createMetricLibrary(path.join(input.dataRoot,'metric-assets')).publish(
  preparePublication(Buffer.from(canonicalSapYaml(document),'utf8')),'S5 copied fixture');
console.log(JSON.stringify(entry));
"""


class ExplicitSceneBuildTests(unittest.TestCase):
    def setUp(self):
        root = os.environ.get('FOURBASE_L2_S5_TEST_ROOT')
        original = os.environ.get('FOURBASE_L2_AUTHORITY_RUN')
        if not root or not original:
            self.skipTest('explicit S5 test root and copied synthetic authority fixture required')
        self.repo = Path(__file__).resolve().parents[2]
        self.original = Path(original)
        self.root = Path(tempfile.mkdtemp(prefix='builder-', dir=Path(root)))
        # These are deliberately siblings, with no S3 naming or initial receipts.
        self.run = self.root / 'derived'
        self.data = self.root / 'store-data'
        self.projects = self.root / 'project-files'
        self.source = self.root / 'fixed-code'
        for target, name in [(self.data, 'asset-root'), (self.projects, 'projects-root'),
                             (self.source, 'source')]:
            shutil.copytree(self.original / name, target)
        for name in ['inputs', 'evidence', 'tmp']:
            (self.run / name).mkdir(parents=True)
        self.refs = scene_refs(self.original)
        source_input = next((self.original / 'inputs').glob('synthetic-input-*.json'))
        sample = json.loads(source_input.read_bytes())
        sample.pop('synthetic_net_controls')
        sample['synthetic_assumptions'] = {'refund_observation_days': 'unknown',
                                           'currency_and_tax_comparability': 'unknown'}
        self.raw = (json.dumps(sample, ensure_ascii=False, indent=2) + '\n').encode('utf8')
        import base64
        process = subprocess.run(['/opt/homebrew/bin/node', '--input-type=module', '-e', PREPARE_INPUT],
            input=json.dumps({'sourceRoot':str(self.source), 'dataRoot':str(self.data),
                'projectsRoot':str(self.projects), 'oldProjectId':self.refs['input']['projectId'],
                'analysisBase64':base64.b64encode(self.raw).decode('ascii')}),
            capture_output=True, text=True, check=True,
            env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin', 'NODE_NO_WARNINGS':'1'}, timeout=30)
        self.prepared = json.loads(process.stdout)
        for key in ['input', 'description']:
            fields = ['projectId', 'datasetId', 'inputVersionId']
            if key == 'description': fields += ['descriptionRevisionId']
            self.refs[key] = {'kind':'data-' + key, **{k:self.prepared[k] for k in fields}}
        self.excerpt = next((self.original / 'inputs').glob('metric-excerpt-*.json')).read_bytes()
        self.options = {'approved_run_root':self.root, 'source_root':self.source,
                        'data_root':self.data, 'projects_root':self.projects, 'refs':self.refs,
                        'metric_excerpt_bytes':self.excerpt,
                        'metric_excerpt_sha256':hashlib.sha256(self.excerpt).hexdigest(),
                        'analysis_input_bytes':self.raw,
                        'analysis_input_sha256':hashlib.sha256(self.raw).hexdigest()}

    def build(self, **changes):
        return build_scene(self.run, self.repo, label='s5-test', **{**self.options, **changes})

    def publish_metrics(self, version='0.2.0'):
        sap = self.refs['metrics'][0]
        process = subprocess.run(['/opt/homebrew/bin/node', '--input-type=module', '-e', PUBLISH_METRICS],
            input=json.dumps({'sourceRoot':str(self.source), 'dataRoot':str(self.data), 'version':version,
                'original':str(self.data / 'metric-assets' / sap['packageId'] / (sap['version'] + '.sap.yaml'))}),
            capture_output=True, text=True, check=True,
            env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin', 'NODE_NO_WARNINGS':'1'}, timeout=30)
        publication = json.loads(process.stdout)
        for ref in self.refs['metrics']:
            ref.update(packageId=publication['id'], version=publication['version'],
                       publishedHash=publication['bytesSha256'])

    def test_new_explicit_roots_and_actual_m2_refs_freeze_nine_inputs(self):
        result = self.build()
        receipt = json.loads((self.run / 'snapshots' / result['snapshotId'] / 'receipt.json').read_text())
        self.assertEqual(len(receipt['inputs']), 9)
        self.assertEqual(sum(i['nature'] == 'engineering-design' for i in receipt['inputs']), 2)
        items = {item['inputKey']:item for item in receipt['inputs']}
        self.assertEqual((self.run / items['synthetic-input']['relativePath']).read_bytes(), self.raw)
        self.assertEqual(result['refs']['input']['inputVersionId'], self.prepared['inputVersionId'])
        self.assertNotEqual(result['refs']['input']['inputVersionId'], scene_refs(self.original)['input']['inputVersionId'])
        self.assertNotIn(b'synthetic_net_controls', self.raw)
        self.assertFalse((self.run / 'evidence/initial-asset-receipt.json').exists())
        self.assertFalse((self.run / 'evidence/initial-m2-receipt.json').exists())
        originals = {
            'method-publication':self.data / 'metric-assets/methods' / self.refs['method']['methodId'] / 'versions' / (str(self.refs['method']['version']) + '.json'),
            'input-version':self.data / 'projects' / self.prepared['projectId'] / 'data-context/datasets' / self.prepared['datasetId'] / 'versions' / self.prepared['inputVersionId'] / 'record.json',
            'm2-description':self.data / 'projects' / self.prepared['projectId'] / 'data-context/datasets' / self.prepared['datasetId'] / 'descriptions' / (self.prepared['descriptionRevisionId'] + '.json'),
            'metric-publication-bytes':self.data / 'metric-assets' / self.refs['metrics'][0]['packageId'] / (self.refs['metrics'][0]['version'] + '.sap.yaml')}
        for key, path in originals.items():
            with self.subTest(original=key):
                self.assertEqual((self.run / items[key]['relativePath']).read_bytes(), path.read_bytes())

    def test_actual_new_publication_is_persisted_and_reopened_by_exact_ref(self):
        self.publish_metrics()
        result = self.build()
        graph = json.loads((self.run / 'snapshots' / result['snapshotId'] / 'graph.json').read_text())
        versions = [n for n in graph['nodes'] if n['type'] == 'MetricVersion']
        self.assertEqual(len(versions), 3)
        for node in versions:
            own = [r for r in node['properties']['sourceRefs'] if r['kind'] == 'sap']
            self.assertEqual(own[0]['packageId'], 's5-test-retail')
            self.assertEqual(own[0]['version'], '0.2.0')

    def test_new_publication_keeps_exact_shacl_source_and_operand_constraints(self):
        self.publish_metrics()
        result = self.build()
        raw = json.loads((self.run / 'snapshots' / result['snapshotId'] / 'graph.json').read_text())
        nodes = [{'id':n['id'], 'type':n['type'], 'content':n['properties']['content'],
                  'metadata':{k:v for k,v in n['properties'].items() if k != 'content'}} for n in raw['nodes']]
        edges = [{'id':e['id'], 'source':e['source_id'], 'target':e['target_id'],
                  'type':e['type'], 'metadata':e['properties']} for e in raw['edges']]
        removed = [e for e in edges if not (e['source'] == result['keys']['method'] and e['target'] == result['keys']['C02'])]
        reversed_operand = copy.deepcopy(edges)
        operand = next(e for e in reversed_operand if e['metadata'].get('operandRole') == 'subtrahend')
        operand['source'], operand['target'] = operand['target'], operand['source']
        for changed in [removed, reversed_operand]:
            self.assertFalse(validate_graph(nodes, changed, metric_refs=self.refs['metrics'])['conforms'])
        wrong_refs = copy.deepcopy(self.refs['metrics'])
        for ref in wrong_refs: ref['version'] = '0.3.0'
        self.assertFalse(validate_graph(nodes, edges, metric_refs=wrong_refs)['conforms'])

    def test_new_publication_hash_is_rechecked_by_original_authority(self):
        self.publish_metrics()
        self.refs['metrics'][0]['publishedHash'] = '0' * 64
        with self.assertRaises(SnapshotError) as caught:
            self.build()
        self.assertEqual(caught.exception.code, 'source-unavailable')
        self.assertEqual(list((self.run / 'inputs').iterdir()), [])

    def test_unknown_observation_does_not_acquire_old_sample_facts(self):
        result = self.build()
        graph = json.loads((self.run / 'snapshots' / result['snapshotId'] / 'graph.json').read_text())
        maturity = next(n for n in graph['nodes'] if n['id'] == result['keys']['real-maturity'])
        assumptions = next(n for n in graph['nodes'] if n['id'] == result['keys']['sample-assumptions'])
        self.assertNotIn('7日', maturity['properties']['content'])
        self.assertEqual(maturity['properties']['conditionState'], 'unknown')
        self.assertEqual(json.loads(assumptions['properties']['content'])['refund_observation_days'], 'unknown')

    def test_native_input_conditions_without_legacy_scope_or_assumptions(self):
        # A legal new input need not use the old open fixture's envelope.
        sample = json.loads(self.raw)
        sample.pop('scope')
        sample.pop('synthetic_assumptions')
        sample['conditions'] = {'refund_observation_days': 'unknown',
                                'currency_and_tax_comparability': 'unknown'}
        raw = (json.dumps(sample, ensure_ascii=False, indent=2) + '\n').encode('utf8')
        import base64
        process = subprocess.run(['/opt/homebrew/bin/node', '--input-type=module', '-e', PREPARE_INPUT],
            input=json.dumps({'sourceRoot':str(self.source), 'dataRoot':str(self.data),
                'projectsRoot':str(self.projects), 'oldProjectId':self.prepared['projectId'],
                'analysisBase64':base64.b64encode(raw).decode('ascii')}),
            capture_output=True, text=True, check=True,
            env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin', 'NODE_NO_WARNINGS':'1'}, timeout=30)
        prepared = json.loads(process.stdout)
        refs = copy.deepcopy(self.refs)
        for key in ['input', 'description']:
            fields = ['projectId', 'datasetId', 'inputVersionId']
            if key == 'description': fields += ['descriptionRevisionId']
            refs[key] = {'kind':'data-' + key, **{k:prepared[k] for k in fields}}
        result = self.build(refs=refs, analysis_input_bytes=raw,
                            analysis_input_sha256=hashlib.sha256(raw).hexdigest())
        graph = json.loads((self.run / 'snapshots' / result['snapshotId'] / 'graph.json').read_text())
        declarations = [n for n in graph['nodes'] if n['type'] == 'Condition' and
                        n['properties']['buildSources'] == [
                            {'inputKey':'synthetic-input','locator':'/conditions'}]]
        self.assertEqual(len(declarations), 2)
        self.assertEqual({key:value for n in declarations
                          for key,value in json.loads(n['properties']['content']).items()},
                         sample['conditions'])
        self.assertTrue(all(n['properties']['conditionState'] == 'stated' for n in declarations))
        self.assertTrue(all(n['properties']['claimKind'] == 'synthetic-assumption' for n in declarations))
        self.assertTrue(all(n['properties']['sourceRefs'] == [refs['input']] for n in declarations))
        scope = next(n for n in graph['nodes'] if n['id'] == result['keys']['sample-scope'])
        self.assertNotIn('scope', json.loads(scope['properties']['content']))

    def test_input_hash_and_actual_native_input_identity_cannot_be_bypassed(self):
        for changed, code in [
            ({'analysis_input_sha256':'0' * 64}, 'synthetic-input-changed'),
            ({'metric_excerpt_sha256':'0' * 64}, 'excerpt-input-changed'),
            ({'analysis_input_bytes':self.raw + b' ',
              'analysis_input_sha256':hashlib.sha256(self.raw + b' ').hexdigest()}, 'source-binding-mismatch')]:
            with self.subTest(code=code), self.assertRaises(SnapshotError) as caught:
                self.build(**changed)
            self.assertEqual(caught.exception.code, code)
        self.assertFalse((self.run / 'snapshots').exists())
        self.assertEqual(list((self.run / 'inputs').iterdir()), [])

    def test_explicit_input_with_controls_is_rejected_without_silent_stripping(self):
        sample = json.loads(self.raw)
        sample['synthetic_net_controls'] = {'unseen-control':123}
        raw = json.dumps(sample).encode('utf8')
        with self.assertRaises(SnapshotError) as caught:
            self.build(analysis_input_bytes=raw, analysis_input_sha256=hashlib.sha256(raw).hexdigest())
        self.assertEqual(caught.exception.code, 'analysis-input-contains-controls')
        self.assertEqual(list((self.run / 'inputs').iterdir()), [])

    def test_partial_configuration_outside_root_and_mixed_version_refs_are_rejected(self):
        mixed = copy.deepcopy(self.refs)
        mixed['metrics'][1]['version'] = '0.9.0'
        for changed, code in [({'data_root':None}, 'incomplete-explicit-build'),
                              ({'approved_run_root':self.source}, 'run-outside-approved-root'),
                              ({'refs':mixed}, 'inconsistent-metric-publication')]:
            with self.subTest(code=code), self.assertRaises(SnapshotError) as caught:
                self.build(**changed)
            self.assertEqual(caught.exception.code, code)
        self.assertFalse((self.run / 'snapshots').exists())

    def test_explicit_root_symlink_is_rejected(self):
        linked = self.root / 'linked-data'
        linked.symlink_to(self.data, target_is_directory=True)
        with self.assertRaises(SnapshotError) as caught:
            self.build(data_root=linked)
        self.assertEqual(caught.exception.code, 'unsafe-build-root')


if __name__ == '__main__':
    unittest.main()
