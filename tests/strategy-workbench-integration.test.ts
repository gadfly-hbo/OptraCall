import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider,providerMessageText} from './fixtures/tool-provider.ts';

test('实际战略入口共编并比较具名方案，重开与导出均指向固定版本', {timeout:60000},async t=>{
  const host=await startTestHost(),provider=await startToolProvider();
  t.after(async()=>{await host.close();await provider.close();});
  async function api(route:string,method='GET',body?:unknown,expected=200){
    const r=await host.request(route,method,body);
    assert.equal(r.status,expected,route+' '+await r.clone().text());return r.json();
  }
  await api('/api/configuration','PUT',{name:'隔离本地 Provider',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'synthetic-strategy',apiKey:'synthetic-only'});
  const id=randomUUID(),route='/api/strategy/discussions/'+id;
  await api('/api/strategy/discussions','POST',{operationId:id,title:'合成会员运营'},201);
  const common={population:'满90天首购会员',unit:'人',metric:'二购',period:'首购后满90天',baselineRate:9,basis:'合成回归的效果假设'};
  const nodes=[{id:'G1',kind:'goal',title:'改善二购率',baseline:'9%',target:'待定'},{id:'G3',kind:'goal',title:'有效覆盖'}];
  const edge={id:'G3-G1',from:'G3',to:'G1',kind:'hypothesis',review:{summary:'有效覆盖可能带来二购',mechanism:'提供二次到店理由',condition:'有可用导购工时',alternative:'原有购买意愿',risk:'挤占工时',scope:'促销周',test:'同店同期对照，观察满90天'}};
  const a=randomUUID(),b=randomUUID();
  const draftA={title:'普发券 A',template:'table',choice:'普发券',nodes,edges:[],scenarioModel:{...common,liftPoints:2,coverage:100,coverageAdjustable:false}};
  const draftB={...draftA,title:'首购回访 B',choice:'导购回访',template:'bsc',edges:[edge],scenarioModel:{...common,liftPoints:5,coverage:80,coverageAdjustable:true}};
  const save=(mapId:string,expectedVersion:number,draft:unknown)=>({mapId,operationId:randomUUID(),expectedVersion,reason:'人工核对',draft});
  const {version:first}=await api(route+'/maps','POST',save(a,0,draftA),201);
  const {version:second}=await api(route+'/maps','POST',save(b,0,draftB),201);
  const {version:manual}=await api(route+'/maps','POST',save(b,1,{...draftB,choice:'人工修订：只在促销周试点'}),201);
  const bad=await host.request(route+'/maps','POST',save(b,1,draftB));
  assert.equal(bad.status,409);
  assert.equal(provider.requests.length,0);
  const input={name:'回访人手充足',operationId:randomUUID(),maps:[first,second].map(v=>({mapId:v.mapId,version:v.version,contentSha256:v.contentSha256})),conditions:{populationSize:1000,coverage:80},edge:{mapId:b,version:1,edgeId:edge.id}};
  const receipt=await api(route+'/simulations','POST',input);
  assert.deepEqual(await api(route+'/simulations','POST',input),receipt);
  assert.equal((await api(route+'/simulations')).trials[0].maps[1].version,1);
  assert.equal((await host.request(route+'/simulations','POST',{...input,name:'另一记录'})).status,409);
  const exported=await api(route+'/maps/'+b+'/versions/1/export');
  assert.match(exported.html,/同店同期对照/);assert.match(exported.html,/首购回访 B/);assert.doesNotMatch(exported.html,/只在促销周试点/);
  assert.equal(provider.requests.length,0);
  const requestId=randomUUID();
  provider.setResponder(ctx=>{
    if(!ctx.recentToolResults.length) return {calls:[{name:'strategy_goals',arguments:{action:'save-map',mapId:b,expectedVersion:2,reason:'补上证据范围',mapDraft:{...draftB,choice:manual.choice,unknowns:'平销周效果未知'}}}]};
    return {text:'已将平销周的适用范围列为待核。'};
  });
  await api(route+'/messages','POST',{text:'沿用我手动修订的范围，补记平销周效果尚待验证。',expectedRevision:(await api(route)).discussion.revision,requestId,mapRef:{mapId:b,version:2}},202);
  let detail=await api(route);
  for(let n=0;n<300 && (detail.busy || detail.discussion.lastRun?.status==='accepted');n++){
    await delay(35);detail=await api(route);
  }
  assert.equal(detail.discussion.lastRun?.status,'completed');
  assert.match(provider.requests[0]!.body.messages!.map(m=>providerMessageText(m.content)).join('\n'),/人工修订：只在促销周试点/);
  const catalog=await api(route+'/maps');
  const third=catalog.versions.find((v:any)=>v.mapId===b && v.version===3);
  assert.ok(third,JSON.stringify(provider.requests.at(-1)?.body.messages?.at(-1)));
  assert.equal(third.choice,manual.choice);assert.equal(third.unknowns,'平销周效果未知');
  const native=await readFile(detail.snapshot.sessionFile,'utf8');
  assert.ok(native.split('\n').filter(Boolean).some(line=>JSON.parse(line).id===third.source.version));
  assert.equal((await api(route+'/simulations')).trials.length,1);
  const beforeFailure=await api(route),failedRequest=randomUUID(),pinned={mapId:b,version:2,edgeId:'已移除的连线'};
  const beforeDispatch=provider.requests.length;
  const unavailable=await host.request(route+'/messages','POST',{requestId:failedRequest,text:'沿此版检查',expectedRevision:beforeFailure.discussion.revision,mapTemplate:'bsc',mapRef:pinned,attachmentIds:[]});
  assert.equal(unavailable.status,400);
  const recovered=(await api(route)).discussion.pendingInput;
  assert.deepEqual(recovered.mapRef,pinned);assert.equal(recovered.mapTemplate,'bsc');assert.deepEqual(recovered.attachmentIds,[]);
  assert.equal(provider.requests.length,beforeDispatch);
  assert.deepEqual(provider.errors,[]);t.diagnostic('隔离 Host 数据和原生 Pi 会话 '+host.dataRoot);
});
