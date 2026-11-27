import fs from 'node:fs';
import assert from 'node:assert/strict';
import {setup} from './vm-harness.mjs';
const checks=[];
const check=(name,fn)=>{fn();checks.push({name,passed:true})};
const old=JSON.parse(fs.readFileSync(new URL('./v0.5-state.json',import.meta.url),'utf8')).state,oldScenes=JSON.stringify(old.scenes);
const r=setup(old);
check('v0.5 migration preserves complete nonempty Case work states',()=>assert.equal(r.run('JSON.stringify(state.scenes)'),oldScenes));
check('v0.5 migration preserves global project search and filter',()=>{
 assert.equal(r.run('state.workspace.projectSearch'),'会员');assert.equal(r.run('state.workspace.projectFilter'),'shared');
});
check('accepted Decision Case navigation and local four tabs remain',()=>{
 assert.match(r.h,/Decision Case/);for(const tab of ['current','projects','assets','history'])assert.match(r.h,new RegExp('data-tab="'+tab+'"'));
 assert.match(r.run("renderIssueGraph()"),/复购口径校准/);
});
check('v0.6 first entry is homepage and later reload preserves deliberate route',()=>{
 assert.equal(r.run('state.workspace.view'),'home');
 r.run("showWorkspace('projects')");assert.equal(setup(r.json('state')).run('state.workspace.view'),'projects');
});
check('homepage separates explicit requests, external waiting and continuing work',()=>{
 const a=setup(),home=a.run('renderHome()');assert.equal(a.run('pendingRequests().length'),2);
 for(const text of ['待处理事项','继续工作','进展关注','基础建设提醒','战略选择','目标管理','语义资产','分析资产'])assert.ok(home.includes(text),text);
 assert.equal(a.run("pendingRequests().some(r=>r.issueId==='causes')"),false);
 assert.ok(a.run('pendingRequests().every(r=>r.id&&r.requester&&r.assignee&&r.body&&r.scene&&r.issueId&&r.round)'));
});
check('opening request and its source has no completion or work-record side effects',()=>{
 const a=setup(),before=a.run('JSON.stringify(state.scenes)');
 a.run("openPendingRequest('request-expansion-choice');openSource('request:request-expansion-choice')");
 assert.equal(a.run('state.scene'),'enterprise');assert.equal(a.run('current().id'),'expansion');assert.equal(a.run('current().round'),2);
 assert.equal(a.run('pendingRequests().length'),2);assert.equal(a.run('JSON.stringify(state.scenes)'),before);
 assert.match(a.node('#modal').innerHTML,/请林予安结合三店观察/);
});
check('unrelated, wrong-request, wrong-round and wrong-type records do not complete request',()=>{
 const a=setup();a.run("openPendingRequest('request-expansion-choice');current().choices.push({id:'unrelated',choice:'普通记录'});current().choices.push({id:'wrong-id',pendingRequestId:'another-request',round:2});current().choices.push({id:'wrong-round',pendingRequestId:'request-expansion-choice',round:1});current().feedback.push({id:'wrong-type',pendingRequestId:'request-expansion-choice',round:2})");
 assert.equal(a.run('pendingRequests().length'),2);
});
check('saving response through original choice form resolves only its exact request',()=>{
 const a=setup();a.run("openPendingRequest('request-expansion-choice')");
 a.submit('choiceForm',{choice:'继续三店，补齐可比观察',reason:'完整窗口尚未取得',next:'等待第二周记录',pendingRequestId:'request-expansion-choice'});
 assert.equal(a.run('pendingRequests().length'),1);assert.equal(a.run('current().choices.at(-1).pendingRequestId'),'request-expansion-choice');
 assert.equal(a.run('current().choices.at(-1).round'),2);assert.equal(a.run('current().feedback.length'),0);
});
check('saving exact feedback response resolves request without completing external action',()=>{
 const a=setup();a.run("openPendingRequest('request-interview-feedback')");const before=a.run('JSON.stringify(state.scenes.enterprise)');
 a.submit('feedbackForm',{date:'2026-11-27',observation:'两次访谈都提到跨团队沟通，背景不同',source:'前两位受访者原话',pendingRequestId:'request-interview-feedback'});
 assert.equal(a.run('pendingRequests().length'),1);assert.equal(a.run('current().feedback.at(-1).pendingRequestId'),'request-interview-feedback');
 assert.equal(a.run('JSON.stringify(state.scenes.enterprise)'),before);
});
check('input and simulated arrangement create no Case, adoption or sent messages',()=>{
 const a=setup(),scenes=a.run('JSON.stringify(state.scenes)');a.input('homeInput','我想重新安排下一季度学习投入');a.run('arrangeIntake()');
 assert.equal(a.run('Object.keys(state.dynamicCases).length'),0);assert.equal(a.run('Object.keys(state.goalAdoptions).length'),0);assert.equal(a.run('JSON.stringify(state.scenes)'),scenes);
 assert.match(a.run('renderIntakeResult()'),/模拟/);assert.equal(a.run('state.home.result.input'),'我想重新安排下一季度学习投入');
});
check('inserting example preserves existing text and original arrangement',()=>{
 const a=setup();a.input('homeInput','尚未发送的原始文字');a.run('arrangeIntake()');const id=a.run('state.home.result.id');
 a.click({act:'intake-example',example:'personal'});assert.match(a.run('state.home.input'),/^尚未发送的原始文字/);assert.equal(a.run('state.home.result.id'),id);
});
check('continuing Case protects nonempty draft and messages, queuing one separate input',()=>{
 const a=setup();a.run("current().draft='原事项的未发送草稿';scene().issueView='tree';scene().browse='all';scene().assetScope='case'");
 const before=a.run('JSON.stringify(current().messages)');a.input('homeInput','本周又有三店观察');a.run("arrangeIntake();continueIntake('enterprise');continueIntake('enterprise')");
 assert.equal(a.run('current().draft'),'原事项的未发送草稿');assert.equal(a.run('JSON.stringify(current().messages)'),before);
 assert.equal(a.run('state.transfers[transferKey()].length'),1);assert.equal(a.run('state.transfers[transferKey()][0].text'),'本周又有三店观察');
 assert.equal(a.run('scene().issueView'),'tree');assert.equal(a.run('scene().browse'),'all');assert.equal(a.run('scene().assetScope'),'case');
});
check('transfer append is explicit, retains original input and is idempotent without sending',()=>{
 const a=setup();a.run("current().draft='原草稿';queueTransfer('enterprise',current().id,'新输入','token');const transferId=state.transfers[transferKey()][0].id");
 const messages=a.run('JSON.stringify(current().messages)');a.run('appendTransfer(transferId);appendTransfer(transferId)');
 assert.equal(a.run('current().draft'),'原草稿\n\n新输入');assert.equal(a.run('JSON.stringify(current().messages)'),messages);
 assert.equal(a.run('state.transfers[transferKey()][0].text'),'新输入');assert.equal(a.run('state.transfers[transferKey()][0].status'),'appended');
});
check('preparation edits and navigation stay drafts until explicit commit',()=>{
 const a=setup();a.input('homeInput','准备学习计划');a.run("prepareCase('suggested')");a.input('prepareGoal','六周内完成两次可展示的实践');a.input('prepareStrategy','先比较两个候选主题');
 const draft=a.json('currentPreparation()');a.run("showWorkspace('overview');showWorkspace('home')");const b=setup(a.json('state'));
 assert.equal(b.run('Object.keys(state.dynamicCases).length'),0);assert.equal(b.run('Object.keys(state.goalAdoptions).length'),0);
 assert.deepEqual(b.json(`state.creationDrafts['${draft.id}']`),draft);assert.equal(b.run('state.home.input'),'准备学习计划');
});
check('manual route is usable without model or foundation prerequisites',()=>{
 const a=setup();a.input('homeInput','独立安排读书');a.run("prepareCase('manual')");assert.equal(a.run('currentPreparation().goal'),'');assert.equal(a.run('currentPreparation().strategy'),'');
 a.input('prepareGoal','一个月内读完一本书并写出应用笔记');a.input('prepareStrategy','每周阅读并尝试一个例子');a.submit('preparationForm',{});
 assert.equal(a.run('Object.keys(state.dynamicCases).length'),1);assert.equal(a.run('relatedProjects(base().caseId).length'),0);assert.equal(a.run('assets().length'),0);
 assert.equal(a.run('current().choices.length+current().feedback.length+current().messages.length'),0);
});
check('new G/S adoption and Case creation preserve original input and candidate with one identity',()=>{
 const a=setup();a.input('homeInput','我的原始职业想法');a.run("prepareCase('suggested');const prepId=currentPreparation().id");const original=a.json('currentPreparation().originalCandidate');
 a.input('prepareGoal','12周内用实际作品选择一个方向');a.run('commitPreparation();commitPreparation()');
 assert.equal(a.run('Object.keys(state.goalAdoptions).length'),1);assert.equal(a.run('Object.keys(state.dynamicCases).length'),1);
 assert.equal(a.run('base().originalInput'),'我的原始职业想法');assert.equal(a.run('current().question'),'我的原始职业想法');assert.deepEqual(a.json('base().gsHistory[0].originalCandidate'),original);
 assert.equal(a.run('current().messages.length'),0);assert.equal(a.run('current().choices.length'),0);
});
check('existing adopted G/S without Case creates once without another adoption',()=>{
 const a=setup();a.input('homeInput','客服午间需要改进');a.run("prepareCase('adopted','bundle-response-v1');commitPreparation();commitPreparation()");
 assert.equal(a.run('Object.keys(state.dynamicCases).length'),1);assert.equal(a.run('Object.keys(state.goalAdoptions).length'),0);
 assert.equal(a.run('base().bundleRef'),'bundle-response-v1');
});
check('exact existing G/S uses reference identity and continues with new name/input retained',()=>{
 const a=setup();a.run("current().draft='已有输入'");a.input('homeInput','新写的业务背景');a.run("prepareCase('adopted','bundle-retention-v1')");a.input('prepareTitle','我新写的名称');a.run('commitPreparation()');
 assert.equal(a.run('state.scene'),'enterprise');assert.equal(a.run('Object.keys(state.dynamicCases).length'),0);assert.equal(a.run('Object.keys(state.goalAdoptions).length'),0);
 assert.equal(a.run('current().draft'),'已有输入');assert.equal(a.run('state.transfers[transferKey()][0].text'),'新写的业务背景');
 assert.equal(a.run("Object.values(state.creationDrafts)[0].title"),'我新写的名称');
});
check('editing an adopted G/S candidate clears inherited identity before adoption',()=>{
 const a=setup();a.input('homeInput','想实质调整方向');a.run("prepareCase('adopted','bundle-retention-v1')");a.input('prepareGoal','这次实质不同的目标');
 assert.equal(a.run('currentPreparation().bundleRef'),null);assert.equal(a.run('preparationMatch(currentPreparation())'),null);
 assert.equal(a.run("baseScenarios.enterprise.goal"),'60天会员复购率达到 23%');
});
check('interrupted creation preserves adoption and input, retry creates only Case',()=>{
 const a=setup();a.input('homeInput','安排每周运动');a.run("prepareCase('suggested');currentPreparation().simulateInterruption=true;commitPreparation()");
 assert.equal(a.run('currentPreparation().creationState'),'pending');assert.equal(a.run('Object.keys(state.goalAdoptions).length'),1);assert.equal(a.run('Object.keys(state.dynamicCases).length'),0);
 const b=setup(a.json('state'));b.run('commitPreparation();commitPreparation()');assert.equal(b.run('Object.keys(state.goalAdoptions).length'),1);assert.equal(b.run('Object.keys(state.dynamicCases).length'),1);assert.equal(b.run('base().originalInput'),'安排每周运动');
});
check('discarding interrupted draft preserves adopted result and other Case drafts',()=>{
 const a=setup();a.run("current().draft='独立保留的旧草稿'");a.input('homeInput','准备家庭预算');a.run("prepareCase('suggested');currentPreparation().simulateInterruption=true;commitPreparation();const abandoned=currentPreparation().id;discardDraft('preparation',abandoned)");
 assert.equal(a.run('Object.keys(state.goalAdoptions).length'),1);assert.equal(a.run('Object.keys(state.dynamicCases).length'),0);assert.equal(a.run('state.scenes.enterprise.items[0].draft'),'独立保留的旧草稿');
 assert.equal(a.run('state.creationDrafts[abandoned].discarded'),true);
});
check('new Case sources reflect its own G/S and original input, with no borrowed retail body',()=>{
 const a=setup();a.input('homeInput','我要建立家庭阅读习惯');a.run("prepareCase('manual')");a.input('prepareGoal','每周共同阅读两次');a.input('prepareStrategy','先用周末固定时段试行');a.run('commitPreparation()');
 const s=a.json("sourceContent('goal')");assert.match(s.body,/共同阅读两次/);assert.match(s.body,/家庭阅读习惯/);assert.doesNotMatch(s.body,/三店|复购率|23%/);assert.equal(s.caseIds[0],a.run('base().caseId'));
 a.click({act:'foundation',kind:'分析资产'});assert.doesNotMatch(a.node('#modal').innerHTML,/三店试点观察报告/);
});
check('dynamic Case and adopted history survive reload, reset clears only demo state',()=>{
 const a=setup();a.input('homeInput','新的个人计划');a.run("prepareCase('suggested');commitPreparation();current().draft='创建后尚未发送';scene().issueView='tree'");
 const b=setup(a.json('state'));assert.equal(b.run('base().local'),true);assert.equal(b.run('current().draft'),'创建后尚未发送');assert.equal(b.run('scene().issueView'),'tree');assert.equal(b.run('allCaseEntries().length'),4);
 b.click({act:'confirm-reset'});assert.equal(b.run('allCaseEntries().length'),3);assert.equal(b.run('Object.keys(state.dynamicCases).length'),0);
});
check('draft markup escapes user HTML in homepage, preparation, transfers and Case source',()=>{
 const a=setup();a.input('homeInput','<img src=x onerror=alert(1)>');a.run('arrangeIntake()');assert.doesNotMatch(a.run('renderHome()'),/<img src=x/);
 a.run("prepareCase('suggested')");assert.doesNotMatch(a.run('renderPreparation()'),/<img src=x/);a.run('commitPreparation()');assert.doesNotMatch(a.run("sourceContent('goal').body"),/<img src=x/);
 assert.doesNotMatch(a.run('renderProjects()'),/<img src=x/);assert.match(a.run('renderProjects()'),/&lt;img src=x/);assert.doesNotMatch(a.run('renderOverview()'),/<img src=x/);
});
check('transfer provenance and original text remain readable after append, send and reload',()=>{
 const a=setup();a.input('homeInput','来自首页的明确原文');a.run("arrangeIntake();continueIntake('enterprise');const originalTransfer=state.transfers[transferKey()][0];appendTransfer(originalTransfer.id)");
 assert.match(a.run('renderTransfers(current())'),/工作台首页/);assert.match(a.run('renderTransfers(current())'),/已追加的原始输入/);assert.match(a.run('renderTransfers(current())'),/来自首页的明确原文/);
 a.run('sendMessage()');const b=setup(a.json('state'));assert.match(b.run('renderTransfers(current())'),/实际发送内容以对话记录为准/);assert.match(b.run('renderTransfers(current())'),/来自首页的明确原文/);
 assert.equal(b.run('state.transfers[transferKey()][0].status'),'appended');
});
check('analysis foundation reminder distinguishes reusable assets from Case report output',()=>{
 const a=setup();a.click({act:'analysis-foundation-guide'});assert.match(a.node('#modal').innerHTML,/分析方法、Skill、计算脚本和模型/);assert.match(a.node('#modal').innerHTML,/观察报告属于具体成果/);
});
check('explicit G/S revision stores a new version without losing old source or original input',()=>{
 const a=setup();a.input('homeInput','最早的问题');a.run("prepareCase('suggested');commitPreparation();const originalGoal=base().goal;prepareRevision()");a.input('prepareGoal','经讨论后修正的目标');
 assert.equal(a.run('base().goal'),a.run('originalGoal'));a.run('commitPreparation()');assert.equal(a.run('base().goal'),'经讨论后修正的目标');assert.equal(a.run('base().gsHistory.length'),2);
 assert.equal(a.run("sourceContent('goal','v1').version"),'v1');assert.equal(a.run("sourceContent('goal','latest').version"),'v2');assert.equal(a.run('base().originalInput'),'最早的问题');
});
fs.mkdirSync('.local/decision-case-daily-workspace-validation',{recursive:true});
fs.writeFileSync('.local/decision-case-daily-workspace-validation/receipt.json',JSON.stringify({mode:'actual full inline script in Node VM with DOM stubs; no browser rendering/real keyboard',sha256:r.sha256,checks,total:checks.length,passed:checks.length},null,2));
console.log(JSON.stringify({total:checks.length,passed:checks.length,sha256:r.sha256}));
