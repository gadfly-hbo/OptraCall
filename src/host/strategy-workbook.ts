import {createHash} from 'node:crypto';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { inspectStrategyOfficeArchive } from './strategy-office-archive.ts';
import { StrategyGoalsError } from './strategy-goals-store.ts';
import type { StrategyWorkbook, WorkbookSheet } from './strategy-workbook-types.ts';
export { mapStrategyWorkbook } from './strategy-workbook-types.ts';

export const workbookLimit=8*1024*1024;
export async function decodeStrategyWorkbook(fileName:string,bytes:Buffer):Promise<StrategyWorkbook>{
  if(typeof fileName!=='string'||!fileName.toLowerCase().endsWith('.xlsx')||fileName.length>250||path.basename(fileName)!==fileName||/[\\\x00-\x1f]/.test(fileName))throw new StrategyGoalsError('invalid_workbook_name');
  if(!bytes.length||bytes.length>workbookLimit)throw new StrategyGoalsError('strategy_workbook_size',413);
  const archive=await inspectStrategyOfficeArchive(bytes);
  if(!archive.includes('xl/workbook.xml'))throw new StrategyGoalsError('invalid_strategy_workbook',422);
  let book:XLSX.WorkBook;
  try{book=XLSX.read(bytes,{type:'buffer',cellFormula:true,cellText:true,sheetStubs:true,sheetRows:2001});}
  catch{throw new StrategyGoalsError('invalid_strategy_workbook',422);}
  const sheets:WorkbookSheet[]=[];
  let total=0;
  for(const [index,name] of book.SheetNames.entries()){
    if(book.Workbook?.Sheets?.[index]?.Hidden)continue;
    const sheet=book.Sheets[name]!;
    const range=XLSX.utils.decode_range(sheet['!fullref']??sheet['!ref']??'A1');
    if(sheets.length>=50||range.e.r>=2000||range.e.c>=100)throw new StrategyGoalsError('strategy_workbook_range_limit',413);
    const rows:WorkbookSheet['rows']=[];
    const columns=Array.from({length:range.e.c+1},(_,c)=>XLSX.utils.encode_col(c));
    for(const merge of sheet['!merges']??[]){
      if(merge.e.r>=2000||merge.e.c>=100)throw new StrategyGoalsError('strategy_workbook_range_limit',413);
      const origin=sheet[XLSX.utils.encode_cell(merge.s)];
      if(!origin)continue;
      for(let r=merge.s.r;r<=merge.e.r;r++)for(let c=merge.s.c;c<=merge.e.c;c++){
        const addr=XLSX.utils.encode_cell({r,c});
        if(!sheet[addr]||sheet[addr]?.t==='z')sheet[addr]=origin;
      }
    }
    for(let r=range.s.r;r<=range.e.r;r++){
      const values:Record<string,string>={},issues:Record<string,string>={};
      for(let c=range.s.c;c<=range.e.c;c++){
        const cell=sheet[XLSX.utils.encode_cell({r,c})],column=columns[c]!;
        if(!cell)continue;
        if(cell.f&&(cell.v===undefined||cell.v===null||cell.t==='z'))issues[column]='公式缺少已保存结果，请在原 Excel 中计算并保存。';
        else if(cell.t==='e')issues[column]='包含 Excel 错误 '+(cell.w??cell.v);
        const display=cell.t==='z'?'':String(cell.w??XLSX.utils.format_cell(cell));
        if(display)values[column]=display;
        total+=display.length+column.length;
        if(total>2_000_000)throw new StrategyGoalsError('strategy_workbook_range_limit',413);
      }
      if(Object.keys(values).length||Object.keys(issues).length)rows.push({row:r+1,values,issues});
    }
    sheets.push({name,rows,columns});
  }
  return {fileName,sha256:createHash('sha256').update(bytes).digest('hex'),sheets,drawings:archive.some(name=>/^xl\/(drawings|diagrams|media)\//i.test(name))};
}
