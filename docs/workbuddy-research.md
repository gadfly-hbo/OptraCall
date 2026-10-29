# WorkBuddy 调研与 OptraCall 取舍

2026-10-28 · 第 2 项研究 · 实机版本 v5.9.3

## 方法与证据

主要证据为本机 WorkBuddy 的 computer-use 只读探查，辅以腾讯官方文档。没有发送任务、读取已有业务对话、保存模型、测试真实连接、安装扩展或修改既有配置。空模型表单已取消；结束时回到新建任务首页、侧栏展开、右侧面板关闭。

截图仅保存在被忽略的 `.local/first-chat-mvp/step-2/`，不进入公开仓库；截图可能包含本机账户显示信息。未将 renderer URL 的查询参数、账户快照或种子令牌写入报告。一次导航因 accessibility 索引重排短暂进入助理空页，重新读取索引后返回；没有提交内容。

| 编号 | 实机观察 | 本地截图 | 范围 |
| --- | --- | --- | --- |
| W01 | 首页侧栏约 280px；主区宽留白，输入卡约 800px；版本号 v5.9.3 | `workbuddy-home.png` | 1440×900 窗口截图下的近似测量，不是产品 token |
| W02 | 主区有办公/开发/设计切换、能力快捷入口、大输入框、模型选择和底部工作空间/权限入口 | `workbuddy-home.png` | 只观察，不触发任务或改权限 |
| W03 | 模型菜单分为预设选项与自定义模型入口；添加表单提供供应商、API Key、连接测试、模型名 | `workbuddy-model-settings.png` | 空表单；没有输入密钥、测试或保存 |
| W04 | 设置为独立窗口，左侧搜索及分组导航、右侧当前设置内容 | `workbuddy-settings.png` | 模型页未有自定义项，不读取本地配置文件 |
| W05 | 外观页可见主题选项；快捷键页列发送、换行、新对话、停止和面板切换 | `workbuddy-appearance.png`、`workbuddy-shortcuts.png` | 外观截图仍有加载态；未切主题或改快捷键 |
| W06 | 关于页再次确认当前版本 v5.9.3 | `workbuddy-about.png` | 未检查更新或启动升级 |
| W07 | 右侧空工作区有标签页、地址栏与前进/后退等浏览器操作；展开后聊天主区同步收窄 | `workbuddy-right-panel.png` | 没有打开网址或读取文件；不是产物生成验收 |
| W08 | 专家/技能/连接器共用能力中心，存在分类、搜索和目录卡片 | `workbuddy-capabilities.png` | 只看公共目录，不进入私人资产或安装能力 |
| W09 | 收起侧栏后，输入区保持限宽并重新居中 | `workbuddy-collapsed.png` | 已恢复展开；未做系统缩放或任意窗口尺寸测试 |

## 官方资料补充

以下为文档描述，不冒充已实测的运行效果。外部页面可能更新，适用日期为本次读取日。

| 主题 | 简要结论 | 官方来源 |
| --- | --- | --- |
| 定位 | 桌面 Agent 办公工作台，能力范围大于本次最小对话产品 | [产品介绍](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Product-Guide) |
| 导航 | 左栏组织版本/应用、功能、任务/空间和账户入口 | [侧栏](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Sidebar) |
| 任务入口 | 输入后直接进入对话，任务与工作空间关联 | [新建任务](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Task-Bar) |
| 任务组织 | 提供近期任务、空间、搜索、筛选及运行状态 | [任务管理](https://www.workbuddy.cn/docs/workbuddy/Task-Management) |
| 对话 | 有消息队列与输入区停止操作，中断后可继续原会话 | [任务对话](https://www.workbuddy.cn/docs/workbuddy/Conversation) |
| 结果 | 产物、网页、文件和变更可组织和预览 | [结果查看](https://www.workbuddy.cn/docs/workbuddy/Results) |
| 右侧工作区 | 用标签页承载文件、产物、浏览器、终端等 | [右侧边栏](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Right-Sidebar) |
| 设置 | 设置窗口采用内部左导航和右内容，支持搜索 | [系统设置](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Setting) |
| 模型 | 支持可视化自定义模型，与会话内选择入口联动 | [模型配置](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model) |
| 权限 | 权限入口影响真实资源访问，不能只视为装饰开关 | [权限模式](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Permission-Modes) |
| 版本 | 本次读取日志顶部列 2026-10-27 的 5.9.3；与本机版本独立核实 | [更新日志](https://www.workbuddy.cn/docs/workbuddy/Changelog) |

## 设计推论与采用范围

采用稳定的左栏、限宽主画布、大输入区、就近发送/停止，以及明确独立的模型设置入口。OptraCall 首先让用户顺畅展开对话，不要求先填写分析流程。

浏览器 Demo 只保留会话与模型设置；暂缓工作空间、权限模式、专家市场、文件/产物右栏、定时任务和多消息队列。设置放在同一浏览器工作台中，不复制桌面多窗口机制。LLM 配置是 OptraCall 的已确认需求，不依赖 WorkBuddy 是否具备某个完全相同的选项。

首版同会话仅一条在途请求，忙时允许停止、保留草稿；这是本次取舍，不代表复刻 WorkBuddy 的消息队列。演示流式、取消和失败是 OptraCall 自己的交互样例，没有在 WorkBuddy 中发送任务验证这些运行结果。

## 未验证与限制

WorkBuddy 的真实对话、消息队列、工具执行、权限执行、模型连接及保存生效均未实测；已有会话、资料库、定时任务内容未读取。字体与颜色只作视觉观察，没有提取程序内部实现。官方部分图片读取超时，研究依赖可读文字及本机截图，不将超时图片列为视觉证据。
