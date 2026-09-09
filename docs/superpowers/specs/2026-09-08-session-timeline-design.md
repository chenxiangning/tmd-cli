# 会话时间线(审批线面板「时间线」页签)设计

- 日期:2026-09-08
- 状态:已落地(2026-09-08,Tmd-0.1.3)

## 背景与目标

大仙多会话并行,认不出哪个窗体在干什么。kernel 的幕布扎点(messageAnchors)只在终端幕布形态可见——切中央 tab 或折叠对话框即消失。右栏审批线面板是唯一的会话级常驻表面。

目标:审批线面板摘要行加 segmented「审批线 | 时间线」;时间线记录本会话全部用户消息(含 app 启动前的历史),图片/文件附件美化渲染;点条目定位幕布扎点,把「扎点」从幕布形态里解放成常驻导航。

## 方案取舍

| 决策点 | 选定 | 否决 | 理由 |
|---|---|---|---|
| 形态 | A:审批线面板内 segmented 页签(大仙原案) | B:独立右栏面板 + 工作区级跨会话聚合 | A 实现最省、当期解决「这个窗体在做什么」;B 直击「一屏扫全部并行会话」但要新面板位 + 跨会话聚合,留作二期候选(原型已存 `docs/design/session-timeline-scheme-b.html`) |
| 数据源 | kernel `messageAnchors` 直接消费 | 自建 store 监听 `kernel.sessions.prompt` | promptSent 只有订阅后的运行期消息、无历史回补;anchors 已有各 CLI 插件 `readSessionUserMessages` 适配器(2s 轮询 + 32MB 全量首轮 + 增量合并 + 会话退出即清),重启回补白捡。内核不理解私有行型(cli-shared 铁律),缺适配引擎天然空态 |
| 附件渲染 | 复用 `PromptImages`(图片)+ 新 `timelineText.ts`(非图片 @路径 → 文件 chip) | 新写渲染 | 图片剥离/缩略图/lightbox 全部现成;文件正则与 `IMAGE_TOKEN_RE` 同族(终止符去掉「.」:惰性匹配会把 `/a/b.ts` 截成 `/a/b`,扩展名的点绝不能当边界;末字符必须非终止符) |
| 时间戳 | 不显示 | 每条标时间 | `CliUserMessage` 契约只有 id+text;全量时间戳要动 10 家 CLI 解析器,二期再说 |
| 结算态 | 仅最新条目在 promptSent→turnSettled 窗口内标「进行中」 | 逐条「已结算」徽标 | 已结算是默认态,逐条标是噪音;条目无 ts,次新条目的态无法诚实标注 |
| 定位交互 | 仅悬停浮出的「定位幕布」按钮触发 `jumpToAnchor` | 整行点击定位 | 整行点击与消息文本选择/复制冲突 |
| 摘要行视觉 | 平滑紧凑:无外框、无底槽、无内阴影,选中仅软底色 + 600 字重;项目徽章纯文本 | 初版 `bg-input` 容器 + `inset shadow` 选中 + 胶囊徽章 | 大仙评审:凹凸感太强。对齐侧栏 `ws-view-toggle`(默认|归档)迷你平版先例 |
| 展开阈值 | 净文本 >120 字符才给「展开全文」(CSS `line-clamp-3` 收敛 3 行) | 按行数/恒出按钮 | 行数要测量,字符阈值零成本;短消息不出按钮 |

## 验证

- `pnpm typecheck && pnpm test`(1115 过,含新增 `timelineText.test.ts` 6 例)`&& pnpm check:arch-boundary && pnpm check:file-size && pnpm build` 全绿。
- 1421 浏览器桩目检(`__TAURI_INTERNALS__` 配方:fs_collect_files/fs_read_tail 喂 omp 行型 JSONL,read_local_image_data_url 喂 data URL):
  - 6 条消息倒序 #6→#1;摘要行右侧「6 条」,切回审批线恢复「待审 N」。
  - 图片 96×72 缩略图渲染(lightbox 走 PromptImages 既有通路);文件 chip `dir` 淡 + 基名亮;纯图片消息无文本块;token 剥离后净文本正确。
  - 长文 clamp 3 行可见截断,「展开全文」→ 展开,「收起」→ 回夹,往返幂等。
  - 双空态:无活跃会话 → 「时间线跟随会话生命周期 —— 当前没有活跃会话」;有会话无消息 → 发送提示态。
  - 「定位幕布」悬停浮出;桩环境无真实幕布缓冲时跳失败 → 条目短暂红闪(同 AnchorRail miss 语义)。
- 遗留:tab.run 的 page.evaluate 桥目检中反复 `__omp_shell is not defined`(每 tab 成功 2-4 次后必死,已报 xd://report_issue);目检后段改走 tab.click/tab.evaluate 直连接口完成。

## 改动面

- 新增:`src/plugins/checkpoints/TimelinePanel.tsx`(面板 + TimelineCount)、`timelineText.ts`(拆解纯函数)、`timelineText.test.ts`。
- 修改:`CheckpointsPanel.tsx` 仅摘要行 + 视图门控(审批线逻辑零改动,用户定向);`locales/en|ja/misc.ts` 各 +6 键(时间线/定位幕布/展开全文/双空态;进行中、收起、{count} 条复用既有键)。
- 设计原型:`docs/design/session-timeline-scheme-a.html`(已同步扁平化定稿)、`session-timeline-scheme-b.html`(二期候选)。
