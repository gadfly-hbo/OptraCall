# MacBook试用运行时证书与私有CLI发现

2026-11-01。承接用户已授权的固定版本／Git／CI／合main与MacBook更新，修正正式安装阶段确认的运行环境问题。原PR #19已合main且CI成功；MacBook更新在CI网络检查前安全失败，旧产品仍为干净8948f3b，已有数据未变。此增量仍不启动新的模型全链路，不改变Host／Agent职责、分析行为或公共Interface v3。

## 原因与范围

核定私有Node可执行受管工具，但Homebrew编译的默认CA路径在MacBook不存在，默认fetch失败为`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`。用Node内置可信CA后可完成官方GitHub TLS握手，该145份根证书的集合与保留的官方Node一致；随后匿名API返回403／额度0。该机既有GitHub CLI认证另被实际CLI确认失效，需要用户在MacBook重新登录，不能复制Mini token、禁TLS或绕过官方CI。

只改可信启动环境：试用入口使用固定`--use-bundled-ca`、保持TLS校验并发现应用私有`tools/gh/bin`；npm等子命令及共享`runtimeEnvironment`产生的Host／SDK驱动环境只接收固定可信CA选项，继续过滤任意继承的NODE_OPTIONS、GitHub主机／token／调试及禁TLS覆盖。私有CLI由本次部署显式提供、复用该机自身认证；产品不自动安装CLI或登录，不修改全局PATH／CA／系统Node。模型配置、权限、原件保护、后台并行、停止／UNKNOWN均不变；共享Host／SDK入口的默认CA也统一为Node内置根，不复用构建机本地CA目录。

| ID | 验收 |
| --- | --- |
| RT01 | 真实Finder入口产生的Host继承固定CA选项及私有CLI搜索路径，调用者任意Node preload／禁TLS覆盖不进入；保留数据和正常启停。 |
| RT02 | 原更新流程真实npm/build子进程取得固定CA选项，不传播任意NODE_OPTIONS或禁TLS变量；官方CI同SHA／main／最新尝试校验、凭据不导出及认证失效不降级保持。 |
| RT02b | Host／SDK共享环境在真实子进程中消费固定CA选项，实际默认CA集合摘要与内置集合相同；任意preload、禁TLS或外部证书文件不透传。 |
| RT03 | 保留TLS与首次更新失败；完整工程检查及两轴非作者增量复核通过后，新PR实际head CI通过再合main，核main push CI成功。 |
| RT04 | 用户恢复MacBook自身认证后，经原更新入口升级到最后核定main。可在旧入口启动时仅显式提供固定可信CA环境进行自更新引导，不能手工快进或绕CI；若旧已加载更新模块导致安装失败，保留阶段记录，再用已更新的新入口重试。之后普通Finder入口也无需手工设置环境。 |

原专业FAIL、旧C2性能及1000证据保持各自范围。安装采用、用户体验与专业验收分别记录。原始收据在`.local/current-version-delivery/runtime-trust/`；合并及最终采用追加PR说明和本机交付收据，不为了回写安装事实重复发布产品提交。
