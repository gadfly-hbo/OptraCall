"""Finite content recipe. Original assets own definitions; this builds a ReadModel.

No model calls, transaction calculations, latest-version selection or business
decisions occur here. Inputs have already been read through NativeAuthority.
"""
import collections
import copy
import json

from .identity import claim_id, edge_id, ref_identity, stable_id

METRICS = {'C02':'terminal_sales_amount', 'C03':'retail_refund_amount', 'C04':'net_retail_sales'}


def sc01s_condition_scope_notes(method_conditions):
    """Shared readable scope notes; no graph, source selection or inference.

    The caller supplies the exact published method conditions. L1 and L2 can
    expose these same qualifiers without constructing a graph for L1.
    """
    return {
      'sample-scope':['仅记录本固定输入已给的范围／期间，不自动断言方法的适用前提已经成立。'],
      'sample-assumptions':['仅为本固定输入 /synthetic_assumptions 的原声明，不推广为企业政策或方法必需条件。'],
      'sample-conditions':['仅为本固定输入 /conditions 的原声明，不推广为企业政策或方法必需条件。'],
      'real-maturity':['仅声明真实企业回补／截数／去重／成熟度未迁入的范围；不覆盖本题已明确声明，也不是所有当前快照核查的前提。'],
      'real-exceptions':['仅声明未迁入的真实主体特例；本题已给的币种、税及范围声明不因此改为未知。'],
      'comparability':[method_conditions],
    }


def make_sc01s_graph(refs, assets, documents, input_identities):
    entities, relationships, keys = [], [], {}
    excerpt=documents['metric-excerpt']
    candidates={x['id']:x for x in excerpt['candidates']}
    indexes={x['id']:i for i,x in enumerate(excerpt['candidates'])}
    metric_refs={r['metricName']:r for r in refs['metrics']}
    native_metrics={m['name']:m for m in assets['metric_document']['metrics']}
    enterprise=refs['enterprise']; description_ref=refs['description']; input_ref=refs['input']
    limitation=['仅SC-01S合成场景；真实企业特例和适用条件未由工程样本核实。']

    def metadata(sources, build, kind='source-projection', conditions=None, limitations=None, business_time=None, **extra):
        return {'sourceRefs':copy.deepcopy(sources),'buildSources':copy.deepcopy(build),'claimKind':kind,
                'conditions':list(conditions or []),'limitations':list(limitations or limitation),
                'businessTime':list(business_time or []),**extra}

    def node(key,node_type,content,sources,build,kind='source-projection',identity=None,**extra):
        identifier=stable_id(node_type,identity) if identity is not None else claim_id(node_type,sources,build,input_identities,kind,content)
        entities.append({'id':identifier,'type':node_type,'content':content,
                         'metadata':metadata(sources,build,kind,**extra)})
        keys[key]=identifier
        return identifier

    def edge(source,target,relation,sources,build,kind='source-projection',**extra):
        meta=metadata(sources,build,kind,**extra)
        identifier=edge_id(source,target,relation,meta,input_identities)
        relationships.append({'id':identifier,'source':source,'target':target,'type':relation,'metadata':meta})

    source_node=node('enterprise','SourceRevision',assets['enterprise'].get('title','获准脱敏工程资料')+'；业务有效时间保持原声明，当前资格从原库核对。',
                     [enterprise],[{'inputKey':'enterprise-revision','locator':'/title'}],identity=ref_identity(enterprise))
    description_node=node('description','SourceRevision','固定M2说明：工程整理、未作业务确认；字段定位不执行join或汇总。',
                          [description_ref,enterprise],[{'inputKey':'m2-description','locator':'/descriptionRevisionId'}],identity=ref_identity(description_ref))
    input_node=node('input','InputVersion','SC-01S固定合成输入；内容SHA256 '+assets['input']['sha256']+'；原订单与退款明细不搬入图。',
                    [input_ref],[{'inputKey':'input-version','locator':'/inputVersionId'}],identity=ref_identity(input_ref))

    for cid,name in METRICS.items():
        ref=metric_refs[name]; metric=native_metrics[name]
        i=next(i for i,m in enumerate(assets['metric_document']['metrics']) if m['name']==name)
        sources=[ref,enterprise]
        build=[{'inputKey':'metric-publication','locator':f'/metrics/{i}'}]
        concept=node(cid+'-concept','MetricConcept',metric['display_name'],sources,build,
                     identity=['metric-concept',ref['packageId'],ref['metricName']],candidateLocator=cid)
        body=json.dumps({'name':metric['name'],'display_name':metric['display_name'],'type':metric['type'],
                         'definition':metric['definition'],'type_params':metric.get('type_params'),
                         'dimensions':metric['dimensions'],'time_grains':metric['time_grains'],'provenance':metric['provenance']},ensure_ascii=False)
        version=node(cid,'MetricVersion',body,sources,build,identity=ref_identity(ref),candidateLocator=cid,
                     conditions=['范围、单位、币种、含税状态、支付归属和可加总粒度须一致。'],
                     business_time=[{'text':'按原订单支付时间归属；退款事件时间用于截止证据。','source':'获准定义与准确SAP版'}])
        edge(version,concept,'version_of',sources,build)
        edge(version,source_node,'has_source',sources,build)
        if cid=='C04':
            edge(version,concept,'version_of',sources,[{'inputKey':'metric-excerpt','locator':f'/candidates/{indexes[cid]}'}],
                 'engineering-interpretation',limitations=limitation+['此平行关系记录工程解释的独立依据，不覆盖原来源关系。'])

    for cid,operand in [('C02','minuend'),('C03','subtrahend')]:
        edge(keys['C04'],keys[cid],'depends_on',[metric_refs[METRICS['C04']],metric_refs[METRICS[cid]],enterprise],
             [{'inputKey':'metric-excerpt','locator':f'/candidates/{indexes["C04"]}/candidate_dependencies'}],operandRole=operand)

    method=assets['method']
    method_node=node('method','MethodVersion',json.dumps({'title':method['title'],'content':method['content']},ensure_ascii=False),
                     [refs['method'],enterprise],[{'inputKey':'method-publication','locator':'/content'}],
                     identity=ref_identity(refs['method']),limitations=limitation+['方法供自主参考，不是Host执行计划；金额分解不证明经营因果。'])
    edge(method_node,source_node,'has_source',[refs['method'],enterprise],[{'inputKey':'method-publication','locator':'/sources'}])
    for cid in METRICS:
        edge(method_node,keys[cid],'depends_on',[refs['method'],metric_refs[METRICS[cid]],enterprise],
             [{'inputKey':'method-publication','locator':'/content/logic'}],'engineering-interpretation')

    # Unadopted concepts retain their approved excerpt revision/local identity.
    for cid in ['C01','C05','C06','C07','C08']:
        candidate=candidates[cid]
        body=json.dumps(candidate,ensure_ascii=False)
        concept=node(cid,'MetricConcept',body,[enterprise],
                     [{'inputKey':'metric-excerpt','locator':f'/candidates/{indexes[cid]}'}],candidateLocator=cid)
    edge(keys['C01'],keys['C02-concept'],'distinct_from',[enterprise],
         [{'inputKey':'metric-excerpt','locator':f'/candidates/{indexes["C01"]}/scope_notes'}])

    sample=documents['synthetic-input']
    scope_keys=[key for key in ['scope','periods'] if key in sample]
    assumption_keys=[key for key in ['synthetic_assumptions','conditions'] if key in sample]
    condition_specs=[]
    if scope_keys:
        condition_specs.append(('sample-scope',json.dumps({key:sample[key] for key in scope_keys},ensure_ascii=False),
          'stated','synthetic-assumption',[input_ref],
          [{'inputKey':'synthetic-input','locator':'/'+key} for key in scope_keys]))
    for envelope in assumption_keys:
        assumptions=sample[envelope]
        build=[{'inputKey':'synthetic-input','locator':'/'+envelope}]
        if envelope=='conditions' and isinstance(assumptions,dict):
            for key,value in assumptions.items():
                condition_specs.append(('sample-condition:'+key,json.dumps({key:value},ensure_ascii=False),
                  'stated','synthetic-assumption',[input_ref],build))
        else:
            # Legacy assumptions and non-object inputs retain their exact
            # original shape, independently of the other source envelope.
            key='sample-assumptions' if envelope=='synthetic_assumptions' else 'sample-conditions'
            condition_specs.append((key,json.dumps(assumptions,ensure_ascii=False),
              'stated','synthetic-assumption',[input_ref],build))
    condition_specs += [
      ('real-maturity','真实退款回补、截数、去重和观察成熟度未知；本次样本声明不等同企业政策。','unknown','engineering-interpretation',
       [enterprise],[{'inputKey':'metric-excerpt','locator':f'/candidates/{indexes["C03"]}/scope_notes'}]),
      ('real-exceptions','具体主体特例未迁入；真实币种、税口径及适用范围仍待业务依据。','unknown','source-projection',
       [enterprise],[{'inputKey':'metric-excerpt','locator':'/review_findings'}]),
      ('comparability','同一可比集合、等长已结束窗口、同一口径和可加总粒度是方法前提，不表示现实已满足。','required-not-established','engineering-interpretation',
       [refs['method'],enterprise],[{'inputKey':'method-publication','locator':'/content/conditions'}]),
      ('quantity-dispute','零售量依赖存在重复扣退货风险；在定义歧义解决前不形成执行计算规则。','disputed','source-projection',
       [enterprise],[{'inputKey':'metric-excerpt','locator':f'/candidates/{indexes["C05"]}/scope_notes'}])]
    condition_scopes=sc01s_condition_scope_notes(method['content']['conditions'])
    for key,body,state,kind,sources,build in condition_specs:
        scopes=(condition_scopes['sample-conditions'] if key.startswith('sample-condition:')
                else condition_scopes.get(key,[]))
        c=node(key,'Condition',body,sources,build,kind,conditionState=state,conditions=scopes,
               **({'candidateLocator':'C05'} if key=='quantity-dispute' else {}))
        # Only a source-backed method applicability requirement is a requires
        # relation. Task declarations and untransferred enterprise unknowns are
        # discoverable statements, not global vetoes on methods or metrics.
        if key=='comparability':
            edge(method_node,c,'requires',sources,build,kind,conditions=scopes)
    for suffix in ['formula_text','scope_notes']:
        body=json.dumps(candidates['C05'][suffix],ensure_ascii=False)
        st=node('qty-'+suffix,'Statement',body,[enterprise],[{'inputKey':'metric-excerpt','locator':f'/candidates/{indexes["C05"]}/{suffix}'}],candidateLocator='C05')
        edge(st,source_node,'has_source',[enterprise],[{'inputKey':'metric-excerpt','locator':f'/candidates/{indexes["C05"]}/{suffix}'}])
    edge(keys['qty-formula_text'],keys['qty-scope_notes'],'potential_conflict',[enterprise],
         [{'inputKey':'metric-excerpt','locator':f'/candidates/{indexes["C05"]}'}])
    # Candidate dependencies remain unestablished requirements, not falsely
    # published calculation dependencies between actual metric versions.
    for cid,deps in [('C06',['C05']),('C07',['C04','C06'])]:
        condition=node(cid+'-not-ready','Condition',
                       json.dumps({'candidate':cid,'candidate_dependencies':deps,'source_notes':candidates[cid]['scope_notes'],
                                   'meaning':'候选依赖仍待口径核查，不构成已发布可执行规则。'},ensure_ascii=False),
                       [enterprise],[{'inputKey':'metric-excerpt','locator':f'/candidates/{indexes[cid]}'}],conditionState='required-not-established',candidateLocator=cid)
    for i,variant in enumerate(candidates['C08']['formula_variants_from_source']):
        c=node('basket-'+str(i),'Condition',json.dumps(variant,ensure_ascii=False)+'；分母、去重、除零与实际字段未全部就绪。',
               [enterprise],[{'inputKey':'metric-excerpt','locator':f'/candidates/{indexes["C08"]}/formula_variants_from_source/{i}'}],conditionState='required-not-established',candidateLocator='C08')

    # Field-role groups preserve each exact pointer; they are not transaction nodes.
    groups=collections.defaultdict(list)
    for mapping in assets['description']['mappings']:
        pointer=mapping['location']['pointer']; parts=pointer.split('/')[1:]
        group=(parts[0],parts[-1] if len(parts)>2 else 'record-or-scope')
        groups[group].append(mapping)
    for (collection,field),mappings in sorted(groups.items()):
        pointers=sorted({m['location']['pointer'] for m in mappings})
        role=f'{collection}.{field}'
        body=json.dumps({'role':role,'pointers':pointers,'meaning':'精确字段定位／归属／关联证据；不执行join或汇总，不包含交易值。'},ensure_ascii=False)
        source_refs=[description_ref,input_ref,enterprise]
        metric_names=sorted({s['metricName'] for m in mappings for s in m['sapRefs']})
        source_refs += [metric_refs[name] for name in metric_names]
        role_node=node('field-'+role,'FieldRole',body,source_refs,[{'inputKey':'m2-description','locator':'/mappings'}],
                       'engineering-interpretation',limitations=limitation+['字段映射只声明定位与语义，不把派生指标当作已有主输入字段。'])
        edge(role_node,input_node,'describes_input',source_refs,[{'inputKey':'m2-description','locator':'/mappings'}],'engineering-interpretation')
        for name in metric_names:
            cid=next(c for c,n in METRICS.items() if n==name)
            edge(role_node,keys[cid],'maps_to',source_refs,[{'inputKey':'m2-description','locator':'/mappings'}],
                 'engineering-interpretation',roleText=role+'；'+('原订单关联键，用于支付归属；不是金额字段。' if field=='order_id' else '字段含义以原M2说明和对应准确定义共同核对。'))
    for st in assets['description']['statements']:
        i=next(i for i,v in enumerate(assets['description']['statements']) if v['statementId']==st['statementId'])
        statement_node=node('m2-statement-'+st['scope'],'Statement',st['text'],[description_ref,enterprise],
                            [{'inputKey':'m2-description','locator':f'/statements/{i}'}],'engineering-interpretation',
                            business_time=[{'text':st['text'],'source':'固定M2说明业务时间声明'}] if st['scope']=='business-time' else [])
        edge(statement_node,input_node,'describes_input',[description_ref,input_ref,enterprise],
             [{'inputKey':'m2-description','locator':f'/statements/{i}'}],'engineering-interpretation')
    return {'entities':entities,'relationships':relationships,'keys':keys}
