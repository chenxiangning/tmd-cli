# 内置终端入口实施评审

日期:2026-11-03
范围:`src/plugins/terminal/index.tsx`、入口回归测试、现行文档;版本号与提交历史不变。

## 结论

代码审查未发现 P0/P1/P2 问题,自动化验证全绿。普通点击与 Alt/Meta/Ctrl 点击统一新建 shell 会话,不再复用全局最新终端;每次创建由 `ShellSessionService` 现取当前激活工作区 root 作为 cwd。2026-11-03 用户确认「这个功能可收口」,功能验收完成。

## 四维审查

### 性能

- 删除每次普通点击的会话过滤、复制排序与最新项查找,不再产生 O(n log n) 的入口开销。
- 新路径只保留一次事件广播和一次异步创建,不新增轮询、订阅、定时器或常驻状态。
- 创建在途单飞闸继续抑制快速重复点击,避免双击造成重复 PTY 与订阅装配。

### 兼容性

- `SidebarAction.onSelect` 的 anchor/mods 公共签名不变,仅 terminal 不再解释 mods,其他动作不受影响。
- `host.createShellSession()` 调用形状不变;本地 shell、WSL spec provider、spawn/adopt、无工作区错误提示均沿用既有路径。
- OAuth 登录的终端复用逻辑和 worktree 显式 workspaceId 创建路径未改;既有终端 tab、侧栏切换与活跃态高亮未改。

### 稳定性

- `creating` 仍在创建 Promise 的 `finally` 中复位,成功与失败后都允许下一次独立点击。
- 创建失败仍由既有 `sessionStartFailed` 广播呈现,入口只负责避免未处理拒绝,不新增静默失败面。
- 不再主动调用 `setActiveSession` 复用旧会话;新会话仍由装配完成后的既有逻辑激活,避免激活指针提前落到旧终端。

### 正确性

- `open()` 不再读取会话表,因此“已有旧 shell 也必须新建”成为唯一入口路径。
- 不在入口缓存 workspaceId 或 root,点击创建时才由服务解析当前激活工作区,切换工程后不会沿用入口旧快照。
- 回归测试覆盖已有 shell 普通点击新建、三种修饰键一致、在途重复点击单飞、完成后再次点击再新建;服务测试继续钉住 `cwd="/repo"` 与 `workspaceId="ws1"`。

## 验证证据

- 聚焦测试:2 个文件、9 个用例通过。
- `pnpm check:gate`:文件规模、架构边界、i18n、kernel audit、类型检查、前端 611 文件/4748 用例、生产构建全部通过。
- Rust:`cargo test` 401 通过、5 忽略;`cargo clippy --all-targets -- -D warnings` 与 `cargo fmt --check` 通过。
- `npx react-doctor@latest -y`:100/100,无问题。
- `git diff --check`:通过。

## 真机边界与收口

- `pnpm tauri:dev` 因既有 1421 端口占用未能直接启动;未终止用户已有进程。
- 复用现有开发服务执行 `cargo run --no-default-features` 可启动进程,但出现 Focused 探针无应答;截图工具返回 `could not create image from display`,本环境未完成可靠的可见窗口点击验收。
- 2026-11-03 用户确认「这个功能可收口」,据此完成真机验收收口;工程 A 连开终端、切工程 B、tab 切换、修饰键一致与无工作区错误提示作为后续回归参考。

本批未修改版本号,未提交代码。
