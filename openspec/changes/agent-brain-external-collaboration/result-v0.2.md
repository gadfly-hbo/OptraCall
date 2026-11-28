# 发单准备与验证记录

v0.2 · 2026-11-28 · PM Agent：Codex · **准备更新完成，待用户整体确认；未发单或实施产品**

## 本轮目标与最新基线

用户要求在此前新功能合并后，先更新到最新main，再更新UI Demo、spec、任务清单和Issue草稿。已fetch并读回远端main `74030911ade7a9e06ad1a0213d1fcb93ecbba6dd`，合并提交 `a1942074e89cd59b8acc414dd6174ec3b288b741` 已将它整合进原准备分支，无冲突/未改写历史。收尾再次ls-remote仍同SHA。已读最新AGENTS、工程规范v1.17和统一会话说明。

新主线包括：699e425目标管理修正 #150；85ab239 Decision Case日常工作台 #151；1fd351f冻结UI对齐 #152；7403091 Demo实际阅读与工程门禁 #153。整合带入主线已有代码；本轮作者相对该main只修改准备目录，产品/依赖/锁文件无差异。

## 四份准备件

- [spec](spec.md) v0.2：新日常入口、Case四页签/全部项目/原Task；人的待回应、ProjectWork等待、目标版本/实绩/发布与外派分开。准确返回origin、原owner指纹/非用户原话、空闲可选暂停均明列待开发，未冒充main已具备。
- [UI Demo](ui-demo.html)：已按180px日常导航、单一Decision Case、Case总览/全部项目、Case四页签/事项及原项目任务表重排，非仅换版本文字。见 [演示说明](demo-guide.md)、[实际视觉/DOM-CSS阅读与生产映射](ui-mapping.md)。
- [任务清单](tasks.md)：R01–R05准备完成，R06确认/R07发单仍待执行；E01–E08工程与真实采用均未实施。包含UI编码前实际阅读/映射回执、切片/返工同视口对照、三冻结基准逐项复核及PM开PR前真实产品截图展示/明确确认。
- [Issue草稿](issue-draft.md)：基线/范围/三个设计基准与相同交付门禁已同步，确认SHA及最终用户决定留显式占位，未发布/不可领取。

源代码接缝见 [main-alignment](main-alignment.md) MA01–MA10、[reuse-audit](reuse-audit.md) v0.2追加；用户D01–D04沿用，新增默认及本轮变更见 [decisions](decisions.md)。[准备覆盖表](preparation-matrix.md)与[非作者实际逐项矩阵](evidence/v0.2/independent/matrix.md)分别记录预期和观察结论。

## 固定确认件身份

| 文件 | SHA-256 |
| --- | --- |
| spec.md | `c00dfdf456ecb357e387dc8065b1488beaa24fa3a42ebee96ab1eb86cec57c0d` |
| tasks.md | `f683c32d24e25cf649faff992b270ad64676a002c4a47fc208c4080d19facec7` |
| ui-demo.html（157011字节） | `59b9bbdb70414a8909e0c4b9ea2386b68f56d8638d5c1c39ebff5c4922b6bb17` |

规格/清单/Issue/决策/结果由PM整合；UI、notes/mapping由brain_ui_demo创作，源码对齐由brain_spec_architecture准备。完整输入清单及复核输出见 [独立报告入口](preparation-review.md)。

## 实际检查、发现与保全

[证据索引](evidence/v0.2/README.md)给出命令/原图/JSON及原.local映射，合成独立原图全组与必要原始结果已随包持久保全。套件有重叠，不相加成独立总数。

| 检查 | 实际身份/结果 | 覆盖及限制 |
| --- | --- | --- |
| PM完整原型复验 | 最终59b9：30项PASS，0JS错/0外网；check-v02.mjs退出0 | 原Task/准确Case返回、事项/范围/三层草稿/焦点、授权取消与mapping缩小、交付版本/逐件保全、原请求/项目等待不变、空闲暂停、窄屏菜单及暗色root/body。 |
| 独立正常/资源/异常 | 6946bc：UI14项、资源7项通过；异常44项PASS及1项原焦点脚本FAIL，等待实际焦点的delta复测通过 | 90组视口主题路由原图、11异常/六用途/事项/来源、费用快照/计额/接入。原聚合FAIL不改写；没有真实后台或模型。 |
| 独立背景增量 | 最终59b9：4短页×亮暗×三宽度24组PASS，0JS错/0外网 | 独立核6946原件/59b9摘要、inline JS与style外DOM相同，唯一新增root canvas CSS。此前业务证据按无变化依据核定适用，不冒称59b9全量重跑。 |
| 作者分批原型检查 | 6946前段55项通过，整段runner因脚本误点隐藏modal而FAIL；修正后段196项、权限14项通过；59b9短页24组通过 | 精确批次/原失败见demo-notes和author-final-summary；前f2c的241项仅是历史候选结果。 |
| 格式/引用/身份与范围 | 复核输出保全后由PM执行，输出见 [final-validation.json](evidence/v0.2/root/final-validation.json) | UTF-8/JSON、引用、差异、输入摘要、实际暂存范围；不替代原型行为或真实产品验收。 |

本轮发现并处理：返回Case/来源时二次render丢焦点已在原型修复；原项目Task行也有只读摘要，合同原先过窄，现统一允许同一原Task行而不扩首页；授权/回看补1工作片段/最多3次API触发含修订/24h及费用未知/无策略不就绪；暗色短页root与body接缝以最小CSS修复。

6946交互候选原HTML已原样保全，最终59b9只追加背景CSS；inline JS SHA为 `30cd0c08d1199dbc999b2f4cf244baea090a7f74d77f87d258fdd455d239b473`，style外DOM/脚本字节相同，作者与非作者分别核验。PM已实际查看main历史产品参考图、新版Case骨架及最终暗色总览原图；独立报告另列实际查看范围。

根脚本的隐藏sidebar/异步渲染读值、作者resource按钮不打开modal却点关闭/修正未命中、独立宽泛文字断言/静态timer重开/焦点rAF等失败均保留原图/原结果，核明后只修检查方式；不把它们伪作产品RED，不覆盖原FAIL。真正文档/UI差异与背景缺陷则分别修齐并重验。

## 历史与未执行范围

旧v0.1全包仍在 `e456aa58a069f95340609b4a04d8fd6b35093f19`，原 [独立复核](preparation-review-v0.1.md)字节不变；770fcd HTML及其47/25/70项只证明当时准备范围，不外推本版。原4项P2、原a37d缺陷与脚本失败/文件协议受限记录均保留。官方接口依据仍是2026-11-27 [研究记录](integration-research.md)，本轮未新增实号证明。

本次只改设计/合成原型，**没有本功能的真实产品实现可做PR前截图确认**，由独立复核核定本准备轮不适用；后续E07仍必须实际展示真实产品截图并取得用户明确确认，不可用Demo代替。真实Host/Pi/MCP/TLS/OAuth/供应商闭环、产品/真实附件字节、PR/main CI、实号WorkBuddy联合调用、专业/经营效果、部署及双端服务均NOT_RUN。file协议本轮未重试，上轮被策略阻止的原记录保留，未修改策略；本轮使用内部HTTP，不把localhost当用户托管预览。

用户整体确认更新后的spec/清单/Demo后，按工程规范推送确认版、回读完整SHA、替换Issue占位再发布/读回。当前无正式Issue/PR，未提前实施；用户若提供独立方案，先对比/取舍/整合并再次确认。
