# 第十四课 · 用户视角 · 终极对比 + 实战综合 + 复盘

> 配套主课:[14-final-comparison.md](./../14-final-comparison.md)
> 这一课是 14 课的收尾:**今天就能用的清单 + 一周 / 一个月该走的多远**。
> 用户视角:不要"再学一遍",直接拿这三档清单执行。

---

## 场景 1 — 一个完整的 omp 工作日(走查 14 课全部主要特性)

```text
上午 9:00 ─ login 与起 session ────────────────
  $ omp login zai                 # 01 课 Coding Plan OAuth
  $ omp                           # 01 课 进 TUI

上午 9:05 ─ 任务准备 ───────────────
  > /vibe                         # 12 课:先只读
  > 看 src/auth/login.ts
  > 给我 5 条改进建议
  > /vibe off

上午 9:15 ─ 编辑 改造 ───────────────
  > 改 #42 加 atomic CAS          # 02 课 hashline
  > 把全部空 catch 改成 log+rethrow, acceptCard   # 02 课 ast_edit
  > /commit                        # 08 课 自动拆 commit

上午 10:00 ─ 复杂推理 ───────────────
  > ultrathink 这段 SSR 慢是为什么?      # 12 课 magic keyword

上午 10:30 ─ 多人审计 ───────────────
  > /collab start --mode readonly  # 10 课:发审阅链接
  > /review src/api/middleware.ts  # 03 课 verdict + confidence

上午 11:00 ─ 子代理并行 ───────────────
  > 跑 3 个 subagent,A 扫 exports,B 扫 deps,C 扫 hooks
                                   # 03 课 task fan-out
                                   # advisor 旁听每个 worker

中午 12:00 ─ 午休 ───────────────
  > 跑 workflowz release(自动跑 test+lint+release)
                                   # 12 课 workflowz

下午 13:30 ─ IDE 调试 ───────────────
  > 修一段 C 段错误 / 改 Python 类型错
                                   # 04 课 DAP / LSP

下午 14:30 ─ git 历史 ───────────────
  > omp commit,把上午的改动分批提交
                                   # 08 课 atomic commit

下午 15:30 ─ 长期记忆 ───────────────
  > retain "refresh token 必须 atomic CAS" tags=[auth,race]
                                   # 05 课 memory

下午 16:30 ─ 远程 ───────────────
  > 看一下 prod-1 上 nginx 错误日志
                                   # 11 课 ssh://

下午 17:00 ─ 编辑器联动 ───────────────
  > omp acp start --port 4733    # 10 课:在 Zed 里继续

下午 17:30 ─ 当日清理 ───────────────
  > /fresh                        # 12 课:清流状态
```

**期望**:你花在工具切换的时间几乎归零,大头都在"想 / 审 / 决策"。

---

## 场景 2 — 5 分钟内实操:立即可做

```bash
# 1. 起一个 vibe 模式 session(只读,安全)
$ omp
> /vibe
> 看一下 package.json

# 2. 试试 hashline 改一行
> 打开 src/auth.ts
> 改 #3 加 strict: true

# 3. 试试 web_search
> web_search "hono production readiness"

# 4. 试试 /fresh
> /fresh
```

**这一步的目的**:不学理论,先让手指记住 4 件事。

---

## 场景 3 — 一周内实操

1. **接 Coding Plan**:`omp login zai`(如果你已经用 GLM)/ `omp login cursor` / `omp login kimi`。
2. **配 fallbackChains**:config.yml 写 `[zai:glm-4.6, anthropic:claude-sonnet]`(07 课)。
3. **写一条 stream rule**:`~/.omp/agent/rules.yml` 写 no-sql-string-concat(09 课)。
4. **集成到 IDE**:`omp acp start --port 4733` 接到 Zed / VSCode(10 课)。
5. **复盘 1 个真实重构**:用 fan-out + advisor + /review 走完整闭环(03 课)。
6. **接一个 inbound PR**:用 `pr://` 直接评论+合并(11 课)。

---

## 场景 4 — 一个月内:变熟练

- **profile (画像)** :你常用哪种 agent posture?调 / modelRoles 优化;
- **memory 整理**:把项目里踩过的坑全部 retain,tag 分类(05 课);
- **skill 沉淀**:把"成功路径"学成 skill → promote 到 managed(05 课);
- **规则库**:rules.yml 攒 5~10 条(空 catch、SQL 拼接、console.log、Test must include edge case 等);
- **scope 拆分**:experiments 走便宜 model,prod 走 opus(06 课)。

---

## 场景 5 — 终极对比矩阵:omp / pi / opencode

| 维度 | pi | omp | opencode |
| ------ | ----- | ----- | ---------- |
| **Provider 数量** | 较多 | **60+**(含 Coding Plan) | 30+ |
| **OAuth / Coding Plan 一键登录** | 部分 | ✅ 30+ provider 直接 `/login` | 部分 |
| **并行子代理** | 无原生 | `task { workers, schema }` | 无原生 |
| **Advisor (顾问模型)** | 无 | 每回合旁听 | 无 |
| **`/review` verdict + 置信度** | 无结构 | ✅ verdict + confidence | 无 |
| **hashline (按行哈希锚点) 编辑** | 无 | ✅ omp 11 号电池 | 无 |
| **ast_edit + Accept Card** | 无 | ✅ omp 19 号电池 | 无 |
| **conflict:// 冲突 URL 化** | 无 | ✅ omp 18 号电池 | 无 |
| **LSP ops (IDE 级集成)** | 部分 | 14 个 ops | 部分 |
| **DAP ops (真调试器集成)** | 无 | 28 个 ops | 无 |
| **ast_grep** | 无 | ✅ 完整 | 无 |
| **三层 memory** | 无 | checkpoint / retain / skills | 简易 |
| **流式规则注入** | 无 | ✅ rules.yml,抗压缩 | 无 |
| **/collab 协作** | 无 | ✅ 含 ACL | 无 |
| **ACP / Editor 集成** | 无 | ✅ Zed / VSCode | 无 |
| **browser + computer (多模态)** | 无 | ✅ 全套 | 弱 |
| **scheme://(16 个内部 URL)** | 无 | ✅ | 无 |
| **ssh:// 远程** | 无 | ✅ 走 libssh (无需 scp) | 无 |
| **流状态控制 /vibe / /fresh** | 无 | ✅ | 无 |
| **Rust 内核** | 无 | ✅ pi-shell / walker / iso | 部分 |

**一句话总结**:
pi 是"单兵 run + 修代码";opencode 是"中型 IDE 集成";omp 是"全能 IDE-wired + 多模态 + 协作 + 真调试器"。

---

## 场景 6 — 什么时候用谁

| 场景 | 用谁 |
| ------ | ------ |
| 改一行、问个问题、单步小改 | **pi**(轻) |
| 大重构 / 多文件 / IDE 集成 / 调试 | **omp**(全) |
| 想轻量 web IDE 跑实验 | opencode |
| 多模态(浏览器/桌面) | omp |
| 并行子代理 + schema 校验 | omp |
| 真调试器 / DAP | omp |
| 只在你已经有 Coding Plan 时 | omp(套餐最划算) |

---

## 场景 7 — omp 的 Rust 内核速查

```
packages/coding-agent/    ← TypeScript UI / agent 编排层
                        ↓ 调
  packages/pi-shell/   ← Rust shell 引擎(起 worker)
  packages/pi-walker/  ← Rust AST (抽象语法树) 走查 + 引用图
  packages/pi-iso/     ← Rust 隔离执行 sandbox (沙箱,受限安全环境)
```

**对用户的意义**:

- 起 agent 多快:`pi-shell` fork-on-write (写时复制),毫秒级;
- LSP / DAP 多准:`pi-walker` 用 tree-sitter,跨语言;
- 多模态多稳:`pi-iso` sandbox,file 改动不会越界。

不用你写 Rust,知道"为啥快"就够。

---

## 场景 8 — 全程一个 read / write,16 个 schemes 速查

```text
你:read file:///path        # 文件
   read git://repo/HEAD/path # git 版本树
   read agent://task-1/...  # 子代理产物
   read pr://repo/pull/182  # PR
   read ssh://host/path     # 远程文件
   read conflict://conflict/abc   # 合并冲突
   read skill://managed/<name>    # skill
   write xd://system/rm    # 隐藏工具临时开
```

**期望**:你不用学 6 个工具,就一个 read、一个 write,加一串 scheme://。

---

## 场景 9 — 学习复盘:14 课路线图

```text
01 入门        ─ 装包 / 登录 / 切 role
02 编辑革命    ─ hashline / ast_edit / conflict://
03 智能协作    ─ task / advisor / /review
04 IDE 深度    ─ LSP / DAP / ast_grep
05 Memory      ─ 三层:checkpoint / facts / skills
06 多模型      ─ fallback / 凭据 / path-scoped / OAuth
07 Web search  ─ 23 provider / site-aware / NVD
08 omp commit  ─ atomic 提交 / 依赖图
09 Stream rules ─ 抗压缩 / cooldown / severity
10 collab + ACP ─ 协作 / 编辑器集成
11 scheme://    ─ 16 个 URL 替换 6 个工具
12 session 控制 ─ /vibe / /fresh / ultrathink / orchestrate
13 多模态      ─ browser / computer / generate / inspect / tts
14 复盘        ─ 本课
```

---

## 场景 10 — 一句话总结

> omp 是"pi 的 IDE-wired 全能化升级版":
> **多模型 + 并行子代理 + 真调试 + 多模态 + 协作 + 16 个 scheme:// + 三层 memory**,
> 一句话:把"agent 当成 IDE 的 first-class citizen,而不是终端里的聊天框"。

---

## ✅ 全部 14 课打包带走

把以下 14 个文件放进你的"日常使用小抄",用哪个翻哪个:

```text
01 安装 / 登录 / role
02 编辑(hashline / ast_edit / conflict)
03 协作(task / advisor / /review)
04 IDE(LSP / DAP / ast_grep)
05 Memory(三层 / checkpoint / facts / skills)
06 多模型(fallback / 凭据 / OAuth)
07 Web search(23 provider / NVD)
08 omp commit(atomic / 依赖图)
09 Stream rules(抗压缩 / cooldown)
10 /collab + ACP(协作 + 编辑器)
11 scheme://(替代 6 个工具)
12 session 控制(/vibe / ultrathink / orchestrate)
13 多模态(browser / computer / tts)
14 终极对比 + 复盘
```

---

## 🎯 下一步推荐路径

立即(今天):
→ [01 用户视角](./01-basics.md) 的场景 1-3(装包、登录、shell completion)

本周:
→ 把 Coding Plan 接进来 + 写第一条 stream rule + 接 ACP 到你的 editor

本月:
→ 用 fan-out + advisor + /review 完整跑一个真实重构,沉淀为 skill

---

## 附录:文档目录索引

- 全套主课:[../](../)(14 个 .md 文件 + README)
- 全套用户视角:[./](./)(14 个 .md 文件 + README)
- 项目级规则:`/AGENTS.md`
- mossx 整体文档中心:[../../../README.md](../../../README.md)
