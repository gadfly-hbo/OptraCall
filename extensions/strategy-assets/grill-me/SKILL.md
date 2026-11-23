---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

<!-- Provenance: upstream mattpocock/skills commit fb3629d3a2ba638a65ef336061204995be7f5d5e (MIT, Copyright 2026 Matt Pocock, see LICENSE). Local source: this machine's grill-me/grilling skill copy. The upstream interview method below is kept verbatim; the OptraCall adaptation section is added by this product. -->

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

If a question can be answered by exploring the codebase, explore the codebase instead.

## OptraCall 战略开题适配

在战略事项主会话中，把上述追问方法用于战略开题：沿组织与业务范围、时间视野、现状与外部变化、业绩差距与机会差距逐分支追问，优先追问会改变战略判断的歧义；每个问题给出推荐答案与依据。

- 资料沿获准入口查读：initiative-files / initiative-read-file 读取事项资料，initiative-read-kickoff 读取已有开题；未读到的内容不能当作已读证据。
- 需要公开信息时用 public-search 查证，并如实区分公开事实、推断与未知；无检索能力时沿用用户已知事实与明确假设，未知随报告保存。
- 收敛后按 initiative-save-kickoff 的字段保存开题草稿：3–5 个关键战略命题（稳定唯一 id、question、whyItMatters，可附 evidence/gaps），说明每个命题为什么影响选择。
- 锁定、应用与发布是决策者的治理动作，本技能不代行。