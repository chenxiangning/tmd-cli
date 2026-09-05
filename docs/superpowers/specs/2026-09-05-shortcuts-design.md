# 应用内全局快捷键系统(kernel 命令注册表 + 插件贡献键位)

日期:2026-09-05
状态:已批准(应用内全局、一期固定键位;终端内按键行为不变,键位对齐 VS Code/macOS 主流)

## 背景与目标

客户端当前没有统一快捷键系统。现有键位散落四处、各自监听:⌘/Ctrl+K(命令抽屉,Composer.tsx document keydown)、⌘/Ctrl+S(本地文件 useFileDocument.ts 与远端文件 RemoteFileTab.tsx 两处 window capture)、⌘/Ctrl+F(终端搜索,xterm attachCustomKeyEventHandler)、⌘/Ctrl+Enter(git 提交 DiffView.tsx + composer 可选发送)。应用级导航键(新建/切换会话、关闭 tab、切面板、开设置等)全部空白,无注册表、无分发器、无快捷键设置结构(AppSettings 仅 sendShortcut 一个枚举)。

目标:

1. kernel 建立命令注册表 + 统一分发器(通用原语),键位语义由插件注册;
2. 一期固定键位覆盖:壳层导航、右栏面板切换与动作、收编既有散键;
3. sidebarActions 与命令抽屉条目全量暴露为命令条目(默认无键位,数据面为改键 UI 预留);
4. 设置面板新增「快捷键」只读清单 section。

非目标(一期):用户改键、系统级全局键(Tauri globalShortcut)、Esc 语义改造、原生菜单 accelerator。

## 方案取舍

**选定:kernel 原语 + 插件贡献(方案 C)。** kernel 只放三样通用物:`registerCommand` 注册面、统一分发器(window keydown capture 单点)、作用域裁决;每条命令的 id/title/keybinding/when/run 由拥有该功能的插件注册。理由:符合"内核准入 = 宿主机制与跨插件契约"铁律,新插件自动获得快捷键能力、kernel 零映射表;与 sidebarActions/filePanel/settingsRegistry 的注册表范式同构。

**否决:全内核固定键表(方案 A)。** 键表出现"开 Git 面板"即插件语义入 kernel,违反铁律;新插件接键位要改 kernel。

**否决:纯插件自扫(方案 B)。** 终端拦截必须走 kernel/TerminalView 的 xterm `attachCustomKeyEventHandler`,R1 禁止 kernel import 插件,桥接不可行;插件激活时序在 host.activateAll 之后,核心导航键会闪断。

## 架构

### kernel/shortcuts.ts(新,通用原语)

```ts
export interface CommandContribution {
  id: string;            // 如 "git.commit"、"shell.toggleLeftBar"
  title: string;         // 设置清单展示(中文)
  keybinding?: string;   // 一期固定;缺省 = 未绑定,仅暴露
  when?: CommandContextPredicate; // 上下文不满足 = 不吃键(穿透)
  run: () => void;
}
```

- 注册表:模块级 state + useSyncExternalStore,同 id 重复注册抛错(同 settingsRegistry 范式);**同键同作用域重复绑定在 dev 下抛错**(固定键位期不需要用户态冲突 UI)。
- `PluginContext.registerCommand(cmd)`:插件贡献唯一入口;`deactivate` 时按插件 id 反注销。

### 终端桥(kernel/TerminalView.tsx 改造)

**终端内的自由快捷键一律不变**:用户在终端里敲的键继续原样进 PTY,一期不新增任何终端拦截;唯一保留现状的特例是既有 ⌘F(打开终端搜索框)。实现上把 ⌘F 的硬编码改为查 kernel 注册表,但一期注册表里终端作用域只有 terminal.find 一条——行为与今天完全一致,仅为二期留出统一通路。

### 一期新增键位(壳层导航 + 面板)

| 键 | 命令 | 备注 |
|---|---|---|
| ⌘T | workspace.newSessionMenu | 打开新建会话菜单 |
| ⌘W | shell.closeTab | 关闭当前中央 tab(无 tab 则穿透) |
| ⌘1-9 | shell.focusSessionN | 按会话列表序切换;超出穿透 |
| ⌘, | shell.openSettings | 打开设置面板 |
| ⌘B | shell.toggleLeftBar | 折叠/展开左栏 |
| ⌘⌥B | shell.toggleRightBar | 折叠/展开右栏 |
| ⌘⇧E | panel.focusByOrder 1 | 右栏文件面板(对齐 VS Code ⌘⇧E Explorer 心智) |
| ⌘⇧G | panel.focusByOrder 2 | 右栏 Git 面板(对齐 VS Code ⌘⇧G Source Control 心智) |
| ⌘⇧M | panel.focusByOrder 3 | 右栏 Memory 面板;面板按注册表 order 切换,不写死插件 id |
| ⌘⇧H | shell.goHome | 回首页(welcome) |

键位对齐说明:⌘, 设置(macOS 惯例)、⌘B 左栏(VS Code)、⌘⌥B 右栏(VS Code Secondary Side Bar)、⌘W 关 tab、⌘T 新建、⌘1-9 切换,均为主流编辑器/终端惯例。

### 收编既有散键(行为不变,来源统一)

| 命令 id | 键 | 来源改造 |
|---|---|---|
| composer.toggleDrawer | ⌘K | Composer.tsx 迁移 |
| files.save | ⌘S(when: 激活 tab 为本地文件) | useFileDocument.ts 删监听 |
| ssh.saveRemoteFile | ⌘S(when: 激活 tab 为远端文件) | RemoteFileTab.tsx 删监听 |
| terminal.find | ⌘F | TerminalView 走注册表 |
| git.commit | ⌘Enter(when: 提交框聚焦,保留现 onKeyDown) | 仅登记,不改监听点 |
| composer.send | ⌘Enter(受 settings.sendShortcut) | 仅登记语义,行为不动 |


### 插件动作全量暴露(无键位)

sidebarActions(git graph、网络代理等)与命令抽屉 feature 分区条目(开右栏面板/设置)映射为 CommandContribution(keybinding 缺省)。设置清单以"未绑定"呈现;为二期改键提供完整数据面。映射层属消费侧适配,分别落在 sidebarActions 消费点与 composer 抽屉数据源旁,不入 kernel 语义。

### 设置 UI(settings 插件)

`registerSettingsSection` 增「快捷键」tab(或 basic 下新 tab,实现期按导航密度定):只读渲染注册表全量(title + 键位/未绑定),按插件分组。AppSettings 一期不加字段。

## 错误处理

- 重复 id / dev 下键冲突:注册即抛错(fail fast,固定键位期足够)。
- when 上下文异常:谓词包 try/catch,异常按不满足处理(键穿透,不吞键)。
- 命令 run 抛错:不阻断分发器,console.error;命令自身的事务语义归插件。

## 改动面

- 新增:`kernel/shortcuts.ts`(注册表 + 分发器 + 终端查询桥)、settings 快捷键 tab。
- 契约:`kernel/plugin.ts` PluginContext +registerCommand。
- 改造:AppShell(安装分发器)、TerminalView(⌘F 硬编码 → 注册表)、Composer/useFileDocument/RemoteFileTab(迁移到 registerCommand)。
- 各插件:新增键位命令约 10 条注册行 + sidebarActions/drawer 两条映射适配。
- Rust:零改动。

## 验证

- 单测:shortcuts 注册表(重复 id 抛错/键冲突 dev 抛错/反注销)、分发器(命中拦截/未命中穿透/isComposing 放行/when 异常穿透)、终端桥匹配逻辑。
- `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`。
- `pnpm tauri:dev` 目检:终端聚焦/非聚焦、IME 组词中、弹层打开时各键位行为;⌘S 在本地/远端 tab 各自生效;⌘1-9 越界穿透。
