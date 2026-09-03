# 第二课:编辑革命 —— hashline + ast_edit + conflict://

三个能力对应 omp 的 11 / 19 / 18 号电池,核心是把"写文件"从最容易出错的环节里救出来。

## 1. 为什么需要"新的编辑范式"?

pi / Claude Code 时代 agent 编辑文件的痛点:

```
痛点 1:模型重抄多行 → token 浪费 + 拼写错误
痛点 2:old_text 在文件里出现多次 → 改错地方或失败
痛点 3:文件被改过、old_text 已不存在 → 无限重试或悄悄改错
痛点 4:大段替换 → 看不出"改了什么",review 时一头雾水
痛点 5:合并冲突 → agent 不知道哪边是 theirs/ours/base
```

omp 用三层武器分别解决:

| 痛点 | 解决武器 |
|------|----------|
| 1+2+3 | **hashline 快照锚点 + 行补丁语言** |
| 4 | **`ast_edit` 预览 + Accept** (proposed card 待审卡片) |
| 5 | **`conflict://N` URL 协议** |

---

## 2. hashline 编辑(omp 11 号电池)

### 2.1 原理

`read` 一个(本地可写的)文件时,omp 返回一个**快照头 + 行号**:

```
[src/auth.ts#1A2B]
1:# import { User } from './user';
2:export async function login(token: string) {
3:    const user = await verify(token);
4:    return user;
5:}
```

- `#1A2B` 是**这个文件当前内容的 4 位十六进制哈希快照**,不是每行一个哈希
- 模型要改文件,在 `edit` 的 `input` 里写 `[路径#快照]` 分节 + 行操作,配 `+新内容` 行:

```
[src/auth.ts#1A2B]
PUT 3.=3:
+    const user = await verify(token, { strict: true });
```

- 落盘前 omp 校验快照 `1A2B` 对应的文件还是 read 时看到的样子;不一致就尝试按快照链**安全恢复**,恢复不了直接**拒绝 patch**——绝不悄悄覆盖别人(或别的 agent)刚写的改动
- 补丁语言里还有:`CUT N.=M`(删除并暂存到寄存器)、`PUT <N @name` / `PUT >N @name`(把寄存器粘到别处,可跨文件移动代码)、`PUT N*:`(按 tree-sitter 语法块整体替换)、`MV 目标`(改完顺手重命名)、`REM`(删整个文件)
- 关键约束:行号永远指向**原始快照**的行,不是本次调用里前面 hunk 改过之后的行——多次编辑不会错位

### 2.2 实战:agent 视角

```text
[prompt]
请把 login 函数改成支持 strict 模式。
[/prompt]

[agent 调用]
read src/auth.ts
→ 拿到 [src/auth.ts#1A2B] 快照和行号

edit:
[src/auth.ts#1A2B]
PUT 3.=3:
+    const user = await verify(token, { strict: true });
→ 校验快照 1A2B 仍有效,落盘成功,返回新的 [src/auth.ts#9F3C] 头
```

如果有人在 agent 读完后手改了 src/auth.ts,快照哈希就对不上了。能安全恢复(快照链能证明唯一结果)就自动恢复并给 `Warnings:`;否则直接拒绝,要求重新 `read`:

```
Error: stale snapshot, mismatch with current context.
Refused: would have silently overwritten other edits.
```

### 2.3 与 pi 的对比

| | pi / Claude Code 风格 | omp hashline |
|---|-----|------|
| 编辑形式 | 重抄多行 `old_text` | 快照头 + 行号 + `+最终内容` |
| 定位方式 | 字符串匹配,多处命中就失败 | 行号 + 快照,天然唯一 |
| Stale 文件防御 | 无,悄悄覆盖 | **先尝试恢复,不行就拒绝,要求重新 read** |
| Token 消耗 | 大段重抄 | 上游 README 实测:Grok 4 Fast **输出 token −61%** |
| 弱模型友好度 | 格式本身吃模型 | README:Grok Code Fast 1 通过率 **6.7% → 68.3%**,MiniMax **2.1×**,Gemini 3 Flash 比 str_replace **+5pp** |

> 引用数字全部来自上游 README 的 benchmark 表("Tenfold lift the moment the edit format stops eating the model alive")。

### 2.4 提示工程要点

让 agent 用 hashline 编辑时,prompt 里只要:

```markdown
# 编辑规则
- 改文件必须用 `[PATH#TAG]` 分节,`TAG` 从最近一次 read/grep/edit 结果复制
- 内容行是最终内容,只写 `+` 行;不要写 unified diff(`-` 行 / `@@`)
- 如果 read 之后文件被外部改过,必须先 re-read 再 edit
```

---

## 3. ast_edit + Accept Card (待审卡片)(omp 19 号电池)

### 3.1 它和 hashline 的关系

hashline 解决"精确编辑",**`ast_edit` 解决"模式化批量改"**:

> "把整个项目里所有 `console.log($X)` 都换成 `logger.info($X)`,排除 test 目录"

这种改用 hashline 要逐个文件、逐个锚点;用 ast_edit,**一个 ast-grep pattern (匹配模式)**,一次搞定。

### 3.2 完整工作流

**Step 1**:agent 写结构化改写请求,`ops` 数组里每项是 `{ pat, out }`:

```js
ast_edit {
  ops: [{ pat: "console.log($X)", out: "logger.info($X)" }],
  paths: ["src/**/*.ts"]
}
```

 metavariable (元变量) 规则:`$X` 是单个节点,`$$$BODY` 是零或多节点;同一个变量出现两次必须匹配相同代码。空 `out` 表示删除匹配节点。

**Step 2**:omp **不立刻落盘**。直接结果是**预览**(`applied: false`),TUI 渲染成 *proposed card (待审卡片)*:

```
┌─────────────────────────────────────────────────┐
│ ✓ AST Edit: console.log($X) → logger.info($X)  │
│                                                │
│ 3 replacements · 1 file (proposed)              │
│  src/logger.ts:14  console.log("starting")      │
│                 → logger.info("starting")       │
│  src/auth.ts:8     console.log("done")          │
│                 → logger.info("done")           │
└─────────────────────────────────────────────────┘
```

**Step 3**:agent 用 `write` 往虚拟设备写**一句话理由**来定夺:

```text
write xd://resolve   "accepting console-to-logger migration"   # 应用
write xd://reject    "pattern too broad, will narrow first"    # 丢弃
```

**Step 4**:TUI 把 proposed card 翻成 **Accept 卡片**,改动**原子落盘**——要么全部应用,要么一行不动。过期预览(期间文件又变了)会报错而不是静默成功。

### 3.3 关键属性

| 属性 | 含义 |
|------|------|
| **两段式** | 先预览,`xd://resolve` / `xd://reject` 定夺;没有"直接应用"参数 |
| **原子性 (atomic)** | Accept 时要么全部落盘,要么一行没动 |
| **可审** | 落盘前能逐处看 diff (差异) |
| **AST 正确** | pattern 是结构化匹配,不会把字符串里的 `console.log("x")` 误改 |
| **跨语言** | tree-sitter (语法解析器) 语法,README 口径 50+(文档口径 ~55 种) |
| **有上限** | 默认最多扫 1000 个文件(`PI_MAX_AST_FILES`) |

### 3.4 ast_grep(只查不改)

如果只想"找模式、不改",用 `ast_grep`。注意:**默认关闭**,要 `astGrep.enabled: true` 才注册:

```js
ast_grep {
  pat: "try { $$$BODY } catch ($E) { $$$ }",
  path: "src"
}
```

- 参数就三个:`pat`(单个 pattern)、`path`(分号分隔的文件/目录/glob)、`skip`(跳过前 N 个命中)
- 结果默认最多 50 个匹配
- 想改?把同一个 `pat` 交给 `ast_edit` 的 `ops[0].pat`,配一个 `out`——搜索和改写共用一套语法

### 3.5 与 pi 的对比

| | pi /其它 CLI | omp |
|---|------|------|
| 改法 | 给一段字符串替换 | 给 AST pattern + 重写规则 |
| 范围 | 一次一文件 | `paths` 批量 |
| 预览 | 没有 | **proposed card 待审卡片**,可审可拒 |
| 精度 | 文本匹配,易误伤 | AST 匹配,只改模式命中处 |
| 多文件一致性 | 手工 | 自动 |

---

## 4. conflict:// —— 冲突变 URL(omp 18 号电池)

### 4.1 背景

merge 时 git 在文件里写:

```ts
<<<<<<< HEAD
const x = a + b;
=======
const x = a * b;
>>>>>>> feature
```

人类解决:看 diff、决定留哪边、改完删标记。
agent 解决:经常瞎选,或者选了但不告诉你选了哪边。

### 4.2 omp 的方案:把冲突变成一个 URL

`read` 碰到含冲突标记的文件时,omp 注册冲突并给出入口:

```text
✓ Read src/session.ts (⚠ 1 conflict)
 Conflict #1 at lines 12-14
 conflict://1    →  解决这一个冲突
 conflict://*    →  一次性解决所有冲突
```

agent 或人类只要 **`write` 一行**到对应 URL:

```ts
write conflict://1  "@theirs"   // 留 feature 分支版本
write conflict://1  "@ours"     // 留 HEAD 版本
write conflict://1  "@base"     // 用 merge 前公共祖先版本
write conflict://1  "@both"     // 两侧都要:先 ours 后 theirs(只用于"两边各加了不同东西"的冲突)
```

或者写一段新内容(自定义方案):

```ts
write conflict://1  "const x = (a + b) * 2;"  // 自定义
```

omp **删掉所有 `<<<<<<<` / `=======` / `>>>>>>>` 标记**,只替换标记块本身,前后行原样保留。批量两种姿势:

```ts
write conflict://*  "@theirs"                    // 全部选 theirs
write conflict://*  "1: @ours\n2: @theirs\n3: @base"  // 按 id 各选各的
```

### 4.3 agent 视角的真实工作流

```
git status              →  列出冲突文件
read src/session.ts     →  omp 注册冲突,拿到 conflict:// id
write conflict://1 "@theirs"  →  解决冲突 1
read src/session.ts     →  校验
git add src/session.ts  →  完成
```

### 4.4 与 pi / 其它工具对比

| | 普通 agent | omp |
|---|------|------|
| 怎么告诉 agent 选哪边 | prompt 里写 "选 theirs" | 写 `conflict://1 @theirs` |
| 批量 | N 个文件 N 句 prompt | `conflict://*` 一句 |
| 意图表达 | 改文件内容,看不出意图 | `@ours/@theirs/@base/@both`,意图即内容 |

---

## 5. 把这三件事合起来看

```
+----------------------------+
| 改一个文件                 |
+----------------------------+
       │
       ├── 单点精确改 ──→ hashline ([PATH#TAG] + PUT/CUT)
       │
       ├── 模式化批量改 ─→ ast_edit (proposed → xd://resolve)
       │
       └── 合并冲突 ───→ conflict:// URL
+----------------------------+
| 不确定?                    |
+----------------------------+
       │
       └── 先 ast_grep 查询,再决定 edit 还是 ast_edit
```

这就是 omp README 里 "Edit, AST Edit, Conflict" 三件套。

## 小结

| 武器 | 一句话 | 解决什么 |
|------|--------|----------|
| `hashline` | `[PATH#TAG]` 快照锚 + 行补丁 | 重抄、拼错、stale 文件 |
| `ast_edit` | `ops[{pat,out}]` + 预览接受 | 批量、跨文件、可审 |
| `conflict://` | URL 协议选 theirs/ours/base/both | 合并冲突、批量 |

和 pi 的对照:**pi 还是 string-based replace**,omp 已经把"写文件"从 LLM 最弱的环节(精确字符串处理)拿了出来。

## 下一课预告:第三课:智能协作

- `task` 工具怎么 batch fan-out (批量扇出派发),产物是 schema-validated (按 schema 校验过的) JSON
- Advisor 模型怎么"安静地"在每 turn 旁听、注 note (注记)、硬 block
- `/review` 评审怎么输出 P0-P3 + verdict
- **和 pi subagent 的关键差异**:omp 的子代理有"独立的会话 + 类型化产出 + hub 消息通道",pi 的更像 prompt delegation (提示词委托)
