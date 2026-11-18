import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyConfirmedRounds } from './fixtures/pm-case-rounds.ts';
import { providerMessageText } from './fixtures/tool-provider.ts';

test('Project keeps the original issue session across choices while all earlier Plan sources remain readable', {timeout:120000}, async t => {
  let probe: () => Promise<void>;
  await verifyConfirmedRounds(t, async ({ host, provider, receipt, link }) => {
    probe = async () => {
      const casePath = '/api/cases/' + receipt.caseId;
      const issuePath = casePath + '/decisions/issues/' + receipt.issueId;
      const role = '/api/business-role?owner=' + encodeURIComponent(JSON.stringify({
        role:'project', projectId:receipt.work, issue:{caseId:receipt.caseId,issueId:receipt.issueId}
      }));
      async function api(route:string, method='GET', body?:unknown, status=200) {
        const response = await host.request(route, method, body), value = await response.json();
        assert.equal(response.status,status,JSON.stringify(value));
        return value;
      }
      async function send(revision:number) {
        await api(role+'&action=messages','POST',{requestId:randomUUID(),expectedRevision:revision,text:'核对当前事项原方案'},202);
        for(let n=0;n<250;n++) {
          const view = await api(role);
          if(!view.busy && view.discussion.lastRun?.status==='completed')return view;
          await delay(35);
        }
        assert.fail('Project role did not complete the native request');
      }
      provider.setResponder(()=>({text:'已读取当前事项。'}));
      const first = await send(0);
      const {rounds} = await api(issuePath);
      const target = rounds.find((r:{choice:{choiceId:string}})=>r.choice.choiceId===receipt.second).choice.strategyRef;
      await api(casePath+'/decisions/'+target.recordId+'/choice','POST',{
        operationId:randomUUID(),caseStoreId:target.caseStoreId,strategyRef:target,issueId:receipt.issueId,
        choice:'trial',reason:'回到南店核对',expectedPreviousChoiceId:rounds.at(-1).choice.choiceId
      });
      const second = await send(first.discussion.revision);
      assert.equal(second.snapshot.sessionId,first.snapshot.sessionId);
      const current = provider.requests.at(-1)!.body.messages!.filter(m=>m.role==='user').at(-1)!;
      assert.match(providerMessageText(current.content),/B案：仅南店/);
      assert.doesNotMatch(providerMessageText(current.content),/A案：仅北店/);
      const requestCount = provider.requests.length;
      await link(String(receipt.source),false);
      // The current B evidence is still linked. Replaying A from the original session needs its own access.
      assert.equal((await host.request(role+'&action=origin')).status,200);
      for(const response of [await host.request(role),await host.request(role+'&action=messages','POST',{
        expectedRevision:second.discussion.revision,requestId:randomUUID(),text:'继续这段已有原文的会话'
      })])assert.ok([403,409].includes(response.status),await response.text());
      assert.equal(provider.requests.length,requestCount);
      await link(String(receipt.source),true);
      assert.equal((await api(role)).snapshot.sessionId,first.snapshot.sessionId);
    };
  });
  await probe!();
});
