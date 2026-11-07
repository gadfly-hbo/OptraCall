"""Official Semantica extraction using a Host-owned Pi provider.

No model credentials or direct network provider enter this process. The public
provider registry is the extension seam; candidates still require Agent review.
The ordinary graph query worker remains model-free and unchanged.
"""
import contextlib
import hashlib
import importlib.metadata
import io
import json
import sys

MAX_LINE = 2 * 1024 * 1024


def read_message(stream):
    line = stream.readline(MAX_LINE + 1)
    if not line.endswith('\n') or len(line.encode('utf-8')) > MAX_LINE:
        raise ValueError('invalid_protocol')
    return json.loads(line)


def send(stream, value):
    stream.write(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n')
    stream.flush()


class PiBridge:
    def __init__(self, incoming, outgoing):
        self.incoming, self.outgoing = incoming, outgoing
        self.kind, self.serial, self.calls = 'entities', 0, []

    def complete(self, prompt, schema, format_name):
        self.serial += 1
        record = {'kind': self.kind, 'format': format_name, 'state': 'failed'}
        self.calls.append(record)
        request = {'kind': self.kind, 'format': format_name, 'prompt': prompt}
        if schema is not None:
            request['schema'] = schema
        send(self.outgoing, {'type': 'completion', 'id': self.serial, 'request': request})
        reply = read_message(self.incoming)
        if (not isinstance(reply, dict) or reply.get('type') != 'completion-result'
                or reply.get('id') != self.serial or set(reply) - {'type', 'id', 'result', 'error'}):
            raise ValueError('invalid_protocol')
        if reply.get('error'):
            raise ValueError('pi_completion_failed')
        record['state'] = 'completed'
        return reply.get('result')


def extract(command, bridge):
    if not isinstance(command, dict) or command.get('type') != 'extract' or set(command) != {'type', 'source'}:
        raise ValueError('invalid_request')
    source = command['source']
    if (not isinstance(source, dict) or set(source) - {'id', 'revision', 'sha256', 'text', 'locator', 'ref'}
            or not all(isinstance(source.get(key), str) and source[key] for key in ('id', 'revision', 'sha256', 'text'))
            or len(source['text'].encode('utf-8')) > 256 * 1024
            or hashlib.sha256(source['text'].encode('utf-8')).hexdigest() != source['sha256']):
        raise ValueError('invalid_source')
    if importlib.metadata.version('semantica') != '0.7.0':
        raise ValueError('unsupported_component_version')
    from semantica.semantic_extract.registry import provider_registry
    from semantica.semantic_extract.providers import BaseProvider
    from semantica.semantic_extract.methods import configure_cache, extract_entities_llm, extract_relations_llm
    from semantica.semantic_extract.schemas import RelationsResponse

    class PiProvider(BaseProvider):
        def generate_typed(self, prompt, schema, **_kwargs):
            return schema.model_validate(bridge.complete(prompt, schema.model_json_schema(), 'typed'))

        def generate_structured(self, prompt, **_kwargs):
            return bridge.complete(prompt, RelationsResponse.model_json_schema(), 'structured')

    configure_cache(backend='memory', enabled=False)
    provider_registry.register('optracall_pi', PiProvider)
    failures, entities, relations = [], [], []
    try:
        try:
            entities = extract_entities_llm(source['text'], provider='optracall_pi', model='host-owned-pi',
                                            silent_fail=False, max_text_length=len(source['text']) + 1)
        except Exception:
            failures.append('entities_failed')
        if entities:
            bridge.kind = 'relations'
            try:
                relations = extract_relations_llm(source['text'], entities, provider='optracall_pi', model='host-owned-pi',
                                                  silent_fail=False, max_text_length=len(source['text']) + 1)
            except Exception:
                failures.append('relations_failed')
    finally:
        provider_registry.unregister('optracall_pi')
    provenance = {key: value for key, value in source.items() if key != 'text'}
    entity_candidates = [{'text': entity.text, 'label': entity.label, 'confidence': entity.confidence,
                          'actualMethod': entity.metadata.get('extraction_method', 'unknown'),
                          'source': provenance} for entity in entities]
    relation_candidates = []
    for relation in relations:
        predicate = relation.predicate
        relation_candidates.append({'source': relation.subject.text, 'target': relation.object.text,
                                    'predicate': predicate, 'confidence': relation.confidence,
                                    'actualMethod': relation.metadata.get('extraction_method', 'unknown'),
                                    'weak': predicate.lower() in {'related_to', 'co_occurs', 'cooccurs'},
                                    'provenance': provenance})
    limitations = ['candidate-not-business-fact', 'agent-source-review-required']
    if any(call['format'] == 'structured' for call in bridge.calls):
        limitations.append('official-structured-fallback-attempted')
    if any(call['state'] == 'failed' for call in bridge.calls):
        limitations.append('pi-completion-failure-recorded')
    if not relation_candidates:
        limitations.append('no-relations-returned')
    if any(relation['weak'] for relation in relation_candidates):
        limitations.append('weak-relations-are-clues-only')
    return {'component': {'name': 'semantica', 'version': '0.7.0'}, 'source': provenance,
            'entities': entity_candidates, 'relations': relation_candidates, 'calls': bridge.calls,
            'failures': failures, 'limitations': limitations, 'candidateNeedsReview': True}


def main():
    incoming, outgoing = sys.stdin, sys.stdout
    try:
        command = read_message(incoming)
        bridge = PiBridge(incoming, outgoing)
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = extract(command, bridge)
        send(outgoing, {'type': 'result', 'result': result})
        # Keep our leader owned until Host releases this operation's process group.
        incoming.readline(MAX_LINE + 1)
        return 0
    except Exception:
        send(outgoing, {'type': 'error', 'code': 'extraction_failed'})
        return 1


if __name__ == '__main__':
    sys.exit(main())
