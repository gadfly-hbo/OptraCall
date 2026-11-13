# 规则推理闭环实施记录

2026-11-13 · 用户已批准方案、spec、UI Demo及任务清单，授权I01–I07。原批准输入身份见[approval.json](approval.json)，准确原件私有快照在 `.local/studio-rule-reasoning-implementation/approved-inputs/`。冻结稿中“待审核／暂不开发”是原审核状态，不覆盖本次明确授权。

## 目标、职责与停止点

完成官方Semantica 0.7.0规则执行、候选核验、准确发布、普通Pi自主消费、版本历史及必要UI；不升级或修改SDK，不建第二推理／事实／公式库或Runtime。目标企业M01–M05和I08 Git／CI／main／服务／设备均未启动。

按原工程规范与TDD执行，测试接缝来自批准RR01–RR12：原Studio parse/save/read/publication、原Host port及HTTP、原SDK父tool调用与取消、实际官方Python worker、原工作台与普通任务保存的工具回执。结构检查不代替经营语义、计算与叙述核验；合成实验不冒充目标企业建设。

Interface仍为v3，主owner为真实project/task；`reason`属于原Studio工具的只读计算能力，普通消费不获得建设／发布权。执行使用原worker及父tool operation的signal/assertCurrent/registerCleanup，不新增模型会话、运行域或占用台账。普通Agent自主决定是否调用；Host只管权限、准确来源、预算及回执。

并行归属：SDK实施者维护新Python规则worker及其Python测试；内容实施者维护原foundation profile和新内容测试；UI实施者维护原Studio／历史工具展示及新UI测试；主Agent负责Host／Agent接入、发布合同、集成、最终验证与证据。禁止同文件并发写入。最终独立复核另选未参与上述任一部分的全新上下文Agent。

## 执行与证据

私有原始证据根 `.local/studio-rule-reasoning-implementation/`，包含sdk/content/host/ui/runtime/review。每项按tasks即时更新，当前未完成的验证不预填PASS。

I01初核：官方Rule接受conditions字符串列表和conclusion，Reasoner.infer_with_results返回结论／规则／前提；SHACL支持内存Graph。迭代触顶不会自行标partial，多个producer或同头绑定可能合并前提。薄适配需静态核无环和闭包预算，并忠实标注官方前提合并性质，不能补造逐路径证明。最终支持范围、探针及限制随实际代码和结果补全。

## 实际接缝与支持合同

- 原 `studio-foundation/2` 承接 `/1`，可选 `ruleExecution` 含官方conditions列表/conclusion、谓词及项身份、事实需求、原Binding和可选内存SHACL。准确声明仍在原body；SAP公式仍归原库。新profile公开合同从原catalog/read可取得，旧 `/1` 和文字不迁移。
- `studio_assets.reason` 是原工具上的只读确定性计算：建设owner可试自身候选；普通任务只执行准确发布且包含 `rule-execution` 用途的版本。输入为 `{ref,itemId,purpose,factsRef}`，准确Studio Ref已有locator时无需再猜systemId。原catalog.inputs给本项目020文件的准确Ref；数据id与内容hash角色分开，不要求人或模型自造技术标识。
- factsRef指向本项目准确JSON：`contractVersion=studio-rule-facts/1`，同一purpose，逐事实statement/requirementId/原来源/记录定位/kind/Binding，目标positive/negative及覆盖/业务时间/截止。Host读原件、核全部需求Binding类型（空facts也不能跳过）、权限／版本／来源性质，调用及返回前重核；末次资格核查与同步回执沿原mutation序列，不持锁推理。作者投影不冒充独立事实核验。
- 官方Rule对象的正向合取、显式结论和无环链；SDK单次 `infer_with_results`，无自建匹配器/证明器。外部输入事实谓词不能同时为本次规则结论谓词，避免官方只返回新结论导致观察/派生混淆；同次内部链式派生继续支持。
- 固定环境限制：规则32、输入事实256、返回结论512、迭代32、worker20秒。函数自由有限域的中间绑定／总工作事实上界8192，超限在SDK前标不完整，保守估计可能排除稀疏join；不是OS硬内存沙箱。SDK输出截断仍依据完整实际结果核目标，不能漏冲突或将未返回当未推出。
- 多producer或隐变量可能合并官方前提，只保留primary-rule及engine-reported-union限定，不补造完整逐路径证明；confidence不是业务概率。SHACL仅内存结构Core，拒绝路径／imports／SPARQL／JS，不替企业决定政策。
- 原预览新增purpose及由准确源自动生成的执行摘要，纳入原指纹。执行用途需作者准备／三状态／检查，并有当前准确修订的实际成功native回执；定义用途独立。没有新的发布／规则／事实库。回执沿原Pi native保存，普通历史只展示当时结果，不回读latest。

## 原失败及修复证据

SDK初探保留迭代无partial、官方合并前提等限制。预审来源撤回竞态已修，独立实际复现确认返回前撤回会拒绝；输出截断漏目标／冲突的三个真实反例先FAIL后GREEN。最终非作者又发现输入结论谓词混淆、空facts绕过Binding类型和公开 `/2` 合同缺失，均沿原接缝修正并增量复验。完整页面走验发现confirmed结果未装入冻结用途摘要，修正后同入口回核。详见本机 `review/final-core/review.md` 及 sdk/host/ui 原始日志。

测试准备错误单列：公开合同断言最初误写 `contract.content`，实际字段为 `contract.foundation`，该TypeError不作为产品RED；两次live脚本启动参数／相对导入错误发生在模型派发前，也不当产品或模型失败。真实SDK／权限等有效RED与后验集成回归分别记录，不补造历史。

## 真实模型及停止边界

沿已有获准DeepSeek Flash官方线路、原Provider/API/model/高思考配置值，冻结实际官方Pi模型context=1,000,000、maxTokens=384,000及输入/compat；隔离配置保存revision不同，值等价独立核。普通v1/v2没有手选规则或预期答案，模型实际找读原文、调用Semantica并另存报告；源/派生/使用/独立评分分开。合成seed和凭据仅在本机私有验证根，未进入公开仓库或真实企业。

两次初始取消发生在取得成功引擎回执前：本地验证预算把缓存上下文累计token设得过低，同时暴露Ref／system标识猜测接缝。已保留取消现场，补原目录准确输入Ref和原Ref定位，后续按新冻结预算区分未缓存输入／输出／SDK估费／墙钟，无隐藏自动重试。

独立业务复核：v1计算与叙述通过；v2首稿计算通过、必要条件叙述FAIL。交原Agent同任务自主核查，原稿另存保留；第一修订关闭原问题又引入二值完备性过度断言，叙述仍FAIL，且验证脚本未实施其声明输出监控，实际14,054超过10,000预算，明确保留预算FAIL。第二次有限反馈先固定新预算并实现新turn计数监控，再由原Agent另存；独立核定B02和B03已更正，但B04叙述FAIL：本轮reason调用为0，却声称本轮重跑并错标历史回执归属。第二修订预算PASS，原报告、备份及合法追加前缀均保全；已停止进一步模型修订。Host没有代算、改稿或裁定专业通过。

工具工程、限定合成专业验证与用户产品验收分别报告；不因单个模型报告通过宣称企业主题完成。真实目标企业M阶段和I08均未启动。普通Agent的企业贡献闭环当前live未覆盖，其原工程合同／兼容回归与真实规则新版使用分别核定，不能以两个live案例偷换为贡献业务验收。

## 最终本地核定

最终npm run check为2191 PASS／70 SKIP／0 FAIL，真实SDK受影响Node路径17/17、Python规则26项通过；核心非作者最终复核通过且全部产品／测试文件哈希与其固定候选一致。此前一次project-files历史读取409失败原始原因与本变更归属UNKNOWN，原套件5/5及独立定向3/3通过，既有并发快照保护可产生同码但不据此替原故障定因。保留原全量FAIL／现场缺口和后续通过，不改保护或断言。完整结论与专业未通过边界见[result.md](result.md)。

I01–I06工具实现已完成，I07适用工程检查及实际专业评估已执行，专业v2叙述仍FAIL；未授予整体专业／用户验收通过。当前停止，不执行I08或企业M阶段。

## 后续Git／CI接续

用户随后单独授权“执行Git／CI，完成后停住”。本地实施的原FAIL／UNKNOWN、专业结论与上述当时停止点保留；最新授权及实际Git/CI状态见[delivery.md](delivery.md)。本接续不合并main、不采用运行服务或更新MacBook，不启动企业M阶段或追加模型实验。
