# 第四课:IDE 深度 —— LSP + DAP + ast_grep

这一课把 agent 接入"IDE 的脑子"——它不再只是 grep 文本,而是**真的懂代码**;也不只是 print 调试,而是**真挂调试器**。

---

## 1. 三个协议/工具一句话定位

| 工具 | 全称 | 干什么 | pi 有吗 |
| ------ | ------ | -------- | :---: |
| `lsp` | Language Server Protocol (语言服务器协议) | 把代码当 AST (抽象语法树) 理解:跳转定义、查找引用、重命名、悬浮文档、错误提示 | ❌ |
| `debug` | Debug Adapter Protocol (调试适配器协议) | 挂真实调试器:断点、单步、读栈帧、读变量、表达式求值 | ❌ |
| `ast_grep` | 基于 tree-sitter (语法解析器) + ast-grep 的结构化代码搜索 | 模式匹配代码结构(节点),不是匹配字符串 | ❌ |

> 简单类比:LSP 是"读懂代码",DAP 是"调代码",ast_grep 是"搜代码坏味道"。

---

## 2. LSP:14 个 action 让 agent 拥有 IDE 的脑子

### 2.1 LSP 是什么(如果你完全没听过)

LSP 是 Microsoft 2016 年提的一个**协议**。一个 language server (语言服务器,比如 `typescript-language-server`) 跑在你机器上,暴露 JSON-RPC 接口;IDE 或工具(这里是 omp)调它。

一次 server 跑起来后,能回答:

```
"这行代码里 User 这个 symbol 在哪定义的?"   → definition
"这个 User 类型被谁引用了?"                 → references
"把 login 改成 signIn,所有引用同步改"      → rename
"auth.ts → login.ts 连文件带引用一起改"    → rename_file
"这行有什么错误?"                           → diagnostics
"这个函数类型是什么?"                       → hover
```

### 2.2 omp 怎么用 LSP(14 个 action)

omp 把 LSP 能力打包成一个 `lsp` 工具(默认启用,需装对应语言服务器),action 全集:

| action | 用途 |
| ------ | ------ |
| `diagnostics` | 当前文件/整个工作区(`file: "*"`)的报错/警告 |
| `definition` | 跳转到定义 |
| `type_definition` | 跳转到类型定义 |
| `implementation` | 找接口的实现 |
| `references` | 找所有引用 |
| `hover` | 悬浮文档(类型/JSDoc) |
| `symbols` | 单文件符号列表;`file: "*" + query` 全工作区搜符号 |
| `rename` | 符号重命名(**默认直接应用**,`apply: false` 只预览) |
| `rename_file` | 移动文件**并**改写所有 import/引用 |
| `code_actions` | 快速修复(默认只列出,`apply: true + query` 应用某一个) |
| `status` | 各语言服务器运行状态 |
| `reload` | 重启某个(或全部)语言服务器 |
| `capabilities` | 查询 server 能力 |
| `request` | 任意 LSP 请求透传 |

定位用 `file + line(1-based) + symbol`(symbol 是子串匹配,`#N` 选第 N 个);项目感知的 server 上,`definition/references/rename` 给了 `line` 却不给 `symbol` 会**直接报错**,不会静默猜。

### 2.3 杀手锏:rename 走 `workspace/willRenameFiles`

**普通 agent 的 rename**(pi 也是):

1. agent 改 `auth.ts` 里 `login → signIn`
2. 跑 `grep "login"` 找其它地方
3. 一个一个改 import、调用点、re-export
4. **漏改**的概率高

**omp 的 rename** 走 LSP 的 `workspace/willRenameFiles`:

```text
agent: rename login → signIn

omp 内部:
1. 问 TypeScript LSP:"我要改这些文件,你需要先做什么?"
   LSP 答:"barrel (集中导出文件) 里的 re-export (重新导出) 要重写"
2. omp 先把 barrel、re-export 改好
3. 再发 "真的要改了" 给 LSP
4. LSP 把所有引用同步更新
5. 落盘
```

结果:**rename 一个函数,所有 import、re-export、barrel 全部自动跟进**;挪文件用 `rename_file`,import 路径一起改。

> omp README 原文:"Ask for a rename and you get a rename. The call goes through workspace/willRenameFiles, so re-exports, barrel files, and aliased imports update before the file moves."

### 2.4 实战:agent 怎么用 lsp 工具

```js
// 找到 login 的所有调用点
lsp { action: "references", file: "src/auth.ts", line: 2, symbol: "login" }

// 准备改 login → signIn(先预览)
lsp { action: "rename", file: "src/auth.ts", line: 2, symbol: "login", new_name: "signIn", apply: false }
// 确认没问题,真改(去掉 apply: false 即默认应用)

// 写完后看看有没有类型错
lsp { action: "diagnostics", file: "src/auth.ts" }
```

### 2.5 支持哪些语言服务器

装好对应 runtime,omp 自动起:`typescript-language-server`、`pyright`、`gopls`、`rust-analyzer`、`clangd`、`jdtls`(Java) 等;`lsp { action: "status" }` 随时看哪个活着。

### 2.6 与 pi 对比

| 维度 | pi | omp |
| ------ | ----- | ----- |
| LSP 支持 | ❌(纯 grep) | ✅ 14 actions |
| Rename 改 barrel | 手动 | **自动**(`willRenameFiles`) |
| 类型错误感知 | 无 | ✅(diagnostics) |
| 跨语言 | n/a | TS/JS/Python/Go/Rust/C/C++/Java/... |

---

## 3. DAP:28 个 action 让 agent 真挂调试器

### 3.1 DAP 是什么

调试适配器协议。和 LSP 是孪生兄弟:

- LSP server 负责"读懂"
- DAP server (debug adapter, 调试适配器) 负责"调试"

| 语言 | 调试器 | adapter id (omp 里的名字) |
| ------ | -------- | --------------------- |
| C/C++/Rust | lldb | `lldb-dap` |
| C/C++ | gdb | `gdb` |
| Go | delve | `dlv` |
| Python | debugpy | `debugpy` |
| Ruby | rdbg | `rdbg` |
| Node.js | js-debug | `js-debug-adapter`(omp 的 adapter id,不是 npm 包名) |

其他 DAP 实现可以通过 `dap.json` 配置接入。

### 3.2 omp 的 28 个 action

```
会话:   launch, attach, terminate, sessions, output
断点:   set_breakpoint, remove_breakpoint,
        set_instruction_breakpoint, remove_instruction_breakpoint,
        data_breakpoint_info, set_data_breakpoint, remove_data_breakpoint
控制:   continue, pause, step_over, step_in, step_out
线程:   threads, stack_trace
变量:   scopes, variables
求值:   evaluate
内存:   read_memory, write_memory, disassemble
其它:   modules, loaded_sources, custom_request
```

默认启用;同一时刻**只有一个**活跃调试会话,第二个 launch 要等 terminate。

### 3.3 实战场景:agent 真调试一个 C 程序 segfault (段错误)

任务: "这个 C 二进制随机数生成器崩了"

```js
// 1. 启动 lldb-dap,跑二进制
debug { action: "launch", adapter: "lldb-dap", program: "/tmp/omp-native/demo" }

// 2. 在可疑函数设断点
debug { action: "set_breakpoint", file: "demo.c", line: 6 }

// 3. 继续执行
debug { action: "continue" }
// → 命中 xorshift32()

// 4. 看栈帧
debug { action: "stack_trace" }
// → frame 0: xorshift32, ip=0x10000055C, demo.c:6:10

// 5. 看变量
debug { action: "scopes", frame_id: 0 }
debug { action: "variables", variable_ref: <ref> }
// → x = 57351

// 6. 表达式求值:确认数学
debug { action: "evaluate", expression: "7 ^ (7 << 13)", frame_id: 0 }
// → 57351

// agent: "x 从 7 变成 57351 (= 7 ^ (7<<13)),shift 没问题,
//  问题在循环里 next_x 没归一化,再加 & 0x7fffffff 就行"
```

> omp README 原文:"A C binary segfaults: the agent attaches lldb, steps to the bad pointer, reads the frame. ... Most agents are still sprinkling print statements."

### 3.4 与 pi 对比

| 维度 | pi | omp `debug` |
| ------ | ----- | ------------ |
| 调试方式 | print + 肉眼 | **真挂调试器** |
| 断点/单步/求值 | 无 | ✅ |
| 线程/栈/内存 | 无 | ✅ |
| 适配器 | n/a | lldb-dap / gdb / dlv / debugpy / rdbg / dap.json |

### 3.5 调试 vs print 的取舍

```
Print 调试适合:
- 单线程、状态简单
- 出错立刻能猜到位置
- 不想装调试器

DAP 调试适合:
- 多线程、并发、条件竞争
- 难复现的 bug
- 想看"程序此刻状态"而不是"程序走到了这里"
- agent 自动调试(人不想看)
```

---

## 4. ast_grep:结构化代码搜索

### 4.1 为什么不能只用 grep

```bash
grep "try {" src/**/*.ts  # 命中所有 try 块,但分不清 try-catch、try-finally
grep "console.log"        # 命中字符串里、注释里、import 里,全是误伤
```

grep 是**字符串匹配**,看不懂语法。

### 4.2 ast_grep 怎么写 pattern

ast-grep pattern 是用代码本身写的,代表一个 **AST 节点**。参数只有三个:

```js
ast_grep {
  pat: "console.log($X)",   // 单个 pattern(不能传数组)
  path: "src;lib",          // 分号分隔的文件/目录/glob,默认 "."
  skip: 0                   // 跳过前 N 个命中(翻页用)
}
```

- `$X` 是 metavar (元变量) = 任意单节点;`$$$BODY` = 零或多节点;`$_` = 占位不捕获;变量名大写、必须是完整节点
- 结果**默认最多 50 个匹配**(解析问题最多列 20 条)
- 支持 ~55 种 tree-sitter 语法(README 口径 "50+")
- **默认关闭**:`astGrep.enabled: true` 才注册这个工具;`ast_edit` 则默认开

### 4.3 实战例子

**找所有 catch 但不 rethrow (重新抛出) 的地方**(先用 ast_grep 看命中,再逐个判断):

```js
ast_grep {
  pat: "try { $$$BODY } catch ($E) { $$$ }",
  path: "src"
}
// → 列出候选,父 agent 自己判断 handler 里有没有 throw
```

**找所有 class component**:

```js
ast_grep {
  pat: "class $C extends React.Component",
  path: "src/**/*.tsx"
}
// → 列出所有需要迁到 hooks 的类组件
```

**找所有 dynamic import (动态导入)**:

```js
ast_grep { pat: "import($X)" }   // 不是 import 声明,是动态 import()
```

要**批量改**这些命中?同一个 `pat` 交给 `ast_edit`(第二课),配个 `out` 就行。

### 4.4 与 grep 对比

| | grep | ast_grep |
| --- | ------ | ---------- |
| 匹配对象 | 字符串行 | AST 节点 |
| 区分语法 | ❌ | ✅(不会命中字符串里的 console.log) |
| metavar | ❌ | ✅($X 任意节点,$$$ 多节点) |
| 跨语言 | ✅ | ✅(~55 种语法) |
| 重写 | ❌ | ✅(同样的 pat 给 `ast_edit`) |

---

## 5. 三件武器联动:实测场景

### 场景 1:跨文件改 API

```
1. ast_grep 找 "import { login } from '...'"  → 列出所有调用方
2. lsp rename login → signIn                 → 自动改 barrel/re-export
3. lsp diagnostics                           → 检查改完没类型错
4. /review                                   → 评审改动
```

### 场景 2:调试多线程 bug

```
1. debug launch + set_breakpoint           → 挂上
2. threads + stack_trace                   → 看哪个线程在干嘛
3. evaluate 在不同 frame 跑表达式          → 确认状态
4. edit 改代码 + ast_edit 改锁逻辑         → 用结构化改保证正确性
5. debug continue 验证                     → 跑同一份输入不崩了
```

### 场景 3:消除代码坏味道

```
1. ast_grep 找所有 "console.log($X)"       → 一份清单
2. ast_edit console.log → logger.info      → 预览 → write xd://resolve
3. lsp diagnostics                         → 校验
4. /review                                 → 评审
```

---

## 6. 与 pi 的全景对比

| 维度 | pi | omp |
| ------ | ----- | ----- |
| LSP | ❌ | ✅ 14 actions,带 willRenameFiles |
| 调试 | ❌ | ✅ 28 actions,真挂 lldb/dlv/debugpy |
| 结构化搜索 | ❌ | ✅ ast_grep |
| 批量改 | 手动 grep | ✅ ast_edit + preview |
| 跨文件一致性 | 手动维护 | LSP 自动同步 |

## 小结

| 武器 | 解决什么 | 核心入口 |
| ------ | ---------- | --------- |
| `lsp` | 理解代码、自动改跨文件 | `rename` / `rename_file` + willRenameFiles |
| `debug` | 真调试,不是 print | `launch` / `set_breakpoint` / `evaluate` |
| `ast_grep` | 结构化找模式 | `pat` + metavar(默认关,要开 `astGrep.enabled`) |

和 pi 的对照:**pi 把代码当字符串**,**omp 把代码当 AST**——这才是 IDE-wired 的本质。

## 下一课预告:第五课:Memory 系统

- checkpoint / rewind:会话内"打快照 → 扔回溯",探索不走弯路
- retain / recall / reflect / memory_edit:长期记忆的写入、检索、综合、修正
- learn + manage_skill:把"这次学到的"沉淀成可复用 skill
