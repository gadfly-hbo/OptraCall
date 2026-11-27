# Issue #149 release 文档／归档独立只读一致性检查

**结论：PASS，无必须修复项。** 本结论仅指当前文档／归档的一致性，不是完整检查、CI、合并或产品验收通过声明。

检查工作树 `/workspace/OptraCall-issue149-check-followup`，固定source HEAD **`2eb30a51e31333a4252d4b6564bb0ad3a66326b8`**。本次未新增运行探针或Provider调用，产品、测试、规范与证据全程只读，仅在原final `.local/pm-final/` 写本报告。tracked非文档差异为空；预存 `node_modules` symlink另列，不当作source或官方依赖完整性证据。

## 检查依据与结果

- 实际未提交修改仅 `pm-integration.md`、`result.md`、`implementation.md`、`tasks.md` 四份状态文档及 `pm-review/release/` 归档。release共 **51文件／917115 bytes**；manifest记录50件附件，排除manifest自身，逐件bytes与SHA-256独立复核全部一致。检查时manifest SHA-256：`e9b5a2b5bbc6e7d2a7dece12825549863df3075e03a6a277ccd213bc85ce3166`；index SHA-256：`43fea0ff8bc87cd690e53cdebe14605c0765e0f85f950c854d0eb01096b1db7c`。
- UTF-8文本读取无错误、27份JSON均可解析；`git diff --check`无报错。独立检查58处本地Markdown链接，无损坏relative链接。原后端报告的2条绝对历史local链接在本机仍存在；索引同时提供对应归档报告的relative入口，未把原报告改写成虚构公开附件。报告中其余原local/native路径保留原证据位置，不伪造为完整数据库或运行附件已归档。
- `spec.md`、`demo.html`、`demo-guide.md` 与冻结确认commit `5f15cf3b677c743bda0b5b2c3ee0e4b4f57e1af2` **逐字节相同**。Demo SHA-256仍 `adff576ba604b35b95806ab6a5c0f7bf93de5f0124c1ce0540e14577572bf911`，与manifest一致；未以收尾文档改冻结设计。
- 文本证据的敏感模式扫描覆盖常见API/token前缀、private-key头、Bearer载荷、credential赋值及email；**未命中**。检查输出只含路径／类别／计数，不输出任何疑似secret值。归档内容保持隔离合成数据与原工程证据范围，没有新增真实业务/凭据采用声明。

## 当前 claim 与历史边界

- implementation/result新增页首明确原作者交接／冻结准备的历史阶段，导向PM集成与release索引；原候选自报PASS、原缺口、首用限定PASS、各次独立FAIL均保留原SHA，没有将旧版失败改写成旧版通过。
- index、PM集成、Runtime／后端集成报告对**6bc原实际运行**和**2eb字节无关增量沿用**分别核定。UI报告准确说明实际6bc Host＋摘要固定的2eb组件overlay与commit-binding，不声称Host进程跑过2eb checkout，也不把局部renderer当实际浏览器。
- 原完整检查失败调查仍保留FR03异步断言、CNR精确writer退休的RED／GREEN因果及其UNKNOWN边界；catalog孤立PASS没有覆盖原完整FAIL，也没有在缺最终栈时认定环境原因。当前材料未声称原6bc full run已结束、最终整包全绿或PR/main CI已完成。
- T15、T17、T18仍未勾选；其完整检查／最终非作者／准确PR head CI／main push CI／工程结案门禁保留，并指向同一Issue #149的最终动态回执。PR #151只作为唯一集成PR引用，没有提前声称已合并。设备采用、真实模型质量、业务效果和用户验收继续分别记录。

## 四原则与归档判断

当前摘要与实际已复核实现相符：Host管理owner／版本／来源／权限／取消和原业务回执；Agent自主执行；复用官方Pi1.4.0、Interface v3及原Goal／Case／Board／checkPlan权威，不虚构第二Runtime或完成表；普通当前工作最短路径与人工准备保留，只有真实历史版取舍需要明确确认。归档没有新增产品规则、权限或人工门槛，也未把工程专项PASS扩大为运行采用或全产品验收。

此PASS绑定上述source与当前归档摘要。后续若仅补完整检查footer，应继续准确记录实际source／命令／退出码／FAIL与未测及门禁，不从本次文档一致性PASS推导新运行成绩。
