import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText, type SyntheticToolCall } from './fixtures/tool-provider.ts';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
async function json(response: Response, status = 200): Promise<any> {
  assert.equal(response.status, status, await response.clone().text()); return response.json();
}

// Scripted protocol verification of the actual Host, official SDK, native
// authorities and file tools. It does not score a model's independent analysis.
test('SU18/21/23 engineering: two-theme exact assets drive real calculation, revised reuse and immutable old evidence', { timeout: 70_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Synthetic use chain', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-studio-use', apiKey: 'synthetic-only' }));
  const enterprise = await json(await host.request('/api/studio/enterprises', 'POST', { name: '合成使用链企业' }), 201);
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '普通使用与新版工程验证', enterpriseId: enterprise.id }), 201);
  const material = async (title: string, body: string) => {
    const saved = await json(await host.request('/api/enterprise-materials', 'POST', { title, body }), 201);
    const enabled = await json(await host.request(`/api/enterprise-materials/${saved.material.id}/enable`, 'POST', { expectedVersion: saved.material.version }));
    await json(await host.request('/api/studio/enterprise-associations', 'POST', { kind: 'asset', authority: 'enterprise', entityId: saved.material.id, enterpriseId: enterprise.id }));
    return { id: saved.material.id, version: enabled.material.activeRevisionId };
  };
  const sales = await material('销售字段映射（合成）', '仅本企业合成CSV：sales.csv 的 amount 为成交额，按本文件全部行求和。');
  const refunds = await material('售后字段映射（合成）', '仅本企业合成CSV：refunds.csv 的 amount 为退款额；本示例已核相同范围，真实业务归属须另核。');
  const first = await json(await host.request('/api/sap/methods', 'POST', { requestId: randomUUID(), title: '成交额工程方法', content: { conditions: '本企业、此合成范围、全部CSV行；非会员主题正式标准', logic: 'gross', judgment: '仅计算合成范围，不断言原因或效果', limits: '脚本Provider工程检查，不是真实模型验收' }, sources: [] }), 201);
  const methodId = first.method.id;
  const publish = async (version: any) => json(await host.request(`/api/sap/methods/${methodId}/publish`, 'POST', { requestId: randomUUID(), version: version.version, expectedSha256: version.contentSha256 }));
  await publish(first.version);
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { kind: 'asset', authority: 'sap-method', entityId: methodId, enterpriseId: enterprise.id }));
  const salesBytes = 'amount\n100\n200\n300\n', refundBytes = 'amount\n50\n';
  await writeFile(path.join(project.rootPath, '020_clean', 'sales.csv'), salesBytes);
  await writeFile(path.join(project.rootPath, '020_clean', 'refunds.csv'), refundBytes);

  const run = async (version: number, expected: number) => {
    const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: `新版再用 V${version}` }), 201);
    const route = `/api/projects/${project.id}/tasks/${task.id}`, reportPath = `060_reports/use-v${version}.json`;
    provider.setResponder(context => {
      const results = context.recentToolResults.map(result => providerMessageText(result.content));
      let call: SyntheticToolCall | undefined;
      if (results.length === 0) call = { name: 'studio_assets', arguments: { action: 'catalog' } };
      else if (results.length <= 3) {
        const catalog = JSON.parse(results[0]!);
        const wanted = [sales.id, refunds.id, methodId][results.length - 1];
        const entry = catalog.items.find((item: any) => item.id === wanted);
        assert.ok(entry?.eligible && entry.ref, 'The actual scoped catalog must discover the original formal source.');
        call = { name: 'studio_assets', arguments: { action: 'read-source', payload: { ref: entry.ref } } };
      } else if (results.length === 4) call = { name: 'read', arguments: { path: path.join(project.rootPath, '020_clean', 'sales.csv') } };
      else if (results.length === 5) call = { name: 'read', arguments: { path: path.join(project.rootPath, '020_clean', 'refunds.csv') } };
      else if (results.length === 6) {
        const reads = results.slice(1, 4).map(result => JSON.parse(result));
        assert.ok(reads.every(result => result.complete === true));
        const method = JSON.parse(reads[2].text);
        const basis = { methodVersion: method.version, mode: method.content.logic, refs: reads.map(result => result.ref) };
        // The expression is selected from the actually returned native method;
        // calculation and writing are performed by the SDK's original bash tool.
        const program = [
          'import csv,json,hashlib', 'from pathlib import Path', 'from decimal import Decimal',
          `root=Path(${JSON.stringify(project.rootPath)})`,
          `basis=json.loads(${JSON.stringify(JSON.stringify(basis))})`,
          'def total(name):', "    with (root/'020_clean'/name).open() as source: return sum(Decimal(row['amount']) for row in csv.DictReader(source))",
          "gross=total('sales.csv'); refunds=total('refunds.csv')", "assert basis['mode'] in ['gross','net-after-refund']",
          "result=gross if basis['mode']=='gross' else gross-refunds",
          "value={**basis,'gross':str(gross),'refunds':str(refunds),'result':str(result),'formula':'sum(sales)' if basis['mode']=='gross' else 'sum(sales)-sum(refunds)','inputs':{name:hashlib.sha256((root/'020_clean'/name).read_bytes()).hexdigest() for name in ['sales.csv','refunds.csv']},'limit':'synthetic engineering only; no cause/effect claim'}",
          `target=root/${JSON.stringify(reportPath)}`, "target.write_text(json.dumps(value,ensure_ascii=False,indent=2)); print(json.dumps(value,ensure_ascii=False))",
        ].join('\n');
        call = { name: 'bash', arguments: { command: `python3 - <<'STUDIO_USE_ENGINEERING'\n${program}\nSTUDIO_USE_ENGINEERING` } };
      }
      return call ? { calls: [call] } : { text: `合成工程报告已另存 ${reportPath}；采用准确方法V${version}。非独立专业核验。` };
    });
    const requestId = randomUUID();
    await json(await host.request(`${route}/messages`, 'POST', { requestId, text: '从同企业正式目录读取销售与售后依据及当前方法，用原工具计算并另存准确版本报告。' }), 202);
    let state: any; const deadline = Date.now() + 30_000;
    do { state = await json(await host.request(route)); if (state.task.lastRun?.id === requestId && state.snapshot.status === 'idle') break; await new Promise(resolve => setTimeout(resolve, 20)); } while (Date.now() < deadline);
    assert.equal(state.task.lastRun?.status, 'completed');
    assert.deepEqual(provider.errors, []);
    const tools = state.snapshot.messages.filter((message: any) => message.role === 'toolResult');
    assert.equal(tools.length, 7); assert.ok(tools.every((message: any) => !message.isError));
    const report = JSON.parse(await readFile(path.join(project.rootPath, reportPath), 'utf8'));
    assert.equal(report.methodVersion, version); assert.equal(Number(report.result), expected);
    assert.equal(report.inputs['sales.csv'], hash(salesBytes)); assert.equal(report.inputs['refunds.csv'], hash(refundBytes));
    assert.equal(report.refs[0].version, sales.version); assert.equal(report.refs[1].version, refunds.version);
    assert.equal(report.refs[2].id, methodId); assert.equal(report.refs[2].version, String(version));
    assert.ok(report.refs.every((ref: any) => /^[a-f0-9]{64}$/.test(ref.sha256)));
    return { taskId: task.id, sessionFile: state.task.sessionFile, reportPath };
  };
  const old = await run(1, 600), oldReport = await readFile(path.join(project.rootPath, old.reportPath)), oldHistory = await readFile(old.sessionFile);
  const revision = await json(await host.request(`/api/sap/methods/${methodId}/versions`, 'POST', { requestId: randomUUID(), baseVersion: 1, title: '扣退款后净额工程方法', content: { ...first.version.content, logic: 'net-after-refund' }, sources: [] }), 201);
  await publish(revision.version);
  const current = await run(2, 550);
  assert.notEqual(current.taskId, old.taskId);
  assert.deepEqual(await readFile(path.join(project.rootPath, old.reportPath)), oldReport);
  assert.deepEqual(await readFile(old.sessionFile), oldHistory);
  const oldMethod = await json(await host.request(`/api/sap/methods/${methodId}/versions/1`));
  assert.equal(oldMethod.method.versions.find((item: any) => item.version === 1).content.logic, 'gross');
});
