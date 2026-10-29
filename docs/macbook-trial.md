# MacBook 单向试用

2026-10-29 · 对应[已确认规格](../openspec/changes/macbook-trial-delivery/spec.md)，实际安装版本和检查见[交付记录](../openspec/changes/macbook-trial-delivery/result.md)。

Mac mini负责开发、工程测试和交付；GitHub main保存经复核及CI的集成版本。MacBook在 `/Users/huangbo/Dev/OptraCall` 使用独立浅克隆，只接收main、体验和反馈。该副本禁用默认push，不从MacBook提交或回推。部署时安装依赖、构建产品不属于在MacBook开发。

## 三个双击入口

| 入口 | 行为 |
| --- | --- |
| `启动 OptraCall.command` | 核对干净源码与构建版本一致后启动并打开默认浏览器；已有同源实例时复用，不安装、不更新。 |
| `停止 OptraCall.command` | 核实本clone实例身份后正常停止Host及其原生SDK工作进程，不关闭其它端口服务或浏览器。 |
| `更新并启动 OptraCall.command` | 先核对应用已停止，再读取官方main；目标提交的main push CI成功才只快进、按锁文件安装、构建并启动。 |

双击后终端显示成功或错误。地址为 `http://127.0.0.1:4173/`，只绑定本机；静态UI和API由同一Host提供，不另起Vite开发服务。健康接口 `/api/health` 的 `runtime` 返回实际已加载构建的版本、提交、构建时间和本实例身份。磁盘更新不会把旧进程显示成新构建；需要停止再启动才能采用新版本。试用启动核对独立Git根、HEAD／tree及包版本与构建一致，拒绝脏树或本地脏构建；开发者在Mini使用 `npm run dev`。更新失败遗留的旧dist不会被当成新版本启动。

如果停止入口提示当前没有实例，表示没有由该试用入口管理的活动进程。4173被其它服务占用时停止并报告冲突，不接管或杀死其它进程。多个入口并发会通过本机操作锁串行协调。进程异常或无法核实身份时保留记录并报错，不用广泛kill作为恢复手段。

## 文件和凭据

代码／`node_modules`／`dist`位于clone内；以下为MacBook本机持久数据，更新不覆盖：

- `~/.optracall/`：模型配置、权限保护的本地明文凭据、原生会话及Pi资源；目录0700、凭据0600。
- `~/OptraCallProjects/`：项目UUID目录，各有 `010_draw`、`020_clean`、`060_reports`。
- `~/.optracall/trial/`：该机启动控制记录和日志，供定位启动／停止问题；日志不作为会话数据。

配置来自该机Pi的 `~/.pi/agent/auth.json`，通过产品已有导入／保存API，与前端操作保存路径相同。已有配置和Provider密钥保留，只补缺项；不复制Mini的凭据、会话或项目，不在控制台输出密钥。导入、保存、启动不会自动发送模型请求；由用户在产品中自行测试或对话。前端也可手动选择Pi凭据文件导入。

项目规则不变：项目内可有多个独立任务，会话／草稿／运行状态按任务隔离；文件按项目共享。Agent以系统提示词软约束不分析 `010_draw`，使用 `020_clean`，过程文件默认020、最终报告060；目前没有敏感数据隔离，请勿放入敏感资料。完整Pi工具继续启用，Host不增加分析流程或工具拦截，不预装分析skill。

## 更新与失败处理

更新要求：应用已停止；当前分支为main；工作区含未跟踪文件均干净；origin是本项目官方URL；本地没有超前／分叉提交。更新固定一次fetch的目标SHA，核对官方 `Check` 工作流对应main push的最新尝试成功后才快进。网络或CI不可用时原样停止，不绕过验证；main尚未通过CI时稍后再试。

安装用 `npm ci --ignore-scripts`；构建成功后由新代码的启动器启动。更新失败会显示阶段错误，保留现有配置、项目和历史；不reset、stash、clean、强制覆盖或回退数据。若代码已快进而安装／构建失败，先保留现场并反馈，网络等问题修复后可再次双击更新重试。不要在缺少依赖或构建失败时尝试手工拼装启动命令。

本机源码有变化时不自动丢弃，交由Mac mini核对。版本回退也由Mac mini提供兼容方案；代码回退不等于数据回退，不用旧备份覆盖新增项目或会话。运行中不热更新、不自动后台同步。

## 部署与反馈

首次部署只对确认空的指定文件夹执行 `git clone --depth 1 --single-branch --branch main`。若非空，先核对保留，不覆写已有内容。使用MacBook原生Node.js 25+及依赖；需要专用Node时放在 `~/Library/Application Support/OptraCall/runtime/node/`，不替换全局Node。Finder入口也可识别clone内 `.runtime/node/`、Homebrew和有效PATH中的Node；Python通过原生bash与本机PATH使用。

反馈请附实际运行版本／提交、复现步骤、预期与实际、可安全提供的截图或日志；不要回传密钥或敏感业务资料。由Mac mini修复、经工程交付进入main，MacBook再通过更新入口接收。部署检查只证明产品安装和基本运行，用户试用及正式产品验收另行确认。
