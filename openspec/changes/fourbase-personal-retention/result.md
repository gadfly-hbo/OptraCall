# M3进度：显式保留与个人查找

2026-11-03 · M3已实际开发；本地完整检查、18组真实产品浏览器及完整候选非作者复核限范围通过。

最新状态见文末“M3实际实施与验证”。以下确认前准备、等待批准及开工记录保留各自发生时的事实，不改写为当前尚未批准／未开发。

## 已完成的实际工作

- 用户确认M2 Demo。独立只读比对发现产品与Demo关键语义基本承接，但布局、预览、选材／回执及异常详情不同；用户明确选择保留M2现状、记录差异，优先M3。已更新[M2审阅记录](../fourbase-multisource-context/ui-review.md)，未对齐或重写M2源码。
- 核对分支`codex/fourbase-phase01-design`与HEAD `0f8ee5b`；247份产品source／test／script仍与M2固定检查一致，基线在本机`.local/fourbase-modules/m3/baseline.json`。没有Git写入、fetch或其他工作树改动。
- 读取已通过v1.2、M1全域盘点、M2合同、原Pi研究与实际图谱，分别只读核查产品可复用接缝、固定组件副作用及最小正文／保留权威划分。
- 补齐[复用核查](reuse-audit.md)、[本模块spec](spec.md)与[6项最小决定包](structure-decisions.md)。现有正文、revision、Pi历史及固定报告直接复用，真正新增只为个人保留决定／来源和聚合查找；方案本身未批准。
- 根据用户明确的流程纠正，在唯一[工程规范第3节](../../../docs/engineering-workflow.md#3-连续-sdd-与-tdd)补前置spec／UI Demo确认，规范升v1.4；AGENTS不复制详细条文。
- 制作独立[可点击UI Demo](../../../docs/prototypes/fourbase-m3-retention-ui-demo.html)，全部虚构资料／内存状态；[审阅路径](ui-review.md)和本机预览已备，实际浏览器点验及完整确认包非作者复核完成，可提交用户整体确认。

## 已识别并收敛的设计问题

1. Enterprise `enabled`不等于个人保留；其catalog展示enabled资料全部revision，不只activeRevision。新增固化不能承诺绝对不进目录，候选明确原页可见／可另行启用及归档不撤回原资料。
2. 正文先freeze、个人信息后首次落盘，会丢同请求的分类／来源身份；候选改为先写本条目完整intent／fingerprint，再固化和发表决定，不构建通用跨库事务引擎。
3. 直接用现有Case revision、Board task/item updatedAt代表历史正文不可行；首批只接有精确读回能力的资料、M2 citation、native reply与Feedback revision。
4. 原反馈handoff不等于任意跨项目消费；M3先保留／查找／阅读，M4才接新经验的实际提供与引用。
5. 两个Pi记忆候选都未证明可直接采用；不能只关退出摘要就宣称所有自动行为关闭，也不能凭缓存入口证明完整实现兼容。M3先跑既有工具／资料基线，不安装组件。
6. 非作者发现原pending只能重试，基稿已变时会永久占用条目。已补显式结束：先核权威／排在途，已发表回原成功，未发表留完整终结回执，保留原FAIL／UNKNOWN及可能已固化正文，再释放局部占用；原操作不能复活，修正后由用户明确新发起。

上述来自源码和确认前架构调查，不是新增产品RED／GREEN或运行兼容证据。

## Demo实际检查

最终HTML SHA-256 `fccf9239f5dc03b92c152869ea53f00cbfa60c64c57815217bc1b351af9f5497`，内嵌脚本`33e0aca3b4bb38f773c49f61f6233bef5ee3adb614980007e191a1353a33f54c`。六组实际浏览器点验通过：查找／人工笔记／保存与保留／旧版；UNKNOWN／并发冲突／重试与终结；四来源及同资料多次保留；来源失效与固定附件；宽窄屏／深浅色／隔离；草稿发现与UNKNOWN终结。静态HTTP请求均只取本页，控制台0错误／0警告，未写浏览器持久存储。截图已人工查看，390／320px无整页或打开面板横溢出。

确认前修正了三个Demo一致性问题：同material重复保留生成多个条目；同正文ref的多次决定／元信息混用；原页启停与同身份来源显示未同步。另明确附件-only资料及草稿联合保存失败未模拟，不能把人工新笔记的必填或成功路径泛化为产品完整合同。这些是演示修正，不是产品修复。

三次点验脚本初检因文案假设或未展开待完成请求而停止；核对实际页面后修正脚本通过，原失败日志保留，不记作产品RED。全部浏览器日志与图片清单在本机`.local/fourbase-modules/m3/browser/`及`output/playwright/m3-ui-review/`；没有新增产品测试或重跑M2全check替代M3验收。

## 确认包独立复核

非作者对12份固定候选、源码复用事实、6项决定、规范及父状态完整核对，确认包可审阅性／完整性／设计与职责复用**限范围通过，无剩余必须修复项**。独立浏览器另验14项，通过；247份产品输入与7份固定材料摘要均保持。11份Markdown的113个本地链接、文档空白／代码块及`git diff --check`通过。

固定审查清单为本机`.local/fourbase-modules/m3/review-candidate-manifest.json`，摘要`4553681ccaa7222cfc0af178ef2ac1c216130652bf4ced5b3c54bc55164e00f7`；报告`.local/fourbase-modules/m3/review/final-review.md`，摘要`1f99472067ef73e173b89627c25e9b193d223685c0312020905d691dcfc62570`。复核后仅收尾结果／审阅及父进度事实，spec、结构包、HTML和产品输入不变，交付清单单列最新摘要。

这是确认前设计检查，不是M3产品工程验收；真实持久化／权限／并发／重开、仅附件及草稿部分成功、检索质量和实际受影响调用链仍待确认后实施验收。Host只补资料管理与精确来源，Agent运行／方法／工具及原SDK权威未介入。

## 当前停止线

M3-D01–06均待整体确认；UI方案也待用户确认。按当前用户流程要求与决定包所引skill，不创建实际个人记录文件、产品schema、接口、源码或目标测试。候选文档／可点击演示、实际点验和独立复核已完成；下一步仅提交这一个完整包供用户确认，确认后进入M3开发。

现有M1／M2测试、原专业FAIL／UNKNOWN、用户项目／会话／文件保持。M3没有真实模型、组件安装、Git／CI、运行切换、MacBook或用户产品验收；M4–M8未启动。

## 用户整体确认与产品开工（2026-11-03，最新）

用户明确“方案及UI 确认，开始产品开发”，spec／固定Demo／M3-D01–06的6项A均已批准。确认前spec、结构包、HTML与准确摘要已保存本机`.local/fourbase-modules/m3/approved/approval.json`，247份产品基线核对无变化。上文等待确认及未开发为此前事实；本轮现进入实际TDD，依次建立保留存储／四类精确来源／个人资料UI，根Agent承担Host与原入口接线及整体回归，完成后固定候选做全新非作者复核。

测试沿已确认PR01–PR10的public Store、HTTP／精确来源、typed client／真实UI接缝，用合成隔离资料验证；不另问未变化的结构或测试边界。本轮仍不安装组件、读真实业务资料／凭据、调用真实模型、执行Git交付、切换运行服务或操作MacBook。M4–M8未启动。

## M3实际实施与验证（2026-11-03）

### 实际实现

- **原正文与个人决定分开。** 新`personal-retention-{types,validation,store}.ts`保存个人分类／别名／提醒／精确来源、草稿信息、保留／归档决定及局部恢复回执。正文、附件和正文revision继续归Enterprise，`freezeExact`不切enabled／active，不建第二正文库。
- **四来源及真实查找。** `personal-retention-sources.ts`复用Enterprise、M2 citation、原生准确回复全文SHA和Feedback revision，校验UTF-16片段、原归属和字节身份。`personal-retention-lookup.ts`聚合个人资料、M2真实概念引用和登记数据，关键词／别名／显式正文、分页与partial问题分开；不猜分类、不做语义索引或Host摘要。
- **Host／原UI接线。** 新routes、server和App接入个人页；真正抽取`EnterpriseMaterialEditorFields`供两页共用。资料旧修订、项目固定稿／附件、native回复与Board反馈历史均有显式整理入口；M2布局、保存／确认／选材逻辑保持。Board只有可选Host回调，原领域库／profile不变。
- **版本与恢复。** 正文及个人草稿分别反馈，保存不保留，旧版与新稿并存，同material多次决定和内容ref分别表达。完整原请求、条目CAS及intent先保存，固化后最后发表个人指针；UNKNOWN、失败及可能已固化正文保持，同ID异请求拒绝。明确终结也覆盖未建个人条目的合法首请求，迟到POST不能复活；归档／恢复不改启用、不采用latest。
- **输入／存储保全。** 精确详情不依未选中draft或其他revision正文。新建回应未知无ID不盲重建；跳原资料核对再返回仍保留工作台内存输入，没有第二正文缓存。2MiB预算建根前和发布时检查，首次超限更正后能继续；既有根丢records则failclosed、不重建空库。旧schema、Pi JSONL、SQLite及RAP／SAP不变，无新SDK循环／会话／模型注入。

### 当前检查结果

完整`npm run check`为**990项：987通过／0失败／3跳过**，统一会话边界、TypeScript及Vite构建通过。新增51项目标用例已包含于990，不与作者局部32／34／56等数量重复相加。保留大于500kB的chunk提示；3个SKIP分别为本机不适用的unsupported-platform反例及两个真实soffice渲染，不代表PPT视觉或真实Provider质量通过。

| 验收 | 关键证据与结果 |
| --- | --- |
| PR01–02 | 四类正常原入口、人工笔记、已有精确修订direct及附件-only实际走通；原编辑字段复用、freeze不改启用 |
| PR03–04 | Store／HTTP／真实UI核对保存不保留、旧新并存、明确换版、旧正文／元信息、一个item多决定和归档恢复 |
| PR05 | 来源身份／UTF-16／native全文SHA／反馈归属；实际坏来源报partial，未选新稿损坏不妨碍健康旧保留，无latest／私有路径回退 |
| PR06–07 | 真实M2概念／数据、默认及草稿归档范围、别名／正文命中位置、无命中与未核范围分开，没有占位资产混入 |
| PR08 | 断点／重开／原请求重试、首请求终结与latePOST、CAS、局部占用、首次容量拒绝与丢历史；独立新根真实HTTP复验通过 |
| PR09 | 原Agent／session文件未变，普通／受管／冷读／fixed-draft回归通过；正式产品读取／保留／重开期间live合成Provider计数0→0→0，无模型派发POST |
| PR10 | spec／6A／Demo已先获确认；完整check、无skip的18组产品浏览器、1440／390／320深浅与11个真实对象焦点核对通过；最终整包非作者复核限范围通过，初期行为RED不足不追认 |

完整检查输入为本机`.local/fourbase-modules/m3/verification/check-source-manifest.json`的377份source／tests／scripts／extensions／配置，检查全程SHA无变化；`full-check.log`及`full-check-result.json`为exit0。`host-final-targets.log`6项已含于990。

浏览器固定根`.local/fourbase-modules/m3/acceptance/product-avge38`，报告`report-run-1793678814194.json`摘要`67f51e64d0e18fc83c8e51cd9cba2c39bdca6000bb40fcdca3d6abec212f5dad`，18组无skip PASS；索引`acceptance/final-acceptance-summary.md`。17份运行接缝起止SHA一致，不代替377份全包。无JS异常／外部请求，四条console错误为明确注入的三次回应丢失及一次真实409，不说控制台零错误。最终fixture仅准备时一次合成native回复，正式运行及重开新增请求0；其他调试fixture各自的合成准备不漏计。

注入前原native／Enterprise／M2／反馈快照保持。末尾实际坏字节和原bytes另存，不恢复或清理失败现场。作者及root目视了宽屏、320深色、UNKNOWN往返和健康旧版详情；本人临时Host／Vite／浏览器／Provider均关闭，原服务未切换。

### 已修问题与保留的限制

1. 无个人item首请求终结曾404且latePOST可发表；已补真实material／CAS0／完整请求终结，原POST只回终结，独立HTTP通过。
2. 首次容量拒绝曾造空目录并被丢records保护锁住；现建根前预检，不放开真正丢历史，永久回归及独立HTTP通过。
3. 前端JSON键顺序曾误判同一来源、二次direct失败；现稳定语义比较，数组保序，原请求缓存字节不被同义回读重写；实际1item／2decisions通过。
4. 异步打开后的触发焦点不稳，已在动作前捕获并按模态层级恢复，11项实际对象核对通过；UNKNOWN推荐导航可能丢输入的路径也已在真实丢回应后往返验证，不重复create。
5. 精确详情曾依赖全Enterprise.get，现只读所选revision和轻元信息；坏新稿下旧保留仍可实际阅读。
6. 可UTF-8解码不等于文字附件能力，reader按既有文字格式支持处理，其他格式text=null并拒文字片段。当前M2合法写口不接PDF，这是受控reader port防御，不冒称已接PDF citation生成／解析。

原产品RED、Store／source行为RED、fixture／locator／启动／等待／RAF问题、显式PARTIAL及边界脚本均保留，各自分类；不制造历史RED。UI作者记录把初建缺模块／导出称RED的地方已在本机`implementation/ui/evidence-qualification.md`限定：加载缺项不算产品行为RED，初始构件前置行为证据不足不追认；journal原有比较错误及实际二次direct／焦点失败分别保留真实证据。当前正确性由目标回归和真实产品检查支撑。

浏览器脚本在`.local/fourbase-modules/m3/acceptance/browser-personal-retention.js`，使用现有缓存依赖，仅本机证据，不是portable CI入口；没有新增依赖或边界白名单。真实Provider／经营效果／语义召回未验证；Git／CI、安装／运行采用、MacBook和用户产品验收未执行。M4–M8未启动，M3不自动把内容送入任务。

### 最终独立复核及职责复用结论

非作者从批准输入独立导出预期，核对实际代码／受影响调用链、全部候选及证据，并在自己的隔离根独立执行8组边界和真实Host HTTP复验。最终389份候选、14证据入口、7份固定输入及批准快照匹配，143本地链接路径存在。完整check与正式浏览器输入均无漂移，**本次M3实现、受影响接缝及Host／Agent职责复用检查限范围通过，无剩余必须修复的实现项**。

固定清单`.local/fourbase-modules/m3/verification/review-candidate-manifest.json`摘要`32d24d1c9a68c9e42184fae049df26b35868f4198b6cbd047ecfdd114cdaa8d9`；报告`.local/fourbase-modules/m3/independent-review/final-review.md`摘要`55b12ac90c544bf446c5b51d270e4bc0e0a58e8736577b04c167cebad6f11615`。职责专项依据实际用户动作→Host资源适配→既有正文／来源权威，无新增Agent运行队列、方法编排、SDK循环或Host专业计算，不把容量／身份／原件保护误算干涉。

**初始UI构件的全部前置行为RED历史仍为NOT_PROVED**，不从当前GREEN追认完整TDD历史；其记录限定与当前实现通过分别保留。真实断电、跨任意外部进程文件篡改及专业业务质量未证明。复核后仅更新本页与父索引／结果的事实状态，源、测试、规格合同、6A及Demo保持；最终交付清单和精准读回单列。不宣称Git／CI、部署或用户产品验收已经完成。
