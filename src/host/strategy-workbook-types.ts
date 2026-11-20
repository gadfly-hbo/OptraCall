export const workbookFields = {
  strategy: { id:['策略编号','战略编号','节点编号','编号','id'], title:['策略名称','战略项','战略名称','战略主题','节点名称','名称','title'], kind:['节点类型','kind'], detail:['策略说明','战略说明','说明','详情'], parents:['上游策略编号','上层策略编号','上游节点','上级节点'], goals:['关联目标编号','目标关联','关联目标'], relation:['关系类型','关系性质'], perspective:['BSC维度','BSC视角','视角','维度','层面'] },
  goals: { id:['目标编号','目标项编号','编号','id'], title:['目标项','分目标','目标名称','目标','名称','title'], metric:['指标','衡量指标','指标名称'], baseline:['基线','基线值','现值','现状值'], target:['目标值','指标目标值','目标数值','期望值'], unit:['单位','指标单位'], baselineKind:['基线类型','基线性质','基线来源类型'], period:['周期','观察周期','期间','统计口径'], strategies:['关联策略编号','关联策略','策略编号'], parent:['上级目标编号','父目标编号','上级目标'], owner:['负责人','责任人'], perspective:['BSC维度','BSC视角','视角','维度','层面'] }
} as const;
export type WorkbookKind = keyof typeof workbookFields;
export const workbookKinds: WorkbookKind[] = ['strategy','goals'];
export type WorkbookTarget = 'map'|'goals';
export interface WorkbookSheet { name:string; rows:{row:number; values:Record<string,string>; issues:Record<string,string>}[]; columns:string[] }
export interface StrategyWorkbook { fileName:string; sha256:string; drawings:boolean; sheets:WorkbookSheet[] }
export interface SheetMapping { name:string; headerRow:number; columns:Record<string,string> }
export type WorkbookSelection=Partial<Record<WorkbookKind,SheetMapping>>;
export interface WorkbookOrigin { fileName:string; sha256:string; sheets:SheetMapping[]; rows:{nodeId:string;sheet:string;row:number}[] }
export type ImportedMetric = {metric:string;baseline?:string;baselineKind?:string;target?:string;unit?:string;period?:string};
export interface WorkbookNode {id:string;title:string;kind:'goal'|'strategy'|'other';detail?:string;perspective?:string;metrics?:ImportedMetric[];owner?:string}
export interface WorkbookEdge {id:string;from:string;to:string;kind:'supports'|'upstream'|'decomposition'|'hypothesis'}
export interface MappedWorkbook {nodes:WorkbookNode[];edges:WorkbookEdge[];importSource:WorkbookOrigin;errors:string[]}
const norm=(s:string)=>s.trim().replace(/\s+/g,'').toLowerCase();
export function guessMapping(sheet:WorkbookSheet,kind:WorkbookKind,headerRow?:number):SheetMapping {
  let best:SheetMapping={name:sheet.name,headerRow:headerRow??1,columns:{}},score=-1;
  for(const row of sheet.rows.filter(row=>headerRow!==undefined?row.row===headerRow:row.row<=30)){
    const columns:Record<string,string>={};
    for(const [field,aliases] of Object.entries(workbookFields[kind])){
      const matches=Object.entries(row.values).filter(([,value])=>aliases.some((a:string)=>norm(a)===norm(value)));
      if(matches.length===1)columns[field]=matches[0]![0];
    }
    const n=Object.keys(columns).length+(columns.title?3:0);
    if(n>score){best={name:sheet.name,headerRow:row.row,columns};score=n;}
  }
  return best;
}
export function defaultSelection(book:StrategyWorkbook,target:WorkbookTarget):WorkbookSelection {
  const result:WorkbookSelection={};
  for(const kind of workbookKinds){
    const re=kind==='strategy'?/战略|策略|strategy|map/i:/目标|指标|goal|objective|kpi/i;
    const sheet=book.sheets.find(s=>re.test(s.name));
    if(sheet)result[kind]=guessMapping(sheet,kind);
  }
  if(!result.goals&&!result.strategy&&book.sheets[0]){
    const kind=target==='goals'?'goals':'strategy';result[kind]=guessMapping(book.sheets[0],kind);
  }
  return result;
}

export function mapStrategyWorkbook(book:StrategyWorkbook, selection:WorkbookSelection):MappedWorkbook {
  const result:MappedWorkbook={nodes:[],edges:[],errors:[],importSource:{fileName:book.fileName,sha256:book.sha256,sheets:[],rows:[]}};
  const nodes=new Map<string,WorkbookNode>(), usedSheets=new Set<string>(), edges=new Map<string,WorkbookEdge>();
  const links:{from:string;to:string;kind:WorkbookEdge['kind'];where:string;expected?:string}[]=[];
  const split=(s:string)=>s.split(/[,;、，；\n]/).map(x=>x.trim()).filter(Boolean);
  for(const kind of workbookKinds){
    const mapping=selection?.[kind]; if(!mapping)continue;
    const sheet=book.sheets.find(s=>s.name===mapping.name);
    if(!sheet||usedSheets.has(sheet.name)||!Number.isSafeInteger(mapping.headerRow)||mapping.headerRow<1||!mapping.columns||typeof mapping.columns!=='object'){result.errors.push('工作表或表头行无效，请重新选择。');continue;}
    usedSheets.add(sheet.name);
    const fields=Object.entries(mapping.columns).filter(([,column])=>column);
    if(fields.some(([field,column])=>!Object.hasOwn(workbookFields[kind],field)||!sheet.columns.includes(column))||new Set(fields.map(([,column])=>column)).size!==fields.length){result.errors.push(sheet.name+' 的字段映射包含未知或重复的列。');continue;}
    if(!mapping.columns.title || (kind==='goals'&&!mapping.columns.metric)){result.errors.push(sheet.name+' 需要映射名称'+(kind==='goals'?'和指标':'')+'列。');continue;}
    result.importSource.sheets.push({name:sheet.name,headerRow:mapping.headerRow,columns:Object.fromEntries(fields)});
    let count=0;
    for(const row of sheet.rows.filter(r=>r.row>mapping.headerRow)){
      if(!fields.some(([,c])=>row.values[c]||row.issues[c]))continue;
      count++;
      const where=sheet.name+' 第 '+row.row+' 行';
      for(const [,column] of fields)if(row.issues[column])result.errors.push(where+' '+column+row.row+' '+row.issues[column]);
      const get=(field:string)=>row.values[mapping.columns[field]??'']?.trim()??'';
      const id=get('id')||(kind==='goals'?'G':'S')+'@'+sheet.name+'!'+row.row, title=get('title');
      const declared=get('kind'),nodeKind=kind==='goals'?'goal':!declared||['策略','strategy','S'].includes(declared)?'strategy':['目标','goal','G'].includes(declared)?'goal':['其他','other'].includes(declared)?'other':undefined;
      if(!title || !nodeKind || (kind==='goals'&&!get('metric'))){result.errors.push(where+' 缺少名称、指标或有效节点类型。');continue;}
      const node:WorkbookNode={id,title,kind:nodeKind};
      for(const key of ['detail','perspective','owner'] as const)if(get(key))node[key]=get(key);
      const previous=nodes.get(id);
      if(previous && (kind!=='goals'||previous.kind!=='goal'||previous.title!==title||previous.perspective!==node.perspective||previous.owner!==node.owner||previous.metrics?.some(m=>m.metric===get('metric')))){result.errors.push(where+' 编号或指标重复：'+id);}
      const target=previous??node;
      if(kind==='goals'){
        const metric:ImportedMetric={metric:get('metric')};
        for(const key of ['baseline','baselineKind','target','unit','period'] as const)if(get(key))metric[key]=get(key);
        (target.metrics??=[]).push(metric);
        for(const from of split(get('strategies')))links.push({from,to:id,kind:'supports',where,expected:'strategy'});
        if(get('parent'))links.push({from:get('parent'),to:id,kind:'decomposition',where,expected:'goal'});
      } else {
        const relation=get('relation'),edgeKind:WorkbookEdge['kind']|undefined=!relation?undefined:
          /^(支持|贡献|支持\/贡献|supports)$/.test(relation)?'supports':/^(因果|待验证因果|假设|hypothesis)$/.test(relation)?'hypothesis':
          /^(分解|分层|层级|分解\/归属|decomposition)$/.test(relation)?'decomposition':/^(上级|上游|归属|upstream)$/.test(relation)?'upstream':undefined;
        if(relation&&!edgeKind)result.errors.push(where+' 关系类型待核对：'+relation);
        for(const to of split(get('goals')))links.push({from:id,to,kind:edgeKind??'supports',where});
        for(const from of split(get('parents')))links.push({from,to:id,kind:edgeKind??'upstream',where});
      }
      nodes.set(id,target);result.importSource.rows.push({nodeId:id,sheet:sheet.name,row:row.row});
    }
    if(!count)result.errors.push(sheet.name+' 的表头下没有结构化条目。');
  }
  if(!usedSheets.size)result.errors.push('请选择至少一张工作表。');
  for(const link of links){
    if(!nodes.has(link.from)||!nodes.has(link.to)||link.from===link.to||(link.expected&&nodes.get(link.from)?.kind!==link.expected)){
      result.errors.push(link.where+' 关系未匹配：'+link.from+' → '+link.to);continue;
    }
    const key=JSON.stringify([link.kind,link.from,link.to]);
    if(!edges.has(key))edges.set(key,{id:key,kind:link.kind,from:link.from,to:link.to});
  }
  result.nodes=[...nodes.values()];result.edges=[...edges.values()];
  return result;
}

/** A workbook row number identifies a location within one file revision only. */
export function unstableWorkbookMatches(previous:{id:string;sha?:string}[],next:MappedWorkbook){
  return previous.filter(n=>n.sha && n.sha!==next.importSource.sha256 && /^[GS]@.+!\d+$/.test(n.id) && next.nodes.some(v=>v.id===n.id)).map(n=>n.id);
}
