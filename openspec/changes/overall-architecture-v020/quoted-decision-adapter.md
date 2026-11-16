# A15/A16 原话代办的权威接缝

本技术增量承接已确认 spec M4、A15/A16，不改变产品范围。工程规范 IN01–IN07、Interface v3、官方 Pi 1.4.0 不变。本文件不授权真实模型、业务资料、设备或服务更新。

- [x] 原 Case `chooseStrategy` 的可选 Host 原话来源与旧记录兼容；原 Agent 草案工具不能写人的决定。
- [x] 原 Board 加法迁移，独立行动授权／撤回事件、原请求去重及上次授权 CAS；准确 item/task 内容版本与快照固定，旧 adopted 不回填为 authorized。
- [x] 原反馈保存与原 GSA 管理承接仅引用原记录，不复制经营事实；用户报告不自动成为效果验证。
- [x] 仅 Host 绑定本轮原话、真实 project/task/request/session/toolCall、已接受 Case 上下文；Agent 参数不含可替换的原话来源。
- [x] 精确 UTF-16 引述、真实 Case 方案与准确版本、已有权限和取消/CAS核对；Agent 自行理解原话指向，歧义集中澄清。Host 不用关键词或模型 clear 标志裁决经营意思。
- [x] 原 Board Task／反馈区只读授权历史与精确 HTTP 回源；原方案和用户选择各读原 Case authority，不用 reason 字符串当来源。
- [ ] 主实施线完成新工具的统一 SDK 接线、实际合成 Host/UI 联合核验与非作者复核；adapter／原 Store 检查不代替此项或真实 Agent 采用。

Host adapter 不创建会话域、Runtime、队列或新的经营记录 Store。Case 选择保存在 Case 的原 operation/event；授权保存在原 Board；反馈仍在原 feedback revisions；GSA 只保存带准确原引用的管理承接。跨 Store 成功与失败分别返回，未知先查原 request receipt，不换 ID重放。新增工具合同与 adapter 无独立 UI；沿用户已确认的原会话、Case 与看板入口，由主实施线接线。

Board 目前没有 item 的历史整数 revision，故本增量用原 item/task 的规范内容 SHA-256 表示准确观察版本，并保存授权时原快照；不能用 updatedAt 单独证明内容版本。原字段、原任务状态、反馈及历史选择不因授权记录改变，不执行外部经营动作。

局部检查：原 Store/HTTP/集成与新增行为共53项通过，Board历史HTTP/真实TSX SSR及原Board/Case HTTP子集20项通过（含重叠，未累加为独立总数）。结果未知、目录分页、旧方案换版后原选择回读保留真实RED→GREEN日志。首轮authority fixture用了无效Agent origin、首轮Board HTTP fixture误把factory当函数，这些前置失败不证明目标行为，日志保留为NOT_PROVED，不冒充产品RED。准确文件和日志身份在本地 `development/quoted-decisions` receipt中；完整工程和运行采用仍单列。
