"""Exact native source bytes in a newly built, copied SC-01S run."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from fourbase_l2.build_sc01s import build_scene


class NativeSceneByteTests(unittest.TestCase):
    def test_actual_build_keeps_original_record_bytes_and_labels_projections(self):
        value = os.environ.get('FOURBASE_L2_AUTHORITY_RUN')
        if not value:
            self.skipTest('explicit isolated FOURBASE_L2_AUTHORITY_RUN required')
        original = Path(value)
        repo = Path(__file__).resolve().parents[2]
        isolated = os.environ.get('FOURBASE_L2_S5_TEST_ROOT')
        if isolated:
            # Exercise the unchanged legacy API in its original directory
            # layout, entirely inside the authorized system temporary root.
            fixed_repo = repo
            repo = Path(tempfile.mkdtemp(prefix='legacy-builder-repo-', dir=isolated))
            scene = Path('openspec/changes/fourbase-l2-rollout')
            for name in ['data/metric-candidates.v0.1.json', 'data/sc01-synthetic-v0.1/input.json']:
                target = repo / scene / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(fixed_repo / scene / name, target)
            approved = repo / '.local/fourbase-l2-s3/sc01s-v0.1'
            approved.mkdir(parents=True)
            run = Path(tempfile.mkdtemp(prefix='run-byte-copy-', dir=approved))
        else:
            run = Path(tempfile.mkdtemp(prefix='run-byte-copy-', dir=original / 'tmp'))
        for name in ['source', 'asset-root', 'projects-root']:
            shutil.copytree(original / name, run / name)
        for name in ['inputs', 'evidence', 'tmp']:
            (run / name).mkdir()
        for name in ['initial-asset-receipt.json', 'initial-m2-receipt.json']:
            shutil.copy2(original / 'evidence' / name, run / 'evidence' / name)
        result = build_scene(run, repo, label='byte-copy-test')
        receipt = json.loads((run / 'snapshots' / result['snapshotId'] / 'receipt.json').read_text())
        hashes = {item['sha256'] for item in receipt['inputs']}
        refs = result['refs']
        sap = refs['metrics'][0]
        method = refs['method']
        enterprise = refs['enterprise']
        data = run / 'asset-root'
        enterprise_index = json.loads((data / 'enterprise-business-materials/index.json').read_text())
        material = next(m for m in enterprise_index['materials'] if m['id'] == enterprise['materialId'])
        revision = next(r for r in material['revisions'] if r['revisionId'] == enterprise['revisionId'])
        dataset = data / 'projects' / refs['input']['projectId'] / 'data-context/datasets' / refs['input']['datasetId']
        files = [
            data / 'metric-assets' / sap['packageId'] / (sap['version'] + '.sap.yaml'),
            data / 'metric-assets/methods' / method['methodId'] / 'versions' / (str(method['version']) + '.json'),
            data / 'enterprise-business-materials/bodies' / (revision['bodyFileId'] + '.txt'),
            dataset / 'versions' / refs['input']['inputVersionId'] / 'record.json',
            dataset / 'descriptions' / (refs['description']['descriptionRevisionId'] + '.json'),
            repo / 'openspec/changes/fourbase-l2-rollout/data/metric-candidates.v0.1.json',
            repo / 'openspec/changes/fourbase-l2-rollout/data/sc01-synthetic-v0.1/input.json',
        ]
        for file in files:
            with self.subTest(original=file.name):
                self.assertIn(hashlib.sha256(file.read_bytes()).hexdigest(), hashes,
                              'receipt must freeze the exact original source bytes')
        items = {item['inputKey']: item for item in receipt['inputs']}
        self.assertEqual(items['metric-publication']['nature'], 'engineering-design')
        self.assertEqual(items['enterprise-revision']['nature'], 'engineering-design')


if __name__ == '__main__':
    unittest.main()
