# 手机端「发起会话」抽屉与 sheet 基座打磨设计

- 日期:2026-10-03
- 状态:已确认(用户拍板:范围 = 基座 + 新建会话;选控件形态 = 卡片/整行选中态)

## 背景与目标

手机端「新建」入口打开的 SpawnSheet(底部抽屉)视觉粗糙,定位到五处根因:

1. **基座缺把手/动画/关闭钮**:`.sheet`/`.gsheet` 直接闪现,无 iOS 惯例 grabber,无滑入动画;SheetBase 注释声称「各 sheet 自带明确关闭钮」,实际 SpawnSheet/CkptSheet/ConnChip 均没有,只能点遮罩关;
2. **✓ 对勾占位参差**:工作区行前缀 `✓`(16px tick 占位)像老式表单;引擎格与 ConnChip 动作行同样占 tick 位但**永远空着**,左缘参差、双列名字对不齐;
3. **引擎网格密度低**:2 列 × 5 行裸排,无分隔无选中描边,选中态只有一层淡底;
4. **CTA 不贴合**:`.m-btn` max-width 280px 且不居中,在 sheet 里悬靠左侧;文案「在 {ws} 启动 {engine}」偏长(工作区选中态已明示,复读冗余);
5. **底部无安全区**:`.sheet` 底 padding 无 `env(safe-area-inset-bottom)`,全面屏 home 条贴住 CTA。

目标:基座一次升级全端 sheet 受益(把手/动画/关闭钮/安全区),SpawnSheet 内容按现代移动端选中态重排,全部用现有 token 保证暗色零额外适配。

## 方案取舍

| 决策点 | 选定 | 被否决 | 理由 |
|---|---|---|---|
| 范围 | 基座(SheetBase)+ SpawnSheet 内容重排,ConnChip/CkptSheet 一行级联动 | 只改 SpawnSheet | 丑根一半在基座,只改一个则其他弹层仍老样子,关闭钮每个 sheet 重复写与基座注释自相矛盾 |
| 基座头 | `title?: string` prop:始终渲染 grabber;有 title 渲染标题行+关闭钮;gsheet 菜单型只拿 grabber | 每个 sheet 自渲染关闭钮 | 头部结构收敛一处,4 个调用方共享;gsheet 自带 sheet-head 不强制套标题 |
| 动画 | CSS `@keyframes`(卡片 translateY+淡入 .22s,::backdrop 渐显 .2s) | 关闭动画 / 手势下滑关闭 | 关闭动画需延迟卸载状态机、drag-dismiss 需自建手势,均超「打磨不丑」范围(YAGNI);原生 dialog showModal 即挂载,CSS 动画零 JS 成本 |
| 选控件形态 | 工作区单列整行(panel 底+border,选中 accent 描边+淡底+行尾 ✓ svg);引擎双列卡片(选中 1.5px accent 描边+右上 6px 圆点) | 保留「✓+名字」列表微调 | 用户拍板;tick 占位是参差根因,删掉才能对齐;选中态三信号(描边/底色/角标)比单淡底清晰 |
| CTA | 新 `.sheet-cta` 全宽 46px;文案简化「启动 {engine}」(新 i18n 键,en/ja 补词条) | 沿用 .m-btn + 「在 {ws} 启动 {engine}」 | 280px 悬左与 sheet 宽度不贴;工作区已由选中态高亮,按钮复读是冗余 |
| 提示态 | `.sheet-alert` 卡片(warn/err 变体)替代裸 m-err 文本 + inline style | 沿用 m-err | blocked/spawn 失败是 sheet 内一级状态,卡片化与内容区形制一致;顺手清掉两处 inline textAlign |
| 样式落点 | sheet 家族样式整体迁新文件 `mobile-sheet.css`(mobileMain.tsx 加一行动态 import) | 续塞 mobile.css | mobile.css 已 299 行顶 300 铁则;mobile-dark.css 拆分先例在,机制零新增 |
| ConnChip 动作行 | 顺手换 `.sheet-act` 行类,删空 tick span | 保留 sheet-opt | sheet-opt 家族被 SpawnSheet 新形态取代后,ConnChip 是唯一用户,空 tick 同病,一并治 |

## 改动面

- `src/mobile/SheetBase.tsx`:+`title` prop,渲染 grabber/标题行/关闭钮(1.5 stroke 细线 X,28px 圆钮,::after 外扩命中区);
- `src/mobile/SpawnSheet.tsx`:内容重排(整行工作区/双列引擎卡片/全宽 CTA/alert 卡片),删两处 inline style;
- `src/mobile/ConnChip.tsx` / `CkptSheet.tsx`:删 `sheet-h` 换 `title` prop;ConnChip 动作行换 `.sheet-act`;
- `src/mobile/mobile.css`:sheet 家族样式(~36 行)迁出;
- `src/mobile/mobile-sheet.css`(新):迁入样式 + grabber/标题行/关闭钮/动画/安全区/新选控件/CTA/alert;头注声明对齐基准 = 本 spec(手机 sheet 视觉自此以实现为准,不再回溯 mobile-app-*.html 原型);
- `src/mobile/mobileMain.tsx`:动态 import 补一行;
- `src/kernel/locales/{en,ja}/mobile.ts`:新键「启动 {engine}」两条词条。

## 验证

- 门禁五件套:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`,收口前 react-doctor 100;
- 样式桩:SpawnSheet 默认态/选中态/长名截断/blocked/spawn 失败五态;ConnChip/CkptSheet 头部换装后不破版;gsheet(git 动作表)grabber 不挤菜单行;
- 暗色:`prefers-color-scheme: dark` 下全部新样式走 token,抽查描边/淡底/alert 底;
- 真机目检留大仙(浏览器 dev 桥或手机扫码)。
