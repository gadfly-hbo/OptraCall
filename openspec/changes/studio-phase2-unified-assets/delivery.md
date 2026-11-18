# Studio 二期 Git／CI／main 与双机采用接续

2026-11-12 · 用户明确授权：“完成 Git／CI／main 交付，并切换服务及更新MacBook”。本文件记录交付目标与准入；它写入版本库时尚未执行的动作不预填为成功。实际逐项完成、PR／检查和运行版本统一见本机保留的[交付执行表](../../../.local/studio-phase2-implementation/delivery/progress.md)与同目录最终收据，并回填到本轮PR交付说明。

## 固定输入与边界

产品候选为[实施结果](implementation-result.md)和[非作者报告](implementation-review.md)核定的55份产品／测试文件；原完整候选82文件摘要`1257623999780552d1b96384f6f3e7aeecb2d1ffca8cfd9f308ca4561cd55e37`保留。55代码在本轮交付中不变，只有当前授权及交付记录补充。fetch后origin/main仍为`d587f177ec5e666d6fcd99e542b97ccea06fbc53`，原本地完整check为2126 PASS／0 FAIL／67 SKIP，非作者115/115通过。两者不替代随后实际提交的远端CI。

所有Git步骤保留WIP、分支、原失败／UNKNOWN及批准的21份原件；采用保持同一官方Pi1.4.0、Semantica0.7.0和锁文件，不修改或升级SDK。会员主题与真实模型专业验收仍后置。本次不调用真实Provider、不重放原任务、不自动认领旧企业资料或更改图绑定。

## 交付目标与完成条件

| ID | 阶段 | 完成条件 |
| --- | --- | --- |
| D01 | 固定与公开提交 | 候选逐文件readback；只提交本任务明确清单，暂存差异与公开内容核对通过；准确commit正常推送工作分支 |
| D02 | PR与CI | 单PR目标main；检查绑定实际head，核checkout SHA、job/step结论、测试／构建和审计；保留失败、SKIP和未验证范围 |
| D03 | main合并与回读 | 合并前再fetch核base/head，必要时补受影响验证；获授权squash合并，merge树匹配被测树，main成功CI；安全快进本地main且保留其他worktree |
| D04 | Mac mini正式服务采用 | 停机前全部owner空闲核定，保全项目／配置／会话／资料／语义环境／图绑定；建立准确main的干净release，锁文件安装构建；经正常停止切换，回读health/build/PID/cwd及实际用户入口 |
| D05 | MacBook更新采用 | 原独立试用clone保持main干净、push禁用；全部owner空闲与数据保全后，沿既有更新／启动入口只快进成功CI的准确main；回读实际进程／构建及入口，保全原资料与历史 |
| D06 | 结果与保全核定 | 两台机器源／CI／实际运行身份分别一致，非控制资料内容核对，变化如实列明；最终收据与PR交付说明含准确SHA／CI链接／运行版本及未验范围 |

## 当前实际入口盘点

Mac mini原正式服务为4173，运行干净release `~/.local/share/optracall/releases/trial-20261112-d587f177ec5e`；三个桌面命令指向该release。主仓main与正式release分别核对，不把开发预览4190当正式服务。后续release采用仍使用原数据根及原语义环境，旧release保留便于定位和回退。

MacBook沿既有SSH目标`macbook`和独立浅clone`/Users/huangbo/Dev/OptraCall`更新；当前main为同一旧版本，push为DISABLED。实际启动／停止／更新命令在clone根，不能凭历史笔记假定Desktop入口已存在。

停机准入不能只看health。按原会话域、现有只读状态、进程／连接及文件稳定证据共同检查；没有直接busy投影的域明确记录缺口，不调用会reconcile的接口冒充只读探针。收到busy或保全冲突时保留原服务／资料，处理准确阻塞后再继续，不强制停止活跃任务。

## 完成后的记录原则

本原位变更目录保留产品建设的完整方案、确认输入、实施、原失败、独立复核及后续采用依据。Git／CI／运行采用／真实模型质量／会员主题／用户产品验收各自核定，不因服务能启动而补造业务验收。收据中的准确main及运行版本是实际采用证据，旧文档的阶段快照不回写成当时已经完成。
