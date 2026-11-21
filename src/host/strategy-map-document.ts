import type {VersionDocument} from './management-documents.ts';
import {mapTemplates,mapEdgeKinds,mapNodeMetrics,reviewFields,type StrategyMapVersion} from './strategy-map-types.ts';

export function strategyMapDocument(v:StrategyMapVersion,scope:string):VersionDocument {
  const columns=['编号','条目','指标','基线','目标值','单位','观察期','说明'];
  const rows=v.nodes.flatMap(n=>{
    const metrics=mapNodeMetrics(n);
    return (metrics.length?metrics:[n]).map(m=>[n.id,n.title,m.metric??'待补',[m.baselineKind,m.baseline].filter(Boolean).join(' · ')||'待核',m.target??'待定',m.unit??'',m.period??'', [n.perspective,n.detail].filter(Boolean).join('\n')]);
  });
  const tables:VersionDocument['tables'][number][]=[
    {title:'战略选择',columns:['条目','本版内容'],rows:[['地图模板',mapTemplates[v.template]],['选择',v.choice],['放弃',v.excluded],['成立条件',v.assumptions],['待核依据',v.unknowns]]},
    {title:'目标与策略',columns,rows},
    {title:'关系与审查',columns:['起点 → 终点','关系','本版意见'],rows:v.edges.map(e=>[e.from+' → '+e.to,mapEdgeKinds[e.kind],e.review?Object.entries(reviewFields).map(([k,caption])=>caption+' · '+e.review![k as keyof typeof reviewFields]).join('\n'):''])},
    {title:'修订与来源',columns:['项目','准确引用'],rows:[
      ['修改人',{user:'用户',agent:'战略 Agent',import:'Excel 导入'}[v.author]],['修订理由',v.reason],['原讨论',v.discussionId],['内容 SHA-256',v.contentSha256],
      ...(v.source?[['原生来源',[v.source.sessionId,v.source.version,v.source.sha256].join(' · ')]]:[]),
      ...(v.replySource?[['原生回复',[v.replySource.sessionId,v.replySource.version,v.replySource.sha256].join(' · ')]]:[]),
      ...v.citations.map(c=>[c.source.title,'v'+c.source.version+' · '+c.locator+' · '+c.source.sha256]),
      ...(v.importSource?[[v.importSource.fileName,v.importSource.sha256],...v.importSource.rows.map(r=>[r.nodeId,r.sheet+' · 第 '+r.row+' 行'])]:[]),
      ...(v.importSources?v.importSources.map(s=>[s.fileName,[s.format.toUpperCase(),s.origin,s.selectedPages?.length?'选页 '+s.selectedPages.join(','):'',s.sha256].filter(Boolean).join(' · ')]):[]),
    ]},
  ];
  if(v.scenarioModel){
    const m=v.scenarioModel;
    if(m.model==='repeat-visits-v1')tables.push({title:'本版模拟假设',columns:['工单范围','指标与单位','观察窗','首次修复基线','分流避免比例','具备配件时可避免比例','固定投入','依据'],rows:[[m.population,m.metric+' · '+m.unit,m.period,m.baselineRate+'%',m.remote+'%',m.parts+'%',String(m.fixed),m.basis]]});
    else tables.push({title:'本版模拟假设',columns:['人群','指标与单位','观察窗','基线','假设提升','有效覆盖','依据'],rows:[[m.population,m.metric+' · '+m.unit,m.period,m.baselineRate+'%',m.liftPoints+' 个百分点',m.coverage+'%'+(m.coverageAdjustable?'（可试调）':'（固定）'),m.basis]]});
  }
  return {kind:'战略选择表',title:v.title,version:v.version,status:'战略地图候选',scope,createdAt:v.createdAt,identity:v.mapId,tables};
}
