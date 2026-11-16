# M5 原方法疑似问题反馈

承接已确认 M5、A19/A20 与 IR关闭时已有问题沿原反馈处理的边界。沿工程规范 IN01–IN07、Interface v3、Pi 1.4.0；不新增 profile、Runtime、会话、队列或 SDK 使用点，不改当前有效 Skill。

- [x] 新纯工具合同 `report_method_issue` 只接受准确 methodId/version、原 governanceRevision、问题及当前 Task 已发现的固定来源。
- [x] Host 注入原 project/task/request/session/toolCall 和稳定 operationId；Agent 参数不能覆盖来源身份、状态或 replacement。
- [x] 原企业读权先于方法正文读取，在异步来源资格核对后、原 Store 写入前再核当前权限；原 getPublished 验明确发布版，qualification callback只核准确已声明来源，不调用IR reader。
- [x] 原 `markIssue` 保存 suspected，追加可选 origin/sources；无 Host options 的旧 fingerprint 和旧治理记录不变。确认、方法修订及发布仍沿原权限另行处理。
- [x] 原请求回执/CAS、取消与UNKNOWN保持；原方法正文、版本及发布不变。初始真实RED为旧Store丢失可选origin/sources，另保留来源核对后权限撤回的真实RED；当前5新增用例与原SAP Store/HTTP回归29项通过。
- [ ] 主实施线完成同一Pi工具接线、真实合成调用和非作者联合验收；工程适配器检查不等于专业结论或正式运行采用。

详细来源与方法问题保存在原方法治理权威，工具只回准确引用和状态。入口可用于分析中已发现问题，或 assets 后置节点已声明问题清单；不因 IR关闭再扫描完整会话、提炼/修订新方法，不自动confirmed、替换、发布或执行经营动作。无 UI增量：原SAP方法/治理记录维持原入口；本增量提供Host绑定的Agent写回接缝。
