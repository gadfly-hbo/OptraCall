# 项目文件绑定能力复用记录

2026-11-11 · 用户授权可复用 Host 能力实施、Git／CI 及合并，并要求当前工作区和分支清洁后更新 handoff。

起点为 `origin/main df2f50cc8f51bc7145ad8fab51b58b565f8672f1`。验证前 `codex/calculation-tools` 同步至主线规范变更 `d161bb53`。五份设计的原提交 `f294f42a95cb9e2c8b874939795f00e50a203678` 及十份文件哈希保持可核对。

## 原候选保全

持久归档位于本机 `~/.optracall-evaluations/host-bound-tools-preservation-20261111T111714+0800/`，包含七份逐字节副本、SHA-256／字节清单、旧状态和可恢复 tracked patch。四份源码／测试的旧同源出稿候选已从当前工作区移出，三份旧试验文档保存在该归档与原始试验根。七份归档已逐一独立回读核对。

## 任务目标执行清单

目标为正式普通任务接入可复用的 Host 文件绑定，保留 Agent 保存工具选择，交付可验证的独立实现提交及清洁收尾。

- [x] 核对已有目录、权限和工具，按 HPF01–05 实施。原有 `020_clean` 工作目录及 Pi 文件工具沿用。新增入口只向普通非受管项目任务提供。
- [x] 保留 Host HTTP 到真实 Pi 本地合成的缺失能力 RED，验证新入口、普通写入、授权目录、同会话续接及原生回执。初始回执在 `.local/host-bound-tools/host-http-first-1794367332863-beef05c0-ce0d-480a-a5bc-6355b3081212.json`。
- [x] 新增测试共 14 项通过。原有受管 ordinary、固定稿和 SAP source-reader 的 4 项定向回归通过。非作者指出的 Unicode 路径规范化及晚期暂存替换均有明确失败用例和 GREEN。写入发布与停止竞争按 HPF05 核对实际文件和回执未知状态。
- [x] 核对本地安装的官方 Pi 1.4.0 七个发行包，共 2,530 个文件与锁定 registry tarball 的路径及字节一致。`npm audit --audit-level=high` 返回 0，现有传递依赖 `minimatch` 的两项 moderate 提示保留，锁定版本和依赖保持。
- [x] 规范／规格双轴及四原则非作者复核通过。原生成功写入回执沿既有净化。最终代码、脚本与测试 13 件的聚合 SHA-256 为 `92f4a2f6d67922c127508f518eefe5e304479cb39da2764ef3466c52e974cd04`。
- [x] 本地整套测试复跑 1942 项，1875 项通过、67 项条件跳过、0 失败。随后补齐新测试两个参数的 TypeScript 类型，再跑新增测试 14 项、统一会话边界检查和完整构建，均通过。

实际 head CI、合并和最终工作区／分支状态通过 PR 与更新后的 handoff 回读核对。

逐项本机证据在 `.local/host-bound-tools/`，包括 `core-red-*.log`、`review-red.log`、`review-green.log`、`targeted-final.log`、`profile-regression.log`、`sdk-archive-verification.log`、`npm-audit.log` 与原生回执。验证使用合成资料和本地合成 Provider。运行时实际采用、设备更新与业务准确率增益分别记录。

首轮本地完整检查的 `protected-session` 既有用例在固定 120ms 后的后台进度断言失败，1874 项通过、67 项条件跳过。候选及同一主线基线单独运行该用例均通过，整套测试复跑也通过。原失败与复跑分别保留在 `full-check.log`、`protected-targeted-candidate.log` 和 `full-check-retry.log`。
