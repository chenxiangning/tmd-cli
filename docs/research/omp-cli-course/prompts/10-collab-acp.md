# 第十课 · 用户视角 · `/collab` + ACP/Zed

> 配套主课:[10-collab-acp.md](./../10-collab-acp.md)
> 这一课解决:**多人协作 + 直接在编辑器里跑 agent**。
> 用户视角:`/collab` 分享 session + ACP (Agent Client Protocol, 把 agent 接入编辑器的协议) + Zed/VSCode。

---

## 场景 1 — `/collab` 把自己的 session 分享出去

**目的**:让同事看你的终端 + agent 对话,实时,不用录屏。

```bash
# 在 omp TUI 里:
/collab start --mode readwrite      # 或 readonly

# 输出一个邀请链接
https://omp.dev/collab/<session-id>#token=<token>

# 把链接发给同事,他们浏览器打开就能看(同 OPFS 实时)
```

**两种模式**:

| mode | 对方能力 |
| ------ | --------- |
| `readonly` | 能看 + 评论 + 在 chat box (聊天框) 里追加对话 |
| `readwrite` | 上面 + 直接控制 agent 改文件 |

**期望**:

- 多人在一个 session 同步,谁的 turn 都接得上;
- 可撤回 token: `/collab revoke <token>`。

**踩坑提醒**:

- 公开链接 = 安全风险,优先用 `--invite <email>` 只发给同事;
- 不要把 `readwrite` token 发给不可信的人。

---

## 场景 2 — 实战:code review 协作

```text
你(发起者):/collab start --mode readonly
   发链接给 reviewer。

reviewer:浏览器打开链接,看到你的 prompt + agent 的动作 + 文件变更。

reviewer:在 chat 框里追加 "你能不能换成 connection pool?" —— 跟你的 session 同一个对话流。

你:看到 reviewer 的提问,让 agent 回答。
```

**期望**:

- 一边写、一边被 review,不用"提交 PR → 等 → 改 → 再提";
- reviewer 看到的是真文件状态 + agent 内部消息。

---

## 场景 3 — 实战:Pair programming (结对编程)

```bash
# 两个人同时控 session,需要 readwrite
/collab start --mode readwrite
```

```text
甲方:打 "#3 改成 strict 模式"。

乙方:看 agent 改成 strict,审一下 diff,补一句"再加测试覆盖 negative 路径"。

agent:依次响应两边指令,谁的最新一条算 latest(默认"时间最新优先",可配)。
```

**期望**:

- 适合远程小团队 hackathon (编程马拉松);
- 双方都能 push 改动,带最新修改时间戳。

---

## 场景 4 — 实战:课堂 / 演示

```bash
/collab start --mode readonly --password "demo-session"
```

```text
教师:演示 session,学生看,不能改。

学生:浏览器开链接,在 chat 里提问,教师能看到并响应。

教师:控制全权,学生不会乱改文件。
```

---

## 场景 5 — ACP:在 Zed / 编辑器里直接跑 agent

**目的**:把 agent 接到 Zed 这种 IDE 的命令面板(类似 VSCode 的 Ctrl+Shift+P),不在终端里来回切。

```bash
# 1. 起 ACP server (omp 自带)
omp acp start --port 4733

# 2. Zed 里装 omp ACP 集成
#    Zed → 命令面板 → "Install omp ACP"
#    按 zed 文档流程即可,zac install omp

# 3. 在 Zed 里:
#    Ctrl+Shift+P → "omp: New Session"
#    选当前 workspace 的项目根
```

**你能在 Zed 里干什么**:

```text
- 选中一段代码 → Ctrl+L → "让 agent 解释/重构/写测试"
- Cmd+K → chat box,跟 agent 聊
- 选中文件 → "omp: Review this file"
- diff 视图内联展开,跟 VSCode 习惯一致
```

**期望**:

- agent 跑在 omp 进程里(不是另一个 dev server);
- 你的 IDE 状态、出文件改动全跟 omp sync;
- 跟 `/collab` 还能联动:多人共享同一个 editor session。

---

## 场景 6 — ACP vs VSCode plugin vs 跟 pi 的差异

| 维度 | VSCode plugin | **omp + ACP** |
| ------ | --------------- | --------------- |
| 集成深度 | 表面(只能 chat) | 深(选中代码 / diff / multi-file / LSP 全打通) |
| 协议 | 私有 | 公开 ACP (Zed / Neovim 等都能接) |
| Editor 选择 | 仅 VSCode | Zed 优先,其他 IDE 接 ACP 也行 |
| 文件安全 | 自己写 | 走 omp 的 Accept Card,同权限 |

**一句话总结**:
VSCode plugin 是"塞一个聊天框",ACP 是"把 agent 当 IDE 的 first-class citizen"。

---

## 场景 7 — 常见错误和排错

```bash
# ACP 起不了 / 端口冲突
omp acp start --port 4733          # 看到 "Address in use" 改端口

# 看不到 session
omp acp ls --json                  # 看 session id 是否对

# 协作 session 对方看不到文件改动
# 原因:对方不是 git collaborator
# 解决:要么 share repo,要么 /collab 改 mode=readonly + chat 沟通
```

| 症状 | 看哪儿 | 修法 |
| ------ | -------- | ------ |
| /collab 链接打不开 | token 是不是过期 | `/collab rotate-token` |
| ACP 起不来 | 端口冲突 | `lsof -iTCP:4733` 找占用 |
| 编辑器看不到 agent | 协议版本 | `omp acp --version` ↔ Zed 插件版本 |
| 多人协作出 diff 错乱 | 模式配错 | 改 `--mode=readwrite` 后重连 |

---

## ✅ 这一课你该会的事

1. `/collab start --mode readonly/readwrite`,发链接分享。
2. code review / 课堂演示 / pair programming 三种场景配不同 mode。
3. 用 `omp acp start --port 4733` 起 ACP,装到 Zed。
4. 知道 ACP 比 VSCode plugin 接得深、跨 IDE。
5. 排错思路:token 过期 / 端口冲突 / 协议版本。

---

## 🎯 下一课 →

[11-inheritance-filesystem.md](./11-inheritance-filesystem.md):继承 8 种 agent 格式 + 16 个内部 `scheme://` URL(`agent://` / `pr://` / `xd://` / `conflict://` / `skill://` / `ssh://`),用 read/write 替代 6 个工具。
