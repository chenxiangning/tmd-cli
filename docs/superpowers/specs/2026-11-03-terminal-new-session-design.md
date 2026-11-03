# 内置终端入口:每次点击新建并继承当前工程目录

日期:2026-11-03
状态:已收口(用户指令「按照推荐做」;自动化验证通过,2026-11-03 用户确认功能可收口)

## 背景与目标

当前右缘「内置终端」入口普通点击会聚焦全局最新 shell 会话,只有 ⌥/⌘/Ctrl 点击才新建。该复用不限工作区,因此切换工程后可能重新打开旧工程中的终端,表现为只能打开一个且目录不正确。

目标:

1. 每次独立点击入口都创建一个新的 shell 会话并激活;
2. 新会话 cwd 使用点击时当前激活工作区的 root;
3. 保留既有终端 tab、侧栏切换、PTY 装配和错误提示,不改变其他显式创建终端的调用方。

## 方案取舍

**选定:入口直接新建。** `src/plugins/terminal/index.tsx` 普通点击不再搜索或复用最新会话,统一调用 `host.createShellSession()`;创建时继续由 `ShellSessionService` 解析当前激活工作区。实现最小,行为与用户预期一致。

**否决:仅复用当前工作区最新终端。** 虽然能修目录串用,但仍不满足每次点击都新建。

**否决:按当前会话所属工作区推断目录。** 当前会话与当前选中工程可能不同,会引入新的目录歧义;继续以激活工作区为唯一来源。

## 设计

- `open()` 删除 `forceNew` 参数和 latest/setActiveSession 分支;`onSelect` 不再解释修饰键,所有点击走同一新建路径。
- 保留模块级 `creating` 在途闸:一次创建尚未完成时的快速重复点击忽略,防双击意外多开;上一创建完成后的下一次点击必须再开新会话。
- 保留 `sessionViewRequested` 广播与既有启动失败提示。cwd、workspaceId、shell 类型、WSL 适配和 spawn/adopt 逻辑均不改。
- OAuth 登录的“复用最新终端”属于独立业务流程,不随入口变更;worktree 显式传 workspaceId 的创建路径不变。
- 新增 terminal 插件入口测试,mock host 验证:存在旧 shell 时普通点击仍新建;修饰键点击行为一致;创建完成后再次点击再次新建;在途重复点击仍单飞。
- 既有 `shellSessions.test.ts` 继续钉住 cwd=激活工作区 root;同步修订 FEATURES、architecture 中“点击聚焦最新”的旧约定及 CHANGELOG 0.4.8 小节。

## 验证

- 聚焦测试:terminal 入口与 `shellSessions` 契约测试通过。
- 全量执行 `pnpm check:gate`、Rust `cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`、`npx react-doctor@latest -y` 和 `git diff --check`。
- 真机验收:2026-11-03 用户确认「这个功能可收口」,据此完成验收;工程 A/B 目录、独立 tab 与无工作区错误提示作为后续回归参考。
- 不修改版本号,不提交代码。
