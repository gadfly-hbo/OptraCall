# 需求梳理可靠性收尾结果

2026-10-30。基线`main b74d6bd`，分支`codex/requirements-reliability`。用户已授权本地修复、联合回归、独立复核、Git/CI与合并main；服务切换、MacBook更新、真实模型和真实业务动作不在本次执行内。

## 实现与兼容

- 送入使用独立的项目/任务选择；零任务项目可选，只在所选项目新建，未选项目禁用新建。每个发布行单独传递明确版本，送入对话框与聊天横幅一致；发布预览绑定实际返回版本，建议下一版本按数值比较。
- 澄清新增真实回答编辑、保存、修改和取消，非空保存才标answered，取消不写入，保持已有answer/status和软门禁。原生送入dialog具备标签、初始焦点、Esc及焦点归还；帮助往返保留未保存回答。帮助单源与生成手册同步。
- 需求会话按完整配置身份复用；同端点/凭据的模型切换也生效。按捕获配置自身id/revision复核，另一个实例的全局模型选择不会停止已接受运行。切模型开启新native会话并保留旧路径和字节，未新增自动拼接跨模型历史。
- 在Host变更队列前登记pending归属；stop/close/provider/global清理涵盖排队和opening资源，不等待排在清除后方的任务而死锁。按具体entry/opening对象过滤供应商，旧清理不能删除或关闭替代的新一代；项目归档仅作用于项目自身。
- 联合回归检出了额外RAP去重缺口。新携RAP请求沿既有prompt IPC，在native `optracall.run` started marker记录可选64位hex `requestFingerprint`，摘要覆盖文本、规范化Case选择及RAP实例/版本，不含凭据。初查与串行重查均校验native身份，lastRun状态缓存不绕过它；同身份ACK，改版/移除RAP/改文本冲突且不重放。无新数据库、schema2或SAP/RAP业务字段迁移。

**旧回执边界：**旧marker不回写、不迁移。本次携RAP却缺摘要时返回409；本次未携RAP维持旧去重ACK，不新派发。后者无法从旧marker判断原历史是否携RAP，保留UNKNOWN，不解析正文猜身份。此兼容边界不等于已证明所有历史请求身份。

## 验证

原始证据保留在被忽略的`.local/requirements-reliability/`；公开仓库只含源码、永久测试、合成fixture和规格/结果，不含真实密钥、业务资料、原始会话或本机私有路径。

| 验收 | 结果与证据 |
| --- | --- |
| RR01/RR02 | Cua旧UI真实RED：空项目回空、选Beta新建却落Alpha、点1.10附带1.9；修复后永久公开UI回归函数经Cua执行，未选禁建，Beta/Gamma各正确新增，Alpha原项目完整不变，两个版本精确匹配。`ui/red-ui.json`、`red-permanent-assertion.json`、`browser-green.json`。 |
| RR03 | Cua复现旧按钮立刻写answered和占位；新编辑空白禁存、保存A/重开/取消/保存B/重开均通过，打开与取消API读回不变，帮助保留未保存文字；真实Host重启仍读回B。原确认快照和两份RAP字节不变。`ui/green-editor-open.json`、`green-answer-a.json`、`green-answer-cancel.json`、`green-final.json`、`host-reopen.json`。 |
| RR04 | 真实Host/SDK/合成Provider先RED观察A→A，后GREEN为A→B，旧native字节保留。另一实例切全局选择不误停当前运行。`runtime/red-model-switch-valid.log`、`green-model-switch-preserved-history.log`及永久测试。 |
| RR05 | 真实ProjectAgent配受控外部IPC子进程，先RED检出provider关闭遗漏opening；修复后provider过滤、stop、排队取消、旧close/新代际均过。独立复核另检出A旧entry关闭误取消B opening，修复后同一反例GREEN；延迟Host变更队列的独立反例也过。`runtime/`红绿日志、`review/provider-generation-counterexample.log`、`provider-generation-green.log`、`queued-mutation-check.log`。 |
| RR06 | 真实Host/SDK先RED：归档空闲项目中断独立需求流。修复后归档/恢复不误停，目标provider清除与Host关闭仍取消其需求会话；不误伤另一个供应商。`runtime/red-project-archive-isolation.log`、`green-final.log`。 |
| RR07 | `joint-context.test.ts`经真实Host/SDK观察一个请求同时含RAP1.9、SAP1.0与指定Case/项目修订；新RAP1.10、SAP1.1和已变更草稿不混入。错误/stale背景在Provider前拒绝；重启后消息、原native前缀、输入和启用版本保留；独立任务不泄漏未选择的Case/RAP。真实版本冲突RED202→409后GREEN，`joint-baseline-2.log`、`joint-green-1.log`；新无Case身份永久测试也涵盖重启与对象键顺序。 |
| legacy保留 | 用未修旧Host实际保存plain与RAP两份终态回执，再由新代码同存储重开：plain ACK、携RAP旧回执409；未携RAP旧ACK保持且身份UNKNOWN。原lastRun及JSONL全字节不变，原先副本前缀仍在，无新运行。`legacy/before.json`、`after.json`和日志。 |
| 完整检查 | `check-full.log`：`npm run check`退出0，297/297、0失败/跳过/取消，TypeScript/Vite构建成功。另有作者定向15/15及独立目标11/11，均不冒充托管CI。 |
| 帮助/可访问性 | 同源MD测试通过；Cua帮助往返保留回答，native dialog初始焦点/Esc/归还通过；390×844深色dialog在视口内，主题/视口恢复。界面操作期间合成Provider请求0；永久浏览器函数采用Cua执行，未宣称在CI另启动浏览器。 |
| 真实数据保全 | 本次baseline→after八组一致：原运行实例/版本、公开配置、Store、5项目/10任务、2个Case、10份native会话、85份项目文件；全idle。`preservation/after.json`。旧试跑到baseline已有3处更新时间差异的UNKNOWN保留，不归因于本修复。 |
| 非作者复核 | 固定候选PASS，无未决真实发现；Standards 0规范/0有后果smell，Spec 0缺失/0范围扩张/0实现错误。18份工作树及暂存字节匹配完整清单，独立目标11/11、两条额外受控反例修复后GREEN，直接对比保全八组值全等。总报告`review/final-report.md`、`final.json`；本结论不预先证明托管CI/合并/服务采用或用户验收。 |

## 保留的失败与限制

- 生命周期模型测试最初facts-only提案被既有正常校验拒绝，属于fixture错误；换成有效提案后才得到A→A的真实RED。曾额外假定自动跨模型接续原生对话，该假定不属于原契约，按明确的旧文件保留范围修正，并保留失败日志。
- 联合测试首次误把上传201期望成200，是fixture错误；纠正后检出RAP改版同ID被202去重的真实产品RED。只读fixture赋值被类型检查发现后改成不可变构建，没有削弱验收。
- 浏览器脚本、类型、SSR/源码、受控IPC与实际Host/SDK/Provider证明的范围各自记录；受控外部进程验证生命周期，不证明模型分析质量。原始失败、前次试跑PARTIAL及未知不因本次成功被覆盖。
- 本次只用隔离合成Provider与数据，未调用真实供应商、未安装分析skill，也不声称解决统计方法、真实业务效果或整个插件的全部安全问题。

## 交付身份

实施记录保留在本稳定目录。Git/CI与合并已获授权；本文件记录固定候选的实施与本地验证，实际交付head、PR CI、squash提交和main CI分别以本次GitHub PR/Actions及本地`receipt-final.json`回读为准，不预写未来通过。运行服务、其他设备和用户产品验收单列。
