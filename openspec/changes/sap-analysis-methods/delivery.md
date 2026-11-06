# Git／CI交付与原位归档

2026-11-04，用户明确授权：提交并推送本次开发到`codex/sap-ir`，完成CI，通过后合并`main`，暂不切换现有服务。此授权替代前次本地实施阶段的Git暂缓边界；不扩大到真实Provider、业务资料、MacBook或运行采用。

## 固定功能与本地验收

功能提交`aca0340df0b5dba5ab8c4a9620c865b89c3907d1`，tree `00929af0230330dfca14c6512b6e6080d03d9df1`，为先前完整复核的56份文件候选。逐文件SHA／字节与本地`candidate-final.json`全部匹配，摘要`98423b77068d41d041f2d7ae0f2ed3514c35505db1bb64797909a1e8f38a7f5c`。最新远端main在提交前仍为基线`57742b99d173bfa6413e83705682b0444359add4`，未有需整合的新变化。发布范围独立复核确认无额外WIP、真实秘密、客户资料、原生会话或运行生成物。

该功能候选的本地完整检查为1457项、1427通过、30条有原因的条件跳过、0失败；边界／类型／生产构建、实际隔离Host/Pi＋合成Provider／浏览器和双轴非作者／四原则检查通过。原首次FAIL、NOT_RED、UNKNOWN、2项moderate依赖告警及大bundle提示保留，详情见[实施记录](implementation.md)。这些本地结果不代替远端CI或真实模型专业验收。

## 远端回执与归档方式

- 功能提交已推送到`origin/codex/sap-ir`，已建立[PR #35](https://github.com/gadfly-hbo/OptraCall/pull/35)。随后本交付说明及原结果中的授权范围仅作文档补充，不改变功能／测试／批准原件。
- 远端[Check](https://github.com/gadfly-hbo/OptraCall/actions/workflows/check.yml)必须对应本PR的实际最终head；工作流明确checkout该head，执行锁文件安装、完整check及high级依赖审计。检查失败时保留首次结果并核算，不把旧head的绿色沿用到新head。
- 仅在最终head检查成功、合并前最新main已核对且PR可合并后执行获授权squash合并；合并后的main push Check单独核定。实际最终head、merge SHA及两阶段CI永久回执见同一PR的提交、检查和交付记录，本机原始回执保留于`.local/sap-analysis-methods/git-delivery/`。
- 原位归档：本变更随获授权PR进入main保留在当前目录，批准快照、spec、结构决定、实现合同与首次失败历史不移动、不清洗；合并事实以PR／Git与CI回执为准，文档不预写未知的merge SHA或CI成功。工程合并不等于用户产品验收。

本轮Git推送首次遇本机旧凭据助手路径失效，`gh`登录核对有效；通过本次命令临时指定现有助手完成推送，未改全局Git配置，未输出凭据。原失败及成功记录保留。

现有服务、运行数据、配置／凭据和MacBook保持原状态。本地main仅在干净、无在途Git操作且能安全快进时同步源码，不运行启动、停止、安装、更新或部署命令。`codex/sap-ir`分支保留。
