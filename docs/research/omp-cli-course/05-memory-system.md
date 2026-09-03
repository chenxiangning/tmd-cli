# 第五课:Memory 系统 —— 让 agent 越用越聪明

> 注意:先说门控:memory 相关工具**默认基本都关**——`checkpoint`/`rewind` 要 `checkpoint.enabled: true`(默认 false);`retain`/`recall`/`reflect` 要 `memory.backend` 设成 `hindsight` 或 `mnemopi`(默认 `off`);`learn`/`manage_skill` 还要额外开 `autolearn.enabled: true`。这是和 pi 的又一明显差异。

## 1. 心智模型:三层 Memory (记忆)

omp 的 memory 不是单一概念,而是**三层叠加**:

```
┌─────────────────────────────────────────────────────┐
│ Layer 3 · Skills (技能)                              │
│         learn + manage_skill → 可复用 lesson (经验)  │
│         (e.g. "这个项目用 bun 不用 npm")            │
├─────────────────────────────────────────────────────┤
│ Layer 2 · Long-term Facts (长期事实)                 │
│         retain + recall + reflect + memory_edit      │
│         → 项目级知识库                               │
│         (e.g. "auth 模块用 sessionStorage")         │
├─────────────────────────────────────────────────────┤
│ Layer 1 · Conversation (当前会话)                    │
│         checkpoint + rewind → 快照 + 回溯            │
│         (e.g. "回到刚才那段探索前")                 │
└─────────────────────────────────────────────────────┘
```

三层关系:

- **Layer 1** 只活在当前会话,关掉就没
- **Layer 2** 跨会话,默认绑项目
- **Layer 3** 跨会话可复用,managed skill 全局可用

## 2. Layer 1:Conversation —— checkpoint (快照) + rewind (回溯)

### 2.1 两个工具、各一个参数

```text
[对话进行中...]
agent: 这个分支我有几个方案还在犹豫,先打个 checkpoint
→ checkpoint { goal: "对比三种 auth 重构方案" }

...(探索 B、C 方案,上下文越滚越大)...

agent: 刚才绕远了,回到方案 A 定稿
→ rewind { report: "B 因 X 不可行;C 因 Y 不可行;定 A,理由:改动面最小且已验证" }
```

- `checkpoint` 只收一个 `goal`,给这次探索定个锚;**同一会话同时只有一个活跃 checkpoint**,没有 id 列表
- `rewind` 只收一个 `report`:中间的探索过程被剪掉,**结论以报告形式保留**(branch_summary + 隐藏的 rewind-report 会持久化)
- 重要边界:rewind 恢复的是**对话/会话树状态**——不回滚文件、不碰 git、不杀进程。它治"上下文被探索垃圾塞满",不是撤销代码

### 2.2 和 pi 的对比

| | pi | omp |
| --- | ----- | ----- |
| 主动回溯 | ❌(只能翻历史) | ✅ checkpoint + rewind |
| 探索后保留结论 | ❌ | ✅ report 保留 |
| Token 节省 | 手动 `/compact` | 自动剪枝 |

### 2.3 实战场景

```
场景: 重构方案从 A 改 B 改 C,最后发现 A 最对

[checkpoint: goal="对比 A/B/C 方案"]
[agent 探索 A] → 记下结论
[agent 探索 B] → 不理想
[agent 探索 C] → 不理想

rewind { report: "B/C 因 X/Y 不可行,选 A,理由: ..." }
// → 探索过程清掉,结论保留,上下文轻装继续
```

## 3. Layer 2:Long-term Facts (长期事实) —— retain / recall / reflect / memory_edit

### 3.1 四个工具,两个前提

| 工具 | 干什么 | 何时用 |
| ------ | -------- | -------- |
| `retain` | 写入事实(items 数组,`{content, context?}`) | agent 发现值得记住的真相 |
| `recall` | 检索(query,返回带 id 的原始命中) | 需要查"上次是怎么做的" |
| `reflect` | 综合(query + context,跨多条记忆给答案) | 需要"综合 N 条事实得回答" |
| `memory_edit` | 修正(`op: update|forget|invalidate` + id) | 事实过期/错了 |

**前提**:`memory.backend` 必须是 `hindsight` 或 `mnemopi`——`local` 和 `off` 下这四个工具**根本不注册**(注意:不是降级,是消失)。`memory_edit` 更挑:只有 `mnemopi` 有。

`reflect` 的一个坑:Mnemopi 后端的 reflect 是"本地检索 + 格式化",不是真的模型综合;要真综合,拿 recall 的结果让主模型自己读。

### 3.2 五种 backend (后端存储)

```yaml
# ~/.omp/agent/config.yml
memory:
  backend: "off"          # 默认:无长期记忆
  # backend: "local"      # 本地文件管线(MEMORY.md),无 retain/recall 工具
  # backend: "mnemopi"    # omp 自研,本地 SQLite,向量检索
  # backend: "hindsight"  # 自托管 memory server(默认 http://localhost:8888)
  # backend: "sharpshooter" # 摩擦门控的决策文件(v18.0.10 新增)
```

| backend | 适合谁 | 特征 |
| ------ | ------ | ------ |
| `off` | 不想要 | 默认 |
| `local` | 轻量用户 | 会话启动后台跑"抽取→合并"两段管线,产出 `MEMORY.md` + `memory_summary.md` + `skills/` playbooks,开局注入 |
| `mnemopi` | 单机重度 | 本地 SQLite,自动 recall(首 turn)/自动 retain(默认每 4 turn),scope 可选 `global`/`per-project`(默认)/`per-project-tagged` |
| `hindsight` | 团队/跨机 | 中心服务,自动 retain(每 3 个用户 turn),`HINDSIGHT_*` 环境变量配地址 |
| `sharpshooter` | 实验中 | 摩擦门控决策文件,`/memory queue`/`/memory sync` 管理 |

### 3.3 实战:retain 工作流

```text
[用户]
auth 模块改完了,记住以后用 sessionStorage 而不是 localStorage。

[agent 行为]
retain {
  items: [{
    content: "auth 模块的 token 必须存到 sessionStorage,不能用 localStorage",
    context: "用户在 auth 重构 review 时的明确要求"
  }]
}
```

或者 agent 自己判断该 retain:

```text
[agent]
"我刚才调试了 30 分钟才找到 race condition (竞态条件)……
 retain { items: [{ content: 'refresh token 必须用 atomic CAS (比较并交换),不能用普通赋值' }] }"
```

### 3.4 recall / reflect / memory_edit

```text
recall { query: "auth token 存储" }
// → 命中带 id 的记忆条目(内容预览截 500 字符,标 truncated)

reflect { query: "auth 重构要注意什么" }
// → 综合多条相关记忆给回答(Mnemopi 后端下是"检索结果整理")

memory_edit { op: "invalidate", id: "mem-2026-07-12-abc" }
// → 标作废:不被命中,历史保留(update 前应先 read memory://<id> 看全行)
```

### 3.5 与 pi 对比

| | pi | omp |
| --- | ----- | ----- |
| 项目级 long-term memory | ❌(只有当前会话) | ✅ retain/recall/reflect |
| 后端可插拔 | n/a | ✅ off/local/Hindsight/Mnemopi/Sharpshooter |
| 事实修正 | n/a | ✅ memory_edit(mnemopi) |
| 自动化 | n/a | ✅ 自动 recall/retain(可配频率) |

## 4. Layer 3:Skills (技能) —— learn + manage_skill

### 4.1 learn(捕获可复用 lesson)

`retain` 存事实,`learn` 存**可复用的方法论**:

```text
[用户]
这种 TS 项目别用 npm,用 bun,bun install 快 5x。

[agent]
learn {
  memory: "这个项目用 bun,不用 npm;test 用 bun test,不是 jest",
  context: "用户在依赖安装反复失败后定的规矩"
}
```

- local 后端:写入项目根的 `learned.md`(最新在前、去重、密钥脱敏、上限 100 条)
- 也可以一步到位,**顺手把 lesson 沉淀成 managed skill**:

```text
learn {
  memory: "bun 项目标准流程",
  skill: {
    action: "create",
    name: "bun-project-setup",
    description: "在用 bun 的项目里初始化/构建/测试的标准流程",
    body: "## 步骤\n- bun install 代替 npm install\n- bun test 代替 jest"
  }
}
```

### 4.2 manage_skill(独立管理托管技能)

```text
manage_skill { action: "create",  name: "deploy-checklist", description: "...", body: "..." }
manage_skill { action: "update",  name: "deploy-checklist", description: "...", body: "..." }
manage_skill { action: "delete",  name: "deploy-checklist" }
```

- 名字必须 kebab-case;`body` 是**不带 frontmatter** 的 Markdown(frontmatter 自动生成),上限 64KB
- 托管 skill 存在 `~/.omp/agent/managed-skills/`,加载优先级**最低**——永远不会覆盖你手写的同名 skill
- manage_skill 改完会立即刷新已加载的 skill 列表;learn 里的 skill 参数则不会

### 4.3 与 pi 对比

| | pi | omp |
| --- | ----- | ----- |
| 可复用 lesson | ❌ | ✅ learn |
| 托管 skill | n/a | ✅ manage_skill(create/update/delete) |

## 5. 三层联动:一个完整工作流

```
[新会话开始]
1. 记忆注入 ←  Layer 2:MEMORY.md / 自动 recall 自动加载项目事实
2. skills     ←  Layer 3:SKILL.md 的 name+description 进 system prompt,按需 skill:// 展开
[对话进行中]
3. checkpoint ←  Layer 1:重要节点打快照
4. retain     ←  Layer 2:发现新事实就写入
5. learn      ←  Layer 3:发现可复用方法就捕获
[会话收尾]
6. reflect    ←  Layer 2:综合这次的事实
7. rewind     ←  Layer 1:回溯到 checkpoint,扔掉探索过程,留下报告
```

## 6. 与 pi 的全景对比

| 维度 | pi | omp |
| ------ | ----- | ----- |
| 当前会话回溯 | 翻历史 | ✅ checkpoint + rewind |
| 项目事实记忆 | ❌ | ✅ retain + recall + reflect |
| 跨项目 skill | ❌ | ✅ learn + manage_skill |
| 后端可插拔 | n/a | ✅ 5 种 backend |
| 自动 recall/retain | n/a | ✅(mnemopi/hindsight) |

## 小结

| 武器 | 层级 | 干什么 | 门控 |
| ------ | ------ | -------- | ------ |
| `checkpoint {goal}` + `rewind {report}` | 当前会话 | 打快照/剪枝回溯,结论保留 | `checkpoint.enabled`(默认关) |
| `retain` | 项目事实 | 写一条事实 | `memory.backend ∈ hindsight|mnemopi` |
| `recall` | 项目事实 | 检索原始命中 | 同上 |
| `reflect` | 项目事实 | 综合多条 | 同上(mnemopi 下是整理非综合) |
| `memory_edit` | 项目事实 | update/forget/invalidate | 仅 `mnemopi` |
| `learn {memory}` | 可复用方法 | 写 lesson,可顺手建 skill | `autolearn.enabled` + backend |
| `manage_skill` | 托管技能 | create/update/delete | `autolearn.enabled` |

和 pi 的对照:**pi 每次都是冷启动**,**omp 会越来越懂你的项目**——这就是 README 里 "Memory the agent curates" 的含义。

## 下一课预告:第六课:多模型协作实战

- `retry.fallbackChains` 怎么写——主 provider 撞墙时自动切备用
- 多账号/多 key 怎么轮换,auth-broker 是干嘛的
- path-scoped 模型:某个目录只许用某些模型/provider
- `/login` 接入 OAuth / Coding Plan
