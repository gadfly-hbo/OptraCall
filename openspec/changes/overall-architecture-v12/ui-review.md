# 原产品增量 UI 准备核对

本轮依据v1.2；原App固定main `3a529a0e381bf67b998f2b1debd242a5eed38884`。可点击入口<http://127.0.0.1:43127/>，基线<http://127.0.0.1:43127/?baseline=1>。两版均为真实App+原CSS，API内存替身；不是正式设备/真实业务快照。运行/停止、来源、transform与拒绝出口说明见[Demo README](ui-demo/README.md)。

## 此次具体变化

| 原界面 | 本轮拟议变化 | 原能力保留 |
| --- | --- | --- |
| 战略页默认BSC，GSA为tab | 默认GSA，BSC及编辑字段收进按需工具 | 同一GoalStore、原目标/关系/指标准确版和历史 |
| 主要通过目标表单管理 | 原页加入直接战略讨论、可选方法参考；候选预填到一次采用核对 | 不要求先选理论/建Plan、不重复抄录，采用仍归原Goal版本 |
| 设置无使用用途 | 原设置加默认用途/背景；本次讨论可明确不同用途 | 默认不改进行中工作，准确Goal背景优先于新默认，原权限不变 |
| 原Goal→Case/Project/Plan/Task | 采用定位原目标后继续同一入口，增加准确背景承接 | 两种确认、单/多Task及综合、停止/UNKNOWN语义不变 |

最简正常路径：原战略页说问题→继续讨论/比较→需要采用时一次集中核对预填内容→原GSA→按原目的进入Case或Project方案。已有GSA可直接沿原目标进入下游。BSC、方法、详细因果、历史、用途覆盖均按需。普通发送是讨论操作；经营承诺须用户明确，候选核对不替代真实行动授权；不增加每Task必选用途或逐工具批准。

## 实际浏览器观察

Root统一使用Chrome实际点击：原产品基线/增量、自然语言讨论、PTW+Rumelt组合保留消息、候选集中预填/采用到原GSA、新项目→原Plan→“仅确认并创建”→原Task显示准确Goal和组织用途，设置个人默认后原进行中组织讨论不变，部门准确目标优先于默认。UNKNOWN保留原操作并查回继续，409保留输入/准确来源且不自动重试。个人/部门示例、当前显式不同用途、无BSC GSA、BSC按需、原v1/v2及关系v2/历史v1可达已核。

观察截图/AX在`.local/v12-preparation/browser/`，关键截图为`02-gsa-proposed.jpg`、`03-adopt-prefilled.jpg`、`05-purpose-settings.jpg`、`07-existing-baseline.jpg`；最终修正版另保留`final-gsa-proposed.jpg`、`final-personal-discussion.jpg`及`final-direct-gsa-*.ax.txt`/`final-explicit-current-purpose.ax.txt`。原页面自动加载的无关操作未扩大成全App验收。刷新重置讨论/Goal内存，仅默认用途用独立localStorage；保存重开/Provider/磁盘及专业效果需确认后真实工程验证。

## 发现与修正边界

- 首次重载遇旧Demo进程已退出，保留`01-gsa-proposed.jpg`连接失败；Root重启独立43127，未操作正式服务。空白首次挂载截图亦保留。
- Demo作者初次tsc报useRef初始化错误，已修并保留旧日志；整App构建大chunk提示保留。浏览器HMR期间两条重复createRoot错误是当时开发记录，保留不冒产品缺陷。
- Root到原Task时DB/方法历史自动GET缺合成空目录，已补精确GET；未知/POST模型/外网仍拒绝。记录为Demo fixture修正。
- 用途优先级两处：围绕Goal讨论、原GSA直接进入项目均须取准确Goal背景，已明确/冻结不同本次背景仍保留；不靠scenario/default覆盖。个人合成文案零售残留已修正，Root重新打开个人回复及四类依据，无零售对象串入。修前截图10及发现保留，不冒真实模型专业失败/通过。
- 非作者发现R1已补spec§4.2（实际能力/封闭资源/原生恢复/Plan前边界），R2/R3为上述Demo一致性修正。R2正反向实际路径均复验：个人默认→组织Goal→原Plan→Task为组织；组织默认/场景→个人Goal→原Plan→Task为个人；本次明确个人覆盖组织默认也准确。Task自动GET缺口重走已消除，未知工具执行仍不开放。最终关闭依据在非作者报告；不重开v1.1工程差额。

## 确认状态

此文是前置设计核对，**用户尚未确认**。工程规范“界面与交互的开工确认”要求可点击spec/Demo经用户确认后再实施受影响代码；仅请求对本次具体增量确认，不重复产品访谈。不运行正式Host/Pi/真实模型、业务写入/设备迁移；不宣称v1.2产品实现/验收完成。
