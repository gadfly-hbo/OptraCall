# python-pptx 代码指南

主生成/编辑路线：python-pptx + stdlib zipfile（同 venv，见 scripts/requirements.txt）。本指南给出骨架与页型代码模板；版式取值见 design-system.md。

## 环境

```bash
python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt
# python-pptx>=1.0, pypdfium2, Pillow；LibreOffice 用于页图渲染
```

## 基础骨架

```python
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

NAVY, ACCENT, PAPER = RGBColor(0x26, 0x34, 0x42), RGBColor(0xB4, 0x46, 0x26), RGBColor(0xF7, 0xF6, 0xF3)
PANEL, LINE, INK, MUTED = RGBColor(0xFF, 0xFF, 0xFF), RGBColor(0xDE, 0xDC, 0xD6), RGBColor(0x24, 0x28, 0x30), RGBColor(0x62, 0x67, 0x73)

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
BLANK = prs.slide_layouts[6]
slide = prs.slides.add_slide(BLANK)
slide.background.fill.solid()
slide.background.fill.fore_color.rgb = PAPER

def text(slide, s, x, y, w, h, size=14, color=INK, bold=False, align=PP_ALIGN.LEFT, font='PingFang SC'):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = s
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    set_font(run, font)
    return box

def set_font(run, name):
    # python-pptx 的 font.name 只设 latin；中文需 eastAsia
    run.font.name = name
    rPr = run._r.get_or_add_rPr()
    ea = rPr.find('{http://schemas.openxmlformats.org/drawingml/2006/main}ea')
    if ea is None:
        from pptx.oxml.ns import qn
        ea = rPr.makeelement(qn('a:ea'), {})
        rPr.append(ea)
    ea.set('typeface', name)

def rect(slide, x, y, w, h, fill, radius=None):
    from pptx.enum.shapes import MSO_SHAPE
    shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE,
                                 Inches(x), Inches(y), Inches(w), Inches(h))
    shp.fill.solid(); shp.fill.fore_color.rgb = fill
    shp.line.fill.background()
    if radius:
        shp.adjustments[0] = radius  # 圆角比例 0~0.5
    shp.shadow.inherit = False
    return shp

def headline(slide, eyebrow, title):
    text(slide, eyebrow, 0.8, 0.55, 10, 0.3, size=11, color=MUTED)
    text(slide, title, 0.8, 0.95, 11.7, 0.9, size=26, color=NAVY, bold=True)
    rect(slide, 0.8, 1.85, 0.9, 0.045, ACCENT)

def page_number(slide, n, total):
    text(slide, f'{n:02d} / {total:02d}', 12.1, 7.05, 0.9, 0.3, size=10, color=MUTED, align=PP_ALIGN.RIGHT)
```

## 页型模板

### 封面

```python
slide.background.fill.fore_color.rgb = NAVY
text(slide, '01 / 经营复盘', 0.8, 1.6, 11.7, 0.4, size=12, color=RGBColor(0xD6, 0xDD, 0xE4))
text(slide, '2026 Q3 经营复盘', 0.8, 2.5, 11.7, 1.4, size=48, color=PANEL, bold=True)
rect(slide, 0.8, 4.1, 0.9, 0.045, ACCENT)
text(slide, '重点承压 · 长尾回暖 · 两条行动建议', 0.8, 4.4, 11.7, 0.6, size=17, color=RGBColor(0xD6, 0xDD, 0xE4))
```

### KPI 页

```python
headline(slide, '02 / 对比', '重点 880 万同比 -7.1%，长尾 +3% 形成反差')
for i, (v, label, hot) in enumerate([('880 万', '重点门店 Q3 销售', True), ('-7.1%', '重点门店同比', True), ('+3%', '长尾门店同比', False)]):
    x = 0.8 + i * 4.0
    rect(slide, x, 2.4, 3.7, 2.2, PANEL, radius=0.08)
    text(slide, v, x + 0.3, 2.7, 3.1, 1.0, size=44, color=ACCENT if hot else NAVY, bold=True)
    text(slide, label, x + 0.3, 3.9, 3.1, 0.5, size=12, color=MUTED)
page_number(slide, 2, 8)
```

### 图表页（原生可编辑图表）

```python
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
headline(slide, '03 / 趋势', '7–8 月销售回落')
cd = CategoryChartData()
cd.categories = ['7月', '8月']
cd.add_series('重点门店（万元）', (612, 588))
chart = slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(0.8), Inches(2.2), Inches(11.7), Inches(3.6), cd).chart
chart.has_legend = False
# 结论条
rect(slide, 0.8, 6.2, 11.7, 0.7, PANEL)
rect(slide, 0.8, 6.2, 0.045, 0.7, ACCENT)
text(slide, '重点门店连续两月走低，关注 9 月转化率', 1.0, 6.35, 11.3, 0.4, size=14)
```

### 文本页

```python
headline(slide, '04 / 结论', '三条核心判断')
for i, item in enumerate(['重点门店销售 880 万，同比 -7.1%', '长尾门店同比 +3%，客流恢复领先', '建议补货试点并监控 9 月转化率']):
    rect(slide, 0.8, 2.3 + i * 0.85, 0.08, 0.08, NAVY)
    text(slide, item, 1.05, 2.1 + i * 0.85, 11.2, 0.6, size=16)
```

## 陷阱

- **颜色不带 `#`**：RGBColor 用 16 进制分量（`RGBColor(0x26, 0x34, 0x42)`），不是字符串 `'#263442'`。
- **中文字体必须设 eastAsia**：只设 `font.name` 中文会回退默认字体（见 set_font）。
- **文本框内边距**：默认 margin 0.1"，对齐图形时先清零（见 text()）。
- **shape 阴影**：python-pptx 新建 shape 默认继承主题阴影，卡片用 `shape.shadow.inherit = False`。
- **长文本溢出**：没有可靠的自动 shrink——先控制文案长度（要点 ≤ 每条约 40 字），标题超长时降字号而非依赖自动缩放。
- **保存**：`prs.save(path)` 前确认目录存在；生成过程文件放 020_clean，最终候选版放 060_reports。
