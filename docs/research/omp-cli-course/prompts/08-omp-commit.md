# 第八课 · 用户视角 · `omp commit` 原子提交

> 配套主课:[08-omp-commit.md](./../08-omp-commit.md)
> 这一课解决:**周末改了一大堆,周一让 agent 写 message、拆语义、提 commit**。
> 用户视角:`omp commit` + `omp git` + 会话内 `/commit`。
> 口径说明:"按依赖图拆原子 commit / cycle 拒绝 / lockfile 排除"是上游 README 宣传的行为(16 号电池);CLI 可验证的是 message 生成 + changelog 更新 + 自动暂存。以手上版本实测为准。

---

## 场景 1 — 先看一周的改动总览

**目的**:周末写坏了一堆,周一先看清改了哪些。

```bash
omp git          # 交互式全屏 git UI:diff 查看器 + staging 边栏 + commit composer
```

```text
[omp git 界面]
┌ diff viewer ────────────┬ staging ────────────┐
│ src/auth/login.ts       │ (未暂存)             │
│   +120  新增 verifyToken │                     │
│ tests/auth.test.ts      │                     │
│   +40   补测试           │                     │
│ package-lock.json       │                     │
│   +600  dep bump        │                     │
└─────────────────────────┴─────────────────────┘
快捷键:r 刷新 / s stage / u unstage / space 逐 hunk
        1-4 切 diff 视图 / c 提交(支持 vim motions)
```

**期望**:

- 一眼看出哪几个文件"强相关"(auth 三件套);
- lockfile 这种"会自动改"的文件独立可见,别混进语义 commit;
- 或者直接让 agent 在会话里跑 `git status` / `git diff` 给你讲。

---

## 场景 2 — `omp commit`:让 agent 提交

**目的**:message 不想写,让 agent 写;changelog 顺手更。

```bash
omp commit
```

agent 内部大致走:

1. 读工作区改动(README 口径:经 git_overview / git_file_diff / git_hunk 三个内部工具);
2. 识别语义分组,按依赖排序(README 口径:cycle 拒绝、lockfile 排除在分析外);
3. 生成 Conventional Commits 风格 message(用 `commit` role 的模型);
4. 自动暂存该暂存的文件并提交;维护 CHANGELOG 的仓库同步更新。

```text
agent:产出:
  ① feat(auth): add verifyToken with strict mode
  ② refactor(auth): switch middleware to verifyToken
  ③ test(auth): cover strict path
  ④ docs: mention new env in README
  # package-lock.json 不参与语义分析(README 口径)
```

**踩坑提醒**:

- message 风格由项目规则决定——想要中文/特定格式,写进 `AGENTS.md` 或 `.omp/rules/`(第十一课);
- v18.1.6 修过:macOS Unicode 规范化产生的重复文件曾被误含进自动暂存。老版本跑完 `git show --stat` 检查一眼。

---

## 场景 3 — 提交前最后一眼

**目的**:确认"它真按我想的改了吗"。

```bash
omp git          # 在 staging 边栏逐文件 s / u,space 逐 hunk 挑
```

```text
你:看一下 src/api/middleware.ts 这次到底改了啥?

agent:git diff -- src/api/middleware.ts
  @@ -38,7 +38,7 @@
  -  const verified = await verify(token)
  +  const verified = await verify(token, { strict: true })
```

**踩坑提醒**:`omp` 不会在你不知情时提交——要么你显式跑 `omp commit`,要么会话里明确说"提交"。

---

## 场景 4 — 周末攒了一堆改动,周一来分批

```text
你:周末搞了很久,帮我看看都改了啥,按语义拆几个 commit。

agent:分类 → auth 改造(3 文件)/ doc(2 文件)/ build 配置(2 文件)
       逐组生成 message:
       ① feat(auth): verifyToken strict mode
       ② refactor(auth): use verifyToken, drop legacy import
       ③ test(auth): cover strict path
       ④ docs: bump migration notes
       ⑤ ci: bump action to v4
```

**期望**:

- 不用人工"git add 一把梭 + commit -m";
- agent 把语义分组做完,你只审不写。

---

## 场景 5 — `/commit`(会话内)和 `omp commit`(命令行)

| 维度 | `/commit`(TUI 内) | `omp commit`(命令行) |
| ------ | --------------------- | ------------------------ |
| 触发 | 会话里输 `/commit` | 终端直接跑 |
| 上下文 | 能用当前 session 已聊过的内容组织 message | 纯看工作区,不依赖会话 |
| 适合 | 边写边改,message 想带"刚才讨论的结论" | 一次性批量 |

**两者不冲突**:边写边改 → `/commit`;一口气收尾 → `omp commit`。

---

## 场景 6 — message 风格怎么定制

没有 `commit.*` 配置段——风格靠**项目规则**:

```markdown
<!-- .omp/AGENTS.md 或 AGENTS.md 里加一段 -->
## Commit 规范
- Conventional Commits;scope 用模块名
- 中文一句话祈使句,说明"为什么"
```

```text
你:按项目规范提交。
agent:读规则 → 逐组生成 → 提交 → 更新 CHANGELOG
```

---

## 场景 7 — 调错

| 症状 | 看哪儿 | 修法 |
| ------ | -------- | ------ |
| "message 不符合我风格" | 项目规则有没有写 commit 规范 | AGENTS.md / `.omp/rules/` 补一段 |
| "modelRoles.commit 用的谁" | `omp config get modelRoles` | 给 commit role 配个顺手的模型 |
| "自动暂存夹带了不该提的" | `git show --stat` 审一遍 | `git reset` 后手动拣;规则里写清提交边界 |
| "changelog 格式不对" | 项目 CHANGELOG 现有格式 | 规则里写明格式约定 |

---

## 这一课你该会的事

1. `omp git` 全屏 UI 里翻 diff / 挑 hunk / 提交。
2. `omp commit` 生成 message + 更新 changelog(commit role)。
3. 原子拆分 / cycle 拒绝 / lockfile 排除是 README 宣传口径,行为以实测为准。
4. `/commit`(会话内)与 `omp commit`(命令行)各有场景。
5. message 风格走项目规则,不靠 commit.* 配置。

---

## 下一课 →

[09-stream-rules.md](./09-stream-rules.md):`.omp/rules/` 的"时间旅行式 stream rules"——只在触发时才注入,能抗压缩。
