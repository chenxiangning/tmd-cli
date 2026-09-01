# mossx 对话框（Composer）能力盘点

- 日期：2026-09-01
- 来源：mossx 代码库只读扫描（`src/features/composer` 及发送链路）
- 用途：tmd-cli 富 Composer 的需求基线 + 迁移成本估算
- 状态：已完成

## 一句话结论

mossx 对话框 ≈ **19k 行 TS/TSX + 8k 行 CSS**，其中 **~70% 是依赖引擎结构化事件的"仪表盘装饰"**（token 账本、运行状态、配额、rewind、fusion），tmd-cli 走原始终端路线应**主动砍掉**；真正要复刻的核心 composer 约 **6–8k 行**，且仓库里已有现成的最小化样例 `ComposerLight.tsx`（7KB）可作抽取模板。

## 关键发现：mossx 的发送管线不是 PTY stdin

```
ChatInputBox → Composer.handleSend → useQueuedSend（队列/斜杠路由/融合）
  → useThreadMessaging（提示词组装、上下文注入）
  → Tauri IPC invoke("send_user_message", {text, model, effort, accessMode, images, …})
  → Rust: 构造结构化 JSON [{type:"text"},{type:"image"|"localImage"}]
  → JSON-RPC over stdio → 引擎 app-server 子进程
```

mossx 走**结构化 JSON-RPC 协议**（Codex app-server / Claude stream-json），这解释了它为什么重。**tmd-cli 的输出侧是原始终端透传，输入侧的发送管线必须自己重新设计**——这是本项目的头号技术问题（见文末）。

## 能力清单：v1 复刻 vs 砍掉

### ✅ v1 复刻（纯前端/本地，不依赖引擎事件）

| # | 能力 | mossx 实现位置 | 说明 |
|---|---|---|---|
| 1 | contenteditable 多行编辑器、自动高度、拖拽调整 | `ChatInputBox/ChatInputBox.tsx` (67KB) | 核心 |
| 2 | CJK IME 组合保护 | `hooks/useIMEComposition.ts` | 中文输入刚需 |
| 3 | Mac 光标快捷键、undo/redo | `useKeyboardNavigation.ts` / `useUndoRedoHistory.ts` | |
| 4 | 发送快捷键配置（Enter / Cmd+Enter） | `useSubmitHandler.ts` | |
| 5 | `@` 文件引用（触发检测 + 防抖下拉 + 文件标签） | `useTriggerDetection.ts` / `providers/fileReferenceProvider.ts` | 数据来自本地文件树服务，与引擎无关 |
| 6 | `/` 斜杠命令下拉 | `providers/slashCommandProvider.ts` | v1 只做透传类命令（发给 CLI 自己处理） |
| 7 | 图片粘贴/拖拽/选择 → 附件 | `usePasteAndDrop.ts` / `ComposerAttachments.tsx` | 落盘为本地文件路径注入 |
| 8 | 每会话草稿持久化 | `composerDraftStore.ts` | 模块级 store，无重渲染 |
| 9 | 输入历史召回（↑ 键）+ 内联 ghost 补全 | `useInputHistoryStore.ts` / `useInlineHistoryCompletion.ts` | |
| 10 | 消息队列（排队、编辑、删除）| `useQueuedSend.ts` / `ComposerQueue.tsx` | 简化版：纯 FIFO，CLI 空闲时 drain |
| 11 | 发送/停止按钮状态机外壳 | Composer props 链路 | 停止 = 向 PTY 发 Ctrl+C（ESC） |
| 12 | 发送就绪栏（引擎/模式标签） | `composerSendReadiness.ts` | 数据源改为本地 CLI profile |
| 13 | 提示词组装（@展开、附件注入） | `promptAssembler.ts` | 简化版 |
| 14 | Git 分支徽标 | `ComposerBranchBadge.tsx` | 与 git 插件联动 |

### ❌ v1 砍掉（依赖结构化引擎事件，原始终端拿不到）

| 能力 | 依赖 | 砍因 |
|---|---|---|
| Token/上下文窗口指示器、双视图账本 | `ThreadTokenUsage` 事件 | 无事件源 |
| 运行状态条（subagent 活动） | 引擎流事件 | 无事件源 |
| 队列融合 / steer / 自动 drain 时机 | isProcessing 脉冲 | 无事件源（降级为 FIFO + 状态探测） |
| Stop/interrupt 结构化 RPC | `turn_interrupt` | 降级为 PTY 信号 |
| AskUserQuestion 内联回答 | 引擎事件 | CLI TUI 里自己答 |
| Claude rewind 预览/确认 | checkpoint 数据 | 无 |
| 配额/限流面板 | 账户事件 | 无 |
| /review 结构化流程、上下文压缩状态 | 引擎 RPC | 透传给 CLI 原生命令 |
| 共享会话执行目标选择器 | mossx 插件生态 | 不存在 |
| 引擎侧模型目录 | 引擎 config 查询 | 降级为 profile 静态配置 |
| 语音听写 | 本地模型插件 | 非核心，后置 |

### 🤔 灰色地带（v1 做降级版）

- **模型/模式切换**：mossx 从引擎拉目录；tmd-cli 改为 profile 静态配置 + 通过 CLI 自身的 `/model` 命令注入
- **队列 drain 时机**：mossx 靠 isProcessing 事件；tmd-cli 需要**终端状态探测**（屏幕缓冲启发式判断 CLI 是否在生成中）——技术风险点

## 头号技术问题：Composer → PTY stdin 注入设计

原始终端路线下，发送 = 把组装好的文本写入 PTY stdin。难点：

1. **时机**：CLI TUI 在"生成中 / 审批弹窗 / 空闲"状态下对 stdin 的行为不同。盲目写入会丢字符或误触发。
2. **多行文本**：TUI 输入框里 Enter 是提交还是换行，各 CLI 不同。需要按 CLI 配置换行转义（如 claude 的 `\` 续行 / 粘贴模式 bracketed paste）。
3. **可靠方案候选**：
   - **Bracketed Paste 模式**：现代 TUI（ink/ratatui 系）普遍支持 `\x1b[200~ … \x1b[201~` 包裹粘贴，多行文本作为一次粘贴注入，**不触发逐行提交**，最后补一个 Enter。→ v1 首选
   - **屏幕状态探测**：从 PTY 输出流旁路维护一份屏幕缓冲（xterm.js headless / vt100 解析），检测"输入框空闲"特征后再注入。→ 队列 drain 依赖它
4. **图片**：CLI 不读 stdin 图片，方案 = 图片落盘到会话临时目录，注入文件路径文本（各 CLI 的 @/路径引用语法不同，profile 里配模板）。

## 迁移成本估算

| 部分 | 规模 |
|---|---|
| 核心 composer 复刻（上表 ✅ 14 项） | ~6–8k 行 |
| 发送管线重写（IPC + PTY stdin 注入 + bracketed paste + 状态探测） | ~1–2k 行（新写，无对应物） |
| CSS 精简（mossx ~8k 行 → 估 2–3k 行） | 复用为主 |
| **合计** | **~10k 行级**，对比 mossx composer 全域 ~30k+ 行 |

## 抽取模板

- `src/features/composer/components/ComposerLight.tsx`（7KB）—— 官方最小化子集，tmd-cli 的 composer 从它的 prop 面起步，逐项加能力。
- 权威能力文档：`src/features/composer/components/ChatInputBox/ARCHITECTURE.md`
