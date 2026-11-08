"""D12 source admission through actual Stores in an isolated SC-01S copy.

Set FOURBASE_L2_AUTHORITY_RUN to the authorized run containing source,
asset-root, projects-root and tmp. No active product root is consulted.
"""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.fourbase_l2.authority import NativeAuthority


class NativeAuthorityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        value = os.environ.get('FOURBASE_L2_AUTHORITY_RUN')
        if not value:
            raise unittest.SkipTest('explicit isolated FOURBASE_L2_AUTHORITY_RUN required')
        cls.run_root = Path(value).absolute()
        cls.source = cls.run_root / 'source'

    def setUp(self):
        self.copy = Path(tempfile.mkdtemp(prefix='authority-test-', dir=self.run_root / 'tmp'))
        self.data = self.copy / 'asset-root'
        self.projects = self.copy / 'projects-root'
        shutil.copytree(self.run_root / 'asset-root', self.data)
        shutil.copytree(self.run_root / 'projects-root', self.projects)
        self.authority = NativeAuthority(self.source, self.data, self.projects)
        entry = json.loads((self.data / 'metric-assets/index.json').read_text())['entries'][0]
        self.sap = dict(kind='sap', packageId=entry['id'], version=entry['version'],
                        metricName='net_retail_sales', publishedHash=entry['bytesSha256'])
        method = json.loads((self.data / 'metric-assets/methods/index.json').read_text())['methods'][0]
        publication = method['publications'][0]
        self.method = dict(kind='sap-method', methodId=method['id'], version=publication['version'],
                           publishedHash=publication['contentSha256'])
        enterprise = json.loads((self.data / 'enterprise-business-materials/index.json').read_text())
        material = enterprise['materials'][0]
        self.enterprise = dict(kind='enterprise', storeId=enterprise['storeId'],
                               materialId=material['id'], revisionId=material['revisions'][0]['revisionId'])
        project = next((self.data / 'projects').iterdir())
        index = json.loads((project / 'data-context/index.json').read_text())
        dataset = index['datasets'][0]
        self.input = dict(kind='data-input', projectId=project.name, datasetId=dataset['datasetId'],
                          inputVersionId=dataset['versions'][0]['inputVersionId'])
        self.description = dict(self.input, kind='data-description',
                                descriptionRevisionId=dataset['descriptions'][0]['descriptionRevisionId'])

    def native(self, program):
        """Mutate only this test's copy via original Store APIs."""
        script = self.copy / ('native-' + str(uuid.uuid4()) + '.mjs')
        script.write_text(
            "import {pathToFileURL} from 'node:url';\n"
            f"const source={json.dumps(str(self.source))};\n"
            f"const data={json.dumps(str(self.data))};\n"
            f"const projectsRoot={json.dumps(str(self.projects))};\n"
            "const load=async p=>import(pathToFileURL(source+'/'+p));\n" + program)
        result = subprocess.run(['/opt/homebrew/bin/node', str(script)], capture_output=True,
                                text=True, timeout=30, check=True)
        return json.loads(result.stdout) if result.stdout.strip() else None

    def test_exact_versions_hashes_and_nullable_hash_keep_original_refs(self):
        missing = dict(self.sap, version='99.0.0')
        conflict = dict(self.sap, publishedHash='0' * 64)
        null = dict(self.sap, publishedHash=None)
        omitted = {key: value for key, value in self.sap.items() if key != 'publishedHash'}
        refs = [self.sap, missing, null, omitted]
        values = self.authority.check_many(refs)
        self.assertEqual([v['state'] for v in values],
                         ['available', 'missing', 'available', 'available'])
        self.assertEqual([v['ref'] for v in values], refs)
        self.assertIn('missing-hash', values[2]['gaps'])
        self.assertEqual(values[0]['observedHash'], self.sap['publishedHash'])
        self.assertEqual(self.authority.check(conflict)['state'], 'hash-conflict')
        group = self.authority.check_many([self.sap, conflict, null])
        self.assertTrue(all(item['state'] == 'hash-conflict' for item in group))
        payload = self.authority.read(self.sap)['payload']
        self.assertEqual(payload['metric']['name'], 'net_retail_sales')
        self.assertEqual(payload['document']['package']['version'], '0.1.0')
        self.assertEqual(hashlib.sha256(payload['canonicalYaml'].encode()).hexdigest(), self.sap['publishedHash'])

    def test_disabled_and_reenabled_sources_are_checked_again_without_cached_governance(self):
        self.assertEqual(self.authority.check(self.enterprise)['state'], 'available')
        self.native(f"const {{EnterpriseMaterialsStore}}=await load('src/host/enterprise-materials-store.ts');\n"
                    f"const s=new EnterpriseMaterialsStore(data); const d=await s.get('{self.enterprise['materialId']}');\n"
                    "await s.disable(d.material.id,d.material.version);\n")
        denied = self.authority.read_many([self.enterprise, self.description, self.input])
        self.assertEqual([v['state'] for v in denied], ['disabled', 'disabled', 'available'])
        self.assertTrue(all('payload' not in item for item in denied[:2]))
        self.native(f"const {{EnterpriseMaterialsStore}}=await load('src/host/enterprise-materials-store.ts');\n"
                    f"const s=new EnterpriseMaterialsStore(data); const d=await s.get('{self.enterprise['materialId']}');\n"
                    f"await s.enable(d.material.id,d.material.version,'{self.enterprise['revisionId']}');\n")
        self.assertEqual(self.authority.check(self.description)['state'], 'available')

    def test_confirmed_method_is_excluded_but_original_exact_history_remains(self):
        omitted = {key: value for key, value in self.method.items() if key != 'publishedHash'}
        refs = [self.method, dict(self.method, version=999),
                dict(self.method, publishedHash=None), omitted]
        values = self.authority.check_many(refs)
        self.assertEqual([v['state'] for v in values],
                         ['available', 'missing', 'available', 'available'])
        self.assertIn('missing-hash', values[-1]['gaps'])
        self.assertEqual(self.authority.check(dict(self.method, publishedHash='0' * 64))['state'], 'hash-conflict')
        prior = self.authority.read(self.method)['payload']
        self.native(f"const {{createSapMethodStore}}=await load('extensions/business-plugins/metric-factory/methods/store.ts');\n"
                    f"const s=createSapMethodStore(data+'/metric-assets'); s.markIssue('{self.method['methodId']}',"
                    f"{{requestId:'{uuid.uuid4()}',version:1,expectedRevision:0,status:'confirmed',note:'synthetic governance regression'}});\n")
        denied = self.authority.read(self.method)
        self.assertEqual(denied['state'], 'excluded')
        self.assertNotIn('payload', denied)
        history = self.native(f"const {{createSapMethodStore}}=await load('extensions/business-plugins/metric-factory/methods/store.ts');\n"
                              f"console.log(JSON.stringify(createSapMethodStore(data+'/metric-assets').getPublished('{self.method['methodId']}',1)));\n")
        self.assertEqual(history['version'], prior['version'])
        self.assertEqual(history['issue']['status'], 'confirmed')

    def test_exact_m2_payload_and_field_refs_and_input_version_mismatch(self):
        records = self.authority.read_many([self.input, self.description])
        self.assertEqual([item['state'] for item in records], ['available', 'available'])
        self.assertEqual(records[0]['payload']['inputVersionId'], self.input['inputVersionId'])
        description = records[1]['payload']
        self.assertEqual(description['descriptionRevisionId'], self.description['descriptionRevisionId'])
        self.assertTrue(any(mapping['sapRefs'] for mapping in description['mappings']))
        self.assertTrue(any(mapping['conceptRefs'] for mapping in description['mappings']))
        self.assertTrue(any(mapping['location']['kind'] == 'json-pointer' for mapping in description['mappings']))
        wrong = dict(self.description, inputVersionId=str(uuid.uuid4()))
        missing = dict(self.description, descriptionRevisionId=str(uuid.uuid4()))
        self.assertEqual(self.authority.check(wrong)['state'], 'unknown')
        self.assertEqual(self.authority.check(missing)['state'], 'missing')

    def test_invalid_location_unsupported_and_insufficient_ref_never_supply_payload(self):
        refs = [dict(self.enterprise, location=dict(start=0, end=10 ** 8)),
                dict(self.enterprise, storeId=str(uuid.uuid4())),
                dict(self.sap, metricName='unknown_metric'),
                {key: value for key, value in self.sap.items() if key != 'version'},
                {'kind': 'source'}, None]
        values = self.authority.read_many(refs)
        self.assertTrue(all(item['state'] != 'available' for item in values))
        self.assertTrue(all('payload' not in item for item in values))

    def test_known_wrong_hash_alone_is_rejected(self):
        self.assertEqual(self.authority.check(dict(self.sap, publishedHash='0' * 64))['state'], 'hash-conflict')

    def test_method_empty_string_hash_is_invalid_and_never_supplies_payload(self):
        ref = dict(self.method, publishedHash='')
        result = self.authority.read(ref)
        self.assertEqual(result['state'], 'unknown')
        self.assertIn('native-authority-invalid-published-hash', result['gaps'])
        self.assertNotIn('payload', result)
        self.assertEqual(result['ref'], ref)

    def test_read_operations_preserve_original_authorities_and_refuse_schema_migration(self):
        def manifest():
            return {str(path.relative_to(self.copy)): hashlib.sha256(path.read_bytes()).hexdigest()
                    for root in [self.data, self.projects] for path in root.rglob('*') if path.is_file()}
        before = manifest()
        values = self.authority.read_many([self.sap, self.method, self.enterprise, self.input, self.description])
        self.assertTrue(all(value['state'] == 'available' for value in values))
        self.assertEqual(manifest(), before)
        project_file = self.data / 'projects' / self.input['projectId'] / 'project.json'
        metadata = json.loads(project_file.read_text())
        metadata['rootPath'] = '/not-an-authorized-root/never-read'
        project_file.write_text(json.dumps(metadata))
        self.assertEqual(self.authority.check(self.input)['state'], 'available')
        metadata['schemaVersion'] = 1
        project_file.write_text(json.dumps(metadata))
        before_migration = manifest()
        denied = self.authority.read(self.input)
        self.assertEqual(denied['state'], 'unknown')
        self.assertIn('native-authority-project-migration-refused', denied['gaps'])
        self.assertEqual(manifest(), before_migration)

    def test_native_corrupt_source_and_symlink_cannot_be_supplied(self):
        source = self.data / 'metric-assets' / self.sap['packageId'] / (self.sap['version'] + '.sap.yaml')
        original = source.read_bytes()
        source.write_bytes(original.replace(b'net_retail_sales', b'net_retail_salez', 1))
        self.assertNotEqual(self.authority.read(self.sap)['state'], 'available')
        source.write_bytes(original)
        source.unlink()
        source.symlink_to(self.projects / self.input['projectId'] / '020_clean/input.json')
        denied = self.authority.read(self.sap)
        self.assertNotEqual(denied['state'], 'available')
        self.assertNotIn('payload', denied)


if __name__ == '__main__':
    unittest.main()
