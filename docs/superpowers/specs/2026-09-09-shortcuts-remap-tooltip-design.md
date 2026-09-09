# 快捷键改键录制 + 悬浮提示(键位说明)

日期:2026-09-09
状态:已落地(f6f334a + 9a758f5 review 收尾;实现随 spec 同提交)

## 背景与目标

现有 `docs/architecture/03-shortcuts.md` 落地了「kernel 命令注册表 + 插件贡献键位」的全局快捷键系统,但
仍有两处产品级短板:

1. **设置页的「快捷键」tab 是只读清单**(`useCommands()` 全量命令 + 搜索 + 分组,不可编辑);VS Code /
   codemoss 同类产品提供录制式改键(右栏「点击录制新的快捷键」+ 键位搜索),用户已对该形态有预期。
2. **悬浮提示文案不带键位**:目前 221 处全用原生 `title`,与命令绑定的按钮(顶栏/侧栏/抽屉/tab 关闭等)
   看不到自身快捷键;codemoss 在深色自定义气泡里把文案与键位同列展示(参考图 2「收起左栏」)。

目标:

1. 改键:用户在「快捷键」tab 可为非 match 型命令录制新键位;冲突拒绝(同作用域同键且非双方 when 互斥);
   match 型命令保留展示但录制入口置灰标注「内置」;解绑 / 重置默认 / 全部重置;改动立即生效免重启。
2. 提示:在映射到命令的 ~10 类按钮(顶栏左右栏/市场/首页 + 侧栏设置 + composer 抽屉 + 编辑 tab 关闭)上
   悬浮出深色自定义气泡,文案沿用既有 `aria-label`,键位紧跟其右;非快捷键按钮保留原生 title 不动。
3. 产物:`src/kernel/shortcuts.ts` 增加 effective binding 解析 + 录制闸 + 冲突校验;`src/plugins/settings/
   ShortcutTab.tsx` 改写为 codemoss 双栏;新增 `src/kernel/Tooltip.tsx` 委托式 HintProvider;既有命令注册面
   零改动。

## 方案取舍

**选定:active state `shortcutOverrides` + effective binding 解析 + 单根委托 Tooltip。**

- 改键 = `settings.shortcutOverrides: Record<commandId, keybinding|""`,缺 key 走注册默认,空串 = 显式解绑;
  kernel 一次性 `setShortcutOverrides` 喂入,registration 时已注入 effective,后续 override 改 → 重算
  effective + emit `useCommands` 变更 → 设置清单/分发器/tooltip 即时同步。`parseKeybinding` 解析失败的
  覆写值被 sanitize 丢弃,启动可恢复。
- 冲突 = 录制时校验(走现有注册期同款规则:同作用域同键且非双方 when 互斥 → 拒绝;跨作用域同键允许),
  拒绝时 UI 弹行内错误并保持原绑定;不解绑对方。
- 录制期:分发器 `isShortcutRecording()` 闸门开启,window keydown 透传;ShortCutTab 自己装一个 capture
  keydown handler 收录下一次合法按键(修饰键 + 主键齐),期间 `e.preventDefault + stopImmediatePropagation`
  防误触。Esc = 取消,Backspace/Delete = 解绑。
- 提示 = 委托式:`HintProvider` 在 `main.tsx` 挂载一次,document 监听 `mouseenter/focusin/mouseleave/
  focusout`;目标元素带 `data-hint` 属性即捕获(读 `data-hint-cmd` 命令 id → 查 effective 键位;无 id
  则用 `data-hint-shortcut` 直传预格式化串);portal 渲染单个浮层 + 自动上下翻边 + ~300ms 延迟。完全
  替换该元素的原生 `title` 显示(用 `title=""` 屏蔽)。

**否决 A:Tooltip 仍用原生 `title`,只在 `title` 串里追加 " (⌘B)"。** 零基建,但 OS 原生样式丑 + ~1s
延迟 + 不能渲染键帽芯片,与图 2 观感差距大;且 221 处模式不变意味着连没有快捷键的按钮也加(违反"如果
设置了快捷键才提示"的诉求)。

**否决 B:为每处按钮包 `<Tooltip><button/></Tooltip>` 组件。** DOM 树大改、外观不一致(没快捷键的还
得 fallback);react-resizable-panels 的 Panel 元素若裹一层会破坏布局,改写风险高。

**否决 C:每个 button 自己 `useState(open)` 维护 tooltip。** 25 处全量重复 ~30 行状态逻辑,且 hover 互相
打架(同时开多个)。

**否决 D:改键时把新键位写回 `CommandContribution.keybinding` 字段并重新 register。** 抹掉原始默认值;
非 match 命令的 keybinding 是注册常量语义,运行期改注册表会触发「同 id 重复注册抛错」的护栏,且无法
回滚默认;需保留原值作为「重置默认」的真相源。

**否决 E:match 型命令(⌘1-9 / Ctrl+Tab / ⌃⌘F)允许改键。** 键位语法无法表达区间和双修饰,录成静态单键
会丢失「按 N」区间语义;UI 上以置灰 + 提示「内置」禁用,仍展示 `keybindingLabel`。

**否决 F:录制冲突允许抢占(自动解绑对方)。** VS Code 形态,但意外操作风险高;用户拍板选择「拒绝并
提示」(会话中已确认)。

## 设计

### 数据层(settings)

- `settingsTypes.ts` 新增 `shortcutOverrides: Record<string, string>`,DEFAULT = `{}`;常量
  `SHORTCUT_OVERRIDES_MAX_ENTRIES = 200`、`SHORTCUT_OVERRIDE_KEY_MAX = 100`、`SHORTCUT_OVERRIDE_VALUE_MAX = 60`。
- 新 `src/kernel/settingsSanitizeShortcuts.ts` 域文件(参 settingsSanitizeSessions 先例):
  - key:非空字符串,trim,`id.firstDot` 段不做格式校验(命令 id 由注册表决定),去重保序,限量;
  - value:parseKeybinding 可解析 / 或 `""`(显式解绑);其它丢弃;规范化为「修饰键按 Cmd+Shift+Alt 序拼接」
    的稳定串(消除大小写 / 重复修饰 / 顺序差异)。
- `settingsSanitize.ts` 装配:导入 `sanitizeShortcutOverrides`,`sanitize()` 内字段追加。
- `settings.ts` 增加 `subscribeSettings` 已在原型;`boot/load` + `updateSettings` 之后调
  `setShortcutOverrides(getSettings().shortcutOverrides)`,循环:settings 依赖 shortcuts,shortcuts 不依赖
  settings → 零循环。

### 内核(shortcuts)

`src/kernel/shortcuts.ts` 当前 233 行,新加 effective 解析 + 录制闸 + 校验 + 工具 hook 后体量会超 300 行
铁则;故拆出 `src/kernel/shortcutOverrides.ts`(effective 解析/录制闸/校验纯函数),`shortcuts.ts` 改为
import + dispatcher/install 接线,目标保持 ≤290 行。

`shortcutOverrides.ts` 公共面:

```ts
export type ShortcutOverride = string; // keybinding 串 or "" = 解绑
export function setShortcutOverrides(o: Record<string, ShortcutOverride>): void; // settings boot/change 喂入
export function getEffectiveKeybinding(id: string): string | undefined;
//   undefined = match 型(无静态 keybinding) / 注册 id 不存在 / override 缺失(返回注册时的原始)
export function isShortcutRemappable(id: string): boolean; // !cmd.match && cmd.keybinding 存在
export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: "escape-forbidden" | "missing-modifier" | "syntax" | "conflict"; detail?: string };
export function validateOverride(cmdId: string, value: string): ValidationResult;
export function isShortcutRecording(): boolean; // 分发器闸
export function setShortcutRecording(on: boolean): void;
```

分发器改:`installShortcutDispatcher` 内 onKey 顶部加 `if (isShortcutRecording()) return;`;保持 capture
相位以兼容终端内拦截。`useCommands` 仍返回原 `CommandContribution[]`(注册面不变),`formatKeybinding`
/`parseKeybinding` 不动。新增 `useCommandKeybindingLabel(id): string | null` 工具 hook:返回 effective
展示标签(`""` → "未设置",override keybindingLabel 优先;`Cmd+K` → `⌘K`);`useCommands` 依赖的 snapshot
变更时同步刷新(useSyncExternalStore 同一份 listener)。

`eventMatches` 内的 `cmd.keybinding` 取值替换为 `getEffectiveKeybinding(cmd.id)`,不命中落回 `undefined`
走穿透;`registerCommand` 注册期冲突检查仍用注册面 `cmd.keybinding`(原始默认),不改。

录制期冲突校验:`validateOverride(id, "Cmd+Shift+K")` 内部:解析 → 禁 Escape 规则 → 同作用域遍历其他
命令,套用「同键且非双方 when 互斥」同款规则(去除 cmdId 自身) → 命中冲突则返回 `{ok:false,
reason:"conflict", detail: otherId}`;UI 端把 `detail` 翻成「与 XXX 占用」。

### 录制 UI(ShortcutTab)

`src/plugins/settings/ShortcutTab.tsx` 改写为 codemoss 双栏布局。沿用现有 `useCommands`/`groupCommandsByIdPrefix`
/`filterCommands` 三个导出函数(测试已隐含覆盖,见 settings.test.ts / 既有用例);新增:

- 顶层 `pref-card` 内 `flex gap-4`:左 50% 命令清单(分组 + 搜索 + 每行 `[id/title | 键帽/未设置 | 已改标记]`),
  右 50% 详情(选中命令名 + 大键帽 chips + 描述/command id + 录制区 + 「重置默认」)。
- 录制区:大灰色方框显示「点击录制新的快捷键」+ 提示行「按 Esc 取消 · Backspace 解绑 · ⌘C/⌘V/
  Escape 无效」;点中方框进入录制态(模块级 `setShortcutRecording(true)`),keydown capture handler
  捕获下一次合法键位 → 调 `validateOverride` → 成功:写 settings,失败:行内红色提示并保持录制态
  (按任意键继续录或 Esc 退出)。
- 「重置默认」按钮:仅当 `cmdId` 在 overrides 中显示,点击删 override 项。
- 顶部新增「全部重置」按钮(右上角小号),清空整个 `shortcutOverrides` map。
- match 型命令:左行尾键帽仍展示(灰色 + 「内置」小标),点中后右侧详情显示「此命令为内置键位,不可
  改」,录制区置灰禁用。

按架构铁律 R1/R3/R4:ShortcutTab 只读 `useCommands` + `getSettings/updateSettings`;`setShortcutRecording`
经 kernel 接口调用,无 plugin→plugin 直接依赖。

### Tooltip UI

新 `src/kernel/Tooltip.tsx` 与 `Tooltip.css`(并行 `prefers-reduced-motion`):

- `<HintProvider>` 组件:`useEffect` 注册 document 监听 `mouseover`/`focusin`/`mouseout`/`focusout`/
  `keydown`(Esc 关闭)与 `scroll`/`resize`(重定位);单个 ref 持有浮层 DOM;portal 挂 body。
- 目标识别:`event.target.closest("[data-hint]")`;读取 `data-hint`(label) / `data-hint-cmd`(命令 id)/
  `data-hint-shortcut`(直传展示串) / `data-hint-disabled`(="true" 抑制)。
- 调度:防抖 ~300ms 显示,~120ms 隐藏(mouseleave 立即清定时器但延迟 dom 移除,焦点切走 0 延迟);
  接近视口上下边自动翻向;`requestAnimationFrame` 内读 `getBoundingClientRect` 避免强制 layout。
- 内容:`<div class="hint-bubble"><span class="hint-label">…</span><span class="hint-keys">⌘B</span></div>`,
  keys 段按 `parseKeybinding` 结果拆成 `keycap chip` 数组(对齐 ShortcutTab KeyCap 视觉);无 cmd
  id 也无 shortcut → 退化为单 label 节点。
- `HintProvider` 在 `main.tsx` 顶层挂载,`AppShell` 之上。

callsite 改造(8 处,均只改 `title=` → `data-hint` 组合属性;`aria-label` 保留):

| 文件 | 元素 | 命令 id |
|---|---|---|
| `src/app-shell/TopBar.tsx` | 插件市场按钮 | `shell.openMarket` |
| `src/app-shell/TopBar.tsx` | 回首页按钮 | `shell.goHome` |
| `src/app-shell/TopBar.tsx` | 折叠左栏按钮 | `shell.toggleLeftBar` |
| `src/app-shell/TopBar.tsx` | 折叠右栏按钮 | `shell.toggleRightBar` |
| `src/app-shell/SidebarSettingsCluster.tsx` | 设置齿轮 | `shell.openSettings` |
| `src/app-shell/EditorTabStrip.tsx` | `.tab-close` | `shell.closeTab` |
| `src/plugins/composer/view/ComposerToolbar.tsx` | 命令抽屉按钮 | `composer.toggleDrawer` |

未列入:右栏面板 tab 焦点(命令 `shell.focusPanelN` 与 panel.id 无 1:1 静态映射)、侧栏 pinned 动作
(无键位)、窗口控件(无命令)、其他原生 title(无快捷键的提示保留原生 OS 样式)。二期补右栏面板
动态映射。

### 词典(i18n)

`src/kernel/locales/{zh,en,ja}/common.ts` 与 `settings.ts` 补键(共 ~18 项):

- 录制区:「点击录制新的快捷键」、「按 Esc 取消 · Backspace 解绑」、「已修改」、「内置」、
  「此命令为内置键位,不可改」、「全部重置」、「恢复默认」、「与 {id} 占用,无法使用」、
  「录制中…」、「无修饰键,需 ⌘/Ctrl/Shift/Alt 之一」。
- tooltip:「快捷键 {kb}」(备选,failsoft 文案)。
- ShortcutTab 已有:「未绑定」「搜索命令、键位或 id…」「没有匹配的命令」「外壳与终端」沿用。

en/ja 补同序号,zh 缺则 source = 中文(词典恒等规则)。

### 测试

新增 `src/kernel/shortcutOverrides.test.ts`(沿用 `shortcuts.test.ts` 模板:vi.resetModules + 动态 import):

- `getEffectiveKeybinding`:无 override 走原值;override "Cmd+Shift+K" 替换;override "" 返回 undefined
  (解绑语义);`setShortcutOverrides` 后订阅触发 snapshot 更新。
- `validateOverride`:正常单键 → ok;无修饰键(纯 "K")→ missing-modifier;Escape → escape-forbidden;
  现有 `shell.toggleLeftBar` 已绑 `Cmd+B`,再对 `shell.toggleRightBar` 录 `Cmd+B` → conflict +
  detail="shell.toggleLeftBar";双方有 when(同 ⌘S 分家)→ ok;跨 scope(`terminal.find` ⌘F vs
  `shell.openSettings` ⌘,) → ok(scope 不同放行)。
- `isShortcutRemappable`:有 keybinding 无 match → true;match 型 → false;无 keybinding → false。
- `isShortcutRecording` 闸门:setShortcutRecording(true) → installShortcutDispatcher 装的 onKey 不命中。

新增 `src/kernel/settings.sanitizeShortcuts.test.ts`:沿用 settings.test 模板;覆盖 sanitize 落默认值、
非法 value 丢弃、escape 被拒、超过上限按 key 序截断、value 规范化(大小写/顺序)。

`src/plugins/settings/ShortcutTab.test.tsx`(新增,沿 `BasicAppearanceTab` 桩式惯例 — 需先确认是否
有既有先例;若无则只保单测:groupCommandsByIdPrefix/filterCommands 提到 `ShortcutTab` 文件 → 抽到
`shortcutTab.model.ts` 与 Tab 同目录便于单测)。

不改既有:`shortcuts.test.ts`、`shortcuts.dispatch.test.ts`、`settings.test.ts` 的用例。

### 已知上限

- 仅静态 keybinding 命令可改;match 型(⌘1-9 / Ctrl+Tab / ⌃⌘F)与无 keybinding 暴露(`panel.refresh` 等)
  一律「内置」置灰。
- tooltip 第一批只覆盖 7 类 1:1 静态映射按钮;右栏面板动态焦点键位、侧栏 pinned 动作、窗口控件等不
  显示快捷键(沿用原生 title 或无提示)。
- 录制期整个应用 keydown 闸门开启;若用户切到外部窗口,录制态保留至 60s 后自动超时(timeout 留
  `setShortcutRecording` 外侧包 setTimeout,toast 提示)。
- 跨设备设置同步未做;只在 `~/.tmd-cli/settings.json` 落盘。

## 验证

1. `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`。
2. 浏览器桩目检 `http://127.0.0.1:1421`(Tauri dev 占用时直接复用):
   - 录制:进「基础设置 → 快捷键」,选中 `shell.toggleLeftBar` → 点录制区 → 按 `Cmd+Shift+L` → 行内
     变 `⌘⇧L`、DOM 标记「已修改」;返回首页,悬浮「折叠左栏」按钮 → 气泡显示「收起左栏 ⌘⇧L」。
   - 冲突:再选 `shell.toggleRightBar` 录 `Cmd+Shift+L` → 行内红字「与 shell.toggleLeftBar 占用」,
     录制态保留,Esc 退出后右栏键位未变。
   - 解绑:选 `shell.openSettings` 录 `Backspace` → 行内变「未设置」,清掉 override;返回首页悬浮
     「设置」齿轮 → 气泡只有文案「设置」无键位。
   - 重置:选 `shell.toggleLeftBar` 录过的命令 → 点「重置默认」→ 恢复 `⌘B`;点「全部重置」→ 全部命令
     回到注册默认。
   - match 型:选 `shell.focusSessionN` → 右侧详情「此命令为内置键位,不可改」、录制区置灰。
3. 既有契约:TerminalView 聚焦期 ⌘F 仍命中 `terminal.find` 不进 PTY(shotcuts.dispatch 既有测试,重跑绿)。

## 实现对照(2026-09-09 落地后补记)

**状态:已提交(f6f334a + 9a758f5 review 收尾);待换角度 review。**

与设计的偏差:

1. **单项重置在右侧详情面板**(`shortcut-reset-<id>`),不在左栏行尾 —— 行内已承载「已修改/内置」
   徽章 + 键帽,再塞按钮挤;codemoss 的行尾悬浮重置属锦上添花,detail 重置覆盖面相同。
2. **Tooltip 键位渲染为逐键键帽**(`kbd-chip`,`["⌘","⇧","K"]` 分段),非整串文本;新增
   `shortcuts.ts` 的 `keybindingChips` 与 `shortcutOverrides.ts` 的 `useEffectiveKeybindingChips` 派生。
   match 型(⌘1-9)无法分段,整串单 chip 兜底。
3. **录制校验冲突比对 effective(默认∪override),非仅注册默认** —— 桩目检抓到的真 bug:
   A 命令的 override 键位对 B 不可见导致重复绑定;修复于 `validateOverride` 改用
   `getEffectiveKeybinding(other.id)`,回归测试 `shortcuts.override.test.ts` 两条(override 占用
   冲突 / override 解绑后默认键可占)。
4. **60s 录制超时未配 toast**:超时只静默关闸(`setShortcutRecording` 内部 setTimeout),
   与「已知上限」记录一致,toast 留待后续。
5. CSS 拆为 `src/styles/settings-shortcuts.css`(300 行铁则,global.css 单点 @import)。

桩目检(1421,Tauri 桩,2026-09-09 下午)全过:

- 录制流:选中 `shell.toggleLeftBar` → 录 `Cmd+Shift+K` → 行内 `⌘⇧K` + 「已修改」徽章;录制
  闸门 `is-recording` 类正确进出。
- 冲突:`shell.closeTab` 录 `⌘⇧K` → 红字「与 shell.toggleLeftBar 占用,无法使用」,键位未变。
- 解绑:Backspace → 「未设置」+「已修改」。
- 重置:detail「恢复默认」→ 回到 `⌘B`,徽章消失。
- Tooltip:悬浮左栏按钮 → 气泡「收起左栏 ⌘ B」(逐键键帽);改键后同会话重 hover →
  即时变「⌘ ⇧ K」,免重启生效。

测试:新增 35 条(`shortcuts.override.test.ts` 24 + `settings.sanitizeShortcuts.test.ts` 13,
含 2 条重复);`settings.test.ts` 默认值快照补 `shortcutOverrides: {}`。全链验证绿
(typecheck/test 1228+/arch-boundary/file-size/build;期间 askWatch* 报错属并行会话 WIP,与本特性无关)。
