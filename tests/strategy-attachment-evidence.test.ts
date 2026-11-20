import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StrategyDiscussionStore } from '../src/host/strategy-discussion-store.ts';
import { StrategyAttachments } from '../src/host/strategy-attachments.ts';
import { attachmentPage, parseAttachment } from '../src/host/strategy-attachment-document.ts';
import { discussionAttachmentReads, discussionAttachmentCitations } from '../src/host/strategy-attachment-citations.ts';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {readFile} from 'node:fs/promises';

const noProjects = { get: async () => { throw new Error('unexpected project'); }, upload: async () => { throw new Error('unexpected upload'); }, captureFeedbackFile: async () => { throw new Error('unexpected file'); } };
test('standalone same-name evidence preserves the exact revision, locator and owner', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'strategy-attachment-'));
  try {
    const discussions = new StrategyDiscussionStore(root);
    const make = () => discussions.create({ operationId: randomUUID() }, { id:'model', revision:1 });
    const a = make(), b = make(), files = new StrategyAttachments(discussions, noProjects);
    const first = await files.add(a, '复盘.txt', Buffer.from('上期\n\n只覆盖促销周'));
    const second = await files.add(a, '复盘.txt', Buffer.from('平销周'));
    assert.notEqual(first.id, second.id);
    assert.equal(first.target.fileId, second.target.fileId);
    assert.deepEqual(first, await files.add(a, '复盘.txt', Buffer.from('上期\n\n只覆盖促销周')));
    const folder=path.join(discussions.directory(a.id),'attachments');
    const priorFiles=await readdir(folder);
    const blocked=discussions.update(a.id,{expectedRevision:a.revision,sources:[first],sourceScope:{mode:'selected-only',excludedSources:[first]}});
    await assert.rejects(files.add(blocked,'复盘.txt',Buffer.from('拒绝的新版本')),/strategy_source_excluded/);
    assert.deepEqual(await readdir(folder),priorFiles);
    const notes = await files.notes(a, first);
    assert.deepEqual(notes[1], {locator:'第 3 行',text:'只覆盖促销周'});
    await assert.rejects(files.notes(b, first), /authorized/);
    assert.deepEqual(await files.notes(a, second), [{locator:'第 1 行',text:'平销周'}]);
    assert.throws(() => attachmentPage(first, notes, { locator:'第 2 行' }), /location_unavailable/);

    const receipt = attachmentPage(first, notes, { locator:'第 3 行' });
    const citation = receipt.locations[0];
    const entries = [
      { id:'start',type:'custom',customType:'optracall.run',data:{phase:'started',requestId:'r'} },
      { id:'fake',type:'message',message:{role:'assistant',content:'[[资料:'+citation.token+']]'} },
      { id:'call',type:'message',message:{role:'assistant',content:[{type:'toolCall',name:'strategy_goals',id:'t',arguments:{action:'read-source',sourceId:first.id}}]} },
      { id:'read',type:'message',message:{role:'toolResult',toolName:'strategy_goals',toolCallId:'t',content:[{type:'text',text:JSON.stringify({source:first,read:receipt,claim:'provided-not-used-or-verified'})}]} },
      { id:'reply',type:'message',message:{role:'assistant',content:'只覆盖促销周 [[资料:'+citation.token+']]'} },
      { id:'r2',type:'custom',customType:'optracall.run',data:{phase:'started',requestId:'r2'} },
      { id:'other',type:'message',message:{role:'assistant',content:'[[资料:'+citation.token+']]'} }
    ];
    assert.deepEqual(discussionAttachmentReads(entries, 'r'), [citation]);
    assert.deepEqual(discussionAttachmentCitations(entries), [{requestId:'r',entryId:'reply',citations:[citation]}]);
  } finally { await rm(root, {recursive:true,force:true}); }
});
test('OOXML evidence retains real Word paragraphs and Excel sheet/row identity',async()=>{
  const zip = new JSZip();
  zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/><w:p><w:r><w:t>促销</w:t></w:r><w:r><w:t>周复盘</w:t></w:r></w:p></w:body></w:document>');
  assert.deepEqual(await parseAttachment('复盘.docx',await zip.generateAsync({type:'nodebuffer'})),[{locator:'正文第 2 段',text:'促销周复盘'}]);
  const book=XLSX.utils.book_new();
  for(const [name,value] of [['首购','外店'],['回访','本店']])XLSX.utils.book_append_sheet(book,{A8:{t:'s',v:value},'!ref':'A8'},name);
  book.Sheets['回访'].B8={t:'n',v:0.18,z:'0%'};book.Sheets['回访']['!ref']='A8:B8';
  assert.deepEqual(await parseAttachment('复盘.xlsx',XLSX.write(book,{type:'buffer',bookType:'xlsx'})),[{locator:'首购 · 第 8 行',text:'外店'},{locator:'回访 · 第 8 行',text:'本店\t18%'}]);
});
test('Chinese PDF resolves the actual second page with offline Adobe character maps',async()=>{
  const original=await readFile(new URL('./fixtures/strategy-attachment-zh.pdf',import.meta.url));
  const notes=await parseAttachment('回访记录.pdf',original);
  assert.equal(notes.length,2);assert.equal(notes[1].locator,'第 2 页');assert.match(notes[1].text,/促销周/);
});
