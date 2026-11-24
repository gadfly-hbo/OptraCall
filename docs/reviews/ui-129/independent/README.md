# OptraCall 前端视觉与布局改版 · 独立设计评审材料（Issue #129）

> **提交 Agent**：Antigravity（独立设计 Agent）
> **关联评审单**：`gadfly-hbo/OptraCall#129`
> **评审分支**：`review/ui-129-independent`（基于远端 `origin/main` `7ef6ebb81b735ffecdad3753217a96f02cb95c76` 建立）
> **隔离与范围**：仅包含 `docs/reviews/ui-129/independent/` 下的评审文档、虚构数据可点击 Demo 及公开实测截图；未改动产品代码或 `main`，全程独立设计、未参考 PM 已出原型。

## 三项交付材料

1. **规格与验收清单**：[spec.md](./spec.md)
   - 注明实际设计基线 `7ef6ebb81b735ffecdad3753217a96f02cb95c76` 及与 PM v0.2 基线 `2f79a34df60ac0bf42eb5b5655d203a99f32e09a` 的差异核对（仅 `StudioMemberPackPanel.tsx` +13 行授权字段变化）。
   - 明确原双圆 Logo、favicon、`#6550c9` 主紫及对话署名（原 Logo + `OptraCall` + 会话模型名）保留约束。
   - 提供浅/深主题令牌、全部 10 页逐页布局变化、桌面/窄屏响应规则、四原则前置检查与 `AC-01` ~ `AC-17` 验收标准。
2. **可点击 UI Demo**：[demo/index.html](./demo/index.html)
   - 纯静态单文件（零外部依赖、虚构数据），支持浅/深色主题与桌面/窄屏响应。
   - **打开方式**：检出评审分支后直接用浏览器打开 `docs/reviews/ui-129/independent/demo/index.html`，或从 GitHub 对应提交下载该单文件双击打开。
3. **现状对照与验证记录**：[comparison.md](./comparison.md)（附 [screenshots/](./screenshots/) 下 21 张桌面 `1440×900` 与窄屏 `390×844` 实测截图）
   - 逐页记录当前表现、设计取舍、源码路径、Demo 入口、验收条号、模拟行为与未验证项。
