import type {StrategyScenarioModel} from '../strategy-simulation.ts';

export function StrategyScenarioEditor({model,onChange}:{model?:StrategyScenarioModel;onChange:(model?:StrategyScenarioModel)=>void}){
  function select(kind:string){
    if(!kind){onChange(undefined);return;}
    const {population='',metric='',period='',unit='',basis='',baselineRate=NaN}=model??{};
    const common={population,metric,period,unit,basis,baselineRate};
    onChange(kind==='repeat-visits-v1'?{...common,model:'repeat-visits-v1',remote:NaN,parts:NaN,fixed:NaN}:{...common,liftPoints:NaN,coverage:NaN,coverageAdjustable:false});
  }
  return <details><summary>经营情景模型</summary><label>试算方法 <select value={model?(model.model??'coverage-lift'):''} onChange={e=>select(e.target.value)}><option value="">仅定性比较</option><option value="coverage-lift">覆盖与转化增量</option><option value="repeat-visits-v1">设备服务 · 重复上门净节省</option></select></label>
    {model && <div className="map-edit-grid">{([['population','适用人群或工单'],['metric','结果指标'],['unit','输出单位'],['period','观察周期'],['basis','假设依据']] as const).map(([k,l])=><label key={k}>{l}<input value={model[k]} onChange={e=>onChange({...model,[k]:e.target.value})}/></label>)}
      <label>基线率（%）<input type="number" step="any" value={Number.isFinite(model.baselineRate)?model.baselineRate:''} onChange={e=>onChange({...model,baselineRate:e.target.valueAsNumber})}/></label>
      {model.model==='repeat-visits-v1'?([['remote','分流可避免比例（%）'],['parts','余下工单有配件时可避免比例（%）'],['fixed','每期固定投入']] as const).map(([k,l])=><label key={k}>{l}<input type="number" step="any" value={Number.isFinite(model[k])?model[k]:''} onChange={e=>onChange({...model,[k]:e.target.valueAsNumber})}/></label>):<>
      {([['liftPoints','覆盖组提升（百分点）'],['coverage','有效覆盖率（%）']] as const).map(([k,l])=><label key={k}>{l}<input type="number" step="any" value={Number.isFinite(model[k])?model[k]:''} onChange={e=>onChange({...model,[k]:e.target.valueAsNumber})}/></label>)}<label><input type="checkbox" checked={model.coverageAdjustable} onChange={e=>onChange({...model,coverageAdjustable:e.target.checked})}/>可试调覆盖率</label></>}
    </div>}</details>;
}
