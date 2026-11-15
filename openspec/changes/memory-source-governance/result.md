# R3 本地实施记录

状态：本地整改完成。用户确认v0.1最小方案；spec.md目标清单G1–G5均完成。R3改动保留为当前分支未提交WIP，Git/CI交付与运行采用未执行。

基线：HEAD `00126c0a86bf6e0950e0cdedcd685c55f0c5bba7`，main `f5592518cbe6d27552501a3ed46a757c363857f0`，开工WIP干净，沿当前分支。1542份tracked原件与确认稿已保全。

授权：隔离合成验证、SDD/TDD、最小实现、本地适用完整检查、全新非作者复核。无真实模型、Git/CI交付、服务／设备采用授权。

## 隔离与实现

- 先于生产修改：官方Pi1.4公开ProjectAgent路径的多层并行transport 1/1 PASS；真实reader直读／nested、四组共用消费者和首个reader行为均留下缺提醒RED。证据位于`.local/memory-source-governance/{sdk,consumers,implementation}`，原Provider请求及native保留。
- 最小实现：准确人工experience content按需读取同一治理账快照，最多8个不同准确ref；全份提醒4096 UTF-16，prepare先分配有界最低状态空间。提醒进实际工具text，receipt附独立sourceGovernance；已排除不带自由文本。未知原因区分治理账不可用与准确引用冲突。
- 普通长文沿原UTF-16续页，签名只含已检查来源及实际附注；选材只缩可选注记片段，最短关键状态仍超限则沿原明确失败，不删固定正文。Case/Semantic/SAP无需生产适配。
- 历史仅校验新增可选sidecar的有界结构与允许字段组合；旧receipt缺字段继续原样，读今天状态不回填当时正文。新增历史结构用例先有有效RED再GREEN。
- reader边界首轮的重复ref夹具被原`duplicate_personal_source`拒绝，这是夹具FAIL，不算产品RED；改为同准确ref的不同合法excerpt，保留原日志。未删除或放宽重复来源校验。

## 中间阶段状态（历史）

此为v2完整检查前的中间状态，现已由后续v3最终证据取代：当时适用完整本地检查及冻结候选的全新非作者复核尚未完成，未据定向GREEN宣称本地验收完成。

- 第一次完整check在入口门禁失败：standalone SDK新测试不是批准入口。该结果为FAIL，保留`full-check-v1.log`；随后将其并入已有批准的`tests/personal-context-runtime.test.ts`，原M4用例不删，测试器／白名单零改动。合并文件28/28与原边界检查PASS，原稿及合并前副本保全。SDK官方声明／锁／实际安装均1.4.0，无依赖改变。
- 首个GREEN后补充治理故障原因和混合来源计数语义，分别保留有效RED/GREEN；新增sidecar不允许把排除后的自由文本当作有效结构。当前16个R3 reader/history/consumer用例PASS，已批准Runtime文件28项PASS；完整check v2将核同一冻结候选。

## v2完整检查与非作者发现

完整`npm run check` v2 exit0：2653项／2542 PASS／0 FAIL／111条件SKIP，原边界、类型及构建通过，Vite大包提示保留；该结果只绑定v2。全新非作者标准轴v2提出STD-R3-01（P2）：排除或预算省略纠正自由文本时，准确操作ID仅在receipt。规格轴同样关注此点。v2失败报告保留，不记为全部通过。

按原已确认“注记操作身份”补公开content断言，`correction-identity-red.log`真实失败；最短提醒现在也包含准确纠正ID，省略文字说明合并到固定文案，有界原状态不丢。每份prepare仍预留至少512 UTF-16最短状态空间；不可表示时明确原预算错误，不降已知状态为UNKNOWN。44项公开reader/history/consumer/实际SDK受影响回归GREEN；v3将重新完整check及非作者增量复核。

正式spec首页仅清除准备稿复制的旧状态措辞，明确当前用户确认及禁止Git/CI范围；原批准稿、v1/v2候选和原始FAIL均保留。

## v3最终本地结果

`npm run check` v3 exit0：**2653项，2542 PASS／0 FAIL／111条件SKIP**；原会话边界、类型、构建通过。R3相关reader/history/consumer＋原批准Runtime文件共44项通过、无跳过。原111项条件跳过不算PASS，Vite bundle提示保留。收据见`.local/memory-source-governance/implementation/full-check-v3-receipt.json`；1548份完整候选SHA绑定`review/candidate-v3.json`，未用v2成绩代替v3。

| 验收 | 当前证据与结论 |
| --- | --- |
| R3-01 | 官方Pi1.4真实直接／多层并行工具content送到合成Provider下一请求；原M4入口28/28，nested历史仍UNKNOWN，不强制直接重读。PASS |
| R3-02 | 纠正／排除／恢复提醒更新；人工经验正文、版本、hash、自身治理不变。排除候选与纠正自由文本canary不泄漏。PASS |
| R3-03 | 无控制记录、坏账和准确引用冲突分别表达；来源native失读不冒充正文可用。治理提醒无候选正文／标题IO，账故障只附UNKNOWN。PASS |
| R3-04 | 0/8/9 ref、512条引用、不同excerpt的重复准确ref、长身份／注记、8选材均有界；64行操作ID可见。非作者独立探测提醒恰4096 UTF-16，原选材恰32768文字／262144bytes的双满载分别明确失败并保留输入。PASS |
| R3-05 | 相关治理改变拒旧续页、无关改变可继续；代理项正文精确还原。旧receipt缺字段原样、today与recorded分开、native字节mtime不变。PASS |
| R3-06 | Case/Semantic/requirements/SAP/prepare实际公开读口与保存重开、原取消/迟到/profile兼容覆盖；完整本地检查、全新非作者双轴及四原则完成。PASS（本地工程范围） |

标准轴v3报告：`.local/memory-source-governance/review/standards/v3-bccbab83-f148-444e-8c98-c559d8021781/report.md`；44项＋6组独立实验通过，STD-R3-01关闭。规格轴v3报告：`.local/memory-source-governance/review/spec/report-v3.md`；44项及独立单快照、迟到取消、精确满载、续页实验通过，F1关闭。两轴均未参与候选创作、未继承作者历史；其他1544文件与v2相同，复核前后1548份原树／隔离副本零漂移。v2 FAIL、首次完整门禁FAIL、fixture错误和原日志保留，非作者实验误放相邻隔离目录的范围偏差已在原receipt说明，无生产或固定证据变动。

四原则最终核对：Host仅核准确引用、治理快照、权限、取消、预算和交付；Agent自主决定经验是否适用。复用既有Pi1.4.0／Interface v3／owner、read/prepare及同一控制账，无新Runtime／框架／后台模型／事务重试引擎，无SDK包／内部对象／原型改写。正常使用新增必做人操作为零，不级联改写经验，也不扩R1/R2、知识／目录、来源树或UI功能。

开工1542份tracked原件及批准稿字节全部保全；main本地和只读远端核均为`f5592518cbe6d27552501a3ed46a757c363857f0`，HEAD保持`00126c0a86bf6e0950e0cdedcd685c55f0c5bba7`。本次未重做官方SDK发行包逐文件比对（沿原R1材料证据，声明／锁／实际安装及现有门禁已核1.4.0），不把工程合成验证写成真实模型收益或用户产品验收。

未执行：R3提交／推送／PR更新／CI／main整合、真实模型／业务数据、服务切换和MacBook更新。原R1/R2 Git交付状态不因本次本地WIP改变。后续交付另按有效授权推进。

## 后续 Git／CI 与设备采用授权（2026-11-15）

用户在上述本地收尾后明确授权“做 Git/CI 交付、服务切换、MacBook 更新”。当前进入spec的G6–G8；以上未执行事实保留在其原阶段，不作为新授权后的禁止条件。先核当前分支、WIP、worktree、最新main及已复核生产字节，再沿原PR #74交付R1／R2／R3最终范围，分别核PR head CI、squash main push CI和两端运行采用。真实模型不运行，Pi1.4.0与资产／控制记录边界保持；实际结果由`.local/memory-source-governance/delivery/`的分阶段收据、PR及最终答复核定，不预写成功。
