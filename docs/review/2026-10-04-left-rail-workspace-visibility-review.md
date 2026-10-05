# 左缘工具 rail / 工作区显隐 / 缩放键位 变更多角度评审

- 日期:2026-10-04
- 状态:已完成(评审发现项已全部处置;变更本体未提交,待用户目检收口)
- 范围:本次 UI 微调(左缘 LeftRail、底栏工作区显隐多选、⌘+/⌘−/⌘0 缩放键位、看板/市场/回首页/网络代理入口迁移)的实现打磨轮。
- 方法:四个独立视角并行只读审查(交互 UX / 架构契约 / 回归风险 / 代码正确性),另加实现方自查轮;全部结论以最终代码快照复核。

## 结论先行

四视角共报 **1 项 P0、5 项 P1、约 20 项 P2**;除 3 项 P2 明示不改(见下)外全部修复并回归验证。集中暴露的缺陷模式是**「迁移后旧反馈通道失效」**:入口搬家后,宿主重渲订阅、鼠标关闭途径、点亮态驱动、钉住槽位清理四类既有机制被无意识丢弃——镜像 UI 时镜像的是形态,还必须逐一清点入口原址承担的隐性义务。

## 修复清单(按严重度)

| 级别 | 问题 | 处置 |
|---|---|---|
| P0 | 看板覆盖层盖住左 rail 唯一开关钮,纯鼠标无法关闭(原 titlebar 钮在覆盖层外可见) | BoardTab 工具条补 × 关闭钮(closeBoardOverlay);Esc 两段式不变 |
| P1 | LeftRail 无重渲源:看板点亮态(boardOverlayStore 私有 store)与代理点亮态(settings)均不刷新,违反 sidebarActions「active 响应性随宿主」契约 | 注册面扩 `subscribeActive?: (cb) => () => void`(插件桥接私有 store,壳统一订阅);session-board 供 subscribeBoardOverlay;LeftRail 补 useSettingsState() + 订阅 bump(useMemo 钉引用防空转) |
| P1 | zoom 键 `meta||ctrl` 全平台匹配,mac 劫持 Ctrl±/Ctrl+0(0x1F / readline C-_,终端生态) | cmdPressed 按 getPlatformKind 严格分流(mac 仅 meta / win 仅 ctrl / unknown 双任一),alt 一律排除;测试锁死 |
| P1 | 齿轮菜单与工作区显隐菜单可同开叠压(触发钮在簇 rootRef 内不触发点外关闭) | picker 开合态提升到簇(SidebarSettingsCluster)受控,双向互斥 |
| P1 | 迁移残留钉住 id(system-proxy 等)永占 PINNED_MAX 槽且无 UI 可清 | 簇内一次性清理:钉住清单中「已注册且 rail/leftRail」的 id 清出;未注册 id(插件拔出)保留待恢复,语义不变 |
| P1 | market/home 钮静息色被 icon-decor 17 键颜色表级联顶掉(attr 挂 button,currentColor 回落语义失效,同栏双色) | 壳条目 data-action-id 从 button 挪回 svg(TopBar 先例),回落语义恢复 |
| P2 | rail 工作区入口缺右键行菜单 / aria 措辞失真 / leftRail「同纪律」注释名不副实 / 装饰白名单注释虚键 / 死选择器(titlebar.css、settings-cluster.css、icon-decor.css 旧位)/ zoom match 取舍无说明 / 测试注释论据错 / picker 定位薄弱(菜单限宽+label 省略+resize 收菜单)/ 订阅粒度 / 「参考图3」残留 / rail+leftRail 双声明仅注释无校验 | 全部修复:右键行菜单接入、注释如实化、死规则清理并迁 .left-rail-tab(blink 双处同步)、zoom 头注写明家族一致取舍、测试注释改准、注册面 fail fast(双声明抛错,补契约测试) |

## 明示不改(记录理由)

- **工作区切换菜单对隐藏工作区无视觉标识**(回归 P2-5):切换菜单与 ⌘T 本就用全量表,「可切入左栏不可见的工作区」是「不强绑定」设计的自然推论;下一轮若加降透明标识,应与显隐菜单的 is-dim 同源。
- **picker 菜单 fixed 一次性坐标**:已改为 resize 直接收菜单(与本仓 portal 菜单家族一致),不做实时重定位。
- **AZERTY ⌘⇧0 不可达**:与 ⌘1-9(focusSessionN 同款 !shift)既有口径一致,先例有意为之。

## 契约沉淀

- `SidebarAction` 扩三字段:`leftRail`(注册即常显,无钉住,与 rail 互斥 fail fast)、`leftRailBottom`、`subscribeActive`(私有 store 驱动的 active 重渲通知;设置驱动类继续由宿主订阅 settings 覆盖)。
- 「迁移入口」检查单(后续入口搬家复用):点亮态驱动源、鼠标关闭途径、原址快捷键链路、钉住/外显持久化清理、装饰键(blink/取色)选择器随迁。

## 二轮打磨评审(2026-10-04 同日,网络代理迁右 rail + 列表图标)

- 范围:网络代理入口自左 rail 底簇迁右缘 PanelRail 底簇(rail+railBottom+pinOnce)、底栏显隐菜单与切换下拉行补文件夹图标、随迁的装饰/闪烁选择器与文档锁步。
- 方法:双视角并行只读(代码正确性 / 回归与架构契约),结论以修复后代码快照复核。

| 级别 | 问题 | 处置 |
|---|---|---|
| P0 | ensurePanelPinned 走 togglePinned 全量覆写:插件串行激活,迁移首启写盘的是当前已注册子集,下次启动未注册面板/rail 动作的钉住全丢 | 改「persisted ∪ {id}」合并写;新装无清单时只入 state 不落盘(防提前造权威清单反向灭默认钉);filePanel.test 补截断回归锁 |
| P1 | 无清单路径手动取消钉后复活一次(marker 写入晚于 persisted 早退) | marker 一查一写提到最前,「取消后不复活」两路径同守;测试锁 |
| P1 | updateCheck 失败文案指「设置菜单『网络代理』」(rail 动作永不进齿轮菜单,死指引) | 三语源串改指右缘工具条底簇 |
| P1 | pinOnce/marker 语义零测试 | filePanel.test.ts 补 4 用例(合并写不截断/取消不复活/新装不落盘/缺省不补钉) |
| P2 | PanelRail 不消费 subscribeActive(左右 rail 契约不对称,未来私有 store 动作迁来失刷) | PanelRail 补 LeftRail 同款 memo+订阅(现零成本) |
| P2 | intent-canvas 残留 defaultPinned(rail 后惰性)、ProxyPopover 头注旧入口、簇注释「迁左 rail」方向反、titlebar.css 死 session-board 规则、icon-decor.css 头注消费清单漂移 | 全部修复 |

验证:typecheck ✓;vitest 460 文件 / 3604 用例全绿(+4);check:arch-boundary / file-size / i18n-keys ✓;build ✓;react-doctor 100/100;1421 桩目检:右 rail 底簇代理钮、浮层左弹、开关点亮、两工作区列表行图标与隐藏行降透明逐项过。

### 用户真窗目检修复(同日三单)

| 问题 | 处置 |
|---|---|
| 显隐/切换菜单行 worktree 工作区图标对不上侧栏(文件夹 ≠ fork) | useWorktreeCluster 导出 peekWorktreeMeta(同步只读缓存,绝不 spawn);两菜单行共用 WorkspaceMenuIcon —— worktree 卡渲染 DecorIcon worktree(GitFork,同侧栏 is-worktree-icon 装饰色),跨层消费声明见其头注。二修(真窗复检):首版带 60s TTL 门,侧栏图标吃 hook React state 过期后照常 fork、菜单却回落文件夹同屏相左 —— 去门改读「最后已知簇身份」,与侧栏显示口径一致 |
| 右 rail ⋯ 菜单行数超视口,底部整段被剪 | PanelOverflowMenu 加 maxHeight=视口余量 + 菜单内滚动,锚定与估高夹取不动 |
| 市场/看板覆盖层盖住左 rail 后缺顺手关闭位 | 两页头左端各加 ×(市场 pm-close-lead / 看板工具条首钮),右端原关闭钮保留 |

## 验证

typecheck ✓;vitest 460 文件 / 3600 用例全绿(新增 rail 互斥契约测试);check:arch-boundary ✓;check:file-size ✓(BoardTab 压回 297 行);check:i18n-keys 缺键 0;build ✓;react-doctor 100/100(picker 回调改 effect-event ref 桥后);`pnpm tauri:dev` 真窗运行中(HMR 全程无渲染健康告警),四钮静息配色一致性待用户目检确认。
