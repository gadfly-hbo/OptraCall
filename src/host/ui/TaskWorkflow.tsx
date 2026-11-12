type Props = {
  projectName: string;
  taskName: string;
  status: string;
  busy: boolean;
  hasMessages: boolean;
  hasReply: boolean;
  requirementTitle?: string;
  onFiles: () => void;
  onRequirements: () => void;
  onAnalyze: () => void;
  onResults: () => void;
};

/** Navigation through the user's workspace, never an Agent execution plan. */
export function TaskWorkflow({ projectName, taskName, status, busy, hasMessages, hasReply, requirementTitle, onFiles, onRequirements, onAnalyze, onResults }: Props) {
  const current = busy ? 'analysis' : hasReply ? 'results' : hasMessages ? 'analysis' : 'materials';
  const steps = [
    { id: 'materials', title: '资料准备', note: '上传或查看项目文件', action: onFiles },
    { id: 'requirements', title: '需求梳理', note: requirementTitle ? '已附带需求' : '可选 · 整理分析目标', action: onRequirements },
    { id: 'analysis', title: '分析对话', note: busy ? '正在处理本次请求' : hasMessages ? '继续对话' : '可直接开始', action: onAnalyze },
    { id: 'results', title: '结果与审查', note: hasReply ? '已有回复 · 按需审查' : '查看报告与审查记录', action: onResults },
  ];
  return <header className="task-workflow">
    <div className="task-workflow-heading"><div><p className="eyebrow">{projectName}</p><h1>{taskName}</h1></div><span className="task-workflow-status" role="status">{status}</span></div>
    <nav aria-label="分析任务步骤"><ol>{steps.map((step, index) => <li key={step.id}>
      <button type="button" aria-current={current === step.id ? 'step' : undefined} onClick={step.action}>
        <span className="task-step-number" aria-hidden="true">{index + 1}</span><span><strong>{step.title}</strong><small>{step.note}</small></span>
      </button>
    </li>)}</ol></nav>
    <p className="task-workflow-help">按需准备资料与需求，也可以直接开始分析。</p>
  </header>;
}
