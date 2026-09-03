# 第九课 · 用户视角 · Time-traveling Stream Rules

> 配套主课:[09-stream-rules.md](./../09-stream-rules.md)
> 这一课解决:**只在合适的时候把规则喂进 context (当前对话上下文),别塞爆 system prompt**。
> 用户视角:`~/.omp/agent/rules.yml` + 触发 pattern + severity + cooldown。

---

## 场景 1 — 心智模型:规则是怎么"在场"的

**目的**:理解"时间旅行"——规则不在 system prompt 里,而是在 stream (对话流) 上,只在 token (模型处理的最小文本单元) 命中规则时**瞬时插入**上下文。

| 形态 | 注入方式 | 优缺点 |
| ------ | ----------- | -------- |
| 传统 system prompt | 一股脑写死 | 长对话必爆 context |
| **omp stream rules** | 命中 pattern 才 inject (注入对话流) | 精,抗压缩 |
| advisor (顾问模型) | 每回合末加一段 | 是"旁听",不是"约束" |

**口诀**:

- system prompt = "刚启动时的指令"——会随对话变长而被挤掉(对 model 来说"老早的事记不住");
- stream rules = "动态注入的临时护栏"——压缩 (compaction,长对话时把旧消息摘要以省 token) 时**留得住**,因为是按 pattern 重注入。

---

## 场景 2 — 写第一条规则:SQL 注入防护

**目的**:当 user 在 stream 里写 SQL 字符串拼接,提示用参数化 (parameterized) 查询。

```yaml
# ~/.omp/agent/rules.yml
rules:
  - id: no-sql-string-concat
    severity: error                          # error / warn / info
    when: stream                             # 在 stream 上扫描
    pattern: "WHERE ['\"].*\\$\\{.*\\}['\"]" # Grep 风格的字符串匹配
    message: "检测到 SQL 字符串拼接,改用参数化查询 (? 或 $1)。"
    cooldown: "1h"                           # 同一文件 1h 内不重复告警
    onMatch:
      injectContext: true                    # 把 message 喂给当前回合
      requireAck: true                       # 用户必须 ack 后才 continue
```

```text
你:这个 SQL 帮我看看 ——
   "SELECT * FROM users WHERE name = '${input.name}'"

agent:⚠ 命中 no-sql-string-concat:
        "检测到 SQL 字符串拼接,改用参数化查询。"
       ack 后继续。

你:ack。继续 → 改成参数化。

agent:好的 → `db.query("SELECT * FROM users WHERE name = ?", [input.name])`
```

**期望**:

- 命中才 inject,不命中不占位置;
- `severity: error` 会阻止 apply,直到 ack;
- cooldown 防止"同一文件每一轮都告一次"。

---

## 场景 3 — 空 catch 防护

**目的**:禁止 catch 块为空。

```yaml
# ~/.omp/agent/rules.yml
rules:
  - id: no-empty-catch
    severity: warn
    when: stream
    pattern: "catch.*\\{\\s*\\}"   # catch {...} 中间是空白
    message: "空的 catch 会吞错,请加 logger.error 或 throw。"
    cooldown: "5m"
```

**期望**:

- `severity: warn` 不阻断,只警告;
- 误触发的 pattern 调一下 → 把 `pattern` 写更紧(用 ast_grep 而非 regex)。

---

## 场景 4 — severity 三个级别怎么选

| severity | 行为 | 适合 |
| ----------- | ------ | ------ |
| `info` | 只记录,不 inject | "统计类"指标 |
| `warn` | inject 但不阻断 | 风格建议、安全提醒 |
| `error` | inject + 必须 ack 才能 continue | 真正的事务阻断(安全、明令禁止) |

**判断准则**:

- 这事"错了就回不去" → `error`(删除已合并 commit、rm -rf);
- 这事"建议改但可接受" → `warn`(空 catch、不写测试);
- 这事"只是想看数据" → `info`。

---

## 场景 5 — injection survives compaction

**目的**:长对话压缩(对早期内容压缩摘要以省 token)后,规则还在不在?

```text
你:这个 session 我跟 agent 聊了几十轮——

agent:压缩 (compaction) 发生,老 context 被摘要替代。

但:no-sql-string-concat rule 还在 —— 因为它**不在** context 里,在 stream rule engine 里按 pattern 重新检测。

下次我写到 SQL 拼接,照样会触发。
```

**期望**:

- 跟 system prompt 比,stream rule 的关键优势就是"压缩留得住";
- 你不必"担心忘了注入"——engine 一直看着 stream。

---

## 场景 6 — cooldown 防误触

```yaml
rules:
  - id: no-console-log
    severity: info
    when: stream
    pattern: "console\\.log\\("
    cooldown: "30m"     # 30 分钟内不重复告警
```

**期望**:

- 一次对话里反复写 console.log,只第一次告,后续抑制;
- cooldown 用人类可读时间(`"30m"` / `"2h"` / `"1d"`);
- cooldown per-file / per-rule 可配。

**踩坑提醒**:

- `cooldown: 0` = 每次都告,慎用;
- 全局 `rules.cooldown`(在文件根)给一个默认,具体 rule 可覆盖。

---

## 场景 7 — stream rules vs advisor vs system prompt

| 维度 | system prompt | advisor (03 课) | **stream rules** |
| ------ | ---------------- | ------------------ | ------------------- |
| 注入时机 | 启动一次 | 每回合末 | 命中 pattern 才 |
| 是否占 context | 是 | 是(短) | 否(条件注入) |
| 抗压缩 | 弱(被压缩挤出) | 弱 | 强 |
| 表达力 | 不限 | 自然语言 | pattern + message |
| 适合 | 行为准则 | 旁听式建议 | 形式约束 / 安全护栏 |

**一句话总结**:
"我要 agent 长期遵守" → system prompt;
"每回合我想要总结" → advisor;
"看到 X 模式时立即反应" → stream rules。

---

## ✅ 这一课你该会的事

1. 在 `~/.omp/agent/rules.yml` 写规则:`id / severity / when / pattern / message / cooldown / onMatch`。
2. 选择 severity:info / warn / error 的判据。
3. 利用 cooldown 防止误触发。
4. 知道 rules 抗 compaction,session 长也可靠。
5. 跟 system prompt / advisor 区分用法。

---

## 🎯 下一课 →

[10-collab-acp.md](./10-collab-acp.md):`/collab` 把 session 分享出去 + ACP (Agent Client Protocol, 把 agent 接入编辑器的协议) 让 Zed/VSCode 直接接 omp。
