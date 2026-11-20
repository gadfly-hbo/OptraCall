import test from 'node:test';
import assert from 'node:assert/strict';
import { compareStrategyScenarios, parseStrategyScenarioModel } from '../src/host/strategy-simulation.ts';

const shared = {population:'合资格首购会员',metric:'二购',unit:'人',period:'首购后满90天',baselineRate:9,basis:'隔离试点假设'};
const a = {...shared, liftPoints:2,coverage:100,coverageAdjustable:false};
const b = {...shared, liftPoints:5,coverage:80,coverageAdjustable:true};
test('相同人群与窗口下，回访覆盖率在 40% 两侧翻转新增二购人数',()=>{
  for(const [coverage,expected] of [[80,40],[30,15],[40,20]]) {
    const result = compareStrategyScenarios([a,b], {populationSize:1000,coverage:coverage!});
    assert.equal(result.kind,'quantitative');
    if(result.kind==='quantitative') {
      assert.deepEqual(result.rows.map(row=>row.increment),[20,expected]);
      assert.equal(result.crossings[0]?.coverage,40);
    }
  }
});

test('缺模型、口径不同、人数不明时只支持定性比较，数值零保持有效',()=>{
  const env={populationSize:1000,coverage:0};
  for(const changed of [undefined,{...b,period:'自然年度'},{...b,unit:'单'},{...b,baselineRate:0}])
    assert.equal(compareStrategyScenarios([a,changed],env).kind,'qualitative');
  assert.equal(compareStrategyScenarios([a,b],{...env,populationSize:0}).kind,'qualitative');
  const model=parseStrategyScenarioModel({...b,coverage:0});assert.ok(model.model!=='repeat-visits-v1');assert.equal(model.coverage,0);
  assert.throws(()=>parseStrategyScenarioModel({...b,liftPoints:92}),/liftPoints/);
  assert.throws(()=>parseStrategyScenarioModel({...b,basis:''}),/basis/);
});

test('地图按版导出同时保留主指标与补充指标',async()=>{
  const {strategyMapDocument}=await import('../src/host/strategy-map-document.ts');
  const {renderVersionDocument}=await import('../src/host/management-documents.ts');
  const version={mapId:'map',discussionId:'discussion',version:1,operationId:'review',reason:'主辅指标核对',createdAt:new Date().toISOString(),contentSha256:'digest',author:'user' as const,title:'指标完整性',template:'table' as const,choice:'方向',assumptions:'',unknowns:'',excluded:'',nodes:[{id:'G1',kind:'goal' as const,title:'年度指标',metric:'甲',target:'12',unit:'人',metrics:[{metric:'乙',target:'24',unit:'家'}]}],edges:[],citations:[]};
  const html=renderVersionDocument(strategyMapDocument(version,'部门'));
  assert.match(html,/<td>甲<\/td>/);assert.match(html,/<td>12<\/td>/);
  assert.match(html,/<td>乙<\/td>/);assert.match(html,/<td>24<\/td>/);
});

test('设备服务在相同工单量和单位成本下，备件可用率改变两版净节省的排序',()=>{
  const common={model:'repeat-visits-v1' as const,population:'月关闭工单',metric:'减少重复派工的净节省',unit:'元',period:'月',baselineRate:72,basis:'合成试点条件'};
  const models=[{...common,remote:34,parts:12,fixed:9000},{...common,remote:16,parts:62,fixed:13000}].map(parseStrategyScenarioModel);
  for(const [coverage,winner] of [[90,1],[35,0]]){
    const result=compareStrategyScenarios(models,{populationSize:1000,coverage,unitCost:180});
    assert.equal(result.kind,'quantitative');
    if(result.kind==='quantitative'){
      assert.ok(result.rows[winner]!.increment>result.rows[1-winner]!.increment);
      assert.ok(Math.abs(result.crossings[0]!.coverage-58.73)<0.1);
    }
  }
  assert.equal(compareStrategyScenarios(models,{populationSize:1000,coverage:80}).kind,'qualitative');
});

test('固定覆盖方案仅需要人数，可变覆盖与配件模型保留零与未填的区别',()=>{
  const fixedZero={...a,liftPoints:5,coverage:0};
  const result=compareStrategyScenarios([a,fixedZero],{populationSize:1000});
  assert.deepEqual(result,{kind:'quantitative',rows:[{increment:20},{increment:0}],crossings:[]});
  assert.equal(compareStrategyScenarios([a,fixedZero],{populationSize:0}).kind,'qualitative');
  assert.equal(compareStrategyScenarios([a,b],{populationSize:1000}).kind,'qualitative');
  const zero=compareStrategyScenarios([a,b],{populationSize:1000,coverage:0});
  assert.equal(zero.kind,'quantitative');
  if(zero.kind==='quantitative')assert.deepEqual(zero.rows.map(r=>r.increment),[20,0]);
  const service={...shared,model:'repeat-visits-v1' as const,remote:10,parts:20,fixed:2};
  assert.equal(compareStrategyScenarios([service,service],{populationSize:1000,unitCost:0}).kind,'qualitative');
  const serviceZero=compareStrategyScenarios([service,service],{populationSize:1000,unitCost:0,coverage:0});
  assert.equal(serviceZero.kind,'quantitative');
  if(serviceZero.kind==='quantitative')assert.deepEqual(serviceZero.rows.map(r=>r.increment),[-2,-2]);
});

test('固定覆盖的两版地图只提交人数，真实 HTTP 试算记录可原样重开',async t=>{
  const {startTestHost}=await import('./fixtures/host-process.ts'),{randomUUID}=await import('node:crypto');
  const host=await startTestHost();t.after(()=>host.close());
  const api=async (route:string,method='GET',body?:unknown,status=200)=>{
    const response=await host.request(route,method,body);
    assert.equal(response.status,status,await response.clone().text());return response.json();
  };
  await api('/api/configuration','PUT',{name:'本地测试',provider:'openai-compatible',baseUrl:'http://127.0.0.1:14998/v1',model:'synthetic',apiKey:'synthetic-local'});
  const id=randomUUID(),base='/api/strategy/discussions/'+id;
  await api('/api/strategy/discussions','POST',{operationId:id,title:'固定覆盖对照'},201);
  const maps=[];
  for(const [i,model] of [a,{...a,coverage:0,liftPoints:3}].entries()){
    const {version}=await api(base+'/maps','POST',{mapId:randomUUID(),operationId:randomUUID(),expectedVersion:0,reason:'固定覆盖',
      draft:{title:'方向 '+i,template:'table',nodes:[{id:'G1',title:'二购',kind:'goal'}],edges:[],scenarioModel:model}},201);
    maps.push({mapId:version.mapId,version:version.version,contentSha256:version.contentSha256});
  }
  const record={name:'固定覆盖对照',operationId:randomUUID(),mode:'conditions',maps,conditions:{populationSize:1500}};
  const {trial}=await api(base+'/simulations','POST',record);
  assert.deepEqual(trial.conditions,{populationSize:1500});
  assert.deepEqual((await api(base+'/simulations')).trials,[trial]);
  assert.deepEqual(await api(base+'/simulations','POST',record),{trial});
});
