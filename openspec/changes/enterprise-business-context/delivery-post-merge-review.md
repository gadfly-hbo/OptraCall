# 合并后交付身份与 CI 只读复核

2026-10-31 · **PASS_WITH_LIMITS**。本复核独立读取 GitHub PR／Actions 元数据与原始日志，并核对本地 Git 树；没有调用模型、访问产品写端点、修改源码或切换服务。

- [PR #15](https://github.com/gadfly-hbo/OptraCall/pull/15) 状态为 MERGED，源 head 为 `89a57fd13f3d3a04f77b0e9f156d5b4249e17255`，2026-10-31 07:01:18 UTC squash 合入 `main` 的 `aa79262a2c3f11de4affd76abf13477f12c60387`；合并父提交为 `913fd383085764c60fd28c6d758aeba9f6638301`。
- 源 head 与合并提交的完整 Git tree 均为 `4f124b0b235ffa0d561f0cef83edfbb28c96a34c`，两者全树 diff 为空。先前 46 文件固定复核清单中的 **36 个源码／测试文件全部与已合并字节一致**；后续复核与交付文档另有记录，不混同为源码变化。
- [PR head CI 41178618497](https://github.com/gadfly-hbo/OptraCall/actions/runs/41178618497) 为 completed／success，headSha 精确为 `89a57fd…`。[main push CI 41178916872](https://github.com/gadfly-hbo/OptraCall/actions/runs/41178916872) 同为 completed／success，headSha 精确为 `aa79262…`。两次原始日志均记录 **535/535 PASS，0 fail／cancelled／skipped**，边界检查、TypeScript／Vite 构建及 `npm audit --audit-level=high` 步骤成功。已核对工作流 checkout 显式选择 PR head SHA 或 push SHA，因此 PR 证据对应实际交付 head。
- `/Users/bendandebaba/DevWorkSpace/OptraCall` 为干净 `main`，HEAD、`origin/main` 与远端 `refs/heads/main` 均为 `aa79262…`。4727 工作树同样无 tracked／untracked WIP，HEAD 仍为源分支 `89a57fd…`，没有替用户切换该分支。

完整只读证据见同目录 `post-merge-readback.json` 与 `post-merge-ci-41178618497.log`、`post-merge-ci-41178916872.log`，含原始日志 SHA-256。

此结论仅绑定已复核源码、Git 交付与 hosted CI，不代表运行采用、真实模型理解／专业质量或产品验收。root 正在执行的独立合成真模型全链路及其启动失败／恢复，待产物形成后另行复核；本次不提前给出质量结论。
