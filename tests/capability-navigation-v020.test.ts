import test from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/register-ui.ts';
const modules = {
  ...await import('../src/host/ui/CapabilitySettings.tsx'),
  ...await import('../src/host/ui/StudioPage.tsx'),
  ...await import('../extensions/business-plugins/sim-lab/ui/SimLabPage.tsx'),
  ...await import('../extensions/business-plugins/model-pack/ui/ModelRegistryPage.tsx'),
};
async function render(name: keyof typeof modules, props: Record<string, unknown>) {
  const [React, Dom] = await Promise.all([import('react'), import('react-dom/server')]);
  return Dom.renderToStaticMarkup(React.createElement(modules[name] as React.ComponentType<never>, props as never));
}
test('Skill low-frequency settings show exact source/version, declared dependencies and original evaluation without presenting availability as execution', async () => {
  const html = await render('SkillCapabilitySettings', { initial: { skills: [{ id: 'data-analysis', title: '准确安装的运营分析', description: '当前SDK元信息', version: 'sha256:fixed-version', sha256: 'a'.repeat(64), source: 'bundled:data-analysis/SKILL.md' }], diagnostics: [] }, onProject() {}, onModelSettings() {} });
  assert.match(html, /bundled:data-analysis\/SKILL.md/); assert.match(html, /sha256:fixed-version/); assert.match(html, /未在此执行依赖检查/); assert.match(html, /项目方案中查看与改选/); assert.doesNotMatch(html, /已启用|实际已采用|安装全部|业务插件/);
});
test('domain asset pack keeps the approved empty settings panel', async () => {
  const html = await render('CapabilityPlansSettings', { onProject() {} });
  assert.match(html, /领域资产包/); assert.doesNotMatch(html,/接入规划|数据质量与业务对账/); assert.doesNotMatch(html, /月度经营复盘|会员复购诊断|S01|PPT 逐页精修|经营推演/);
});
test('Task business navigation reaches original report, RAP, comparison, model and authorization work without a market', async () => {
  const html = await render('TaskCapabilityNavigation', { onOpen() {} });
  for (const label of ['查看项目共用约定', '局部需求与 RAP', '报告与 PPT 生成', 'PPT 精修与原版本', '方案比较与经营推演', '预测模型与原注册表', '任务能力与显式启用', '项目资料与连接授权']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /插件市场|启动分析|自动开启/);
});
test('an exact Studio URL target is never replaced by another system when missing, unassigned or no longer visible', async () => {
  const resolve = modules.resolveStudioSystemLocation;
  const systems = [{ id: 'original', enterpriseId: 'enterprise' }, { id: 'other', enterpriseId: 'other-enterprise' }, { id: 'legacy-unassigned' }], directory = { enterprises: [{ id: 'enterprise', name: '原企业', revision: 1, createdAt: '2026-11-16T00:00:00Z' }] };
  assert.deepEqual(resolve('original', systems, directory), { status: 'available', systemId: 'original', enterpriseId: 'enterprise' });
  assert.deepEqual(resolve('missing', systems, directory), { status: 'unavailable', systemId: 'missing' });
  assert.deepEqual(resolve('other', systems, directory), { status: 'unavailable', systemId: 'other' });
  assert.deepEqual(resolve('legacy-unassigned', systems, directory), { status: 'unavailable', systemId: 'legacy-unassigned' });
  assert.deepEqual(resolve('original', systems, undefined), { status: 'loading', systemId: 'original' });
  assert.deepEqual(resolve(undefined, systems, directory), { status: 'none' });
});
test('an unresolved Studio target remains visible without opening a different workbench, and original business back labels keep their origin', async () => {
  const studio = await render('StudioPage', { projects: [], initialSystemId: 'exact-original-system', onOpenTask() {} });
  assert.match(studio, /保留原体系定位/); assert.match(studio, /exact-original-system/); assert.match(studio, /未打开其他体系/); assert.doesNotMatch(studio, /studio-system-workbench/);
  const sim = await render('SimLabPage', { projects: [{ id: 'origin', name: '原项目', archivedAt: null, tasks: [] }, { id: 'newest', name: '较新项目', archivedAt: null, tasks: [] }], initialProjectId: 'origin', backLabel: '返回原工作', onBack() {}, onOpenTask() {} });
  assert.match(sim, /value="origin" selected/); assert.doesNotMatch(sim, /value="newest" selected|返回能力目录/); assert.match(sim, /返回原工作/);
  const models = await render('ModelRegistryPage', { backLabel: '返回原任务', onBack() {} }); assert.match(models, /返回原任务/); assert.doesNotMatch(models, /返回能力目录/);
});
test('the actual Skill metadata endpoint is a read-only environment query and failures retain original resources', async () => {
  const read = modules.readSkillCapabilities;
  const original = globalThis.fetch, calls: { url: string; init?: RequestInit }[] = [];
  try {
    globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ skills: [], diagnostics: [] }), { status: 200 }); };
    assert.deepEqual(await read(), { skills: [], diagnostics: [] }); assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/capabilities/skills'); assert.equal(calls[0].init?.method, 'GET'); assert.equal(calls[0].init?.body, undefined); assert.equal(calls[0].init?.credentials, 'omit');
    globalThis.fetch = async () => new Response('{}', { status: 503 }); await assert.rejects(read(), /原配置和已选引用仍保留/);
  } finally { globalThis.fetch = original; }
});
test('a same-named external Skill does not inherit the bundled Skill historical evaluation or dependency declaration', async () => {
  const props = { onProject() {}, onModelSettings() {}, initial: { skills: [{ id: 'data-analysis', title: '本机同名自定义能力', version: 'external-v1', sha256: 'b'.repeat(64), source: '/private/pi/skills/data-analysis/SKILL.md' }], diagnostics: [] } };
  const external = await render('SkillCapabilitySettings', props); assert.match(external, /本机同名自定义能力/); assert.doesNotMatch(external, /6df72f4|40\.1 倍|声明依赖 python3/);
  const bundled = await render('SkillCapabilitySettings', { ...props, initial: { ...props.initial, skills: [{ ...props.initial.skills[0], source: '/known/code/extensions/analysis-assets/data-analysis/SKILL.md', bundled: true }] } });
  assert.match(bundled, /6df72f4/); assert.match(bundled, /历史被测版本/);
});

test('an external Skill with a copied builtin-looking suffix still requires Host-qualified distribution identity before showing a builtin evaluation', async () => {
  const html = await render('SkillCapabilitySettings', { onProject() {}, onModelSettings() {}, initial: { skills: [{ id: 'data-analysis', title: '外部复制目录', version: 'external-copy', sha256: 'c'.repeat(64), source: '/external-copy/extensions/analysis-assets/data-analysis/SKILL.md', bundled: false }], diagnostics: [] } });
  assert.doesNotMatch(html, /6df72f4|声明依赖 python3/);
});

test('the exact user-approved data-analysis package shows the current waiver separately from historical measurements', async () => {
  const html = await render('SkillCapabilitySettings', { onProject() {}, onModelSettings() {}, initial: { skills: [{ id: 'data-analysis', title: '运营数据分析', version: 'sha256:05402899ac630de257799686828ae4b8a5f2ec1056427f711cc79a9eaf6ce0f6', sha256: '05402899ac630de257799686828ae4b8a5f2ec1056427f711cc79a9eaf6ce0f6', source: '/known/code/extensions/analysis-assets/data-analysis/SKILL.md', bundled: true }], diagnostics: [] } });
  assert.match(html, /用户已确认本版通过/); assert.match(html, /未运行对照测评/);
  assert.match(html, /历史测评/); assert.match(html, /6df72f4/); assert.match(html, /40\.1 倍/);
  assert.doesNotMatch(html, /用户已确认结论覆盖本轮工程修正后的交付版/);
  assert.doesNotMatch(html, /修正版待复测/);
});

test('another installed package cannot inherit the fixed data-analysis waiver by name or distribution path', async () => {
  const base = { id: 'data-analysis', title: '另一份内容', version: 'other-content', sha256: 'c'.repeat(64), source: '/known/code/extensions/analysis-assets/data-analysis/SKILL.md', bundled: true };
  for (const skill of [base, { ...base, sha256: '05402899ac630de257799686828ae4b8a5f2ec1056427f711cc79a9eaf6ce0f6', bundled: false }]) {
    const html = await render('SkillCapabilitySettings', { onProject() {}, onModelSettings() {}, initial: { skills: [skill], diagnostics: [] } });
    assert.doesNotMatch(html, /用户已确认本版通过/);
  }
});
