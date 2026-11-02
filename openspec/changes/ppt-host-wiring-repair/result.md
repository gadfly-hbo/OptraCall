# PPT Host 接线修复记录

基线 `d58061b08534d48d7847d8447575058a1faa45d4`，分支 `codex/ppt-host-wiring-fix`；开始时工作树干净。PR #23 的规范／检查记录已合并，其main push CI `41409102624`成功，本机原main工作树安全快进；该交付未修PPT。本次按用户后续明确授权执行修复。

## 已实施与定向检查

已落实真实项目／固定模型绑定、完整operation、项目范围busy／关闭、相对报告入口与只读兼容；技术guard失败隔离与显式恢复、原件／碰撞导出保护；版本父链／当前指针／未知差异；UI停止、导航等待、非2xx回执读回、能力降级和候选入口。公共业务会话子集仍为Interface v3，只新增Host管理面只读scope busy投影，不增加业务运行台账或并行Runtime。

- 原故障证据保留在上一变更 `.local/host-agent-boundary-governance/delivery/ppt-host-review/`，未修改或重跑旧真实任务。
- 真实Host的PW01/02/03/04/05/06合成回归4项全部GREEN，实际使用本地合成Provider和真实SDK工具链，无真实Provider请求。覆盖项目A不随全局B、原件／导出路径与碰撞、busy拒绝与归档／停止、真实工具损坏ZIP后的隔离与显式恢复。该组最初4项失败包含新相对路径API与旧接口不兼容，不能将其全部当作各缺陷的因果RED；原五项因果复现及后续分切片红绿分别保留。
- 存储回退／谱系／碰撞／缺机器记录先RED后GREEN；会话完整占用／匹配关闭／配置／迟到／取消7项通过；client7项、ProjectStore归属8项通过；guard关联媒体与无效包2项通过。各切片命令、原始红绿输出及限制见 `.local/ppt-host-wiring-repair/{store,sessions,routes,ui,host}/`。
- 初始Host scope busy能力缺口已有RED→GREEN，准备、阶段间、取消收尾和retirement从公共权威状态直接读取；不同项目／Provider／第三合成消费者不受无关scope影响。

以上为初始定向检查，不能单独判定完整候选验收。后续完整检查、浏览器与独立复核见下文；Git／CI按实际交付回执另核。旧FAIL/UNKNOWN和原版本／会话保留，未进行新真实模型或专业质量评估。

## C1完整检查与独立复核

C1固定27份文件，摘要／快照在 `.local/ppt-host-wiring-repair/c1/`。完整 `npm run check` 退出0：841项，838 PASS、0 FAIL、3条件SKIP，构建通过；`npm audit --audit-level=high`退出0，保留原有2项moderate（无high/critical），未升级锁定SDK或依赖。

独立规范轴与规格轴均“不通过”：合法PPTX手动重排后锁定页按物理文件号误识别；既有无meta目录内的deck目标软／硬链可在登记时覆盖原件；单版本保护失败无UI恢复按钮；网络失败被误当终态，可能丢停止／导航保护。两轴报告、独立重排及覆盖复验保留在 `c1/review/`。浏览器另复现文本只读检查被图像能力门误拒；C1绿色工程检查不关闭这些问题。

## C2修订

- 页序由共享OOXML辅助读取presentation实际页序及关系，锁页／编辑／拼回／恢复一致；包含手动重排与关联资源的新因果回归。
- 登记前拒绝已占用／未知残留根，deck和初始版本排他复制、meta最后排他发布；软／硬／悬空链接与实际复制／发布竞态保全有红绿证据。
- 保护失败时当前v1也可显式恢复；原始网络UNKNOWN不虚报终态，实际busy及停止后保存状态分别读回；typed busy拒绝不自动接管其他占用。文本只读与显式视觉检查分开，未支持图像时仍可核对文字。
- 实际Host普通项目任务经本地合成Provider与SDK验证PPT skill被加载；真实PPT资源与新增页序helper经受管skill快照字节核对。没有调用真实模型。

C2完整 `npm run check` 退出0：866项、863 PASS、0 FAIL、3条件SKIP，构建通过，见 `full-check-c2.log`。使用已有LibreOffice及隔离复制的既有Python环境，定向渲染／页序44项全部通过、无SKIP，见 `render-and-order-c2.log`；未安装产品或变更系统Python环境。普通完整检查的两项渲染条件SKIP由该具备环境的真实渲染补验，另1项为本机支持受管执行时的相反平台分支。

C2两路非作者受影响复核均通过，范围和独立探针在 `c2/review/{standards,spec}/report.md`：直接复用C1原重排工件验证锁页拒绝／回滚；独立核对软／硬／悬空目标保全、实际显示页编辑／拼回／恢复、单v1保护恢复、有效PPTX谱系和文字／视觉门。SSR与client／API小探针只证明相应场景，不冒称实际浏览器或真实SDK运行。

## C3最终本地候选

C2实际浏览器又检出设置返回重新登记工作稿、停止确认空闲后残留过时运行文案、同名导出显示裸错误码。保留原网络／快照后修正：App在成功读取deck后保存真实id，设置返回只读取原deck；显式新报告与目录入口仍按用户操作打开。UNKNOWN仅在实际空闲及保存状态读回后释放控制，结果未知仍保留；碰撞继续409拒绝并给出可操作中文提示。

C3固定32份文件，清单／快照／差异见 `c3/`，相对C2仅4份UI／client／测试及结果文案变化。最终完整 `npm run check` 退出0：**867项、864 PASS、0 FAIL、3条件SKIP**，构建通过，见 `full-check-c3.log`；scope导入检查及所有既有消费者、第三合成接入随完整检查通过。SDK／锁文件未改变，审计仍为0 high/critical、2项既有moderate。构建的既有大chunk提示保留。最终记录整理仅修改本文件，不重复无关测试。

非作者C3 delta复核通过，见 `c3/review/spec/report.md`，独立运行固定源hook／client探针确认设置重挂不再create、显式新source／list清理旧id、UNKNOWN实际idle门及409文案／peer隔离。其余27份文件按C2未变字节继承原实际复核范围；原C1不通过未改写。

## 实际Host／浏览器路径

隔离真实 `scripts/start-host.mjs`（生产permission/env入口）、Vite、原生SDK和localhost合成Provider，使用合成三页PPTX／md。未导入真实凭据或业务数据；已有LibreOffice与隔离Python环境实际渲染。证据在 `browser-c2/browser-results.md`、`summary-final.json`、自动快照和截图；命名为browser-c2的隔离环境同时完成C3复验。

- 同stem报告自动绑定，歧义md显式选择；PPT候选入口和已有精修记录均可打开，三页缩略图／页图正常。普通任务skill加载另由真实Host回归确认。
- 无图像模型明确降级，文本只读成功；真实SDK工具正常编辑、保存v2和差异，失败401之后422回执仍读回保存的v3／页图／差异，不报成功。
- 真实SDK写坏ZIP后执行／导出隔离；仅current v1时也可在UI显式恢复，原失败稿／前态保留且三页图恢复。
- 实际停止和导航停止都等公共会话空闲及保存读回；先派发真实Host、后中断浏览器回执的故障注入保持UNKNOWN／停止入口，不自动重发。确认停止后UNKNOWN保留，旧运行文案清除。
- 设置返回保留原deck及v2／v3、已存差异和页图，deck总数不增加；旧重复deck保留作为原失败现场。导出在真实项目060_reports，重复同名409；源PPTX、md、已导出PPTX和差异清单SHA均保持。

该环境共12次本地合成Provider请求，均为项目绑定模型synthetic-ppt-browser-a，5个held请求实际关闭，Provider错误0；最终3个deck全部busy=false。浏览器console10项资源错误均是有意注入422／409／断连，0 warnings、无JS异常。检查结束只关闭该命名浏览器及自建隔离Host／Provider／Vite；未切换产品运行服务。

## 最终职责边界及复用专项

**结论：通过（C3实际改动及受影响接缝范围）。** 依据工程规范第2／4节、PW01–PW09，范围是固定32文件及相关调用链，非作者证据在C2 Standards／Spec与C3 delta报告；实际Host／SDK／浏览器补足相应运行证据，不凭全绿测试单独判定。

Host核定真实项目／固定配置、材料和文件路径、公共operation／取消、原件／版本保全、技术保护及展示。Agent仍经既有SDK自主选工具与编辑方法；未新增分析步骤编排、方法配额、内容正确性裁判或模型fallback。完整精修操作复用原withSession／lease／commit；busyInScope只读投影同一公共权威operation／resource／retirement，解决已复现的范围查询缺口，不增加业务busy账本、队列或SDK循环。OOXML显示页helper仅统一文件寻址，锁页／无效包隔离和排他发布属于已确认的技术治理。检查发现的页序、覆盖、恢复、UNKNOWN和导航问题已修正并分别复核，未申请例外。

## 兼容、Git交付与限制

旧deck／元数据／版本／会话不自动迁移重写；来源或固定配置不可核定的旧deck保持只读。新元数据沿用现有文件增加可选当前指针／父链／未知差异字段；缺旧谱系及外部未记录编辑明确UNKNOWN，不伪造历史。保护失败只显式恢复有效已存版本，不清理原失败稿。代码回退不等于数据回退，旧Store不理解新指针／谱系，不能直接用旧副本覆盖或据最大编号采用版本；如需回退，先保全目录并核对实际读取／写入兼容。

开始及最终本地检查时origin/main均为d58061b；之前qoder/reports-factory分支内容已包含在PR21／22的main树内，不再重复合并。PPT skill／编辑能力在原main上修复，未撤销既有reports-factory工作，也未改其余插件／锁文件。

本地工程、合成真实Host／渲染／浏览器及非作者复核已完成。Git交付以最终提交／PR、实际head CI、合并main push CI和树核对为准，集中回执保存 `.local/ppt-host-wiring-repair/delivery/receipt-final.json`；提交本记录时不预记尚未发生的CI或合并。原FAIL/UNKNOWN完整保留。真实Provider全链路、内容／数字／视觉专业评估、用户产品验收及运行采用均未执行，本次Git交付不自动安装／切换服务或操作MacBook。
