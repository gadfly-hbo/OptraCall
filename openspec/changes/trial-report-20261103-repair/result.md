# 试用报告修复结果

状态：UI Demo已获用户明确回复“通过，按此继续”；完整本地检查通过，非作者技术复核收尾及Git／CI交付、报告归档待完成。先审Demo规则在实施期间补充，既有候选及验证证据保留，先暂停并展示Demo，获上述明确审核后继续。UI审核、技术复核、产品验收和运行采用分别记录。验收依据见[规格](spec.md)。

- 基线：`7109a6e63660a900b557300a73765f852c2cbd00`；分支`Test-And-Repair`。
- 固定输入：MacBook待修复PDF的路径、字节及SHA见规格；原报告与截图不进入公开仓库。
- 初始工作区：仅本会话两份规范文档改动，保留并纳入本轮。
- 原报告身份经SSH及本机副本重核一致，归档目标不存在；回执为`.local/trial-repair-20261103/report-identity.json`。

## 实现与验收映射

| 标识 | 实现与现有验证 | 状态 |
| --- | --- | --- |
| TR01 | 项目上传／010到020显式复制支持PDF、Word、网页、PPT、Excel、ODF及原文本；共享前端／Host格式与50 MiB定义，只有项目上传路由放大base64请求体。保留原元数据、布局、原字节、同名不覆盖、路径／归档边界及原文本UTF-8。保存报告／反馈及企业资料限额不变。目标20项回归通过，包括完整50 MiB真实HTTP上传／下载。 | 技术验证通过，UI审核通过，待Git／CI交付 |
| TR02 | 任务步骤直接打开原需求工作台，附带需求时定位既有实例；返回恢复原项目／任务，草稿与Case选择保持。送入仍经原显式目标选择，不自动新建需求／任务或派发模型。 | 浏览器目标验证通过 |
| TR03 | 平衡密度的任务标题与四步导航使用原主题变量和可访问原生按钮；实际状态及`aria-current`只投影当前对话。背景详情默认收起，输入在主要位置，核算在其后；自动面板用原生details默认收起，内容保持挂载，折叠不停止处理。1440／768／320及浅深主题已有通过证据。 | 技术8组浏览器验证通过；用户UI Demo审核APPROVED |
| TR04 | 原报告保持在MacBook待修复；UI审核通过并完成适用检查、独立复核及实际head CI后重核并移动，保留内容且不覆盖目标。 | 待独立复核收尾／Git及CI后执行 |

公共Interface保持v3；项目任务与需求owner/profile、统一会话接入及现有Runtime不变，无数据库／持久结构或业务数据迁移。导航表示用户工作区入口，不为Agent指定方法或执行步骤。上传与导航本身无模型请求；浏览器只明确发送一次本机合成Provider请求来核对已有回复后的状态投影。

## 因果复现与保留的失败

- `upload/red.log`：4项失败，分别命中原PDF／TSV格式拒绝、10 MiB文件限制和14 MiB HTTP请求体限制；最小修复后`upload/final-green.log`为20 PASS／0 FAIL。新共享文件名解析的仅扩展名差异另保留`upload/dot-name-red.log`，已修正并回归。
- `browser-red.log`及`browser/red/`：真实任务页缺少需求入口／步骤导航、自动面板默认展开；没有模型请求。
- 首轮浏览器GREEN受Playwright内存文件50 MB限制中断，属于测试fixture失败；改用磁盘合成文件，保留精确50 MiB及逐字节断言，未降低验收。原日志`browser-green-1.log`及对应failure截图保留。
- 首轮完整检查在`full-check-import-boundary-fail.log`拒绝新浏览器运行器的本机依赖动态加载；未放宽边界或白名单，将本机编排器移入忽略的`.local/trial-repair-20261103/run-browser.mjs`，永久浏览器回归脚本保留在`tests/`。边界纠正检查通过。
- 目视复核发现新增折叠摘要将原有`undefined === undefined`判断误显为“状态待确认”。先保存`browser-automatic-empty-red.log`与目标截图，再要求存在实际链记录才标记不确定；不改写真实UNKNOWN。

## 验证、独立复核与交付

原始证据均在本机`.local/trial-repair-20261103/`，未把原始报告或截图纳入公开仓库。

- Node v25.9.0；按锁文件`npm ci --ignore-scripts`成功。
- 目标上传回归20 PASS／0 FAIL；类型检查、差异空白检查通过。
- 浏览器早期7组GREEN有实际PDF和50 MiB FileReader上传／下载、超限无HTTP、键盘返回／草稿保全、任务隔离、各尺寸主题及合成SDK回复／重载无重放；最新`browser-green-empty-state-fixed.log`及`browser/green-1793700228664/`为完整8组GREEN，页面错误0、外部请求0、显式合成SDK请求1次；空记录显示“未启用”，原失败保留。
- `full-check-2.log`结束为908项：904 PASS／1 FAIL／3 SKIP，唯一失败为HELP-02检出Markdown手册与应用内同源帮助不同步；未进入build。已同步`help-content.ts`并通过`manualMarkdown`重生成手册，`help-manual-green.log`为2 PASS／0 FAIL；未修改断言。最终`full-check-3.log` exit 0：908项中905 PASS／0 FAIL／3适用条件SKIP，会话边界、测试、类型检查与构建通过。保留现有大于500 kB构建块提示，不作无关拆包。CI尚未运行。
- `npm audit --audit-level=high` exit 0；0 high／critical，保留SDK与其minimatch依赖的2项moderate，不执行无关依赖升级。
- Host／Agent职责与SDK复用作者检查：本次仅传输限额、正常材料保存与UI入口／投影，未增加Agent推理循环、计算、方法选择或Runtime；最终结论待非作者复核。
- 未运行真实Provider／真实业务资料实验，未改任何设备运行服务或MacBook源码，未宣称专业质量／用户产品验收。既有FAIL／UNKNOWN保持原记录。

完整检查、非作者复核、Git／CI和报告移动的最终结果将在完成后追加；不以本地检查替代CI或产品验收。

## UI Demo审核点

- 最新用户规则已补入工程规范第3节：简单修复可免新spec；复杂改动保留spec；较明显UI变更先Demo审核，简单文案／按钮调整可免Demo。本轮布局／导航适用该审核，曾保持PENDING；用户在看到Demo和预览后明确回复“通过，按此继续”，现为APPROVED。
- 可交互Demo在本机独立4196端口、独立`.local/trial-repair-20261103/ui-demo-*/`数据根运行，合成资料／合成Provider，启动时模型请求0。访问URL及原配置身份见本机`ui-demo-current.json`；界面截图见`browser/green-1793700228664/`。不接入正式配置、项目或服务。
- App自动打开浏览器被本机Work设置禁用，已提供可手动打开的本机链接及直接可看的桌面预览，不修改该设置。
- 用户UI审核APPROVED；技术候选的独立检查无源码修复发现，最终身份／规范差异收尾中。本轮源码和规范尚未提交／推送，没有PR／托管CI／main合并，没有报告归档或任何设备运行采用；继续完成适用交付后才归档报告。

需求显式送入补充验证：原`browser-requirement-reliability.js`导出断言经本次折叠布局的真实展开操作适配后，通过无隐式项目、零任务项目、目标项目内建任务和精确RAP 1.9.0／1.10.0送入；两个发布版本字节保留，模型请求0、外部请求0、页面错误0。原模块未改。fixture重复内容发布拒绝及旧断言直接读隐藏横幅的失败均保留，不写成未经适配的原脚本通过；最终证据`browser-requirement-reliability-3.log`及`browser/requirement-reliability-1793700684242/`。

非作者技术复核已独立运行20项上传／Store回归、19项浏览器及10项额外上传保护检查、2项隔离帮助检查，均通过，无需源码修复发现；最终完整候选身份／规范差异收尾中。首轮自写浏览器runner的Response.ok调用错误、错误测试路径及默认Vite配置缓存可能写入node_modules/.vite-temp的执行范围偏差均保留。帮助检查已改用configFile:false及显式隔离cacheDir复验；不宣称此前每一步缓存写入均满足隔离范围。证据见本机independent-review/review.md及该目录日志。

## 用户后续确认与返回点

用户随后指出自动核算配置可能必须前置。已按实际capabilities、admit及回归合同确认：首次普通分析前启用，旧未托管会话不能事后升级或追溯已有报告；已有报告沿用手动“核算关键结论”。首版UI技术复核保留，但原布局缺少醒目前置设置入口，补充Demo位于本机4197（可选配置行在输入框上方）；目前仅演示状态，待审核后正式接入。本轮报告继续留待修复，暂无Git／CI交付或归档。

交付前`origin/main`刚前进2提交至351d835（商圈MCP及其归档），与本候选有公共文件重叠；旧candidate-004／独立复核及905 PASS只对应7109a6e，不代表整合新main已验证。先以本地提交固定WIP，随后保留双方意图整合、重新验证。
