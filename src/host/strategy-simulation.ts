import {StrategyDiscussionFault} from './strategy-discussion-fault.ts';

interface ScenarioBasis {population:string;metric:string;unit:string;period:string;basis:string;baselineRate:number}
export interface CoverageModel extends ScenarioBasis {model?:'coverage-lift';liftPoints:number;coverage:number;coverageAdjustable:boolean}
export interface RepeatVisitsModel extends ScenarioBasis {model:'repeat-visits-v1';remote:number;parts:number;fixed:number}
export type StrategyScenarioModel=CoverageModel|RepeatVisitsModel;
export interface StrategyScenarioConditions {populationSize:number;coverage?:number;unitCost?:number;baselineRate?:number}
export type ScenarioComparison =
  | {kind:'qualitative';reason:string}
  | {kind:'quantitative';rows:{increment:number;avoided?:number}[];crossings:{left:number;right:number;coverage:number}[]};

const bounded=(value:unknown,low:number,high:number):value is number=>
  typeof value==='number' && Number.isFinite(value) && value>=low && value<=high;

export function parseStrategyScenarioModel(value:unknown):StrategyScenarioModel {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new StrategyDiscussionFault('invalid_scenario_model',400);
  const data=value as Record<string,unknown>;
  function label(key:string) {
    const field=data[key];
    if(typeof field!=='string'||!field.trim()||field.length>2000)throw new StrategyDiscussionFault('invalid_scenario_'+key,400);
    return field.trim();
  }
  function number(key:string,low:number,high:number){
    const field=data[key];
    if(!bounded(field,low,high))throw new StrategyDiscussionFault('invalid_scenario_'+key,400);
    return field;
  }
  const common={population:label('population'),metric:label('metric'),unit:label('unit'),period:label('period'),basis:label('basis'),baselineRate:number('baselineRate',0,100)};
  if(data.model==='repeat-visits-v1')return {...common,model:data.model,remote:number('remote',0,100),parts:number('parts',0,100),fixed:number('fixed',0,Number.MAX_SAFE_INTEGER)};
  if(data.model!==undefined && data.model!=='coverage-lift')throw new StrategyDiscussionFault('invalid_scenario_model',400);
  if(typeof data.coverageAdjustable!=='boolean')throw new StrategyDiscussionFault('invalid_scenario_coverageAdjustable',400);
  return {...common,liftPoints:number('liftPoints',-common.baselineRate,100-common.baselineRate),coverage:number('coverage',0,100),coverageAdjustable:data.coverageAdjustable};
}

export function usesScenarioCoverage(models:ReadonlyArray<StrategyScenarioModel|undefined>){
  return models.some(model=>model && (model.model==='repeat-visits-v1' || model.coverageAdjustable));
}

function project(model:StrategyScenarioModel,conditions:StrategyScenarioConditions,coverage=conditions.coverage){
  if(model.model==='repeat-visits-v1'){
    const repeatVisits=conditions.populationSize*(1-(conditions.baselineRate??model.baselineRate)/100);
    const avoided=repeatVisits*(model.remote/100+(1-model.remote/100)*model.parts/100*coverage!/100);
    return {increment:avoided*conditions.unitCost!-model.fixed,avoided};
  }
  const reach=model.coverageAdjustable?coverage!:model.coverage;
  return {increment:conditions.populationSize*model.liftPoints*reach/10000};
}

export function compareStrategyScenarios(models:ReadonlyArray<StrategyScenarioModel|undefined>,conditions:StrategyScenarioConditions):ScenarioComparison {
  const first=models[0];
  if(models.length<2||!first||!models.every((m):m is StrategyScenarioModel=>Boolean(m)))return {kind:'qualitative',reason:'至少两个版本需要给出同口径的模型与依据。'};
  if(!models.every(m=>(m.model??'coverage-lift')===(first.model??'coverage-lift') && m.metric===first.metric && m.unit===first.unit && m.period===first.period && m.population===first.population && m.baselineRate===first.baselineRate))
    return {kind:'qualitative',reason:'版本的模型、人群、指标、单位、观察窗或基线不同。'};
  if(!Number.isSafeInteger(conditions.populationSize)||conditions.populationSize<=0)
    return {kind:'qualitative',reason:'请填写同口径的正整数规模。'};
  if(usesScenarioCoverage(models) && !bounded(conditions.coverage,0,100))
    return {kind:'qualitative',reason:first.model==='repeat-visits-v1'?'请填写 0–100% 的配件可用率。':'请填写 0–100% 的有效覆盖率。'};
  if(first.model==='repeat-visits-v1' && (!bounded(conditions.unitCost,0,Number.MAX_SAFE_INTEGER)||conditions.baselineRate!==undefined&&!bounded(conditions.baselineRate,0,100)))
    return {kind:'qualitative',reason:'请核对单次重复上门的变动成本和首次修复基线。'};
  const rows=models.map(model=>project(model,conditions));
  const endpoints=models.map(m=>[project(m,conditions,0).increment,project(m,conditions,100).increment]);
  const crossings:{left:number;right:number;coverage:number}[]=[];
  for(let left=0;left<models.length;left++)for(let right=left+1;right<models.length;right++){
    const low=endpoints[left]![0]!-endpoints[right]![0]!,high=endpoints[left]![1]!-endpoints[right]![1]!;
    if(low*high<0)crossings.push({left,right,coverage:100*low/(low-high)});
  }
  return {kind:'quantitative',rows,crossings};
}
