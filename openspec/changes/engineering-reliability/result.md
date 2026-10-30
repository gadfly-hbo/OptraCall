# 工程可靠性收尾结果

状态：本地检查与最终非作者复核完成；Git/CI及main合并身份见[PR #11](https://github.com/gadfly-hbo/OptraCall/pull/11)。基线origin/main `3f4603e`，分支 `codex/engineering-reliability`。本轮未切换运行服务。

用户已确认范围见[规格](spec.md)。验证使用隔离合成资料，不修改现有运行服务或用户资料，不调用真实模型。

本地证据保存在 `.local/engineering-reliability/`，不提交凭据、业务资料或完整原生日志到公开仓库。

## 已实现

- ER01/02：Agent结果、最终SSE、项目lastRun/GET及需求生成失败返回同源安全诊断；错误分类/阶段/固定文案与原生retry计数可读，取消竞争不带失败诊断。旧运行字段缺失兼容，新字段不改schemaVersion或会话身份。
- ER03–05：task/requirement SSE默认15秒comment心跳；任务观察45秒无任何收包仅中止观察，随后按同owner/request GET与最多三次退避重连。前端显示观察恢复/未知；不自动POST、不停止后台任务、不打开新会话或换模型，Abort/迟到结果/草稿有对应回归。
- ER06–09：在现有Case关联弹窗显式勾选“保存并采用此版本”，默认仍动态引用。稳定读取当前文件，复制到同项目`060_reports/adopted-<operationId>.<ext>`，既有copy/from及回执记录来源/摘要/时间/显式关联任务。未知来源不推断作者；保存版本不等于内容正确、业务批准或效果已验证。
- 采用复用现有`artifact_save`操作及其JSON result，无SQLite schema/表列/user_version变更。重复完成请求只读回执，prepared未知变为待人工核对，保留副本现场，不自动继续复制。普通引用不能刷新已采用摘要；副本外部更改/缺失显示changed/missing。带expectedSha256下载核对实际字节，不符409，普通旧下载兼容。
- ER10/11：新定向回归覆盖旧ProjectStore/native读回字节不变、既有Case引用、链接/大小/归档/幂等边界、RAP+SAP+Case固定版本、失败后显式继续和重启，无用户资料迁移或真实模型调用。

## 初次检查与保留失败

首轮完整`npm run check`408/408，含build；当时之后又补采用引用完整性回归，因此不把首轮PASS当最终候选结果。分项探针与全检查重叠，不相加计数。

随后完整检查409/409。实际Playwright隔离浏览器完成显式采用/带hash下载/旧引用/归档恢复；安全认证失败可在刷新后读回，模拟SSE断开后GET恢复运行状态，未发送草稿保留，最后显式停止同请求。一次定位器匹配两个合法状态提示、一次固定停止toast预期不适用，原失败保留并从原任务只读续验，没有重发模型；该长合成请求发生2次Pi原生retry，原生只1条started/1条settled，不能把3次Provider HTTP误写成Host重放。

非作者Spec复核发现ER01中断窗口：native终态已落但Host仍为running时，旧历史读取丢失diagnostic。已补同session/request安全解析、fork父记录/迟到终态排除、合法settled及诊断一致性检查，Host只凭匹配证据校正。永久纯读取及真实HTTP模拟落盘窗口回归通过，旧失败探针保留；该修改后的最终完整检查与复核另记。

非作者Standards增量复核再检出旧runtime诊断可能残留到已证成功终态。校正改为按原生终态重建诊断，缺失/矛盾时清除旧值，snapshot投影亦按outcome过滤。独立HTTP RED与永久HTTP回归均保留；目标历史/恢复/联合19项通过，完整候选继续最终检查。

完整检查至v4为420/420，随后Spec补验已保存completed记录的同类矛盾字段；ProjectStore统一读取亦按已知终态过滤可选诊断，不回写旧metadata。永久HTTP测试覆盖“校正中清旧值”和“旧文件读取过滤且字节不变”两个窗口，v5完整检查/增量复核另记。

各子任务保存RED→GREEN日志。首个Host心跳测试有实例响应定位错误（测试fixture失败，非产品RED），修正后保存真正无心跳/无诊断RED。一次新诊断测试原将全部native流都当新诊断检查，后明确仅新诊断不得复制Provider载荷；全流凭据脱敏检查保留。compact测试首轮把SDK两段摘要误判为Host重发，核对原生实现后按实际HTTP请求计数修正，原失败保留。观察静默RED挂起只终止本次隔离测试进程，不触碰用户服务。

历史两次M31 terminated底层原因仍UNKNOWN；本次仅验证诊断/恢复契约，不以合成通过宣称已定位供应商或网络原因。Extension正确性方案为[待确认建议](../../../docs/extension-correctness-proposal.md)，没有实施专业校验或新分析循环。

## 最终验证与Git交付

- v5代码候选 `46e783d17c472803f90125b03127461c5cd00227` / tree `aba4c9dbf67f50b026d50e447ce6f990c91b3c1d`：`npm run check` **420/420**，无fail/cancel/skip，含边界检查/类型/构建；`npm audit --audit-level=high`为0项。恢复窗口修复后的完整结果不能被旧408/409/419替代。
- Standards与Spec均对34文件逐一核对及增量复验，最终0项未解决发现。独立探针与全量测试重叠，不相加；旧P2及失败现场保留。固定源码及逐文件摘要见本地candidate-manifest，后续记录文档不改被测源码。
- 浏览器在隔离合成Host/Provider实际点击Case采用、摘要下载、旧引用/归档恢复、安全失败刷新和GET观察恢复；两个定位器预期错误从原请求续验，未重发。本轮未调用真实模型；历史真实全链报告中的计算/解释/范围问题仍为独立问题，不以本次工程通过关闭。
- 保全对比覆盖现有项目工作区、项目/任务/native、RAP及SAP文件共257份，根配置JSON、凭据字节与逻辑SQLite均一致；凭据只输出相等boolean。公开暂存差异对当前3个配置凭据精确值检查为0匹配，不能扩大为通用安全/外传审计。
- 提交前多次fetch，origin/main仍为`3f4603e`。代码提交[首轮PR Check](https://github.com/gadfly-hbo/OptraCall/actions/runs/41045317670)成功。补充本记录后，最终head检查、合并SHA及main push Check以[PR #11](https://github.com/gadfly-hbo/OptraCall/pull/11)和GitHub实际记录为准，工程交付回执另保存在本地。
- 推送曾遇到本机旧Git凭据助手路径失效，使用单次命令覆盖调用已安装gh完成推送，未改全局配置或导出token。

Mac mini现有运行服务保留原实例/版本，primary checkout未为本轮切换；Git/CI合并与运行采用、真实模型复验、用户产品验收分别报告。Extension建议待用户确认后另行实施，MacBook未操作。
