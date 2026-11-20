import type { GoalArrangementView, GoalSourceRef, GoalVersion } from './strategy-goals-types.ts';

type DocumentRow = readonly string[];
type DocumentTable = { title: string; columns: readonly string[]; rows: readonly DocumentRow[] };
export type VersionDocument = {
  kind: '战略选择表' | 'GSA 表';
  title: string;
  version: number;
  status: string;
  scope: string;
  createdAt: string;
  identity?: string;
  tables: readonly DocumentTable[];
};

const dateText = (date: string) => new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(date)) + '（中国标准时间）';
const metadata = (doc: VersionDocument): readonly string[] => [
  'v' + doc.version, doc.status, doc.scope, '版本记录时间 ' + dateText(doc.createdAt),
  ...(doc.identity ? ['记录 ' + doc.identity] : []),
];
const escape = (value: string) => value.replace(/[&<>"']/g, mark => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[mark]!));
export function versionFileName(doc: VersionDocument) {
  const subject = doc.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().slice(0, 70) || '文稿';
  return doc.kind + ' - ' + subject + ' - v' + doc.version + '.html';
}
export function renderVersionDocument(doc: VersionDocument) {
  const heading = doc.kind + ' · ' + doc.title;
  const tables = doc.tables.map(table => '<section><h2>' + escape(table.title) + '</h2><table><thead><tr>' +
    table.columns.map(column => '<th scope="col">' + escape(column) + '</th>').join('') + '</tr></thead><tbody>' +
    table.rows.map(row => '<tr>' + row.map((cell, index) => index === 0
      ? '<th scope="row">' + escape(cell) + '</th>' : '<td>' + escape(cell) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></section>').join('');
  return '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">' +
    '<title>' + escape(heading + ' v' + doc.version) + '</title>' +
    '<style>body{margin:0;color:#24212d;background:#fff;font:14px/1.65 system-ui,sans-serif}main{max-width:55rem;padding:2.25rem 1rem;margin:auto}h1{font-size:1.65rem;margin:0}h2{font-size:1.1rem;margin:1.7rem 0 .4rem}p{margin:.45rem 0;color:#55505f}table{width:100%;border-collapse:collapse;table-layout:fixed}thead th{background:#f5f3fa}th,td{border:1px solid #dedbe6;padding:.65rem;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}thead th:first-child{width:24%}tbody th{font-weight:600}@page{margin:15mm}@media print{main{padding:0}thead{display:table-header-group}h2{break-after:avoid}}</style></head>' +
    '<body><main><h1>' + escape(heading) + '</h1><p>' + escape(metadata(doc).join('　·　')) +
    '</p><p>OptraCall · 导出于 ' + escape(dateText(new Date().toISOString())) +
    ' · 可离线阅读或打印</p>' + tables + '</main></body></html>';
}

const sourceNames: Record<GoalSourceRef['authority'], string> = {
  'strategy-discussion': '战略原讨论', 'sap-metric': 'SAP 指标', task: '原任务', project: '项目', case: 'Case', 'decision-board': '决策看板',
};
function formatSource(source: GoalSourceRef) {
  return [sourceNames[source.authority], source.id, '版本／条目 ' + source.version,
    source.projectId && '项目 ' + source.projectId, source.taskId && '任务 ' + source.taskId,
    source.sessionId && '会话 ' + source.sessionId, source.sha256 && 'SHA-256 ' + source.sha256].filter(Boolean).join(' · ');
}
const entries = (values?: readonly string[]) => values?.length ? values.join('\n') : '尚未记录';

export function gsaVersionDocument(goal: GoalVersion, currentAdopted: boolean, arrangements: readonly GoalArrangementView[]): VersionDocument {
  const measurement = goal.measurement.kind === 'deliverable' ? goal.measurement.criterion :
    ['SAP 指标包 '+goal.measurement.sapMetric.id, goal.measurement.sapMetric.metricName ?? '',
      '指标版本 ' + goal.measurement.sapMetric.version, goal.measurement.target ?? '目标值尚未记录'].join(' · ');
  const exact = arrangements.filter(item => item.goal.goalId === goal.goalId && item.goal.version === goal.version);
  const actions = exact.map(item => [item.title, ...(item.caseConfirmation?.goal ? ['对应策略 · '+item.caseConfirmation.goal.strategy, '原决策事项 '+item.caseConfirmation.issueId] : []), item.scope, entries(item.checks),
    entries(item.actions.map(action => '看板行动 ' + action.taskId + ' · 原版本 ' + action.taskVersion)),
    '记录时间 ' + dateText(item.createdAt), item.id].join('\n'));
  const sources = [...(goal.source ? [goal.source] : []), ...(goal.strategyContext?.sources ?? []), ...(goal.strategyContext?.methods ?? []).flatMap(method => method.source ? [method.source] : [])];
  return {
    kind: 'GSA 表', title: goal.title, version: goal.version, scope: goal.scope.name, createdAt: goal.createdAt, identity: goal.goalId,
    status: goal.status === 'candidate' ? '候选稿 · 待采用' : currentAdopted ? '当前采用版' : '历史采用版',
    tables: [
      ...(goal.structured?[{title:'目标项与指标',columns:['目标编号','目标项','指标','基线','基线性质','目标值','单位','周期 / 口径'],rows:goal.structured.metrics.map(m=>[goal.structured!.nodeId,goal.title,m.metric,m.baseline??'待建',m.baselineKind??'待核',m.target??'待定',m.unit??'—',m.period??'待核'])}]:[]),
      {title: '目标、策略与行动', columns: ['条目', '本版正文'], rows: [
        ['G · 目标', goal.outcome], ['成果标准或指标', measurement],
        ['基线', (goal.baseline.state === 'pending' ? '待核 · ' : '') + goal.baseline.description],
        ['责任人', goal.responsible || '尚未记录'], ['期限', goal.dueAt || '尚未记录'],
        ['S · 策略', entries(goal.strategies)], ['资源', entries(goal.resources)], ['必要条件与待核', entries(goal.necessaryConditions)],
        ['A · 行动与检查安排', exact.length ? actions.join('\n\n') : '本版尚无已记录的行动安排。'],
      ]},
      {title: '版本依据', columns: ['条目', '本版正文'], rows: [
        ['采用时间', goal.adoptedAt ? dateText(goal.adoptedAt) : '尚未采用'], ['采用说明', goal.adoptionDecision ?? '尚未记录'],
        ['战略背景', goal.strategyContext?.summary ?? '尚未记录'],
        ...(goal.strategyChoice ? [['战略选择表',goal.strategyChoice.discussionId+' · v'+goal.strategyChoice.version+' · '+goal.strategyChoice.contentSha256]] : []),
        ...(goal.roleSuggestion ? [['目标管理建议原件', [
          '讨论 '+goal.roleSuggestion.discussionId, '会话 '+goal.roleSuggestion.sessionId,
          '条目 '+goal.roleSuggestion.entryId, 'SHA-256 '+goal.roleSuggestion.sha256,
        ].join(' · ')]] : []),
        ...(goal.structured?.map?[['战略地图',goal.structured.planTitle+' · '+goal.structured.map.mapId+' · v'+goal.structured.map.version+' · '+goal.structured.map.sha256]]:[]),
        ...(goal.structured?.workbook?[['Excel 原件',goal.structured.workbook.fileName+' · '+goal.structured.workbook.sha256+' · '+goal.structured.workbook.rows.map(row=>row.sheet+'!'+row.row).join('、')]]:[]),
        ['参考方法', entries(goal.strategyContext?.methods?.map(method => method.name))],
        ['准确来源', entries(sources.map(formatSource))],
      ]},
    ],
  };
}
