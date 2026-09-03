# omp CLI 学习笔记

> 教学笔记 · 一课一文档
> 主讲:`omp`(oh-my-pi,coding agent 的 IDE-wired 版)
> 对照:`pi CLI`(oh-my-pi 是 pi 的 fork)

## omp 一句话

**omp = pi 的超集 + Rust 内核 + 21 块电池 + 多模型协作。**
调用模型、用工具、写 slash 命令这些"表层行为"和 pi 几乎一样,但 omp 在"重 IO 层"全用 Rust 替掉了 fork/exec,加了 LSP/DAP/multi-model/atomic-edit 等能力。

| 项目 | 仓库 | 关系 |
| ------ | ------ | ------ |
| pi | `badlogic/pi-mono` | 上游 (upstream) |
| omp | `can1357/oh-my-pi` | **fork** of pi,加 Rust + 21 块电池 |
| opencode | `anomalyco/opencode` | 同代 CLI,Go 实现,不是 fork |

## 课程路线图(已完结 14 课)

| # | 主题 | 文件 |
| --- | ------ | ------ |
| 01 | 启动、模型 role (角色)、31 个工具 | [01-basics.md](./01-basics.md) |
| 02 | hashline (按内容哈希锚点编辑) + ast_edit (结构化改) + conflict:// (冲突解决 URL) | [02-editing-revolution.md](./02-editing-revolution.md) |
| 03 | subagents (子代理 fan-out 扇出派发) + advisor (顾问模型) + /review (代码评审) | [03-smart-collaboration.md](./03-smart-collaboration.md) |
| 04 | LSP (语言服务器协议) + DAP (调试适配器协议) + ast_grep (结构化代码搜索) | [04-ide-depth.md](./04-ide-depth.md) |
| 05 | Memory 三层:checkpoint/retain/recall/reflect/learn/skill | [05-memory-system.md](./05-memory-system.md) |
| 06 | 多模型协作:fallback/凭据池/path-scoped/Coding Plan OAuth | [06-multi-model-routing.md](./06-multi-model-routing.md) |
| 07 | Web search:23 provider + site-aware extraction | [07-web-search.md](./07-web-search.md) |
| 08 | `omp commit` + `omp git`:message 生成 + changelog + worktree | [08-omp-commit.md](./08-omp-commit.md) |
| 09 | Time-traveling stream rules:`.omp/rules/` 触发式注入 + interruptMode | [09-stream-rules.md](./09-stream-rules.md) |
| 10 | `/collab` 协作 + Zed ACP 编辑器集成 | [10-collab-acp.md](./10-collab-acp.md) |
| 11 | 规则继承(上下文 9 来源 + 规则 7 来源)+ 16 个内部 schemes | [11-inheritance-filesystem.md](./11-inheritance-filesystem.md) |
| 12 | `/vibe` + `/fresh` + magic keywords | [12-session-modes.md](./12-session-modes.md) |
| 13 | browser + computer + generate_image/inspect_image/tts | [13-multimodal-desktop.md](./13-multimodal-desktop.md) |
| 14 | 与 pi 终极对比 + 实战综合 + 学习复盘 | [14-final-comparison.md](./14-final-comparison.md) |

## 21 块电池速查(README 编号)

| # | 能力 | 对应课 |
| --- | ------ | -------- |
| 01 | Code execution with tool-calling | (略) |
| 02 | LSP wired into every write | 04 |
| 03 | Drives a real debugger | 04 |
| 04 | Time-traveling stream rules | 09 |
| 05 | First-class subagents | 03 |
| 06 | Advisor (第二个模型旁听) | 03 |
| 07 | `/collab` 共享 session (会话) | 10 |
| 08 | Web search 内置 | 07 |
| 09 | 全 Rust 内置(无 fork/exec) | 14 |
| 10 | `/review` P0-P3 + verdict | 03 |
| 11 | Hashline 编辑 | 02 |
| 12 | GitHub is filesystem | 11 |
| 13 | Memory the agent curates | 05 |
| 14 | ACP (editor-drivable agent, 协议) | 10 |
| 15 | Inherits 既有 rules | 11 |
| 16 | `omp commit` 原子 + 验证 | 08 |
| 17 | 16 个内部 schemes | 11 |
| 18 | `conflict://` 一键解决冲突 | 02 |
| 19 | `ast_edit` 预览 + Accept | 02 |
| 20 | 真浏览器 / Electron | 13 |
| 21 | `computer` 桌面控制 | 13 |

## 31 个工具(omp 自带名字空间)

- **Files & search**: `read` / `write` / `edit` / `ast_edit` / `ast_grep` / `grep` / `glob`
- **Runtime**: `bash` / `eval`
- **Code intelligence**: `lsp` / `debug` / `security_scan`
- **Coordination**: `task` / `hub` / `todo` / `ask`
- **Desktop & web**: `browser` / `computer` / `web_search` / `github` / `generate_image` / `inspect_image` / `tts`
- **Memory & skills**: `checkpoint` / `rewind` / `retain` / `recall` / `reflect` / `memory_edit` / `learn` / `manage_skill`

## Rust 内核速查

上游 README 的分 crate 数据(行数为 README 口径,仅代码行):

| Crate (库名) | 行数 | 干什么的 |
| -------------- | -----: | --------- |
| `pi-shell` | ~38k | brush (bash 实现) 嵌入式 shell · 持久会话 · in-process (进程内) 工具分发 |
| `pi-natives` | ~25k | N-API (Node ↔ Rust 桥) 表面 |
| `pi-walker` | ~5.2k | 并行 ignore-aware (忽略感知) 遍历器 + scan cache (扫描缓存) |
| `pi-iso` | ~3.3k | workspace 隔离(apfs/btrfs/zfs/reflink/overlayfs/projfs/rcopy) |
| `pi-ast` | ~2.9k | tree-sitter (语法解析器) + ast-grep 匹配/重写 |
| `pi-voice` | ~1.0k | 音频 + Opus + WebRTC |

> 另有两个 workspace crate 不在上表(README 行数表未列):`pi-builtins`(bash 内建 + 内置命令行工具,uutils/jaq 移植)和 `pi-vcs`(gitoxide + Jujutsu 的进程内 VCS,v18.0.9 起)。内置工具数量上游 README 自身口径不一(58/46/67),以实际注册为准。

## 模型 role (角色) 表(共 9 个)

| role (角色) | 用途 |
| ------ | ------ |
| `default` | 日常 turn (一轮对话) |
| `smol` | subagent fan-out 用的便宜模型 |
| `slow` | 深度推理 |
| `plan` | plan mode 专用 |
| `commit` | changelog (变更日志) |
| `advisor` | 旁听模型(每 turn 注 note) |
| `vision` | 图像输入 |
| `task` | subagent 工作模型 |
| `tiny` | 后台轻任务(会话标题/记忆/思考分级) |

> `designer` role 曾存在,v18.1.5 已移除。


## 学习约定

- 所有英文术语第一次出现都加中文翻译注释,格式 `English (中文)`
- 每个文件末尾有"小结"和"下一课预告"
- 文件可独立阅读,互不强制依赖
- 完成 14 课后,参见 [14-final-comparison.md](./14-final-comparison.md) 的"推荐下一步实操"部分
- 版本动态:[releases.md](./releases.md) 记录最近版本解决的问题(基于 GitHub release notes)
