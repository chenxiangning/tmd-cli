# 第二课 · 用户视角 · 编辑革命(hashline / ast_edit / conflict://)

> 配套主课:[02-editing-revolution.md](./../02-editing-revolution.md)
> 这一课解决一个问题:**让 agent 改代码不再贴大段 diff**。
> 用户视角:三个新东西——hashline (按内容哈希锚点)、ast_edit (按语法树改)、conflict:// (冲突变 URL)。

---

## 场景 1 — 用 hashline 改一行

**目的**:让 agent 知道"改第几行",不用再贴整段 context (上下文代码块)。

```
你:打开 src/auth.ts,看一下 login 函数。

agent:
│ #1 g8k2  import { User } from './user';                │
│ #2 p9z1  export async function login(token: string) {  │
│ #3 7qr4    const user = await verify(token);            │
│ #4 m3f8    return user;                                 │
│ #6 d2n5  }                                              │

你:改 #3 → 加上 strict: true 校验:

   const user = await verify(token, { strict: true });

agent:edit src/auth.ts {
  "#3 7qr4": "    const user = await verify(token, { strict: true });"
}

你:再打开文件看一眼,确认改好了。
```

**期望**:

- agent 只贴修改后的那一行,不贴整个函数;
- 文件里 `#3` 那一行的内容真的变成了 strict 版本;
- 头部的 `7qr4` 是这行的内容哈希(短哈希码,行内任意字符变了它就跟着变),用来防止"对不上行"的歧义。

**踩坑提醒**:`#3` 是"行号",`7qr4` 是"这行的哈希校验码",两者必须同时给;只给 `#3` 在大文件里偶尔会撞行。

---

## 场景 2 — 用 ast_edit 做结构性改写

**目的**:跨文件、统一把所有 `try-catch` 改成"先 `logger.error` 再 throw"。

```
你:把所有 try-catch 块改成:catch 里先 logger.error(e) 再 throw e。
   给我 Accept Card (待审卡片) 看完整 diff,我自己决定 apply (应用)。

agent:ast_edit {
  pattern: "try { $$$BODY } catch ($E) { $$$HANDLER }",
  rewrite: "try { $$$BODY } catch ($E) { logger.error($E); throw $E; $$$HANDLER }",
  acceptCard: true       # 让我看 diff 再点 Apply
}

agent:打开 Accept Card,看到 12 处 try-catch 都改了,点 Apply。

agent:12 个文件已改,跑测试验证一下。
```

**期望**:

- agent 不需要把 12 处都"列 diff",它只改 AST (抽象语法树) 的节点;
- Accept Card 一次性给你看清楚,Apply 才真写盘;
- 走的是结构性匹配,不会误伤 `try-finally` / `try-with-resources`。

**踩坑提醒**:加 `acceptCard: true` 是省你一会儿再 diff 一次;不加的话 agent 直接改。

---

## 场景 3 — 只读不改:ast_grep 找坏味道

**目的**:先扫一遍"哪些文件有空 catch 块",再决定改不改。

```
你:扫一下 src/**/*.ts,找出所有 catch 里啥都没做的空块,列文件 + 行号。

agent:ast_grep {
  pattern: "catch ($E) { $$$ }",
  constraints: { handlerIsEmpty: true },
  scope: "src/**/*.ts"
}

agent:7 个文件 12 处空 catch,要不要我改成 log + rethrow?

你:先不要,我自己看一眼再说。
```

**期望**:

- agent 只列出来,不主动改;
- 你有了"清单",自己决定哪些真要修;
- 跟 grep 比,ast_grep 知道"这块是 catch 不是 if"——拿不到这种语义 grep 拿不到。

---

## 场景 4 — git rebase 撞墙 → conflict://

**目的**:rebase 出现冲突,agent 不再贴 `<<<<<<<`,而是给你一个 URL(链接)。

```
你:(在另一窗口跑) git rebase main,撞冲突。

agent:我探测到冲突,给你一个 conflict:// URL,浏览器/编辑器开就能改:

agent:打开 conflict://conflict/abc123/src/api/middleware.ts#L42-L68 看完整三路合并视图,选 "ours" 或 "theirs" 或手动改。

你:打开链接,选 ours,提交。

agent:rebase 继续。
```

**期望**:

- 冲突不留在 stdout 而是变成一个 URL,可以在浏览器或编辑器里逐字看;
- agent 不擅自用 `git checkout --ours` / `--theirs`——把决定权交给你;
- 改完即继续 rebase。

**踩坑提醒**:这是 omp 03 号电池(`conflict://`);pi 没这能力,默认会让你"贴合并后的代码"——很容易踩把别人改动盖掉的坑。

---

## 场景 5 — 三个工具的选择口诀

**目的**:什么时候用哪个——一张表搞定。

| 你想干的事 | 用 | 例子 |
| ----------- | ----- | ------ |
| 改一两行,行号已知 | hashline (#行+hash) | "把 #3 改成 strict" |
| 改多文件、跨模式、改 AST | ast_edit | "全 catch 加 logger" |
| 只读不改 / 跨文件检索 | ast_grep | "找所有空 catch" |
| rebase 冲突 | conflict:// URL | "打开 conflict:// 改完即继续" |

**口诀**:

- **hashline 是"改一行"的最小动作**;
- **ast_edit 是"按语法树改"的结构性动作**;
- **conflict:// 是"冲突变成 URL"的桥**。

---

## 场景 6 — Accept Card 的"什么时候开"

**目的**:Accept Card(待审卡片)不是每次都要开,知道何时省事、何时小心。

| 动作类型 | 是否开 Accept Card | 原因 |
| ---------- | -------------------- | ------ |
| 改单行 typo | 关 | 一行改坏一眼能看 |
| 改多文件同类改写 | 开 | 看不全容易漏 |
| 改 public API 签名 | 开 | 调用方可能全得改 |
| rebase / merge 冲突 | 默认开(conflict://) | 必须看三路合并 |
| 删文件 / `rm -rf` | 开 | 不可逆 |

```
你:以后改多文件、删文件、改 API 签名时默认开 Accept Card,
   单行改动和明确是 typo 不开。
```

---

## ✅ 这一课你该会的事

1. 改一行,只说"改 #N <hash> → 新内容",别再贴整函数。
2. 跨文件结构性改写,用 `ast_edit { pattern, rewrite, acceptCard: true }`。
3. 只检索不改,用 `ast_grep { pattern }`。
4. rebase 撞冲突,agent 给 `conflict://` URL,不开编辑器也能选 ours/theirs。
5. 知道什么时候开 Accept Card,什么时候不用开。

---

## 🎯 下一课 →

[03-smart-collaboration.md](./03-smart-collaboration.md):`task` 工具起 3 个子代理、并配置 advisor (顾问模型) 旁听、`/review` 让评审模型出 verdict (裁决意见)。
