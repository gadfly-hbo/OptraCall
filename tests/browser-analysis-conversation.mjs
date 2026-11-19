// Exercise the original analysis owner and composer with an isolated Host and synthetic provider.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';

const uiPort = Number(process.env.OPTRACALL_ANALYSIS_UI_PORT || 4441);
const host = await startTestHost({uiPort});
const provider = await startToolProvider();
const frontend = spawn(process.execPath, ['scripts/frontend.mjs', 'dev', '--port', String(uiPort), '--strictPort'], {
  env: {...process.env, OPTRACALL_HOST_PORT: String(host.port)}, stdio: ['ignore', 'pipe', 'inherit']
});
let browser;
try {
  await new Promise((resolve, reject) => {
    frontend.stdout.on('data', chunk => { if (chunk.toString().includes(':' + uiPort + '/')) resolve(); });
    frontend.once('exit', code => reject(Error('Frontend exited during startup: ' + code)));
  });
  const post = async (route, body, method = 'POST') => {
    const r = await host.request(route, method, body);
    assert.ok(r.ok, route + ' ' + r.status);
    return r.json();
  };
  await post('/api/configuration', {name:'分析对话测试', provider:'openai-compatible', model:'synthetic', baseUrl:provider.baseUrl, apiKey:'synthetic-analysis-only'}, 'PUT');
  const {project} = await post('/api/projects', {name:'对话范围核对'});
  const route = '/api/projects/' + project.id + '/tasks';
  const {task} = await post(route, {name:'分析任务'});
  provider.setResponder(() => ({text:'已保存对话核对结果。\n' + Array.from({length:80}, (_, i) => '记录 ' + (i + 1)).join('\n')}));
  browser = await chromium.launch({channel:'chrome'});
  const page = await browser.newPage({viewport:{width:1440,height:960}});
  page.setDefaultTimeout(7000);
  await page.goto('http://127.0.0.1:' + uiPort);
  await page.getByRole('button',{name:project.name,exact:true}).click();
  await page.getByRole('button',{name:task.name,exact:true}).click();
  const textbox = page.getByRole('textbox',{name:'消息',exact:true});
  const launch = page.getByRole('button',{name:'放大对话',exact:true});
  const dialog = page.getByRole('dialog',{name:'任务对话 · ' + task.name});
  const draft = '只在当前分析任务发送这一条问题';
  await textbox.fill(draft);
  const original = await textbox.elementHandle();
  await launch.click();
  await dialog.waitFor();
  assert.equal(await dialog.locator('.task-workflow, .task-results, .harness-panel, .task-assignments, .workspace-footer').count(), 0, 'Task workflow, capabilities and results must remain outside the conversation');
  assert.equal(await page.locator('.chat-page .task-workflow').count() > 0, true);
  assert.ok(await page.evaluate(element => element === document.querySelector('dialog[open] #message-input'), original));
  assert.equal(await textbox.inputValue(), draft);
  await page.waitForFunction(() => document.querySelector('dialog[open] .send-button')?.disabled === false);
  await textbox.press('Enter');
  await dialog.locator('.message.assistant:not(.streaming-message)').filter({hasText:'已保存对话核对结果。'}).waitFor();
  assert.equal(await dialog.locator('.message.user').count(), 1);
  const history = dialog.locator('.message-scroll');
  const offset = await history.evaluate(e => {e.scrollTop = 100; return e.scrollTop;});
  assert.ok(offset > 0, 'Expanded history is independently scrollable');
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'hidden'});
  assert.ok(await launch.evaluate(e => document.activeElement === e));
  assert.ok(await page.evaluate(element => element === document.querySelector('#message-input'), original));
  assert.equal(await textbox.inputValue(), '');
  await launch.click(); await dialog.waitFor();
  assert.equal(await history.evaluate(e => e.scrollTop), offset);
  await page.setViewportSize({width:390,height:844});
  const bounds = await dialog.boundingBox();
  assert.ok(bounds && Math.abs(bounds.width - 390) <= 1 && Math.abs(bounds.x) <= 1);
  assert.equal(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth + 1), true);
  await textbox.fill('抽屉收起后保留');
  await dialog.getByRole('button',{name:'收起对话'}).click();
  await dialog.waitFor({state:'hidden'});
  assert.equal(await textbox.inputValue(), '抽屉收起后保留');
  assert.equal(provider.requests.length, 1);
  console.log('Analysis conversation only: desktop, narrow viewport, stable composer, scroll, draft, one native reply, Escape and focus return passed.');
} finally {
  await browser?.close(); frontend.kill('SIGTERM'); await host.close(); await provider.close();
}
