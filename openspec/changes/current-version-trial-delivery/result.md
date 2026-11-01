# 固定版本与MacBook试用：交付记录

2026-11-01。用户已授权固定当前版Git／CI、合并main及更新MacBook，暂停继续模型全链路测试。当前状态：本地完整工程检查、安装兼容探针及两轴非作者固定候选复核通过。提交／CI／合并／MacBook实际安装尚未进行，不提前宣称成功。

首次fetch：origin/main仍为 `b36a42b43e86a279b1931770022c50b306ceeb36`，与当前分支原HEAD相同；现有125项待交付文本约2.25MB，无新的主线冲突。原始输入清单为 `.local/current-version-delivery/before-delivery-inputs.json`。原项目／会话／文件及全部`.local`证据保留。

原产品／长期测试候选C2已固定；最初按仅补交付说明准备，随后MacBook无模型探针确认CLT Python库权限及官方Node子进程兼容两个独立阻断，保留其RED并按规格VD07补必要环境兼容。新候选另行固定和检查；不把原C2通过冒充新补丁已验证。已知专业重要错误与漏报不关闭，新的模型全链路实验按用户决定不运行。

MacBook首次只读核对：官方URL、干净main、浅克隆、push禁用、无进行中Git操作；源码HEAD为 `8948f3b`，当前4173无运行实例。专用Node25.9.0可用，本机持久文件已另存哈希清单，不输出凭据；此核对不是已更新。实际采用前后证据位于 `.local/current-version-delivery/macbook/`。

## 部署兼容的必要修正

MacBook原官方私有Node25.9.0／libuv1.51.0在原Seatbelt拒绝posix_spawn的规则下实际断言退出；另下载并按官方SHASUMS校验的Node26.13.0／libuv1.52.1同样失败，未采用。CLT Python单独控制也证实原运行库读权限不足，添加其实际版本根可启动；不能用此直接Python成功覆盖Node链失败。全部RED保留在本机`macbook/`证据目录。

产品窄修只有 `src/agent/protected-tools.ts`：按已核选中解释器允许CLT具体版本运行库；解析实际Node相对Mach-O依赖，只在该可执行旁`../lib`之内逐个库文件增加只读许可。原件／native／凭据禁读写、防脱组及停止／UNKNOWN不变。新永久回归实际通过公共`createProtectedTools`选择本机CLT，原RED为`unsupported_protection`，修复后实际Python调用、原件写入拒绝及凭据读取拒绝通过。

私有兼容包复制Mini已验证的Homebrew Node25.9.0_3／libuv1.52.1及实际依赖，25个原生artifact相对重定位及ad-hoc签名，Node/libuv源码和原Homebrew文件未改。包37,956,345字节，SHA256 `b133aa12e315820c752455e18bb38d755fa2a5bc8c1911b9e7ab6b85e68d1550`，manifest2000项，Node25.9.0／uv1.52.1／npm11.12.1，arm64、minOS26.0；MacBook实机26.5.2满足。许可证文件随包，SQLite原header声明另有sidecar并随安装证据保留。应用安装前显式选定兼容运行环境；没有增加任务失败后的自动runtime／模型fallback。

Mini跨目录重解包与MacBook独立目录分别完成Node→bash→CLT Python3.9.6无模型探针，原防脱组／posix_spawn拒绝、模拟原件与native写保护、凭据读及网络拒绝均通过；包2000项零差异，所有已知探针进程退出。MacBook原7个数据文件、旧runtime及干净旧clone未变，探针尚不是采用。共享脚本原scope标签残留`MINI/NO_PEER`未覆写，peer-identity、实际MacBook路径／argv与final-peer-proof侧车明确绑定真实peer执行。Root另用同包跨目录Node跑真实产品公共CLT回归1/1通过，此为Mini实际产品profile证据，与peer等价Seatbelt探针分开。

## 固定候选与本地检查

`.local/current-version-delivery/product-candidate-1.json`：264项，SHA256 `524d5118ac322d89b135507ac0892952b645e481b178d1df051c93414f1442b0`。相对C2仅AGENTS当前授权、必要运行库兼容及新CLT永久回归三项，其余原263项中的261项逐字节不变，无删除；原专业验证及C2的性能与1000验证结论只保持当时范围。

`npm run check`退出0：**754项，753 PASS、0 FAIL、1平台不适用SKIP**，会话导入边界、TypeScript及构建通过；原Vite大chunk提示保留。依赖审计退出0，0 high／critical、2 moderate保留，依赖与锁文件未变。检查日志为`full-check-1.log`、`dependency-audit-1.json`。Standards另独立运行CLT实际公共回归1/1，并确认普通进程可读的Developer祖先SDK文件在受管read仍EPERM，未开放祖先目录。

## Standards

非作者结论 **PASS_WITH_SCOPE，0未关闭硬规范问题，0可行动smell**。独立核264产品／385公开候选、MacBook包2000项及25项严格签名，另独立运行CLT公共回归及祖先目录拒读检查。报告 `.local/current-version-delivery/review/standards-final.md`；未预签未来CI或实际安装。

## Spec

另一非作者结论 **PASS_WITH_SCOPE，0未关闭阻断发现**。264产品／385公开候选逐文件零差异，Host／Agent边界、旧失败保全及VD07环境修正符合规格；真实peer身份及等价探针与Mini公共API证据分别核对。报告 `.local/current-version-delivery/review/spec-candidate-1-final.md`。CI、合并、MacBook采用及专业正确性分别报告。

源码及永久测试保持264项固定身份；复核后只更新本页实际状态／报告路径及上述专业验证归属措辞，完整Git清单重新固定，不让旧385项清单冒充文档更新后字节。原始证据位于 `.local/current-version-delivery/`，不纳入公开Git。

实际提交、PR与main CI、合并SHA及MacBook运行提交／数据保全将追加PR说明及 `.local/current-version-delivery/delivery-receipt.json`，分别报告，不将计划当作成功。MacBook正式采用后还须回读实际新构建与普通API，并在隔离目录做一次无模型产品工具启动／关闭烟测；这不是新的Agent模型全链路或专业验证。
