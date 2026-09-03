# omp CLI · 用户视角速查

> 配套主课文件夹:[../](../)(14 个 .md + README)
> 这一目录是 **每个课时单独的用户使用视角示例**:用户提示词(给 agent 的话)+ 操作命令(给终端的话)+ 实战场景。
>
> 主课讲 "是什么 / 怎么工作";这里讲 "我具体怎么敲"。

---

## 这目录是干嘛的

主课写得详细,适合"想了解原理 / 验证用法"。
本目录是"打开就能抄命令、抄提示词"的速查卡。

每篇结构:

```text
场景 1 ... 6  ──── 一段一段的提示词 / 命令 / 期望效果
✅ 这一课你该会的事 ── 自检清单
🎯 下一课 → ── 接下一个课的入口
```

**关键约定**:

- **English (Chinese)** 注解格式 —— 首次出现的英文专有名词都加中文翻译。
- 命令片段都能直接复制到终端跑。
- 对话片段(`你:` / `agent:`)展示"用户提示词是什么样"。

---

## 14 课索引

| 课 | 用户视角速查 | 主课 | 一句话 |
| ---- | ----------- | ------ | -------- |
| 01 | [01-basics.md](./01-basics.md) | [../01-basics.md](../01-basics.md) | 装包 / 登录 / 切 modelRoles / 跨 pi 心智模型差异 |
| 02 | [02-editing-revolution.md](./02-editing-revolution.md) | [../02-editing-revolution.md](../02-editing-revolution.md) | hashline 改一行 / ast_edit 多文件 / conflict:// 冲突 URL |
| 03 | [03-smart-collaboration.md](./03-smart-collaboration.md) | [../03-smart-collaboration.md](../03-smart-collaboration.md) | task 子代理扇出 / advisor 旁听 / /review verdict + 置信度 |
| 04 | [04-ide-depth.md](./04-ide-depth.md) | [../04-ide-depth.md](../04-ide-depth.md) | LSP 14 ops / DAP 28 ops / ast_grep 写复杂 pattern |
| 05 | [05-memory-system.md](./05-memory-system.md) | [../05-memory-system.md](../05-memory-system.md) | checkpoint + rewind / retain / recall / reflect / learn / manage_skill |
| 06 | [06-multi-model-routing.md](./06-multi-model-routing.md) | [../06-multi-model-routing.md](../06-multi-model-routing.md) | fallback / 凭据池 / path-scoped / 30+ Coding Plan OAuth |
| 07 | [07-web-search.md](./07-web-search.md) | [../07-web-search.md](../07-web-search.md) | 23 provider / site-aware / NVD-OSV-GHSA / arxiv handler |
| 08 | [08-omp-commit.md](./08-omp-commit.md) | [../08-omp-commit.md](../08-omp-commit.md) | git_overview / atomic commit / 依赖图 / lockfile 排除 |
| 09 | [09-stream-rules.md](./09-stream-rules.md) | [../09-stream-rules.md](../09-stream-rules.md) | rules.yml 触发式注入 / severity / cooldown / 抗压缩 |
| 10 | [10-collab-acp.md](./10-collab-acp.md) | [../10-collab-acp.md](../10-collab-acp.md) | /collab session 分享 / ACP 接入 Zed / 多模式 |
| 11 | [11-inheritance-filesystem.md](./11-inheritance-filesystem.md) | [../11-inheritance-filesystem.md](../11-inheritance-filesystem.md) | 继承 8 种 agent 格式 / 16 个 scheme:// / ssh:// 远程 |
| 12 | [12-session-modes.md](./12-session-modes.md) | [../12-session-modes.md](../12-session-modes.md) | /vibe / /fresh / /model / ultrathink / orchestrate / workflowz |
| 13 | [13-multimodal-desktop.md](./13-multimodal-desktop.md) | [../13-multimodal-desktop.md](../13-multimodal-desktop.md) | browser / computer / generate_image / inspect_image / tts |
| 14 | [14-final-comparison.md](./14-final-comparison.md) | [../14-final-comparison.md](../14-final-comparison.md) | omp vs pi vs opencode 终极对比表 + 5min/周/月 三档清单 |

---

## 用法速记

### 想 "今天就上手"

1. [01 用户视角](./01-basics.md) 场景 1-3 = 装包、登录、shell completion(5 分钟)
2. [02 用户视角](./02-editing-revolution.md) 场景 1-2 = 改一行 + 改多文件(15 分钟)
3. [07 用户视角](./07-web-search.md) 场景 1-3 = web_search 实战(15 分钟)

### 想 "本周上手"

按 [14 用户视角](./14-final-comparison.md) 场景 3("一周内")照单做,6 步覆盖 9 大特性。

### 想 "理解原理"

主课(同目录 `../*.md`)逐课读;速查(本目录)跟着做。

---

## 一个完整的对话示例(摘自 14 课)

```text
你:看一下 src/auth/login.ts。
   #12 课 /vibe    —— 只读,agent 给建议

agent:
  - L42 改 atomic CAS (理由:race condition)
  - L88 删 console.log (理由:污染日志)
  - L120 try-finally 没关 file handle (理由:fd 泄漏)

你:/vibe off
   #02 课 hashline
   改 L42 加 atomic CAS

agent:edit src/auth.ts {
  "#42 x9k7": "    const next = await refreshAtomic(current);"
}

你:把这次改动 commit 上。
   #08 课 omp commit

agent:✓ 拆 3 个 commit:
       ① feat(auth): atomic CAS refresh
       ② refactor(auth): drop legacy refresh
       ③ test(auth): cover race
```

整个工作流用了 01 / 02 / 08 三课的内容。

---

## 维护约定

- **任何修改本目录的 PR,只动本目录**;主课目录 `../*.md` 不在本目录维护。
- **格式铁律**(沿用 `AGENTS.md` 的 Format Discipline Gate):只格式化本目录里**本次改动**的文件 / hunk,不要 sweep 其他文件或主课文件。
- **English (Chinese) 注解** 是必须,新人 PR 不符合会被打回。
- **不写冗长解释** —— 这目录是 "用的时候打开,抄一句话";详细解释在主课。

---

## 关联索引

- 主课 README:[../README.md](../README.md)
- mossx 项目规则:`/AGENTS.md`
- mossx 文档中心:[../../../README.md](../../../README.md)
