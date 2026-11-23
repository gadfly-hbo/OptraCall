import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { StrategyDiscussionStore } from '../src/host/strategy-discussion-store.ts';
import { StrategyMapStore } from '../src/host/strategy-map-store.ts';

test('map revisions preserve hand edits, reject stale drafts and isolate edge reviews and source owners', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'strategy-map-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const discussions = new StrategyDiscussionStore(root);
  const id = discussions.create({operationId:randomUUID()}, {id:'test',revision:1}).id;
  const maps = new StrategyMapStore(discussions), mapId = randomUUID();
  const review = {summary:'可能提高复购',mechanism:'回访提醒',condition:'能联系会员',alternative:'季节',risk:'工时',scope:'试点',test:'同店同期观察'};
  const draft = {title:'回访',template:'bsc',choice:'分组回访',excluded:'普发券',assumptions:'可触达',unknowns:'回访工时',
    nodes:[{id:'G1',kind:'goal',title:'复购',target:'0',unit:'%'},{id:'S1',kind:'strategy',title:'导购回访'}],
    edges:[{id:'e1',from:'S1',to:'G1',kind:'hypothesis',review}]};
  const initial = {mapId,expectedVersion:0,operationId:randomUUID(),reason:'原讨论形成候选',draft};
  const first = await maps.save(id,initial,'user');
  assert.equal(first.version,1);
  assert.deepEqual(await maps.save(id,initial,'user'),first);
  await assert.rejects(()=>maps.save(id,{...initial,reason:'已变'},'user'));
  const manual = {...initial,expectedVersion:1,operationId:randomUUID(),draft:{...draft,template:'tree',edges:[{id:'e1',from:'S1',to:'G1',kind:'hypothesis'}]}};
  const second = await maps.save(id,manual,'user');
  assert.equal(second.edges[0].review,undefined);
  assert.deepEqual((await new StrategyMapStore(discussions).read(id,mapId,1)).edges[0].review,review);
  assert.equal(second.nodes[0].target,'0');
  await assert.rejects(()=>maps.save(id,{...manual,operationId:randomUUID()},'user'),/strategy_map_version_conflict/);
  for(const edges of [[{id:'bad',from:'missing',to:'G1',kind:'supports'}],[{id:'bad',from:'G1',to:'S1',kind:'decomposition',review}]]){
    await assert.rejects(()=>maps.save(id,{...manual,operationId:randomUUID(),expectedVersion:2,draft:{...draft,edges}},'agent'));
  }
  assert.equal((await maps.list(id)).length,2);
  const other = discussions.create({operationId:randomUUID()}, {id:'test',revision:1}).id;
  await assert.rejects(()=>maps.read(other,mapId,1));
});

test('Issue 115 map validation uses stable codes and whitelisted details without writing failed versions', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'issue115-map-validation-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const discussions = new StrategyDiscussionStore(root), id = discussions.create({operationId:randomUUID()}, {id:'test',revision:1}).id;
  const maps = new StrategyMapStore(discussions), mapId = randomUUID();
  const draft = {title:'合成候选',template:'bsc',choice:'',excluded:'',assumptions:'',unknowns:'',nodes:[{id:'G1',kind:'goal',title:'复购'}],edges:[]};
  await maps.save(id,{mapId,expectedVersion:0,operationId:randomUUID(),reason:'初始版本',draft},'agent');
  const importSources = [{sourceId:'src-a',format:'pdf',fileName:'synthetic.pdf',sha256:'a'.repeat(64),origin:'upload',selectedPages:[1,2]}];
  const cases: {name:string; reason:string; update:(value:any)=>void}[] = [
    {name:'schema',reason:'unrecognized_keys',update:value=>{value.draft.syntheticUnknownField='SYNTHETIC_RAW_SCHEMA_VALUE';}},
    {name:'duplicate nodes',reason:'duplicate_item_id',update:value=>{value.draft.nodes=[value.draft.nodes[0],value.draft.nodes[0]];}},
    {name:'edge endpoint',reason:'invalid_edge_endpoint',update:value=>{value.draft.edges=[{id:'SYNTHETIC_RAW_EDGE_FILENAME.pdf',from:'missing',to:'G1',kind:'supports'}];}},
    {name:'edge review',reason:'review_requires_hypothesis',update:value=>{value.draft.nodes=[...value.draft.nodes,{id:'S1',kind:'strategy',title:'回访'}];value.draft.edges=[{id:'bad-review',from:'S1',to:'G1',kind:'supports',review:{summary:'s',mechanism:'m',condition:'c',alternative:'a',risk:'r',scope:'s',test:'t'}}];}},
    {name:'missing source',reason:'source_not_declared',update:value=>{value.draft.importSources=importSources;value.draft.nodes[0].sourceLocation={sourceId:'missing-source',label:'定位'};}},
    {name:'file identity',reason:'source_file_mismatch',update:value=>{value.draft.importSources=importSources;value.draft.nodes[0].id='SYNTHETIC_RAW_合成私有文本';value.draft.nodes[0].sourceLocation={sourceId:'src-a',fileName:'SYNTHETIC_RAW_FILE_NAME.pdf',label:'定位'};}},
    {name:'selected page',reason:'page_outside_selection',update:value=>{value.draft.importSources=importSources;value.draft.nodes[0].id='/synthetic/SYNTHETIC_RAW_PATH.pdf';value.draft.nodes[0].sourceLocation={sourceId:'src-a',page:3,label:'定位'};}},
    {name:'duplicate page',reason:'duplicate_selected_page',update:value=>{value.draft.importSources=[{...importSources[0],sourceId:'6e80f204f0094490981e0d1448844e39',selectedPages:[1,1]}];}},
    {name:'empty map',reason:'nodes_or_unknowns_required',update:value=>{value.draft.nodes=[];value.draft.unknowns='';}},
  ];
  for (const item of cases) await t.test(item.name, async () => {
    const input:any = {mapId,expectedVersion:1,operationId:randomUUID(),reason:'合成校验',draft:structuredClone(draft)};
    item.update(input);
    await assert.rejects(()=>maps.save(id,input,'agent'),(error:any)=>{
      assert.equal(error.code,'invalid_strategy_map',item.name);
      assert.equal(error.status,400,item.name);
      assert.ok(!error.message.includes('invalid_strategy_map:'),item.name);
      assert.ok(error.details.issues.length>0&&error.details.issues.length<=20,item.name);
      assert.equal(error.details.issues[0].reason,item.reason,item.name);
      const exposed=error.message+JSON.stringify(error.details);
      assert.ok(!exposed.includes('SYNTHETIC_RAW_'),item.name);
      assert.ok(!exposed.includes('6e80f204f0094490981e0d1448844e39'),item.name);
      assert.ok(error.details.issues.every((issue:object)=>!Object.hasOwn(issue,'itemId')),item.name);
      return true;
    });
    assert.equal((await maps.list(id)).length,1,item.name+' must not write a version');
  });
});
