import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import type { ProjectPlanContent } from '../src/host/project-plan-types.ts';

const evidenceRoot = path.resolve('.local/overall-architecture-upgrade/development/skill-adoption/actual-sdk');
const skillRoot = path.resolve('extensions/analysis-assets/data-analysis');
const approvedPackageSha256 = 'f7fd87d384b197ed22913b4772ec3006c949c63bdd77053645448cdd309d7106';
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
async function identity() {
  const files = (await readdir(skillRoot, { recursive: true, withFileTypes: true })).filter(item => item.isFile() && !item.name.endsWith('.pyc')).map(item => path.relative(skillRoot, path.join(item.parentPath, item.name)).split(path.sep).join('/')).sort();
  const entries: [string, string][] = [];
  for (const file of files) entries.push([file, hash(await readFile(path.join(skillRoot, file)))]);
  return { entries, approvedSha256: hash(entries.map(([file, sha256]) => `${file}\0${sha256}\n`).join('')), catalogSha256: hash(JSON.stringify(entries)) };
}

// The local protocol fixture chooses tools and text. This proves the actual
// Host/Pi/tool contract and saved bytes, not an LLM's independent adoption,
// professional correctness or the user-waived Skill comparison evaluation.
test('A11 actual Host/Pi: the exact selected new Skill checks a full diagnostic, saves and reads it, declares its version and returns a distinct chat summary', { timeout: 60_000 }, async t => {
  await mkdir(evidenceRoot, { recursive: true });
  const root = await mkdtemp(path.join(evidenceRoot, 'contract-')), dataRoot = path.join(root, 'host');
  await mkdir(path.join(dataRoot, 'pi'), { recursive: true });
  await writeFile(path.join(dataRoot, 'pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  t.diagnostic(root);
  const before = await identity();
  assert.equal(before.entries.length, 8);
  assert.equal(before.approvedSha256, approvedPackageSha256, 'use the exact user-approved whole package, including references and scripts');
  const skillFile = path.join(skillRoot, 'SKILL.md'), referenceFile = path.join(skillRoot, 'references/delivery-contract.md');
  const skillText = await readFile(skillFile, 'utf8'), referenceText = await readFile(referenceFile, 'utf8');
  const provider = await startToolProvider();
  const host = await startTestHost({ dataRoot, projectsRoot: path.join(root, 'projects'), timeoutMs: 15_000 });
  t.after(async () => { await host.close(); await provider.close(); await writeFile(path.join(root, 'observations.json'), JSON.stringify({ errors: provider.errors, requests: provider.requests.map(request => ({ body: request.body, closedEarly: request.closedEarly })), host: host.output() }, null, 2)); });
  const request = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => { const response = await host.request(route, method, body); assert.equal(response.status, status, await response.clone().text()); return response.json(); };
  await request('/api/configuration', 'PUT', { name: '新版分析契约合成检查', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-data-analysis-contract', apiKey: 'synthetic-data-analysis-contract-only' });
  const catalog = await request('/api/capabilities/skills'), skill = catalog.skills.find((item: any) => item.id === 'data-analysis' && item.source === skillFile);
  assert.ok(skill, 'select the actual package exposed by the current Host/Pi catalog');
  assert.equal(skill.bundled, true); assert.equal(skill.sha256, before.catalogSha256); assert.equal(skill.version, `sha256:${before.catalogSha256}`);
  const { project } = await request('/api/projects', 'POST', { name: '新版诊断契约合成项目' }, 201);
  const capabilities = [{ kind: 'skill' as const, id: skill.id, version: skill.version, sha256: skill.sha256 }];
  const plan: ProjectPlanContent = { request: '合成资料仅支持描述性诊断，完整报告保存在060并读回，聊天给摘要；执行人、期限和经营授权均未确认，不编正式行动计划。', premises: ['仅两条合成月汇总，不能认定经营原因或改善效果'], materials: [], coverage: [], tasks: [{ key: 'diagnostic', name: '新版完整诊断及聊天摘要', selected: true, scope: '采用准确选定Skill检查交付；不执行经营动作', capabilities }], taskMode: 'single', summaryTaskKey: 'diagnostic', dependencies: [], caseContext: null };
  const base = `/api/projects/${project.id}/plan`, saved = await request(base + '/draft', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan });
  const filename = '合成完整诊断-v1.md', relativePath = `060_reports/${filename}`;
  const report = `交付形态：完整报告
建议类型：诊断建议
# 两个完整月份的合成描述
## 一、数据口径与质量说明
统计期间：2026年1月与3月，各31天。来源：本工程用例明确给定的合成月汇总。样本量：2，仅供参考。口径：同一含税净销售额，单位元；交易笔数均为10，客单价为10和10.5元。仅有月汇总，无法检查原交易缺失或重复，不声称明细体检已完成。
## 二、趋势与结构
相同31天窗口的销售额100→105元，增加5元、5.00%；无更多期间，不推断稳定趋势。
## 三、异常识别
两条汇总不足以形成离群分布，异常判断证据不足，不编造离群点。
## 四、指标拆解
销售额=成交笔数×客单价。按成交笔数→客单价剥离：笔数效应(10−10)×10=0；单价效应10×(10.5−10)=5；总变动5，效应和5，差额0.00。实际脚本输出留在020_clean/contract-checks.json，数量拆解不是因果证明。
## 五、洞察结论
合成汇总仅显示销售额增加5元；现有资料不能解释涨价、品类变化或活动的贡献，根因未知。
## 六、诊断建议与跟踪指标
- 建议补充可比交易与商品结构，核对客单价变化；具体人选、执行期限与资源待确认。跟踪可比商品成交笔数和客单价，本稿不构成已获准行动计划。
`;
  const summary = `交付形态：聊天摘要
建议类型：诊断建议
统计期间：2026年1月与3月，各31天。来源：合成月汇总。样本量：2，仅供参考；口径为同一含税净销售额。
100→105元，增加5元、5.00%；原因未知。建议补充交易和商品证据，人选、期限与经营授权待确认。
完整报告：${relativePath}（SHA-256 ${hash(report)}）。有限文本检查不证明专业正确或经营效果。
`;
  assert.doesNotMatch(report, /责任人[：:]|时限[：:]|授权依据[：:]/);
  const draftPath = path.join(project.rootPath, '020_clean/contract-diagnostic.md'), summaryPath = path.join(project.rootPath, '020_clean/contract-summary.md');
  const python = String.raw`import json, pathlib, subprocess, sys
quality, calc, draft, summary = sys.argv[1:]
def call(script, *args):
    result = subprocess.run([sys.executable, script, *args], text=True, capture_output=True)
    return {'exitCode': result.returncode, 'stderr': result.stderr, 'output': json.loads(result.stdout)}
full = pathlib.Path(draft).read_text()
variants = {'formalWithoutAuthorization': full.replace('建议类型：诊断建议', '建议类型：正式行动计划'), 'legacyWithoutOwnerDeadline': full.replace('交付形态：完整报告\n建议类型：诊断建议\n', ''), 'conflictingDelivery': '交付形态：聊天摘要\n' + full}
checks = {'diagnostic': call(quality, '--report', draft), 'summary': call(quality, '--report', summary), 'compare': call(calc, 'compare', '--label', '合成销售额', '--base', '100', '--current', '105', '--base-days', '31', '--cur-days', '31'), 'decompose': call(calc, 'decompose', '--metric', '合成销售额', '--base', '成交笔数:10,客单价:10', '--current', '成交笔数:10,客单价:10.5')}
for key, text in variants.items():
    target = pathlib.Path(draft).with_name(key + '.md')
    target.write_text(text)
    checks[key] = call(quality, '--report', str(target))
pathlib.Path(draft).with_name('contract-checks.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2))
print('CONTRACT_CHECKS ' + json.dumps(checks, ensure_ascii=False))
`;
  const command = ['python3', '-c', quote(python), quote(path.join(skillRoot, 'scripts/quality_check.py')), quote(path.join(skillRoot, 'scripts/calc.py')), quote(draftPath), quote(summaryPath)].join(' ');
  let actualChecks: any, reportBinding: any;
  const methodChecks = [{ kind: 'skill', id: skill.id, version: skill.version, status: 'used', basis: '合成Provider通过实际Pi读准确SKILL及交付契约，执行随包计算/质量脚本，完整诊断与聊天摘要分别校验；仅为脚本采用声明。' }];
  provider.setResponder(context => {
    const count = context.recentToolResults.length, latest = providerMessageText(context.recentToolResults.at(-1)?.content);
    if (count === 0) return { calls: [{ name: 'read', arguments: { path: skillFile } }] };
    if (count === 1) { assert.equal(latest, skillText); return { calls: [{ name: 'read', arguments: { path: referenceFile } }] }; }
    if (count === 2) { assert.equal(latest, referenceText); return { calls: [{ name: 'write', arguments: { path: draftPath, content: report } }] }; }
    if (count === 3) return { calls: [{ name: 'write', arguments: { path: summaryPath, content: summary } }] };
    if (count === 4) return { calls: [{ name: 'bash', arguments: { command } }] };
    if (count === 5) {
      const match = /^CONTRACT_CHECKS (.+)$/m.exec(latest); assert.ok(match, latest); actualChecks = JSON.parse(match[1]);
      assert.equal(actualChecks.diagnostic.exitCode, 0); assert.equal(actualChecks.diagnostic.output.verdict, 'PASS'); assert.equal(actualChecks.diagnostic.output.delivery, '完整报告'); assert.equal(actualChecks.diagnostic.output.advice, '诊断建议');
      assert.equal(actualChecks.summary.exitCode, 0); assert.equal(actualChecks.summary.output.form, '摘要'); assert.equal(actualChecks.summary.output.verdict, 'PASS');
      for (const [name, rule] of [['formalWithoutAuthorization', 'R2'], ['legacyWithoutOwnerDeadline', 'R2'], ['conflictingDelivery', 'F0']]) { const result = actualChecks[name!]; assert.equal(result.exitCode, 1, name); assert.ok(result.output.checks.some((check: any) => check.id === rule && check.hit && check.level === 'error'), name); }
      assert.equal(actualChecks.compare.exitCode, 0); assert.equal(actualChecks.compare.output.pct_change, '5.00%');
      assert.equal(actualChecks.decompose.exitCode, 0); assert.equal(actualChecks.decompose.output.total_change, '5.00'); assert.equal(actualChecks.decompose.output.closure.diff, '0.00');
      return { calls: [{ name: 'write_report', arguments: { filename, content: report } }] };
    }
    if (count === 6) { const exact = /准确回执：(\{.+\})$/.exec(latest); assert.ok(exact, latest); reportBinding = JSON.parse(exact[1]); assert.equal(reportBinding.relativePath, relativePath); assert.equal(reportBinding.sha256, hash(report)); return { calls: [{ name: 'read', arguments: { path: path.join(project.rootPath, relativePath) } }] }; }
    if (count === 7) { assert.equal(latest, report); return { calls: [{ name: 'declare_analysis_delivery', arguments: { completion: 'complete', format: 'full-report', summary, limitations: ['仅合成固定输入与脚本Provider，无真实LLM测评；不证明专业正确、真实授权或业务效果'], selfCheck: { performed: true, findings: ['随包calc精确闭合；完整诊断和聊天摘要分别检查通过；缺授权正式计划、legacy缺责任期限及冲突模式被拒绝；完整报告已保存并读回'] }, methodChecks, reports: [{ relativePath, sha256: reportBinding.sha256 }] } }] }; }
    assert.equal(count, 8); const declared = JSON.parse(latest); assert.equal(declared.claim, 'declared-not-professionally-verified'); assert.equal(declared.reports[0].sha256, hash(report)); return { text: summary };
  });
  const started = await request(base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: saved.state.revision, mode: 'start' }), selected = started.confirmation.tasks[0];
  assert.equal(selected.startStatus, 'accepted'); assert.equal(started.confirmation.tasks.length, 1);
  let state: any; const deadline = Date.now() + 35_000;
  do { state = await request(`/api/projects/${project.id}/tasks/${selected.taskId}`); if (state.task.lastRun?.id === selected.startRequestId && state.task.lastRun.status !== 'running' && state.snapshot.status === 'idle') break; await delay(20); } while (Date.now() < deadline);
  assert.equal(state.task.lastRun?.status, 'completed', JSON.stringify({ lastRun: state.task.lastRun, errors: provider.errors })); assert.equal(state.snapshot.status, 'idle'); assert.deepEqual(provider.errors, []); assert.equal(provider.requests.length, 9);
  const nativeBytes = await readFile(state.task.sessionFile), native = nativeBytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
  const context = native.find(entry => entry.customType === 'optracall.run' && entry.data.phase === 'started' && entry.data.requestId === selected.startRequestId);
  assert.deepEqual(context.data.providedContext.projectPlan.methods, capabilities);
  const toolResults = native.filter(entry => entry.message?.role === 'toolResult');
  assert.equal(toolResults.length, 8); assert.ok(toolResults.every(entry => !entry.message.isError));
  assert.equal(providerMessageText(toolResults[0].message.content), skillText); assert.equal(providerMessageText(toolResults[1].message.content), referenceText); assert.equal(providerMessageText(toolResults[6].message.content), report);
  const bound = native.find(entry => entry.customType === 'optracall.project-report-write'), declaration = native.find(entry => entry.customType === 'optracall.analysis-delivery');
  assert.equal(bound.data.relativePath, relativePath); assert.equal(bound.data.sha256, hash(report)); assert.equal(bound.data.taskId, selected.taskId); assert.equal(bound.data.requestId, selected.startRequestId);
  assert.equal(declaration.data.format, 'full-report'); assert.equal(declaration.data.claim, 'declared-not-professionally-verified'); assert.deepEqual(declaration.data.methodChecks, methodChecks); assert.equal(declaration.data.reports[0].toolCallId, bound.data.toolCallId);
  assert.equal(await readFile(path.join(project.rootPath, relativePath), 'utf8'), report);
  assert.deepEqual(await readdir(path.join(project.rootPath, '060_reports')), [filename]);
  const final = native.filter(entry => entry.message?.role === 'assistant' && !entry.message.content.some((part: any) => part.type === 'toolCall')).at(-1);
  assert.equal(providerMessageText(final.message.content), summary); assert.doesNotMatch(summary, /## [一二三四五六]、/); assert.ok(summary.length < report.length);
  const after = await identity(); assert.deepEqual(after, before, 'reading and executing the Skill never rewrites its approved source package');
  await writeFile(path.join(root, 'receipt.json'), JSON.stringify({ status: 'PASS', validation: 'actual-host-official-pi-loopback-scripted-provider', approvedPackageSha256, apiPackageSha256: skill.sha256, apiVersion: skill.version, source: skill.source, files: before.entries, projectId: project.id, taskId: selected.taskId, requestId: selected.startRequestId, nativeSession: state.task.sessionFile, nativeSha256: hash(nativeBytes), actualReadEntryIds: [toolResults[0].id, toolResults[1].id, toolResults[6].id], checksEntryId: toolResults[4].id, checks: actualChecks, savedReport: { relativePath, sha256: hash(report), bytes: Buffer.byteLength(report), entryId: bound.id }, declarationEntryId: declaration.id, methodChecks, finalChatSummaryEntryId: final.id, sourceUnchanged: true, formalSkillEvaluation: 'USER_APPROVED_WITHOUT_EVALUATION_RUN', actualLLMAdoption: 'NOT_RUN', professionalCorrectness: 'NOT_RUN', businessAuthorizationOrEffect: 'NOT_RUN' }, null, 2));
});
