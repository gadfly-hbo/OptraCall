import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { mapDraft, type StrategyMapVersion } from '../src/host/strategy-map-types.ts';

test('original strategy conversation exposes saved map edits to Pi, traces its exact save and rejects a stale revision', {timeout:60000}, async t=>{
  const host=await startTestHost(),provider=await startToolProvider();
  t.after(async()=>{await host.close();await provider.close();});
  async function api(route:string,method='GET',body?:unknown,status=200){
    const r=await host.request(route,method,body);assert.equal(r.status,status,await r.clone().text());return r.json();
  }
  await api('/api/configuration','PUT',{name:'地图合成模型',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'synthetic',apiKey:'synthetic-only'});
  const {discussion}=await api('/api/strategy/discussions','POST',{operationId:randomUUID(),title:'会员工作室'},201);
  const base='/api/strategy/discussions/'+discussion.id;
  async function turn(text:string,args:Record<string,unknown>){
    let receipt='';
    provider.setResponder(({recentToolResults})=>{
      if(!recentToolResults.length)return {calls:[{name:'strategy_goals',arguments:args}]};
      receipt=providerMessageText(recentToolResults.at(-1)?.content);
      return {text:'已核对回执。'};
    });
    const before=await api(base),requestId=randomUUID();
    await api(base+'/messages','POST',{requestId,expectedRevision:before.discussion.revision,text,mapTemplate:'bsc'},202);
    const deadline=Date.now()+18000;
    while(Date.now()<deadline){
      const detail=await api(base);
      if(!detail.busy&&detail.discussion.lastRun?.id===requestId){assert.equal(detail.discussion.lastRun.status,'completed');return receipt;}
      await delay(35);
    }
    throw new Error('strategy map turn timed out');
  }
  const draft={title:'首购回访',template:'bsc',choice:'先回访',assumptions:'导购有工时',nodes:[{id:'G1',kind:'goal',title:'提高二购率',target:'12',unit:'%',perspective:'客户'},{id:'S1',kind:'strategy',title:'回店邀请'}],edges:[{id:'e1',from:'S1',to:'G1',kind:'hypothesis'}]};
  const receipt=await turn('把讨论保存为候选地图。',{action:'save-map',mapDraft:draft,reason:'确定候选'});
  assert.match(receipt,/candidate-not-adopted/);
  const first=(await api(base+'/maps')).versions[0] as StrategyMapVersion;
  assert.ok(first.requestId);assert.equal(first.source?.id,discussion.id);assert.equal(first.title,draft.title);
  const fixed={...mapDraft(first),nodes:first.nodes.map((n,i)=>i?n:{...n,target:'13.5'})};
  const manual=(await api(base+'/maps','POST',{mapId:first.mapId,expectedVersion:1,operationId:randomUUID(),reason:'用户核对年度目标',draft:fixed},201)).version;
  assert.equal(manual.version,2);
  assert.equal(manual.requestId,undefined);
  await api(base+'/maps','POST',{mapId:first.mapId,expectedVersion:2,operationId:randomUUID(),reason:'伪造来源',draft:fixed,requestId:first.requestId,author:'agent'},400);
  assert.equal((await api(base+'/maps')).versions.length,2);
  const offset=provider.requests.length;
  const read=await turn('重新核对刚才手改后的目标。',{action:'read-map',mapId:first.mapId,version:2});
  assert.match(read,/13.5/);
  const messages=provider.requests[offset].body.messages??[];
  const context=messages.filter(m=>m.role==='user').map(m=>providerMessageText(m.content)).at(-1)??'';
  assert.match(context,/"target":"13.5"/);
  assert.match(context,/"preferredMapTemplate":"bsc"/);
  const stale=await turn('修改旧稿。',{action:'save-map',mapId:first.mapId,expectedVersion:1,mapDraft:draft,reason:'模拟并发'});
  assert.match(stale,/strategy_map_version_conflict/);
  assert.equal((await api(base+'/maps')).versions.length,2);
  const invalidReceipt=await turn('提交节点编号重复的候选。',{action:'save-map',mapDraft:{...draft,nodes:[draft.nodes[0]!,draft.nodes[0]!]},reason:'合成重复节点校验'});
  assert.match(invalidReceipt,/invalid_strategy_map/);
  assert.match(invalidReceipt,/duplicate_item_id/);
  assert.doesNotMatch(invalidReceipt,/personal_context_read_failed/);
  assert.equal((await api(base+'/maps')).versions.length,2,'Host semantic validation must not write a map version');
  const httpFault=await api(base+'/maps','POST',{mapId:first.mapId,expectedVersion:2,operationId:randomUUID(),reason:'HTTP 重复节点校验',draft:{...fixed,nodes:[fixed.nodes[0]!,fixed.nodes[0]!]}},400);
  assert.equal(httpFault.code,'invalid_strategy_map');
  assert.equal(httpFault.accepted,false);
  assert.ok(!JSON.stringify(httpFault).includes('duplicate_item_id'),'HTTP keeps its existing generic safe message instead of exposing Agent details');
  assert.equal((await api(base+'/maps')).versions.length,2);
  const recovered=await turn('修正重复编号后保存新候选。',{action:'save-map',mapDraft:{...draft,title:'修正后的候选'},reason:'修正后保存'});
  assert.match(recovered,/candidate-not-adopted/);
  const versions=(await api(base+'/maps')).versions as StrategyMapVersion[];
  assert.equal(versions.length,3);
  assert.ok(versions.some(version=>version.title==='修正后的候选'&&version.version===1));
});

test('Issue 115 treats an absolute path as text, exposes no file tool and rejects it as an unselected source ID', {timeout:60000}, async t=>{
  const host=await startTestHost(),provider=await startToolProvider();
  t.after(async()=>{await host.close();await provider.close();});
  const req=async(route:string,method='GET',body?:unknown,status=200)=>{
    const res=await host.request(route,method,body);assert.equal(res.status,status,await res.clone().text());return res.json();
  };
  await req('/api/configuration','PUT',{name:'路径合成模型',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'synthetic',apiKey:'synthetic-only'});
  const {discussion}=await req('/api/strategy/discussions','POST',{operationId:randomUUID(),title:'路径边界'},201);
  const base='/api/strategy/discussions/'+discussion.id,file=path.join(host.scratch,'path-only.md'),marker='SYNTHETIC_PATH_FILE_MUST_NOT_BE_READ';
  await writeFile(file,'# 合成路径文件\n'+marker,'utf8');
  let receipt='';
  provider.setResponder(({recentToolResults})=>{
    if(!recentToolResults.length)return {calls:[{name:'strategy_goals',arguments:{action:'read-source',sourceId:file}}]};
    receipt=providerMessageText(recentToolResults.at(-1)?.content);
    return {text:'未能通过来源 ID 读取该路径。'};
  });
  const before=await req(base),requestId=randomUUID();
  await req(base+'/messages','POST',{requestId,expectedRevision:before.discussion.revision,text:`请读取 ${file}`},202);
  let detail=await req(base);
  for(let n=0;n<400&&(detail.busy||detail.discussion.lastRun?.id!==requestId);n++){await delay(25);detail=await req(base);}
  assert.equal(detail.discussion.lastRun.status,'completed');
  assert.equal(receipt,'strategy_discussion_source_not_selected');
  assert.deepEqual(detail.snapshot.tools,['strategy_goals']);
  const captured=JSON.stringify(provider.requests.map(request=>request.body));
  assert.ok(captured.includes(file),'the user path remains visible as prompt text');
  assert.ok(!captured.includes(marker),'no Host or SDK path read may disclose the synthetic file body');
  t.diagnostic('Proven boundary: no general file tool and no source-ID match. The real models\' chosen failure path remains separately unproved.');
});

test('Issue 115 rework: invalid edge ID does not echo a raw path and scenario validation keeps a stable code', {timeout:60000}, async t=>{
  const host=await startTestHost(),provider=await startToolProvider();
  t.after(async()=>{await host.close();await provider.close();});
  const api=async(route:string,method='GET',body?:unknown,status=200)=>{const r=await host.request(route,method,body);assert.equal(r.status,status,await r.clone().text());return r.json();};
  await api('/api/configuration','PUT',{name:'返工错误契约',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'synthetic',apiKey:'synthetic-only'});
  const {discussion}=await api('/api/strategy/discussions','POST',{operationId:randomUUID(),title:'返工错误契约'},201);
  const base='/api/strategy/discussions/'+discussion.id;
  const secretPath='/Users/synthetic/private-strategy-plan.md';
  const baseDraft={title:'返工候选',template:'table',choice:'',assumptions:'',unknowns:'',nodes:[{id:'G1',kind:'goal',title:'目标'}],edges:[]};
  async function turn(args:Record<string,unknown>){
    let receipt='';
    provider.setResponder(({recentToolResults})=>{if(!recentToolResults.length)return {calls:[{name:'strategy_goals',arguments:args}]};receipt=providerMessageText(recentToolResults.at(-1)?.content);return {text:'已核对。'};});
    const before=await api(base),requestId=randomUUID();
    await api(base+'/messages','POST',{requestId,expectedRevision:before.discussion.revision,text:'合成校验'},202);
    let d=await api(base);for(let n=0;n<400&&(d.busy||d.discussion.lastRun?.id!==requestId);n++){await delay(25);d=await api(base);}
    assert.equal(d.discussion.lastRun.status,'completed');
    return {receipt,detail:d};
  }
  const badEdge=await turn({action:'save-map',mapDraft:{...baseDraft,edges:[{id:secretPath,from:'G1',to:'G1',kind:'supports'}]},reason:'合成无效连线'});
  assert.match(badEdge.receipt,/invalid_strategy_map/);
  assert.match(badEdge.receipt,/invalid_edge_endpoint/);
  assert.match(badEdge.receipt,/edges\[0\]/,'the error is located by structural position');
  assert.ok(!badEdge.receipt.includes(secretPath),'the tool error receipt must not echo the raw path ID');
  const nativeEntries=(await readFile(badEdge.detail.snapshot.sessionFile,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  const nativeToolResults=nativeEntries.filter(e=>e.message?.role==='toolResult');
  assert.ok(nativeToolResults.length>0);
  assert.ok(!JSON.stringify(nativeToolResults).includes(secretPath),'native toolResult must not echo the raw path ID');
  const snapToolResults=(badEdge.detail.snapshot.messages||[]).filter((m:any)=>m.role==='toolResult');
  assert.ok(!JSON.stringify(snapToolResults).includes(secretPath),'discussion snapshot toolResult must not echo the raw path ID');
  const nextToolMessages=(provider.requests.at(-1)?.body.messages||[]).filter((m:any)=>m.role==='tool');
  assert.ok(!JSON.stringify(nextToolMessages).includes(secretPath),'the next Provider tool result must not echo the raw path ID');
  assert.equal((await api(base+'/maps')).versions.length,0,'invalid submission keeps zero writes');
  const scenario={population:'合成',metric:'复购',unit:'%',period:'季',basis:'合成依据',liftPoints:5,coverage:50,coverageAdjustable:true};
  const badScenario=await turn({action:'save-map',mapDraft:{...baseDraft,scenarioModel:{...scenario,baselineRate:-1}},reason:'合成场景校验'});
  assert.match(badScenario.receipt,/invalid_scenario_baseline_rate/,'known scenario validation keeps a stable code in the tool chain');
  assert.ok(!badScenario.receipt.includes('host_tool_failed'),'known scenario validation must not be masked by the neutral fallback');
  assert.equal((await api(base+'/maps')).versions.length,0);
  const good=await turn({action:'save-map',mapDraft:{...baseDraft,scenarioModel:{...scenario,baselineRate:10}},reason:'修正后保存'});
  assert.match(good.receipt,/candidate-not-adopted/);
  assert.equal((await api(base+'/maps')).versions.length,1,'corrected input saves one version');
});

test('a map references only the cited attachment version and follows its authorization after replacement and revocation', {timeout:60000}, async t=>{
  const host=await startTestHost(), provider=await startToolProvider();
  t.after(async()=>{await host.close();await provider.close();});
  const req=async(route:string,method='GET',body?:unknown,status=200)=>{
    const res=await host.request(route,method,body);assert.equal(res.status,status,await res.clone().text());return res.json();
  };
  await req('/api/configuration','PUT',{name:'附件地图模型',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'synthetic',apiKey:'synthetic-only'});
  const {discussion}=await req('/api/strategy/discussions','POST',{operationId:randomUUID(),title:'地图资料回归'},201);
  const base='/api/strategy/discussions/'+discussion.id;
  async function add(revision:number,text:string){return (await req(base+'/attachments','POST',{name:'渠道调研.txt',content:Buffer.from(text).toString('base64'),expectedRevision:revision})).source;}
  const first=await add(1,'渠道复盘\n促销期样例'), owner=(await req(base,'PATCH',{sources:[first],expectedRevision:1})).discussion;
  let token='';
  provider.setResponder(({recentToolResults})=>{
    if(!recentToolResults.length)return {calls:[{name:'strategy_goals',arguments:{action:'read-source',sourceId:first.id,query:'第 2 行'}}]};
    const result=JSON.parse(providerMessageText(recentToolResults.at(-1)?.content));
    if(result.read){
      token=result.read.locations[0].token;
      const draft={title:'导购回访',template:'table',nodes:[{id:'G',kind:'goal',title:'二购'}],edges:[],assumptions:'只覆盖促销期'};
      return {calls:[{name:'strategy_goals',arguments:{action:'save-map',mapDraft:draft,citationTokens:[token],reason:'按促销期形成候选'}}]};
    }
    return {text:'已按促销期资料保存候选。[[资料:'+token+']]'};
  });
  const requestId=randomUUID();
  await req(base+'/messages','POST',{requestId,text:'据原文保存一版地图。',expectedRevision:owner.revision},202);
  let state=await req(base);
  for(let n=0;n<400 && (state.busy||state.discussion.lastRun?.status!=='completed');n++){await delay(25);state=await req(base);}
  const initial=await req(base+'/maps');
  const v=initial.versions[0] as StrategyMapVersion;
  assert.ok(v,'The real Pi tool saved the map.');assert.equal(v.citations[0]?.token,token);
  assert.equal(v.citations[0].source.sha256,first.sha256);assert.notEqual(v.replySource?.version,v.source?.version);assert.ok(v.replySource?.sha256);
  const second=await add(state.discussion.revision,'平时样例');
  state=await req(base,'PATCH',{sources:[second],expectedRevision:state.discussion.revision});
  const exportRoute=base+'/maps/'+v.mapId+'/versions/'+v.version+'/export';
  const old=(await req(base+'/maps')).versions[0];
  assert.equal(old.contentSha256,v.contentSha256);assert.equal(old.citations[0].source.sha256,first.sha256);
  assert.equal((await req(base+'/attachments/excerpt','POST',{citation:old.citations[0]})).text,'促销期样例');
  assert.equal((await host.request(exportRoute)).status,200);
  await req(base,'PATCH',{sources:[],expectedRevision:state.discussion.revision});
  const revoked=await req(base+'/maps');
  assert.equal(revoked.versions.length,0);assert.equal(revoked.unavailable[0].version,v.version);
  assert.equal((await host.request(exportRoute)).status,403);
});

test('Pi cannot resume with a different readable map after its original context or read-map result loses the workbook', {timeout:60000},async t=>{
  const {rename,readFile}=await import('node:fs/promises');
  const {join}=await import('node:path');
  const XLSX=await import('xlsx');
  const {defaultSelection}=await import('../src/host/strategy-workbook-types.ts');
  const host=await startTestHost(), provider=await startToolProvider();
  t.after(async()=>{await host.close();await provider.close();});
  const api=async(route:string,method='GET',body?:unknown,status=200)=>{
    const r=await host.request(route,method,body);assert.equal(r.status,status,await r.clone().text());return r.json();
  };
  await api('/api/configuration','PUT',{name:'历史授权',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'synthetic',apiKey:'synthetic-only'});
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['目标编号','目标项','指标'],['G1','历史范围','旧版本特有指标']]),'目标表');
  const fileName='历史口径.xlsx',bytes=XLSX.write(workbook,{bookType:'xlsx',type:'base64'});
  const {book}=await api('/api/strategy/workbooks/preview','POST',{fileName,bytes});
  for(const mode of ['prompt','tool','catalog','unseen'] as const){
    const id=randomUUID(),base='/api/strategy/discussions/'+id;
    const owner=(await api('/api/strategy/discussions','POST',{operationId:id},201)).discussion;
    const workbookMap=(await api('/api/strategy/workbooks/commit','POST',{fileName,bytes,target:'map',discussionId:id,selection:defaultSelection(book,'map'),title:'有原件的旧方案',template:'table'})).version as StrategyMapVersion;
    if(mode==='tool'||mode==='unseen'){
      const updated=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(updated,XLSX.utils.aoa_to_sheet([['目标编号','目标项','指标'],['G1','独立新版','第二版指标']]),'目标表');
      const revised=await api('/api/strategy/workbooks/commit','POST',{fileName,bytes:XLSX.write(updated,{bookType:'xlsx',type:'base64'}),
        target:'map',discussionId:id,selection:defaultSelection(book,'map'),title:'较新方案',template:'table',
        base:{discussionId:id,mapId:workbookMap.mapId,version:1,sha256:workbookMap.contentSha256}});
      assert.equal(revised.version.version,2);
    }
    const ordinary=(await api(base+'/maps','POST',{operationId:randomUUID(),mapId:randomUUID(),expectedVersion:0,reason:'无外部依赖',draft:{title:'独立方向',template:'table',nodes:[{kind:'goal',id:'G',title:'独立目标'}],edges:[]}},201)).version as StrategyMapVersion;
    provider.setResponder(({recentToolResults})=>{
      if(mode==='tool'&&!recentToolResults.length)return {calls:[{name:'strategy_goals',arguments:{action:'read-map',mapId:workbookMap.mapId,version:1,offset:0,limit:128}}]};
      return {text:'已按此版核对。'};
    });
    const choice=mode==='prompt'?workbookMap:ordinary;
    await api(base+'/messages','POST',{requestId:randomUUID(),text:'比较候选方向。',mapRef:{mapId:choice.mapId,version:1},expectedRevision:owner.revision},202);
    let state=await api(base);for(let n=0;n<400 && state.busy;n++){await delay(20);state=await api(base);}
    assert.equal(state.discussion.lastRun.status,'completed');
    // The original handoff reuses an exact assistant source, so it has the
    // same dependencies even if the user is currently looking at another map.
    await api(base+'/versions','POST',{expectedRevision:state.discussion.revision,source:state.replies.at(-1).source,
      options:'两个方向',choice:'待核',rationale:'参照原讨论',assumptions:'待试点',unknowns:'待核'},201);
    state=await api(base);
    const before=provider.requests.length;
    const file=join(host.dataRoot,'strategy-workbooks','discussion-'+id,workbookMap.importSource!.sha256+'.xlsx');
    await rename(file,file+'.unavailable');
    assert.ok((await api(base+'/maps')).versions.some((v:StrategyMapVersion)=>v.mapId===ordinary.mapId),'the newly selected alternative remains readable');
    if(mode!=='unseen')await api(base+'/versions/1/handoff','POST',{expectedRevision:state.discussion.revision,scope:{id:'self',kind:'personal',name:'个人工作'}},409);
    const response=await host.request(base+'/messages','POST',{requestId:randomUUID(),text:'换另一个方向继续。',mapRef:{mapId:ordinary.mapId,version:1},expectedRevision:state.discussion.revision});
    if(mode==='unseen'){
      assert.equal(response.status,202,'a version never sent or read cannot become a history dependency');
      for(let n=0;n<400 && (await api(base)).busy;n++)await delay(20);
      assert.ok(provider.requests.length>before);
    }else{
      assert.equal(response.status,409,'lost '+mode+' material must block dispatch');
      assert.equal(provider.requests.length,before,'no request may replay the lost '+mode+' material');
    }
    const records=(await readFile(state.snapshot.sessionFile,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    const provided=records.find(row=>row.customType==='optracall.run'&&row.data.phase==='started').data.providedContext.strategyDiscussion;
    assert.deepEqual(provided.mapExposure.map((x:{mapId:string;version:number;kind:string})=>[x.mapId,x.version,x.kind]),[[workbookMap.mapId,mode==='tool'||mode==='unseen'?2:1,mode==='prompt'?'body':'catalog'],[ordinary.mapId,1,mode==='prompt'?'catalog':'body']]);
  }
});
