# 第三课:智能协作 —— subagents + advisor + /review

这一课讲 omp 怎么把"一个 agent 单干"升级成"多 agent 协作",这是和 pi 心智差异最大的一块。

## 1. 为什么需要多 agent?

| 场景 | 单 agent 的痛苦 |
|------|-----------------|
| 大重构(把 50 个文件从 React 类组件迁到 Hooks) | context (上下文窗口) 撑爆、token 烧光、改到一半忘了初衷 |
| 同时审计前端/后端/测试/文档 | 串行太慢,质量也低(同一个模型同一种思维) |
| 监控正在跑的 agent 的判断 | 没人盯,模型写脏代码你也不知道 |

omp 用三种武器分别解决:

| 武器 | 场景 | 入口 |
|------|------|--------|
| **`task` subagent (子代理扇出)** | 大任务拆分并行 | `task` 工具 |
| **advisor (顾问模型)** | 每 turn 旁听 | `/advisor` 或 `--advisor` |
| **reviewer (审查子代理)** | 一次性出 verdict (裁决) | `/review` 或直接派 `reviewer` agent |

---

## 2. `task` 工具:subagent (子代理) fan-out (扇出)

### 2.1 心智差异(和 pi 比)

```
pi 的 subagent 子代理:
  ┌──── 主 agent ────┐
  │ 派一个对话:      │
  │ "帮我跑 X"       │
  └──────────────────┘
   ↓  prompt delegation (提示词委托):把任务文本丢给另一个会话窗口
   ↓  产物: 一段 prose (自然语言描述)
   ↓  父 agent 只能 parse (解析) 自然语言
```

```
omp 的 subagent 子代理:
  ┌─────────── 主 agent ───────────┐
  │ task { context: "共享背景",     │
  │        tasks: [ 3 个任务项 ] }  │
  └─────────────────────────────────┘
   ↓ 每个任务项一个独立子会话,并行跑
   ↓ 产物: schema-validated (按结构校验过的) JSON
   ↓ 父 agent 直接 .findings[0].path
```

**最关键三点差异**:

1. **每个子代理是独立会话**(不继承父对话历史;共享的是项目工作区、skills、上下文文件)
2. **产物是 schema-validated JSON (按结构校验过的)**——`outputSchema` 校验不过会重试/报错,父 agent 不用猜 prose (自然语言) 意思
3. **finish 必须走隐藏的 `yield` 工具**——超时没 yield 会被最多提醒 3 次后强制收敛,不会"说完就散"

### 2.2 一个完整例子

任务:**"把整个 src/ 从 React 类组件迁到 Hooks"**

```js
task {
  context: "React 类组件迁移 Hooks。仓库用 pnpm,TS strict。只调研不改码。",
  tasks: [
    {
      name: "ComponentsExports",
      agent: "scout",
      task: "扫描 src/components/**,列出所有 default + named exports + 依赖关系",
      outputSchema: {
        type: "object",
        properties: {
          exports: { type: "array", items: { type: "object" } },
          dependencyGraph: { type: "object" }
        },
        required: ["exports", "dependencyGraph"]
      }
    },
    { name: "RoutesExports", agent: "scout", task: "同样扫 src/routes/**", outputSchema: { /* 同上 */ } },
    { name: "HooksExports",  agent: "scout", task: "扫 src/hooks/**,返回所有 hook signatures",
      outputSchema: { type: "object", properties: { hooks: { type: "array" } } } }
  ]
}
```

要点:

- **`context` 必填**:整批共享的背景,会渲染进每个子代理的 system prompt
- 每项 `{ name?, agent?, task, outputSchema?, schemaMode? }`;`agent` 缺省用默认类型,可指定内置的 `scout`(只读调研)/`reviewer`(评审)/`security-reviewer`(安全)/`librarian`(文档)/`task`(通用)/`sonic`(快)
- 默认**后台 job**:调用立即返回 job id,结果完成后自动注入父对话
- 父 agent 读结果:`agent://ComponentsExports` 拿完整产出;`history://ComponentsExports` 看过程转录
- 需要文件级隔离时,给任务项加 `isolated: true`(要求 `task.isolation.enabled`,默认关):子代理在隔离工作区(APFS/Btrfs/ZFS reflink/overlayfs…)跑,完成后以 patch 或分支方式合并回来
- 子代理之间/父子之间走 **hub 消息**(IRC 风格点对点),比如 ComponentsExports 直接 DM HooksExports "你那个 useAuth 还在用吗?"——不污染主对话

### 2.3 与 pi 对比表

| 维度 | pi subagent | omp `task` |
|------|-------------|-----------|
| 实现 | prompt delegation | 独立子会话 + 独立工具面 |
| 产物 | prose | schema-validated JSON (`outputSchema`) |
| 并行 | 手动起多次 | `tasks[]` 一句话 fan-out |
| 子代理间通信 | 无 | hub 消息(可唤醒 parked agent) |
| 隔离工作区 | 共用 cwd | 可选 `isolated`(配置开启后) |
| 失败处理 | 整段放弃 | 单 job 失败不影响其他;`exitCode/stderr` 逐项回报 |

### 2.4 Agent Hub:运行时监控子代理

跑长任务时按 `Alt+A`(或 `Ctrl+S`)打开 **Agent Hub (协作中枢面板)**:

```
┌─ Agent Hub ──────────────────────────────┐
│ ComponentsExports  running   42s  $0.03  │
│ RoutesExports      running   38s  $0.02  │
│ HooksExports       done      12s  $0.01  │
│                                          │
│ Enter: 聚焦该子代理会话,直接输引导消息    │
│ r: 复活 parked (挂起) worker             │
│ x: 杀掉卡住的 worker(不影响父 session)  │
│ t: 树视图   Tab: inspector               │
└──────────────────────────────────────────┘
```

配套的 `hub` 工具在 agent 侧做同一件事:`list` 列出同伴、`send` 发消息(给 parked agent 发消息 = 复活它)、`wait` 等结果、`cancel` 取消任务。

这一套 pi 完全没有——pi 的 subagent 一旦派出去就只能等结果。

---

## 3. Advisor (顾问模型):每 turn 旁听

### 3.1 是什么

`advisor` 是给主 agent 配的**第二个模型**,跑在独立的 context (上下文) 上,**每个 turn 都读主 agent 的转录增量,然后通过 `advise` 工具注一条 note (注记)**:

```
note 三种 severity (级别):
├─ nit (小刺):     非打断旁白,攒到步骤边界再批量出现
├─ concern (关切): 打断式引导,主 agent 通常会 course-correct (修正方向)
└─ blocker (拦截): 打断式引导;即使主 agent 给了最终答案,也会触发一轮返工
```

主 agent 看到 note 后要么修正,要么告诉你**为什么不改**。渲染成 `<advisory severity="…">` 卡片。

### 3.2 开启与配置

```yaml
# ~/.omp/agent/config.yml
modelRoles:
  advisor: anthropic/claude-haiku-4.5   # 顾问用便宜模型

advisor:
  enabled: true        # 默认 false
  immuneTurns: 3       # 冷却:一次 concern/blocker 之后,接下来 3 个 turn 降级为不打断的 aside
```

```bash
omp --advisor          # 启动时开
```

```text
/advisor on|off        # 会话内开关
/advisor status        # 看当前 advisor 配置与状态
/advisor configure     # 交互式配置
```

给 advisor 配"侦察工具":默认它只有 `read`/`grep`/`glob` + `advise`;想让它能跑命令,写 `WATCHDOG.yml` roster(或 `WATCHDOG.md` 给它单独的指导文件)。

> 细节:advisor 的 note 有防噪设计——内容规范化、`lgtm` 类空话过滤、同文去重、每个周期最多一条。子代理默认**没有** advisor,要按 agent 显式开启。

### 3.3 实战场景

**任务**: "把 ENOENT 都 swallow (吞掉) 不抛错"

**主 agent 提案**:
```ts
} catch (e) {
  if (e.code === 'ENOENT') return null;
  throw e;
}
```

**advisor note (concern)**:
```
⚠ Advisor 1 note (concern): 这只 catch ENOENT,但其它 EACCES/EPERM 仍然 throw (抛出)。
  用户原话是"文件读不到就当空",你的实现只覆盖了 ENOENT 一种。
  建议:确认其它错误码的语义,或者和用户确认范围。
```

主 agent 看到后修正:确认 EACCES/EPERM 的处理,再回复。

### 3.4 与 pi 对比

| 维度 | pi | omp |
|------|-----|-----|
| 第二个模型旁听 | ❌ | ✅ |
| 独立 context | n/a | ✅(不污染主对话) |
| 分级(nit/concern/blocker) | n/a | ✅ |
| 冷却防噪 | n/a | ✅ `advisor.immuneTurns`(默认 3) |

---

## 4. `/review`:评审 + verdict (裁决) + 置信度

### 4.1 一句话定位

`/review` 派专门的 reviewer subagent (审查子代理) 并行扫你的改动,出 **P0-P3 + verdict (裁决) + confidence (置信度)** 的结构化结果——这是上游 README 的 10 号电池:"every issue ranked P0 through P3 and scored for confidence. /review spawns dedicated reviewer subagents that sweep branches, single commits, or uncommitted work in parallel."

### 4.2 使用

```text
/review                       # 评审工作区未提交改动
/review HEAD                  # 评审 HEAD 这次 commit
/review main..feature/auth    # 评审分支差异(PR 对比走 merge-base)
```

不想用斜杠命令,也可以直接派内置 agent:`task { tasks: [{ agent: "reviewer", task: "评审未提交改动" }] }`;安全专项用 `security-reviewer`。

### 4.3 输出格式(README 口径,示意)

```
┌─ Review Verdict (裁决) ─────────────────┐
│  ⚠ REQUEST CHANGES                       │
│  P0 (紧急): 1   P1 (高): 2               │
│  P2 (中): 4     P3 (低): 7               │
└──────────────────────────────────────────┘

P0-1 [confidence: 0.95] src/auth.ts:42
  Race condition (竞态): 两个并发请求可能同时持有 refresh token。
  Suggested fix: 用 atomic compare-and-swap (CAS) 或 mutex (互斥锁)。
```

### 4.4 关键属性

| 属性 | 说明 |
|------|------|
| **verdict** | 该不该 ship,一句话裁决 |
| **P0-P3** | 紧急 / 高 / 中 / 低,先修 P0 |
| **confidence (置信度)** | 每条 finding 带分数,低分可能是误报 |
| **并行** | 多个 reviewer subagent 并行扫 |
| **scope (范围)** | 工作区 / commit / 分支(merge-base) |

### 4.5 与 pi 对比

| | pi | omp `/review` |
|---|-----|---------------|
| 触发方式 | 靠 prompt "请审查代码" | 一条 slash 命令 |
| 并行扫 | 无 | reviewer subagent 并行 |
| 输出 | 一段 prose | P0-P3 + verdict + confidence |

---

## 5. 三件武器联动:实战大重构

```
目标: 把 src/ 从 React 类组件迁到 Hooks

Step 1 ─ fan-out (扇出) ─── task { context + 3 个任务项, schema-validated JSON }
       ↓ 产物: exports map + dependency graph (依赖图)

Step 2 ─ advisor (顾问模型) 全程旁听 ─ nit/concern 提示风险点

Step 3 ─ 主 agent 按 DAG (有向无环图) 顺序串行迁移
       每个文件用 hashline (第二课) 改;模式相似的批量用 ast_edit

Step 4 ─ /review HEAD ── reviewer subagent 并行扫
       P0 必须修, P1 建议修, P2/P3 留给下次

Step 5 ─ Agent Hub 监控全程
       子 worker 卡了 → Hub 里 r 复活
       跑偏了 → Enter 聚焦后直接输引导消息
```

## 小结

| 武器 | 解决什么 | 与 pi 的最大差异 |
|------|----------|------------------|
| `task` subagent | 大任务并行 | typed yield + outputSchema + hub 消息 |
| `advisor` | 决策盲点 | 独立 context + nit/concern/blocker 三级 + 防噪冷却 |
| `/review` | 一次性全审 | P0-P3 + verdict + confidence |

## 下一课预告:第四课:IDE 深度

- LSP (Language Server Protocol, 语言服务器协议) 怎么做到 rename 时自动改 barrel (集中导出文件)、re-export (重新导出)
- DAP (Debug Adapter Protocol, 调试适配器协议) 怎么挂 lldb (macOS C/C++ 调试器) / dlv (Go 调试器) / debugpy (Python 调试器) 真实调试
- ast_grep 怎么写 pattern 找代码坏味道(和 grep 的本质差异)
