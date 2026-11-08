"""Explicit S3 acceptance on a selected synthetic run, never a product task."""
import copy
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import networkx as nx
from semantica.kg.path_finder import PathFinder
from fourbase_l2.authority import NativeAuthority
from fourbase_l2.build_sc01s import build_scene, scene_refs
from fourbase_l2.readmodel import SnapshotError, SnapshotStore

run=Path(os.environ['OPTRACALL_S3_RUN']).resolve(); repo=Path(os.environ['OPTRACALL_REPO']).resolve()
assert run.is_relative_to(repo/'.local/fourbase-l2-s3/sc01s-v0.1') and run.name.startswith('run-')
build=json.loads((run/'evidence/scene-v1-a3-build.json').read_text()); sid=build['snapshotId']; keys=build['keys']
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
original={n:sha(run/'snapshots'/sid/n) for n in ['graph.json','ontology.json','receipt.json']}
authority=NativeAuthority(run/'source',run/'asset-root',run/'projects-root')
store=SnapshotStore(run,authority); view=store.load(sid); result=view.query()
assert result['state']=='available',result['gaps']
assert len(result['nodes'])==54 and len(result['edges'])==63
nodes={n['id']:n for n in result['nodes']}; edges=result['edges']; checks={}

checks['Q01_metric_distinction']=all(keys[k] in nodes for k in ['C01','C02','C03','C04']) and keys['C01']!=keys['C02-concept']
deps=[e for e in edges if e['source']==keys['C04'] and e['type']=='depends_on']
checks['Q01_subtraction_operands']={e['metadata'].get('operandRole'):e['target'] for e in deps}=={'minuend':keys['C02'],'subtrahend':keys['C03']}
parallel=[e for e in edges if e['source']==keys['C04'] and e['target']==keys['C04-concept'] and e['type']=='version_of']
checks['Q01_parallel_provenance']=len(parallel)==2 and parallel[0]['id']!=parallel[1]['id'] and parallel[0]['metadata']['claimKind']!=parallel[1]['metadata']['claimKind']
checks['Q02_payment_attribution']='支付' in nodes[keys['C03']]['content'] and 'refund_time' in nodes[keys['field-refunds.refund_time']]['content']
checks['Q02_cutoff_and_unknown']=nodes[keys['real-maturity']]['metadata']['conditionState']=='unknown' and '7日' in nodes[keys['sample-assumptions']]['content']
method=json.loads(nodes[keys['method']]['content'])
checks['Q03_four_method_groups']=set(method['content'])=={'conditions','logic','judgment','limits'}
checks['Q03_requirements_not_satisfied']=nodes[keys['comparability']]['metadata']['conditionState']=='required-not-established' and nodes[keys['real-exceptions']]['metadata']['conditionState']=='unknown'
field_nodes=[n for n in nodes.values() if n['type']=='FieldRole']
pointers={p for n in field_nodes for p in json.loads(n['content'])['pointers']}
checks['Q04_all_exact_field_positions']=len(pointers)==337 and '/refunds/0/order_id' in pointers and '/orders/0/payment_time' in pointers
checks['Q04_net_is_derived']=not any(e['type']=='maps_to' and e['target']==keys['C04'] for e in edges)
checks['Q05_disputed_quantity']=nodes[keys['quantity-dispute']]['metadata']['conditionState']=='disputed' and any(e['type']=='potential_conflict' for e in edges)
checks['Q05_unadopted_dependency_limits']=all(nodes[keys[k+'-not-ready']]['metadata']['conditionState']=='required-not-established' for k in ['C06','C07'])
checks['Q05_channel_denominators']='支付买家数' in nodes[keys['basket-0']]['content'] and '订单数' in nodes[keys['basket-1']]['content']

# Native path finding on a scoped dependency view. All original evidence edges
# remain in `result`; the connectivity view reverses only explicit depends_on.
impact=nx.DiGraph();impact.add_nodes_from(nodes)
for e in edges:
    if e['type']=='depends_on': impact.add_edge(e['target'],e['source'],weight=1)
    elif e['type']=='maps_to': impact.add_edge(e['source'],e['target'],weight=1)
paths=PathFinder().find_k_shortest_paths(impact,keys['field-orders.order_id'],keys['method'],k=10)
expected_paths={tuple([keys['field-orders.order_id'],keys['C03'],keys['method']]),
                tuple([keys['field-orders.order_id'],keys['C03'],keys['C04'],keys['method']])}
checks['Q04_dynamic_scoped_impact_paths']={tuple(p) for p in paths}==expected_paths
checks['Q05_core_amounts_independent_of_quantity']=not nx.has_path(impact,keys['C05'],keys['C04'])
checks['Q06_exact_frozen_references']=all(any(r.get('version')=='0.1.0' and r.get('metricName')==name for r in nodes[keys[cid]]['metadata']['sourceRefs']) for cid,name in [('C02','terminal_sales_amount'),('C03','retail_refund_amount'),('C04','net_retail_sales')])
assert all(checks.values()),{k:v for k,v in checks.items() if not v}

def node_operation(name,code,args):
    script=run/'tmp'/f'{name}.mjs';script.write_text(code)
    process=subprocess.run(['/opt/homebrew/bin/node',str(script),json.dumps(args)],cwd=run,capture_output=True,text=True,timeout=30)
    (run/'evidence'/f'{name}.stdout.log').write_text(process.stdout)
    (run/'evidence'/f'{name}.stderr.log').write_text(process.stderr)
    assert process.returncode==0,(name,process.stderr)
    return json.loads(process.stdout)

source_root=(run/'source').as_uri()
enterprise_code=f'''import {{EnterpriseMaterialsStore}} from {json.dumps(source_root+'/src/host/enterprise-materials-store.ts')};
const a=JSON.parse(process.argv[2]);const s=new EnterpriseMaterialsStore(a.dataRoot);const d=await s.get(a.ref.materialId);
let out;if(a.action==='disable')out=await s.disable(d.material.id,d.material.version);
else if(a.action==='enable')out=await s.enable(d.material.id,d.material.version,a.ref.revisionId);
else{{const u=await s.update(d.material.id,d.material.version,{{title:d.material.draft.title+'（工程修订）',body:d.material.draft.body+'\\n\\n本修订仅验证工程更新；业务未知与合成限制保持。'}});out=await s.enable(u.material.id,u.material.version);}}
console.log(JSON.stringify(out));'''

case=run/'tmp/scene-current-source';case.mkdir()
shutil.copytree(run/'asset-root',case/'data');shutil.copytree(run/'projects-root',case/'projects')
case_authority=NativeAuthority(run/'source',case/'data',case/'projects')
case_view=SnapshotStore(run,case_authority).load(sid)
ref=build['refs']['enterprise']
node_operation('scene-disable-source',enterprise_code,{'dataRoot':str(case/'data'),'ref':ref,'action':'disable'})
disabled=case_view.query()
assert disabled['state']=='partial'
assert not {keys[k] for k in ['C02','C03','C04','method']} & {n['id'] for n in disabled['nodes']}
assert ref['materialId'] not in json.dumps(disabled,ensure_ascii=False)
assert '零售量' not in json.dumps(disabled,ensure_ascii=False)
snapshot_dirs_before={p.name for p in (run/'snapshots').iterdir()}
rejected=None
try:
    SnapshotStore(run,case_authority).write([{k:n[k] for k in ['id','type','content','metadata']} for n in result['nodes']],[{k:e[k] for k in ['id','source','target','type','metadata']} for e in result['edges']],json.loads((run/'snapshots'/sid/'ontology.json').read_text()),build['inputIdentities'])
except SnapshotError as error: rejected=str(error)
assert rejected and 'source' in rejected and {p.name for p in (run/'snapshots').iterdir()}==snapshot_dirs_before
node_operation('scene-reenable-source',enterprise_code,{'dataRoot':str(case/'data'),'ref':ref,'action':'enable'})
reenabled=case_view.query();assert reenabled['state']=='available' and len(reenabled['nodes'])==54

method_case=run/'tmp/scene-method-governance';method_case.mkdir()
shutil.copytree(run/'asset-root',method_case/'data');shutil.copytree(run/'projects-root',method_case/'projects')
method_view=SnapshotStore(run,NativeAuthority(run/'source',method_case/'data',method_case/'projects')).load(sid)
method_code=f'''import {{createSapMethodStore}} from {json.dumps(source_root+'/extensions/business-plugins/metric-factory/methods/store.ts')};
import {{randomUUID}} from 'node:crypto';import path from 'node:path';const a=JSON.parse(process.argv[2]);const s=createSapMethodStore(path.join(a.dataRoot,'metric-assets'));
s.markIssue(a.ref.methodId,{{requestId:randomUUID(),version:a.ref.version,expectedRevision:0,status:'confirmed',note:'S3 isolated governance negative only'}});
console.log(JSON.stringify({{defaultExcluded:!s.listPublished().some(x=>x.id===a.ref.methodId),historicalIssue:s.getPublished(a.ref.methodId,a.ref.version).issue.status}}));'''
governance=node_operation('scene-method-confirmed',method_code,{'dataRoot':str(method_case/'data'),'ref':build['refs']['method']})
method_filtered=method_view.query();assert method_filtered['state']=='partial' and keys['method'] not in {n['id'] for n in method_filtered['nodes']}
assert governance=={'defaultExcluded':True,'historicalIssue':'confirmed'}

# A real source revision creates a new snapshot; the old files and exact refs stay.
revision=node_operation('scene-update-source',enterprise_code,{'dataRoot':str(run/'asset-root'),'ref':ref,'action':'update'})
new_ref={'kind':'enterprise','storeId':revision['storeId'],'materialId':revision['material']['id'],'revisionId':revision['material']['activeRevisionId']}
v2=build_scene(run,repo,enterprise_ref=new_ref,label='scene-v2')
assert v2['snapshotId']!=sid and v2['refs']['enterprise']['revisionId']!=ref['revisionId']
old_query=store.load(sid).query();new_query=store.load(v2['snapshotId']).query()
assert old_query['state']==new_query['state']=='available'
old_metric=next(n for n in old_query['nodes'] if n['id']==keys['C04'])
new_metric=next(n for n in new_query['nodes'] if n['id']==v2['keys']['C04'])
assert old_metric['id']==new_metric['id']
assert any(r.get('revisionId')==ref['revisionId'] for r in old_metric['metadata']['sourceRefs'])
assert any(r.get('revisionId')==new_ref['revisionId'] for r in new_metric['metadata']['sourceRefs'])
assert {n:sha(run/'snapshots'/sid/n) for n in original}==original

report={'scope':'Actual isolated Store -> approved snapshot -> native graph/ontology/SHACL; no Pi/model or business quality proof',
        'snapshot_v1':sid,'snapshot_v2':v2['snapshotId'],'six_query_checks':checks,'native_explicit_dependency_impact_paths':paths,
        'dynamic_path_scope':'Only this finite approved dependency view; not complete arbitrary-graph enumeration or business causality',
        'source_disabled':{'state':disabled['state'],'nodes_returned':len(disabled['nodes']),'edges_returned':len(disabled['edges']),'no_withheld_source_location_or_body':True,'new_snapshot_rejected':rejected},
        'source_reenabled':{'state':reenabled['state'],'nodes':len(reenabled['nodes'])},'method_governance':governance,
        'source_revision_update':{'old_ref':ref,'new_ref':new_ref,'old_snapshot_unchanged':True,'exact_old_and_new_refs_preserved':True},
        'snapshots_require_explicit_selection':True,'old_snapshot_sha256':original}
(run/'evidence/scene-acceptance-v1.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
