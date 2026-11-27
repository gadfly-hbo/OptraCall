# Issue #149 6bc7 发布候选 UI 独立增量复核

- 固定完整候选：`6bc7be2849d280e5e6a6e598ee6b7a68dd5e48eb`；树 `49974804cd0b1aabcbfc596faeaa987ffbd469af`。开始、结束均核对 HEAD 正确、工作树 clean。
- 未参与任何候选实现；产品、测试、依赖只读。本次独立读取 a571→6bc7 全部产品 delta，重点核对首用安全初始化、CaseBoard 可见／定位刷新、同事项新片段读取及重复追加确认。
- **最终 UI 结论：通过，可合并。** 首次干净使用阻塞及同已挂载事项续接缺口由新候选实际产品浏览器独立验证关闭。原 7fe FAIL、be1／a571 的限定 PASS 及首次使用原 FAIL 均保留，不改写历史。

## 新候选实际运行

本人从 6bc7 源码分别生成两个隔离实际 React bundle，通过真实 Host／HTTP 与 `/usr/bin/chromium` 运行；没有使用工作树旧 dist。两个 bundle 主 JS SHA-256 均为 `4a60cf03b33237ab8990f08099a31d445bbec3f74c81f722ca0c6ca8434ff35b`，对应 metadata：[正常](fresh-firstcase-normal/ui-dist/optracall-build.json)、[恢复](fresh-firstcase-recovery/ui-dist/optracall-build.json)。

独立命令：

```sh
ACCEPTED_HEAD=6bc7be2849d280e5e6a6e598ee6b7a68dd5e48eb node .local/pm-final/ui-fresh-firstcase-probe.mjs
ACCEPTED_HEAD=6bc7be2849d280e5e6a6e598ee6b7a68dd5e48eb DROP_FIRST_CREATE_ACK=1 node .local/pm-final/ui-fresh-firstcase-probe.mjs
node .local/pm-final/ui-unavailable-store-probe.mjs
```

实际均使用 `/workspace/OptraCall/.local/toolchains/node-v25.9.0-linux-x64/bin/node`。三命令 exit 0：

- [干净首用正常浏览器收据](fresh-firstcase-normal/receipt.json)：**7 步 PASS**；[日志](ui-fresh-firstcase-normal.log)。
- [干净首用丢响应／重开恢复浏览器收据](fresh-firstcase-recovery/receipt.json)：**8 步 PASS**；[日志](ui-fresh-firstcase-recovery.log)。
- [已有不可用库保全真实 HTTP 收据](ui-unavailable-store-receipt.json)：**3 项 PASS**；[日志](ui-unavailable-store.log)。

每份浏览器运行均为新 dataRoot、原 Case storage uninitialized，**未预初始化 Case、未预建 G/S、未预建 Case／事项**。只设置不可用地址的合成模型配置；所有记录的 business-role POST 均为 **0**，没有真实 Provider 调用。

## 首次正常使用与丢回执恢复

两份浏览器均先真实进入空 Case 总览、看到“启用本机 Case 记录”，再回 Home 手填准确个人 scope、新 G/S、Case 名称／背景和原输入；准备与多次 GET 后 storage 仍 uninitialized，未要求用户先去管理页启用。

明确点击“保存候选、明确采纳 G/S 并创建 Case”后，原安全初始化生效，只有 **1 次 workspace/create-case POST、1 个 Case、1 件首事项**，采纳／创建各有原回执；完整准备原文成为准确首事项片段。清 sessionStorage 后 reload，实际 composer 恢复完整用户编辑，HTML 输入未执行。人工查看了 [首建重开截图](fresh-firstcase-normal/fresh-firstcase-reopened.png)。

恢复分支让真实服务完成首次创建，再仅丢弃该响应、向 UI 返回合成 503。实际服务端回读已采纳／已创建回执及原准备，随后清 sessionStorage、页面重开，UI 准确恢复“Case 已创建，核对并建立第一件事项”；点击后只补首事项／片段。原采纳和创建回执逐值相同，Case／事项不重复，workspace 创建请求仍仅一次。

## 同已挂载事项续接与原数据保全

两份运行又完整重复如下实际路径：

1. 已有首事项和非空真实 composer，项目页手选“全部当前 Case”，回当前工作打开原 composer，再从 Home 另记新输入。
2. 目录明确选同一个原 Case／issueId 带入。Case／事项组件保持在原挂载身份，新片段无需切事项／reload 即可见；真实 Case revision 没有改变，原 composer 没有被替换。
3. 明确追加后，原完整草稿作为前缀保留；重复点同一已追加片段，正文不重复，完成确认可见，不残留“正在将片段追加”提示。
4. 项目页手选 all 范围仍保留；原 Case 对象前后逐字段相等、Case／事项仍各一条，没有因读取或续接重置已有数据、重新初始化或默发消息。

## 不可用既有库的负例

本人另外在新隔离根放入未标记的已有 SQLite 路径字节，真实 Host 判 unavailable。GET 与明确创建均不把它变成 uninitialized／ready；创建返回 `503 case_store_unavailable`，原文件前后 SHA-256 完全相同，未生成 Case storage marker。该检查为真实 HTTP／文件保全，未用作者两项 HTTP PASS 代替独立验证。

## 增量审查及四原则

- **Host 管环境：通过。** 首建仅在用户明确 POST 且状态确为 uninitialized 时复用原 initialize route；GET 不初始化，unavailable 不重置。按可见／原定位只读刷新和按新 record 引用回读片段，均属于来源与状态交付。
- **Agent 自主执行：通过。** 没有新增分析流程、归属推断或模型触发；用户明确创建、追加与发送仍分开。
- **优先复用 Pi／原业务权威：通过本 UI 专项。** 原 storage 初始化、目标采用、Case／首事项回执和唯一 composer 继续复用；重复追加只核原幂等结果。新 choose 请求资格沿原选择准入／准确 Plan 来源重核，async 消费均 await；未改 UI 状态枚举或另建完成库。Runtime／后端专项另证其实际接入。
- **减少人的操作：通过。** 首位用户不必先维护／启用 Case 基础设施；首建丢回执直接恢复原意图，同事项续接不要求切事项或刷新，已追加结果不会让用户反复猜测是否完成。

此前 be1 的真实 21 步、三创建分支、范围／目录／来源／403／503／窄屏键盘证据保留其准确原身份；本报告没有把它们改称 6bc7 全量重跑。其未改部分由源码增量检查继续核定，以上首次使用、恢复及同事项路径则是 6bc7 新源码的本人独立实际运行。完整 npm check、其余独立专项、准确 head CI 与 Git 交付由 PM 分别核定；不代表真实模型质量、设备采用或用户产品体验验收。

## 后续独立 DW09 追加覆盖

本报告的首用／恢复与同事项片段链 PASS 保留。PM 后续指定的历史方案原请求和跨事项请求焦点路径已另行实际复现两项缺陷；**6bc7 整体 UI 最终合并结论目前暂缓**，见 [原请求回应追加实证](ui-response-followup-review.md)。此追加结论不将此前未覆盖路径追溯写成已测。
