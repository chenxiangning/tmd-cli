# 03 快捷键系统:kernel 命令注册表 + 插件贡献键位

日期:2026-09-06(设计 spec:docs/superpowers/specs/2026-09-05-shortcuts-design.md;聚焦期放开修订:docs/superpowers/specs/2026-09-06-shortcuts-terminal-focus-design.md)

## 结论

应用内全局快捷键 = kernel 通用原语(`src/kernel/shortcuts.ts`)+ 插件经 `ctx.registerCommand` 贡献键位语义。内核只做注册表、分发器、作用域裁决,不认识任何业务命令;新插件注册命令即自动获得快捷键与设置清单展示,零 kernel 改动。

## 契约速览

```ts
// kernel/shortcuts.ts
interface CommandContribution {
  id: string;              // "<owner>.<action>",如 git.commit
  title: string;           // 设置清单展示(中文)
  keybinding?: string;     // "Cmd+K" / "Cmd+Shift+E" / "Cmd+Alt+B";缺省 = 未绑定仅暴露
  match?: (e) => boolean;  // 自定义匹配(如 ⌘1-9 区间),不参与静态键冲突检查
  keybindingLabel?: string;// 展示标签(如 "⌘1-9")
  when?: () => boolean;    // 不满足/抛错 = 键穿透
  scope?: "global" | "terminal"; // terminal = 终端聚焦期优先分发;global 聚焦期不再静默(09-06)
  run: () => void;
}
```

## 铁律

1. **分发器单点**:AppShell 挂载期 `installShortcutDispatcher()` 安装 window keydown capture;命中 = preventDefault + run,未命中穿透。
2. **终端聚焦期统一分发(09-06 修订,原「终端是黑洞」)**:分发器聚焦时先查 terminal 作用域、再查 global(`resolveCommand`);命中 = capture 相位 `preventDefault + stopPropagation`,事件到不了 xterm,零 PTY 字节;未命中键原样进 PTY(终端自由快捷键/readline 不变)。⌘ 系键位在终端生态本就不进 PTY,终端内 CLI 零感知;全平台放开(非 mac ⌘ 映射 Ctrl,Ctrl+W/K 等被覆盖为已接受取舍);⌘C/⌘V 永不注册。
3. **Escape 永不注册**;IME `isComposing` 全放行;约 20 处弹层 Esc 生态不受影响。
4. **同键共存的条件**:同作用域双方都有 `when` 且语义互斥(先例:⌘S 按激活 tab kind 分家为 files.save / ssh.saveRemoteFile);否则注册即抛错。跨作用域同键允许,聚焦期 terminal 优先(resolveCommand)。
5. **组件局部状态经模块级 ref 桥**接命令(先例:TerminalView `findRequestRef`、ssh `saveRequestRef`、app-shell `shellBarToggles`)。
6. 键位对齐主流:⌘,设置、⌘B 左栏、⌘⌥B 右栏、⌘W 关 tab、⌘T 新建、⌘1-9 切换、⌘⇧E/G/M 右栏面板(VS Code 心智)、⌘⇧H 回首页。
   一期键位之外,二期补:⌘J 切输入区高度段、Ctrl+Tab / Ctrl+⇧Tab 切标签页、⌃⌘F 最大化/还原编辑区、⌘⇧X 插件市场。

## 消费点

- 设置面板「基础设置 → 快捷键」tab:`useCommands()` 只读清单,按 id 前缀分组,`formatKeybinding` 展示;AppSettings 零新字段。
- sidebarActions 经 host 委托处泛化镜像为 `sidebar.<id>` 无键位命令;composer 抽屉 feature 条目镜像为 `composer.drawer.<pluginId>`。
- 壳级命令(shell.* / panel 焦点)在 `src/app-shell/shortcutCommands.ts` 模块级注册——外壳自身功能归外壳,不入 kernel。
- 无键位暴露(改键预留):panel.refresh / panel.newFile / panel.newFolder(作用于激活面板槽,槽缺失穿透)、git.fetch / git.pull / git.push(经 panelStore.requestRemoteDialog,when 限定 git 面板激活)。
- 设置清单 UI 约定:键位用键帽芯片(kbd 描边小块),未绑定弱化字;顶部搜索框匹配标题/id/键位标签;组标题右侧计数;行 title 显示命令 id。
- 双修饰键(如 ⌃⌘F)键位语法表达不了:用 `match` 自定义匹配 + `keybindingLabel` 展示,不参与静态键冲突检查。
