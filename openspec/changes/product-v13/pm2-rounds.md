# Decision 交给 Do 与旧轮次 Teach

批准依据为框架 v0.8 C7/C10/C12、规格 v0.3 与 36bd1c9 的 PM 复核。交接和保存均由人确认。沿用现有项目任务和事项入口、原 Case 取舍、看板行动授权和反馈、Interface v3 的 project-tasks owner 及两上游角色对话。

| 范围 | 核验入口 |
| --- | --- |
| 项目内 Decision 准确成果交给 Do | 项目任务抽屉、创建 POST 和 Pi 首发；分别检查零个、唯一、多个当前行动、已撤或换轮的旧凭据、无事项独立 Do |
| 有新轮 B 后完成旧轮 A 的 Teach | 在 A 行按原观察准备 Teach，按原回复保存 A，核 B 原记录与两上游实收；另核丢回复读回、无观察与已结束 Case |

## 实施与逐条结果

1. **项目内 Decision 交给 Do。** 在项目任务的「交给下一 Task」选准确成果，表单读取同一 Case、同一事项的当前取舍和当前项目原看板授权。只有一项时直接显示行动和范围，多项时由人选具体行动。零项、已撤回或过期的选择显示原因。创建及新的实际发送继续核验来源事项、取舍、项目及有效授权，原创建操作的重复读回先于新写检查。独立 Do 可直接登记线下已发生的事实。Chrome 既验证了两个授权并存时的选择，也在表单打开后撤回授权，随后创建返回 409、保留输入、模型请求增量为 0。获准的第二轮首发实际包含准确 Plan 原回复、取舍理由和所选范围。[项目入口实收及请求编号](../../../.local/product-v13/pm2/rounds/chrome-receipt.log) · [选择多项授权](../../../.local/product-v13/pm2/rounds/choose-authorized-action.png) · [原 Case 入口复验](../../../.local/product-v13/pm2/rounds/case-entry-chrome.log)
2. **旧轮 A 的迟到 Teach。** 时间线每一轮在自己的原观察下提供复盘表单。同轮存在多条观察时，准确 Teach 回复还按其原观察版本筛选；历史回复未固定观察版本时，现有服务仍核对人选的本轮准确反馈。Chrome 先形成 A 的原看板观察，随后选 B，再从 A 发起 Teach、保存回 A，并由 A 分别向目标和战略发起真实 Pi 请求。两个接收请求均含 A 的选择、反馈版本、Teach 消息编号及原文。回读时 B 整轮逐字段相同。同一操作读回原结果，改操作号再次保存被拒。B 缺观察时保存被拒；Case 结束后仍可回看，新增复盘写入被拒。[原轮画面](../../../.local/product-v13/pm2/rounds/original-round-review.png) · [两上游实收与原操作](../../../.local/product-v13/pm2/rounds/chrome-receipt.log)

## 基线、兼容与验收边界

- 从 Git 归档独立取出产品提交 `36bd1c96a42b3d8ff56a4593fead6af7aae3545f`，同一组检查在基线产生 3 个预期失败。无授权的项目交接返回 201；项目弹窗缺少未授权状态，旧轮时间线无法选择自己的 Teach 保存。修复后新增 Chrome 2/2、原 Case Chrome 1/1、受影响 Host/Pi 5/5 通过，TypeScript 检查通过。[固定基线](../../../.local/product-v13/pm2/rounds/red-identity.txt) · [原始失败](../../../.local/product-v13/pm2/rounds/fixed-36bd1c9-red.log) · [受影响回归](../../../.local/product-v13/pm2/rounds/affected-final.log) · [类型检查](../../../.local/product-v13/pm2/rounds/typecheck-final.log)
- 在旧候选的隔离根创建并实际发送过缺授权的 Do，关闭旧 Host，用新候选直接只读回原任务及原答复。对同一历史 Task 新发返回 409，模型请求无增加。继续行动时可从原事项选当前有效授权并手建新的 Do；既有原件、任务标识和原生会话沿原位置读取，本次无数据迁移。[兼容实测](../../../.local/product-v13/pm2/rounds/legacy.log)
- 本地合成 Provider 用于核对实际 Chrome、Host 和官方 Pi 的接收内容。真实业务的执行效果、自由模型判断和用户产品验收待另核。作者验证与固定候选上的整仓检查、非作者复核分别记录。

## R6 单条看板观察的授权范围

固定失败版为 `c4f5ecb2da199e5c974bede757dd25eb85146f9e`。甲轮的同一行动先获单店授权、留下观察 1，随后扩大到四十店并留下观察 2。切到乙轮后，按甲轮观察 1 准备 Teach。修前，Teach、目标管理及战略选择三个实际 Pi 请求都含四十店的后续授权，两处上游页面也把它显示为该观察的授权范围。[修前独立原件](../../../.local/product-v13/pm2/spec/c4f5ecb2da19/one-feedback.json)

1. **同一观察的三处接收。** Host 按原看板行动、反馈版本、原保存时间和授权修订顺序定位当时的授权。Teach 首发收到命中的行动、一个授权与一个反馈。新保存的复盘保留准确授权编号，两个上游复用这一份原件，页面标明「观察时授权范围」。同轮的另一行动、同一行动的后续授权和后续反馈、乙轮方案均未出现在三个请求中。乙轮整轮记录逐字段保持一致。当前行动的签发资格沿原看板与 Case 的当前取舍另行核对。[真实入口的多行动回归](../../../.local/product-v13/pm2/rounds/observation-final-chrome.log) · [原独立脚本在作者修复树上的三处 Pi 实收](../../../.local/product-v13/pm2/rounds/observation-final-review.json)
2. **旧资料的时间边界。** 原保存时间缺失、授权与观察同毫秒且无法判序时，时间线标出待核并保留查看原看板记录的入口。两上游拒收，模型请求增量为 0。对历史迁入的观察使用原修改时间；迁入日期晚于授权、原修改时间早于授权时，观察仍留在原看板。恢复准确时间后两个上游重新可读。[隔离兼容用例](../../../.local/product-v13/pm2/rounds/observation-time.log)
3. **原 Teach 与原操作回读。** 在真正的失败候选上创建过两份原生 Teach，一份只收到单店，一份实际收过后来的四十店授权。修复版经原权限重开，两份原答复、原请求及原生文件 SHA-256 均保持一致。只收到单店的原回复仍能按单店观察新保存。收过更大范围的旧回复可回看，按单店观察新保存、续发或交两上游均受限。对旧版已成功保存的同一操作，开放和关闭 Case 都可用原编号、原输入取回原记录，改变正文返回 409。旧模型答复如实保留，没有重放或改写。[新保存与旧答复](../../../.local/product-v13/pm2/rounds/legacy-observation.log) · [原操作、改输入及关闭 Case](../../../.local/product-v13/pm2/rounds/legacy-saved-observation.log)
4. **旧上游已有对话。** 即使选中的 Teach 原文只收过单店资料，两个上游若在旧版另行收到过四十店范围，修复版仍可读取原会话及原答复，也可单独查看修正后的单店来源。在这些含较大范围的原生分支上按单条观察续发，两个请求均返回 409，模型增量为 0。[原上游回读和新派发](../../../.local/product-v13/pm2/rounds/legacy-upstream.log)

受影响 Host/Pi 7/7、新 Chrome 2/2、规格轴原脚本 1/1 通过。TypeScript 与统一会话边界检查通过。上述点验使用本机隔离根和合成 Provider；真实业务输出质量、正式服务采用和用户验收分别记录。[受影响回归](../../../.local/product-v13/pm2/rounds/observation-final-affected.log) · [类型检查](../../../.local/product-v13/pm2/rounds/observation-frozen-types.log) · [会话接入门禁](../../../.local/product-v13/pm2/rounds/observation-session-boundaries.log)

固定提交 b7f59cb 的作者额外复跑曾与整仓/双轴同时执行，规格脚本超时在浏览器等待目标角色显示，另一个旧版本正控超时在 10 秒 Host 启动等待。两次超时保留。[浏览器超时](../../../.local/product-v13/pm2/rounds/observation-b7f59cb.log) · [旧 Host 启动超时](../../../.local/product-v13/pm2/rounds/legacy-exact-upstream.log)
