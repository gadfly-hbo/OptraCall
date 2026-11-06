# L2正式采用工程交接：切换待授权

2026-11-06 · D17 A–C交付边界 · 普通用户仍使用原产品入口

本说明交接固定源码、受控启动配置、有限资产维护入口和私有语义依赖。准确Git提交／tree、CI及构建身份由本次交付回执与该发行的`git rev-parse HEAD`／`dist/optracall-build.json`对应，不以工作树名称、包版本或测试文件hash替代。**这份说明不是服务切换指令；D和真实模型仍未启动。**

## 已有能力及本次接缝

- 原launcher→runHost→createHost读取一个Host-only配置；按项目给真实task投影准确图绑定，覆盖已有task、后续普通task和原Feedback新建的复盘task。原Interface v3、SDK1.4.0及owner／managed资格不变。
- 显式`--semantic-config`优先；否则只读取既定dataRoot下`semantic-graph.json`。不存在保持旧L1；`enabled:false`不启动图解释器；配置错误明确失败，不把配置接受说成图／业务ready。正常停启不需要逐task或逐次填路径。
- 原trial资产helper保留全空Store guard。正式维护用`prepareSemanticAdoptionAssets`，沿原Store新增／准确复用、冲突拒绝、部分成功保全／显式续办，不是搬库、注册中心或自动恢复系统。
- 启用写入发生但回执未知时，续办只回读原状态；若后来已撤回，拒绝重放启用。已有源或方法的撤回／治理仍由原authority每次查询核定。

## 固定材料

| 材料 | 采用身份／用途 |
| --- | --- |
| 代码 | 本次固定发行提交和tree，沿原锁文件、官方Pi1.4.0及transport8.12.2；基线为695b9f10…，当前main的SDK适配／模型包功能保留 |
| 语义源 | [五源清单](assets/adoption-sc01s-v0.2/sources.json)，SHA `1ce91f34fbbea5527d0a4d92c694d767f379a62f78aaad0e553128eaf52463bf`；SAP0.2.0、1方法及有限脱敏／合成材料；本题条件不外推真实企业 |
| L2依赖 | [macOS arm64／Python3.12锁](../../../scripts/fourbase_l2/requirements-semantic-py312-macos-arm64.lock)，70 pins＋wheel hashes，SHA `2fe580f56791ba06b1a40ac7b8d30dededc43a53d7c8f3b4df8587070977db00` |
| 已准备私有解释器 | `/Users/bendandebaba/.local/share/optracall/runtime/semantic/py3.12.14-sem0.7.0-2fe580f56791/venv/bin/python`；Python3.12.14／Semantica0.7.0，私有base与旧缓存无运行依赖 |
| 解释器／依赖完整性 | 原base普通文件复制身份相同；70官方wheel的10643个普通文件实际字节一致，pip check及关键导入通过；安装报告／运行树身份留本机交付回执 |

重新准备这个L2环境时，在新的明确私有路径创建venv，按该锁使用标准pip命令的`--isolated --force-reinstall --require-hashes --only-binary=:all:`，包括同版本pip的官方重装，再核实际安装身份。**锁头的普通安装示例不是“原已安装同版本即官方字节一致”的证明**；本轮发现bootstrap pip同版有一处差异后已通过官方同版本标准重装纠正，未手改包。不要搬迁已创建venv、覆盖正在使用的环境、改系统Python或替换普通分析Python。

本次没有安装原可选计算Python／DuckDB环境；原正式代码目录也未发现该私有ready材料。计算库缺失与其原回退策略保持，L2解释器不接管普通计算默认值。

## 等待批准的D窗口

以下是同一次明确采用指令下的顺序，当前不执行：

1. 重新只读核原实例、固定新发行、回退组合、实际根与空闲／收尾情况。现有分析未结束或UNKNOWN时保留现场，按原生命周期处理，不能靠端口空闲或关闭driver推断所有资源已结束。
2. 使用旧root的原launcher正常停止旧实例；确认关闭和旧控制记录清除后再让新root接相同stateRoot／端口。不要从新root接管或强停旧root。
3. 仅在获准目标根执行有限资产维护：一个新SC-01S合成项目，3指标＋1方法／企业资料／M2输入。输入按五源清单取准确字节，配置用原配置路径核准的公开id／revision，不能填S5假配置或改Provider。成功保存后只使用目标真实Ref。
4. 沿原`build_scene`显式参数接口，固定新图根／approved parent、实际代码根、目标dataRoot／projectsRoot、准确Refs、摘录及目标冻结输入字节／hash，离线构建**新UUID**。图根与代码／业务根分离，既有inputs／snapshots／evidence目录先明确准备；不重放旧研究operator。
5. 核准目标源／图后写单一受控配置，由原launcher启动新固定root。回读实际运行commit／tree／instance及配置hash，检查获准合成项目的保存／重开；不扫描真实项目正文，不发送模型请求。
6. 记录安装采用的实际结果；真实模型首次使用、专业质量与真实V404／V405另按具体任务授权，不因本次安装自动启动。

目标Store的项目／方法／资料Ref和图UUID在第3–4步生成，因此本轮不会伪造这些身份或拿隔离验证图充当正式图。D窗口内生成、核准后才能启动带该绑定的新实例；生成失败则停止采用，不自动换版本／回填事实。

有限维护入口为[prepareSemanticAdoptionAssets](../../../src/host/semantic-adoption-assets.ts)。输入包含目标根、明确projectName、5份源path／hash、公开configurationRef和原配置读取回调。先验证准确配置与源；同键同版相同hash可复用，冲突停止。发生`SemanticAssetPreparationError`时，保留`continuation`与原生成身份／部分文件，由维护人核对后才用同输入显式续办；不换新操作盲跑、不自动恢复停用源。续办不是新的账本或业务授权。

配置结构如下，尖括号项必须取本次D窗口的真实结果；模板不是可直接采用的配置：

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "python": "/Users/bendandebaba/.local/share/optracall/runtime/semantic/py3.12.14-sem0.7.0-2fe580f56791/venv/bin/python",
  "projects": [{
    "projectId": "<new-formal-synthetic-project-uuid>",
    "runRoot": "<absolute-approved-graph-release-root>",
    "snapshotId": "<new-validated-snapshot-uuid>"
  }]
}
```

## 回退和责任

首回退候选为原release `/Users/bendandebaba/.local/share/optracall/releases/model-pack-4298db9`、commit `695b9f10b8c818acecef991275db8aea5afc44f2`、tree `b94945c1d1b8afc57ce3f2838ec764cecf598145`及原Node25.9.0／构建／锁；切换前重新核现场是否仍匹配。本轮已让该旧代码在**隔离合成根、port0**读取D17生成的项目、M2与5条原生历史消息，原native字节保持、正常关闭；没有对原4173实例实施回退。

图失败可先按原stop／close收尾，再以`{"schemaVersion":1,"enabled":false}`停图／正常重启，继续原模式已获准资料与工具。非托管普通任务仍有原L1目录；托管任务不因此增授目录、Case、经验或写入工具。代码失败时先停妥新实例，再沿原入口回到兼容的旧组合；保留新资产、项目／会话与报告，不用旧库／native备份覆盖新增工作。关闭未知保持UNKNOWN，不自动重放。

首轮工程维护、获准切换与回退执行由Codex承担；服务采用与业务口径由用户／项目负责人决定。各源Store继续持发布／治理权威，Host管环境，Agent自主分析；没有新增常驻运维Agent或无人值守承诺。

旧D16专业FAIL→FAIL、1/8／7项NOT_RUN、L2相对收益未证、图的partial／source-validation-gap以及真实闭环开放状态均保持。配置摘要、约束通过、HTTP200和工程通过各自有范围，不替代专业结论或用户产品验收。
