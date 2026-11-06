# v0.2 Git／CI交付记录

2026-11-06。用户在本地工程完成后明确授权本轮提交、推送、创建PR，检查通过后squash合并main，并要求合并前更新main。官方SDK保持1.4.0；项目／会话／文件、失败证据及未解决风险保留；运行服务与MacBook不采用本次更新。

## 固定代码与最新main

- 原本地工程基线`4298db98e879cff0a73f7a131d633e2cc48d7667`及954份交付前文件完整保全，未重置或清理原WIP。
- 已确认的SDK治理与v0.2修复26文件形成`78e51dd8af6aec121be1aac63f3316ff8f4b0d7c`。
- fetch后先将本地main安全快进至`b2a136baa5a230a0d6d2190023fe2c17bcf52b5b`，再整合到`codex/pi-sdk-adaptation-v02`，候选为`104b247381d6603ed90b70ee0b33a42bbeea3eba`。
- main新增`a5b4d63`的模型包CSV／numeric JSON兼容修复及后续记录保持。唯一AGENTS文字冲突保留main最新模型包记录，并加入原批准SDK规则段；未把旧采用状态覆盖回main。
- SDK接缝、HTTP适配、依赖和锁文件没有因整合main改变。正式数据根与运行发布目录不参与候选测试。

## 整合后的验证

独立隔离候选使用955份跟踪输入及独立APFS依赖副本，无依赖安装／升级。`npm run check`在上述整合候选exit0：**1624项／1594通过／0失败／30条件跳过，类型检查与Vite build通过**，执行前后输入一致。原本地1622项与本轮新增main两例分别记录，不混算为同一候选。

全新非作者交付复核剩余必须修复项0：PR相对最新main的26文件范围与公开扫描通过；实际SDK模型包工具同时启用R1资料保护，以合成numeric JSON和CSV执行，结果分别8／14，工具schema／版本出处／源及已有报告字节保持。原先独立探针对输出列的错误预期FAIL保留并解释，不作为产品RED。两安装各7包2530文件与官方归档／SRI回读匹配。此前两轴非作者及全部真实RED／GREEN、原FAIL／UNKNOWN／NOT_PROVED不覆盖。

本文件后续收尾仅涉及Git授权／证据索引文档；运行源码与上述整合候选一致。PR工作流使用实际head的checkout；合并前重新fetch／核对base和head，若base前进则先整合并补受影响验证。成功CI不推导服务采用。

## PR／main事实来源

交付分支为`codex/pi-sdk-adaptation-v02`，对应本次单一PR。当前提交只记录已完成的代码、最新main整合和本地验证，不预填尚未发生的CI或merge结果。PR描述保存实际PR/head、工作流链接、checkout SHA、计数及squash SHA；合并后main push CI单独核定。可通过此提交关联的PR回读，不能把本地PASS当远端CI。

本机完整交付前保全、整合检查、独立报告、远端API／工作流回执与最终合并记录保存在`.local/pi-sdk-adaptation-repair/delivery/`，不上传安装副本、合成私钥、原生测试文件或业务资料。既有实施证据在`implementation/`，准确原本地结果见[结果](result.md)和[实施记录](implementation.md)。

## 保留风险与采用边界

- SDK固定官方1.4.0、undici8.12.2；审计2项moderate、0 high／critical，未擅自采用建议版本。
- MCP配置加载继续为固定1.4.0的只读内部接口例外，不宣称SDK损坏容错或已消除所有内部依赖。
- 正式旧格式native自动迁移风险仍开放，不增加正式拒开／迁移策略；未来采用另核获准目标兼容及原件。
- 30项原条件跳过及构建大chunk警告保留。真实Provider／业务质量、长期稳定性和完整代理／公网链路不由本轮合成测试证明。
- 本轮只交付Git／CI，不切换服务、不更新MacBook，不读取或改写正式项目、会话、配置、凭据及文件；Git合并与运行采用、用户产品验收分别核定。
