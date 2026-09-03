# 第一课:启动、模型、工具调用 —— 与 pi 的对比

## 1. 安装 & 版本

```bash
# pi(已装)
bun add -g pi-coding-agent

# omp
brew install can1357/tap/omp             # macOS Homebrew
curl -fsSL https://omp.sh/install | sh   # macOS / Linux 脚本
bun install -g @oh-my-pi/pi-coding-agent # Bun 全局(官方推荐)
nix run github:can1357/oh-my-pi          # Nix

# 版本核对
omp --version
opencode --version
pi --version
```

> 小坑:omp 在 Alpine/musl (轻量 C 标准库) 上要 `apk add libstdc++ libgcc`;Windows 走 `irm https://omp.sh/install.ps1 | iex`;Bun 需要 ≥ 1.3.14。

## 2. 启动与 shell completion (命令行补全)

```bash
# 进交互式 TUI (文本用户界面)
omp
# 带任务直接跑(第一个非 flag 参数会被当作初始 prompt)
omp "在 src/ 里找出所有 TODO"
# 附件用 @ 前缀
omp @prompt.md @截图.png "这个报错怎么回事"
# 非交互:回答完就退出(headless)
omp -p "总结最近一次 commit 的改动"
# 子命令形式
omp setup          # 交互式 onboarding / 安装可选功能依赖
omp models spark   # 列出/验证自定义 provider (模型提供方) 的模型发现
omp completions zsh  # 生成 zsh 补全(从实时命令/flag 元数据生成,bash/zsh/fish 三种)
omp join <link>    # 加入协作 session(等同 /join)
```

### 补全机制对比

| | pi | omp |
|---|-----|-----|
| 静态 + 动态? | 部分 | **从实时元数据生成,永不漂移** |
| 覆盖范围 | 命令/flag (命令行参数) | 命令/flag/enum (枚举) 值;模型名(`--model`/`--smol`/`--slow`/`--plan`)查内置模型目录;`--resume` 补全磁盘上的 session id |

```bash
# 加进 ~/.zshrc
eval "$(omp completions zsh)"
```

## 3. 模型与 9 个 role (角色)

**pi** 只有"当前模型"一个概念,想换模型就 `--model xxx` 或 `/model`。

**omp** 把模型按 role 路由。`~/.omp/agent/config.yml`:

```yaml
modelRoles:
  default: openai-codex/gpt-5.5        # 日常 turn (一轮对话)
  smol:    minimax/MiniMax-M3-fast     # subagent fan-out 用便宜模型
  slow:    anthropic/claude-opus-4.7   # 深度推理
  plan:    anthropic/claude-opus-4.7   # plan mode 专用
  commit:  openai-codex/gpt-5.5        # changelog (变更日志)
  advisor: anthropic/claude-sonnet-4.5 # 旁听模型(第三课)
  vision:  google/gemini-3-flash       # 图像输入
  task:    minimax/MiniMax-M3          # subagent 工作模型
  tiny:    minimax/MiniMax-M3-tiny     # 后台轻任务:会话标题/记忆/思考分级
```

> 共 9 个内置 role。曾有 `designer`,v18.1.5 起移除。值可以写 `provider/model-id`,还能带思考档位后缀(`:low`/`:high`/`:xhigh`…),也可以指向另一个 role(`"@slow"`,YAML 里记得加引号)。

启动时临时覆盖某个 role:

```bash
omp --smol minimax/MiniMax-M3-fast "扫所有 console.log"
omp --slow anthropic/claude-opus-4.7 "重构 auth 模块"
```

只有 `default`/`smol`/`slow`/`plan` 四个 role 有启动 flag / 环境变量覆盖(`--model` / `--smol` / `--slow` / `--plan`,对应 `PI_SMOL_MODEL` 等);advisor 只能通过 `modelRoles.advisor` 配。

会话内:`Ctrl+P` 在当前 role 配置的模型之间循环(默认顺序 `smol → default → slow`,可用 `--models a,b,c` 自定义);`/model` 打开全 role 的 Roles 视图重选。

> 实战意义:同样一个 `task` 工具调起一堆 subagent,**主 agent 用 opus、subagent 用便宜模型**;advisor 再配一个旁听。多模型同时跑、自动路由。

## 4. 启动 flag (命令行参数) 常用表

| flag | 作用 | pi 有吗 |
|------|------|:---:|
| `--model <id-or-role>` | 覆盖 default 模型(接受 role 名如 `@slow`,也接受模糊匹配如 `opus`) | ✅ |
| `--smol <id>` / `--slow <id>` / `--plan <id>` | 覆盖对应 role | ❌ |
| `-p`, `--print` | headless:处理完 prompt 就退出(脚本化入口) | ⚠️ |
| `--mode json/rpc/acp` | 结构化输出 / RPC 服务 / ACP 服务 | ❌ |
| `--tools read,edit,bash` | **限制工具集** | ⚠️ 较弱 |
| `--continue` / `--resume [id]` / `--fork <session>` | 续接 / 恢复 / 分叉 session (会话) | ✅ 部分 |
| `--cwd <dir>` / `--add-dir <dir>` | 指定工作目录 / 追加工作区 | ✅ 部分 |
| `--append-system-prompt <text\|file>` | 临时追加 system 提示 | ✅ |
| `--yolo` / `--approval-mode` | 跳过审批 / 指定审批模式 | ❌ |
| `--advisor` | 开 advisor 运行时(headless 也能开) | ❌ |

`--tools` 这条很强:你想让 agent "只能读不能写",就 `omp --tools read,grep,glob "审计这段代码"`,写操作工具根本不注册。

## 5. 31 个工具的"调用层"和 pi 的差异

**完全对齐 pi**(可直接迁移用法):
- `read` / `write` / `edit` / `grep` / `glob` / `bash` / `todo` / `ask` / `task`
- `web_search` ❌(pi 没有,要自己接)

**改写/增强(同名但行为不同)**:
- `read` 是**多协议统一入口**:文件、目录、归档(zip/tar)、SQLite、PDF/文档、Notebook、URL、远程 `ssh://`,以及十几个内部 scheme (`pr://`、`issue://`、`agent://`、`skill://`、`conflict://`、`xd://` 等,第十一课展开)。可解析的代码文件还会返回**结构摘要**而不是全文倾倒
- `edit` 默认走 **hashline** 锚点(文件快照哈希 + 行号补丁语言),不是 `oldText/newText` 字符串替换(见第二课;另有 `apply_patch`/`replace` 模式可切)
- `bash` 跑的是**内嵌 brush bash**(Rust 实现的 bash,会话跨调用持久),配合 `pi-builtins` 里移植的命令行工具(coreutils/findutils/sed/jq/rg/fd/diff/moreutils 等,README 各处写 46/58/67 个,数字随版本漂移)。grep/sed/jq 都跑在 agent 进程里,**零 fork/exec (零子进程派生)**,跨 Mac/Linux/Windows 行为一致
- `eval` 是新增的,**持久 Python + JS cell**(`eval { language: "py", code: "import pandas as pd; ..." }`)。两种内核都能回调 agent 自己的工具(读文件、grep、起 subagent);Ruby/Julia 内核存在但默认关

**纯新增**(部分默认关,靠配置开启,第五/十三课讲门控):
- `ast_edit`、`ast_grep`、`lsp`、`debug`、`security_scan`
- `browser`、`computer`、`inspect_image`、`generate_image`、`tts`、`github`
- `hub`、`checkpoint`、`rewind`、`retain`、`recall`、`reflect`、`memory_edit`、`learn`、`manage_skill`

## 6. 与 pi 的"心智模型"差异(最容易踩的坑)

| 维度 | pi 心智 | omp 心智 |
|------|--------|----------|
| 一次只有一个模型在跑 | ✅ | ❌,**多模型协作**:主 + advisor + subagents 同跑 |
| 工具是黑盒 | ✅ | ⚠️ `xd://<device>` 是按需调用的设备面;`read xd://` 可以列出,`tools.xdev` 开启后可 `write xd://<tool>` 直接调 |
| 编辑靠字符串替换 | ✅ | ❌,**content-hash (内容哈希) 快照锚点**——stale (过时) 快照直接拒(第二课) |
| 子进程到处 fork (`grep` 调外部 binary) | ✅ | ❌,grep/glob/AST/shell 工具全 in-process (进程内执行) |
| 规则永远生效 | ✅ | ⚠️,**time-traveling rules (时间旅行规则)**:规则平时不烧 context,触发才注入(第九课) |

## 小结

- omp = pi 的 fork + Rust 内核 + 21 块新电池 + 多模型 + 31 工具
- 多出来的关键概念:`modelRoles`(9 种路由)/ `--tools` 限制 / `xd://` 设备 / `ast_edit` 预览 / `pr://` 等 schemes (协议路径)
- 与 pi 相同的部分:`read/write/edit/grep/glob/bash/todo/ask/task` 调用语法

## 下一课预告:第二课:编辑革命

- `[PATH#TAG]` 快照锚点是什么?为什么 stale (过时) 快照会被拒
- `ast_edit` 怎么做到"先预览后接受"
- `conflict://1` 这种 URL 怎么把 merge 冲突变成一行命令
