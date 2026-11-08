"""Real one-shot Python process and Host-only authority JSON-lines protocol."""
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

from scripts.fourbase_l2.identity import canonical

REPO = Path(__file__).resolve().parents[2]
FIXTURE = Path(os.environ['FOURBASE_L2_AUTHORITY_RUN']) if os.environ.get('FOURBASE_L2_AUTHORITY_RUN') else REPO / '.local/fourbase-l2-s3/sc01s-v0.1/run-s3-fixture-s4'


class WorkerTests(unittest.TestCase):
    def invoke(self, command, state='available'):
        process = subprocess.Popen([sys.executable, '-m', 'scripts.fourbase_l2.worker'], cwd=REPO,
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        self.addCleanup(lambda: process.kill() if process.poll() is None else None)
        process.stdin.write(json.dumps(command) + '\n'); process.stdin.flush()
        requests, final = [], None
        for line in process.stdout:
            message = json.loads(line)
            if message['type'] != 'authority':
                final = message
                if final['type'] == 'result':
                    process.stdin.write(json.dumps({'type': 'finish'}) + '\n'); process.stdin.flush()
                break
            requests.append(message)
            process.stdin.write(json.dumps({'type': 'authority-result', 'id': message['id'], 'results': [
                {'state': state, 'gaps': [] if r.get('publishedHash') else ['hash-not-declared']} for r in message['refs']]}) + '\n')
            process.stdin.flush()
        process.stdin.close()
        process.wait(timeout=30)
        stderr = process.stderr.read()
        process.stdout.close(); process.stderr.close()
        return process.returncode, requests, final, stderr

    def command(self):
        build = json.loads((FIXTURE / 'evidence/scene-v2-corrected-build.json').read_text())
        return {'type': 'query', 'runRoot': str(FIXTURE), 'snapshotId': build['snapshotId'],
                'query': {'action': 'graph', 'operation': 'definition', 'nodeId': build['keys']['C04']}}

    def test_native_load_and_query_use_only_host_proxy_and_keep_internal_current_refs(self):
        code, requests, final, stderr = self.invoke(self.command())
        self.assertEqual(code, 0)
        self.assertGreaterEqual(len(requests), 2)
        self.assertEqual(stderr, '')
        self.assertEqual(final['type'], 'result')
        result = final['result']
        self.assertEqual(len(result['nodes']), 1)
        self.assertEqual(result['snapshot']['componentVersion'], '0.7.0')
        self.assertEqual(len(result['inputFingerprint']), 64)
        self.assertEqual(len(result['receiptSha256']), 64)
        self.assertNotIn('depthLimit', result)
        self.assertEqual({canonical(r) for r in result['currentRefs']}, {canonical(r) for request in requests for r in request['refs']})
        self.assertNotIn('runRoot', json.dumps(result))
        self.assertNotIn('relativePath', json.dumps(result))

    def test_disabled_qualifiers_never_return_filtered_identity_or_body(self):
        code, requests, final, stderr = self.invoke(self.command(), 'disabled')
        self.assertEqual(code, 0)
        self.assertTrue(requests)
        self.assertEqual(final['result']['nodes'], [])
        self.assertEqual(final['result']['state'], 'partial')
        self.assertTrue(final['result']['currentRefs'])
        self.assertEqual(stderr, '')

    def test_unlisted_fields_and_invalid_operation_are_rejected_without_authority(self):
        for mutate in [lambda c: c.update(projectsRoot='/private/not-allowed'), lambda c: c['query'].update(code='read arbitrary'),
                       lambda c: c['query'].update(operation='cypher'), lambda c: c['query'].update(depth=True),
                       lambda c: c['query'].update(nodeId='x\0y')]:
            command = self.command(); mutate(command)
            with self.subTest(command=command):
                code, requests, final, stderr = self.invoke(command)
                self.assertNotEqual(code, 0)
                self.assertEqual(requests, [])
                self.assertEqual(final, {'type': 'error', 'code': 'invalid_query_request'})
                self.assertEqual(stderr, '')

    def test_wrong_snapshot_has_bounded_failure_and_no_traceback_or_paths(self):
        command = self.command(); command['snapshotId'] = 'not-a-uuid'
        code, requests, final, stderr = self.invoke(command)
        self.assertNotEqual(code, 0)
        self.assertEqual(requests, [])
        self.assertEqual(final, {'type': 'error', 'code': 'invalid_snapshot_id'})
        self.assertEqual(stderr, '')
