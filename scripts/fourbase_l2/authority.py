"""S3 engineering reads of original Stores, with no Host or Agent runtime.

Each operation starts one bounded Node process and rechecks current governance.
The timeout is an engineering probe bound, not an Agent execution policy.
"""

import json
from pathlib import Path
import subprocess


class NativeAuthority:
    def __init__(self, source_root, data_root, projects_root, node_binary='/opt/homebrew/bin/node'):
        self.source_root = str(Path(source_root).absolute())
        self.data_root = str(Path(data_root).absolute())
        self.projects_root = str(Path(projects_root).absolute())
        self.node_binary = str(node_binary)

    def _invoke(self, refs, action):
        refs = list(refs)
        if not refs:
            return []

        def unavailable(code):
            return [{'ref': ref, 'state': 'unknown', 'gaps': [code]} for ref in refs]

        request = {'sourceRoot': self.source_root, 'dataRoot': self.data_root,
                   'projectsRoot': self.projects_root, 'action': action, 'refs': refs}
        try:
            raw = json.dumps(request, ensure_ascii=False, allow_nan=False)
        except (ValueError, TypeError):
            return unavailable('native-authority-invalid-ref')
        if len(refs) > 4096 or len(raw.encode('utf-8')) > 16 * 1024 * 1024:
            return unavailable('native-authority-request-limit')
        try:
            process = subprocess.run(
                [self.node_binary, str(Path(__file__).with_suffix('.mjs'))], input=raw,
                capture_output=True, text=True, timeout=30, check=False,
                env={'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'NODE_NO_WARNINGS': '1'},
            )
        except subprocess.TimeoutExpired:
            return unavailable('native-authority-timeout')
        except OSError:
            return unavailable('native-authority-process-unavailable')
        if process.returncode != 0:
            return unavailable('native-authority-process-failed')
        try:
            if len(process.stdout.encode('utf-8')) > 64 * 1024 * 1024:
                return unavailable('native-authority-response-limit')
            values = json.loads(process.stdout)
            if not isinstance(values, list) or len(values) != len(refs):
                raise ValueError('invalid batch')
            for ref, item in zip(refs, values):
                if (not isinstance(item, dict) or item.get('ref') != ref
                        or item.get('state') not in {'available', 'disabled', 'missing', 'hash-conflict', 'excluded', 'unknown'}
                        or not isinstance(item.get('gaps'), list)
                        or not all(isinstance(gap, str) for gap in item['gaps'])
                        or (item['state'] != 'available' and 'payload' in item)
                        or (action == 'read' and item['state'] == 'available' and 'payload' not in item)):
                    raise ValueError('invalid item')
            return values
        except (ValueError, TypeError):
            return unavailable('native-authority-invalid-response')

    def check_many(self, refs):
        return self._invoke(refs, 'check')

    def read_many(self, refs):
        return self._invoke(refs, 'read')

    def check(self, ref):
        return self.check_many([ref])[0]

    def read(self, ref):
        return self.read_many([ref])[0]
