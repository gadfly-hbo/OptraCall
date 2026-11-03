# MiniMax / MiMo 重测非作者复核原文

作者说明：以下为非作者复核者的冻结报告全文，未改写其判定。原报告SHA256 `0737234f1f71ff8b94ebb2249a119f6bc4254695d08d91d05d16ff523ac27e59`；本文件仅增加本段来源说明，不将作者记录当独立复核。

---

# Four-profile real retest: independent adjudication

**4/4 正常完成；核心版本与发布日期 2/4 正确；按预先冻结的全部题目要求，FULL_ANSWER_PASS 为 0/4。** MiniMax 两项获得正确的主要版本/日期与可核对官方来源，但均严重超过 150 字；MiMo Pro 把旧版本称最新；MiMo Flash 诚实报告日期不足且原正文亦超过限制。不能用 completed 或真实搜索发生替代完整题目通过。

## 固定条件和先验

提交 `2a6b34fb2cfb6be0530920d02a02e6f1784640dd`；作者新根 `product-live-retest/run-2026-11-03T23-30-35-735Z`。只测既有 MiniMax M3、M3.1 Flash、MiMo V2.6 Pro/Flash，未测试 DeepSeek。

独立标准 `acceptance-v1.md` 于 UTC23:27:20 先冻结，SHA-256 `a5ab89ed9564d2944a27b80e29e34c5b36ff44b9dc47a349ac258746b2f4bba9`；官方参考在看到模型结果前取得且原14文件manifest未变化。独立 Python [Downloads](https://www.python.org/downloads/) 及其直接链接的[正式发行页](https://www.python.org/downloads/release/python-3152/) 均HTTP200，确认截至北京时间2026-11-04为 **3.15.2 / 2026-10-25**。参考答案没有传给产品模型。

四次实际开始均UTC23:30:35，各300秒截止，无超时；正文原提示保持同一问题。新project/resources/native分开；原配置/端点不改，本地工具清空为本次验证措施，不代表产品默认工具政策。最初未安装tsx导致的preload失败为0 Provider请求的setup失败，单列保留，既不算本次模型失败，也不消失。

## 逐项结论

| profile | 正常完成耗时 | 核心内容 | 模型原文码点 / 产品投影码点 | 主判定 |
| --- | ---: | --- | ---: | --- |
| minimax-m3 | 20.256秒 | 3.15.2、2026-10-25正确；有效官方别名/博客与本轮来源可对应 | 518 / 2416 | FORMAT_FAIL |
| minimax-m31-flash | 44.711秒 | 3.15.2、2026-10-25正确；正文latest官方URL精确命中本轮来源 | 665 / 1587 | FORMAT_FAIL |
| mimo-v26-pro | 11.642秒 | 将3.15.0、2026-10-09认作最新，错误；正文固定版本URL未在本轮结构化来源中 | 150 / 576 | CONTENT_FAIL + PROVENANCE_NOT_PROVED |
| mimo-v26-flash | 35.885秒 | 3.15.2正确；明确无法确认其发布日期。10月9日只指3.15.0，未冒充3.15.2日期 | 185 / 524 | HONEST_INSUFFICIENT + FORMAT_FAIL |

字数按冻结口径使用Unicode码点，保留URL、空白和Markdown；`optracallNativeSearch.originalText` 是模型原正文，Host追加来源清单另计。去掉Markdown标记后，两项MiniMax仍为502/637，远超150，故不是仅由来源清单或标记造成。MiMo Pro原正文刚好150，但主要内容错误；不能因格式合规改为通过。产品投影四项均因正文和机械来源清单而超过150，原文和Host附加责任分开，不删清单凑通过。

M3附加说明称官方博客“同日发布”，但[原博客](https://blog.python.org/2026/10/python-3152-31410-31318-31216-31118/)显示2026-10-26，晚于发行日25日；主要版本/日期正确不抹去这个附带事实错误。M3.1明确写26日，没有该差错。

MiMo Pro所引[3.15.0发行页](https://www.python.org/downloads/release/python-3150/)HTTP200，但页面明确已被3.15.2替代。其“本次未见更新”不能支持“截至当前最新为3.15.0”的确定断言。MiMo Flash的不足说明保留为诚实响应，仍未完成版本和同版发布日期这两个字段。

## 来源对应与独立读回

27 / 22 / 3 / 3 为各项完整结构化sources数，去重47。作者不带凭据逐条curl集合恰好覆盖47个URL：46×200、1×403（知乎）；403不隐藏也不认作假链接。正文额外4个官方URL读回均200，明确属于正文新增URL，不能回填成Provider原始来源。

本复核另亲自以无凭据curl读回5个关键官方URL，原HTML、headers、HTTP/最终URL、UTC时间、SHA和可读正文全留于 `reviewer-source-readback/`。`/downloads/latest/python3.15`、其尾斜杠版本与`/downloads/latest/`实际均重定向到冻结的`/downloads/release/python-3152/`，最终正文SHA也相同，支持版本和同版日期。

- M3：博客URL精确命中本轮结构化来源；latest尾斜杠差异有独立重定向等价证据。固定release URL虽不在原URL精确集合，但可与实际latest来源通过已记录redirect对应；保留“非原始URL”身份，不伪造检索来源。
- M3.1：正文latest无尾斜杠URL精确命中本轮结构化来源且支持两个主要字段。其裸Downloads另属额外正文引用，不伪造为精确来源命中。
- MiMo Pro：正文canonical 3.15.0 URL非本轮结构化来源；实际官方讨论来源证明旧版发布，不能证明当前最新。独立URL可达不补造本轮来源链。
- MiMo Flash：正文latest/精确命中本轮来源、独立redirect有效；但模型没有给出该版日期。读回页面能找到日期不允许替模型补答案。

## 生命周期、保全与错误

实际HTTP为2 / 3 / 1 / 1次，全部200；MiniMax真实pause续接分别1 / 2次，仍各只有1个业务用户消息，不是失败重放。四项result、snapshot、native run.started/settled及事件requestId一致，均completed，顶层error/closeError为0；原生assistant内容与receipt逐值持久保存，snapshot另加native身份字段，非内容差异。各自retry capability=false、local tool attempted/blocked=0。

**原生搜索内部并非零错误。** MiniMax M3与M3.1回执分别保留10和26个`web_search_tool_result_error`（1033/system error）；operation最终完成与这些部分搜索失败是不同事实。MiMo两项专用search usage均为tool_usage=3/page_usage=3；MiniMax没有专用计数，不能以HTTP数冒充搜索次数或账单。

5个产品源码在开始/结束/本复核时摘要一致，实际native model/api/provider身份与四个脱敏configuration tuple相符，HTTP origin/path保持原线路。原settings/auth字节保全为作者source-comparison证据，本复核没有读取凭据或原文件复算；作者初扫39文件、5变体、0key命中为其扫描收据，不冒充本复核独立密钥检测。费用/供应商结算仍UNKNOWN。

## 证据与范围

`adjudication-v1.json`保留逐模型字段、URL映射、原文/投影字数、原文件摘要与判定；`result-extraction-v1.json`保存只读抽取；`native-boundary-readback-v1.json`保存原生记录读回（其整对象false仅是snapshot增nativeSessionId/nativeEntryId，正文和receipt相等）；原模型文件不改。辅助全新只读复核独立核对MiniMax两项，结论与主复核一致，详见 `aux-minimax/independent-review.md`。

本复核没有发模型请求、读取凭据、改产品/测试/作者文档、重复workflow、换模型、自动补跑或切换服务。所有旧失败、此前取消/NOT_PROVED、setup失败和本次完整原结果继续保留。成绩只适用于这四个固定配置的一次公开问题，不扩大为完整模型能力、专业或用户Product Acceptance。
