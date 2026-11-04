# M4 v0.2 产品实施

2026-11-03 · 用户已整体确认spec、UI Demo、D01–D06全部A · **本地开发与工程验证完成；用户产品验收另行记录。**

## 固定输入与授权

批准的[spec／决定／UI原件](history/approved-v0.2/README.md)、Demo SHA `557eaaba133227cac5ee681f84f482ceee74fb9fe70380cf6434dbda19f5ddc3`，准备交付清单 `dc847da01cfc3bd202e9e8331699a4aa44f3b7f4fa28e108d6afc0c7f8d7622d`。开工回读20候选、391产品源及旧证据均匹配，HEAD `0f8ee5ba0e3c626e517457cd08289a5ddd0d4cd9`，分支 `codex/fourbase-phase01-design`；现有M2/M3/M31 WIP不清理／覆盖。原字节及清单在`.local/fourbase-modules/m4/implementation/baseline.json`与`before/`。

沿工程规范v1.5 §2–4、IN01–IN07及统一接入：Interface v3业务子集，owner=project-tasks原projectId/taskId，普通unmanaged才注入两自主读工具；受管ordinary仅人选固定文本，冷读／插件／封闭不新增权限。Pi锁定1.4.0，复用SDK会话、工具校验/hooks、取消、nested和原生保存。无新Runtime／正文库／持久准入账／索引／第三声明工具。Host只给环境／治理，Agent自选读或零读、方法与纠错；默认额外记忆操作0。

## 已批准的公开验收接缝

这些来自已批准spec RU01–RU10与“确认后的开发与验证顺序”，不另立未确认测试接口：

1. 真实任务公开HTTP／产品UI：正常提问、准确可选选材、草稿／目标／profile、未接受失败的显式撤项发送、同ID恢复／不重放。
2. 同一ProjectAgent→真实Pi1.4.0→合成Provider→Host业务port→原生文件：直接／nested读取、实际模型content、owner／ctx／run／取消／重绑／迟到资格。
3. 人工／候选原公开业务reader：metadata-only找、准确旧ref读、治理／最新纠正、归档／未启用、分页与共享预算、源／不可读。
4. 原生公开历史／task HTTP：当时实际文本与当前治理分开，nested子正文未记录UNKNOWN，旧版本／坏native／只读bytes+mtime、Provider新增0。

逐垂直切片先真实行为RED，再最小GREEN及必要回归；缺导入／观察器错误不算RED，不能一次SSR缺按钮冒称全部动态UI前置证据。产品UI在受影响切片首次实现前记录公开动态RED。本模块不沿用M31限定流程例外，原NOT_PROVED单独保留。

## 工作与证据

- reader：准确业务类型、metadata-only找／读与供给治理，复用M3/M31／safe snapshot。
- runtime：原通道两向最小IO、两工具、真实SDK直接／nested及取消资格；不另造生命周期。
- UI：批准关键行为与现有壳对齐，taskKey内存选材，动态RED及实际产品浏览器。
- Host／history：原消息准备／fingerprint／去重及原生历史只读投影，合成端到端与最终检查。

证据各记于`.local/fourbase-modules/m4/implementation/{reader,runtime,ui,host,history}/`；最终固定完整候选与适用`npm run check`、真实合成链路、非作者独立复核和四原则专项。真实Provider／业务收益、Git／CI、安装、运行服务采用、MacBook均不在本轮范围。隔离合成Host仅用于验证，不切换现有产品服务。

## 实现与验证范围

| 批准项 | 实际实现与公开证据 |
| --- | --- |
| D01／RU01、08 | 同一普通unmanaged任务自主两工具／零调用；managedordinary仅人选固定文本。SDK真实profile反例／零读、UI默认无选材原本已通过，不为未改行为造RED。 |
| D02／RU03、04 | 原M3 decision／revision／body hash及M31原occurrence；find仅元信息，read实际content＋最新意见／局限，准确片段／分页／续读。reader首轮公开RED→GREEN与独立长文本／目录预算检查。 |
| D03／RU02 | 原IPC窄反向read口、同一SDK customTools。真实direct／nested／hooks／Provider正文、取消／close／fork／旧ctx与parent反例、合法多层并行；不限制Agent调用顺序或增加循环。 |
| D04／RU05、07、10 | 列表／详情精确当前任务一击、其他任务明确选择；taskKey内存选材／既有草稿；未接受坏资料显式合并处置；未知ACK固定payload同ID回查／显式重试并读取真实终态。主要路径均有真实产品动态前置RED及实际Host链。 |
| D05／RU06、09、10 | 读取当次排除／最新纠正；原生实际正文与当时快照、今天状态分开，nested子正文UNKNOWN。safe snapshot拒绝旧／坏native，原旧history／receipts／去重口一并改只读，空会话在显式open保存SDK真实header；绝不只读时补造。 |
| D06 | 第三声明／成果证明链延期；普通作者说明及原M2人的来源登记不改。无新正文库／Runtime／schema迁移／后台模型。 |

作者分工证据：`reader/summary.md`及`final-manifest.json`；`runtime/README.md`及`author-manifest-after-independent-p2.json`；`ui/postreview-fixes-evidence.md`及`frozen-ui-postreviewfixes-source.json`。root的Host／history真实RED与检查见`host/`／`history/`／`verify/`。公开Host联合6项覆盖零选材find/read、准确旧人选／同ID损坏源不重读、严格未接受错误、原生nested UNKNOWN、最新候选纠正／排除及旧正文保留。实际浏览器覆盖从UI到Host／Pi／合成Provider／native的normal0、人选、失败合并、历史／当前及nested；候选最新注记的真实SDK链与动态UI展示分别留证，不冒称同一浏览器走过无注记的retained之外全部场景。

### 已发现问题与修正

独立复核在开发／整合中实证5项P2，原失败均保留：同manager跨run旧SDK ctx继续读、跨run相同prompt误借旧personal回执、首次完成后来源历史不刷新、未知ACK同ID去重完成后UI仍假running、历史打开用旧cached.current。各自已补永久或直接公开行为RED、最小修正及原独立反例复验；最终整包结论仍待固定候选。调用闭包只是已验证Pi1.4.0 gap的最小资格适配，不新建运行生命周期或禁合法nested。

首轮`npm run check`为1088项／1083通过／2失败／3原SKIP，原日志保留，且当时UI仍有后续修正，不能作最终候选PASS。空会话旧消费者409已定点RED→GREEN：严格history读不再允许SDKopen补header，故在显式SDK open复用既有materializeNewSession保存真实空header，不放宽readonly的missing／oldnative保护。另一startup-question观察器2秒在全并发负载超时，原产品单独复验0.453秒通过；仅该观察等待沿既有Host启动上限改10秒，仍保留“open未完成前收到问题”、真实应答／无Provider等所有业务断言，其余观察器仍2秒；不将这个工具时限误当产品功能RED。修复后的76项受影响Host／SDK／历史回归全通过。

### 流程证据的准确范围

M4主要动态UI切片各有真实前置RED／当时source hash；Host/history公开行为及真实SDK工具准入／人选回执／profile／旧ctx有实际RED→GREEN。权限hooks／参数／取消／close等另有后续真实回归，不能称这些逐guard本身均有前置RED；runtime/02的状态字样断言失败是fixture问题，不算产品RED。reader最初read／find／治理有实际前置RED及摘要；窄共享native budget／signal适配的专项边界测试是在适配后补充，不能称这些逐guard本身也有独立历史RED；displayed-identity08/09首次stdout保留，但未在当时另采hash。完整最终候选将独立固定，追加回归不伪造历史。以上范围交非作者按规范评估，不挪用M31限定例外、不泛称每条新增语句均已完整TDD。

## 当前状态

**M4本地开发与工程验证完成。** 最终固定候选`01d67d01168d309c9e0ce634fc22b0c092115365438a8bfb9803c2f3a22a71e2`覆盖408工程输入、47候选文档／变更及757作者证据，源路径删除0，原批准Demo与主方案／研究／旧成果不变。`npm run check`最终1088项：1085通过、0失败、3原有条件SKIP；会话边界／类型检查／生产构建通过，既有chunk提示保留。记录见[最终检查回执](../../../.local/fourbase-modules/m4/implementation/verify/final-check-receipt.json)，不是Git／CI结果。

全新非作者[完整独立复核](../../../.local/fourbase-modules/m4/implementation/independent-review/final-product-review.md)通过批准的本地工程及四原则范围，5项P2原独立反例全部关闭、剩余必须修复0；冻结输入及最后窄实测后回读无漂移。关键垂直切片的前置RED／追加边界验证范围已准确区分，未请求M4例外，不挪用M31例外或改原NOT_PROVED。

### 四原则专项最终结论

检查范围为本次34项变更工程输入及受影响消息／SDK／history／UI／M3/M31读口，依据实际代码、公开调用链、合成SDK/Provider、真实浏览器与上述独立反例，结论：**通过（M4本地工程范围）**。Host只管理准确供给／治理／权限／资源／取消与保存展示，Agent自选查、读、零读、比较和拒用；继续沿Pi1.4.0与公共生命周期。新增窄IPC及call-local ctx适配均有实际缺口与反例，不建平行Runtime／正文库／业务准入账／方法配额。正常提问不增加维护动作，可选精确加入与必要异常恢复已实测；必要保护不被误省。

root另目视真实产品的历史抽屉与快捷加入截图，界面关键行为与批准Demo相符；沿原产品壳呈现，不宣称逐像素一致。隔离合成UI／Host／Provider及复核浏览器均已关闭，故障原字节／mtime与证据保留；未切换用户产品运行服务。

真实外部Provider／专业与经营收益、真实soffice条件场景、Git／CI、安装／运行采用、MacBook和用户产品验收未由本次替代。M5–M8未推进；后续按各模块spec／UI确认流程。最终只收尾本记录和父级进度，源码／测试／规则／批准合同不改；差额及最终交付回读见`.local/fourbase-modules/m4/implementation/facts-closeout.json`与`delivery-manifest.json`。
