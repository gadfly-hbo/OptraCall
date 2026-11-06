"""One trusted JSON-lines graph query per process; no model execution.

The original Host Stores answer authority messages. This worker receives no
business roots, Node callback, credentials, arbitrary scripts or method names.
"""
import contextlib
import hashlib
import io
import json
import re
import sys
import uuid

from .identity import canonical
from .query import parse_query, query_graph
from .readmodel import SnapshotError, SnapshotStore, _json

MAX_LINE = 256 * 1024


def _read_line(stream):
    line = stream.readline(MAX_LINE + 1)
    if not line or len(line.encode('utf-8')) > MAX_LINE or not line.endswith('\n'):
        raise SnapshotError('invalid_query_protocol')
    try:
        return _json(line.encode('utf-8'))
    except (ValueError, UnicodeError):
        raise SnapshotError('invalid_query_protocol') from None


def _send(stream, value):
    stream.write(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n')
    stream.flush()


class HostAuthorityProxy:
    """Only exact declared Refs reach the trusted Host; no local source reads."""
    def __init__(self, incoming, outgoing):
        self.incoming, self.outgoing = incoming, outgoing
        self.serial = 0
        self.current_refs = {}

    def check_many(self, refs):
        self.serial += 1
        for ref in refs:
            self.current_refs[canonical(ref)] = ref
        _send(self.outgoing, {'type': 'authority', 'id': self.serial, 'refs': refs})
        reply = _read_line(self.incoming)
        if (not isinstance(reply, dict) or set(reply) != {'type', 'id', 'results'}
                or reply['type'] != 'authority-result' or type(reply['id']) is not int
                or reply['id'] != self.serial or not isinstance(reply['results'], list)
                or len(reply['results']) != len(refs)):
            raise SnapshotError('invalid_authority_result')
        for result in reply['results']:
            if (not isinstance(result, dict) or set(result) != {'state', 'gaps'}
                    or result['state'] not in {'available', 'missing', 'hash-conflict', 'forbidden',
                                                'excluded', 'disabled', 'unknown', 'partial', 'known-error'}
                    or not isinstance(result['gaps'], list)
                    or not all(isinstance(gap, str) and 0 < len(gap) <= 200 for gap in result['gaps'])):
                raise SnapshotError('invalid_authority_result')
        return reply['results']


def run(command, incoming, outgoing):
    if (not isinstance(command, dict) or set(command) != {'type', 'runRoot', 'snapshotId', 'query'}
            or command.get('type') != 'query' or not isinstance(command.get('runRoot'), str)
            or not command['runRoot'] or '\0' in command['runRoot']):
        raise SnapshotError('invalid_query_request')
    query = parse_query(command['query'])
    try:
        if str(uuid.UUID(command['snapshotId'])) != command['snapshotId']:
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise SnapshotError('invalid_snapshot_id') from None
    authority = HostAuthorityProxy(incoming, outgoing)
    # Native library diagnostics are deliberately not protocol or error text.
    # Proxy retains the original streams so authority still works inside this
    # redirection. No third-party traceback/body/path can enter model content.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        store = SnapshotStore(command['runRoot'], authority)
        receipt_bytes = store._read(store.run_root / 'snapshots' / command['snapshotId'] / 'receipt.json')
        view = store.load(command['snapshotId'])
        receipt = _json(receipt_bytes)
        result = query_graph(view, query, receipt['inputs'])
        if store._read(store.run_root / 'snapshots' / command['snapshotId'] / 'receipt.json') != receipt_bytes:
            raise SnapshotError('snapshot_changed_during_query')
        for kind in ('graph', 'ontology'):
            record = receipt['files'][kind]
            data = store._read(store.run_root / 'snapshots' / command['snapshotId'] / record['name'])
            if len(data) != record['bytes'] or hashlib.sha256(data).hexdigest() != record['sha256']:
                raise SnapshotError('snapshot_changed_during_query')
    result.update(snapshot={'id': receipt['snapshotId'],
                            'graphSha256': receipt['files']['graph']['sha256'],
                            'ontologySha256': receipt['files']['ontology']['sha256'],
                            'componentVersion': receipt['component']['version']},
                  inputFingerprint=hashlib.sha256(canonical(receipt['inputs']).encode('utf-8')).hexdigest(),
                  receiptSha256=hashlib.sha256(receipt_bytes).hexdigest(),
                  currentRefs=[authority.current_refs[k] for k in sorted(authority.current_refs)])
    return result


def main():
    incoming, outgoing = sys.stdin, sys.stdout
    try:
        result = run(_read_line(incoming), incoming, outgoing)
        _send(outgoing, {'type': 'result', 'result': result})
        # Keep the process-group leader alive while Host removes any
        # descendants. EOF means Host already closed the owned resource.
        line = incoming.readline(MAX_LINE + 1)
        if line and (len(line.encode('utf-8')) > MAX_LINE or _json(line.encode('utf-8')) != {'type': 'finish'}):
            return 1
        return 0
    except SnapshotError as error:
        code = error.code if re.fullmatch('[a-z][a-z0-9_-]{0,100}', error.code) else 'query_failed'
        _send(outgoing, {'type': 'error', 'code': code})
        return 1
    except Exception:
        _send(outgoing, {'type': 'error', 'code': 'query_failed'})
        return 1


if __name__ == '__main__':
    sys.exit(main())
