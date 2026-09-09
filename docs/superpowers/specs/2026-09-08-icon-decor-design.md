# 图标装饰设置:7 个界面图标的独立颜色与呼吸闪烁

日期:2026-09-08
状态:已确认(用户批准:自由取色 + 恢复默认;只换点亮色;范围 7 个——`eye` 随查看眼图标同日撤销,见下)

## 背景与目标

一批界面图标的配色目前写死在 CSS(激活橙 `rgb(255,140,60)` 散落多处)或直接吃主题 token,用户无法按喜好调整,也没有统一的"呼吸闪烁"开关(新建会话火箭今日已手加一条写死呼吸)。

范围 = 用户指定的 7 个图标,每个图标两项设置(颜色 / 闪烁)互相独立:

| 键 | 图标 | 渲染点 | 现配色 |
|---|---|---|---|
| `newchat` | 新建会话火箭 | `.workspace-action-btn.is-newchat svg` | 主题色(呼吸已写死 5s) |
| `ssh-panel` | SSH 行 | 侧栏设置菜单行 + 底栏钉住钮(sidebarActions 注册表) | active 橙写死 |
| `system-proxy` | 网络代理行 | 同上 | active 橙写死 |
| `panel-files` | 文件面板 | `.panel-tab.is-active` + overflow 菜单(filePanel id `files`) | active 橙写死 |
| `panel-git` | Git 面板 | 同上(id `git`) | 同上 |
| `panel-checkpoints` | 审批线面板 | 同上(id `checkpoints`) | 同上 |
| `panel-memory` | Memory 面板 | 同上(id `memory`) | 同上 |

目标:

1. 设置 → 基础设置 → 外观 tab 新增可折叠卡「图标装饰」:每行图标预览 + 名称 + 自由取色器(`<input type="color">`)+ 恢复默认 + 闪烁开关;
2. 自定义色即时生效、落盘持久;两态图标(面板 4 键 + `ssh-panel`/`system-proxy`)只替换点亮色,idle 保持主题灰;无两态(`newchat`)恒色;
3. 闪烁 = 5s 超慢呼吸(opacity 1 → 0.35 → 1),每图标独立开关;`newchat` 出厂默认开(转正今日手加效果),其余默认关;`prefers-reduced-motion` 下全部关停。

## 方案取舍

**选定:通用设置 map + kernel 应用器 + CSS 变量约定。** `AppSettings.iconDecor: Record<键, { color?: string; blink?: boolean }>`,kernel 只懂"map → 往 `<html>` 写 `--icon-decor-<键>` 变量与 `data-icon-blink` 属性",不认识任何图标语义;各图标样式改吃 `var(--icon-decor-<键>, 原色)`;设置卡持静态 7 项清单(id/名称/预览组件)。新增可装饰图标 = CSS 一行 + 清单一行。

理由:机制全在 kernel(跨插件契约:清洗 + CSS 变量命名 + 呼吸 keyframes),图标清单是纯 UI 知识留在 settings 插件,不触碰"单插件语义不入 kernel"红线;改动面小(不新增任何注册样板)。

**否决:装饰注册表驱动**(各插件 activate 注册装饰元数据,设置卡渲染注册表)。拔插件可让设置项消失,更"纯";但 5 个插件全要动 + 注册样板,这批全是常驻核心图标,拔除场景不存在,YAGNI。

**否决:各渲染点内联读 settings**。同一图标有多处渲染点(面板 tab + overflow 菜单等),逐点订阅 + 内联 style 最散,live 切换最难维护。

## 数据与清洗

- `settingsTypes.ts`:`iconDecor: Record<IconDecorId, { color?: string; blink?: boolean }>`(`IconDecorId` = 上表 7 键联合);默认 `{ newchat: { blink: true } }`。
- `settingsAppearance.ts`:`sanitizeIconDecor(raw)`——键白名单、color 必须 `/^#[0-9a-f]{6}$/i` 否则丢弃、blink 仅收 boolean、空 item 剔除、整体非对象回落默认。装配进 `settingsSanitize.ts` 的 `sanitize()`。
- 迁移说明:8 键收 7 键(f2cbf1a)后,旧用户 settings.json 残留的 `iconDecor.eye` 由 sanitize 键白名单静默丢弃,无害、无需迁移逻辑。
- 删除 `workspace-sidebar.css` 写死的 `ws-action-breathe` 规则,`newchat` 呼吸统一走新机制(默认值承接)。

## 应用层与样式消费

- 新 `kernel/iconDecor.ts`:`bootIconDecor()`(同 `uiFontSize.ts` 模式,幂等)——订阅 settings:设了色的键 `setProperty('--icon-decor-<键>', color)`,未设则 `removeProperty`;blink 开的键拼成 `<html data-icon-blink="键1 键2">`;`main.tsx` boot 一行。
- 新 `src/styles/icon-decor.css` 集中消费规则:
  - `eye`/`newchat`:恒 `color: var(--icon-decor-<键>, <现值>)`;
  - 两态 6 键:仅 `is-active` 分支吃 `var(--icon-decor-<键>, rgb(255,140,60))`,替换 `right-panel-toolbar.css` / `settings-cluster.css` 里的写死橙;idle 分支不动;
  - 闪烁:`html[data-icon-blink~="<键>"] <选择器> { animation: icon-decor-breathe 5s ease-in-out infinite; }`(8 条,共享一份 keyframes),附 `prefers-reduced-motion` 关停(覆盖今日 rocket 规则的先例)。
- 壳补两个通用 DOM 钩子(透传注册表 id,零插件语义):`SidebarSettingsCluster` 菜单行/钉住钮加 `data-action-id`;`RightPanelToolbar` 面板 tab 与 overflow 项加 `data-panel-id`。

## 设置 UI(settings 插件)

- 新 `IconDecorCard.tsx` 挂 `BasicAppearanceTab` 尾部(`SystemAppearanceCard` 之后):卡头可折叠(CaretRight/Down + `aria-expanded`,先例同文件 preset 分组,默认展开);每行 = 图标预览(真实 phosphor 组件吃当前自定义色)+ 名称 + `<input type="color">`(空值时以默认色占位)+ 恢复默认钮(`ArrowCounterClockwise`,清该项)+ 闪烁开关(segmented 开/关,同页先例)。
- 全部写 `updateSettings` 即时生效;文案进 `src/kernel/locales/{en,ja}/settings.ts`(locales.test 自动钉键位)。

## 验证

- 单测:settings sanitize 契约(iconDecor 白名单/色格式/默认 newchat blink,模式同 `settings.fields.test.ts`);`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`。
- 桩目检(1421 + Tauri IPC 桩):7 行渲染与折叠;改色 → 四类图标即时变色;闪烁开关 → 呼吸出现/消失;恢复默认 → 回写死橙/主题色;两态图标 idle 态不受影响。
