import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText, type SyntheticToolCall, type ToolProviderContext } from './fixtures/tool-provider.ts';
import type { StudioSourceRef } from '../extensions/business-plugins/studio/contracts.ts';

type Host = Awaited<ReturnType<typeof startTestHost>>;
type Provider = Awaited<ReturnType<typeof startToolProvider>>;
const json = async (response: Response, status = 200): Promise<any> => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const studioCall = (action: string, payload: Record<string, unknown> = {}): SyntheticToolCall => ({ name: 'studio_assets', arguments: { action, payload } });
const policy = '# 合成退款制度\n成功退款归原销售门店，按退款成功发生期间统计；一个订单可多次退款。支付与退款事件各自去重、分别汇总；同步副本不新增退款事件。期间比较核同门店、同币种、等长期间，金额变化不直接说明因果。\n';
const csv = 'store,kind,event_id,order_id,period,amount,status\nEast,payment,P901,O901,previous,800,success\nEast,payment,P902,O902,previous,100,success\nEast,refund,R901,O901,previous,100,success\nWest,payment,P903,O903,previous,850,success\nWest,refund,R903,O903,previous,100,success\nEast,payment,P101,O101,current,100,success\nEast,payment,P102,O102,current,900,success\nEast,refund,R1,O101,current,30,success\nEast,refund,R2,O101,current,20,success\nEast,refund,R2,O101,current,20,success\nEast,refund,R3,O902,current,100,success\nWest,payment,P103,O103,current,800,success\nWest,refund,R4,O103,current,100,success\n';
const metricYaml = JSON.stringify({ sap: '0.2', package: { id: 'studio-retail-flow', version: '1.0.0', namespace: 'mf.studio-retail-flow', fingerprint: '' }, dimensions: ['store'], metrics: [
  { name: 'successful_payments', display_name: '成功支付金额', type: 'simple', definition: '本期成功支付，按支付事件去重并按原销售门店汇总', dimensions: ['store'], time_grains: ['month'], owner_role: 'finance', caliber_switches: { successful_only: true }, provenance: { origin: 'manual', note: 'Synthetic engineering fixture; not a business standard' } },
  { name: 'successful_refunds', display_name: '成功退款金额', type: 'simple', definition: '本期成功退款，按退款事件区分多次退款并排除同步重复', dimensions: ['store'], time_grains: ['month'], owner_role: 'finance', caliber_switches: { successful_only: true }, provenance: { origin: 'manual', note: 'Synthetic engineering fixture' } },
  { name: 'period_net', display_name: '本期支付退款净额', type: 'derived', definition: '本期成功支付减本期成功退款，不等同订单群最终收入', dimensions: ['store'], time_grains: ['month'], owner_role: 'finance', caliber_switches: { successful_only: true }, type_params: { expr: 'successful_payments - successful_refunds' }, provenance: { origin: 'manual', note: 'Synthetic engineering fixture' } },
], scenarios: [] });
async function upload(host: Host, projectId: string, name: string, text: string) { return json(await host.request(`/api/projects/${projectId}/files/upload`, 'POST', { directory: '020_clean', name, content: Buffer.from(text).toString('base64') }), 201); }
async function run(host: Host, provider: Provider, projectId: string, taskId: string, systemId: string, purpose: 'construction' | 'analysis', steps: (SyntheticToolCall | ((context: ToolProviderContext) => SyntheticToolCall))[], marker: string) {
  provider.setResponder(context => { const index = context.recentToolResults.length; if (index < steps.length) { const call = typeof steps[index] === 'function' ? (steps[index] as (c: ToolProviderContext) => SyntheticToolCall)(context) : steps[index] as SyntheticToolCall; return { calls: [call.name === 'studio_assets' ? { ...call, arguments: { ...call.arguments, systemId } } : call] }; } return { text: marker }; });
  const route = `/api/projects/${projectId}/tasks/${taskId}`;
  await json(await host.request(`${route}/messages`, 'POST', { requestId: randomUUID(), text: '仅用本项目获准资料与准确资产完成本轮合成工程检查；专业正确性另验。', studioContext: { systemId, purpose } }), 202);
  const start = Date.now(); let state: any;
  do { state = await json(await host.request(route)); if (state.task.lastRun?.status === 'completed' && JSON.stringify(state.snapshot.messages).includes(marker)) break; if (state.task.lastRun && ['failed','cancelled'].includes(state.task.lastRun.status)) break; await new Promise(resolve => setTimeout(resolve, 25)); } while (Date.now() - start < 40_000);
  assert.equal(state.task.lastRun?.status, 'completed', JSON.stringify(state)); assert.match(JSON.stringify(state.snapshot.messages), new RegExp(marker)); assert.deepEqual(provider.errors, []); const lastUser = state.snapshot.messages.findLastIndex((message: any) => message.role === 'user'); const executed = state.snapshot.messages.slice(lastUser + 1).filter((message: any) => message.role === 'toolResult'); assert.equal(executed.length, steps.length, JSON.stringify(executed)); assert.equal(executed.some((message: any) => message.isError), false, JSON.stringify(executed.filter((message: any) => message.isError))); return state;
}

function analysisCalls(projectId: string, taskId: string, formalRefs: StudioSourceRef[], metricRef: StudioSourceRef, methodRef: StudioSourceRef, dataRef: StudioSourceRef, refs: StudioSourceRef[], reportPath: string): (SyntheticToolCall | ((c: ToolProviderContext) => SyntheticToolCall))[] {
  const relativeReport = '../' + reportPath;
  const python = `import csv,json,hashlib,pathlib
from decimal import Decimal,ROUND_HALF_UP
totals={p:{} for p in ['current','previous']}
seen=set()
for row in csv.DictReader(open('events.csv')):
 if row['status']!='success': continue
 key=(row['period'],row['kind'],row['event_id'])
 if key in seen: continue
 seen.add(key)
 store=totals[row['period']].setdefault(row['store'],{'paid':Decimal(0),'refunded':Decimal(0)})
 store['paid' if row['kind']=='payment' else 'refunded']+=Decimal(row['amount'])
for period in totals.values():
 for values in period.values(): values['net']=values['paid']-values['refunded']
change={}
for store,values in totals['current'].items():
 previous=totals['previous'][store]['net']; delta=values['net']-previous
 change[store]={'delta':int(delta),'rate':str((delta/previous*100).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)) if previous else None}
report={p:{store:{k:int(v) for k,v in values.items()} for store,values in totals[p].items()} for p in totals}
report.update(change=change,currentTotal=sum(v['net'] for v in report['current'].values()),previousTotal=sum(v['net'] for v in report['previous'].values()))
file=pathlib.Path(${JSON.stringify(relativeReport)})
file.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True))
print('REPORT_SHA='+hashlib.sha256(file.read_bytes()).hexdigest())
print(json.dumps(report))`;
  return [studioCall('catalog'), studioCall('read-source', { ref: formalRefs[1] }), studioCall('read-source', { ref: metricRef }), studioCall('read-source', { ref: methodRef }), studioCall('read-source', { ref: dataRef }), { name: 'bash', arguments: { command: "python3 - <<'PY'\n" + python + "\nPY" } }, context => {
    const actual = context.recentToolResults.map(r => providerMessageText(r.content)).join('\n'); const match = /REPORT_SHA=([a-f0-9]{64})/.exec(actual); assert.ok(match, actual);
    return studioCall('declare-use', { report: { authority: 'task', id: taskId, taskId, projectId, locator: reportPath, version: match[1], sha256: match[1] }, sources: refs, result: '合成工具实际计算并另存报告；这是作者使用声明，专业核验未执行。' });
  }];
}

/** This is a deterministic protocol/provider fixture, not a real-model professional-quality score. */
test('Studio engineering flow uses real Host/Pi tools to construct sources and original SAP candidates, then publish exact versions', { timeout: 120_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close()); const host = await startTestHost({ timeoutMs: 10_000 }); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Studio flow synthetic', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-studio-flow', apiKey: 'synthetic-studio-flow-only' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'Studio 合成经营资产建设' }), 201);
  await upload(host, project.id, 'refund-policy.md', policy); await upload(host, project.id, 'events.csv', csv);
  const { materials } = await json(await host.request(`/api/studio/materials?projectId=${project.id}`));
  const selected = materials.filter((m: any) => ['refund-policy.md', 'events.csv'].includes(m.ref.title)); assert.equal(selected.length, 2);
  const policyRef: StudioSourceRef = selected.find((m: any) => m.ref.title === 'refund-policy.md').ref, dataRef: StudioSourceRef = selected.find((m: any) => m.ref.title === 'events.csv').ref;
  const { system: initial } = await json(await host.request('/api/studio/systems', 'POST', { requestId: randomUUID(), name: '合成零售体系', projectId: project.id, goal: '门店支付退款金额与等长期间变化', topicTitle: '销售与退款', materials: selected }), 201);
  const base = { scope: '合成企业、本期发生口径、人民币元', readyForPublication: true, checks: [{ name: 'Synthetic author fixture check', status: 'pass', detail: 'Protocol fixture reports a prepared candidate; this is not independent business truth' }], limitations: ['No causal inference or real-model quality claim'] };
  await run(host, provider, project.id, initial.taskId, initial.id, 'construction', [
    studioCall('read-source', { ref: policyRef }), studioCall('read-source', { ref: dataRef }),
    studioCall('save-asset', { ...base, kind: 'concept', title: '门店、支付与退款事件', body: '门店承接原销售；支付与退款为独立事件，一个订单可对应多次退款。', sources: [policyRef] }),
    studioCall('save-asset', { ...base, kind: 'rule', title: '退款期间与归属', body: '成功退款归原销售门店，按退款成功发生期间计入；可来自以前支付期订单。', sources: [policyRef] }),
    studioCall('save-asset', { ...base, kind: 'ontology', title: '门店订单退款基础源稿', body: '类型为门店、订单、支付和退款事件；订单归属原销售门店，退款事件关联订单；结构检查不裁决业务真实性。', sources: [policyRef] }),
    studioCall('save-asset', { ...base, kind: 'binding', title: '支付退款事件映射', body: 'kind区分支付与退款；event_id为各自事件身份；store为原销售门店；period为事件发生期间；只计success状态，按事件排除同步重复，先分别汇总以避免支付被关联放大。', sources: [dataRef] }),
    { name: 'write', arguments: { path: 'retail.sap.yaml', content: metricYaml } },
    studioCall('register-sap-metric', { path: '020_clean/retail.sap.yaml' }),
    studioCall('save-sap-method', { title: '门店净额及期间变化', content: { conditions: '相同门店、币种、等长期间及同一发生口径', logic: '按准确规则分别计算支付与退款后净额，比较各店及整体变化', judgment: '金额事实和解释强度分别核；整体抵消不表示各店不变', limits: '不把金额变化直接当作因果或经营行动批准' }, sources: [policyRef, dataRef] }),
  ], 'STUDIO_BUILD_PROTOCOL_DONE');
  const { system } = await json(await host.request(`/api/studio/systems/${initial.id}`));
  assert.equal(system.assets.length, 4); assert.equal(system.assetRefs.filter((r: StudioSourceRef) => r.authority === 'sap-metric' || r.authority === 'sap-method').length, 2, JSON.stringify(provider.requests.at(-1)?.body.messages?.filter(m => m.role === 'tool').slice(-3)));
  assert.equal(system.assets.some((a: any) => a.formalRevision !== null), false);
  assert.ok(system.assets.every((a: any) => !/850|700|1550|1,550/.test(a.revisions[0].body)), 'Expected report results must never be written into reusable assets.');
  await run(host, provider, project.id, system.taskId, system.id, 'construction', [studioCall('prepare-publication', { assetIds: system.assets.map((a: any) => a.id), refs: system.assetRefs, summary: '门店销售退款关联资产', scope: '合成企业本期发生与等长期间比较', checks: [{ name: 'Synthetic fixture readiness', status: 'pass', detail: 'Engineering contract only' }], limitations: ['专业模型质量未测'] })], 'STUDIO_PREVIEW_PROTOCOL_DONE');
  const prepared = (await json(await host.request(`/api/studio/systems/${system.id}`))).system.publications.at(-1);
  assert.ok(prepared?.preview.fingerprint); assert.equal(prepared.preview.confirmedAt, undefined);
  const published = await json(await host.request(`/api/studio/systems/${system.id}/publications`, 'POST', { requestId: randomUUID(), previewId: prepared.preview.id, fingerprint: prepared.preview.fingerprint }));
  assert.deepEqual(new Set(published.publication.results.filter((r: any) => r.status === 'succeeded').map((r: any) => r.module)), new Set(['studio-source', 'sap-metric', 'sap-method']));
  assert.deepEqual(published.system.adoptions, []); assert.deepEqual(published.system.graphs, []); assert.deepEqual(published.system.uses, []);
  const { project: usingProject } = await json(await host.request('/api/projects', 'POST', { name: 'Studio 合成普通分析项目' }), 201);
  await upload(host, usingProject.id, 'events.csv', csv);
  const useTask = await json(await host.request(`/api/studio/systems/${system.id}/use`, 'POST', { requestId: randomUUID(), projectId: usingProject.id }));
  assert.deepEqual(useTask.system.adoptions, []); assert.deepEqual(useTask.system.uses, [], 'Entering a using project must not claim actual execution or adoption.');
  const metricRef = published.system.assetRefs.find((ref: StudioSourceRef) => ref.authority === 'sap-metric'), methodRef = published.system.assetRefs.find((ref: StudioSourceRef) => ref.authority === 'sap-method');
  await json(await host.request(`/api/studio/systems/${system.id}/adoptions`, 'POST', { requestId: randomUUID(), projectId: usingProject.id, packageId: metricRef.id, version: metricRef.version }));
  const usingData = (await json(await host.request(`/api/studio/materials?projectId=${usingProject.id}`))).materials.find((m: any) => m.ref.title === 'events.csv').ref;
  const formalRefs = published.system.assets.map((asset: any) => ({ authority: 'studio-source' as const, id: asset.id, version: String(asset.formalRevision), sha256: asset.revisions.find((r: any) => r.revision === asset.formalRevision).sha256, projectId: project.id, locator: system.id }));
  const allRefs = [...formalRefs, metricRef, methodRef, usingData];
  const reportPath = '060_reports/studio-period.json';
  const analysis = await run(host, provider, usingProject.id, useTask.task.id, system.id, 'analysis', analysisCalls(usingProject.id, useTask.task.id, formalRefs, metricRef, methodRef, usingData, allRefs, reportPath), 'STUDIO_ANALYSIS_PROTOCOL_DONE');
  const reportText = await (await host.request(`/api/projects/${usingProject.id}/files/content?path=${encodeURIComponent(reportPath)}`)).text(); const report = JSON.parse(reportText);
  assert.deepEqual(report.current, { East: { paid: 1000, refunded: 150, net: 850 }, West: { paid: 800, refunded: 100, net: 700 } });
  assert.deepEqual(report.change, { East: { delta: 50, rate: '6.25' }, West: { delta: -50, rate: '-6.67' } }); assert.equal(report.currentTotal, 1550); assert.equal(report.previousTotal, 1550);
  const used = (await json(await host.request(`/api/studio/systems/${system.id}`))).system;
  assert.equal(used.uses.length, 1, JSON.stringify(provider.requests.at(-1)?.body.messages?.filter(m => m.role === 'tool'))); assert.equal(used.uses[0].verification, 'not_assessed'); assert.deepEqual(used.graphs, [], 'Independent accurate L1/SAP use is not gated on a graph.');
  const reply = [...analysis.snapshot.messages].reverse().find((m: any) => m.role === 'assistant' && m.nativeEntryId && m.nativeSessionId); assert.ok(reply, 'Feedback must use an actually saved native reply identity.');
  const beforeFeedbackRequests = provider.requests.length;
  await json(await host.request(`/api/studio/systems/${system.id}/feedback`, 'POST', { requestId: randomUUID(), title: '合成映射维护问题', problem: '受控维护输入：请核退款事件去重与后续同步标识说明，原稿保留', sources: [usingData], currentHandling: '本任务合成报告已保存；尚无源资产全局确错决定', impact: '退款事件映射边界', origin: { projectId: usingProject.id, taskId: useTask.task.id, sessionId: reply.nativeSessionId, messageId: reply.nativeEntryId } }));
  const feedbackState = (await json(await host.request(`/api/studio/systems/${system.id}`))).system;
  assert.equal(feedbackState.feedback[0].status, 'recorded'); assert.equal(provider.requests.length, beforeFeedbackRequests, 'Saving feedback must not start a background Agent.');
  const binding = feedbackState.assets.find((asset: any) => asset.kind === 'binding'), originalBody = binding.revisions[0].body;
  await run(host, provider, project.id, system.taskId, system.id, 'construction', [
    studioCall('read'),
    studioCall('update-feedback', { feedbackId: feedbackState.feedback[0].id, status: 'accepted', response: '原主建设任务接手，按保存问题核来源，不把反馈当全局确错。' }),
    studioCall('save-asset', { ...base, assetId: binding.id, expectedRevision: 1, kind: 'binding', title: '支付退款事件映射', body: originalBody + ' 复用时需核新系统事件身份；身份未明确则保留受影响退款限制，不猜测映射。', reason: '合成反馈后的原资产维护候选', sources: [dataRef] }),
  ], 'STUDIO_REVISION_PROTOCOL_DONE');
  const revisionState = (await json(await host.request(`/api/studio/systems/${system.id}`))).system;
  const revised = revisionState.assets.find((asset: any) => asset.id === binding.id); assert.equal(revised.formalRevision, 1); assert.equal(revised.candidateRevision, 2); assert.equal(revised.revisions[0].body, originalBody);
  assert.equal(revisionState.feedback[0].status, 'accepted', 'Accepting a feedback does not mean it has been professionally solved.');
  const nextPreview = await json(await host.request(`/api/studio/systems/${system.id}/preview`, 'POST', { requestId: randomUUID(), assetIds: [binding.id], refs: [], summary: '仅受影响映射维护新版', scope: base.scope, checks: [{ name: '合成维护检查', status: 'pass', detail: '固定合成协议检查，不是专业模型评估' }] }));
  await json(await host.request(`/api/studio/systems/${system.id}/publications`, 'POST', { requestId: randomUUID(), previewId: nextPreview.preview.id, fingerprint: nextPreview.preview.fingerprint }));
  const afterRevision = (await json(await host.request(`/api/studio/systems/${system.id}`))).system;
  const binding2 = afterRevision.assets.find((asset: any) => asset.id === binding.id);
  assert.equal(binding2.formalRevision, 2); assert.equal(afterRevision.uses[0].sources.find((ref: StudioSourceRef) => ref.id === binding.id).version, '1');
  const secondTask = await json(await host.request(`/api/studio/systems/${system.id}/use`, 'POST', { requestId: randomUUID(), projectId: usingProject.id }));
  const nextRefs = formalRefs.map((ref: StudioSourceRef) => ref.id === binding.id ? { ...ref, version: '2', sha256: binding2.revisions[1].sha256 } : ref);
  await run(host, provider, usingProject.id, secondTask.task.id, system.id, 'analysis', analysisCalls(usingProject.id, secondTask.task.id, nextRefs, metricRef, methodRef, usingData, [...nextRefs, metricRef, methodRef, usingData], '060_reports/studio-period-v2.json'), 'STUDIO_SECOND_USE_PROTOCOL_DONE');
  const secondReport = JSON.parse(await (await host.request(`/api/projects/${usingProject.id}/files/content?path=060_reports%2Fstudio-period-v2.json`)).text());
  assert.deepEqual(secondReport, report); assert.equal(await (await host.request(`/api/projects/${usingProject.id}/files/content?path=${encodeURIComponent(reportPath)}`)).text(), reportText, 'A new use/report must preserve the original report bytes.');
  const usedAgain = (await json(await host.request(`/api/studio/systems/${system.id}`))).system, use = usedAgain.uses.find((value: any) => value.taskId === secondTask.task.id); assert.ok(use);
  const assessmentCode = `import json,pathlib,hashlib
report=json.load(open('../060_reports/studio-period-v2.json'))
checks={'current_total':report['currentTotal']==sum(v['net'] for v in report['current'].values()),'previous_total':report['previousTotal']==sum(v['net'] for v in report['previous'].values()),'store_arithmetic':all(v['net']==v['paid']-v['refunded'] for period in ['current','previous'] for v in report[period].values()),'deltas':all(report['change'][store]['delta']==v['net']-report['previous'][store]['net'] for store,v in report['current'].items())}
assert all(checks.values()),checks
body={'scope':'Synthetic fixture arithmetic and exact report protocol only','checks':checks,'professionalAcceptance':False,'realModelQualityEvaluated':False}
file=pathlib.Path('../060_reports/studio-assessment-v2.json');file.write_text(json.dumps(body,sort_keys=True))
print('ASSESSMENT_SHA='+hashlib.sha256(file.read_bytes()).hexdigest())`;
  let assessmentRef: StudioSourceRef | undefined;
  await run(host, provider, usingProject.id, secondTask.task.id, system.id, 'analysis', [
    { name: 'bash', arguments: { command: "python3 - <<'PY'\n" + assessmentCode + "\nPY" } },
    context => { const text = context.recentToolResults.map(result => providerMessageText(result.content)).join('\n'), match = /ASSESSMENT_SHA=([a-f0-9]{64})/.exec(text); assert.ok(match, text); assessmentRef = { authority: 'task', id: secondTask.task.id, taskId: secondTask.task.id, projectId: usingProject.id, locator: '060_reports/studio-assessment-v2.json', version: match[1], sha256: match[1] }; return studioCall('assess-use', { useId: use.id, status: 'pass', report: assessmentRef, sources: use.sources, result: '合成fixture明确评估：固定输入实际报告的总额、净额和变化算术通过；未测真实模型或独立专业质量。' }); },
  ], 'STUDIO_EXPLICIT_ASSESSMENT_PROTOCOL_DONE');
  assert.ok(assessmentRef);
  await run(host, provider, project.id, system.taskId, system.id, 'construction', [
    studioCall('read-source', { ref: use.report }), studioCall('read-source', { ref: assessmentRef }), studioCall('read-source', { ref: nextRefs.find((ref: StudioSourceRef) => ref.id === binding.id) }),
    studioCall('update-feedback', { feedbackId: feedbackState.feedback[0].id, status: 'verified', response: '原建设任务已读准确新版使用稿与明确评估稿；只记录合成fixture限定范围，不作真实模型或独立专业验收。', verification: { sources: [use.report, assessmentRef, ...use.sources], result: '新版准确使用及限定算术评估证据均保留；更广专业能力未验。' } }),
  ], 'STUDIO_EVIDENCE_LINK_PROTOCOL_DONE');
  const final = (await json(await host.request(`/api/studio/systems/${system.id}`))).system; assert.equal(final.uses.length, 2); assert.ok(final.uses.every((u: any) => u.verification === 'not_assessed')); assert.equal(final.uses.find((u: any) => u.id === use.id).assessments.at(-1).status, 'pass'); assert.equal(final.feedback[0].status, 'verified');
});
