# CLI 触发器与会话能力矩阵:omp / pi / codex(+ claude / grok 增补)

> **2026-09-02 增补（claude 2.1.251 本机实证）**：`cli-claude` 插件已按本矩阵同法接入。要点：
> - **触发符**：`/` 命令、`@` 文件引用原生支持，纯透传；skill 原生语法为 `/skill-name`（`--help`: "Skills still resolve via /skill-name"），composer `$` 发送时翻译为 `/name`（同 omp 方案）；`!` bash 模式不在契约 TriggerKind 内，未声明。
> - **会话存储**：`~/.claude/projects/<slug>/<session-uuid>.jsonl`，文件名即 sessionId；slug = cwd 中所有非 `[a-zA-Z0-9]` 字符逐一替换为 `-`（实证：`/Users/x/.claude → -Users-x--claude`、`/Users/x/code/内容分析 → -Users-x-code-----`；本机全部会话目录校验 0 mismatch）。目录即 cwd 分区，无需读文件头过滤。
> - **恢复**：`claude --resume <uuid>` / `-c` 继续最近；`--fork-session` 分叉。
> - **状态**：assistant 行 `message.model` 为模型真相（尾部倒序最后一帧）；思考强度不落盘（settings 全局开关），不提供 thinkingLevel。
> - **额度**：`settings.json` env 的 `ANTHROPIC_BASE_URL`+key → vendors 检测走 HTTP（实证 kimi）；官方订阅 OAuth 无公开额度 API，显式报不支持。
> - **skill 候选**：`~/.claude/skills/<name>/SKILL.md`，目录名即 skill 名，composer `$` 下拉扫真实磁盘。

> **2026-09-02 增补(grok 1.0.4 本机实证,xAI 官方 Grok Build,`@xai-official/grok`)**:`cli-grok` 插件已按本矩阵同法接入。要点:
> - **触发符**:`/` 命令(`/model` `/new` `/load` `/compact` `/skills` `/plugins` 等,官方 README 斜杠命令表)、`@` 文件引用(fuzzy picker,支持 `@path:10-50` 行段与 `!` 前缀强制显示 hidden files)原生支持,纯透传;skill 无 `$` 语法,原生入口为 `/skills <name>`(注入上下文),composer `$` 发送时翻译为 `/skills <name>`(同 omp 方案)。
> - **会话存储**:`~/.grok/sessions/<encodeURIComponent(cwd)>/<session-uuid>/`,**会话 = 目录**;目录名即 sessionId(`/`→`%2F`、中文逐字符百分号编码,实证 `/Users/x/code/内容分析 → %2FUsers%2Fx%2Fcode%2F%E5%86%85…`)。目录内 `summary.json` 是元数据真相:`generated_title`/`session_summary`(标题)、`current_model_id`(模型)、`updated_at`/`last_active_at`(时间);对话记录 `chat_history.jsonl` 行型 `{"type":"user|assistant|reasoning|system","content":…}`(**无 role 字段**),真实用户输入由 CLI 包裹 `<user_query>` 标签(system prompt 协议明载),system-reminder/skill 注入行无此包裹天然滤除。
> - **恢复**:`grok --resume <uuid|标题>` / `-c` 继续最近;`--fork-session` 分叉;`grok sessions list/search` 子命令存在(实测本机索引返回空,以磁盘扫描为准)。
> - **状态**:`summary.json` 的 `current_model_id` 为模型真相(1KB 小文件,比 head 扫描便宜);推理强度不落盘 summary,不提供 thinkingLevel。
> - **额度**:`config.toml` `[model."<id>"]` 的 `base_url`+`api_key` → vendors 检测走 HTTP(本机实证 fufei.mossx.ai → relay);官方 OAuth(`grok login`)凭据不落 config.toml,无公开额度 API,显式报不支持。
> - **skill 候选**:`~/.grok/skills/<name>/SKILL.md`(另有项目级 `./.grok/skills/`、`~/.claude/skills/` 复用,官方优先级表),composer `$` 下拉扫 home 级真实磁盘。
> - **默认态**:`config.toml` `[models].default` → `[model."<id>"].model`(档案 id 缺省 = 二进制内置 "grok",`grok models` 实证;本机默认档案 wire 模型 = grok-4.6)。

> 调查日期：2026-09-01。方法：本机二进制 `--help` 输出、配置/会话目录实测、官方文档、二进制 strings 取证（只读）。未做任何交互式 TUI 启动。
> 用途：tmd-cli（Tauri + React + PTY + xterm.js 包装 CLI TUI）的 composer 透传与 session 管理设计输入。

## 0. 版本与形态

| CLI | 版本 | 形态 | 路径 |
|---|---|---|---|
| `omp` | 18.0.11 | Bun 编译的单文件 Mach-O（内部包名 `@oh-my-pi/pi-coding-agent`，pi-mono 系 fork） | `/opt/homebrew/bin/omp` → Cellar |
| `pi` | 0.84.4 | Node 脚本（`@earendil-works/pi-coding-agent`） | `~/.local/bin/pi` → `~/.hermes/node/.../dist/bundle/cli.js` |
| `codex` | codex-cli 0.150.1 | Node launcher + 218MB Rust 原生二进制（`@openai/codex-darwin-arm64/vendor/.../bin/codex`） | `~/.local/bin/codex` |

## 1. 触发字符矩阵（composer 输入侧）

| 触发 | omp | pi | codex |
|---|---|---|---|
| `/` 斜杠命令 | ✅ 内置命令 + 文件命令（`.omp/commands/*.md`、Claude/Codex/opencode 目录多 provider 汇聚）+ 扩展命令；未知 `/...` **不报错**，按字面文本发给模型 | ✅ `/` 打开命令补全；扩展可注册；prompt 模板以 `/name` 展开 | ✅ 命令面板（`/model` `/review` `/permissions` `/skills` `/mention` `/status` 等）；二进制含 `chat_composer/slash_input.rs` |
| `$` skill | ❌ 无内置证据。skill 走 `/skill:<name>`（需 `skills.enableSkillCommands`，二进制含正则 `/(^|\s)\/skill:([^\s/]+)(\s|$)/`）；另有「魔法关键词」（`ultrathink` 等纯文字，非 `$`） | ❌ 无内置。skill 以 `/skill:name` 暴露；`$` 仅作为**扩展自定义 autocomplete trigger** 的示例出现（`extensions.md`: "Set `triggerCharacters` for custom natural triggers such as `$`"） | ✅ 官方明确："Codex supports `$` mentions for skills"（`$skill-creator`）；`$` 也用于 app mention（`$github`）。二进制含 `tui/src/bottom_pane/skill_popup.rs`、`skills/src/mentions.rs`、`UserInput::Skill` |
| `@` 文件引用 | ✅ CLI 参数侧确定支持（`omp @prompt.md @image.png "..."`）。TUI 编辑器内 `@` 模糊搜文件：**高置信推断**（与 pi 同一 pi-tui 编辑器栈，omp 二进制内含 `prompt-action-autocomplete`/`internal-url-autocomplete` 等模块），omp 自带文档未直接写明 | ✅ "Type `@` to fuzzy-search project files"（usage.md/quickstart.md）；Tab 补全路径 | ✅ fuzzy file search：二进制含 `app-server/src/fuzzy_file_search.rs`、`tui/src/mention_codec.rs`、`UserInput::Mention`；等价命令 `/mention <path>` |
| 其他 sigil | `!`/`!!` 本地 shell（skill 文档提及 "local bash/Python execution sigil"）；`@<path>` 仅 CLI 参数 | `!cmd` 输出进模型；`!!cmd` 不进模型（usage.md） | 未发现 `!` shell sigil 证据 |

**对 tmd-cli 契约的含义**：契约 `$`=skill、`/`=命令、`@`=文件 在 **codex 上三键全部原生命中**；在 **omp/pi 上 `$` 不是原生 skill 触发**（原生是 `/skill:<name>`）。composer 若按契约把 `$` 原样透传给 omp/pi，CLI 会把它当普通文本（omp 未知斜杠尚会 fallback 为字面 prompt，`$` 更无特殊语义）——符合「不支持的 trigger = 无反应」预期，但补全 UI 不应向 omp/pi session 提供 `$` skill 候选（或映射为 `/skill:` 文本）。

## 2. 会话模型矩阵

| 维度 | omp | pi | codex |
|---|---|---|---|
| 存储位置 | `~/.omp/agent/sessions/<编码后cwd>/<ISO时间戳>_<uuid>.jsonl`（实测：`-code-AI-github-tmd-cli/2026-09-01T04-31-41-444Z_01a05b3c-….jsonl`）；named profile 隔离到 `~/.omp/profiles/<name>/agent/…` | `~/.pi/agent/sessions/<--编码后绝对路径-->/<时间戳>_<uuid>.jsonl`（实测 `--Users-chenxiangning-code-AI-github-mossx--/`） | 传统 rollout：`~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`（实测存在）+ `history.jsonl` + `archived_sessions/`；另有新版 SQLite 线程库 `state_5.sqlite`/`logs_2.sqlite`（`migrate-rollouts` 子命令做迁移） |
| 继续/恢复 | `-c/--continue` 最近会话；`-r/--resume [id]`（ID 前缀/路径/省略则 picker）；`--fork`；`--session-dir`；`--no-session` ephemeral；`--from-claude`/`--from-codex` 导入 | `-c/--continue`；`-r/--resume`（picker）；`--session <path\|id>`；`--session-id <id>`；`--fork <path\|id>`；`--session-dir`；`--no-session`；TUI 内 `/resume` `/tree` `/fork` `/clone` | `codex resume [SESSION_ID\|name] [--last|--all]`（无参=picker，UUID 优先）；`codex fork`；`codex exec resume --last`（非交互续跑）；`archive`/`delete`/`unarchive` 管理 |
| 会话内树形结构 | 有（session-tree 文档、`/tree`） | 有（`/tree` 可跳转历史任意点续写） | thread/turn 模型（app-server 协议 `thread/start`/`thread/resume`/`thread/fork`） |
| 配置目录 | `~/.omp/agent/config.yml`、`PI_CONFIG_DIR`/`PI_CODING_AGENT_DIR` 可覆盖 | `~/.pi/agent/`（`PI_CODING_AGENT_DIR` 覆盖） | `~/.codex/config.toml`（`CODEX_HOME` 覆盖；`-p <profile>` 叠加 `<name>.config.toml`；`-c key=value` 单次覆盖） |

## 3. 启动命令（在指定 cwd 起 session）

| CLI | 交互式 | 指定工作目录 | 非交互/headless | 关键 env |
|---|---|---|---|---|
| omp | `omp` 或 `omp "初始 prompt"` | `--cwd <dir>`（覆盖启动 cwd）；`--add-dir` 加工作区 | `omp -p "…"`（print 后退出）；`--mode json`（NDJSON 事件）；`--mode rpc`/`acp`（stdio JSON-RPC / ACP server）；非 TTY stdin 自动作为初始 prompt 读入 | provider key（`ANTHROPIC_API_KEY` 等）；`PI_SMOL_MODEL`/`PI_SLOW_MODEL`/`PI_PLAN_MODEL`；`OMP_*` 键在 dotenv 中镜像为 `PI_*`；`.env` 查找链：cwd → `~/.omp/agent/.env` → `~/.omp/.env` → `~/.env` |
| pi | `pi` 或 `pi "…"`（多 positional=多消息） | **无 `--cwd` flag**；需在目标目录 spawn（设子进程 cwd） | `pi -p "…"`；`--mode json`；`--mode rpc`（stdio）；print 模式会合并管道 stdin：`cat f \| pi -p "…"` | `PI_CODING_AGENT_DIR`、`PI_CODING_AGENT_SESSION_DIR`、`PI_OFFLINE`；provider key env |
| codex | `codex` 或 `codex "prompt"` | `-C/--cd <DIR>`；`--add-dir`；`--skip-git-repo-check`（exec） | `codex exec [PROMPT]`（无参或 `-` 时从 stdin 读；管道 stdin 与 prompt 并存时作为 `<stdin>` 块追加）；`codex exec --json`；`codex mcp-server`（stdio MCP）；`codex app-server`（JSONL-over-stdio / `ws://`） | `CODEX_HOME`；`CODEX_API_KEY`/`CODEX_ACCESS_TOKEN` 或 `~/.codex/auth.json`（ChatGPT OAuth）；`-s <sandbox>` `-a <approval>` |

注意：codex TUI 硬性要求 TTY——strings 取证：`Refusing to start the interactive TUI because TERM is set to "dumb"`、`stdin is not a terminal`。tmd-cli 必须走 PTY（与本项目架构一致）。

## 4. Stdin 注入 / 粘贴 / 多行证据

| 维度 | omp | pi | codex |
|---|---|---|---|
| bracketed paste | ✅ 明确文档：OSC 5522 enhanced paste 优先；**"When OSC 5522 is unavailable, bracketed paste still handles text"**；粘贴单个图片文件路径可加载为图片（keybindings.md）。TUI 输入栈 `StdinBuffer` 组装 bracketed paste 后再分发（tui-runtime-internals.md） | ⚠️ 文档未直接写 "bracketed paste"；但编辑器有粘贴处理+大段内容折叠（`ctx.ui.pasteToEditor` "triggers paste handling, including collapse for large content"）；与 omp 同一 pi-tui 输入栈 → 推断同样支持 | ✅ 二进制含 `tui/src/bottom_pane/paste_burst.rs`（粘贴突发合并）、`[Pasted Content N chars]` 折叠、`pasted image size=` 图片粘贴 |
| 多行输入 | Shift+Enter chord（pi 同栈文档明确；omp keybindings 文档列 Shift+Enter chord 命名；当前 build 默认绑定未逐条核实） | ✅ "Multi-line input: Shift+Enter"（usage.md） | 编辑器 keymap 含 `insert_newline` 动作（`TuiEditorKeymap`，17 个元素，scope 含 `composer`/`editor`）；默认键位未从文档确认 |
| 队列消息 | Enter=steer（流式中插队）、Ctrl+Enter/Ctrl+Q=follow-up（omp keybindings.md） | Enter=steering、Alt+Enter=follow-up、Alt+Up 取回（usage.md） | `codex queue --thread <UUID\|name> --message <TEXT>`（**外部进程向存活 session 注入消息的官方通道**，无需动 PTY）；TUI 运行中 Tab 排队 |
| headless 兜底通道 | `omp -p` / `--mode json` / `--mode rpc` / `omp acp` | `pi -p` / `--mode json` / `--mode rpc` | `codex exec`（stdin 可控）/ `codex exec --json` / `codex app-server`（ws/stdio 协议） |

## 5. 未知项（需交互式实测才能确认）

1. **omp TUI 编辑器内 `@` 模糊文件补全**：仅由 pi-tui 同源推断，omp 自带 130 篇文档未直述；需启动 `omp` TUI 敲 `@` 验证。
2. **paste burst 与 trigger popup 的交互**：通过 PTY 高速写入 `@...`/`$...`/`/...` 文本时，三者是否会把注入误判为 paste burst 从而**不弹补全**（codex `paste_burst.rs` 存在即暗示有抑制定时窗口）；tmd-cli composer 是自己画补全 UI 再透传最终文本，需实测确认透传文本不被折叠成 `[Pasted Content]`。
3. **codex `insert_newline` 的默认键位**（Shift+Enter? Ctrl+J?）及 `/skills` picker 在 PTY 尺寸极小时的行为。
4. **omp/pi 已安装扩展是否注册了 `$` 自定义 trigger**（机制上可行，`extensions.md` 明示）；omp 本机 `skills.enableSkillCommands` 当前值（决定 `/skill:` 是否可用）未读 config 确认。
5. **`codex queue` 注入的消息何时被消费**（下一 turn？立即 steer？）及与 TUI 内排队的优先级。
6. **会话文件编码规则的形式化定义**：omp（`-` 连接的路径段）与 pi（`--…--` 包裹）的 cwd→目录名编码仅从实例反推，边界字符（中文、空格、点）未验证。
7. **alt-screen**：codex 默认 alt-screen（`--no-alt-screen` 可关）；omp/pi 主屏渲染 + 终端 scrollback（pi `--tui-mode fullscreen` 才进类 alt-screen）。xterm.js 嵌入时 alt-screen 切换序列的实际表现需视觉实测。

## 6. 证据索引

- omp：`omp --help`（v18.0.11）；内置文档 `omp://cli-reference.md`、`slash-command-internals.md`（§7 未知斜杠 fallback）、`skills.md`（`/skill:<name>`）、`keybindings.md`（OSC 5522/bracketed paste）、`environment-variables.md`、`tui-runtime-internals.md`（StdinBuffer）；strings 取证 `/tmp` dump：`/skill:` 正则、autocomplete 模块清单。
- pi：`pi --help`（0.84.4）；包内 `docs/usage.md`（`@` 模糊搜、`/skill:name`、Shift+Enter、`!`/`!!`、session flags）、`docs/environment-variables.md`、`docs/extensions.md`（`$` 仅自定义 trigger 示例）。
- codex：`codex --help` / `codex resume --help` / `codex exec --help` / `codex queue --help`（0.150.1）；`~/.codex/sessions/2026/…/rollout-*.jsonl` 实测；二进制 strings：`skill_popup.rs`、`fuzzy_file_search.rs`、`mention_codec.rs`、`paste_burst.rs`、`insert_newline`、TTY 拒绝文案；官方文档 learn.chatgpt.com `skills-and-plugins`（"Codex supports `$` mentions"）、`developer-commands?surface=cli`（CLI 参考）。
