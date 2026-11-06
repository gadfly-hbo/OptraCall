# S3 SC-01S 私有工程模块

本目录实现已批准[D12](../../openspec/changes/fourbase-l2-rollout/s3-structure-addendum.md)的有限派生快照、来源筛选和加载保护。[验证报告](../../openspec/changes/fourbase-l2-rollout/s3-validation.md)列出准确版本、失败历史与阶段边界。它不提供产品HTTP／MCP服务或Pi工具，不读取活动业务根，不建立第二套SAP／M2权威。

| 文件 | 责任 |
| --- | --- |
| identity.py | 原canonical兼容、准确Ref业务身份和有源节点／边键；校验hash不混入身份 |
| authority.py／authority.mjs | 只读指定隔离原Store；每次调用核当前enabled／治理及准确版／hash，失败不返回payload |
| readmodel.py | 新UUID不可变保存、回执／文件／输入校验、显式装载及声明／边全部来源筛选 |
| graph_constraints.py | 全部逻辑节点／边的RDF投影及实际Semantica→pyshacl最小约束；不做经营真值推理 |
| sc01s.py／build_sc01s.py | 3已发布指标＋1方法的有限内容整理、准确原Store读入、候选本体和快照构建 |

已验证环境为Python3.12.14、Semantica0.7.0、rdflib7.6.0、pyshacl0.40.2、NetworkX3.7、Node25.9.0；原Store源码固定2b9800bc，投影内yaml2.9.1。依赖沿S2隔离venv复用，主项目依赖未变；这里不是生产安装说明。

复验需显式提供本工作树`.local/fourbase-l2-s3/sc01s-v0.1/run-*/`中的隔离run，包含固定原源码`source/`、隔离`asset-root/`、`projects-root/`、`inputs/`、`tmp/`、`evidence/`。不得将真实业务根／附件／凭据复制进去。原投影应与固定Git对象一致；输入必须沿获准脱敏摘录和合成SC-01S字节。新的构建应使用新label及新UUID，保留旧快照与失败现场，不重放包含业务写操作的场景脚本。

回归入口为`python -m unittest discover -s <repo>/tests/fourbase_l2 -p 'test_*.py' -v`；须从run cwd执行，设置`PYTHONDONTWRITEBYTECODE=1`、`PYTHONPATH=<run>/support:<repo>/scripts`、`FOURBASE_L2_AUTHORITY_RUN=<run>`，HOME／TMPDIR指向run内。已执行回归外层先import工程`runtime_guard`，禁止Python网络／附件读取和run外写；它不是OS沙箱或产品权限机制。未设置明确authority根时该类会跳过，不能视为完整回归。

实际资产读入：`build_scene(run, repo, enterprise_ref=<准确原企业Ref>, label=<新证据名>)`；内部使用原生OntologyEngine、GraphBuilder／ContextGraph保存和完整API。选用仅由`SnapshotStore(run, authority).load(<准确UUID>).query()`明确指定；无latest／current。查询state为available／partial并带不含来源正文定位的gap代码；调用者须保留partial限制。

inputs保留7份原记录字节（SAP YAML、方法版本、企业正文、M2输入record／说明、获准摘录和合成输入），另有2份显式engineering-design JSON投影用于原SAP／复合企业响应定位；不复制可变索引冒充版本。原SAP／方法publishedHash另核发布内容，不以版本记录整体hash代替。每次查询仍从当前原Store重查必要Ref。停用来源不删历史，旧图也不会因此获得新查询资格。快照不得原位编辑；变更来源后重建新代并显式选择，回退旧代同样重新核资格。方法图须保留其三核心已声明依赖，缺任意一项都不可加载。

`scene_acceptance.py`是本次实际资产演练，含复制库中的停用／恢复／错误治理，以及本隔离run的企业工程修订更新，不是通用只读单元测试。初次完成结果已留证，避免原根重复执行。当前没有S4接口或真实模型、取消、生产采用及业务效果证明。
