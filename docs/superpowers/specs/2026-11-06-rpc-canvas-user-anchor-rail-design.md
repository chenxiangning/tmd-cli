# RPC 幕布左侧用户对话锚点栏

日期:2026-11-06
状态:已确认(用户图证:codemoss 幕布左缘细竖轨,短横刻度 = 用户消息,最近视口顶的刻度高亮)

## 背景与目标

结构化会话(RPC 幕布)长对话上翻困难:用户消息散布在多轮之间,无快速定位手段。codemoss 幕布左缘有一根固定细竖轨,每个刻度对应一条用户消息,点击即跳,视口位置最近的刻度高亮。目标:在 RPC 幕布左缘复刻该锚点栏。

数据面零新增:用户块 DOM 已带 `data-vb = 块 id`(SsUserBlock),锚点栏直接量 DOM 定位,不经 kernel messageAnchors 轮询(RPC 块全量在内存,无读盘必要;PTY 锚点体系零接触)。

## 方案取舍

**选定:量轨组件(ssAnchorRail.tsx)。** 滚动容器 `.ss-scroll` 首子插入 sticky 轨容器(`.ss-anchorail`,top:0 + height:0 占位不占流,同 `.ss-canvas-handle` 前例),轨面(face)JS 量取 `clientHeight`,刻度按 `docTop / scrollHeight` 比例分布轨面;点击刻度 `scrollTo` 跳转;scroll 监听把「最后一个 docTop ≤ scrollTop + 24px」的刻度置 active。

理由:纯渲染层推导,无状态泄漏;ResizeObserver 盯 scrollHeight(流式生长/图片加载自动重排刻度)。

**刻度最小间距**:密度超轨高时(`条数 × 10px > clientHeight`)回落纯比例(超密宁可重叠,不压扁分布);否则顺序推挤保 10px 最小间距。

**否决:复用 kernel messageAnchors 轮询。** RPC 块全量在内存,DOM 直测即时准确;轮询是 PTY 专属回退路径,引入反而双源分叉。

## 渲染与样式

- 轨容器 sticky 贴滚动视口顶,height:0 不占流;轨面 absolute 左缘 2px,宽 10px,高 = clientHeight(JS),pointer-events 只在刻度。
- 刻度按 docTop/scrollHeight 比例分布进**垂直居中带状区**(带高 = 轨面 60%,上下各留 20%;2026-11-06 用户调整:居中不铺顶)。
- 刻度视觉条 = `::before` 短横条 **9px 宽**(2026-11-06 二轮用户调整:6 的 1.5x)× 2px 高圆角,常态 `--tmd-fg-faint`,active `--tmd-fg`;按钮本体 = **26×16px 透明命中区**(2026-11-06 二轮用户调整:悬停触发从难到易,视觉条不含命中职责);hover 视觉条**波浪式拉伸**(width 弹性缓动 cubic-bezier(0.34,1.56,0.64,1) overshoot 拉至 18px)并弹出**信息小卡**(`::after` 浮层 = 用户消息前 160 字,`width: max-content` 不受窄按钮约束——首版缺省收缩适配按钮宽度致文字竖排,修复;max 240px 宽/132px 高,主题 elevated 卡);z-index 5(低于宽度抓手 6)。
- 有用户消息即渲染(单条也给锚点,可跳回提问);title/aria-label = 用户消息前 48 字(内容自身即标签,零新增 i18n 键)。
- 用户块零改动(复用 `data-vb`);落定轮与活轮用户块同被收录。

## 改动面与验证

改动:`structured-session` 插件内新增 `ssAnchorRail.tsx`;`structured-session.css` 补一段样式;`sessionTab.tsx` 渲染一行(用户块列表 useMemo 已有同源)。共 3 文件 + spec/索引。

验证:`pnpm check:gate` 全链;`npx react-doctor@latest -y` 100 分;真窗口目检:多轮会话刻度比例分布、点击跳转、active 跟随滚动、流式生长刻度重排。
