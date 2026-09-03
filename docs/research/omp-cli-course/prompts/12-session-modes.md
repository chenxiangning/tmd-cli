# 第十二课 · 用户视角 · Session 控制 + Magic Keywords

> 配套主课:[12-session-modes.md](./../12-session-modes.md)
> 这一课解决:**用什么姿势控制 session,让 agent 在合适强度下答**。
> 用户视角:`/vibe`、`/fresh`、`/model` + 三个 magic keywords(魔法关键字)。

---

## 场景 1 — `/vibe`:只读 director 模式

**目的**:让 agent "只看不改",你掌握"动笔权"。

```text
你:/vibe

agent:Vibe 模式开启。
       - 工具只 read 类(read / search / grep / web_search)保留
       - edit / write / bash / docker.exec 全禁用
       - agent 提建议,但不真改文件

你:看一下 src/auth/login.ts,告诉我哪里有改进空间。

agent:建议:
       - L42 应该 atomic CAS(为什么:刷新 token 不并发会出 race)
       - L88 那个 console.log 应该删(为什么:会污染日志)
       - L120 try-finally 没关 file handle(为什么:会泄漏 fd)

你:嗯,具体怎么改 L42?

agent:建议:
       const next = await refreshAtomic(current)
       不直接给代码,你按"开 vibe 模式"自己写。
```

**期望**:

- agent **不**真改文件,只输出建议;
- 你看到全部建议后再 `/vibe off` 解除,自己亲手改;
- vibe 模式下 history + memory 仍照常生效。

**踩坑提醒**:`/vibe` 别停太久——一旦"只想不做",agent 就成了昂贵的 grep。

---

## 场景 2 — `/fresh`:重置流的"半状态"

**目的**:长 session 中途如果发现 context 太乱,不是 checkpoint/rewind,而是"清一下 stream 缓存"。

```text
你:聊了 20 轮,越来越乱 ——

你:/fresh

agent:重置流状态(stream + cache + RAG index)。
       checkpoint / long-term memory / skills 全保留,
       只清"这一会话内的杂讯"。

你:再来一次 "改 verifyToken 加 strict" ——从干净的状态。

agent:好。
```

**期望**:

- 跟 rewind(05 课)不同——fresh 只清"流"状态,不清"事实";
- 反复跑同一个对话会越来越慢,fresh 是"给对话来一次软重启";
- checkpoint / rewind 不被打扰。

**何时用**:

| 场景 | 用 |
| ------ | ---- |
| 上下文混了 | `/fresh` |
| 走错路要回到老决策 | `rewind` |
| 想"另起炉灶"但保留 facts | `/fresh` + 开新 thread |

---

## 场景 3 — `/model`:切当前 role 的模型

**目的**:临时把 default 切到 opus(应对一次重写),不影响全局 config。

```text
你:这次任务重,/model reasoning opus

agent:reasoning role 临时切到 opus,本次 session 生效。
       (= runtime override,不写 config)

你:任务跑完了,/model reasoning sonnet

agent:回到 sonnet。
```

**区别 / 速查**:

| 命令 | 作用 |
| ------ | ------ |
| `/model reasoning opus` | 切 reasoning role 到 opus(临时) |
| `Ctrl+P` | 弹 fuzzy picker (模糊搜索挑模型,输几个字找) |
| 写 `modelRoles.reasoning` | 改 config,影响所有 future session |
| `--max-thinking` flag | 单独调思考预算,不动 model |

**期望**:

- `/model` 是 runtime,默认不写盘;
- `/model --persist` 才写 config;
- 切完会显示"现在用谁"+ ETA 大概多少。

---

## 场景 4 — `ultrathink`:深度思考关键词

**目的**:某一个 turn 想要"agent 多想几步",而不是直接答。

```text
你:看一下 SSR 渲染慢的原因。
   ultrathink

agent:进入 ultrathink 模式。
       - thinking budget (思考预算,可消耗的最大推理 token 数) 默认 x2
       - 多轮 internal reasoning (内部推理,agent 自己跟自己辩论几轮)
       - 显式给出 "我考虑过的替代解释 + 各自证据"
       最终回答:
       ssr 渲染慢三处:
       1. React render 占 1.2s(占 60%)— 用 React Profiler dump 一次
       2. hydration (水合,服务端渲染的 HTML 在客户端激活为可交互页面) 占 0.5s — 已正确
       3. 网络 RTT 占 0.3s — 没办法
       ...
```

**期望**:

- 一次 turn 内 "深度推理开销 = ultrathink 系数 × 默认 thinking";
- 不是万能药——简单任务 ultrathink 是浪费;
- 配合 `/review` 用:让 ultrathink 答,/review 审。

**踩坑提醒**:`ultrathink` 多了 token 消耗直接爆,谨慎。

---

## 场景 5 — `orchestrate`:让 agent 主动 orchestration (编排调度)

**目的**:把"我手动决定谁来做"派给 agent,它自己拆子代理 / 调 advisor。

```text
你:把 src/auth 整个做一次安全审计。
   orchestrate

agent:orchestrate 模式:
       - 主流(opus)写"安全审计方案"
       - subagent A 扫 SQL 注入风险(04 课 ast_grep)
       - subagent B 扫 race condition(05 课 memory + ast_grep)
       - subagent C 扫 secret 泄漏(grep + ripgrep)
       - advisor 在每个 subagent 完成后旁听一次
       总耗时 / per-agent 状态都在 Hub 显示
```

**期望**:

- agent 自己拆、自己派、自己 review,你不写流程;
- 配合 advisor 让每一步不偏;
- 跟"手动任务(任务流)"的区别:orchestrate 是"用户不写 plan,让 agent 出 plan"。

**踩坑提醒**:orchestrate 自动产 file 改动,要 Accept Card 默认开。

---

## 场景 6 — `workflowz`:跑工作流定义

**目的**:你定义 .workflowz.yml,agent 按 workflow 跑。

```yaml
# .workflowz.yml —— 你的项目根
workflows:
  release:
    steps:
      - run: "npm test"
      - run: "npm run lint"
      - run: "omp commit"
      - run: "gh release create $TAG"
```

```text
你:准备发 0.9.5。
   workflowz release

agent:按 .workflowz.yml 的 release 定义跑:
       ✓ npm test
       ✓ npm run lint
       ⏳ omp commit (正在跑)
       ...
```

**期望**:

- workflow 是"用户写的、可重用的脚本";
- agent 按 workflow 逐步执行,出错停在出错点;
- 跟 orchestrate 区别:workflowz 是"我手写",orchestrate 是"agent 自己出"。

---

## 场景 7 — 关键词关系图

```text
ultrathink   → 想得更深
orchestrate  → 拆得更碎
workflowz    → 跑得更固定

/vibe        → 啥也不干
/fresh       → 啥都清掉
/model X     → 啥 model 来想
```

| 你想做的事 | 用什么 |
| ----------- | --------- |
| agent 想得深些 | `ultrathink` |
| agent 自己拆解 / 派子代理 | `orchestrate` |
| 按固定流程跑 | `workflowz` + .workflowz.yml |
| 只看不改 | `/vibe` |
| 清掉杂讯 | `/fresh` |
| 换 model | `/model X` |

---

## ✅ 这一课你该会的事

1. `/vibe` 一行进入只读 director 模式。
2. `/fresh` 清流状态、保留 facts。
3. `/model` 临时切当前 role,默认不写盘。
4. `ultrathink` 单回合深思考(谨慎烧 token)。
5. `orchestrate` 让 agent 自动拆解 + 派子代理。
6. `workflowz` 按 .workflowz.yml 跑固定流程。

---

## 🎯 下一课 →

[13-multimodal-desktop.md](./13-multimodal-desktop.md):browser(20 号电池)抓数据 / computer(21 号电池)桌面控制 / generate_image / inspect_image / tts。
