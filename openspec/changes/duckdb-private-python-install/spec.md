# DuckDB私有Python跨Mac安装修复

2026-11-04 · 用户明确要求通过SSH给MacBook安装缺失私有DuckDB并验证启动。沿已确认DuckDB v0.2、原安装授权和四原则修复部署缺陷；不新增产品功能或前端交互，无新UI Demo／持久业务结构决定。工程规范§3允许范围闭合修正复用原规格；本窄spec记录实际跨安装器／身份校验边界。

现状：main bee3ae0，MacBook核心Host已采用，但analysis_python_missing。原锁直接Mach-O依赖Mini Homebrew绝对framework／SSL／SQLite路径，不能把venv私有复制当可用。旧环境与原锁必须保留，不能改MacBook源码／锁、手填READY、放宽校验、装全局Homebrew或替换系统Python来通过。

## 实现边界与复用

沿原analysisPythonFor路径、inspectAnalysisPython、Pi1.4.0／Interface v3及原bash／受管工具；不改owner/profile、权限、全局PATH、SDK循环、普通Python默认或三轮子版本。Host只准备及核验工程依赖，Agent自主选择Python/DuckDB；正常新增必做0。安装仅在显式工程准备步骤联网，运行时不下载／安装，来源保存与原分析不因可选库失败阻断。

复用Astral python-build-standalone官方可重定位install_only发行包，另锁archive与解释器SHA（原Homebrew锁逐字节不变）。默认新安装为完整私有CPython+原三锁版wheels；旧环境不覆盖，可显式legacy准备。READY新增portableLockSha256仅选择固定第二锁，旧ready无此字段继续原校验；不能接受任意lockfile、解释器或hash。安装后真实version／arch／prefix／imports、源包及文件hash和只读封装成立才发布ready。

范围：scripts/setup-analysis-python.mjs、固定portable-lock及必要标准库解包helper；src/agent/analysis-python.ts、新定点测试、本文/result与工程安装说明；现有tests/automatic-verification-flow.test.ts仅修实际后台ready握手与错误留存，不改产品调度／权限／业务流程。无业务表、会话存储、用户配置或UI变化。MacBook仅接收经复核及CI的main，在原clone部署，不开发。

## 验收

- DP01：官方archive/实际解释器身份固定；改包、错SHA、路径／链接越界及不兼容version/arch明确失败，失败现场留存。
- DP02：全私有目录可实际启动，无Homebrew绝对依赖；安装原DuckDB2.0.0/openpyxl3.1.5/etxml2.0.0，实际SQL42及XLSX读写在合成目录完成。
- DP03：新ready精确识别，旧原锁／ready继续有效；marker不符、文件漂移／不安全路径不降级通过。既有目标拒覆盖。
- DP04：实际原受管Python入口与普通显式私有路径可用，原权限／取消／profile与普通默认PATH保留；无模型或业务数据计算。
- DP05：目标／完整检查、全新非作者与四原则复核后Git/CI交付；MacBook经原更新器采用，安装后fresh READY、Host/静态构建/任务能力回读，必要停启只在空闲进行。
- DP06：原项目、会话、文件及旧FAIL/NOT_PROVED保留；部署前后精确清单、原native字节、新增仅工程/控制内容可解释，handoff按真实结果更新。

原D04扩展默认／资源配额等限定接受不被本安装修复改写。运行就绪不等于真实Provider专业或用户验收。

来源：[官方发行说明](https://docs.astral.sh/python-build-standalone/distributions/)、[固定release20260414](https://github.com/astral-sh/python-build-standalone/releases/tag/20260414)。实际archive与解释器字节见本机外部证据根 `/Users/bendandebaba/OptraCall-artifacts/macbook-duckdb-private-20261104/`。
