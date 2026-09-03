# 第八课 · 用户视角 · `omp commit` 原子提交

> 配套主课:[08-omp-commit.md](./../08-omp-commit.md)
> 这一课解决:**周末改了一大堆,周一让 agent 按"依赖图"自动拆 commit**。
> 用户视角:git_overview / git_file_diff / git_hunk + `omp commit`。

---

## 场景 1 — 先看一周的改动总览

**目的**:周末写坏了一堆,周一不知道改了哪些。

```bash
# 看总览:被改的文件 + 每个文件大致是什么类型
git_overview
```

agent:打印类似:

```text
Overview (working tree):
  src/auth/login.ts    added     +120   (new func: verifyToken)
  src/auth/middleware  modified   -8/+4  (use new verifyToken)
  tests/auth.test.ts   modified   +40   (cover new func)
  package-lock.json    modified   +600  (dep bump)
  README.md            modified   +12   (mention new env)
  src/api/oauth.ts     modified   -2/+6  (cleanup)
```

**期望**:

- 一眼能看出哪几个文件是"强相关"(auth 三个文件);
- package-lock 这种"会自动改"的文件独立列出,后面 commit 排除;
- 数字告诉你改动规模,让你决定是否值得拆 commit。

---

## 场景 2 — `omp commit`:自动按依赖图拆分

**目的**:不要"一个大 commit 塞 12 个文件",自动拆成多个语义 commit。

```bash
# 自动按改动类型 + 文件依赖拆成多个 commit
omp commit
```

agent 内部走:

1. **依赖图分析**(`grep` import 出"哪些文件被谁依赖");
2. **cycle detection**(A → B → A 不会无限跑);
3. **priority scoring**(基础类型 > 业务逻辑 > docs > lockfile);
4. **lockfile 排除**(`*.lock*`、`*.lock.json`、`pnpm-lock.yaml` 不入 commit);
5. **commit message 生成**(接 09 课的 stream rules)。

```text
agent:产出 5 个 commit:
  ① feat(auth): add verifyToken (src/auth/login.ts)
  ② refactor(auth): switch to verifyToken (src/auth/middleware.ts, src/api/oauth.ts)
  ③ test(auth): cover verifyToken (tests/auth.test.ts)
  ④ docs: README mention env (README.md)
  # package-lock.json 自动跳过,不进 commit
```

**期望**:

- "我改了就改了的"常规 commit,顺序按"基类 → 上层 → 文档";
- 跳过 lockfile (锁文件,自动生成不应手提交),需要的话另开 "chore(deps)";
- 一个 commit 一个语义,可以独立 revert / cherry-pick。

**踩坑提醒**:

- `omp commit` 看到 `--staged` 标志 → 只 commit 已经 staged 的文件;
- `omp commit --no-cycle-check` 跳过环检测(谨慎)。

---

## 场景 3 — 看具体单文件 diff (程序员做事前的最后一眼)

**目的**:commit 之前检查"它真按我想的改了吗"。

```text
你:看一下 src/api/middleware.ts 这次到底改了啥?

agent:git_file_diff { file: "src/api/middleware.ts" }

agent:
  @@ -38,7 +38,7 @@
  -  const verified = await verify(token)
  +  const verified = await verify(token, { strict: true })
```

```text
你:看第二个 hunk 具体点(就是 verify import 那块)。

agent:git_hunk { file: "src/api/middleware.ts", hunk: 2 }

agent:
  @@ -1,5 +1,5 @@
   ...
  - import { verify } from '../auth/verify'
  + import { verify } from '../auth/login'
```

**期望**:

- `git_file_diff` 给你"全部 hunk + 头几行";
- `git_hunk` 精准到"某一处 hunk",改 import / 改函数签名都拿得到。

**踩坑提醒**:`omp` 不擅自 commit——三看完(overview → file_diff → hunk)再下命令。

---

## 场景 4 — 周末攒了一堆改动,周一来分批

```text
你:周末搞了很久,帮我看看这次都改了啥,再帮我按依赖拆成 3-5 个 commit。

agent:跑 git_overview → 拿到 9 个文件,3 大类型:
       - auth 改造(3 文件)
       - doc 更新(2 文件)
       - build 配置(2 文件,CI、tsconfig)
       生成如下 commit:
       ① feat(auth): verifyToken strict mode
       ② refactor(auth): use verifyToken, drop legacy import
       ③ test(auth): cover strict path
       ④ docs: bump migration notes
       ⑤ ci: bump action to v4
```

**期望**:

- 不让你人工"git add 一把 + commit -m";
- agent 把"语义 group"做完,你只审不写。

---

## 场景 5 — `/commit` 和 `omp commit` 的区别

| 维度 | `/commit` (TUI 内) | `omp commit` (命令行) |
| ------ | --------------------- | ------------------------ |
| 触发 | 在 TUI 输 `/commit` | 终端 `omp commit` |
| 行为 | 用当前 session 的 agent context (上下文,包括已经持有的信息) 写 message + commit | 完全 deterministic (确定性行为,结果可预期),只看 git status |
| 适合 | 已经聊过的改动,有 narrative | 一次性批量,不依赖 session |
| 自定义 | 受 `stream rules` 影响(09 课) | 走 config 的 commit 段 |

**两者不冲突**:

- 边写边改 → 用 `/commit`(可以"按当前讨论"组织);
- 一口气批拆 → 用 `omp commit`(机器驱动)。

---

## 场景 6 — 配置:自定义 commit 风格

```yaml
# ~/.omp/agent/config.yml
commit:
  messageStyle: "conventional"          # Conventional Commits(标准化 commit 格式),默认
  scopeHints:
    - match: "src/auth/**"
      scope: auth
    - match: "src/api/**"
      scope: api
  exclude:
    - "**/*.lock"
    - "**/*.lock.json"
    - "package-lock.json"
    - "pnpm-lock.yaml"
  maxCommitsPerRun: 8                   # 一次不超过 8 个
  cycleGuard: true                      # 环检测,默认 true
```

**期望**:

- 自动按 path 算 scope:src/auth → "auth",src/api → "api";
- 自动排除 lock 文件(可关);
- 一次 > 8 个 commit 时停一停,让你审;
- cycle 检测开 → 依赖图有环就先报告,不擅自提交。

---

## 场景 7 — 调错

| 症状 | 看哪儿 | 修法 |
| ------ | -------- | ------ |
| "它漏了一个文件" | `git_overview`,看是不是 path pattern 没匹配 | 调 `commit.scopeHints` |
| "它没拆 commit,全塞一个" | 看文件是不是同类型 | 加 path hint 分类型 |
| "lockfile 也提交了" | `commit.exclude` 段 | 把 `package-lock.json` 加进去 |
| "commit message 不符合我风格" | `commit.messageStyle` | 改 conventional → angular → custom |
| "环太多,跑 30 分钟" | `cycleGuard` 报错 | 用 `omp commit --no-cycle-check` 应急 |

```bash
# 应急:绕开 cycle 检测,只求先提交
omp commit --no-cycle-check

# 查看上一轮的 commit 计划,不真提交
omp commit --dry-run
```

---

## ✅ 这一课你该会的事

1. 用 `git_overview` 先看变更总览。
2. `omp commit` 按依赖图拆多个语义 commit,自动排除 lockfile。
3. `git_file_diff` / `git_hunk` 做"提交前最后一眼"。
4. `/commit` 与 `omp commit` 各有场景,不混。
5. 配置 `commit.scopeHints` 让自动 message 顺眼。

---

## 🎯 下一课 →

[09-stream-rules.md](./09-stream-rules.md):`rules.yml` 的"时间旅行式 stream rules"——只在触发时才注入,能抗压缩、能 cooldown。
