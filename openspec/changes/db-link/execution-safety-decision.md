# db-link 执行安全：首切片需补充的组件决定

2026-11-14 · 待用户决定。其余已批准的连接／授权／结果留存工作继续；本说明不撤回开发授权，不自行增加组件或放宽DB05／14。

## 已确认缺口

批准的driver-selection明确“本补充不降低原合同，不自行增加SQL parser、代理服务或修改驱动”。固定pg／cursor／mysql2公开驱动不提供任意SQL的完整只读、副作用、不可放宽预算及所属原子取消证明。官方原生反例包括MySQL prepared可执行KILL／SET等、SELECT GET_LOCK产生实例级锁、MAX_EXECUTION_TIME正数hint覆盖会话预算；PostgreSQL SELECT可调用有副作用函数，SQL PID取消自身存在极小复用竞态。[Prepared](https://dev.mysql.com/doc/refman/8.4/en/sql-prepared-statements.html)、[锁函数](https://dev.mysql.com/doc/refman/8.4/en/locking-functions.html)、[hint](https://dev.mysql.com/doc/refman/8.4/en/optimizer-hints.html#optimizer-hints-execution-time)、[PG取消源码](https://github.com/postgres/postgres/blob/REL_18_0/src/backend/storage/ipc/signalfuncs.c#L50)

仅凭SELECT前缀、regex禁词、参数绑定、拆账号或只读事务均不能关闭这些反例；使用pg未文档化Client.cancel、手写协议或切pg-native也不在当前批准范围。详细只读证据与NOT_RUN矩阵见[首切片核查](/Users/bendandebaba/.codex/visualizations/2026/11/13/01a1d52a-52fa-7a71-8958-ba6aa8d48d59/db-link-implementation/execution-research/findings.md)。

## 最小追加候选：node-sql-parser 5.4.0

建议允许追加未经修改的上游`node-sql-parser@5.4.0`，只使用公开AST能力作**技术语法与执行权限检查**，不生成／改写业务SQL、不决定分析方法。核查日registry稳定版本5.4.0，2026-01-12发布，Apache-2.0，npm gitHead `69541276c459933bfa705fc97fc6c250fe9edcfa`；“上游官方”指该开源项目，并非MySQL／PostgreSQL官方组件。[registry](https://registry.npmjs.org/node-sql-parser/5.4.0)、[release](https://github.com/taozhi8833998/node-sql-parser/releases/tag/5.4.0)、[固定API](https://github.com/taozhi8833998/node-sql-parser/blob/69541276c459933bfa705fc97fc6c250fe9edcfa/README.md)

若批准，最小适配合同为：

1. 指定准确MySQL／Postgresql方言、源版本／SQL mode／编码条件，完整解析单条允许查询；CTE、子查询、集合、函数／表达式逐节点检查。未知／不支持／解析失败拒绝该操作，不回退为前缀检查。
2. 拒绝写入、管理／会话、INTO、锁定读取、变量赋值和未获准函数／对象等构造，结合实际原生权限域，不以白名单字符串或UI范围冒充数据库授权。原SQL保持Agent意图，不转译／重写经营条件。
3. 原SQL拒绝可能被parser当普通空白忽略、但服务器会执行的注释／hint形式；固定版本MySQL grammar会忽略`/*!...*/`及`/*+...*/`，其`--`规则也须按服务器合同处理。以准确词法边界核验，不删除文本后把剩余AST宣称安全。[grammar](https://github.com/taozhi8833998/node-sql-parser/blob/69541276c459933bfa705fc97fc6c250fe9edcfa/pegjs/mysql.pegjs#L4325-L4344)、[原生注释规则](https://dev.mysql.com/doc/refman/8.4/en/comments.html)
4. 在实际引擎的隔离合成环境验证正常分析及写入／函数／注释／hint／锁／多语句／模糊构造反例，保留拒绝范围；不能仅mock AST或测试文件存在就宣称安全。

**这项追加不能单独解决全部硬准入。** 函数／视图／类型／运算符的实际行为、真实行／对象权限、服务端成本和远端取消终结仍须原生资格与实证。不得将parser通过等同能力合格，不调整原UNKNOWN、不盲重发、不杀不明PID，不以新依赖当已完成安全沙箱。

不建议默认切换到pg-native：它改变已批纯JS路线并带来native/libpq依赖；当前wrapper仍用obsolete取消API，不能直接宣称满足原TLS取消合同。也不建议引入缺乏成熟证据的pg-cancel组件或代理平台。[libpq wrapper](https://github.com/brianc/node-libpq/blob/315c38eaf01cdbbe2423c19113edd8469a6cd141/src/connection.cc#L713)、[libpq取消合同](https://www.postgresql.org/docs/current/libpq-cancel.html)

## 决定影响

- **允许追加候选：** 继续已批驱动主线，增加上述技术检查与适用负向验证；其他原生准入仍逐项证明，不保证追加即全部可用。安装精确5.4.0之前等待此决定。
- **保持原组件范围：** 连接、权限管理、元数据和留存等授权工作继续；任意业务SQL执行不冒充已合格，保持明确不可用，直到有实际受信服务端约束或另一经批准方案。

本轮尚未安装／执行该parser、任何原生数据库或真实模型；node_modules仅在本工作树安装原锁依赖及获批驱动，不影响正式服务和其他设备。
