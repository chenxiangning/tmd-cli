# 第五课 · 用户视角 · Memory 系统(三层:Conversation / Facts / Skills)

> 配套主课:[05-memory-system.md](./../05-memory-system.md)
> 这一课解决:**让 agent 不只是"重新开始"——它能回忆、回滚、学技能**。
> 用户视角:三层 memory,每层一个用法。

---

## 场景 1 — 探索前打 checkpoint (快照)

**目的**:进入"可能走岔路"的探索前留一个回退点。

```text
你:我要探索两种 auth (身份验证) 重写方案,先打一个 checkpoint (打快照)。

agent:checkpoint { reason: "before-exploring-auth-rewrite-options" }

agent:Checkpoint id: ckpt-A1B2  saved.
       后续随时可以 rewind 回来。
```

**期望**:

- 打 checkpoint 不打断当前 turn,瞬间完事;
- 之后不管跑什么,只要 rewind 就能回到这个状态;
- rewind 默认**保留一份简洁的报告**(`keep: "concise_report"`),不会让你回到空白页。

**踩坑提醒**:不打 checkpoint 就跑大改,等于不留悔棋——坏掉只能 `git stash` 救场。

---

## 场景 2 — 探索后回滚 rewind

**目的**:试了方案 B 不行,回到方案 A 的起点重做。

```text
你:方案 B 走不通,rewind 到 "before-exploring-auth-rewrite-options",
   改成方案 C。

agent:rewind {
  to: "before-exploring-auth-rewrite-options",
  keep: "concise_report"
}

agent:已回到 ckpt-A1B2 时刻,导航报:方案 B 失败原因 = X。
       现在改方案 C,基于方案 A 重新开始。
```

**期望**:

- 回滚≠ 撤销改文件——它把 memory + 文件状态都回到 checkpoint;
- `keep: "concise_report"` 把"为什么走 B 失败"留一行,下次不踩同一个坑;
- 不会留下`.orig`、`.rej` 之类的脏文件。

---

## 场景 3 — 长期事实:retain / recall / reflect

**目的**:把项目里"踩过的坑"长期存下来,以后 agent 自动记得。

```text
你:把这条规则记到长期 memory 里——

agent:retain {
  fact: 'refresh token 必须用 atomic CAS (比较并交换,无锁原子的"读-改-写"),不能用普通赋值',
  tags: ['auth', 'race-condition'],
  confidence: 1.0
}

agent:已保留。下次你提到 auth token 时,我会主动引用。
```

**回头查/反思**:

```text
你:我们对 auth token 存储做过什么结论?

agent:recall { query: "auth token 存储" }

agent:找到 3 条:
  1. refresh token 必须 atomic CAS(2026-09-01 02:13)
  2. access token 走 memory only(2026-08-29 21:00)
  3. ...

你:对 auth race condition 做点反思。

agent:reflect { query: "auth race condition" }

agent:整理出当前 race condition 风险地图(token / cache / session 三处)。
```

**期望**:

- `retain` 是写,`recall` 是关键词搜索,`reflect` 是"给我梳理一下主题";
- confidence 1.0 是"这事绝不错",0.5 表示"我自己也吃不准";
- 后端可选 sqlite / markdown / leveldb / 见 omp 后端清单(详见主课 3.2)。

**踩坑提醒**:

- 把"规则"和"事实"混在一起存=混乱。建议 facts 用 tag 分类;
- confidence < 0.7 的事别自动 recall 到主答案里,只放"参考"。

---

## 场景 4 — 精确管理:memory_edit

**目的**:改一条旧事实的 tag 或 confidence,或者直接删。

```text
你:刚才那条 "auth token 必须 CAS" 的 confidence 改成 0.9,
   tag 加一条 "reviewed-by-senior"。

agent:memory_edit {
  id: "fact-0023",
  ops: [
    { op: "set", field: "confidence", value: 0.9 },
    { op: "add", field: "tags",       value: "reviewed-by-senior" }
  ]
}

agent:已更新。
```

```text
你:删掉 fact-0042("pgx 不如 sqlx")。

agent:memory_edit { id: "fact-0042", ops: [{ op: "delete" }] }

agent:已删。
```

**期望**:

- `memory_edit` 是"定点修改",不是 retain-again(retain 是新建,会留重复);
- 删之前可 `recall <id>` 看一眼,避免误删结论。

---

## 场景 5 — 技能层:learn + manage_skill

**目的**:把"做完一件事后"的复用动作固化成技能(以后一句话能复用)。

```text
你:(刚做完"把 express middleware 换成 hono") 
  把这个过程学成 skill,以后我说"换 web 框架"就照这个走。

agent:learn {
  name: "migrate-express-to-hono",
  trigger: "换 web 框架",
  steps: [
    "查 import 站点",
    "ast_grep middleware 签名匹配",
    "lsp willRenameFiles 预扫",
    "ast_edit + acceptCard"
  ],
  evidence: ["找到 18 个调用方,1 次走完"]
}

agent:已注册到 skill 系统。

你:以后怎么管理?

agent:manage_skill {
  manifest: {
    name: "migrate-express-to-hono",
    version: "1.0.0",
    path: "skills/migrate-express-to-hono.md",
    scope: "project"   # 或 user / managed
  }
}

agent:已管理化,下次自动加载。
```

**期望**:

- `learn` 是"临时学到,先挂着";`manage_skill` 是"提升到托管技能";
- 托管技能的 manifest 写到 `~/.omp/agent/skills/` 或 `.omp/skills/`;
- 用户提示词里只说一句"换 web 框架",agent 看到 trigger 就自动加载技能。

**踩坑提醒**:别把"一次性操作"也学成 skill,会污染技能库。

---

## 场景 6 — 三层 memory 联动:一个完整工作流

```text
你:我要重构 auth,过程中我希望:
   1. 探索前打 checkpoint
   2. 关键决定 retain 到长期 facts
   3. 成功路径学成 skill

agent:
  Step 1:checkpoint "before-auth-refactor"
  Step 2:开始重构 → 踩到 race condition → rewind → 改方案
  Step 3:成功后 retain { fact: 'RefreshToken CAS', confidence: 1.0 }
  Step 4:learn { name: 'refactor-auth', trigger: 'auth 重构' }
```

**期望**:

- 三层 memory 各自管不同的"东西":
  - Conversation = 当前对话的回退点(短期)
  - Long-term Facts = 项目规律(中期)
  - Skills = 可复用的过程(长期)
- 互相不打架,可以并存。

---

## 场景 7 — pi → omp 差异:memory 系统

| 维度 | pi | omp |
| ------ | ----- | ----- |
| Conversation 快照 | 无,只能 git stash | checkpoint + rewind,语义化 |
| 长期 facts | 简易笔记 | retain + recall + reflect + 4 种 backend |
| 精确编辑 | 无 | memory_edit (定点 ops) |
| 技能 | 无原生 | learn + manage_skill + scope |
| 注入抗压缩 | 无 | survives compaction (留得住长期上下文) |

**一句话总结**:
pi 不会"越用越聪明";omp 借助三层 memory,会"记住 / 学到 / 复用"。

---

## ✅ 这一课你该会的事

1. 探索前 `checkpoint`,走岔 `rewind`(带 `keep`)。
2. `retain` 记事实,`recall` 关键词搜,`reflect` 主题反思。
3. `memory_edit` 定点改事实,别乱覆写。
4. `learn` 学临时流程,`manage_skill` 提到托管技能。
5. 三层各管各的:短期回退 / 中期事实 / 长期技能。

---

## 🎯 下一课 →

[06-multi-model-routing.md](./06-multi-model-routing.md):provider/role/fallback/凭据轮询/path-scoped/Coding Plan OAuth 一锅炒。
