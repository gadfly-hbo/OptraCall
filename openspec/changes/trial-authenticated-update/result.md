# 实施与验证记录

状态：本地检查、非作者两轴独立复核及源码候选PR检查通过；待最终发布记录的提交CI、合并与实际更新采用；真实模型全链路尚未开始。

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

## 固定源码候选与独立复核

候选`e568d44f1b07efe99bd5a1b89a8b1afd0e70a1a8`，相对main基线3b9eb6a共7文件。

- Standards：0项发现，独立隔离18/18探针通过；包含固定官方GET、环境覆盖清除、token不导出/错误不泄露、自定义地址不认证、4MiB限额及实际15秒超时、匿名失败和最新失败CI阻断。
- Spec：0项实现缺陷，独立21/21探针通过；认证可用时不触发匿名、exit1/无效/过大响应失败且不降级、exit4/无CLI公共路径、403/429、固定SHA与官方身份、最新run/attempt等均核对。AU07最终Git/CI/main身份与AU08实机采用保持待验，未代称通过。
- PR [#10](https://github.com/gadfly-hbo/OptraCall/pull/10)源码候选Check [41005410120](https://github.com/gadfly-hbo/OptraCall/actions/runs/41005410120)成功。发布记录变更后的最终提交仍须以PR实际head检查为准，不能沿用旧SHA CI。

完整独立报告与探针在`.local/trial-authenticated-update/review/{standards,spec}/`。合并前再次fetch main；若基线推进则整合后重验受影响范围。实际采用与真实模型报告后续保留在本地持久证据，不将原始会话、凭据或运行日志加入公开仓库。
