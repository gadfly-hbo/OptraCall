# R1 本地整改记录

2026-11-15 · R1 本地整改完成。用户已确认 [最小方案](spec.md)，指定沿现有 `OC｜memory-dao` 分支直接实施。v3 完整本地检查、规范／规格两轴非作者复验及四原则检查通过限定范围；原 FAIL／UNKNOWN／NOT_RUN 保留。此记录不代表 Git／CI 交付、运行采用或产品验收。

## 基线与保全

- 本地 main、远端 `refs/heads/main` 与当前 HEAD 均为 `f5592518cbe6d27552501a3ed46a757c363857f0`，开工时 main 与当前工作树干净，无进行中 merge／rebase／cherry-pick／revert；worktree 占用已核。
- `.local/memory-candidate-nested/baseline/manifest.json` 记录 1523 个 tracked 文件摘要；`baseline/before/` 保存受影响源、测试、规范入口及依赖声明／锁文件原字节。原项目／native／候选／人工账不进入实验输入，原历史证据保留。
- 本 worktree 原无 node_modules；与 main 锁文件逐字节相同后，以 macOS APFS `cp -cR` 建独立依赖副本，未安装／升级依赖，未改主检出依赖。Node v25.9.0。源码官方包身份与完整性、后续检查另列。

## 进度与证据

| 阶段 | 状态 | 证据／说明 |
| --- | --- | --- |
| 规格、范围与保全 | 完成 | spec、baseline；R2/R3 暂缓，无 UI 流程变化 |
| 真实 SDK 隔离门 | PASS | `sdk-proof/direct-nested-reopen.log` 3/3 后才改产品；扩展 `expanded-initial.log` 6/6，含 260 并行／元信息缺项、长参数、真实 compact／reopen／fork |
| 产品 RED／GREEN | 定向 PASS；v3完整检查见下行 | `runtime/nested-red.log` 明确合法 nested 被拒绝；`reader/behavior-red.log` 旧11组通过、新4组行为失败；修后 writer／reader／controls／Host／M6 通过，见下 |
| 本地完整检查 | v3 PASS_WITH_LIMITS | `check/full-check-3.log`、`check/final-receipt.json`：2629项／2518 PASS／0 FAIL／111 SKIP，boundary／typecheck／build通过；v2 PASS仅为其原候选结果 |
| 全新非作者／四原则复核 | v3 限范围通过 | 两位 fork:none、非候选作者，`review/{standards,spec}/report-v3.md`；P1/P2 独立关闭，原 v2 不通过与反例保留 |

真实 Provider、真实业务材料、Git／CI 交付、服务切换和 MacBook 均未执行，且不在本轮授权内。每次原始失败／未知与修后结果分别追加，不覆盖历史。

## 实现与定向验证

- 新写统一 custom `{ recordVersion: 1, details }`，最小回执带原准确引用。SDK 唯一追加正文后，同步核文件类型／硬链接数、fsync、精确末记录字节及前后 stat／命名 inode；无异步窗口，不把 entryId 或内存可见当保存证明。故障返回 `agent_candidate_save_unknown`，不重追加。
- 新旧 reader 共用 owner、原 session／run、hash、治理和预算；旧记录继续校验 direct toolCall。有效 receipt 不形成第二条候选，旧 v1/v2／人的账保持。候选能力单独触发原 call-local 适配；SDK 未修改，adapter 的独立复核修正见下。
- `runtime/first-green.log` 16/16（含真实 Host 查读／人工控制／重启），`runtime/expanded-green.log` 23/23（新增旧 parent／跨 run／替换 signal／同ID、多层并行长参数、真实 compact／重开、实际硬链接故障 UNKNOWN）。再补 direct/nested 取消 hook，`lifecycle-final-green.log` 8/8；重叠结果不相加。
- `reader/behavior-green.log`：reader／controls／Host 27/27；`consumers/experience-learning-runtime-green.log`：M6 8/8。旧手工 toolResult 夹具未迁移。`runtime/guard-sensitivity-red.log` 临时仅撤候选单独触发适配后，新旧 ctx 行为测试失败，随后源码逐字节恢复并 GREEN；这是实现后敏感性检查，不作历史前置 RED。
- `sdk-integrity/official-archive-comparison.json`：7个 Pi 1.4.0 包、2530个文件与锁定官方 npm 归档逐字节一致，归档 SHA512 匹配锁；使用已有 npm 内容缓存。全程未改 SDK，服务采用未核定。

## 原失败与环境问题

- SDK 探针首跑对整个父 toolResult 禁正文，误命中合法 nestedCalls.arguments；原 `sdk-proof/direct-nested-initial.log` 保留，修正为仅核 content/details 最小回执。它是测试断言错误，不算产品 RED。
- 初次类型检查发现主检出依赖副本缺26个既有 DB-Link 锁定包，不是本次源码缺陷。仅从既有 `48da` 工程 worktree 按本锁版本／integrity 克隆补齐，未安装／升级／联网，详情 `baseline/dependency-completion.json`；修后 typecheck PASS。原日志保留。
- `runtime/contract-update-before.log` 和 M6 consumer RED 是旧输出断言仍按 toolResult 正文读取导致，与新合同对应修订；不删除旧格式兼容检查，不作新发现的 SDK 故障。
- 完整检查首次在 boundary 阶段拒绝新增 SDK 探针：最初将例外放入 ProjectAgent owner 清单，不能授予公开 SDK 导入。`check/full-check-1.log` 保留；修为同一既有 capability map 中该测试的六个准确 SDK 符号，并增加正例／越符号／越测试／直接包绕过反例。不扩大 tests 全目录或产品入口权限。

## v2 全新非作者发现与修正

完整 v2 的 1526 文件在两位非作者首末核验均无漂移。规范轴独立 SDK／reader 21/21；规格轴独立真实 Pi 回环发现下列问题，v2 报告及原反例固定于 `review/{standards,spec}/report.md`，原结论保留为规格不通过。

1. **P1，已派发未等待的迟到子调用。** 父 toolResult 已保存，child 在异步 SDK hook 等待，同一 run 后续工具释放后仍能写正文。原上下文委托只在前后核 parent，child 新核 run 不能代替其存续期。`runtime/review-p1-red.log` 永久公开行为测试真实 1≠0；修为 Node AsyncLocalStorage 传现有 available 闭包、子执行前检查，不加 Map／运行或持久权威。`runtime/review-p1-green.log` 9/9，含多层并行、旧 ctx、signal 和未知保存。
2. **P2，保存 UNKNOWN 被后续可读冒充已记录。** 独立 direct/nested 真实硬链接故障在 fsync 前失败，移除测试链接后 bare custom 被 reader 标 available。修为正文已核保存后才追加同 native 的无正文 receipt 确认；仅原 session、同 branch／run、准确 ref/hash 确认可使新候选 available。无确认仍 UNKNOWN，不重写正文或新建业务账。`reader/review-p2-red.log` 真实复现，`review-p2-final-green.log` 29/29；错 hash/ref、旁 branch、后 run、settled 后、仅 toolResult／fork 确认均不能升级。工具回执／确认自身有故障时仍保留技术错误；metadata 所证实的仅是此前正文已成功同步核定。

v3 对共享调用适配有影响，已重新执行完整适用检查及两位非作者复验；v2 全绿不覆盖此增量。未新增真实 Provider、Git／CI、设备或服务动作。

## 最终本地结果与边界

- 固定 v3：`review/candidate-manifest-v3.json`，SHA256 `d4eb318ab7f7ee83b42ae313f331a41ec0e32ac2105fd7b602ea33258318d609`，1526个完整工程／文档输入、13个改／新增路径。检查后与两位非作者复验后均零漂移；随后仅本结果与 spec 作事实收尾，其 v3 原字节在 `review/v3-before-closeout/`，另有限定核收。
- 完整 `npm run check` exit0，**2629项／2518 PASS／0 FAIL／111 SKIP**，边界、类型与构建通过，实际构建身份 `0.1.0-mvp.4 f559251+local-changes`。111项与v2一致，包含未提供的私有数据库／图／分发环境及当前平台不适用项，均不算PASS；未为通过补开范围外数据库／模型环境。保留Vite大bundle提示。`runtime/review-fixes-targeted.log` 受影响共享消费者82/82不另相加。
- 规范轴 v3 独立定向27/27，硬违规0／smell0；规格轴 v3 独立9次真实Pi回环请求，P1迟到写0条，P2 direct/nested均保持UNKNOWN，合法多层并行4条分别可读，错误确认／fork-only等变体不升级；原件GET字节不变。两轴均通过本地受影响范围，原P1/P2已独立关闭。
- 四原则：Host仍管理归属、权限、取消、实际保存及状态；Agent自主选择内容／数量／合法组合，零候选有效；Pi公开工具／native／fork／compact继续复用，新增仅现有资格闭包传递及无正文保存确认；正常使用新增必做人工作业为0。无新Runtime、记忆框架、后台模型、事务／重试引擎或平行会话树；SDK7包2530文件保持官方归档身份。
- **验证限制**：无真实Provider／业务质量实验，无设备或服务采用。确认metadata自身精确物理I/O故障注入 **NOT_RUN**；静态写入顺序和reader“两种状态／技术错误并存”已核，正文保存失败与缺确认的真实回环已验，不据此声称断电恢复或所有内核故障均已证明。旧版本reader未必识别新custom，兼容回退应使用能读新旧记录的代码，不恢复旧数据覆盖新增候选或治理。
- R2、R3暂缓；main检出仍干净，当前工作树保留本轮未提交改动。没有commit／push／PR／CI／merge／归档交付，没有切换Mac mini服务或更新MacBook。

## 后续 Git 授权与接续（2026-11-15）

用户在本地整改及说明后指示“做下git，继续R2”。以上未交付状态保留为本地收尾时事实；本次按当前 `OC｜memory-dao` 分支完成 R1 提交、推送与 PR／实际 head CI 核验，合并 main 及设备／服务采用另按明确授权推进。重新 fetch 后 origin/main 仍为 `f5592518cbe6d27552501a3ed46a757c363857f0`，与已验证基线一致，无须额外整合。

提交范围仅本轮已独立复核的13个文件；产品源码／测试与 v3 通过身份一致，spec/result 的事实收尾及本节 Git 授权记录单独保留。原始日志、测试数据、依赖与本地复核证据不进入公开提交。实际提交／PR／CI身份核定后追加，不将本地 PASS 充作 CI。R2 接续只核局部检索重复与已证明等价的小段复用，R3继续暂缓；真实模型、服务切换及MacBook未获新增授权。
