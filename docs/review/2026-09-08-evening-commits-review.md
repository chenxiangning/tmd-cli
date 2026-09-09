# 2026-09-08 早晚场提交代码审核

- 日期:2026-09-08
- 状态:已完成(报告;H1/P1-1/P1-2/P1-3/P1-4 已修复并桩目检通过,P1-5 为流程记录)
- 范围:今日 40 笔提交中未被《午后 15 笔审核》覆盖的 **19 笔**(`9e19b1c..7e4472a` 底部 15 笔 + `fa24fa3..f2cbf1a` 顶部 4 笔;51edd4e 为审核文档自身不计)
- 方法:4 个主题 reviewer 并行深审(外观 i18n/字号 / workspace·composer·files / cli 插件·release / 资产库),主会话亲核全部「高/P1」级发现并证伪 1 条误报

## 结论

**1 高(codex 市场图标回退)/ 5 P1 / 15 P2**。功能实现整体准确,无数据损坏面;架构铁律(R1/R3/R4、300 行、activate(ctx) 注册面、PTY 幕布硬约束、cli-shared 准入)全批零违规。巨型机械迁移(9e19b1c i18n ~975 键、42ed114 px→rem)抽查零错误,en/ja 键数逐域相等。

## 高级发现(主会话亲核属实)

### H1 codex 插件市场图标回退为黑色 "CX" 文字(c0b90b9)

- 位置:`src/plugins/cli-codex/index.tsx:236-241`
- 类别:逻辑/视觉回归 + 规范不一致
- 问题:c0b90b9 唯独对 codex 删除 `icon: CodexGlyph` 并把 `iconColor` 改硬编码 `"#000"`,与其余 7 个引擎插件(均保留 `icon: XxxGlyph` 且 iconColor 与烘焙值一致)完全不一致。后果:
  1. 插件市场列表/横条(`PluginMarketList.tsx:27-34`、`PluginMarketStrip.tsx:100-101`)因 `meta.icon` 缺失走 abbr 分支,codex 显示 "CX" 文字而非六边形 glyph;
  2. 容器 `color: #000` 深色主题下近不可见;
  3. 同提交更新的 `docs/superpowers/specs/2026-09-03-plugin-market-icons-design.md:48-55` 明文「CLI 侧该字段与字形烘焙值保持一致」,烘焙值是 `var(--tmd-fg)`,此处直接违反;且同文件 glyph 注释自述「全对比度随主题(浅黑/深白)」与 `#000` 矛盾。
- 修法:恢复 `icon: CodexGlyph`,`iconColor` 改回 `var(--tmd-fg)`。

## P1(建议尽快)

1. **`serialize.ts:24-31` 触发符词内误弹**(fa24fa3):commit message 自述「前置字符必为非词字符守卫」未实现,`foo!!bar` 词内也会弹候选(与旧单字符语义一致但违背自述)。加 `lastIdx>0 && /\w/.test(before[lastIdx-1]) continue`,或订正自述。
2. **资产库 en/ja 词典零增量**(fa24fa3):新增约 50 个 t() 键只有中文,en/ja 用户看中文 UI(i18n.ts:25-27 缺键回落中文)。补 `src/kernel/locales/{en,ja}` 对应条目。
3. **reveal rAF 轮询无卸载清理**(2f540a1):`revealSession.ts:57-73` 轮询无 cancel 句柄,插件卸载/HMR 后空转满 600ms 上限。泄漏有界可接受,但宜返回 cancel 由 useEffect cleanup 调用。
4. **`requestSessionReveal` handler 缺席期只保留最后一次**(196adf2):`kernel/sessionReveal.ts:8-29` `pending` 单槽覆盖,侧栏未挂载窗口内连点两次定位只补发最后一次。改 FIFO 队列或收紧事件契约。
5. **commit message 与验证不符**(fa24fa3 链):fa24fa3 自述 typecheck 通过,实因共享工作区 `plugin.ts` 未入 stage 导致 HEAD 类型断裂(7e38156 补);另有「Suggestion List 新增后渲染事件」一句无对应实现。后续自述以实跑为准。

## P2 汇总(15 条)

### 外观/字号(3)

- `settingsAppearance.ts` 缺文件尾换行(42ed114 引入)。
- memory 域 5 处 `toLocaleDateString("zh-CN")` 硬编码 locale 未随语言切换(9e19b1c spec 已标已知边界,但与同提交 relativeTime 走 Intl 的口径不一致)。
- `i18n.test.ts:46-53` 只测不存在键回落;可加高频键 en/ja 存在性硬断言(键位完整性现由 locales.test.ts 钉住,功能正确)。

### workspace/composer/files(4)

- 归档视图下点击定位对「无行场景」静默放弃(revealSession.ts:35-53),用户无感知;宜 toast 或自动切回默认视图。
- markdown 链接分流对 protocol-relative(`//cdn.x`)与大写 scheme(`HTTPS://`)静默丢(useMarkdownComponents.tsx:88-91)。
- SessionTabBar tab ≥3 时 pin/locate/remove 三按钮拥挤,设计取舍留产品决策。
- `SessionTabBar.tsx:11` 注释引用已不存在的 spec 路径(死链)。(另存量 bug `host.getCliSessionId(...) !== null` 恒 true,196adf2 之前的代码,不在本批。)

### cli 插件/release(3)

- `cli-kimi/index.tsx:121-123` `iconColor: "#1783FF"` 与已烘焙 `fill="var(--tmd-fg)"` 的 KimiGlyph 冲突,容器色不可传导(无视觉影响,规范口径冲突)。
- `proc_run.rs:151-163` 非超时三分支统一 sleep 500ms,EOF/Disconnected 场景的宽限是纯等待;可只在 Matched 分支宽限。
- `cliQuery.ts:220-225` 成功路径 `console.info("[cliQuery] fetched: ...")` 每查询一条,生产噪音,宜降 debug 或删。

### 资产库(5)

- `assets/store.ts:101-188` `selectedBySession` 永不清理已死会话 id,agents.json 单调增长。
- store 多处 `.catch(() => undefined)` 静默吞写盘错误,UI 误以为保存成功。
- iconDecor 8 键收 7 键后,旧用户 settings.json 的 `iconDecor.eye` 残留被 sanitize 静默丢弃(f2cbf1a;无害,宜 spec 补一句迁移说明)。
- `assets/index.tsx:88-90` activate 内 `this.deactivate = ...` 赋值,activate 中途抛错则反注册钩未设。
- fa24fa3 commit message 失真条目(并入 P1-5)。

## 误报证伪(主会话亲核)

- **ReviewAppearance P1「getCurrentWebview 静态 import 桩环境即崩」不成立**:`@tauri-apps/api/webview` 为纯 ESM 包,import 期不抛,仅调用期缺 internals 才抛;`uiZoom.ts:16-24` 已有 `try{ …catch(fallback)}catch{fallback()}` 双兜底(42ed114 落地),且今日多次桩目检(1421 dev server)实证应用可启动。

## 无发现面(抽认)

- 架构:R1/R3/R4 全批零违规;300 行铁则全批合规(最大 proc_run.rs 291);插件贡献全走 activate(ctx);kernel 零插件私有知识(composerExt 仅 type import);cli-shared QoderGlyph 2 消费者准入合规;PTY 幕布链未触碰。
- 巨型迁移:rem 换算抽查 ~60 对全部二进制精确,HEAD 全库 `text-[Npx]`/`size={N}` 残留 0;`size={number|string}` 类型拓宽全链(cli.ts/plugin.ts/marketPanel/sidebarActions/filePanel/drawerItems/各 glyph)无遗漏;en/ja 13 域键数逐对相等,locales.test.ts 钉死键集合/非空/占位符保留。
- 67e0b8a RPC 副车截断修复:Rust 读线程不提前 return + 500ms 宽限 + 杀整树 EOF,TS 括号深度扫描 6 测试覆盖,论证完备;7e4472a 诊断管线收口干净零残留,fsWriteTemp 由 composer attachments 独立消费无连带死代码。
- 29c7698 release:三处版本号一致,CHANGELOG 条目与真实 commit 逐条对账。
- 1d99644 promptSent 轮次闸:状态机与 42448c0 同源,promptGate.test.ts 6 用例全路径,三个发射点全过闸。
- f2cbf1a 撤销清理:eye 相关 8 类符号全仓 0 命中,CSS/测试/DEFAULT_ICON_DECOR 同步删净。
- 196adf2 PinIcon 沉淀 kernel 后旧 import 零悬空;sessionReveal 契约测试 4 用例覆盖在位直发/暂存补发/退订回暂存。

## 处置建议

1. ~~立即修:H1~~ 已修:恢复 `icon: CodexGlyph` + `iconColor: "var(--tmd-fg)"`;桩目检市场页 codex 六边形 glyph、容器色 = --tmd-fg(#3b3b3b)正确。
2. ~~随手修:P1-1 触发守卫、P1-2 en/ja 词典补键~~ 已修:serialize.ts 词字符守卫 + 用例;新增 locales/{en,ja}/assets.ts 46 键、composer placeholder 死键原位替换,57 源键程序化全命中;桩目检 en 下资产 tab 全英文。
3. ~~择期:P1-3/P1-4~~ 已修:revealSession 代次闸 cancel + 卸载清理;sessionReveal pending 改 FIFO 队列 + 用例。剩余 P2 批择期。
