# QA 流程与已知陷阱

## QA 循环（每次生成/精修后必做）

1. **渲染出图**：`scripts/page_images.py --deck out.pptx --out pages/`
2. **逐页看图**：遮挡、溢出边界、对齐、对比度、字号过小；**封面与章节页的大留白按页型容忍**，不计缺陷。
3. **数字核对**：`scripts/digit_check.py --deck out.pptx --report 报告.md`——未命中数字必须回到报告找依据，找不到就删除或标注「报告未覆盖」。
4. 修复后**重渲受影响页**并复检；一次修复常引入新问题，至少完成一轮「修→验」循环再交付。
5. 占位文本检查：页面不得残留「待补充/placeholder/lorem」类字样。

## soffice 行为（实测结论）

- **损坏/无效 pptx 不会报错**：soffice 按文本文档静默转换成功（exit 0）。因此 page_images.py 自带前后闸门（zip 校验+页数；PDF 页数==slide 数），**绕过脚本手动调 soffice 时也必须做同样的页数核对**。
- 首次运行有数秒 fontconfig 初始化，之后单 deck 转换约 1s。
- `SOFFICE` 环境变量可指定二进制路径。

## 文本核对只能读 OOXML

- LibreOffice 导出的 PDF 部分子集字体缺 ToUnicode：部分中文长文本在 PDF 文本层提取不出（渲染正常）。**任何数字/内容核对都读 pptx zip 内 XML，不读 PDF 文本层。**
- 数字核对覆盖 slide `<a:t>` 与图表缓存 `<c:v>`（`ppt/charts/chartN.xml`）——图表是数字幻觉高发区。

## 单页拼回

- 替换页必须与目标 deck **同 sldSz**（先读 `p:sldSz`）。
- 含图片的替换页走 splice_slide.py（自动 rId 重映射与 Content_Types）；保留目标页 layout；被替换页的旧 notes 会被移除。
- 除目标 slide 及其 rels、必要的 Content_Types 外，其他 zip 条目保持字节不变——精修的「未改页不变」由此保证。

## zipfile 实现陷阱

- `zipfile.writestr(zinfo, data)` 会改写传入的 ZipInfo（header_offset 等），**复用源包 ZipInfo 会污染源包句柄**——写入时用文件名或新建 ZipInfo。
- 页序由 `presentation.xml` 的 `sldIdLst` 决定，拼回不改动它即保持页序。
