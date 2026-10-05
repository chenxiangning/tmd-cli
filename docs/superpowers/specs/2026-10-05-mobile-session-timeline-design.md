# 手机会话时间线 sheet 设计

- 日期:2026-10-05
- 状态:已确认(实施中)
- 范围:仅手机树(`src/mobile/**`),桌面客户端零改动

## 背景与目标

手机 PTY 详情页(SessionScreen)虽已有对话渲染(TurnsView,40 轮尾窗),但两个缺口让「知道这个会话之前聊过什么」没有快路:

1. 打开详情页视口在底部最新处,往上翻要滚过长助手长文;
2. 超 40 轮的会话更早内容直接没有(提示去桌面看)。

桌面审批线面板已有「时间线」页签(TimelinePanel,spec 2026-09-08-session-timeline):本会话用户消息纵向流,点击跳幕布锚点。本设计把同语义带到手机:composer「+」面板新增「时间线」格,点开底部 sheet 列**全程用户消息**(不受 40 轮尾窗限制),点击条目滚动定位到对话流对应轮。

## 方案取舍

| 决策点 | 选定 | 被否决 | 理由 |
|---|---|---|---|
| 入口 | composer「+」面板第五格(与相册/切模型/检查点/快捷键并列) | 顶栏芯片(已挤,误触);live 区常驻横条(永久占竖屏空间) | 「+」面板就是 composer 工具区,大仙拍板「对话框上方」;格位现成零布局改动 |
| 数据源 | cli-shared `parseUserMessages` + `fsReadTailChanged`(2MB 尾窗),parser 按 profileId 分发 | 桥新 RPC 让桌面代跑 `readSessionUserMessages`(新命令面,违反手机树「零新命令面」既有架构);从 turns 提取(受 40 轮尾窗限制,不解决诉求) | 两件都是已导出纯函数,IO 走 `ipc` → transport → WS 桥 → Rust `FS_READ` 白名单(已验证含 `fs_read_tail`),零格式知识复制零桌面改动 |
| 读窗预算 | 2MB 单次(`fsReadTailChanged` 一次 IPC 带 size 可判截断) | 32MB(桌面 messageAnchors 全量口径;外网中继单 invoke 15s 强断,必炸桥) | 2MB 覆盖绝大多数会话全程用户消息;超窗诚实显示「已显示最近 X 条」 |
| 点击行为 | 文本匹配 + `.tr-user` DOM 查找 + `scrollIntoView`,匹配不到 = 置灰可读不可点 | TurnsView 加锚点属性(为单一消费方改共享组件);窗外条目按需加载轮次(新分段读取+插入逻辑,首版复杂度不值) | CSS line-clamp 不裁 DOM 文本,`textContent` 即原文;不匹配降级置灰,安全无错跳 |
| 重复文本 | 跳最后一个匹配(最新位置) | 序号对齐(时间线消息计数与 transcript user turn 计数口径可差:custom_message 行等) | 文本匹配语义自证,计数对齐跨格式脆弱 |

## 设计

### 数据流

```
TimelineSheet 打开
  → resolveTranscriptPath(profileId, cwd, undefined, cliSessionId)   [mobile/sessionFile 复用,按身份精确绑定]
  → ipc.fsReadTailChanged(path, 2MB, null)                            [桥 RPC,白名单放行]
  → parseUserMessages(text, PARSERS[profileId])                       [cli-shared 纯函数]
  → CliUserMessage[] {id, text}                                       [size > 2MB = 截断标记]
```

- PARSERS 分发:`omp`/`pi` → `ompPiUserMessageLine`;`claude`/`cl` → `claudeUserMessageLine`;`codex` → `codexUserMessageLine`;`kimi` → `kimiUserMessageLine`(cli-kimi/kimiSessions 导出)。与 `resolveTranscriptPath` 支持面同构;qoder/grok/opencode/dsh 未进手机 transcript 契约,时间线显示「该引擎暂不支持」(缺失显示 —,不猜测兜底)。
- 刷新节奏:打开拉一次 + 失败重试钮,不轮询(回顾工具非实时,外网省流量)。

### 状态机(与 CkptSheet 三态分离同律)

| 态 | 条件 | 呈现 |
|---|---|---|
| 等待绑定 | cliSessionId 缺失 | 提示(同 cwd 多会话不猜文件) |
| 不支持 | PARSERS 无此 profileId | 「该引擎暂不支持时间线」 |
| 未找到 | resolveTranscriptPath null(jsonl 懒落盘) | 提示 + 重试 |
| 失败 | 读取 reject | 「读取失败」+ 重试 |
| 空 | 解析 0 条 | 「还没有用户消息」 |
| 完成 | ≥1 条 | 列表(+截断注记) |

### UI

- SheetBase(title=「时间线」)+ 列表**最新在顶**(桌面同款):每条 = 序号(1=最旧)+ 原文 3 行 clamp。
- 可达判定:条目 text 与当前 turns(SessionScreen 的 40 轮尾窗)中某 user turn text 全等 = 可点;置灰条目仍可读。
- 点击:关 sheet → `.live` 容器内 `.tr-user` 元素 textContent 全等者 `scrollIntoView({block:"start"})`。

### 文件布局

| 文件 | 改动 |
|---|---|
| `src/mobile/timelineSheet.tsx`(新,~150 行) | TimelineSheet 组件 + PARSERS + loadTimeline + 可达判定纯函数 |
| `src/mobile/plusPanel.tsx`(新) | PlusPanel 自 Composer.tsx 拆出(Composer 298 行撞 300 铁则)+ 第五格「时间线」 |
| `src/mobile/Composer.tsx` | 移出 PlusPanel,props 加 onTimeline 透传 |
| `src/mobile/SessionScreen.tsx` | tlOpen 态 + jump 函数 + sheet 渲染 |
| `src/mobile/mobile.css` | .tl-* 样式(~25 行) |

## 验证

1. `timelineSheet.test.ts`:PARSERS 分发面;可达判定(匹配/重复文本取最新/全不匹配);loadTimeline 截断标记。
2. `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size`。
3. 1421 桩目检:假会话 jsonl 驱动——sheet 打开、列表渲染、窗外置灰、点击跳转滚动、不支持引擎降级。
4. `npx react-doctor@latest -y` 达 100。
