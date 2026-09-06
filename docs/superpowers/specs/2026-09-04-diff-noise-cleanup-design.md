# Diff 视图噪音清理:只展示代码变化 + hunk 分隔条

日期:2026-09-04
状态:已确认(用户选定:细分隔条方案,保留行号区间 + 函数上下文)

## 背景与目标

工作区 diff tab(`DiffTabContent`)与提交 diff tab(`CommitDiffTab`)共用 `PatchLines` 渲染,而 patch 文本是 Rust 侧 `git2::Patch::to_buf()` 原样返回的 unified diff,前 4 行是文件元数据头(`diff --git` / `index` / `--- a/...` / `+++ b/...`),路径、状态字母、±行数在 tab 头部已有一份展示,纯噪音;`@@` hunk 头混在代码行里也无视觉区隔,长 diff 难扫读。

目标:diff 正文只留代码变化相关内容——元数据头整段丢弃,`@@` hunk 头渲染为细分隔条(保留行号区间与函数上下文),`+`/`-`/上下文着色不变。

## 方案取舍

**选定:前端 `PatchLines` 状态机解析。** patch 是单 delta 单文件段,首个 `@@` 之前的行一律视为元数据头整段丢弃,之后按 unified 语义分类(不逐行做 `diff --git` 等前缀猜测,内容中以 `+`/`-` 开头的代码行不受误伤)。理由:单文件单点改动,两个消费 tab 同时受益;IPC 契约(`GitFilePatch.patch` 仍是合法 unified diff)不动,raw patch 语义保留。

**否决:Rust 侧剥头**(`diff.rs` / `commit_view.rs` 两处生产方各剥一遍)。改两处;`patch` 字段不再是合法 patch 文本,复制/导出语义破坏。

**否决:结构化 hunk 模型**(Rust 输出 JSON hunk 数组)。为词级高亮铺路,当前无此需求,契约膨胀,YAGNI。

## 渲染细节

- 首个 `@@` 前:全部丢弃(涵盖 `diff --git` / `index` / `---` / `+++` / `new file mode` / `rename from|to` / `similarity index` 等一切元数据行)。
- `@@ -a,b +c,d @@ ctx`:细分隔条 —— 上下细边框 + 弱化底色 + accent 弱化色,与代码行明确区隔。
- `\ No newline at end of file`:保留(faint),是文件末尾换行语义,非噪音。
- `+`/`-` 着色、`content-visibility:auto` 性能路径、滚动容器 className 契约全部不动。

## 验证

`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;`parsePatch` 回归测试覆盖:元数据头丢弃、内容行 `+`/`-` 开头不误伤、多 hunk 分隔、`\ No newline` 保留、空 patch。UI 目检随下次 `pnpm tauri:dev` 进行。
