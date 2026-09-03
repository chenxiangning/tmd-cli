# 第九课:Time-traveling stream rules (04 号电池) —— 触发才注入

omp 的 04 号电池,核心是"规则平时不烧 context (上下文窗口 token),模型跑偏时才注入",而且能从断点续上。

> 先纠正一个常见误解:**规则没有 severity 字段**。`aside/concern/blocker` 那套分级是第三课 advisor 的东西;TTSR 规则的开关叫 **`interruptMode`**。两者经常被混为一谈。

## 1. 心智模型

```
传统 agent 规则:
 把所有规则都塞 system prompt
 → 不管这次问啥,模型每次都要"读"一遍
 → token 一直烧
 → 规则越多,留给实际工作的 token 越少

omp time-traveling rules:
 规则平时 dormant (休眠)
 → 模型输出命中正则 → 流中途 abort (中止) → 注入 system reminder → 从断点重试
 → 规则只在需要时消耗 token
 → 注入能扛过 compaction (上下文压缩),修复会"粘住"
```

## 2. 完整工作流

```
[模型流式输出 ...]
"我已经写好了性能优化:用 Box::leak 持有大字符串..."
                                              ↓
                            规则条件命中: /Box::leak/
                                              ↓
                            流中止(red error)
                                              ↓
                  注入隐藏消息(50ms 后自动重试):
                  <system-interrupt reason="rule_violation" rule="box-leak">
                  Don't reach for Box::leak in production code paths.
                  Use Arc<str> instead, it supports cheap cloning
                  and is automatically dropped when the last reference goes.
                  </system-interrupt>
                                              ↓
                            从断点续上(不是重开一轮)
                                              ↓
[模型继续 ...]
"我重新审视方案,Box::leak 在生产路径里不合适,改成 Arc<str>。"
```

这段例子逐字来自上游 README(04 号电池的演示):"A regex match aborts the stream mid-token, injects the rule as a system reminder, and retries from the same point."

三档处理方式,按规则的 `interruptMode`:

| 命中位置 | 打断型规则 | 非打断型规则 |
| -------- | ---------- | ------------ |
| 正文/思考流 (prose) | abort 当前流 → 注入 → 50ms 后重试 | 消息完成后用 followUp 补注入 |
| 工具调用流 (tool) | 只中止**那一个**工具调用 → 注入 → 重试 | 在该工具的 result 前面拼一条 `<system-reminder>` |

## 3. 规则文件:真实格式

规则就是带 frontmatter 的 Markdown,放在规则目录里(见 §4),没有独立的 `rules.yml`:

```markdown
---
name: box-leak
description: 生产代码不要用 Box::leak
condition:
  - "Box::leak"
interruptMode: always
---
Don't reach for Box::leak in production code paths.
Use Arc<str> instead — it supports cheap cloning
and is automatically dropped when the last reference goes.
```

全部 frontmatter 字段:

| 字段 | 含义 |
| ------ | ------ |
| `name` | 规则 ID(缺省取文件名) |
| `description` | 一句话描述(进 rulebook 索引) |
| `condition` | 正则数组,匹配模型输出流;写 `(?i)` 这类内联开关也认 |
| `astCondition` | ast-grep pattern 数组——只在 edit/write 的**工具流**上匹配(看的是"你写进文件的代码",不是"你说的话") |
| `globs` | 规则适用的文件范围 |
| `scope` | 监听范围:`text` / `thinking` / `tool` / `tool:edit(src/**)` 这样精确到"哪个工具的哪些文件" |
| `agents` | 只对名字匹配的 agent 生效(`main`/`sub` 是保留哨兵) |
| `alwaysApply` | true = 不做触发式,直接常驻 system prompt |
| `interruptMode` | `always` / `tool-only` / `prose-only` / `never` |

巧思:condition 里如果写的是**文件 glob**(比如 `*.sql`),omp 会自动翻译成 `scope: tool:edit/write(glob)` + 全匹配 condition——"凡是往 .sql 文件里写东西就提醒我"一行搞定。

## 4. 规则从哪来:继承你已有的规则

| 来源 | 位置 | 优先级 |
| ------ | ------ | ------ |
| native | `.omp/rules/*.{md,mdc}`(项目+用户)、粘性 `RULES.md` | 100 |
| omp-plugins | 插件带的规则 | 90 |
| agents | `.agent/rules/`、`.agents/rules/` | 70 |
| cursor | `.cursor/rules/*.mdc` | 50 |
| windsurf | `.windsurf/` 的 `global_rules` | 50 |
| cline | `.clinerules` | 40 |
| github copilot | `*.instructions.md`(`applyTo` 带_glob → 转 globs) | 30 |
| builtin-defaults | omp 自带(如安全类) | 1 |

同名规则先到先得;`RULES.md` 是粘性规则(强制 always-Apply,常驻 prompt)。所以你团队已有的 Cursor/Windsurf/Cline 规则**不用迁移**,直接被读进来(第十一课展开)。

## 5. 防噪:repeat 策略

```yaml
# ~/.omp/agent/config.yml
ttsr:
  enabled: true            # 默认开
  interruptMode: always    # 默认打断
  contextMode: "discard"   # 注入被压缩掉就丢("keep" 则尽力保留)
  repeatMode: "once"       # 一条规则整个会话只注入一次(默认)
  repeatGap: 10            # after-gap 模式:间隔 10 个完成 turn 后可再次触发
  builtinRules: true       # 内置规则开关
  disabledRules: []        # 按名字关掉某些规则
```

原因:重构过程中同一条规则会反复命中(比如满屏空 catch),默认 `once` 注一次;想"过一阵再提醒"用 `after-gap` + `repeatGap`。

## 6. 实战:用户视角

```text
[对话]
我: 把这个 Rust 服务 hot path 用 Box::leak 优化
agent: 我建议改成 Box::leak 持有常驻字符串,避免每次重新分配……

[规则触发]
⚠ Injecting rule: box-leak → Don't reach for Box::leak …

[agent 重写]
agent: 等等——Box::leak 在生产路径不合适,Arc<str> 也能达到目的且会自动释放。改成 Arc<str>?
```

调试规则不用猜:

```bash
omp ttsr            # 检查/测试规则:哪些注册了、哪些进了常驻桶
```

`rule://box-leak` 这个 URL 还能直接读规则全文(第十一课的 scheme 家族成员)。

## 7. injection survives compaction (注入抗压缩)

会话长了会做 context compaction (上下文压缩,把早期对话压成摘要省 token)。TTSR 的注入是**持久化的会话条目**(`ttsr_injection`),恢复会话时规则注册状态也跟着回来——README 原话:"Injections survive compaction, so the fix sticks." `contextMode: keep` 可以让注入内容在压缩时尽量保留。

## 8. 与传统 system prompt 规则的对比

| | 传统 system prompt 规则 | omp stream rules |
| --- | ----- | ------ |
| Token 消耗 | 永远在烧 | 触发才烧(常驻规则除外) |
| 触发精准度 | 模型"知道但容易忘" | **正则/AST 命中,无法忽略** |
| 修正方式 | 模型可能不改 | 打断型强制就地重写 |
| 抗压缩 | 一般 | ✅ 注入持久化 |
| 既有规则 | 要手动合并 | ✅ 直接继承 7 家格式 |

## 9. 与 advisor 的区别

| | advisor | stream rules |
| --- | --------- | ------------- |
| 触发 | 每 turn 看转录增量 | 正则/AST 命中输出流 |
| 上下文 | 独立模型 + 独立 context | 注入主对话,同一模型 |
| 分级 | nit / concern / blocker | 无分级,靠 `interruptMode` 控制是否打断 |
| 适合 | "宏观决策"(这个方案有风险) | "具体写法"(你用了 Box::leak) |

**实战组合**:advisor 管策略,stream rules 管红线。

## 小结

| 概念 | 干什么 |
| ------ | -------- |
| `condition` | 正则匹配输出流 |
| `astCondition` | ast-grep 匹配写盘内容 |
| `interruptMode` | always / tool-only / prose-only / never |
| `scope` / `agents` / `globs` | 把规则限定到具体工具、文件、agent |
| `repeatMode` + `repeatGap` | 防止反复触发刷屏 |
| 抗 compaction | 注入持久化,修复粘住 |

和 pi 的对照:**pi 把规则塞进 system prompt 烧 token,omp 把规则做成"运行时拦截器"**——这就是 README 里 "course-correction without paying context tax" 的意思。

## 下一课预告:第十课:`/collab` + ACP/Zed

- `/collab`:链接 + QR + view 只读协作 session
- ACP (Agent Client Protocol):在 Zed 编辑器里直接驱动 omp
- 两套机制的对照与组合
