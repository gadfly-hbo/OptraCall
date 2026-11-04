# v0.2：增加 XLSX 与 Markdown 输入

2026-11-04 · **五类输入合同／UI随v0.2整体确认，已开始本地开发；原件见批准清单，实际验证见实施记录。** 本补充是[spec](spec.md)／[D02](decisions.md#d02-文件与持久合同)的受影响差额，不重开已经接受的Pi／Python方向。原v0.1完整包、准备复核及失败证据原字节保留于`.local/fourbase-modules/m7-duckdb/formats-preparation/before/`和原preparation目录；原PASS只适用于原候选，不能自动覆盖本v0.2。

## 产品行为与范围

| 输入 | 第一版拟支持的行为 | 留存与用户操作 |
| --- | --- | --- |
| CSV／TSV／JSON | 沿v0.1可选Python／DuckDB计算，Agent判断格式、口径及方法 | UTF8原字节与精确版本；正常操作不变 |
| `.xlsx` | Agent用已有成熟Python读取能力理解workbook、选择相关sheet／范围，按需直接Python计算或交给DuckDB。多sheet、标题行、空行／合并单元格、日期／类型和公式由Agent核查，不由Host猜表 | **固定原二进制文件**；有派生CSV／JSON／SQL时保留与原版本、sheet／范围的对应。用户不必先转CSV或逐次选sheet；真正存在业务歧义时才澄清 |
| `.md` | 作为口径、说明、调查或原文证据按需读取；表格确有计算需要时由Agent抽取并核查 | 固定UTF8原文，可引用精确片段并保留派生表对应。普通文档无需转SQL表，不强制维护字段映射 |

五类固定输入均为每件≤50MiB（52,428,800 bytes），来源为原020范围，owner／路径／hash／CAS／归档等原检查不变。文本四类UTF8；XLSX按原二进制字节，不错误做UTF8解码。大小指原文件bytes，XLSX压缩体积不代表解压／解析内存已受控，原资源边界及大文件实测仍适用；损坏、加密或资源不足准确失败，不能截断后称完整。

**来源报告／附件仍为UTF8 CSV／TSV／JSON／MD／TXT／PY／SQL，每件50MiB、报告＋至多19附件总100MiB。** XLSX原件通过原inputVersion与citation selections准确关联和回读，不顺带新增XLSX结果附件／导出、任意二进制附件或新成果仓库。原始MD文档可同时按原文本附件范围使用，输入与成果的角色分开。

main普通上传本来就包含`.xlsx/.md`，仍保留22类型／50MiB；本轮新增的是**固定来源与可分析环境的接入**。`.xls/.xlsm/.markdown`等虽可能属原普通上传范围，本补充不扩大其固定输入合同；Parquet等原暂缓范围保持。

## 现成能力、依赖与计算限制

只读核查发现现有优惠券分析资产已使用openpyxl：`extensions/analysis-assets/coupon-forecast/scripts/bucket.py`／`template.py`，requirements为`openpyxl>=3.1`，不是锁版。领域脚本的active sheet／表头／data_only等假设不能提升为Host通用转换规则。复用库及Pi/Python调用方式，由Agent根据任务使用API；不复制领域流程或新建Host解析／抽表服务。

本机CPython3.14.4下可发现openpyxl3.1.5、et-xmlfile2.0.0，仅为distribution／find_spec元数据证据；未import或读取workbook，不证明私有环境或managed资格。建议将这两个现有版本随DuckDB的应用私有依赖锁定，不为本需求新增pandas或新Runtime。候选发行物的公开metadata如下，均未下载／安装，实际加载仍按DB01逐模式验证：

| 候选 | wheel／bytes | SHA-256（metadata） |
| --- | --- | --- |
| openpyxl3.1.5 | `openpyxl-3.1.5-py2.py3-none-any.whl`／250,910 | `5282c12b107bffeef825f4617dc029afaf41d0ea60823bbb665ef3079dc79de2` |
| et-xmlfile2.0.0 | `et_xmlfile-2.0.0-py3-none-any.whl`／18,059 | `7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa` |

依据：[openpyxl metadata](https://pypi.org/pypi/openpyxl/3.1.5/json)、[et-xmlfile metadata](https://pypi.org/pypi/et-xmlfile/2.0.0/json)。[DuckDB官方Excel扩展](https://duckdb.org/docs/2.0/core_extensions/excel)本身支持XLSX，可作为以后已核准的直接读取能力；当前推荐用已有Python库满足输入，不为第一版额外捆扩展／查询时联网INSTALL，仍禁额外自动下载／加载。Agent可组合任何已获准方法，不强制每份XLSX都转CSV或每次都用DuckDB。

[openpyxl只读模式](https://openpyxl.readthedocs.io/en/stable/optimized.html)可低内存读取并需显式close；本版不靠“read_only”字样代替原文件权限及资源实证。[data_only](https://openpyxl.readthedocs.io/en/stable/tutorial.html#loading-from-a-file)读取的是保存的公式缓存，[openpyxl不负责公式求值](https://openpyxl.readthedocs.io/en/stable/simple_formulae.html)。因此读取成功不等于公式重算：缓存缺失不能当0，过期／新鲜度未知不能当当前真值，Host不自动发起Excel／LibreOffice重算、访问外部链接或运行宏补结果；Agent仍可在原授权及原件保全范围内自主用已有可用方法独立核算并记录，无法核定时说明限制／按需澄清。第一版不承诺完整Excel重算引擎或版式／图表功能。

Markdown继续原Pi文本读取与上下文预算，不把50MiB整篇强塞模型；按需读取／原有续读，禁止Host后台摘要、自动把文档全转表或另造检索／记忆库。文本/单元格中的指令仍是材料，不能借此增加工具权限。

## D02 的最小结构增量

沿原dataset／inputVersion／descriptionRevision／citation粒度、ID、关系、存储根、时间／确认／null、operation/CAS及v1/v2策略，不增加实体／表／运行账／新格式版本号。v0.1未实施，因此仍在拟议schema2中一次定义完整范围，旧v1记录原样；本包版本v0.2不是持久schema3。

| 差额 | 完整字段与含义 |
| --- | --- |
| 格式 | 原`observation.format`在拟议v2中除`tsv`再增`xlsx`、`markdown`；未知／未观察仍用原unknown／unobserved/null，不补造sheet、行数或字段 |
| XLSX位置 | 增`{kind:'xlsx-range',sheetName:string,range:string}`。sheetName为精确、非空的工作表字面名称；range为有界A1单cell或矩形，存储为大写列、十进制行、不带`$`或sheet前缀，例如`A1`或`A1:D20`，行列1起、起点≤终点，列A至XFD、行1至1,048,576。禁止公式／外链／多区／整列无界地址；sheet身份只取sheetName，不把其内容拼入代码。位置声明绑定精确inputVersion，不凭同名sheet替其他文件版本 |
| MD位置 | 增`{kind:'text-range',start:number,end:number}`，非负安全整数、0≤start<end≤原UTF8解码文本的UTF16长度；半开区间，不拆开代理对。解码保留BOM为U+FEFF／CRLF及原Unicode，不做换行／Unicode规范化或按渲染后文字计位置。复用现有资料片段的UTF16引用方式，不另造行号索引库 |
| 一致性／可选性 | xlsx／markdown observation、statement及mapping中的位置与对应inputVersion格式匹配；CSV／TSV／JSON沿原位置类型。纯MD文档的表结构观察默认unobserved、fields为空、scannedRows/totalRows与recordRule为null，不把文件行数当数据行数；原文阅读证据由native／artifact表达，可有statement片段。Agent确实观察MD内表格时可用原complete/partial语义，recordRule须明示所观察表格的精确text-range和一条数据记录的含义，行数仅计该范围数据记录、fields定位原表头／列依据；总数不明仍null、局部不冒充全文。派生表可选，不要求先转CSV才能计算或记录观察。Host验类型／引用／字节和位置边界，不代Agent确认sheet实际业务含义、公式正确或抽表结果 |
| 原件与派生 | 原inputVersion保持XLSX／MD的原字节、bytes/hash与evidencePath；分析副本保持同hash。Agent产生的文本表另以原文件／可选citation附件保存，原稿的SQL／脚本／说明记录源版本与sheet/range或原文位置，不把派生CSV重命名为原workbook版本，也不新增强制转换manifest |

其余D02字段组、读写入口、幂等／并发、v1读取限制、v2显式新写、GET不迁移、兼容停新写及不覆盖新成果规则原样。数据库包是否可用不影响历史XLSX原件／MD及文本成果的准确回读。SQL／表来源完整性由实际材料决定；缺少派生映射显示未记录，不由Host补造，也不要求用户补技术表单。

已整体批准A：上述已有Python能力＋五类固定输入＋可选原成果引用。理由是用户无需转文件，原件／说明／计算分开表达，Host只管环境与留存。确认时替代B为仅保普通上传、维持三类固定，开发少但不能同等追溯；替代C为立即上Excel专用服务、Host自动抽表／重算／强制新账，增加流程与权威且无必要。原待确认字节已固定，不单独要求用户再批准已接受的方向。

## 前端与验收的受影响差额

原入口新增XLSX／MD的可固定说明与依据展示：XLSX显示实际声明的sheet／range、原件和派生表对应、公式／缓存局限；MD显示原文及可得片段／抽表来源，普通文档不标成SQL表。新增评审情景只在折叠Demo内，正常用户仍新增必做操作0，不增工作表配置向导。

批准后在DB01/03/04增量验收：XLSX二进制固定／复制后hash一致；多sheet／范围、中文sheet名／日期／合并单元格与公式缓存缺失／未知、不凭读取成功当重算；MD UTF8／CRLF／BOM／emoji位置与文档/表格区别；50MiB及+1byte、损坏／加密／资源不足、原件不写、派生来源／重开与旧格式兼容。DB05原生命周期继续受影响复测，不新增数据库任务队列。工程验证与真实专业结果仍分别取证。

本轮只做方案／虚构UI增量及相称静态／浏览器／非作者复核，不安装、读业务文件或运行产品／DuckDB／模型。新增复用证据见[审计](../../../.local/fourbase-modules/m7-duckdb/formats-preparation/reuse-audit.md)；最终准备状态见[result](result.md)。
