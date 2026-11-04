# 可选本地计算环境：工程接入说明

本地候选实现参见[DuckDB v0.2](../openspec/changes/fourbase-duckdb-phase1/spec.md)及[实际实施结果](../openspec/changes/fourbase-duckdb-phase1/implementation.md)。本文不是安装到运行服务或其他设备的授权，也不是完整验收通过声明。

## 现有执行路径

Host只向符合资格的原会话提供应用私有Python环境位置；Pi 1.4.0沿原bash／Python执行，Agent自行选择Python、DuckDB、混用或不用新库。没有新SQL服务、连接池、运行队列或机器运行账。普通项目、managed与独立核算cold计算分别保留原owner/profile及文件权限；fixed-draft/text-only没有执行工具，PPT和需求插件不自动获得新资格。

全部unmanaged会话（包含非受管cold workspace）的默认Python／PATH／包可见性保持原样；Agent要使用锁版DuckDB／openpyxl时，从同一环境说明选私有解释器绝对路径。原受管工具仍在原scope内提供私有Python入口。不把私有环境替换成全局默认，也不为保留既有NumPy／Pandas重复安装一份。实际旧库与两类解释器的合成42核对见实施记录。

依赖环境只读共享，查询连接、输出和临时目录按执行独立。普通任务保留原软边界，managed继续原OS scope。取消、drain、close、迟到和UNKNOWN仍由原公共生命周期负责；停止不代表文件回滚，不自动重算或清理失败成果。

## 本机锁版与准备

[锁文件](../scripts/analysis-python-lock.json)固定CPython 3.14.4 arm64、DuckDB 2.0.0、openpyxl 3.1.5、et-xmlfile 2.0.0及解释器／wheel hash。当前解释器基于该Mac的Homebrew 3.14.4安装，私有目录仍依赖其stdlib／动态库；不能直接作为其他设备的独立Python发行包。

获授权安装时，从候选代码根执行 `node scripts/setup-analysis-python.mjs`。脚本校验解释器及wheel身份，创建`.local/analysis-python/<lock.id>`、离线无依赖安装已核wheel并封为只读；下载只发生于这个工程准备步骤。现有目标目录会拒绝覆盖；诊断可显式用`--candidate <新名称>`准备另一个环境，Host不会自动采用该诊断目录。运行时不执行pip、不隐式下载或更换依赖。

`inspectAnalysisPython`实际核对prefix、解释器、包文件hash与import环境；缺失／漂移保留明确错误，普通原有工具仍可由Agent自主选择，不自动降权或放宽managed权限。实际原生工具记录／文件才证明某次采用，环境可用不证明用了DuckDB。

## 已验证的边界与未满足合同

推荐连接样例明确设置`autoinstall_known_extensions=false`、`autoload_known_extensions=false`、线程及内存，并由Agent选授权工作区内唯一temp目录。**DuckDB原生新连接默认仍为true／true**；这些示例设置没有变成不可绕过的全局默认。原批准spec要求默认关闭额外扩展，该承诺未满足的原结论保持。用户已明确接受[D04增量](../openspec/changes/fourbase-duckdb-phase1/accepted-limitations.md)：Agent按原权限、环境说明和显式连接设置关闭；Host不宣称原生API全局默认被改写。当前按此范围收尾，不将接受记成原默认保证通过。DuckDB官方[2.0扩展说明](https://duckdb.org/docs/2.0/operations_manual/securing_duckdb/securing_extensions)也明确原生默认及连接内关闭方法。不得为隐藏该差额添加monkeypatch、第二执行器或替换批准版本。

实际spill、OOM、只读目录拒写、并行owner隔离及取消已有有界合成记录；**native临时配额仍FAIL／NOT_PROVED**：fresh连接初始0B配置，首个CREATE仍产生约26MB物理spill。它不提供可靠硬磁盘配额；memory_limit也不是RSS硬限，未证真实ENOSPC。详情及原始失败在实施记录关联的`runtime/resources`，不能用正常close后临时文件消失掩盖计算时占用。

## 来源与兼容

SQL、参数、实际版本／设置和结果沿原020／060文件、Pi native及可选M2 citation保存；Host核技术身份与字节，不推断业务正确或补SQL。固定输入扩到五类／单件50MiB；文本来源七类／单件50MiB、合计100MiB。XLSX仍为原二进制，MD保UTF8原文／UTF16位置，不由Host解析为表或重算公式。

新reader支持v1/v2，旧记录读取不迁移，新写才升index。兼容代码可用`ProjectDataContextStore`的`writeVersion:1`收窄新写，仍读已有v2；这是工程构造选项，不是新增用户设置。停止提供`analysisPython`资格和移除依赖应与历史读取分开；不能回到旧二进制后假定能读v2，也不能删新数据或用旧副本覆盖新工作。实际部署／回退另按获授权固定版本执行。
