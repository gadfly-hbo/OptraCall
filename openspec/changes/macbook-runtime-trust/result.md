# 运行时证书与私有CLI：结果

2026-11-01，本地工程及两轴非作者复核通过，Git／CI／合并／MacBook最终采用待执行。PR #19已完成工程交付，后续真实MacBook安装确认私有Node的CA默认路径与匿名GitHub限流／既有认证失效三项事实。首次更新安全失败，产品仍为旧干净main，数据及旧运行时保留；未绕TLS／CI、导出凭据或调用模型。

本增量只修三层可信启动环境：Finder入口、更新子命令以及共享Host／SDK驱动环境的固定CA选择，并发现应用私有CLI；保留原更新准入及失败记录。固定Node内置CA集合与保留官方Node相同，继续TLS校验，不导入Mini系统CA；任意继承的preload、额外CA及禁TLS选项不透传。用户已在MacBook本人完成GitHub设备登录，私有CLI实际auth status退出0，并成功读取官方CI；没有复制Mini凭据或输出access token，已用设备码不写入本公开记录。

## 验证与保留记录

- 原Finder和真实npm/build子进程各一条因果RED保留；修复后连同旧回归的定向检查通过。
- Host／SDK真实子进程CA摘要测试的第一次失败是测试对冻结数组原地排序，不是产品RED，原日志保留。改为复制排序后，真正因果RED为共享环境缺固定选项；修复后实际default与bundled集合摘要相同，preload／禁TLS／外部证书文件不透传。
- 首轮独立复核发现最外层仍继承NODE_EXTRA_CA_CERTS，同一合成证书实测使默认根145→146；首次Node之前清理全部相关覆盖后，真实Finder头部default145=bundled145、extra0及摘要一致。原RED和新闭环证据均保留。
- 最终完整`npm run check`退出0：**757项，756 PASS／0 FAIL／1平台不适用SKIP**，边界、类型、构建通过，原包体警告保留。最终日志`.local/current-version-delivery/runtime-trust/full-check-reviewed.log`；较早完整日志属于修正前阶段，未替换最终结论。依赖／锁文件未改变，沿用本批次审计0 high／critical、2 moderate记录。
- 固定10文件候选`.local/current-version-delivery/runtime-trust/candidate-1.json`，SHA256 `2de77703feb6c55846dff9314122bd867e4c40c1da4e3648f809625366eb0a2d`，base为已合PR19的`e07b4ca205ec63baf4c519ffc4b1cee61ddbdaab`。

## Standards

非作者 **PASS_WITH_SCOPE，0未关闭规范／安全问题**。独立真实3项回归通过，同证书集合145→146→145因果闭环及10项候选字节零差异。报告`.local/current-version-delivery/runtime-trust/review/standards-final.md`，未操作登录、凭据或模型。

## Spec

另一非作者 **PASS_WITH_SCOPE，RT01／RT02／RT02b无未关闭阻断**。已核共享环境实际用于Host与SDK启动，TLS／原认证失败不降级、CI同SHA及分析自主性保持。报告`.local/current-version-delivery/runtime-trust/review/spec-candidate1-final.md`，10项逐字节零差异。

复核后仅更新本结果文档的实际状态／报告路径，再固定派生清单；源码及回归不改变。Git／CI／合并及最终安装另以PR说明和`.local/current-version-delivery/delivery-receipt.json`记录，不提前宣称成功。未新增真实模型全链路，不提升专业可靠性或产品验收结论。
