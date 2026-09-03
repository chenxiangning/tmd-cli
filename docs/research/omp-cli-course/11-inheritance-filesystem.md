# 第十一课:继承既有规则 + 16 个内部 schemes

omp 的 15 号 + 12 号 + 17 号电池——"你团队已经写好的规则,直接继承"和"万物皆 URL"。

## 1. 继承既有 agent 规则(15 号电池)

### 1.1 两类"规则",omp 都读

**A. 上下文文件**(AGENTS.md 一族)——整篇注入 system prompt:

| 来源 provider(优先级) | 文件 | 位置 |
| ------- | --------- | ------ |
| `native`(100) | `.omp/AGENTS.md` | 项目(最近的非空 `.omp/`,不向上爬)+ `~/.omp/agent/AGENTS.md` |
| `claude`(80) | `CLAUDE.md` | `~/.claude/` + 项目 `<cwd>/.claude/`(不向上爬) |
| `codex`(70) | `AGENTS.md` | `~/.codex/` |
| `agents`(70) | `AGENTS.md` | `.agent/`、`.agents/`(向上爬到仓库根) |
| `gemini`(60) | `GEMINI.md` | `~/.gemini/` + `<cwd>/.gemini/` |
| `opencode`(55) | `AGENTS.md` | `~/.config/opencode/` |
| `github`(30) | `copilot-instructions.md` | `<cwd>/.github/` |
| `agents-md`(10) | 散装 `AGENTS.md` | 项目根,向上爬 |
| `claude-md`(10) | 散装 `CLAUDE.md` | 项目根,向上爬 |

**B. 规则文件**(可带触发条件,进规则管线;第九课的 TTSR 就吃这里)——上游 README 说的"eight formats"主要指这一侧:

| 来源(优先级) | 格式与位置 |
| ------- | --------- |
| `native`(100) | `.omp/rules/*.md` / `*.mdc` + 粘性 `RULES.md`(强制常驻) |
| `agents`(70) | `.agent/rules/`、`.agents/rules/` |
| `cursor`(50) | `.cursor/rules/*.mdc`(MDC,带 frontmatter) |
| `windsurf`(50) | `.windsurf/` 的 `global_rules` |
| `cline`(40) | `.clinerules` |
| `github`(30) | `*.instructions.md`(Copilot `applyTo` frontmatter → 自动转 globs) |

> 注意:README 的宣传语列了 "Cursor MDC, Cline .clinerules, Codex AGENTS.md, Copilot applyTo, and the rest"。Aider `CONVENTIONS.md`、Continue、Cody 这三家**不在**实际支持清单里——别写进你的迁移文档。

### 1.2 冲突怎么裁决(阴影规则)

- 全局只活**一份**用户级上下文文件(native 阴影掉其它);项目内每个目录深度活一份,同深度优先级高者赢
- 字节级相同的重复文件折叠,离 cwd 最近的留下
- 注入顺序:越远的祖先越先,用户级文件最后(最显眼)
- 包裹成 `<repo-rules><file path="…">…</file></repo-rules>` 注入
- 支持 `@path` import:相对导入文件解析,`~/` 到 home,最多 5 跳,循环跳过
- 关掉某一家:`disabledProviders`(与模型 provider 共享命名空间);只关某个文件:`disabledExtensions: context-file:<level>:<basename>`;TUI 里 `/extensions` 可视化开关

### 1.3 实战

```text
[项目目录]
.cursor/rules/api-design.mdc      ← Cursor 格式
.clinerules                        ← Cline 格式
AGENTS.md                          ← Codex/通用格式
.github/copilot-instructions.md    ← Copilot 格式

[omp]
4 份规则全部原生读取,统一进规则管线
不用写 YAML 转换脚本,没有"supported subset"脚注
```

### 1.4 与 pi 对比

| | pi | omp |
| --- | ----- | ----- |
| 读 Cursor MDC / Cline / Copilot | ❌ | ✅(连优先级都替你排好) |
| 读 Codex AGENTS.md | ✅(自家) | ✅ |
| 多种格式混合 + 冲突裁决 | ❌ | ✅ 阴影规则 |

## 2. 16 个内部 schemes (协议路径) (17 号电池)

### 2.1 心智模型

omp 把"任何东西"都当成 URL 路径,**一个 `read` 工具搞定所有**:

```
read src/foo.ts                  ← 普通文件
read https://arxiv.org/...       ← URL(第七课讲过)
read ssh://user@host/path        ← 远程
read pr://1428                   ← GitHub PR
read issue://455                 ← GitHub Issue
read agent://<id>                ← subagent 产出
read skill://bun-setup           ← 加载 skill
read conflict://1                ← merge 冲突(第二课)
```

agent 不需要学 30 个工具,只用 `read`/`write`。

### 2.2 全部 schemes 一览(read/write 认的完整清单)

| scheme (协议路径) | 干什么 | 用例 |
| ------ | ------ | ------ |
| `pr://<n>` | GitHub PR(标题/描述;`?comments=0` 等) | `read pr://1428` |
| `issue://<n>` | GitHub Issue | `read issue://455` |
| `agent://<id>[/<child>]` | subagent 最终产出(嵌套点号路径) | `agent://Task/findings.0.path` 取 JSON 字段 |
| `history://<id>` | subagent 转录(live/parked) | 复盘子代理干了什么 |
| `artifact://<id>` | 产物内容(可翻页) | `read artifact://7` |
| `local://<name>` | 会话共享文件(派发子代理用) | `write local://ctx.md` |
| `memory://` | 记忆库(MEMORY.md / 单条记忆) | `read memory://root`(第五课) |
| `skill://<name>[/<path>]` | skill 目录内容 | `read skill://deploy/SKILL.md` |
| `rule://<name>` | 规则全文 | `read rule://box-leak`(第九课) |
| `security://` | 安全扫描结果(只读) | `security_scan` 的产出 |
| `vault://` | 凭据保险库相关 | auth-broker 场景 |
| `mcp://<uri>` | MCP 资源 | `read mcp://server/doc` |
| `omp://<doc>` | omp 自带文档(130 篇) | `read omp://tools/edit.md` |
| `ssh://host/<path>` | 远程文件(UTF-8,≤1MiB) | `read ssh://dev@host/etc/app.conf` |
| `conflict://<n>|*` | merge 冲突(读+写) | `write conflict://1 "@ours"` |
| `xd://<device>` | 工具设备(JSON 进,结果出) | `write xd://lsp {...}` |

> 曾经课程里写的 `repo://` 和 `xd://log` **不存在**;GitHub 仓库内容走 `github` 工具(11 个 op,需装 `gh`)或 `pr://`/`issue://`。

### 2.3 实战:`agent://` 取子代理产出

```text
[子代理 ComponentsExports 完成后]
read agent://ComponentsExports
→ 完整产出

read agent://ComponentsExports/exports.0.path
→ "src/components/UserCard.tsx"(JSON 路径直取字段,不用肉眼解析)
```

### 2.4 实战:`pr://` 看 PR

```text
[用户]
1428 这个 PR 有什么问题?

[agent]
read pr://1428          # 标题/描述
read pr://1428?comments=1   # 评审意见
# 全部走 read,不用学 gh 的子命令
```

### 2.5 实战:`skill://` 按需展开

```text
read skill://bun-project-setup
→ 返回 SKILL.md 全文,agent 按它的流程走
```

## 3. ssh:// 远程工作

```text
read ssh://user@server/etc/app.conf
write ssh://user@server/var/www/app.conf  "<新内容>"
```

- 走系统 ssh,要求远端是可用 POSIX shell;只读传输上限 1MiB
- `omp ssh` 子命令管理主机配置(别名、跳板等)
- 深度用法(远程执行命令)配合 bash 工具:`ssh host "tail -100 app.log"`

## 4. 实战综合:一周的某天

```
[用户]
帮我看 PR #1428,reviewer 提了什么?顺手把 CI 日志里的报错对一下。

[agent]
read pr://1428                      → 改了什么
read pr://1428?comments=1           → reviewer 意见
bash: ssh ci-runner@build-host "tail -200 /var/log/ci/1428.log"
                                    → CI 日志
read omp://tools/edit.md            → 顺手查了个工具文档
# 全程 read/write/bash,不用为每个系统学一个新工具
```

## 5. 与 pi 的全景对比

| 维度 | pi | omp |
| ------ | ----- | ----- |
| 读其它 agent 的规则 | 1 种(自家) | ✅ 上下文 9 来源 + 规则 7 来源 |
| URL schemes | ❌ | ✅ 16 个 |
| 远程 ssh:// | ❌ | ✅ |
| agent:// 取字段 | ❌ | ✅ |
| 统一 read 接口 | ❌ | ✅ |

## 小结

| 武器 | 干什么 |
| ------ | -------- |
| 多来源规则继承 | 读团队既有规则,优先级/阴影自动裁决 |
| `read <url>` | 一个工具搞定一切 |
| 16 schemes | pr / issue / agent / history / skill / rule / ssh / conflict / xd / ... |
| `RULES.md` 粘性规则 | 团队红线常驻,不靠触发 |

和 pi 的对照:**pi 让 agent 学一堆工具,omp 让 agent 学一个 read + URL 协议**。

## 下一课预告:第十二课:Session 控制 + magic keywords

- `/vibe` director + worker 模式(fast/good 两档)
- `/fresh` 重置 provider 流状态
- `/model` 与 Ctrl+P
- 三个 magic keyword:ultrathink / orchestrate / workflowz
