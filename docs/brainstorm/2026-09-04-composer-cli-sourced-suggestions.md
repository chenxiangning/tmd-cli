# Composer 触发器补全重构:以 CLI 为真相源 —— 需求澄清

日期:2026-09-04
状态:已收敛(设计见 superpowers/specs/2026-09-04-composer-cli-sourced-suggestions-design.md)

## 用户原始诉求

对话框里 `/` `@` `#` `$` `!` 的命令唤醒与 CLI 原生相比缺很多东西:比如 `@` 看不到深层文件(截图里列出的是根目录 `/Applications` 一类),`/` 只有 3 条硬编码命令而 CLI 幕布里有几十条。用户的判断:对话框应该**调用 CLI 自己的对应指令获取当前 CLI 支持的信息**,客户端只负责显示。

## 澄清与实证(本次对话完成)

1. **omp 通道实证**:`omp --mode rpc` 发 `get_available_commands`,返回 46 条带描述/input hint/子命令的真命令表(静态表只有 3 条);还会主动 push `available_commands_update`。
2. **pi 通道实证**:`pi --mode rpc --no-session --offline` 发 `get_commands`,返回扩展命令 + prompt 模板 + skills(含用户装的 pi-lean-ctx / pi-condense 等扩展动态注册的命令)。
3. **EOF 语义**:两家的 RPC 在 stdin 立即关闭时都会丢响应,必须持开 stdin 等响应到达再杀进程(Rust 原语要支持 exitOnStdout 提前收割)。
4. **@ 现状根因**:suggest.ts 的 `@` 走 `ipc.fsListDir(".")`,相对路径落到 Tauri 进程 cwd(即根目录),且单层、无模糊、无 gitignore。
5. **pi 的 @ 语义**(bundle 取证):递归 walk + 跳过 dotfiles/node_modules + 吃 `.gitignore`/`.ignore`/`.fdignore`,对相对路径模糊匹配。
6. **其余 5 家布局**(两轮 scout 盘点,详见报告):claude/qoder/kimi/codex 磁盘布局清晰可扫;grok 有 `inspect --json`(0.23s 列 47 技能);codex 的 `~/.codex/prompts` 自 0.117 已废弃,真相是 skills;内置命令在 claude/codex/kimi/grok 均编译进二进制不可枚举。

## 用户决策(ask 确认)

| 问题 | 决策 |
|---|---|
| 覆盖范围 | 全部 7 个 CLI |
| `/` `$` 通道 | RPC 副车 + 静态兜底(有通道的 CLI);无通道的磁盘扫描/静态 |
| `@` 文件 | Rust 镜像 CLI 规则递归 walk + 客户端模糊匹配 |
| `#` `!` | 本轮不做(`!` 纯透传已可用;`#` 非 omp/pi 原生) |
| 设计确认 | 2026-09-04 当场确认,直接落盘并实施 |
