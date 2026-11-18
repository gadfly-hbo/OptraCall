# Case 与独立决策事项工程记录

固定输入取自开发包的框架 v0.8、规格 v0.3 和已批准 Demo。测试只使用隔离的合成项目、目标和凭据。表中命令及证据均相对于本工作树。

| 范围 | 已实施及本轮验通 |
| --- | --- |
| 新建 Case（T1、C1） | 星图、目标及原任务入口沿用同一 Case 创建接口。Host 核准确已采用 G 及其中的 S。与前一已采用版相比，仅其他 S 变化、同文、候选、编造的 S 和已经承接的同一 G／S 都拒绝。仅 G、仅 S、两者同时变化可通过。原操作回执按内容摘要核对，只产生一个 Case。 |
| 原依据 | 任务入口保留原 Project／Task，可带原会话、消息 ID 及 SHA-256。创建与再次打开原回复均向原资料读取方核对。新议题可回到当时的原 Case 修订。原 Case 详情保留创建来源。共享项目不会让另一 Case 读取本事项的 Plan。 |
| 跨年度（C6） | 在原目标关系历史追加准确 G、具体 S、生效日；用户确认议题及判断标准延续，未来生效的绑定到期前不替换当前工作目标。判断标准或管理范围改变时可回目标管理另建。已结束 Case 拒绝写入；旧绑定缺 S 时保留原样。 |
| 独立事项、取舍和授权（T3、C2） | 用户给独立问题命名，同一问题的不同方案按原事项承接。Case 保留选中方案、取舍、当时 G／S、前次选择、理由及时间。实际的 Plan Task 原回复由用户交回当前事项。另行输入行动及授权范围，原看板建立行动和授权；相同操作 ID 重试返回原凭据。原生引语与表单确认保留各自实际来源。 |
| 看板到 Teach（T3） | 正式 Host 加原 Pi SDK 在本机协议夹具中完成明确创建的 Plan 和 Teach 任务，保存的回复身份与原生会话一致。有行动的试行在取得原反馈前拒绝复盘；观察到无改善后，原反馈、原 Teach、用户观察、判断和下一步均可回看。无行动的暂缓与本次不行动分别在取得自身观察后复盘。重开后仍能读原轮次。 |
| 版内行动及导出 | 原看板凭据冻结 Case、事项、取舍及确切 G／S；目标页与 HTML 导出共用同一受权读取。核验同版展示行动、同一目标异版无此行动、共享项目其他目标无此行动，解除关系后查看及导出均拒绝，恢复关系后读回同一授权 ID。下载的两个版本在断网浏览器中分别核实 S、行动和准确事项。 |
| 产品入口点验 | Chrome 经主导航从决策星图打开 Case，查看准确 Plan、Teach 与原看板反馈历史；从新建 Case 回目标管理，查看两版行动、实际导出并离线回看，再按已采用 G／S 创建 Case。浏览器在 Host 成功后丢弃创建响应，核对只发送 1 次创建 POST 和 1 次原操作 GET，成功打开同一 Case。页面运行错误 0。 |

## 证据与复现

- 初始红测保留在 `.local/product-v13/case/red.txt`（未要求具体 S）与 `.local/product-v13/case/red-issues.txt`（原 Store 无独立事项）。`tests/v13-case-work.test.ts` 覆盖 G／S 改动、方案 A→B、其他事项、跨年、关闭和历史。
- `tests/v13-case-cycle.test.ts` 通过原 HTTP 建项目、Case、事项、Plan 与 Teach，再由原生对话产生准确来源，覆盖用户选择、另行授权、回录、未成熟反馈、暂缓、不行动、撤权及恢复。最终运行 1/1，通过的原始输出见 `.local/product-v13/case/final-cycle.txt`。
- 联合执行 `node --test tests/v13-case-cycle.test.ts tests/v13-case-work.test.ts tests/project-plan-case-link.test.ts tests/automatic-business-feedback-v020.test.ts tests/automatic-review-handoff-v020.test.ts tests/product-v13-version-exports.test.ts`，25/25；原始输出见 `.local/product-v13/case/final-regression.txt`。较早受影响面检查 22/22，原始输出见同目录 `affected.txt`。本轮 `npm run typecheck` 通过，输出见 `typecheck-final.txt`。
- 先运行 `node --test tests/v13-case-cycle.test.ts` 取得合成目录，再以 `node tests/browser-v13-case-cycle.mjs <该目录>` 启动隔离 Host 和 Vite。此独立脚本从工程可解析的浏览器测试环境加载 Playwright。本次将工作树临时 node_modules/playwright 指向本机已安装包。浏览器输出见 `.local/product-v13/case/browser-final.log`，截图见 `cycle-browser.png`。断网复核原件在输出所记的合成目录内，文件为 `gsa-browser-v1.html` 和 `gsa-browser-v2.html`。

## 兼容、回退与证明范围

Case 继续使用原 SQLite 事务、目标关系及原操作／事件表。没有重写旧 Case、历史取舍、任务会话或替旧资料补 S／事项。正式看板上的旧 quote、旧 Goal arrangement 与已有 Plan 入口继续走原有格式。新增的表单授权收据及事项依赖本版读取能力。

本轮工程回退可停止隔离候选，重新使用原服务和原资料根。如将来获准原地采用，采用前需保留整个可恢复数据快照（包括 Case、看板、Goal、Project 与原会话）。回退旧程序应指向采用前快照，同时独立保留新版产生的材料和凭据。本轮未在正式资料上切换程序或演练灾难恢复。

上述 Pi 点验使用受控本机协议端，验证角色来源、原生消息与 Host 行为；真实模型对经营判断的专业质量、Mini 正式运行采用及用户产品验收另记。三轮实际样本覆盖试行无改善、暂缓及本次不行动；独立“负改善”样本未单列专业测评。非作者复核与全仓结果见总记录。
