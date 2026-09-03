# 第四课 · 用户视角 · IDE 深度(LSP / DAP / ast_grep)

> 配套主课:[04-ide-depth.md](./../04-ide-depth.md)
> 这一课解决:**让 agent 像 IDE 一样聪明(跳转/重命名/调试),又像 grep 一样能"看见结构"**。
> 用户视角:LSP (Language Server Protocol, 语言服务协议) 14 个 ops、DAP (Debug Adapter Protocol, 调试适配协议) 28 个 ops、ast_grep 写更复杂 pattern。

---

## 场景 1 — 让 agent "find references" 一个函数

**目的**:agent 自己用 LSP (Language Server Protocol,IDE 的智能大脑,负责跳转/补全/重定义) 找引用,不靠你贴 grep 结果。

```text
你:src/auth.ts 第 2 行的 verify 函数被谁调用?列出来。

agent:lsp { op: "find_references", file: "src/auth.ts", line: 2, character: 17 }

agent:
  - src/auth.ts:3     login()
  - src/middleware.ts:42  requireAuth()
  - src/api/oauth.ts:8  exchangeToken()
  - tests/auth.test.ts:21  expect(verify)
```

**期望**:

- agent 不用你说"在 src 下 grep verify"——它自己起 LSP,直接拿引用列表;
- 列表带 file:line 锚点,你可以直接命令 agent "把 src/api/oauth.ts 那处的错误处理改成 e.message"。

**踩坑提醒**:大型 monorepo 第一跑 LSP 慢;之后有 cache。

---

## 场景 2 — 改函数名:workspace/willRenameFiles

**目的**:rename 之前让所有 language server 报告"哪些文件会被波及",改完一遍走完。

```text
你:把 verify() 重命名为 verifyToken(strict: boolean),先扫一遍影响面。

agent:lsp {
  op: "rename_will_rename_files",
  file: "src/auth.ts",
  line: 2, character: 6,
  newName: "verifyToken"
}

agent:影响 14 个文件,3 个 tsconfig (项目配置) 已对齐。
   打开 Accept Card,apply 即可一次性改完。
```

**期望**:

- 改之前所有 language server (TypeScript, ESLint, Astro 等)都报告"我会动哪儿",不再"改 A 漏 B";
- 一次性 atomic (原子操作,即要么全部改成功、要么全不改动)改 14 个文件,你不用人工 reconcile;
- 这跟 hashline 的"改一行"不一样 —— 这次是"全仓 atomic rename"。

---

## 场景 3 — 调试一个 C 程序段错误

**目的**:agent 真挂调试器(gdb/lldb 之类的断点调试工具,通过 DAP 协议接入)而不是 `console.log` 猜。

```text
你:demo.c 跑出来段错误,debug 一下。

agent:debug {
  op: "launch",
  program: "./demo",
  args: ["input.txt"]
}

agent:程序停在 __libc_start_main。

agent:debug { op: "setBreakpoint", file: "demo.c", line: 6 }
agent:debug { op: "continue" }

agent:停在 demo.c:6。

agent:debug { op: "stackTrace" }
agent:debug { op: "scopes",     frameId: 0 }
agent:debug { op: "variables",  variablesReference: 18 }

agent:i = 7。next:

agent:debug { op: "evaluate", expression: "7 ^ (7 << 13)", frameId: 0 }

agent:= 458752。 bingo —— 算术溢出就是 bug 在这里。
```

**期望**:

- agent 真在 DAP 里跑 gdb/lldb,你看到的是真断点、真变量、真栈;
- 28 个 ops 覆盖 launch/breakpoint/inspect/watch/repl;
- 调试 vs print:debug 能"在任意行表达式求值",不只是事后 log。

**踩坑提醒**:

- 调试需要编译时带调试符号(`-g`),不然断点可能漂;
- 多线程场景下 DAP 比 print 高一个量级。

---

## 场景 4 — ast_grep 写"找空 try-catch"

**目的**:写带 constraint (约束条件,细化 pattern 匹配范围)的 pattern,精准找出"空 catch"。

```text
你:扫 src/**/*.ts,找出所有 catch 块是空的(啥都没干)。

agent:ast_grep {
  pattern: "try { $$$BODY } catch ($E) { $$$HANDLER }",
  constraints: { handlerIsEmpty: true },
  scope: "src/**/*.ts"
}

agent:7 个文件 12 处:

src/api/oauth.ts:42
src/api/middleware.ts:18
...
```

**期望**:

- ast_grep 知道 try-finally / try-with-resources,不会把它们当 try-catch;
- 加 `constraints: handlerIsEmpty` 之后,空 catch 才命中,有 log 也不算;
- 比 `grep "catch"` 准一个量级。

**小贴士**:pattern 里 `$$$BODY` 是"任意多语句",`$E` 是"单个变量"。配合 constraint 才能精细。

---

## 场景 5 — 复杂 pattern:跨多语言/排除 tsx

```yaml
# 在 .omprc.yml 里启规则
rules:
  - id: no-empty-catch
    severity: error
    pattern: "try { $$$BODY } catch ($E) { $$$HANDLER }"
    constraints: { handlerIsEmpty: true }
    scope: "src/**/*.ts"        # 排除 *.tsx
```

**期望**:

- `severity: error` 命中 → TUI/Accept Card 强制 apply;
- 排除特定文件 → `exclude: ["**/*.test.ts"]`。

---

## 场景 6 — 三件武器联动:跨文件改 API

```text
你:把 login() 函数加个 { strict: boolean } 参数,所有调用方要同步改。

agent:Step 1 ─ ast_grep 找 import { login }  → 列出 6 个调用方
       Step 2 ─ lsp  find_references login → 核验完整列表
       Step 3 ─ lsp  willRenameFiles → 影响面 = 6 个 .ts + 2 个 .d.ts
       Step 4 ─ acceptCard 让你看 diff → apply → 跑测试
```

**期望**:

- 三件武器(seq 串起来)15 分钟干完原本 2 小时的活;
- 一遍到位、不漏调用方。

---

## 场景 7 — 三件武器 vs 传统 grep/print/console.log

| 维度 | grep / print | LSP + DAP + ast_grep |
| ------ | ---------------- | ---------------------- |
| 找引用 | grep 出关键词 | LSP 准到 引用 vs 调用 |
| 改多文件 | sed/手动 | LSP rename atomic |
| 调试 | printf | 真断点 + inspect |
| 检索 | grep "try" | ast_grep 知道"try-finally 不是 try-catch" |
| 跨语言 | 不行 | 各 language server 都能接 |

**一句话总结**:
agent 想要 IDE 那样的"脑子",都得靠 LSP;DAP 调试比 print 准;ast_grep 比 grep 准。三件都是 omp 内置,不用你装额外插件。

---

## ✅ 这一课你该会的事

1. 找引用 → 让 agent 跑 `lsp.find_references`,自己别 grep。
2. 改 API/重命名 → `lsp.rename_will_rename_files` → Accept Card 一把梭。
3. 调试段错误 → DAP 28 ops,真断点真栈;不带 `-g` 是坑。
4. 写精细的 ast_grep pattern,用 `constraints` 收窄。
5. 跨文件重构 = ast_grep 找 + LSP 影响面 + Accept Card。

---

## 🎯 下一课 →

[05-memory-system.md](./05-memory-system.md):三层 memory:Conversation(checkpoint + rewind)、Long-term Facts(retain/recall/reflect)、Skills(learn + manage_skill)。
