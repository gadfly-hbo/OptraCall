# R2 核查与验证结果

2026-11-15 · R2本地核查与回归验证完成。用户授权继续 R2；本轮目标及完成条件见 [spec](spec.md)。结论为保留不同业务合同，不为去重新增公共检索层；生产实现无变更。

## 已核事实

- R1 以 `5d89bd79cdf221d07867a7a6fb2084c047427fb9` 提交推送到 `origin/OC｜memory-dao`，PR #74 另核CI，本轮不混入该PR。
- 两个读口已复用原 PersonalRetentionStore、EnterpriseMaterialsStore 及准确候选读取，没有第二套 Runtime。业务范围、匹配与分页不同，不能当等价算法合并。
- 目前未发现值得抽取的小段公共检索逻辑；保持两个读口，新增跨读口公开行为特征验证，不修改产品源码或依赖。新增测试不是新的检索实现。
- `.local/memory-retrieval-boundaries/baseline/manifest.json` 以 NUL 路径清单固定当前1539个tracked文件hash及关键原字节。样例与运行数据仅隔离合成根。

## 执行状态

| 项 | 状态 |
| --- | --- |
| 只读合同与等价性对照 | 完成，不能整体等价替换 |
| 公开读口交叉与既有回归 | PASS：新增4组及原三套共29/29、0 FAIL／0 SKIP；原三套基线25/25。check/baseline-green.log、characterization-initial.log与related-suites.log |
| 类型／边界与原件保全 | typecheck、check:agent-sessions通过；原生产源码／依赖保持，最终清单复验另记 |
| 全新非作者复核 | 规范／规格均通过限定候选范围，0必须修复项；各自独立新套4/4，首末1542文件与原1539tracked无漂移；review/{standards,spec}/report.md |

R3、真实Provider、真实业务材料、运行采用、服务及MacBook未执行。本轮R2产品实现无变更，不宣称新的记忆质量或检索增益。

## 当前结论与验证选择

保留两条检索路径。新测试通过同一真实Store内的资料对照Agent `find` 与人工 `lookup`，不是仅重复两段实现公式：Sigma／long-s／dotted-I有不同实际结果；字面量查询与UTF-16命中位置、准确旧保留版／新草稿、正文显式选择、20/50 continuation与page/total/100、来源损坏后的不同完整性提示均保持。

这次没有抽取公共匹配器或统一分页，也没有新增业务检索实现。query词法校验和单行当前decision查找虽相同，跨域抽取会引入错误类型／参数适配且不减少业务逻辑，当前维护收益不足。现有公共Store／准确来源继续复用；后续如有明确可等价维护收益，再按实际证据提取，不把本轮结论写成永久禁止复用。

新增测试为既有行为特征GREEN，不是修复新功能、不制造RED；生产源码／依赖零改动，按已固定影响范围执行29项公开相关检查、类型及边界检查，不重复R1刚通过的完整SDK／平台检查。R1 PR实际CI仍单独核定。

基线脚本首轮因Git默认quoted中文路径报错，未写成manifest；原错误在baseline/initial-error.log保留，改用`git ls-files -z`后完整固定1539个tracked文件。还以原f559251字节补核R1旧清单未覆盖的13个中文路径，均未变；这是清单范围补充，不改变被测runtime／测试身份或原始检查结果，收据在R1本地git/supplementary-path-coverage.json。

## 本地收尾与限制

完整固定清单 `review/candidate-manifest.json` 覆盖1542个文件（原1539个tracked＋本轮3个新增）。两位复核均未参与本轮创作、fork:none，无继承作者上下文；规范轴硬违规0／可操作smell0，规格轴0必须修复项，各自在隔离cwd运行新4项通过。未把独立4项重复相加为更大的作者通过数，未把定向29项称全仓通过。

正常工作仍由Agent按需查读，Host提供准确资料与供给治理；已有SDK／会话与Store继续复用，无新增人工操作。只有测试和文档变化，无界面、会话、权限、持久格式或检索算法变化。未证明新的业务收益或召回提升，也不把基线Unicode差异当永久产品政策。

随后仅spec/result作完成事实收尾，原字节在review/before-closeout，限定差额另回读。R1提交、PR与CI的最终结果单独记录；本轮三个新文件尚未提交或推送，未混入R1 PR。R3、真实模型、服务和MacBook均未推进。

## 后续 Git 授权（2026-11-15）

用户随后指示“R2做下git，继续R3，先给最小方案和验收标准，等我确认后再实施”。以上未提交状态保留为本地收尾时事实；本次仅将已复核的R2测试与两份记录提交、推送到同一 `OC｜memory-dao` 分支，更新现有PR #74，并核对新head的实际CI。重新fetch后origin/main仍为 `f5592518cbe6d27552501a3ed46a757c363857f0`，无新增集成差异；R1为 `5d89bd79cdf221d07867a7a6fb2084c047427fb9`，其CI #194已通过（2432 PASS／0 FAIL／197 SKIP）。

R2产品源码及依赖仍无变更；本轮3文件与独立复核身份一致，仅本节授权及Git事实追加。R3只读核查、最小方案与验收准备，不提前实现、验证产品增量或纳入此次提交；合并main、真实模型、服务与MacBook采用仍各按有效授权处理。
