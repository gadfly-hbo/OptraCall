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
