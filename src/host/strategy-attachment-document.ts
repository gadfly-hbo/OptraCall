import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StrategyDiscussionFault, discussionHash } from './strategy-discussion-store.ts';
import type { StrategyDiscussionSource } from './strategy-discussion-types.ts';
import { attachmentExtensions, strategyAttachmentLimit, type StrategyAttachmentCitation, type StrategyAttachmentNote } from './strategy-attachment-types.ts';
import { inspectStrategyOfficeArchive } from './strategy-office-archive.ts';

const fail=(code:string,status=422):never=>{throw new StrategyDiscussionFault(code,status);};
export function validateAttachmentName(name:string){
  if(typeof name!=='string'||!name.trim()||name.length>200||/[\\/\u0000-\u001f\u007f]/.test(name)||!attachmentExtensions.some(suffix=>name.toLowerCase().endsWith(suffix)))fail('strategy_attachment_format_unsupported',400);
}
export async function parseAttachment(name:string,bytes:Buffer):Promise<StrategyAttachmentNote[]>{
  validateAttachmentName(name);
  if(bytes.byteLength>strategyAttachmentLimit)fail('strategy_attachment_too_large',413);
  const notes:StrategyAttachmentNote[]=[];
  let characters=0;
  const add=(locator:string,text:string)=>{
    if(!text.trim())return;
    characters+=text.length;
    if(notes.length>=80000||characters>3_000_000)fail('strategy_attachment_text_limit',413);
    notes.push({locator,text});
  };
  const extension=path.extname(name).toLowerCase();
  try{
    if(extension==='.pdf'){
      const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
      const pdfRoot=path.dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
      const loading=getDocument({data:new Uint8Array(bytes),cMapUrl:path.join(pdfRoot,'cmaps')+path.sep,cMapPacked:true,standardFontDataUrl:path.join(pdfRoot,'standard_fonts')+path.sep,useSystemFonts:false,isEvalSupported:false,disableFontFace:true,useWorkerFetch:false});
      try{
        const pdf=await loading.promise;
        if(pdf.numPages>1000)fail('strategy_attachment_text_limit',413);
        for(let index=1;index<=pdf.numPages;index++){
          const page=await pdf.getPage(index),content=await page.getTextContent();
          add(`第 ${index} 页`,content.items.flatMap(item=>'str' in item?[item.str+(item.hasEOL?'\n':' ')]:[]).join('').trim());
          page.cleanup();
        }
      }finally{await loading.destroy();}
    }else if(extension==='.xlsx'){
      await inspectStrategyOfficeArchive(bytes);
      const XLSX=await import('xlsx');
      const book=XLSX.read(bytes,{type:'buffer',cellFormula:true,cellText:true});
      for(const name of book.SheetNames){
        const sheet=book.Sheets[name],rows=new Map<number,string[]>();
        for(const address of Object.keys(sheet)){
          if(address.startsWith('!'))continue;
          const cell=sheet[address],{r,c}=XLSX.utils.decode_cell(address);
          if(c>=16384||r>=1048576)fail('strategy_attachment_text_limit',413);
          const text=cell.f&&cell.v===undefined?'（公式无已保存的结果）':cell.w??XLSX.utils.format_cell(cell);
          if(!text)continue;
          if(!rows.has(r))rows.set(r,[]);
          rows.get(r)![c]=text;
        }
        for(const [index,cells] of [...rows].sort(([a],[b])=>a-b))add(`${name} · 第 ${index+1} 行`,cells.join('\t'));
      }
    }else if(extension==='.docx'){
      await inspectStrategyOfficeArchive(bytes);
      const {default:JSZip}=await import('jszip'),{SaxesParser}=await import('saxes');
      const file=(await JSZip.loadAsync(bytes)).file('word/document.xml');
      if(!file) return fail('strategy_attachment_invalid_document');
      const parser=new SaxesParser({xmlns:true}),ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      let paragraphs=0,inside=false,text=false,paragraph='';
      parser.on('doctype',()=>fail('strategy_attachment_invalid_document'));
      parser.on('opentag',tag=>{
        if(tag.uri!==ns)return;
        if(tag.local==='p'){inside=true;paragraph='';paragraphs++;}
        if(inside&&tag.local==='t')text=true;
        if(inside&&tag.local==='tab')paragraph+='\t';
        if(inside&&tag.local==='br')paragraph+='\n';
      });
      parser.on('text',s=>{if(inside&&text)paragraph+=s;});
      parser.on('closetag',tag=>{
        if(tag.uri!==ns)return;
        if(tag.local==='t')text=false;
        if(tag.local==='p'){add(`正文第 ${paragraphs} 段`,paragraph);inside=false;}
      });
      parser.write(await file.async('string')).close();
    }else{
      const decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      decoded.split(/\r\n|\r|\n/).forEach((text,index)=>add(`第 ${index+1} 行`,text));
    }
  }catch(error){
    if(error instanceof StrategyDiscussionFault)throw error;
    return fail(extension==='.pdf'?'strategy_attachment_pdf_unreadable':'strategy_attachment_invalid_document');
  }
  if(!notes.length)fail('strategy_attachment_no_text');
  return notes;
}
export const attachmentCitation=(source:StrategyDiscussionSource,locator:string):StrategyAttachmentCitation=>({
  source,locator,token:discussionHash([source.id,locator]).slice(0,24),
});
export function attachmentPage(source:StrategyDiscussionSource,notes:StrategyAttachmentNote[],page:{offset?:number;limit?:number;locator?:string}={}){
  const selected=page.locator===undefined?notes:notes.filter(note=>note.locator===page.locator);
  if(!selected.length)fail('strategy_attachment_location_unavailable',404);
  const offset=page.offset??0,limit=page.limit??4096;
  let total=0;
  const fragments=selected.map(note=>{
    const line=note.locator+'　'+note.text+'\n',start=total;
    total+=line.length;
    return {note,line,start,end:total};
  });
  if(!Number.isSafeInteger(offset)||offset<0||offset>total||!Number.isSafeInteger(limit)||limit<1||limit>8192)fail('strategy_source_page_invalid',400);
  // Each receipt carries a bounded set of fixed locators. The next page starts at range.end.
  const matching=fragments.filter(row=>row.end>offset&&row.start<offset+limit).slice(0,16);
  const end=Math.min(total,offset+limit,matching.at(-1)?.end??offset);
  const text=matching.map(row=>row.line.slice(Math.max(0,offset-row.start),end-row.start)).join('');
  const locations=matching.filter(row=>end>row.start+row.note.locator.length+1).map(row=>attachmentCitation(source,row.note.locator));
  return {source,text,range:{start:offset,end,total},complete:offset===0&&end===total,locations};
}
