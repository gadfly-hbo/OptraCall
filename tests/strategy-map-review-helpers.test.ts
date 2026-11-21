import assert from 'node:assert/strict';
import test from 'node:test';
import type { StrategyMapDraft } from '../src/host/strategy-map-types.ts';
import {
  applyManualEditRecord,
  emptyManualEditOverlay,
  findSafeDuplicateCandidates,
  matchesSourcePage,
  mergeDuplicatePairInDraft,
  mergeRereadDraftWithManualEdits,
} from '../src/host/ui/strategy-map-review-helpers.ts';

function sampleDraft(): StrategyMapDraft {
  return {
    title: '会员复购战略图',
    template: 'table',
    choice: '聚焦新客二购',
    excluded: '',
    assumptions: '',
    unknowns: '',
    nodes: [
      {
        id: 'G1',
        kind: 'goal',
        title: '复购率（新客）',
        metric: '90天复购率',
        baseline: '9%',
        target: '18%',
        unit: '%',
        reviewState: 'clear',
        sourceLocation: { sourceId: 'src-a', page: 1, bbox: [100, 100, 300, 120], label: '原稿 A 第 1 页' },
      },
      {
        id: 'G2',
        kind: 'goal',
        title: '复购率（老客）',
        metric: '90天复购率',
        baseline: '18%',
        target: '25%',
        unit: '%',
        reviewState: 'clear',
        sourceLocation: { sourceId: 'src-b', page: 1, bbox: [100, 100, 300, 120], label: '原稿 B 第 1 页' },
      },
      {
        id: 'S1',
        kind: 'strategy',
        title: '导购企微触达',
        reviewState: 'clear',
        sourceLocation: { sourceId: 'src-a', page: 2, bbox: [120, 240, 280, 100], label: '原稿 A 第 2 页' },
      },
    ],
    edges: [
      {
        id: 'E1',
        from: 'S1',
        to: 'G1',
        kind: 'unknown',
        reviewState: 'needs-review',
        ambiguityReason: '箭头被遮挡',
        sourceLocation: { sourceId: 'src-a', page: 1, arrowBbox: [200, 220, 100, 80], label: '原稿 A 第 1 页连线' },
      },
    ],
  };
}

test('matchesSourcePage isolates hotspots by BOTH sourceId and page (Item 5D)', () => {
  const draft = sampleDraft();
  const srcAPage1 = draft.nodes.filter(n => matchesSourcePage(n.sourceLocation, 'src-a', 1));
  const srcBPage1 = draft.nodes.filter(n => matchesSourcePage(n.sourceLocation, 'src-b', 1));
  const srcAPage2 = draft.nodes.filter(n => matchesSourcePage(n.sourceLocation, 'src-a', 2));

  assert.deepEqual(srcAPage1.map(n => n.id), ['G1'], 'source B page 1 must NEVER bleed onto source A page 1');
  assert.deepEqual(srcBPage1.map(n => n.id), ['G2'], 'source A page 1 must NEVER bleed onto source B page 1');
  assert.deepEqual(srcAPage2.map(n => n.id), ['S1'], 'source A page 1 must NEVER bleed onto source A page 2');
  assert.equal(matchesSourcePage(undefined, 'src-a', 1), false);
});

test('mergeRereadDraftWithManualEdits preserves manual baseline edit 9% -> 15% across local reread (Item 6B)', () => {
  const initial = sampleDraft();
  // User manually edits G1.baseline from 9% -> 15% and adds a manual node S2
  let overlay = emptyManualEditOverlay();
  overlay = applyManualEditRecord(overlay, { kind: 'node-patch', id: 'G1', patch: { baseline: '15%', reviewState: 'confirmed' } });
  overlay = applyManualEditRecord(overlay, {
    kind: 'node-add',
    node: { id: 'S2', kind: 'strategy', title: '会员等级权益升级', reviewState: 'confirmed' },
  });

  // Agent rereads E1 and returns a draft that updates E1 -> supports/clear, but mistakenly reverts G1.baseline back to 9% and omits S2
  const incomingReread: StrategyMapDraft = {
    ...initial,
    edges: [{ ...initial.edges[0]!, kind: 'supports', reviewState: 'clear', ambiguityReason: '' }],
  };

  const { merged, preservedCount, notices } = mergeRereadDraftWithManualEdits(incomingReread, overlay);
  assert.equal(merged.nodes.find(n => n.id === 'G1')?.baseline, '15%', 'user manual edit 15% MUST survive reread');
  assert.equal(merged.nodes.find(n => n.id === 'G1')?.reviewState, 'confirmed');
  assert.ok(merged.nodes.some(n => n.id === 'S2' && n.title === '会员等级权益升级'), 'user added node MUST survive reread');
  assert.equal(merged.edges.find(e => e.id === 'E1')?.kind, 'supports', 'Agent reread update on untouched edge E1 MUST apply');
  assert.equal(merged.edges.find(e => e.id === 'E1')?.reviewState, 'clear');
  assert.ok(preservedCount >= 2);
  assert.ok(notices.some(n => n.includes('G1') && n.includes('15%')));
});

test('findSafeDuplicateCandidates preserves parenthetical business qualifiers and only advises on exact duplicates (Item 7A)', () => {
  const draft = sampleDraft();
  // 复购率（新客）9% vs 复购率（老客）18% MUST NOT be flagged as duplicates!
  assert.deepEqual(findSafeDuplicateCandidates(draft.nodes), []);

  // Different plan qualifiers or metrics with same base words MUST NOT be flagged either
  const qualifiedNodes = [
    { id: 'G1', kind: 'goal' as const, title: '门店拓展（华东）', target: '12家' },
    { id: 'G2', kind: 'goal' as const, title: '门店拓展（华南）', target: '8家' },
    { id: 'G3', kind: 'goal' as const, title: 'GMV 目标 (方案A)', target: '1亿' },
    { id: 'G4', kind: 'goal' as const, title: 'GMV 目标 (方案B)', target: '1.5亿' },
    { id: 'G5', kind: 'goal' as const, title: '客单价提升', baseline: '120', target: '150' },
    { id: 'G6', kind: 'goal' as const, title: '客单价提升', baseline: '200', target: '260' },
  ];
  assert.deepEqual(findSafeDuplicateCandidates(qualifiedNodes), []);

  // True exact duplicate (same kind + identical full title + no conflicting qualifiers) is surfaced as advisory candidate
  const withExactDup: StrategyMapDraft = {
    ...draft,
    nodes: [
      ...draft.nodes,
      { id: 'G1_DUP', kind: 'goal', title: '复购率（新客）', metric: '90天复购率', baseline: '9%', target: '18%', unit: '%' },
    ],
    edges: [
      ...draft.edges,
      { id: 'E2', from: 'S1', to: 'G1_DUP', kind: 'supports' },
    ],
  };
  const candidates = findSafeDuplicateCandidates(withExactDup.nodes);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.keep.id, 'G1');
  assert.equal(candidates[0]!.duplicate.id, 'G1_DUP');
  // Advisory check does NOT mutate original array
  assert.equal(withExactDup.nodes.length, 4);

  // Explicit user-confirmed merge rewires edges cleanly and removes only the dropped duplicate
  const merged = mergeDuplicatePairInDraft(withExactDup, 'G1', 'G1_DUP');
  assert.equal(merged.nodes.length, 3);
  assert.ok(!merged.nodes.some(n => n.id === 'G1_DUP'));
  assert.ok(merged.edges.some(e => e.from === 'S1' && e.to === 'G1' && e.kind === 'supports'));
});

test('Round-2 Item 3: mergeRereadDraftWithManualEdits preserves top-level draft fields (title, template, choice, unknowns) with conflict notices', async () => {
  const { mergeRereadDraftWithManualEdits: mergeFn } = await import('../src/host/ui/strategy-map-review-helpers.ts');
  const initial = sampleDraft();
  let overlay = emptyManualEditOverlay();
  overlay = applyManualEditRecord(overlay, { kind: 'draft-patch', patch: { title: '用户修订方案标题' } });
  overlay = applyManualEditRecord(overlay, { kind: 'draft-patch', patch: { template: 'tree' } });
  overlay = applyManualEditRecord(overlay, { kind: 'draft-patch', patch: { choice: '先稳老客再扩新客', unknowns: '待核门店执行人手' } });
  overlay = applyManualEditRecord(overlay, { kind: 'node-patch', id: 'G1', patch: { baseline: '15%' } });

  // Incoming reread returns old title, bsc template, old choice, baseline 9%, and updated edge E1
  const incoming: StrategyMapDraft = {
    ...initial,
    title: '模型重读旧标题',
    template: 'bsc',
    choice: '旧选择',
    unknowns: '',
    edges: [{ ...initial.edges[0]!, kind: 'supports', reviewState: 'clear' }],
  };

  const { merged, notices } = mergeFn(incoming, overlay);
  assert.equal(merged.title, '用户修订方案标题');
  assert.equal(merged.template, 'tree');
  assert.equal(merged.choice, '先稳老客再扩新客');
  assert.equal(merged.unknowns, '待核门店执行人手');
  assert.equal(merged.nodes.find(n => n.id === 'G1')?.baseline, '15%');
  assert.equal(merged.edges.find(e => e.id === 'E1')?.kind, 'supports');
  assert.ok(notices.some(n => n.includes('方案名称') && n.includes('用户修订方案标题')));
  assert.ok(notices.some(n => n.includes('地图模板') && n.includes('目标与策略树')));
  assert.ok(notices.some(n => n.includes('G1') && n.includes('15%')));
});

test('Round-2 Item 6: matchesSourcePageAndImage and resolveEmbeddedImageIndex isolate Red and Blue images on the same worksheet', async () => {
  const { matchesSourcePageAndImage, resolveEmbeddedImageIndex } = await import('../src/host/ui/strategy-map-review-helpers.ts');
  const sheetImages = [
    { id: 'p2-img-1', objectId: 'pic-red', name: '红图战略板.png' },
    { id: 'p2-img-2', objectId: 'pic-blue', name: '蓝图战略板.png' },
  ];
  const locRed = { sourceId: 'xlsx-1', page: 2, objectId: 'pic-red', bbox: [100, 100, 300, 200] as [number, number, number, number], label: '策略页 · 红图' };
  const locBlue = { sourceId: 'xlsx-1', page: 2, objectId: 'pic-blue', bbox: [500, 300, 300, 200] as [number, number, number, number], label: '策略页 · 蓝图' };

  assert.equal(resolveEmbeddedImageIndex(locRed, sheetImages), 1);
  assert.equal(resolveEmbeddedImageIndex(locBlue, sheetImages), 2);

  // Viewing Red image (index 1): ONLY Red hotspot matches, Blue MUST NOT appear
  assert.equal(matchesSourcePageAndImage(locRed, 'xlsx-1', 2, 1, sheetImages), true);
  assert.equal(matchesSourcePageAndImage(locBlue, 'xlsx-1', 2, 1, sheetImages), false);

  // Viewing Blue image (index 2): ONLY Blue hotspot matches, Red MUST NOT appear
  assert.equal(matchesSourcePageAndImage(locRed, 'xlsx-1', 2, 2, sheetImages), false);
  assert.equal(matchesSourcePageAndImage(locBlue, 'xlsx-1', 2, 2, sheetImages), true);
});
