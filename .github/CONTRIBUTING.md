# 贡献指南

感谢关注 tmd-cli。动手前请先读根目录 [`AGENTS.md`](../AGENTS.md)——它是本仓库所有协作(人 / AI)的唯一规范入口,本文是其面向人类贡献者的展开。

## 环境前置

- Rust toolchain(stable,`rustup` 安装即可)
- Node.js ≥ 22、pnpm 10(版本由 `package.json` 的 `packageManager` 字段锁定,corepack 会自动接管)
- 至少一个目标 CLI 已装在本机:`omp` / `pi` / `codex` / `claude` / `grok` / `kimi` / `qoder` / `qoder-cn`

## 本地开发

```bash
pnpm install        # 安装依赖
pnpm tauri:dev      # 开发模式(Vite dev server + Tauri 窗口)
```

常用脚本:

| 命令 | 用途 |
|---|---|
| `pnpm typecheck` | TypeScript 检查 |
| `pnpm test` | Vitest 单元测试 |
| `pnpm build` | 前端产物构建 |
| `pnpm check:arch-boundary` | 架构边界检查(CI 强制) |
| `pnpm check:file-size` | 单文件 ≤500 行检查(CI 强制) |
| `pnpm tauri:build` | 打包桌面应用 |

## 提交规范

`type(scope): 中文一句话祈使句`,scope 用模块名(kernel / pty / git / files / composer / workspace / checkpoints / settings / welcome / 各插件 id 等)。范本见 `git log --oneline`。

## 架构铁则(CI 强制,提交前自查)

1. **500 行铁则**:单文件 ≤500 行(`.ts/.tsx/.rs/.css`)。
2. **R1**:`src/kernel/**` 不得 import 任何 plugins。
3. **R3**:`@tauri-apps/*` 唯一 import 点是 `src/kernel/ipc.ts`。
4. **R4**:`src/plugins/**` 不得反向 import app-shell(`@shell/*`)。

新增 UI / CLI 能力的标准路径:新建 `src/plugins/<id>/` 实现 `Plugin` 接口,在 `src/plugins/index.ts` 注册一行;跨插件基础契约先沉淀进 `src/kernel/`。PTY 幕布内严禁任何二次渲染(气泡 / Markdown / Diff),增强一律发生在幕布之外。

## 交付前验证

- 前端改动:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`
- Rust 改动(在 `src-tauri/` 下):`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`
- UI 行为改动:`pnpm tauri:dev` 打开真实窗口目检交互,测试绿不算数。

## 文档落盘

设计 / 评审 / 架构类产出有唯一去处与登记义务(见 `AGENTS.md` §0):落盘文档必须同步在 `docs/README.md` 文档索引表登记一行,否则视为未落盘。

## 提交 PR

1. 从 `main` 拉出功能分支,小步提交。
2. 确认上述验证全部通过。
3. PR 描述说清:改了什么、为什么、如何验证;模板已内置自查清单。
4. CI 全绿后等待 review;与 `AGENTS.md` 冲突时以当次 maintainer 指令 > `AGENTS.md` > 通用习惯的顺序裁决。
