"""Build an explicitly selected, isolated SC-01S snapshot. No Host/Pi wiring."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re

from .authority import NativeAuthority
from .graph_constraints import validate_graph
from .identity import ref_identity
from .readmodel import SnapshotError, SnapshotStore
from .sc01s import METRICS, make_sc01s_graph


def _digest(raw):
    return hashlib.sha256(raw).hexdigest()


def _freeze_bytes(run,key,raw,nature,suffix='.json'):
    digest=_digest(raw); relative=f'inputs/{key}-{digest}{suffix}'; target=run/relative
    if target.exists():
        if target.is_symlink() or target.stat().st_nlink!=1 or target.read_bytes()!=raw:
            raise SnapshotError('input-conflict')
    else:
        with target.open('xb') as stream: stream.write(raw)
    return {'inputKey':key,'relativePath':relative,'sha256':digest,'bytes':len(raw),'nature':nature}


def _freeze(run,key,value,nature):
    """Freeze an explicitly labelled engineering projection, never source bytes."""
    raw=(json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode('utf8')
    return _freeze_bytes(run,key,raw,nature)


def scene_refs(run,enterprise_ref=None):
    a=json.loads((run/'evidence/initial-asset-receipt.json').read_text())
    m=json.loads((run/'evidence/initial-m2-receipt.json').read_text())
    return {'metrics':[{'kind':'sap',**r} for r in a['refs']['metrics']], 'method':a['refs']['method'],
            'enterprise':enterprise_ref or {'kind':'enterprise',**m['conceptRef']},
            'input':{'kind':'data-input',**{k:m[k] for k in ['projectId','datasetId','inputVersionId']}},
            'description':{'kind':'data-description',**{k:m[k] for k in ['projectId','datasetId','inputVersionId','descriptionRevisionId']}}}


def _plain_root(value):
    """Explicit trusted roots still cannot hide links or lexical traversal."""
    path=Path(value)
    if not path.is_absolute() or path != path.resolve():
        raise SnapshotError('unsafe-build-root')
    if any(p.is_symlink() or not p.is_dir() for p in [path,*path.parents]):
        raise SnapshotError('unsafe-build-root')
    return path


def _exact_refs(value):
    refs=copy.deepcopy(value)
    if not isinstance(refs,dict) or set(refs)!={'metrics','method','enterprise','input','description'}:
        raise SnapshotError('invalid-build-refs')
    metrics=refs['metrics']
    if (not isinstance(metrics,list) or len(metrics)!=3
            or any(not isinstance(r,dict) or r.get('kind')!='sap' for r in metrics)
            or {r.get('metricName') for r in metrics}!=set(METRICS.values())):
        raise SnapshotError('invalid-build-refs')
    if len({(r.get('packageId'),r.get('version')) for r in metrics})!=1:
        raise SnapshotError('inconsistent-metric-publication')
    refs['metrics']=[next(r for r in metrics if r['metricName']==name) for name in METRICS.values()]
    for key,kind in [('method','sap-method'),('enterprise','enterprise'),('input','data-input'),('description','data-description')]:
        if not isinstance(refs[key],dict) or refs[key].get('kind')!=kind:
            raise SnapshotError('invalid-build-refs')
    for ref in refs['metrics']+[refs[k] for k in ['method','enterprise','input','description']]:
        ref_identity(ref)
    if any(refs['input'][k]!=refs['description'][k] for k in ['projectId','datasetId','inputVersionId']):
        raise SnapshotError('source-binding-mismatch')
    return refs


def _checked_bytes(raw,expected,code):
    if (not isinstance(raw,bytes) or not isinstance(expected,str)
            or not re.fullmatch('[a-f0-9]{64}',expected) or _digest(raw)!=expected):
        raise SnapshotError(code)
    return raw


def _has_control_values(value):
    if isinstance(value,dict):
        return 'synthetic_net_controls' in value or any(_has_control_values(v) for v in value.values())
    return isinstance(value,list) and any(_has_control_values(v) for v in value)


def build_scene(run_root,repo_root,*,enterprise_ref=None,label='scene-v1',
                approved_run_root=None,source_root=None,data_root=None,projects_root=None,refs=None,
                metric_excerpt_bytes=None,metric_excerpt_sha256=None,
                analysis_input_bytes=None,analysis_input_sha256=None):
    """Build offline from original Stores; explicit arguments are Host-only.

    The all-or-none explicit seam supports independent S5 roots and actual
    published refs. Omission preserves the fixed S3 engineering CLI contract.
    It never selects a latest revision, strips input bytes or opens a Host.
    """
    explicit=[approved_run_root,source_root,data_root,projects_root,refs,metric_excerpt_bytes,
              metric_excerpt_sha256,analysis_input_bytes,analysis_input_sha256]
    selected=any(v is not None for v in explicit)
    repo=Path(repo_root).resolve()
    if selected:
        if any(v is None for v in explicit) or enterprise_ref is not None:
            raise SnapshotError('incomplete-explicit-build')
        run=_plain_root(run_root);permitted=_plain_root(approved_run_root)
        source=_plain_root(source_root);data=_plain_root(data_root);projects=_plain_root(projects_root)
        refs=_exact_refs(refs)
        excerpt_raw=_checked_bytes(metric_excerpt_bytes,metric_excerpt_sha256,'excerpt-input-changed')
        synthetic_raw=_checked_bytes(analysis_input_bytes,analysis_input_sha256,'synthetic-input-changed')
    else:
        run=Path(run_root).resolve();permitted=repo/'.local/fourbase-l2-s3/sc01s-v0.1'
        if not run.is_relative_to(permitted) or run==permitted or not run.name.startswith('run-'):
            raise SnapshotError('run-outside-approved-root')
        source=run/'source';data=run/'asset-root';projects=run/'projects-root'
        refs=scene_refs(run,enterprise_ref)
        base=repo/'openspec/changes/fourbase-l2-rollout'
        excerpt_raw=_checked_bytes((base/'data/metric-candidates.v0.1.json').read_bytes(),
                                  'f5e5665c9d4fa9d9dc9dfebf077322e4ab503f5c6813933cf3ee0305c5d88275','excerpt-input-changed')
        synthetic_raw=_checked_bytes((base/'data/sc01-synthetic-v0.1/input.json').read_bytes(),
                                    'ec996f92bed8c18b5a9809760827a59ddde85d115ad905df96a3dfac7f63372d','synthetic-input-changed')
    if not run.is_relative_to(permitted) or run==permitted or (not selected and not run.name.startswith('run-')):
        raise SnapshotError('run-outside-approved-root')
    if not isinstance(label,str) or not re.fullmatch('[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}',label):
        raise SnapshotError('invalid-build-label')
    documents={'metric-excerpt':json.loads(excerpt_raw),'synthetic-input':json.loads(synthetic_raw)}
    if selected and _has_control_values(documents['synthetic-input']):
        raise SnapshotError('analysis-input-contains-controls')
    authority=NativeAuthority(source,data,projects)
    ordered=refs['metrics']+[refs['method'],refs['enterprise'],refs['input'],refs['description']]
    reads=authority.read_many(ordered)
    if len(reads)!=len(ordered) or any(r.get('state')!='available' or 'payload' not in r for r in reads):
        raise SnapshotError('source-unavailable')
    assets={'metric_document':reads[0]['payload']['document'],'method':reads[3]['payload']['version'],
            'enterprise':reads[4]['payload']['revision'],'input':reads[5]['payload'],'description':reads[6]['payload']}
    if (assets['input']['sha256']!=_digest(synthetic_raw) or assets['input']['bytes']!=len(synthetic_raw)
            or excerpt_raw.decode().strip() not in assets['enterprise']['body']):
        raise SnapshotError('source-binding-mismatch')
    store=SnapshotStore(run,authority)
    source_bytes=SnapshotStore(data,authority)
    store._directory(run/'inputs')
    # Keep immutable original bytes. A parsed SAP document and the composite
    # enterprise API response are additional engineering views for JSON locators;
    # neither is mislabelled as an original publication file.
    metric_ref=refs['metrics'][0];method_ref=refs['method'];input_ref=refs['input']
    metric_raw=source_bytes._read(data/'metric-assets'/metric_ref['packageId']/(metric_ref['version']+'.sap.yaml'))
    body_raw=source_bytes._read(Path(assets['enterprise']['bodyPath']))
    if (any(metric_raw!=r['payload']['canonicalYaml'].encode('utf8') or _digest(metric_raw)!=r['observedHash'] for r in reads[:3])
            or body_raw.decode('utf8')!=assets['enterprise']['body']
            or _digest(body_raw)!=assets['enterprise']['bodySha256']):
        raise SnapshotError('source-byte-binding-mismatch')
    dataset=data/'projects'/input_ref['projectId']/'data-context/datasets'/input_ref['datasetId']
    if source_bytes._read(data/'projects'/input_ref['projectId']/'data-context'/assets['input']['evidencePath'])!=synthetic_raw:
        raise SnapshotError('source-byte-binding-mismatch')
    native_records={
        'method-publication':(data/'metric-assets/methods'/method_ref['methodId']/'versions'/(str(method_ref['version'])+'.json'),assets['method']),
        'input-version':(dataset/'versions'/input_ref['inputVersionId']/'record.json',assets['input']),
        'm2-description':(dataset/'descriptions'/(refs['description']['descriptionRevisionId']+'.json'),assets['description'])}
    inputs=[]
    for key,(path,expected) in native_records.items():
        raw=source_bytes._read(path)
        if json.loads(raw)!=expected: raise SnapshotError('source-byte-binding-mismatch')
        inputs.append(_freeze_bytes(run,key,raw,'asset-publication'))
    inputs += [
        _freeze(run,'metric-publication',assets['metric_document'],'engineering-design'),
        _freeze(run,'enterprise-revision',assets['enterprise'],'engineering-design'),
        _freeze_bytes(run,'metric-publication-bytes',metric_raw,'asset-publication','.yaml'),
        _freeze_bytes(run,'enterprise-body',body_raw,'asset-publication','.txt'),
        _freeze_bytes(run,'metric-excerpt',excerpt_raw,'deidentified-source'),
        _freeze_bytes(run,'synthetic-input',synthetic_raw,'synthetic-data')]
    input_identities={x['inputKey']:x['sha256'] for x in inputs}
    graph=make_sc01s_graph(refs,assets,documents,input_identities)
    constraints=validate_graph(graph['entities'],graph['relationships'],metric_refs=refs['metrics'])
    for key in ['rdf_turtle','shacl_turtle']:
        (run/'evidence'/f'{label}-{key}.ttl').write_text(constraints[key])
    (run/'evidence'/f'{label}-constraints.json').write_text(json.dumps({k:v for k,v in constraints.items() if k not in ['rdf_turtle','shacl_turtle']},ensure_ascii=False,indent=2)+'\n')
    if not constraints['conforms']: raise SnapshotError('actual-graph-constraints-failed')
    # The ontology derives from this same semantic graph, with explicit settings.
    from semantica.ontology.engine import OntologyEngine
    ontology=OntologyEngine(base_uri='https://example.invalid/optracall/sc01s/',min_occurrences=1).from_data(
        {'entities':copy.deepcopy(graph['entities']),'relationships':copy.deepcopy(graph['relationships'])},
        name='SC01SActualAssetOntology',min_occurrences=1,build_hierarchy=False)
    snapshot_id=store.write(graph['entities'],graph['relationships'],ontology,inputs)
    result={'scope':('S5 explicit isolated' if selected else 'S3 isolated')+' actual-asset derived graph; not product adoption or model analysis',
            'snapshotId':snapshot_id,'refs':refs,'keys':graph['keys'],'counts':{'nodes':len(graph['entities']),'edges':len(graph['relationships'])},
            'inputIdentities':inputs,'ontology_classes':[c.get('name') for c in ontology.get('classes',[])],
            'constraints':{k:v for k,v in constraints.items() if k not in ['rdf_turtle','shacl_turtle']}}
    (run/'evidence'/f'{label}-build.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run',required=True);parser.add_argument('--repo',required=True)
    args=parser.parse_args();result=build_scene(args.run,args.repo)
    print(json.dumps({k:result[k] for k in ['snapshotId','counts','ontology_classes']},ensure_ascii=False,indent=2))


if __name__=='__main__':main()
