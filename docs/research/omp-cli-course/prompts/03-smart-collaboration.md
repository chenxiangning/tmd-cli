# 第三课 · 用户视角 · 智能协作(subagents / advisor / /review)

> 配套主课:[03-smart-collaboration.md](./../03-smart-collaboration.md)
> 这一课解决:**让多个 agent 同时干活 + 旁听 + 评审**。
> 用户视角:`task` 工具扇出、advisor (顾问模型) 配置、`/review` 出 verdict (裁决意见)。

---

## 场景 1 — 用 `task` 工具扇出 3 个 worker

**目的**:让 3 个子代理并行(同时跑)各扫一类东西,产 schema 校验过的 JSON (按指定格式输出的结构化结果),不是字符串糊你一脸。

```text
你:这个 monorepo (单体仓库,多个 package 共享一个 git 仓库)有三个分面要扫,同时起 3 个子代理并行做:
   - 子代理 A:扫所有 exports,产出 { name, path }[]
   - 子代理 B:扫所有 internal imports,产出 dependencyGraph (依赖图)
   - 子代理 C:扫所有 React 组件的 hooks,产出 { component, hooks }[]

你:三个子代理跑完,把结果汇总成一份 json,然后告诉我。
```

omp 实际派出去的 `task` 长这样:

```js
task {
  context: "共享背景:仓库用 pnpm,TS strict;本轮只调研不改码。",
  tasks: [
    { name: "exports", agent: "scout",
      task: "扫所有 exports,产出 { name, path } 列表",
      outputSchema: { type: "object", properties: { exports: { type: "array" } }, required: ["exports"] } },
    { name: "deps", agent: "scout",
      task: "扫所有 internal imports,产出 dependencyGraph",
      outputSchema: { type: "object", properties: { dependencyGraph: { type: "object" } }, required: ["dependencyGraph"] } },
    { name: "hooks", agent: "scout",
      task: "找所有 React 组件的 hooks,产出 { component, hooks } 列表",
      outputSchema: { type: "object", properties: { hooks: { type: "array" } }, required: ["hooks"] } }
  ]
}
```

**期望**:

- 3 个 worker 在 Hub (Hub:子代理实时监控面板)里能看到状态(子代理 ID、当前步骤、已用 token);
- 每个 worker 都返回符合 schema 的 JSON,丢字段就报错;
- 总耗时 ≈ 最慢的那个,不会 3 倍慢。

**口诀**:不要 "写一个循环依次做 A/B/C",而是"一次派 3 个并行"。

---

## 场景 2 — 把 advisor (顾问模型) 装上

**目的**:每个 turn (每轮对话) 都有个便宜模型旁听,帮你挑刺、抓错。

```yaml
# ~/.omp/agent/config.yml
modelRoles:
  default: anthropic/claude-sonnet-4.5   # 主力
  advisor: anthropic/claude-haiku-4.5    # 每回合旁听,必须够便宜

advisor:
  enabled: true
```

- 没有 `reasoning` role;深度推理用 `slow` role 或模型选择器加思考档位后缀。
- 关掉 advisor → 会话内 `/advisor off`,或 `advisor.enabled: false`。
- advisor 看的是转录增量(不是只读 stub),所以"它说的话"有依据。

**踩坑提醒**:

- 关掉 advisor → 会话内 `/advisor off`,或配置 `advisor.enabled: false`。

---

## 场景 3 — `/review` 出具 verdict + 置信度

**目的**:让评审模型出一份 verdict (裁决意见),不仅说"行不行",还说"信几分"。

```text
你:(在 TUI 里)
   /review src/api/middleware.ts
```

agent:启动 `review` role 的模型,跑完整分析,返回:

```yaml
verdict:
  decision:  approve | request_changes
  confidence: 0.0 ~ 1.0   # 评审对自己判断的把握
  findings:
    - priority: P0 | P1 | P2 | P3   # P0 最急
      file: src/api/middleware.ts
      line: 42
      message: "..."
```

**期望**:

- `decision` 是结构化的,不是空话;
- `--strict` / `--soft` 这类 flag **不存在**;要"只报告不阻断",直接看报告自己决定。
- confidence 是每条 finding 各自带分,不是全局一个数。

**踩坑提醒**:verdict 里 confidence = 0.5 时,基本等于"评审模型自己也不知道",别按 approve 处理。

---

## 场景 4 — 联动:大重构实战

**目的**:三件武器(并行 + 旁听 + 评审)在一次重构里联动起来。

```text
你:这次重构有点大,按下面跑:
   Step 1 ─ fan-out (并行派发) ─── task { 3 个 worker:
     A 列所有 UserCard 调用方
     B 抓所有 prop 形状
     C 找所有 types 引用
   } 每人 schema 校验
   Step 2 ─ advisor 旁听 ─ 每个 worker 跑完让 advisor 看一遍
   Step 3 ─ /review 全量评审 ─ 给我 verdict,confidence 必须 > 0.7 才 apply
```

omp 内部步骤大致是:

1. `task` 跑 3 个 worker,每人出 JSON;
2. JSON 汇成一份"重构方案"草稿;
3. advisor 看草稿,加 2~3 条风险;
4. `/review` 出 verdict + confidence;
5. confidence > 0.7 → ast_edit + Accept Card;否则转人工。

**期望**:

- 大重构不再"一个人闷头改 3 小时";
- 三层防御:finding(找问题)→ advisor(旁听)→ review(签字);
- verdict 不够信心就停下,**不**自动 apply。

---

## 场景 5 — 用户视角 / Hub

**目的**:task 跑的过程中,你在 TUI 里能看到什么。

| 字段 | 含义 |
| ------ | ------ |
| Worker ID | 子代理唯一 id |
| Status | running / done / failed |
| 当前步骤 | "正在扫描 src/..." |
| 已用 token | 估算成本 |
| ETA | 预估剩余时长 |

```text
你:3 个 worker 都跑 5 分钟了,为什么 A 卡住?

答:点进 worker A 看 status,A 卡在 "import resolver" 上——
   仓库里有 .ts 用了没装的 dep,resolver 转圈。这不是你 task 的问题,
   是 setup 问题。先 `pnpm install` 再重跑。
```

**踩坑提醒**:

- worker 卡住不等于 omp 卡住——先按 worker 维度排错;
- 严重卡住的 worker 可以"kill + replan",不用全部重来。

---

## 场景 6 — pi → omp 差异:为什么 fan-out 是大事

**目的**:理解为什么要换 omp。

| 维度 | pi | omp |
| ------ | ----- | ----- |
| 并行子代理 | 没原生,靠外部脚本 | `task { context, tasks: [...] }` |
| advisor | 无(只能后置手动 review) | 每回合自动旁听 |
| /review | 没 verdict 结构,只是 review prompt | verdict + confidence 量化 |
| Hub | 无 | TUI 实时监控 worker |
| Schema 校验 | 无 | worker 返回不符合 schema 直接报错 |

**一句话总结**:
pi 是"一个脑子干活",omp 是"一个 PI (主代理) + 若干 worker + 顾问 + 评审"四个角色干活。

---

## ✅ 这一课你该会的事

1. 用 `task { context, tasks: [...] }` 派并行子代理,每人 outputSchema-validated (格式校验过的) JSON。
2. 给 `~/.omp/agent/config.yml` 配 `advisor` 角色,挑便宜模型。
3. 用 `/review` 拿 verdict + confidence;confidence 是每条 finding 各自带分。
4. 大重构= fan-out → advisor → /review → acceptCard,四步走。
5. 在 Hub 看 worker 状态,卡住时按 worker 维度排错。

---

## 🎯 下一课 →

[04-ide-depth.md](./04-ide-depth.md):LSP 14 个 ops (IDE 级的查找引用/重命名/找定义) + DAP 28 个 ops (调试器断点/单步/查变量) + ast_grep 写更复杂的 pattern。
