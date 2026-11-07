"""Original Ref grains and source-qualified S3 derived identities.

Validation hashes are assertions, not keys. No Unicode normalization is done.
"""
import hashlib
import json
import math
from decimal import Decimal


def _number(value):
    if not math.isfinite(value):
        raise ValueError('invalid_canonical_number')
    if value == 0:
        return '0'
    rendered = repr(value).lower()
    if 1e-6 <= abs(value) < 1e21:
        rendered = format(Decimal(rendered), 'f')
        return rendered.rstrip('0').rstrip('.') if '.' in rendered else rendered
    if 'e' in rendered:
        mantissa, exponent = rendered.split('e')
        return mantissa.removesuffix('.0') + 'e' + ('+' if int(exponent) >= 0 else '-') + str(abs(int(exponent)))
    return rendered.removesuffix('.0')


def canonical(value):
    """Project-data-context canonical JSON, with JavaScript UTF-16 key order."""
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, str):
        rendered = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
        return ''.join('\\u%04x' % ord(c) if 0xD800 <= ord(c) <= 0xDFFF else c for c in rendered)
    if isinstance(value, int):
        return str(value) if abs(value) <= 9007199254740991 else _number(float(value))
    if isinstance(value, float):
        return _number(value)
    if isinstance(value, (list, tuple)):
        return '[' + ','.join(canonical(v) for v in value) + ']'
    if isinstance(value, dict) and all(isinstance(k, str) for k in value):
        keys = sorted(value, key=lambda k: k.encode('utf-16-be', 'surrogatepass'))
        return '{' + ','.join(canonical(k) + ':' + canonical(value[k]) for k in keys) + '}'
    raise ValueError('invalid_canonical_value')


def ref_identity(ref):
    if not isinstance(ref, dict):
        raise ValueError('invalid_source_ref')
    kind = ref.get('kind')
    fields = {
        'sap': ('packageId', 'version', 'metricName'),
        'sap-method': ('methodId', 'version'),
        'enterprise': ('storeId', 'materialId', 'revisionId'),
        'data-input': ('projectId', 'datasetId', 'inputVersionId'),
        'data-description': ('projectId', 'datasetId', 'inputVersionId', 'descriptionRevisionId'),
        'studio-source': ('systemId', 'assetId', 'version', 'projectId'),
    }.get(kind)
    if fields is None:
        raise ValueError('unsupported_source_ref')
    allowed = {'kind', *fields}
    if kind in ('sap', 'sap-method', 'studio-source'):
        allowed.add('publishedHash')
    if kind == 'enterprise':
        allowed.add('location')
    if set(ref) - allowed:
        raise ValueError('invalid_source_ref_fields')
    for field in fields:
        value = ref.get(field)
        if kind == 'sap-method' and field == 'version':
            if type(value) is not int or value < 1:
                raise ValueError('invalid_method_version')
        elif not isinstance(value, str) or not value:
            raise ValueError('invalid_source_identity')
    known = ref.get('publishedHash')
    if known is not None and (not isinstance(known, str) or len(known) != 64 or any(c not in '0123456789abcdef' for c in known)):
        raise ValueError('invalid_source_hash')
    if 'location' in ref:
        loc = ref['location']
        if (not isinstance(loc, dict) or set(loc) != {'start', 'end'} or
                any(type(loc[k]) is not int for k in loc) or not 0 <= loc['start'] < loc['end']):
            raise ValueError('invalid_source_location')
    return (kind, *(ref[field] for field in fields))


def stable_id(type, payload):
    if not isinstance(type, str) or not type:
        raise ValueError('invalid_identity_type')
    return type + ':' + hashlib.sha256(canonical(payload).encode('utf-8')).hexdigest()


def _sources(refs, buildSources, inputIdentities):
    inputs = ({i['inputKey']: i['sha256'] for i in inputIdentities} if isinstance(inputIdentities, list)
              else {k: v['sha256'] if isinstance(v, dict) else v for k, v in inputIdentities.items()})
    references = {}
    for ref in refs:
        qualified = [ref_identity(ref), ref.get('location')]
        references[canonical(qualified)] = qualified
    builds = {}
    for source in buildSources:
        key = source['inputKey']
        if key not in inputs:
            raise ValueError('unknown_build_input')
        qualified = [key, inputs[key], source['locator']]
        builds[canonical(qualified)] = qualified
    return ([references[k] for k in sorted(references)], [builds[k] for k in sorted(builds)])


def claim_id(type, refs, buildSources, inputIdentities, claimKind, content):
    return stable_id(type, [*_sources(refs, buildSources, inputIdentities), claimKind, content])


def edge_id(source, target, type, metadata, inputIdentities):
    semantics = {k: v for k, v in metadata.items() if k not in ('sourceRefs', 'buildSources')}
    return stable_id('edge', [source, target, type,
                             *_sources(metadata['sourceRefs'], metadata['buildSources'], inputIdentities), semantics])
