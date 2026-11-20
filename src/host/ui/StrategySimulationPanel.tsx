import {useEffect, useState} from 'react';
import type {StrategyMapVersion} from '../strategy-map-types.ts';
import {compareStrategyScenarios, parseStrategyScenarioModel} from '../strategy-simulation.ts';
import type {StrategyTrial, StrategyTrialInput} from '../strategy-trials.ts';
import {StrategyAttachmentEvidence} from './StrategyAttachmentEvidence.tsx';
import {strategyWorkbenchRequest} from './strategy-discussion-client.ts';

export interface StrategyEdgeLocation {mapId:string;version:number;edgeId:string}
const keyOf=(v:{mapId:string;version:number})=>v.mapId+':'+v.version;
const label=(v:StrategyMapVersion)=>v.title+' · v'+v.version;
const number=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2});

export function StrategySimulationPanel({discussionId,versions,origin,onReturn}:{discussionId:string;versions:StrategyMapVersion[];origin?:StrategyEdgeLocation;onReturn:(origin:StrategyEdgeLocation)=>void}) {
  const latest=Array.from(new Map(versions.map(v=>[v.mapId,v])).values());
  const [selected,setSelected]=useState<string[]>(()=>[...new Set([...(origin?[keyOf(origin)]:[]),...latest.filter(v=>v.mapId!==origin?.mapId).map(keyOf)])].slice(0,2));
  const maps=selected.map(key=>versions.find(v=>keyOf(v)===key)).filter((v):v is StrategyMapVersion=>!!v);
  const [mode,setMode]=useState<'conditions'|'assumptions'>(origin?'assumptions':'conditions');
  const [edge,setEdge]=useState(origin);
  const [size,setSize]=useState('');
  const initialModel=latest.map(v=>v.scenarioModel).find(m=>m && m.model!=='repeat-visits-v1' && m.coverageAdjustable);
  const [coverage,setCoverage]=useState(()=>initialModel && initialModel.model!=='repeat-visits-v1'?String(initialModel.coverage):'');
  const [unitCost,setUnitCost]=useState(''),[baseRate,setBaseRate]=useState('');
  const [services,setServices]=useState<Record<string,Partial<Record<'remote'|'parts'|'fixed',string>>>>({});
  const service=maps.length>=2 && maps.every(v=>v.scenarioModel?.model==='repeat-visits-v1');

  const [lifts,setLifts]=useState<Record<string,string>>({});
  const [name,setName]=useState(''), [records,setRecords]=useState<StrategyTrial[]>([]),[unavailable,setUnavailable]=useState(0);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [retry,setRetry]=useState<{fingerprint:string;operationId:string}>();
  useEffect(()=>{
    const controller=new AbortController();
    strategyWorkbenchRequest<{trials:StrategyTrial[];unavailable:number}>(discussionId,'/simulations','GET',undefined,controller.signal)
      .then(r=>{if(!controller.signal.aborted){setRecords(r.trials);setUnavailable(r.unavailable);}})
      .catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return ()=>controller.abort();
  },[discussionId]);
  const modelFor=(v:StrategyMapVersion)=>{
    if(!v.scenarioModel)return undefined;
    if(v.scenarioModel.model==='repeat-visits-v1'){
      const fields=Object.entries(services[keyOf(v)]??{}).map(([k,value])=>[k,value===''?NaN:Number(value)]);
      try{return parseStrategyScenarioModel({...v.scenarioModel,...Object.fromEntries(fields)});}catch{return undefined;}
    }
    const value=lifts[keyOf(v)];
    try{return parseStrategyScenarioModel(value===undefined?v.scenarioModel:{...v.scenarioModel,liftPoints:value===''?NaN:Number(value)});}catch{return undefined;}
  };
  const conditions={populationSize:Number(size),coverage:coverage===''?NaN:Number(coverage),...(service && {unitCost:unitCost===''?NaN:Number(unitCost),...(baseRate!=='' && {baselineRate:Number(baseRate)})})};
  const models=maps.map(modelFor);
  const comparison=compareStrategyScenarios(models,conditions);
  const eligible=maps.length>=2 && maps.every((v,i)=>v.scenarioModel && models[i]);
  const sameBasis=eligible && compareStrategyScenarios(models,{populationSize:1,coverage:100,...(service && {unitCost:1})}).kind==='quantitative';
  const originMap=edge && versions.find(v=>keyOf(v)===keyOf(edge));
  const originEdge=originMap && originMap.edges.find(e=>e.id===edge!.edgeId);
  function reopen(r:StrategyTrial) {
    setSelected(r.maps.map(keyOf));setLifts(Object.fromEntries(r.maps.filter(m=>m.liftPoints!==undefined).map(m=>[keyOf(m),String(m.liftPoints)])));
    setServices(Object.fromEntries(r.maps.filter(m=>m.service).map(m=>[keyOf(m),Object.fromEntries(Object.entries(m.service!).map(([k,x])=>[k,String(x)]))])));
    setUnitCost(r.conditions?.unitCost===undefined?'':String(r.conditions.unitCost));setBaseRate(r.conditions?.baselineRate===undefined?'':String(r.conditions.baselineRate));
    setSize(r.conditions?String(r.conditions.populationSize):'');setCoverage(r.conditions?String(r.conditions.coverage):'100');
    setEdge(r.edge);setMode(r.mode??(r.conditions?'conditions':'assumptions'));setName(r.name);setNotice('已恢复当时的版本和条件');setError('');
  }
  async function save(){
    if(!name.trim() || busy || maps.length<2 || maps.length!==selected.length)return;
    const payload:Omit<StrategyTrialInput,'operationId'>={mode,name:name.trim(),maps:maps.map(v=>{
      const ref={mapId:v.mapId,version:v.version,contentSha256:v.contentSha256},m=modelFor(v);
      if(m?.model==='repeat-visits-v1' && services[keyOf(v)])return {...ref,service:{remote:m.remote,parts:m.parts,fixed:m.fixed}};
      return m && m.model!=='repeat-visits-v1' && lifts[keyOf(v)]!==undefined?{...ref,liftPoints:m.liftPoints}:ref;
    }),
      ...(comparison.kind==='quantitative'?{conditions}:{}),...(edge && maps.some(m=>keyOf(m)===keyOf(edge))?{edge}:{})};
    const fingerprint=JSON.stringify(payload), operationId=retry?.fingerprint===fingerprint?retry.operationId:crypto.randomUUID();
    setRetry({fingerprint,operationId});setBusy(true);setError('');
    try{
      const {trial}=await strategyWorkbenchRequest<{trial:StrategyTrial}>(discussionId,'/simulations','POST',{...payload,operationId});
      setRecords(old=>[trial,...old.filter(r=>r.operationId!==trial.operationId)]);setNotice('已保存本次比较');setRetry(undefined);
    }catch(e){setError(e instanceof Error?e.message:'比较记录未核实');}finally{setBusy(false);}
  }
  return <section aria-label="战略模拟" className="wb-simulation">
    <div className="sg-row-between"><h3>比较候选方案</h3>{originMap && originEdge && edge && <button className="text-button" onClick={()=>onReturn(edge)}>返回原地图连线</button>}</div>
    {originEdge && originMap && <p className="sg-muted">{label(originMap)} · {originEdge.from} → {originEdge.to}</p>}
    {!versions.length ? <p>保存候选地图后，可在这里比较其适用条件。</p> : <>
    <fieldset className="wb-choices"><legend>参与比较的版本</legend>{versions.map(v=><label key={keyOf(v)}><input type="checkbox" checked={selected.includes(keyOf(v))} onChange={e=>setSelected(old=>e.target.checked?[...old,keyOf(v)]:old.filter(key=>key!==keyOf(v)))}/>{label(v)}</label>)}</fieldset>
    <div className="sg-row" aria-label="模拟方式">{([['conditions','经营情景'],['assumptions','战略假设']] as const).map(([key,title])=><button className="secondary-button" type="button" key={key} aria-pressed={mode===key} onClick={()=>setMode(key)}>{title}</button>)}</div>
    {selected.length>maps.length && <p role="status">有参与比较的版本当前不可读取，<button className="text-button" onClick={()=>setSelected(maps.map(keyOf))}>仅保留当前可读版本</button></p>}
    {mode==='conditions' && <>
      {sameBasis && <fieldset className="wb-fields"><legend>共同经营条件</legend><p>{models[0]!.population} · {models[0]!.period} · {models[0]!.metric}，基线 {models[0]!.baselineRate}%</p><label>{service?'同期工单量':'人群规模'}<input type="number" min="1" step="1" value={size} onChange={e=>setSize(e.target.value)}/></label><label>{service?'配件可用率（%）':'可变方案的有效覆盖率（%）'}<input type="number" min="0" max="100" step="any" value={coverage} onChange={e=>setCoverage(e.target.value)}/></label>{service && <><label>每次重复上门成本<input type="number" min="0" step="any" value={unitCost} onChange={e=>setUnitCost(e.target.value)}/></label><label>首次修复率（%）<input type="number" min="0" max="100" step="any" value={baseRate} placeholder={String(models[0]!.baselineRate)} onChange={e=>setBaseRate(e.target.value)}/></label></>}</fieldset>}
      {comparison.kind==='qualitative' && <p className="sg-muted">定性比较 · {comparison.reason}</p>}
      <div className="wb-table-wrap"><table><caption>各版经营假设与结果</caption><thead><tr><th>方案</th><th>选择与依据</th><th>各版试调参数</th><th>{service?'预计净节省':'预计增量'}</th></tr></thead><tbody>{maps.map((v,i)=><tr key={keyOf(v)}><th scope="row">{label(v)}</th><td>{v.choice || '待补'}{v.scenarioModel && <details><summary>模型依据与覆盖口径</summary>{v.scenarioModel.basis}<br/>{v.scenarioModel.model==='repeat-visits-v1'?'按同期工单和单次成本试算':v.scenarioModel.coverageAdjustable?'随共同覆盖率试调':'固定覆盖 '+v.scenarioModel.coverage+'%'}</details>}</td><td>{v.scenarioModel?.model==='repeat-visits-v1'?([['remote','分流可避免比例（%）'],['parts','有配件时可避免比例（%）'],['fixed','每期固定投入']] as const).map(([field,title])=>{
        const m=v.scenarioModel;if(m?.model!=='repeat-visits-v1')return null;
        return <label key={field}>{title}<input type="number" step="any" aria-label={label(v)+' '+title} value={services[keyOf(v)]?.[field]??m[field]} onChange={e=>setServices(old=>({...old,[keyOf(v)]:{...old[keyOf(v)],[field]:e.target.value}}))}/></label>;
      }):v.scenarioModel?<label><input type="number" step="any" aria-label={label(v)+' 提升百分点'} value={lifts[keyOf(v)]??v.scenarioModel.liftPoints} onChange={e=>setLifts(old=>({...old,[keyOf(v)]:e.target.value}))}/> 个百分点</label>:'待验证'}</td><td>{comparison.kind==='quantitative'?number.format(comparison.rows[i]!.increment)+' '+models[i]!.unit:'待核'}</td></tr>)}</tbody></table></div>
      {comparison.kind==='quantitative' && comparison.crossings.map(c=><p key={c.left+':'+c.right}>{service?'配件可用率':'有效覆盖率'} {number.format(c.coverage)}% 时，{maps[c.left]!.title} 与 {maps[c.right]!.title} 的{service?'预计净节省':'预计增量'}相同。</p>)}
    </>}
    {mode==='assumptions' && <div className="wb-table-wrap"><table><caption>各版成立条件与检验方法</caption><thead><tr><th>候选版本</th><th>假设与取舍</th><th>证据范围、检验与改判信号</th></tr></thead><tbody>{maps.map(v=><tr key={keyOf(v)}><th>{label(v)}</th><td>{v.assumptions || '待补'}<p>{v.excluded}</p></td><td>{v.unknowns || '暂无待核记录'}{v.edges.filter(e=>e.review).map(e=><details key={e.id} open={edge?.edgeId===e.id && keyOf(v)===keyOf(edge)}><summary>{e.from} → {e.to} · {e.review!.summary}</summary><dl><dt>作用机制与必要条件</dt><dd>{e.review!.mechanism} · {e.review!.condition}</dd><dt>证据适用范围</dt><dd>{e.review!.scope}</dd><dt>其他解释与风险</dt><dd>{e.review!.alternative} · {e.review!.risk}</dd><dt>检验方法</dt><dd>{e.review!.test}</dd></dl>{v.citations.filter(c=>e.citationTokens?.includes(c.token)).map(c=><StrategyAttachmentEvidence key={c.token} discussionId={discussionId} citation={c}/>)}<button className="text-button" onClick={()=>onReturn({mapId:v.mapId,version:v.version,edgeId:e.id})}>查看此版连线</button></details>)}</td></tr>)}</tbody></table></div>}
    {maps.length>=2 && <div className="sg-row"><label>本次比较名称 <input value={name} maxLength={200} onChange={e=>setName(e.target.value)}/></label><button className="secondary-button" disabled={busy || maps.length!==selected.length || !name.trim() || (mode==='conditions' && sameBasis && comparison.kind==='qualitative') || maps.some(v=>v.scenarioModel && !modelFor(v))} onClick={()=>void save()}>保存本次比较</button></div>}
    </>}
    {records.length>0 && <details><summary>已保存的比较（{records.length}）</summary>{records.map(r=><p key={r.operationId}><button className="text-button" onClick={()=>reopen(r)}>{r.name} · {new Date(r.createdAt).toLocaleString('zh-CN')}</button></p>)}</details>}
    {unavailable>0 && <p role="status">{unavailable} 项历史比较的来源当前不可读取。</p>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
