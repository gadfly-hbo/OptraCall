# 最终测试观察边界收尾

固定修后源为 `9900e202736977080f38309d0c76f6eff3eda9c5`，相对 `a4c563f0632280010e7e12906c69fa6664cffd13` 只改四件测试。生产 `src`／`extensions`／`scripts`、SDK、依赖和冻结规格／Demo 无差异，原后端、Runtime、真实 UI 与四原则结论保持其原字节适用范围。

## 两个真实结果分别保留

- [A4 准确 head CI](ci-a4-receipt.json)：3607 项，3410 通过、0 失败、197 条件跳过；build 和 high 级 audit 通过，原 2 项 moderate 保留。[实际运行](https://github.com/gadfly-hbo/OptraCall/actions/runs/46039907153)。
- [A4 本地完整检查](a4-local-failure.json)：3607 项，3407 通过、4 失败、196 条件跳过，未执行后续 build。不能用 CI 通过改写本地原失败，也不能把单项绿当完整检查。

原始错误栈确认：长文本测试在 SDK 正写 JSONL 时直接 JSON.parse 未完成尾行；Studio／旧 GSA 两处任务 GET 返回准确的 `409 native_snapshot_incomplete`，原测试轮询只接受 200；Case Pi 测试以不存在的 snapshot.running 和第一条 assistant 工具进度误判整轮完成。原 Host 的安全读取契约没有修改。

## 修复与复验

四件测试只修观察：精确不可读状态在原有界窗口内继续等待；raw native 的 SyntaxError 只表示此次未读到快照；业务会话必须等本次准确 requestId 完成且不 busy。原 6／15／20／40 秒、300 次窗口、所有 POST、其他错误码及最终准确回执、IR 次数、版本、报告、权限和字节保全断言保留。

受影响四个完整原文件真实 Host／官方 Pi／隔离合成 Provider 共 **14/14 PASS**，分别为 [native／Case 7 项](native-role-green.log)与 [Studio／GSA 7 项](author/two-original-files.log)。[作者确定性注入](author/implementation.md)保留旧 RED、新 GREEN、其他 GET 409 与 POST 的严格失败负例；[独立纯 VM](native-observation-vm-receipt.json) 14 项另计，不冒作实际产品运行。会话／官方固定材料检查及 build／typecheck 通过，后者如实保留构建时 A4＋本地修改身份。

[Runtime 非作者复核](native-observation-fix-review.md)及[后端非作者复核](observation-fix-backend-review.md)通过。按工程规范的闭合消费者映射，本地执行四个完整消费者文件、边界和构建；最终新 head 仍须完整 CI。不重复未受影响的本地全仓，也不声称已取得其新一轮全绿。

最终交付 head 与 squash／main push CI 在 [Issue #149](https://github.com/gadfly-hbo/OptraCall/issues/149) 的 PM 结案回执核定。这里保留入 CI 前的阶段，尚未通过的远端门禁不预先勾选。原报告中的 `.local` 是当时原始位置，本目录提供实际归档附件；先行待 footer 的观察报告保留其当时不确定性，不追溯改成已知原因。

六份带原 Node 差异缩进的失败日志以 `.log.json` 包装保存；content 保留完整原文与换行，并记录原字节长度及 SHA-256，原 `.local` 文件不变。其它日志原样保留。
