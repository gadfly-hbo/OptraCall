# 实施与验证记录

状态：本地候选完成，待独立复核、Git/CI与实际更新采用；真实模型全链路尚未开始。

基线main：`3b9eb6ae5984cbe0115a0a42b7112d6a287d81d4`，分支`codex/trial-authenticated-update`。当前用户授权覆盖更新修复、Git/CI合并main及后续真实模型合成全链路验证。

已知故障的实际证据来自上一轮运行采用：官方更新器匿名GitHub API返回403、remaining=0；同机已认证`gh`读取同SHA的Check/main/push成功。原失败日志保留在primary checkout的`.local/runtime-main-adoption-20261030/`。本次回归与结果继续补充，不能将上次手工采用计作正常自动更新成功。

## 本地候选

官方CI查询优先使用`gh api --hostname github.com --method GET`固定路径，CLI自行解析已有凭据；不导出token。仅缺少CLI或专用未登录exit4时使用原公共查询。认证失效、网络/超时/过大/无效响应、CI不成功均停止，不回退绕过；自定义测试地址不获得本机认证。命令环境保留受限allowlist，不继承GH_TOKEN、GH_HOST或GH_DEBUG等覆盖；原固定SHA、官方工作流身份、停机、工作区及快进检查未放宽。

- 目标回归先RED：旧实现抛`trial_ci_unavailable`，日志`red-authenticated-update.log`。
- 定向updater+launcher检查60/60；补强后的新增认证/失败边界16/16通过。
- 完整`npm run check`：370/370、失败/取消/跳过均0；类型、导入边界及构建通过。构建因尚有候选修改标为local-changes，不能用作运行采用构建。
- `npm audit --audit-level=high`通过，`git diff --check`通过。
- 假CLI首次ESM fixture及隔离PATH缺少sh导致的中间检查失败均保留；已修正fixture，未将环境失败称作产品RED。
- 已于收尾重新fetch main，仍为基线3b9eb6a。后续合并前再次核对。
- 当前原5项目/10任务/108文件及Case逻辑已捕获只读保全基线，未改写旧业务数据。

本地证据位于`.local/trial-authenticated-update/`；本地检查不代替实际提交CI、独立复核或修复后正常更新入口采用。
