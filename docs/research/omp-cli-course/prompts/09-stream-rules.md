# 第九课 · 用户视角 · Time-traveling Stream Rules

> 配套主课:[09-stream-rules.md](./../09-stream-rules.md)
> 这一课解决:**只在合适的时候把规则喂进 context (当前对话上下文),别塞爆 system prompt**。
> 用户视角:`.omp/rules/*.md` 规则文件 + `condition` 正则 + `interruptMode` + repeat 防噪。

---

## 场景 1 — 心智模型:规则是怎么"在场"的

**目的**:理解"时间旅行"——规则平时不在 prompt 里,模型输出命中 `condition` 时才**瞬时注入**。

| 形态 | 注入方式 | 优缺点 |
| ------ | ----------- | -------- |
| 常驻规则(`alwaysApply: true` / 粘性 RULES.md) | 一直占 system prompt | 简单,烧 token |
| **omp TTSR(触发式)** | 命中 `condition` 才注入 | 省 token,抗压缩 |
| advisor (顾问模型,03 课) | 每回合注 note | 是"旁听",不是"约束" |

**打断行为由 `interruptMode` 控制**(规则**没有** severity 字段,那套 nit/concern/blocker 是 advisor 的):

| interruptMode | 行为 |
| ---------------- | ------ |
| `always`(默认) | 正文/工具流命中都打断:流中止 → 注入 → 50ms 后从断点重试 |
| `tool-only` | 只在工具调用流(要写盘的内容)上打断 |
| `prose-only` | 只在正文/思考流上打断 |
| `never` | 从不打断,附和式提醒 |

---

## 场景 2 — 写第一条规则:SQL 注入防护

**目的**:模型往代码里写 SQL 字符串拼接时,当场拦下。

在项目里建 `.omp/rules/no-sql-string-concat.md`:

```markdown
---
name: no-sql-string-concat
description: 检测到 SQL 字符串拼接时改为参数化查询
condition:
  - "WHERE ['\"].*\\$\\{.*\\}['\"]"
interruptMode: always
---
检测到 SQL 字符串拼接,改用参数化查询(? 或 $1)。
```

```text
你:这个 SQL 帮我看看 ——
   "SELECT * FROM users WHERE name = '${input.name}'"

agent:⚠ <system-interrupt reason="rule_violation" rule="no-sql-string-concat">
        检测到 SQL 字符串拼接,改用参数化查询。
      </system-interrupt>

agent:好的 → db.query("SELECT * FROM users WHERE name = ?", [input.name])
```

**期望**:

- 命中才注入,不命中一个 token 都不花;
- 打断是"流中止 + 断点重试",模型必须先回应规则再继续。

---

## 场景 3 — 空 catch 防护(用 AST 条件更准)

**目的**:禁止写盘内容里有空 catch。`astCondition` 只在 edit/write 的工具流上匹配——看的是"写进文件的代码",不受聊天内容误触发:

```markdown
---
name: no-empty-catch
description: 空 catch 会吞错
astCondition:
  - "try { $$$BODY } catch ($E) { $$$ }"
scope:
  - "tool:edit(src/**)"
  - "tool:write(src/**)"
---
空的 catch 会吞错,请加 logger.error 或重新抛出。
```

**期望**:

- 只有真的往 `src/**` 写空 catch 才触发;
- 想更精细:把 `$$$HANDLER` 写成必须含 `throw` 的 pattern,或交给 ast_grep 先看命中清单。

---

## 场景 4 — 防噪:repeat 策略(不是 cooldown)

```yaml
# ~/.omp/agent/config.yml
ttsr:
  enabled: true
  interruptMode: always
  repeatMode: "once"       # 一条规则整个会话只注入一次(默认)
  repeatGap: 10            # after-gap 模式:隔 10 个完成 turn 才可再触发
  contextMode: "discard"   # 注入被压缩掉就丢;"keep" 则尽力保留
  disabledRules: []        # 按名字关掉某条
```

**期望**:

- 重构期同一条规则反复命中不会刷屏(默认一次);
- 想要"过一阵再提醒" → `repeatMode: "after-gap"` + `repeatGap`。

**踩坑提醒**:没有 `cooldown: "30m"` 这种时间字段——防噪维度是"完成的 turn 数",不是墙钟时间。

---

## 场景 5 — injection survives compaction

**目的**:长对话压缩(对早期内容压缩摘要以省 token)后,规则还在不在?

```text
你:这个 session 我跟 agent 聊了几十轮——

.omp/rules/               ← 自己写的(项目级)

但:注入是持久化的会话条目,规则注册状态随会话恢复;
   下次写到 SQL 拼接,照样触发(README:"Injections survive compaction, so the fix sticks.")
```

---

## 场景 6 — 规则从哪来 + 怎么调试

```text
[项目目录]
.ompt/rules/              ← 自己写的(项目级)
~/.omp/agent/.omp/rules/  ← 用户级
.cursor/rules/*.mdc       ← Cursor 的规则,直接被读进来
.clinerules               ← Cline 的也是
.github/*.instructions.md ← Copilot 的也是(applyTo 自动转 globs)
RULES.md                  ← 粘性规则,常驻 prompt
```

```bash
omp ttsr          # 检查:哪些规则注册了、进了哪个桶(触发式/常驻/rulebook)
```

```text
read rule://no-empty-catch    # 读任意规则全文
```

---

## 场景 7 — stream rules vs advisor vs system prompt

| 维度 | system prompt(常驻规则) | advisor (03 课) | **TTSR** |
| ------ | ---------------- | ------------------ | ------------------- |
| 注入时机 | 启动一次 | 每回合转录增量 | 命中 condition 才 |
| 是否占 context | 是 | 独立 context | 否(条件注入) |
| 抗压缩 | 弱(被压缩挤出) | 独立会话自管 | 强(注入持久化) |
| 表达力 | 自然语言 | 自然语言 note | 正则 / ast-grep pattern |
| 打断控制 | 无 | nit/concern/blocker | interruptMode 四档 |
| 适合 | 行为准则 | 旁听式建议 | 形式约束 / 安全护栏 |

**一句话总结**:
"我要 agent 长期遵守" → 常驻规则 / RULES.md;
"每回合我想要旁听挑刺" → advisor;
"看到 X 模式时立即反应" → TTSR。

---

## 这一课你该会的事

1. 在 `.omp/rules/<name>.md` 写规则:frontmatter `condition / astCondition / scope / interruptMode / globs / agents`。
2. 打断档位靠 `interruptMode`,不是 severity。
3. 防噪靠 `repeatMode` / `repeatGap`(turn 数,不是时间)。
4. 知道注入抗 compaction,session 长也可靠。
5. Cursor/Cline/Copilot 的既有规则不用迁移,直接被读进同一条管线。

---

## 下一课 →

[10-collab-acp.md](./10-collab-acp.md):`/collab` 把 session 分享出去 + ACP (Agent Client Protocol, 把 agent 接入编辑器的协议) 让 Zed 直接接 omp。
