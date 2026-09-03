# 第十一课 · 用户视角 · 继承既有规则 + 16 个内部 `scheme://`

> 配套主课:[11-inheritance-filesystem.md](./../11-inheritance-filesystem.md)
> 这一课解决:**不用学 6 个工具,只学一个 read/write,配合 16 个内部 URL 协议就够了**。
> 用户视角:继承 8 种 agent 格式 + `agent://` / `pr://` / `xd://` / `conflict://` / `skill://` / `ssh://`。

---

## 场景 1 — 让 omp 直接继承我现有项目的 agent 规则

**目的**:你机器上已经有 `.claude/`、`.cursor/`、`.aider.conf.yml` 等 8 种格式的 agent 规则,omp 不要再"双份维护"。

```yaml
# ~/.omp/agent/config.yml
inheritance:
  sources:
    - ".claude/CLAUDE.md"
    - ".cursor/rules"
    - ".aider.conf.yml"
    - ".continue/config.json"
    - ".github/copilot-instructions.md"
    - "AGENTS.md"          # 我们项目里用这个
    - ".cody/behavior.json"
    - ".windsurf/rules"
```

```text
你:启动 omp,看到当前项目的规则有哪些。

agent:继承已生效,以下文件被加载:
       - AGENTS.md (最高优先级)
       - .cursor/rules/general.mdc
       - .aider.conf.yml (legacy format)
       ...
```

**期望**:

- omp 自动 follow 这些规则,**不**让你再写一遍;
- 重复规则按"本地 > 工具级 > 全局"优先级;
- 新规则混旧规则也认。

**踩坑提醒**:`inheritance.sources` 是列表,顺序影响优先级;放第一个的优先级最高。

---

## 场景 2 — `agent://` 读子代理产物:不用解析 JSON

**目的**:之前要用 `task` 工具看 worker 输出,要解析 JSON;现在 `agent://<id>/...` 直接读字段。

```text
你:刚才那个 subagent 扫出来的 exports 给我看看 UserCard 的 path。

agent:read agent://task-3/components/0

agent:
{
  "name": "UserCard",
  "path": "src/components/UserCard.tsx"
}
```

```text
你:再读它扫的 dependencyGraph 中跟 UserCard 相关的边。

agent:read agent://task-3/dependencyGraph/UserCard

agent:[ { "from": "src/pages/UserPage.tsx", "to": "UserCard" }, ... ]
```

**期望**:

- 每个 subagent 产出的 JSON 都对应一个 `agent://` URL;
- 用 `read` 工具(就一个工具)拿字段,不用学额外的 `task.get_result`;
- 路径语法跟文件一致,IDE / 浏览器都能浏览。

---

## 场景 3 — `pr://` 操作 PR:不用学 `gh` CLI

```text
你:看 PR #182 的 review 反馈。

agent:read pr://repo-mossx/pull/182/reviews

agent:[
  { reviewer: "@alice", state: "approved" },
  { reviewer: "@bob",   state: "request_changes", comments: 4 }
]

你:在 pr://repo-mossx/pull/182/comments 加一条 "LGTM,ship it"。

agent:write pr://repo-mossx/pull/182/comments { body: "LGTM,ship it" }

agent:已加。

你:把这 PR merge。

agent:write pr://repo-mossx/pull/182/merge { method: "squash" }

agent:已 merge (commit abc123)。
```

**期望**:

- 一组 URL 涵盖了"读 / 评论 / 合并";
- 不用学 `gh pr view / review / merge` 这一套;
- 行为统一,跟 `read/write` 文件一样。

**踩坑提醒**:写操作要 Accept Card,默认 confirm。

---

## 场景 4 — `xd://` 隐藏危险工具

**目的**:把 `bash` 之类敏感工具默认隐藏,只在你显式开才可用。

```yaml
# ~/.omp/agent/config.yml
hiddenTools:
  bash:           xd://system/bash
  rm:             xd://system/rm
  docker.exec:    xd://system/docker/exec
```

```text
你:想 rm 跑那批 tmp 文件?

agent:xd://system/rm 被隐藏。要开:
       /tools unhide xd://system/rm --expires 10m

你:/tools unhide xd://system/rm --expires 10m

agent:已开 10 分钟有效。继续。
```

**期望**:

- 默认"安全第一":bash / rm / docker.exec 都不在工具列表;
- 临时解锁,过期自动收回;
- session 结束失效。

---

## 场景 5 — `conflict://` 已讲(02 课)+ `skill://` 加载 skill

```text
你:我装了 skill:migrate-express-to-hono,帮我跑一下。

agent:read skill://managed/migrate-express-to-hono/manifest

agent:看到 manifest,自动执行:
       step 1:查 import 站点 → read skill://managed/migrate-express-to-hono/steps/01
       ...
```

**期望**:

- skill 内容也可 URL 化,跟读文件一样;
- 你可以 `read skill://user/my-rules/manifest` 看自己的 rule 是啥。

---

## 场景 6 — `ssh://` 远程工作(走 libssh (SSH 协议的开源实现库))

```text
你:我要看一下 prod-1 上的 nginx 错误日志,不用我登录。

agent:read ssh://prod-1/var/log/nginx/error.log --tail 200

agent:取到 200 行,你不用 ssh + tail,直接 cat-like 体验。

你:把 prod-1 的 /etc/nginx/conf.d/app.conf 改一下:开 gzip。

agent:write ssh://prod-1/etc/nginx/conf.d/app.conf { ... } --dry-run
       ── 先 dry-run 打印 diff
       ok 后:
agent:write ssh://prod-1/etc/nginx/conf.d/app.conf { ... } --apply
```

**期望**:

- 不用 `scp`,直接 read / write 远程文件;
- 自动 sudo (按 config);
- `--dry-run` / `--apply` 强制两步走。

**踩坑提醒**:

- 远程 write 默认要 Accept Card,无论 session 内 / 外;
- ssh key 配置走 `~/.ssh/`,不要把私钥贴进 config。

---

## 场景 7 — 16 个 schemes 速查表(挑你常用的)

| scheme | 例子 | 干嘛 |
| -------- | ------ | ----- |
| `agent://` | `agent://task-3/components/0` | 子代理产物 |
| `pr://` | `pr://repo/pull/182/comments` | GitHub PR |
| `xd://` | `xd://system/bash` | 隐藏危险工具 |
| `conflict://` | `conflict://conflict/abc/...` | 合并冲突(02 课) |
| `skill://` | `skill://managed/<name>/manifest` | 技能目录 |
| `ssh://` | `ssh://prod-1/var/log/...` | 远程文件 |
| `file://` | `file:///etc/passwd` | 本地文件 |
| `git://` | `git://repo/HEAD/path` | Git 版本树 |
| `http://` | `http://service/api/v1/...` | HTTP 调用 |
| `web+cmp://` | `web+cmp://excalidraw/...` | 富组件嵌入 |

其他 6 个略(详见主课 2.2)。

---

## 场景 8 — 综合:一周的某天

```text
你:(周一早上)
1. read git://repo/main/AGENTS.md → 看到今天任务
2. read agent://task-1/summary → 上周五 subagent 跑的结果还在
3. read pr://repo/pull/203/comments → 看代码评审反馈
4. write ssh://prod-1/etc/... → 改一行配置
5. /vibe → 进只读 director 模式继续验证
6. /commit → 用 omp commit 自动拆三个 commit
```

**期望**:

- 全程只用 read / write,不用学 6 个工具;
- 跨项目 / 跨机器 / 跨 PR 都能用同一套动作。

---

## ✅ 这一课你该会的事

1. `inheritance.sources` 接 8 种 agent 格式,自动生效。
2. `agent://<id>/field` 用 read 直接拿子代理产物字段。
3. `pr://repo/pull/N/...` 用 read / write 操作 PR。
4. `xd://system/<tool>` 隐藏危险工具,临时解锁。
5. `ssh://<host>/path` 不用 scp 直接改远程文件。

---

## 🎯 下一课 →

[12-session-modes.md](./12-session-modes.md):`/vibe` 只读 director 模式、`/fresh` 重置流状态、`/model` 切当前 role,以及三个 magic keywords(魔法关键字):ultrathink / orchestrate / workflowz。
