# 手机会话屏紧凑化 + 键盘工具条做实 — 设计

> 日期:2026-09-23 · 状态:待评审
> 上游:`docs/superpowers/specs/2026-09-21-mobile-app-design.md`、`openspec/changes/2026-09-22-mobile-app-m2-light-interaction/`(M2 轻交互闭环);契约 `docs/architecture/12-web-remote-access.md`

## 1. 问题

真机截图实证(2026-09-23):手机会话屏在 ~700px 视口里,固定 chrome 吃掉约 150px:

| 区 | 现状高度 | 问题 |
|---|---|---|
| host-bar(主机条) | ~40px | 与 nav 两条堆叠,信息密度低 |
| nav(返回/标题/横屏/运行中) | 44px | 正常 |
| 审批线 ckpt 行 | ~36px | 常驻整行,只放两个计数 chip,多数时候「待审 0」 |
| composer 提示行(tools) | ~20px | 「回车发送 · Shift+回车换行」「图片/拖拽手机端不可用」常驻占行 |
| 键盘工具条(toolbar-row) | 38px | 全部置灰不可用,还挂着「v1.5 预留」灰字 |

同时:**手机端无法切换模型** —— 用户用手机 omp CLI 起会话后,切模型只能碰桌面。
底部按键条是现成的键位入口,但从未做实。

## 2. 决策

| 决策 | 选定 | 否决与理由 |
|---|---|---|
| 切模型路线 | **键盘工具条做实**:按键经 `session_write` 发原始 PTY 键序列,切模型走 CLI 自带 `/model` TUI | 原生模型选择器需要 config 写 RPC 进 AppDevice 白名单(违反 M2「config 只读」安全边界),且十家 CLI 切模型机制不一(omp 写 agent.db / pi 写 json / claude 走 env),成本不对称。用户已拍板。 |
| 审批线形态 | nav 计数芯片 + 点开出只读批次 sheet(`checkpoint_list` + `checkpoint_batch_diff`,均已在白名单) | 常驻整行删;审批写操作仍不做(白名单写令关闭,与 M2 提案一致)。 |
| host-bar 去向 | 并入 nav 成单顶栏;点主机芯片弹底部 sheet(端点/钉选/重试/重新配对) | 保留两条堆叠 = 白吃 40px。 |
| composer 提示行 | 删除(placeholder 已含回车语义) | 常驻说明文字是桌面习惯,窄屏寸土寸金。 |
| transcript 长文 | 助手消息 >8 行折叠 + 「展开全文」 | 实况块已有折叠先例(`LiveBlock`),对话流同构补齐。 |

## 3. 设计

### 3.1 单顶栏(nav 吸收 host-bar)

```
[‹] [OMP] 标题… [横屏] [●审批 2] [●chenxiangning…▾]
```

- 返回 ‹ / 引擎字形 / 标题:不变。
- 横屏按钮:不变(壳内 `screen.orient`,浏览器 CSS 兜底)。
- **审批芯片**(新,替 ckpt 行):`pending > 0` 时琥珀底「审批 N」,否则灰底「审批」;该会话从无批次(`ckpt === null`)时不渲染。点击 → §3.3 sheet。
- **主机芯片**(新,替 host-bar):绿/红连接点 + `creds.hostName` 截断;点击 → 底部 sheet:
  - 当前端点(`currentEndpoint`,去 scheme)与全部候选(`endpointCandidates`),点行 = 钉选(`saveChannelPin`)+ `forceRemoteReconnect`;「自动」项 = 清钉选。
  - 重试连接、重新配对(扫码)——现有 ⇄ 菜单两项原样迁入。
- nav 现挂的「● 运行中」是硬编码静态文案(恒显,非真状态),随合并删除;真实状态由连接点 + ask 芯片表达。
- 主机芯片文本 `max-width: 34%` 截断(标题区保留 ellipsis 弹性)。
- 断连 banner 保留在顶栏下方(强告警不折叠),文案不变。
- `HostBar` 组件从 `MobileApp.tsx` 移除;home 屏顶部同样收进一条 nav 式细栏(home 无返回键,布局 `[●host▾] [tmd-cli] [+新建]`,搜索框下移列表区)。

### 3.2 键盘工具条做实(`KeyToolbar`)

按键 → `writeSession(sessionId, seq)`,与 ask 卡允许/拒绝同一通道(已实证可用):

| 键 | 序列 | 用途 |
|---|---|---|
| esc | `\x1b` | 关 TUI/取消 |
| tab | `\t` | 补全/切列 |
| ⌃c | `\x03` | 中断 |
| ← | `\x1b[D` | TUI 左移(provider 列) |
| → | `\x1b[C` | TUI 右移(model 列) |
| ↑ | `\x1b[A` | 上移 |
| ↓ | `\x1b[B` | 下移 |
| ↵ | `\r` | TUI 内直接确认(不经 composer) |
| Pg↑ | `\x1b[5~` | 翻页长输出 |
| Pg↓ | `\x1b[6~` | 翻页长输出 |

- 横向可滚(`overflow-x:auto`,单行不 wrap),去掉「v1.5 预留」灰字与置灰样式。
- **软键盘避让**:composer textarea 聚焦时整行隐藏(失焦恢复)——键盘弹起时按键条本来就被顶到键盘后面,隐藏省空间;`focus`/`blur` 驱动,无 resize 监听。
- 切模型流程(omp 实证):composer 输入 `/model` 发送 → TUI 打开 → ←→ 切 provider 列、↑↓ 选 model、↵ 确认、esc 退出。UI 不做任何模型状态镜像(零新 RPC,十家 CLI 通吃)。
- 按键即时视觉反馈(`:active` 底色),不弹 toast。

### 3.3 审批线只读 sheet(`CkptSheet`)

- 打开时拉一次 `checkpoint_list`(与现有 60s 轮询共用状态;sheet 内下拉不重拉,关闭再开即新数据)。
- 行 = 批次:`#index · state 徽标 · prompt 首行截断 · N 文件 · relTime(ts)`;open 批(在途轮)排最前标「进行中」。
- 点行 → 展开该批 `checkpoint_batch_diff` 结果:文件行 `path (+a/−d)`;diff 正文不渲染(窄屏不可读,只给统计)。
- 空态:「本会话暂无审批批次」;失败态:「读取失败」+ 重试按钮。
- 无任何写操作入口(通过/回退在桌面做)——与 AppDevice 白名单(只读二令)严格同形。

### 3.4 composer 瘦身

- 删 `.tools` 提示行(「回车发送…」占位文案已在 placeholder)。
- textarea `rows=1` 自增高(现 max-height 96px 保留)。
- 发送逻辑不变。

### 3.5 transcript 折叠

`TurnsView` 助手消息:文本 >8 行(按 `\n` 计)默认 clamp 8 行 + 尾行「展开全文 ▾」;点击展开,再点收起。用户消息与工具行不变。

## 4. 空间账(竖屏 iPhone ~700px 可视)

| 项 | 前 | 后 |
|---|---|---|
| 顶栏 | host-bar 40 + nav 44 = 84 | 单栏 44(−40) |
| 审批线行 | 36 | 0(入芯片)(−36) |
| composer 提示行 | 20 | 0(−20) |
| 键盘工具条 | 38(不可用) | 38(可用;键盘弹起时 0) |
| **合计固定区** | ~178 | ~82(软键盘弹起时 ~44) |

内容区净增 ~96px ≈ 10 行终端输出;打字态再 +38px。

## 5. 落点

| 文件 | 改动 |
|---|---|
| `src/mobile/SessionScreen.tsx` | 顶栏合并渲染、ckpt 芯片、KeyToolbar/CkptSheet 挂载、composer 提示行删除(拆组件防 file-size 闸) |
| `src/mobile/KeyToolbar.tsx`(新) | 键表 + 聚焦隐藏 |
| `src/mobile/CkptSheet.tsx`(新) | 只读批次清单 + diff 统计 |
| `src/mobile/MobileApp.tsx` | `HostBar` 退役,`HostChip` + 端点 sheet 迁入 nav 共用件 |
| `src/mobile/HomeScreen.tsx` | 顶部同构单栏 |
| `src/mobile/TurnsView.tsx` | 助手长文折叠 |
| `src/mobile/mobile.css` | 单栏/芯片/sheet/可滚键条样式 |

桌面零改动;`conn.rs` 白名单零扩面;Rust 零改动。

## 6. 边界与错误

- 键序列只在 `session_write` 白名单内(已放行),断连时按键静默失败(`invokeSafe` 现语义),不排队不重发。
- 审批芯片计数来自现有 60s 轮询;sheet 打开不额外加频。
- 主机 sheet 的「重新配对」沿用 `onRePair`,清凭证路径不变。
- 横屏态下键条与 sheet 照常可用(宽度更大,键条不滚)。

## 7. 验证

- 闸:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`。
- 单测:`KeyToolbar` 键表 → 序列映射纯函数断言;`CkptSheet` 批次分类(open/pending/approved)纯函数断言。
- 桩目检(1421 dev server + 壳桩,浅色基准):单顶栏渲染、审批芯片计数/点开 sheet、键条点击 → 断言 `session_write` 参数为对应序列、textarea 聚焦键条隐藏、transcript 折叠展开。
- 真机:装机走 `scripts/build-device.sh --install`(壳二进制与 dist 同包铁律);omp 会话内完成一次 `/model` 切模型全流程。
