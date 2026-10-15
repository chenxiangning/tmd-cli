# 25 图标装饰全量纳管:80 键白名单 + 容器级家族键

日期:2026-10-15(前史:docs/superpowers/specs/2026-09-08-icon-decor-design.md 七键起步;2026-09-29 扩 17 键;2026-10-09 扩 11 键;本篇 = 全量纳管收口)

## 结论

图标装饰(settings.iconDecor)从 48 个逐点键扩为 **80 键 = 48 逐点键 + 32 家族键**,客户端全部界面图标可被「图标装饰」设置纳管(独立颜色 + 呼吸闪烁)。逐点键管单个挂点,家族键管一个界面域(容器根打标,整域生效)。

## 契约速览

```ts
// kernel/settingsIconDecor.ts(2026-10-15 自 settingsAppearance.ts 拆出的域文件)
export const ICON_DECOR_POINT_IDS  = [...48 逐点键] as const;  // = 字形组合装饰位
export const ICON_DECOR_FAMILY_IDS = [...32 家族键] as const;  // 只管颜色/闪烁
export const ICON_DECOR_IDS = [...POINT, ...FAMILY] as const;  // 白名单 = 清洗 + 设置卡清单覆盖面
export type IconSetGlyphId = (typeof ICON_DECOR_POINT_IDS)[number]; // iconSet 组合表(METAPHOR/LUCIDE)只认这段
```

两类键的消费方式不同:

| | 逐点键(48) | 家族键(32) |
|---|---|---|
| 挂点 | 挂点元素/svg 上 `data-action-id`/`data-panel-id`/home 样式表类钩子 | **容器根** `data-icon-decor="<键>"` |
| 消费 | `styles/icon-decor.css`(旧 17 键在各自 home 样式表原地) | `styles/icon-decor-families.css` |
| CSS | `[data-action-id=x] { color: var(--icon-decor-x, fallback) }`(0,1,0) | `:where([data-icon-decor="x"]) svg { color: var(--icon-decor-x, currentColor) }`(**0,0,1 零特异性**) |
| 覆盖语义 | 装饰色即点亮色 | 装饰色是**兜底色**:任何语义类/工具类(≥0,1,0)恒胜;缺省 currentColor = 继承,像素零变化 |

## 铁律

1. **白名单加键三处同步**:kernel/settingsIconDecor.ts(POINT 或 FAMILY 段)+ plugins/settings/iconDecorItems.tsx 清单行(编译期穷尽钉 `_itemsCoverAllKeys` 把关)+ en/ja 词典(locales/{en,ja}/iconDecor.ts;译法与既有键撞车时对齐插件面现值,locales.test 撞车扫描把关)+ 消费 CSS(icon-decor.css 或 families.css)。
2. **家族键不是字形装饰位**:iconSet 组合表(solid/metaphor/lucide)只认 POINT 段;家族键进组合表 = 类型错。
3. **家族打标选最小容器集**:一个 portal 根/面板根一标;标在容器根而非逐图标(phosphor/内联 svg 全吃)。菜单触发钮随其 `menu` 键(WorkspaceSwitcher/VisibilityPicker 先例)。
4. **语义色保防**:容器内「颜色从祖先继承」的 danger/success/warn 图标槽,在该图标元素上加 `data-icon-keep`,families.css 头部规则恢复继承色;颜色类名直接写在 svg 自身的**不需要**(类特异性已胜)。portaled 菜单/对话框不嵌套面板根,家族规则天然只命中一份。
5. **同特异性嵌套次序**:families.css 中 `settings` → `cli-config`、表尾 `dialog` 的次序是有意的——个别自绘 modal(ssh HostModal/ImportModal、wsl WorkspaceDialog、WebWanRiskDialog)内嵌在 settings 面板子树,后到的近域必须胜出;新增「内嵌浮层家族」照此置尾。
6. **引擎设置域独立文件**:iconDecor 域在 kernel/settingsIconDecor.ts(300 行铁则),由 kernel/settings barrel `export *` 对外面。

## 排除项(有意不纳管)

- **mobile 树**(src/mobile/**,约 22 挂点):手机树无 Tauri ipc、localStorage 与桌面不共通,decor 设置物理上到不了该树,纳管即死代码;后续若做设置同步再议。
- **既有独立语义体系**:fileVisual 文件类型色、engineGlyphs 引擎品牌字形、Spinner、commit graph 泳道、wb-donut 等数据图表、fileVisual 状态点、appLogo/iconSet(各自有独立设置)。
- 逐点键已纳管挂点不叠家族标(data-action-id 0,1,0 恒胜,叠加无意义)。

## 验证

- check:gate 全链绿(4002 测试含 iconDecor 契约/settingsIconDecor 80 键钉/locales 撞车扫描);react-doctor 100。
- 1421 桩目检:家族色落真实容器(.ws-sidebar 10 svg 中 4 吃家族色、6 自有类色保留)、`data-icon-keep` 胜家族色、抹变量回落 currentColor 像素零变化、设置卡 9 组 80 行(含 弹出与浮层/页面与插件/连接与终端 三新组)。
