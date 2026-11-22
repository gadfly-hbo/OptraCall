import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {randomUUID} from 'node:crypto';
import {startTestHost} from './fixtures/host-process.ts';
import {defaultSelection} from '../src/host/strategy-workbook-types.ts';

test('真实 Host：Excel 预览不写业务，精确地图交接多个 G/S，采用后建 Case，原工作簿可按版回读',{timeout:90000},async t=>{
  const host=await startTestHost();t.after(()=>host.close());
  async function api(route:string,method='GET',input?:unknown,status=200){
    const response=await host.request(route,method,input),result=await response.json();
    assert.equal(response.status,status,JSON.stringify({route,result}));return result;
  }
  await api('/api/configuration','PUT',{name:'本地测试',provider:'openai-compatible',baseUrl:'http://127.0.0.1:14998/v1',model:'synthetic',apiKey:'synthetic-local'});
  const discussionId=randomUUID();
  await api('/api/strategy/discussions','POST',{operationId:discussionId,title:'线下会员讨论'},201);
  const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['目标编号','目标项','指标','基线','目标值','关联策略编号'],['G1','留存','90日复购率','9%',null,'S1,S2'],['G2','覆盖','接通人数',0,10,'S1']]);
  XLSX.utils.book_append_sheet(workbook,sheet,'目标表');
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['策略编号','策略名称'],['S1','门店回访'],['S2','预约活动']]),'战略地图');
  const fileName='线下讨论.xlsx',bytes=XLSX.write(workbook,{bookType:'xlsx',type:'base64'}) as string;
  const endpoint='/api/strategy/workbooks/',{book}=await api(endpoint+'preview','POST',{fileName,bytes});
  assert.equal((await api('/api/strategy/goals')).goals.length,0);
  const selection=defaultSelection(book,'map'),input={fileName,bytes,target:'map',discussionId,selection,title:'会员经营',template:'bsc'};
  const invalid=await api(endpoint+'commit','POST',{...input,selection:{goals:selection.goals}});
  assert.match(invalid.errors.join(' '),/未匹配/);
  const {access}=await import('node:fs/promises'),{join:rootPath}=await import('node:path');
  const ghost=randomUUID();
  await api(endpoint+'commit','POST',{...input,discussionId:ghost},404);
  await assert.rejects(access(rootPath(host.dataRoot,'strategy-workbooks','discussion-'+ghost)),{code:'ENOENT'});
  const {version}=await api(endpoint+'commit','POST',input);
  assert.equal(version.nodes.length,4);assert.equal(version.author,'import');
  assert.deepEqual((await api(endpoint+'commit','POST',input)).version,version);
  const map={discussionId,mapId:version.mapId,version:1,sha256:version.contentSha256};
  const {publication}=await api(`/api/strategy/discussions/${discussionId}/maps/${version.mapId}/versions/1/publication`,'POST',{operationId:randomUUID(),sha256:version.contentSha256},201);
  assert.equal((await api(endpoint+'map-source','POST',map)).bytes,bytes);
  const dest={scope:{kind:'personal',id:'self',name:'个人工作'},perspective:'personal'};
  const {goals}=await api(endpoint+'handoff','POST',{map,publicationId:publication.publicationId,selected:['G1','G2'],...dest});
  assert.equal(goals.length,2);assert.equal(goals[0].structured.map.version,1);
  assert.deepEqual((await api(endpoint+'handoff','POST',{map,publicationId:publication.publicationId,selected:['G1','G2'],...dest})).goals,goals);
  await api('/api/cases/storage/initialize','POST',{});
  for(const g of goals){
    assert.equal(g.status,'candidate');
    await api('/api/strategy/goals/'+g.goalId+'/adopt','POST',{version:1,expectedVersion:1,operationId:randomUUID(),decision:'明确采用此项'});
    for(const strategy of g.strategies){
      const bind={primary:{goalId:g.goalId,version:1},strategy,related:[]};
      const c=(await api('/api/cases','POST',{operationId:randomUUID(),title:g.title+' · '+strategy,goalBinding:bind},201)).case;
      assert.equal((await api('/api/cases/goal-match','POST',{primary:bind.primary,strategy})).caseId,c.id);
      const binding=(await api('/api/cases/'+c.id+'/goals')).goalBinding;assert.deepEqual(binding.primary,bind.primary);assert.equal(binding.strategy,strategy);
    }
  }
  assert.equal((await api('/api/cases')).cases.length,3);
  assert.equal((await api(endpoint+'goal-source','POST',{goalId:goals[0].goalId,version:1})).bytes,bytes);
  const {html}=await api('/api/strategy/goals/'+goals[0].goalId+'/versions/1/export');assert.match(html,/90日复购率/);assert.match(html,/待定/);
  // The same input workbook may be imported as goals directly with no discussion or intermediate map.
  delete sheet.F2;delete sheet.F3;
  const onlyBytes=XLSX.write(workbook,{bookType:'xlsx',type:'base64'}) as string,second=(await api(endpoint+'preview','POST',{fileName,bytes:onlyBytes})).book;
  const direct={fileName,bytes:onlyBytes,target:'goals',title:'仅目标',selection:{goals:defaultSelection(second,'goals').goals},destination:dest};
  const batch=(await api(endpoint+'commit','POST',direct)).goals;
  assert.equal(batch.length,2);assert.equal(batch[1].structured.metrics[0].baseline,'0');assert.ok(!batch[0].structured.map);
  assert.deepEqual((await api(endpoint+'commit','POST',direct)).goals,batch);
  const expected=Object.fromEntries(batch.map((g:any)=>[g.structured.nodeId,{goalId:g.goalId,version:1}]));
  sheet.D3.v=8;
  const revisedBytes=XLSX.write(workbook,{bookType:'xlsx',type:'base64'}) as string;
  const revised={...direct,bytes:revisedBytes,groupId:batch[0].structured.groupId,destination:{...dest,expected}};
  await api(endpoint+'commit','POST',{...revised,destination:{...dest,expected:{...expected,G2:{...expected.G2,version:3}}}},409);
  const {discussionHash}=await import('../src/host/strategy-discussion-store.ts');
  const {groupScopeKey}=await import('../src/host/structured-goal.ts');
  const {createHash}=await import('node:crypto');
  const rejectedHash=createHash('sha256').update(Buffer.from(revisedBytes,'base64')).digest('hex');
  const rejectedFile=rootPath(host.dataRoot,'strategy-workbooks',discussionHash(['scope',groupScopeKey({kind:'personal',id:'self',name:'个人工作'})]),rejectedHash+'.xlsx');
  await assert.rejects(access(rejectedFile),{code:'ENOENT'});
  assert.equal((await api('/api/strategy/goals/'+batch[0].goalId)).goal.currentVersion,1);
  const saved=(await api(endpoint+'commit','POST',revised)).goals;
  assert.equal(saved[1].goalId,batch[1].goalId);assert.equal(saved[1].version,2);
  // General writes, including proposals through the same Store, cannot mint workbook or map provenance.
  const rootCandidate=batch[0];
  await api('/api/strategy/goals','POST',{...rootCandidate,operationId:randomUUID()},409);
  const amended={...saved[0],outcome:'人工修正',operationId:randomUUID(),expectedVersion:saved[0].version};delete amended.structured;
  const manual=(await api('/api/strategy/goals/'+saved[0].goalId+'/revisions','POST',amended,201)).goal;
  assert.deepEqual(manual.structured,saved[0].structured);
  assert.equal((await api(endpoint+'goal-source','POST',{goalId:batch[0].goalId,version:1})).bytes,onlyBytes);
  // Losing the original file prevents public index/single-version/receipt and export reads from returning the withdrawn source.
  const {rename}=await import('node:fs/promises'),{join}=await import('node:path');
  const rawFile=join(host.dataRoot,'strategy-workbooks','discussion-'+discussionId,book.sha256+'.xlsx');
  await rename(rawFile,rawFile+'.unavailable');
  await api(endpoint+'handoff','POST',{map,publicationId:publication.publicationId,selected:['G2'],...dest},409);
  const reopened=await host.request('/api/strategy/discussions/'+discussionId+'/maps/'+map.mapId+'/versions/1/export');
  assert.equal(reopened.status,409);
  const filtered=await api('/api/strategy/goals');
  assert.ok(filtered.unavailableGoalSources.length);
  assert.ok(!filtered.goals.some((r:any)=>r.id===goals[0].goalId));
  assert.ok(filtered.goals.some((r:any)=>r.id===batch[0].goalId));
  await api('/api/strategy/goals/'+goals[0].goalId,'GET',undefined,409);
  await api(endpoint+'goal-source','POST',{goalId:goals[0].goalId,version:1},409);

});

test('重排无稳定编号的工作簿，目标与地图都不能按原行修订，原 Case 引用保留',{timeout:60000},async t=>{
  const host=await startTestHost();t.after(()=>host.close());
  async function post(path:string,data:unknown,status=200){
    const r=await host.request(path,'POST',data),v=await r.json();assert.equal(r.status,status,JSON.stringify(v));return v;
  }
  const make=(titles:string[])=>{
    const b=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet([['策略编号','策略名称'],['S1','回访']]),'战略地图');
    XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet([['目标项','指标','关联策略编号'],...titles.map(n=>[n,n+'人数','S1'])]),'目标表');
    return XLSX.write(b,{type:'base64',bookType:'xlsx'}) as string;
  };
  await host.request('/api/configuration','PUT',{name:'隔离',provider:'openai-compatible',baseUrl:'http://127.0.0.1:14998/v1',model:'synthetic',apiKey:'synthetic'});
  const discussionId=randomUUID();await post('/api/strategy/discussions',{operationId:discussionId,title:'重排行'},201);
  const ep='/api/strategy/workbooks/',original=make(['零售','服务']),reordered=make(['服务','零售']),fileName='分目标.xlsx';
  const book=(await post(ep+'preview',{fileName,bytes:original})).book,selection=defaultSelection(book,'map');
  const input={fileName,selection,title:'目标表',bytes:original},dest={scope:{kind:'personal',id:'self',name:'个人工作'},perspective:'personal'};
  const map=(await post(ep+'commit',{...input,discussionId,target:'map'})).version;
  const goals=(await post(ep+'commit',{...input,target:'goals',destination:dest})).goals;
  await post('/api/cases/storage/initialize',{});const g=goals[0];
  await post('/api/strategy/goals/'+g.goalId+'/adopt',{version:1,expectedVersion:1,operationId:randomUUID(),decision:'采用'});
  const binding={primary:{goalId:g.goalId,version:1},related:[],strategy:g.strategies[0]};
  const c=(await post('/api/cases',{title:'跟进零售',operationId:randomUUID(),goalBinding:binding},201)).case;
  const {code}=await post(ep+'commit',{...input,bytes:reordered,discussionId,target:'map',base:{discussionId,mapId:map.mapId,version:1,sha256:map.contentSha256}},409);
  assert.equal(code,'strategy_workbook_unstable_ids');
  const expected=Object.fromEntries(goals.map((g:any)=>[g.structured.nodeId,{goalId:g.goalId,version:1}]));
  const denied=await post(ep+'commit',{...input,target:'goals',bytes:reordered,groupId:g.structured.groupId,destination:{...dest,expected}},409);
  assert.equal(denied.code,'strategy_workbook_unstable_ids');
  const reread=(await(await host.request('/api/strategy/goals/'+g.goalId)).json()).goal;assert.equal(reread.currentVersion,1);assert.equal(reread.versions[0].title,'零售');
  assert.deepEqual((await(await host.request('/api/cases/'+c.id+'/goals')).json()).goalBinding.primary,binding.primary);
  const fresh=(await post(ep+'commit',{...input,target:'goals',destination:dest,bytes:reordered})).goals;
  assert.notEqual(fresh[0].goalId,g.goalId);assert.equal(fresh[0].title,'服务');
});

test('人工清空地图指标字段后，重开 v2 可交接目标并保留两版原值',async t=>{
  let host=await startTestHost();
  t.after(()=>host.close());
  async function api(route:string,method='GET',body?:unknown,status=200){
    const response=await host.request(route,method,body),result=await response.json();
    assert.equal(response.status,status,JSON.stringify({route,result}));return result;
  }
  await api('/api/configuration','PUT',{name:'地图交接',provider:'openai-compatible',baseUrl:'http://127.0.0.1:14998/v1',model:'synthetic',apiKey:'synthetic-local'});
  const discussionId=randomUUID(),mapId=randomUUID(),route='/api/strategy/discussions/'+discussionId+'/maps';
  await api('/api/strategy/discussions','POST',{operationId:discussionId,title:'地图手工修订'},201);
  const primary={metric:'复购率',baseline:'0',target:'12%',unit:'%',period:'90天',baselineKind:'实测'};
  const secondary={metric:'覆盖率',baseline:'9%',target:'待定',unit:'%',period:'上月',baselineKind:'实测'};
  const node={id:'G1',kind:'goal',title:'会员经营',...primary,metrics:[secondary]};
  const draft={title:'会员试点',template:'table',nodes:[node],edges:[]};
  const save=(expectedVersion:number,nodes:typeof draft.nodes)=>api(route,'POST',{mapId,operationId:randomUUID(),expectedVersion,reason:'人工修订指标',draft:{...draft,nodes}},201);
  const other={...node,id:'G2',title:'新店咨询',metric:'咨询量',metrics:[]};
  const first=(await save(0,[node,other])).version;
  const edited={...node,period:'',baselineKind:'  ',metrics:[{...secondary,baseline:'',target:'',unit:' ',baselineKind:'',period:''},
    {...secondary,metric:'到店率',target:'待定',baseline:'0%',period:'年度'}]};
  const second=(await save(1,[edited,{...other,baseline:' ',baselineKind:'',target:'',unit:'',period:''}])).version;
  assert.equal(second.version,2);
  assert.equal(first.nodes[0].period,'90天');
  assert.equal(second.nodes[0].period,'');
  assert.equal(second.nodes[1].baseline,' ');
  const {dataRoot,projectsRoot}=host;
  await host.close();host=await startTestHost({dataRoot,projectsRoot});
  const {versions}=await api(route);
  assert.deepEqual(versions.find((map:any)=>map.version===1),first);
  assert.deepEqual(versions.find((map:any)=>map.version===2),second);
  const map={discussionId,mapId,version:2,sha256:second.contentSha256};
  const {publication}=await api(`/api/strategy/discussions/${discussionId}/maps/${mapId}/versions/2/publication`,'POST',{operationId:randomUUID(),sha256:second.contentSha256},201);
  const {goals}=await api('/api/strategy/workbooks/handoff','POST',{map,publicationId:publication.publicationId,selected:['G1','G2'],scope:{kind:'personal',id:'self',name:'个人工作'},perspective:'personal'});
  const {goal}=await api('/api/strategy/goals/'+goals[0].goalId);
  const saved=goal.versions[0];
  assert.deepEqual(saved.structured.map,map);
  assert.deepEqual(saved.structured.metrics,[
    {metric:'复购率',baseline:'0',target:'12%',unit:'%'},
    {metric:'覆盖率'},
    {...edited.metrics[1]}
  ]);
  assert.equal(saved.baseline.state,'known');
  assert.match(saved.measurement.criterion,/覆盖率 目标值待定/);
  const pending=(await api('/api/strategy/goals/'+goals[1].goalId)).goal.versions[0];
  assert.deepEqual(pending.structured.metrics,[{metric:'咨询量'}]);
  assert.deepEqual(pending.baseline,{state:'pending',description:'基线待补'});
  assert.deepEqual((await api(route)).versions,versions);
});
