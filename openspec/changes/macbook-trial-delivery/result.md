# macbook-trial-delivery：结果记录

2026-10-29 · MINI_LOCAL_COMPLETE（合入前工程记录）

用户已整体确认方案及执行次序，允许本次Mini实现、检查/独立复核/CI/合入main后部署MacBook。基线main `87069588d53ea477db6cf366e2e5df7cc467ebed`、原WIP空，工作分支 `codex/macbook-trial-launchers`。已确认Mini正式项目为空，记录公开配置后有序停止旧预览；开发／测试使用隔离根。证据在 `.local/macbook-trial-delivery/`，旧验收／清理历史不覆盖。

当前MacBook尚未连接或部署；产品/密钥/会话保全待实际前后核对。实现、适用TDD与独立复核结果逐项追加，不提前宣称完成。

## Mini本地候选

版本 `0.1.0-mvp.3`，SDK仍锁定1.4.0。新增Host白名单静态构建、构建内容摘要与已加载版本回读；三个Finder入口、单实例操作锁、只对核实身份进程正常停止，以及官方main成功CI准入的固定SHA快进更新。配置／项目schema和Pi工具／分析软约束未改。

作者适用TDD：静态HTTP3项、启动器9项、更新器31项（含子例）通过；分别保留因果RED、fixture失败与后续GREEN，不把fixture问题当产品RED。浏览器从实际启动入口打开同源静态页面并回读项目API、版本，正常停止；使用隔离根，不读取正式密钥或自动调用模型。完整本地check／审计和固定候选独立复核收尾中。原始证据在 `.local/macbook-trial-delivery/{static-*,launcher/,update/,browser/}`。

完整本地 `npm run check`：155/155通过，fail/cancel/skip均0；类型检查及构建通过；`npm audit --audit-level=high` 为0漏洞。候选v1独立复核结论FAIL（2项P2）：更新构建失败后可能用旧dist启动新Host并回报旧提交；clone内已支持的`.runtime`未忽略而阻止更新。原始动态复现及FAIL报告保留，不被此前作者PASS覆盖。修复采用试用入口校验真实独立、干净Git源码与已构建HEAD／tree／包版本，旧构建或脏构建拒绝；开发仍用dev入口。另补专用运行时忽略规则。修复后重新固定候选并受影响复核。


## 修复后的工程结果

固定候选v2（105公开文件，清单SHA-256 `d8f418ea9c4d20c34b386faaddf16ff5671aa8d2e8f984e7abde7f5a551d0d9c`）非作者独立复验PASS，两项P2动态关闭。完整检查159/159通过，fail/cancel/skip均0；类型、构建通过，依赖未变且审计0漏洞。独立真实Host／SDK／Finder最小PATH、完整更新后fresh launcher、专用运行时、错误CI保全、构建失败拒启及同SHA显式重试均通过；供应商请求0，自有fixture进程退出。保留v1 FAIL及修复证据，不把新结论倒填旧候选。

最终小差异仅将脏树错误措辞改为通用“停止操作”及追加本工程事实；提交前独立核对该差异。原始证据为 `.local/macbook-trial-delivery/check-full-v2.txt`、`audit-v1.txt`、`launcher/identity-repair-result.md`、`independent/report-v1.md`、`independent/report-v2.md`。

本文件记录合入前已发生的工程验证；托管CI、main合并及MacBook部署随后分别执行，不能从本记录提前推导完成。最终提交／CI／合入及MacBook实际版本、凭据缺项补齐和数据保全回读追加在本变更关联PR描述（永久交付记录）与本机 `.local/macbook-trial-delivery/delivery-receipt.md`，不为反写部署结果重复发布产品提交。MacBook只运行部署准备和基本使用回读，不执行工程回归、不提交或回推；本次不自动调用真实模型。
