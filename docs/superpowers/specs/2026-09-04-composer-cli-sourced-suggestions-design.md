# Composer 触发器补全重构:`/` `$` `@` 以 CLI 为真相源

日期:2026-09-04
状态:已评审通过(用户确认:全部 7 个 CLI;RPC 副车+静态兜底;@ 走 Rust 镜像 CLI 规则+模糊;`#` `!` 本轮不做)

## 背景与目标

composer 触发器补全现状与各 CLI 原生 TUI 差距巨大:

1. **`/` `$` 是硬编码静态表**:omp/pi 只声明了 3 条,而 `omp --mode rpc` 实测返回 46 条真命令(todo/mcp/memory 等 11 子命令大命令、`skill:` 前缀技能、模板);pi 的扩展(pi-lean-ctx 等)动态注册的命令静态表永远拿不到。
2. **`@` 文件补全基本不可用**:`triggers/suggest.ts` 走 `ipc.fsListDir(".")`,相对路径落在 Tauri 进程 cwd(用户截图列出的是 `/Applications` 等根目录),且单层列举、前缀过滤、无 gitignore。pi TUI 自己的 `@` 是递归 walk + 跳 dotfiles/node_modules + 吃 `.gitignore`/`.ignore`/`.fdignore` + 相对路径模糊匹配(bundle 取证 `collectFiles`)。
3. **架构结论(用户判断,本次实证支持)**:补全数据应由 CLI 本身提供,客户端只负责展示。kernel/cli.ts 契约早已预留 `listSuggestions(kind, cwd)` 运行时发现接口,但 7 家插件均未实现。

目标:`/` `$` 候选来自各 CLI 自己的查询通道(RPC/子命令)或其磁盘真相(定义文件扫描),静态表退为兜底;`@` 候选来自 Rust 侧按 CLI 同款规则递归扫描 workspace,客户端模糊匹配。发送路径(`findActiveTrigger → translatePrompt → prepareSendPayload → writeSession`)零改动。

## 方案取舍

### D1 `/` `$` 数据通道(omp / pi)

**选定:RPC 副车一次性查询 + 静态兜底 + stale-while-revalidate。**
`omp --mode rpc --no-session` / `pi --mode rpc --no-session --offline`(临时进程、不留会话、不取模型目录),发查询、持开 stdin 等响应、按 stdout 标记提前收割后杀进程;结果在 TS 侧缓存 5 分钟,静态表即时渲染、动态结果两阶段合并。理由:命令/技能/模板/扩展注册是 CLI 运行时真相,磁盘扫描永远追不上扩展生态;冷启动 5-6s 被缓存与两阶段渲染吸收。

**否决:常驻副车进程。** 要管理 per-(profile, cwd) 生命周期、退出清理、版本升级竞态;一次性 spawn + 缓存覆盖同一需求,失败半径小。

**否决:逐键转发幕布抓屏。** 靠解析幕布 ANSI 抓 CLI 自己的补全弹窗,违反「PTY bytes 原样透传」铁律的增强层纪律,且渲染时序脆弱。

**否决:纯磁盘扫描。** 快,但扩展动态注册的命令拿不到(omp 实测 46 条里大量来自插件/内置注册),CLI 目录规则一变就漂移。

实测语义(2026-09-04,本机 omp 18.1.6 / pi 0.84.4):
- omp `get_available_commands` → `{name, description, input.hint, subcommands[]}`;技能以 `skill:` 名字前缀混在同一响应。
- pi `get_commands` → `{name, description, source: extension|prompt|skill, path}`;技能名带 `skill:` 前缀。
- 两家 stdin 立即 EOF 都会丢响应 → 必须持开等响应。
- TUI 专属命令(pi 的 /login /setup /settings 等)不在 RPC 返回里 → 静态表保留这部分。

### D2 `/` `$` 数据通道(grok / claude / qoder / codex / kimi)

| CLI | command 真相 | skill 真相 | 通道 |
|---|---|---|---|
| grok | 静态(内置编译进二进制,`inspect` 不含命令) | `grok inspect --json` → skills[](实测 47 条 0.23s,name/description/userInvocable) | 子命令 JSON |
| claude | `~/.claude/commands/**/*.md` + `<proj>/.claude/commands/**`(冒号命名空间 `dir:name`,frontmatter name/description/argument-hint)+ 插件 cache | `~/.claude/skills/*/SKILL.md` + 项目级 + 插件 cache | 磁盘扫描 |
| qoder | `.qoder/commands/**`(项目+用户级,`:` 命名空间,SKILL.md 目录=单命令) | `~/.qoder/skills` + `.qoder/skills` + `.agents/skills` | 磁盘扫描 |
| codex | 静态(内置不可枚举;`~/.codex/prompts` 自 0.117 已废弃不加载,是死配置,不扫) | `~/.codex/skills`(含 .system)+ `~/.agents/skills` + `<repo>/.agents/skills` + 插件 cache | 磁盘扫描 |
| kimi | 静态(kimi 无独立命令概念,技能即命令) | `~/.kimi-code/skills`(目录式 + 平铺 .md 双形态)+ `<repo>/.kimi-code/skills` + `~/.agents/skills` | 磁盘扫描 |

**选定(qoder):磁盘扫描而非 `qodercli skills list`**。该子命令纯文本无 JSON,解析漂移风险大于目录扫描;扫描规则与官方文档逐条对照过。
**选定(codex):不扫 `~/.codex/prompts`**。上游已废弃加载,扫了会给出假命令。
**共享沉淀**:SKILL.md 目录扫描(claude/qoder/codex/kimi 四家消费)与 commands/*.md 冒号命名空间扫描(claude/qoder 消费)进 `cli-shared/`,满足「≥2 个 cli 插件消费同一磁盘格式」准入;grok 的 inspect 与 omp/pi 的 RPC 共用同一 `proc_communicate` 底座与 JSONL 查询封装。

### D3 `@` 文件补全

**选定:Rust 镜像 CLI 规则 + 客户端模糊。** 新原语 `fs_walk_files(root, cap)`:`ignore` crate(ripgrep 同源)递归 walk,`hidden(true)` 跳 dotfiles、吃 `.gitignore`/`.ignore`/`.fdignore`、追加跳过 `node_modules` 段(与 pi `collectFiles` 语义一致),返回 workspace 相对 posix 路径,2 万条上限;TS 侧按 cwd 缓存 + smart-case 子序列模糊(basename 命中加权)。根=会话 workspace root,修掉进程 cwd bug。SSH 会话无本地 fs,`@` 不激活(现状本来就是坏的,显式声明为不支持)。

**否决:只修根目录不递归。** 治不了「模糊搜深层文件名」这一核心诉求。
**否决:幕布抓屏。** 同 D1。

### D4 内核边界与发送语义

- Rust 只加 `fs_walk_files` / `proc_communicate` 两个**通用**原语(不懂任何 CLI 格式);各家协议解析在 cli-* / cli-shared。`proc_communicate` 是通用短进程通道(spawn+stdin+收割+超时杀树+exitOnStdout 提前收割),信任级别与会话 spawn 一致。
- 静态与动态按 value 去重合并:静态条目的 action/token 语义保留(如 `/model` = send 幕布 picker),动态条目一律 `insert`(安全兜底:send 会立即写 PTY)。
- `#` `!` 本轮不做:`!` 本地 shell 纯透传已可用,`#` 非 omp/pi 原生语法,补全反而是自造语义。

## 落点

- `src-tauri/src/fs_walk.rs`、`src-tauri/src/proc_run.rs` + lib.rs 注册;Cargo.toml 增 `ignore`(MSRV 冲突则退 `git ls-files` + 段过滤,另记)。
- `src/kernel/ipc.ts` 增两原语封装。
- `src/plugins/cli-shared/`:`cliQuery.ts`(JSONL 查询+TTL+在途去重)、`skillDirs.ts`、`mdCommands.ts`、`fileIndex.ts`(walk 缓存+模糊)。
- 7 个 cli-* 插件实现 `listSuggestions`;`cli-pi/cli-omp` 另出 RPC 协议适配器(响应样例固化为测试 fixture)。
- `composer/triggers/`:`dynamicSuggestions.ts`(stale-while-revalidate,drawerItems 与 suggest 共用);`suggest.ts` 的 @ 改走 fileIndex+cwd,删除 dirListCache/逐层列举。
- `Composer.tsx`:传 cwd;file 触发仅本地会话激活。

## 验证

1. `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;Rust:`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`(src-tauri 下)。
2. 单测:RPC 响应 fixture → CliSuggestion 映射;SKILL.md/commands 扫描(tmp fixture);模糊匹配器;Rust walk 的 gitignore/dotfiles/node_modules 语义;proc_communicate 的 exitOnStdout 与超时。
3. `pnpm tauri:dev` 真窗口目检:omp 会话敲 `/` 见 46 条真命令、`$` 见 `skill:` 技能、`@a` 模糊出 `src/app-shell/…` 深层文件;抽屉 ⌘K 先静态后动态两阶段渲染;claude/codex 等各会话补全非空且含磁盘自定义项。
