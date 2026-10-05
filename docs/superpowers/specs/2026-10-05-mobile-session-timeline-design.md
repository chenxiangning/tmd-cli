# 手机会话时间线 sheet 设计

- 日期:2026-10-05
- 状态:已落地(实施注记:数据层拆 timelineData.ts 守 react-doctor only-export-components;PlusPanel 拆 plusPanel.tsx 守 Composer 300 铁则;桩目检过——假 WS 桥全链驱动,列表/跳转/重复文本取最新实证)
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

## 二轮修订(2026-10-05 晚,真机反馈「要能点击跳转 + 显示全部」)

用户否决首版两处保守:尾窗外置灰(不可跳)与 512KB 窗截断注记。二轮对齐桌面客户端
语义(messageAnchors 首拍全量 + jumpToAnchor「不在 buffer 逐页加载」):

- **显示全部**:新 Rust 通用原语 `fs_read_range(path, start, maxBytes)`(行对齐 +
  consumed 回传,fs_tail.rs;桥 FS_READ 白名单 + dispatch + ipc.fsReadRange 全链)。
  手机自尾向头分段(384KB/段,封包 ≈1MB 稳过壳 4MiB)渐进拉全程,条目按文件序合入;
  64 段(24MB)护栏对齐桌面 32MB 口径,超出注记。每条记行字节 offset(TextEncoder 真字节,
  汉字≠字符)。
- **任意跳转**:统一历史定位视图(不再区分窗内/窗外)——点击条目 → 关 sheet →
  `timelineHistory.tsx` 加载 [offset-64KB, offset+768KB) 快照解析 turns,顶条
  「正在查看历史位置/回到最新」,锚行 clipText 同口径文本匹配滚动。互斥单视图
  替代尾窗,零拼接零去重;offset 精确绑定使重复文本各自定位(旧「跳最新」限制消解)。
  对应桌面 jumpToAnchor 的「翻页加载更早历史再试」在手机 = offset 精确分段读。
- **被否决**:尾窗 turns 窗口化 + 无限上滑加载(改动面 useLiveTurns/sessionFile 连锁,
  且「定位某一轮」体验不如快照视图直接);桌面代提取用户消息的新桥命令(CLI 格式
  知识不得入 kernel/Rust,违铁律)。
- 边界:段尾残行(Rust consumed 截行)/ 段首残行(JSON 失败跳行)/ 单行 >384KB 巨型
  消息(快进,不入表)/ UTF-8 多字节 offset / 文件收缩越界(空段)/ 断网中途保留
  partial 可重试 / cliSessionId 换绑自动重拉。
- 验证:6 例协议测试(mini Rust 互证:行对齐/consumed 链/offset 字节/渐进单调/护栏/
  reject)+ Rust 5 断言单测 + 桩目检全链(全量列表/任意条目点击/histView 渲染锚定/
  回到最新)。
