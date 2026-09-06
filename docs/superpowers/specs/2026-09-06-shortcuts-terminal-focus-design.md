# 快捷键终端聚焦期放开设计(global 不再静默)

日期:2026-09-06
状态:已定稿(当日落地)

## 背景与目标

现状(`docs/architecture/03-shortcuts.md` 铁律 2):终端聚焦期间 global 分发器完全静默,全部 ⌘ 系导航键(⌘K 唤醒命令抽屉、⌘B/⌘W/⌘T/⌘1-9…)在幕布内失效,必须先点出终端才能用。目标:终端聚焦期 global 键位照常触发并拦截,未命中键原样进 PTY。

## 方案取舍

**选定:分发器单点统一分发 —— 终端聚焦时 terminal 作用域优先、global 兜底;xterm 桥删除。**

安全依据:

1. 全部键位 ⌘ 系(`parseKeybinding` 拒裸键、拒 Ctrl 前缀),mac 终端生态里 ⌘ 组合从不进 PTY,终端内 CLI 对这些键零感知;
2. 分发器在 window capture 相位拦截,命中即 `preventDefault + stopPropagation`,事件到不了 xterm,零 PTY 字节;
3. 未命中键原样穿透,Ctrl+C / readline / vim 键位结构性不受影响,「终端自由快捷键不变」保持。

被否决方案:

- **保留 xterm 桥管 terminal 作用域**:分发器 capture 相位先于 xterm 的事件处理,桥必然沦为死代码,双路径徒增心智,删。
- **mac-only 平台闸**:用户拍板全平台一致放开;代价是非 mac 上 `Cmd` 映射 `ctrlKey`,Ctrl+W(删词)/Ctrl+K(删行)/Ctrl+B/T/J 等 readline 键被应用键位覆盖,属已接受取舍。配套纪律:⌘C/⌘V 永不注册(终端复制粘贴生态)。

顺手修复(同族微调):**Ctrl+Tab / Ctrl+⇧Tab 死键位**。原 `"Cmd+Tab"` 键位串在 mac 上只匹配 metaKey,⌘Tab 被 OS 截走,Ctrl 变体从不参与匹配,两条二期键位从未生效过;改 `match` 型 `(meta||ctrl)+Tab`。Tab 非 PTY 可写键(readline 里 Tab 的形态是 Ctrl+I),无终端劫持风险。

## 改动面

- `src/kernel/shortcuts.ts`:dispatcher 去整体静默;新增纯函数 `resolveCommand`(聚焦:terminal 先、global 后;非聚焦:仅 global);头注释作用域模型改写,纪律段补 ⌘C/⌘V 禁令。
- `src/kernel/TerminalView.tsx`:删 `attachCustomKeyEventHandler` 桥与 `matchTerminalCommand` import;保留 focusin/focusout 聚焦态馈入。
- `src/app-shell/shortcutCommands.ts`:tab.next / tab.prev 改 match 型。
- `src/kernel/shortcuts.test.ts`:补 `resolveCommand` 契约(作用域优先级 / 未命中穿透 / 聚焦态恢复)。
- `docs/architecture/03-shortcuts.md`:铁律 2 重写,消费点同步。

## 验证

- `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`。
- 目检(1421 端口 HMR 复用常驻 tauri:dev):终端聚焦 ⌘K 唤醒抽屉、⌘B 折左栏、⌘1-9 切会话、⌘F 仍为终端搜索、终端内字母/Ctrl+C 输入不受影响、Ctrl+Tab 切标签生效。
