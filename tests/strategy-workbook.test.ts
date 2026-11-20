import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { decodeStrategyWorkbook, mapStrategyWorkbook } from '../src/host/strategy-workbook.ts';
import { defaultSelection } from '../src/host/strategy-workbook-types.ts';

async function sample() {
  const workbook=XLSX.utils.book_new(),goals=XLSX.utils.aoa_to_sheet([['年度目标'], ['目标编号','目标项','指标','基线','目标值','单位','关联策略编号'], ['001','二次购买','90日二购率',0,0.12,'%', 'S1，S2'], ['001','二次购买','回访率',0.09, null,'%','S1，S2']]);
  goals.D3.z='0%';goals.E3.z='0%';
  XLSX.utils.book_append_sheet(workbook,goals,'目标表');
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['策略编号','策略名称'],['S1','导购回访'],['S2','门店活动']]),'战略地图');
  return {workbook,goals,bytes:async()=>XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}) as Buffer};
}

test('Excel 原文件映射保留编号、零、百分比、多个指标、G/S 关系和每项准确出处', async () => {
  const {bytes} = await sample();
  const book = await decodeStrategyWorkbook('年度.xlsx', await bytes());
  const result = mapStrategyWorkbook(book, defaultSelection(book, 'map'));
  assert.deepEqual(result.errors, []);
  assert.equal(result.nodes.find(n=>n.id==='001')?.metrics?.[0]?.baseline,'0%');
  assert.equal(result.nodes.find(n=>n.id==='001')?.metrics?.[0]?.target,'12%');
  assert.equal(result.nodes.find(n=>n.id==='001')?.metrics?.[1]?.target,undefined);
  assert.deepEqual(result.edges.map(e=>[e.from,e.to]),[['S1','001'],['S2','001']]);
  assert.deepEqual(result.importSource.rows.filter(r=>r.nodeId==='001').map(r=>r.row),[3,4]);
  assert.equal(result.importSource.sheets.find(s=>s.name==='目标表')?.columns.metric,'C');
});

test('重复指标、未匹配关系、无缓存公式都要定位到原行并阻止生成草稿', async () => {
  const {goals,bytes}=await sample();
  XLSX.utils.sheet_add_aoa(goals,[['001','二次购买','90日二购率',{t:'n',f:'1/2'},null,'%', 'S404']],{origin:'A5'});
  const book=await decodeStrategyWorkbook('dup.xlsx',await bytes());
  const result=mapStrategyWorkbook(book,defaultSelection(book,'map'));
  assert.match(result.errors.join(' '),/第 5 行.*重复/);
  assert.match(result.errors.join(' '),/第 5 行.*S404/);
  assert.match(result.errors.join(' '),/D5.*公式/);
});

test('交接地图主指标和补充指标时均保留，完全相同的重复主行只带入一次', async()=>{
  const {goalCandidatesFromRows}=await import('../src/host/structured-goal.ts');
  const origin={fileName:'清单.xlsx',sha256:'b'.repeat(64),sheets:[{name:'统计',headerRow:1,columns:{metric:'B'}}],rows:[{nodeId:'G',sheet:'统计',row:2}]};
  const [goal]=goalCandidatesFromRows({groupId:'1160f608-8171-4c2e-a429-65168607c3ac',planTitle:'服务',nodes:[{id:'G',kind:'goal',title:'接待',metric:'留存',target:'0',metrics:[{metric:'留存',target:'0'},{metric:'满意度',target:'90%'}]}],edges:[],scope:{kind:'personal',id:'self',name:'个人工作'},perspective:'personal',selected:['G'],workbook:origin});
  assert.deepEqual(goal?.structured?.metrics.map(m=>[m.metric,m.target]),[['留存','0'],['满意度','90%']]);
});

test('原件只发布完整文件；明确拒存时回收孤立原件，未知结果和既有引用保留',async t=>{
  const {withWorkbookOriginal,readWorkbookOriginal}=await import('../src/host/strategy-workbook-source.ts');
  const {mkdtemp,rm,readdir}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const {createHash}=await import('node:crypto');
  const root=await mkdtemp(join(tmpdir(),'oc-excel-atomic-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const bytes=Buffer.from('原文件'),sha=createHash('sha256').update(bytes).digest('hex');
  const reject=async()=>{throw Object.assign(new Error('version_conflict'),{status:409});};
  await assert.rejects(withWorkbookOriginal(root,'scope',sha,bytes,reject,async()=>false),/conflict/);
  assert.deepEqual(await readdir(join(root,'strategy-workbooks','scope')),[]);
  await assert.rejects(withWorkbookOriginal(root,'scope',sha,bytes,async()=>{throw new Error('write_unknown');},async()=>false),/unknown/);
  assert.deepEqual(await readWorkbookOriginal(root,'scope',sha),bytes);
  await assert.rejects(withWorkbookOriginal(root,'scope',sha,bytes,reject,async()=>false),/conflict/);
  assert.deepEqual(await readWorkbookOriginal(root,'scope',sha),bytes);
});
