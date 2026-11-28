# v0.2 准备检查证据

全部截图、业务字段与API/MCP回执都是合成静态原型，未调用真实账号、模型或部署。main 7403091 的既有产品参考图已在主线原目录保留，不能当成本功能的产品实现图。

最终HTML为59b9bb；交互候选为6946bc。`history/ui-demo-6946bc.html`是原样历史输入；作者和非作者的identity记录确认最终仅追加root canvas CSS，inline JS和style外DOM字节相同。旧交互证据经明确差异核对适用，受影响视觉在最终hash重验；没有宣称59b9全量重跑所有旧套件。

| 位置 | 身份、实际结果与范围 |
| --- | --- |
| `root/results.json`、`root/check-v02.mjs` | 最终59b9实际HTTP复验30项PASS，0JS错/0外部请求；原Task/Case/草稿/范围/焦点/原待回应/项目等待、授权/映射限制/保全/暂停/窄屏菜单/暗色背景。`results-6946bc.json`及对应旧脚本保留29项历史结果。 |
| `root/failure-*` | 三次根脚本失败原图/JSON/脚本：窄屏误点隐藏sidebar、在异步视图渲染前读取Case原报告/首页控件。改正确入口和等待真实可见状态后通过；不是产品源码修复或安全证明。 |
| `independent/final-ui/` | 6946bc独立正常检查14项、15路由×亮暗×3宽度90张原图及额外状态图。 |
| `independent/final-resource/` | 6946bc资源/接入/费用快照7项，含普通与补充触发计额。 |
| `independent/final-scenarios/`、`independent/focus-delta.json` | 6946bc异常/六用途/事项草稿/返回44项PASS，1项原聚合焦点断言在rAF前读取保留为FAIL；焦点delta等待实际恢复后通过。不是把原聚合写成全PASS。 |
| `independent/final-background/` | 最终59b9，4短页面×明暗×3宽度24组原图/色值/无溢出检查通过，JS/DOM无变化独立证明。 |
| `independent/final-overview/` | 6946bc各视口/主题页面总览，供复核者实际查看；不是产品截图。 |
| `independent/receipt.json`、`independent/screens/` | 初轮发现及选定原图：原项目Task行摘要合同不一致、资源费用摘要遗漏；另有宽泛文字断言/静态计时/焦点断言的脚本失败，按报告分开。旧全组图仍在原.local，本目录不把它们当最终证明。 |
| `author/author-final-summary.json`、`author/results-v02-final-continuation.json`、`author/permissions-final-results.json` | 6946bc作者分段：前55项通过，整段因脚本误点不打开modal的资源按钮而FAIL；修正后段196项及权限14项通过。原FAIL、修正遗漏再失败记录原样保留，不相加成独立总数。 |
| `author/shortpage-final-results.json`、`author/shortpage-final-*.png` | 最终59b9作者短页背景增量24视图；未重复业务。 |
| `author/`其余脚本/JSON/旧HTML及选定失败/资源原图 | 原始身份、实际DOM/CSS阅读与来源、分批结果和失败。保全全部检查脚本/JSON与当前短页/关键授权/失败图；未重复导出所有pilot/旧候选普通图片，完整原始工作目录仍按下段保留。 |

原始`.local/agent-brain-main-update/{root,ui,independent}/`分别映射到本目录的`{root,author,independent}/`。JSON和报告保留原路径字节，本文提供位置映射；最终独立证据原图已全组保全，作者重合普通图以固定HTML/脚本/JSON及独立图交叉追溯。不修改原图、原FAIL或原结果以迁就新版本。

复现从仓库根执行保全的`.mjs`，需已有Playwright及`/usr/bin/chromium`、内部静态HTTP服务4317和对应原型输入；脚本只写指定.local合成目录。它们是一次性准备证据，不是新增产品依赖或永久产品测试。内部localhost不是用户托管预览；file协议本轮未重试、真实产品/模型/标准MCP/TLS/OAuth/实号/产物字节均未验证。

最终独立原报告、逐项矩阵和输入清单在本目录`independent/report.md`、`matrix.md`、`input-manifest.json`原样保全。最终PM格式/引用/输入身份检查输出为`root/final-validation.json`。这些复核/验证输出不属于被作者创作的产品设计输入；无需通过修改候选内容来让输出通过。
