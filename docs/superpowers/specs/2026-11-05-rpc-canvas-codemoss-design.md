# RPC 幕布渲染层对照 codemoss UI 的重构方案(2026-11-05 已落地:四批次实施,PTY 路径零接触)

## 背景与目标

当前 RPC 会话幕布(structured-session 插件)经过多轮修补后可用,但与参考项目 codemoss(`src/features/chat/components/`)的成熟对话 UI 相比,在信息架构上仍有明显差距:

- 思考段 / 工具调用**一直折叠**(用户原话),输出过程中看不见过程,只能看到 spinner;期望是**输出时展开、完成后按段落折叠**。
- 工具行只有一个 label + 尾段输出,没有工具类型分类、目标文件 chip、载荷查看器。
- working 底带(ss-working)信息单薄,只有模型名 + 计时;没有子代理 / 已编辑文件 / todo 等运行态汇总。
- 滚动跟随只有朴素的贴底逻辑,没有「离开底部」悬浮回底控件。
- 长消息(粘贴的大段文档)没有折叠保护。

目标:以 codemoss 为参照,对 RPC 幕布做一轮**结构性**重构(不是像素级复刻),把「过程可见、终态收敛」作为核心交互律。

## 方案取舍

- **参照而非移植**:codemoss 是独立技术栈(@tanstack/react-virtual、zustand、motion、自研 plugin-sdk),不可能也不应该整体搬入。本方案逐件对照其组件职责,在 tmd-cli 现有 session-viewer / structured-session 体系内重做,复用现有 TranscriptView 同形组件律(活轮与落定同形,结算零跳变)。
- **虚拟列表不引入**:codemoss MessageTimeline 用 @tanstack/react-virtual 虚拟化(769 行),支撑超长会话。RPC 会话目前按 turnStart 切片渲染(活轮 + 历史),真实转录量远小于 codemoss 的持久会话;引入虚拟化是负资产。保留「活轮/历史切片」架构。
- **折叠律是本轮核心**:codemoss 的 ProcessDisclosure(543 行)把工具调用按类型分类、文件 chip、载荷查看器组织成可折叠过程组;CollapsibleMessage(480px 阈值)折叠长消息;use-live-reveal 做流式逐段揭示。这三件的**交互律**移植,视觉风格保持 tmd-cli 现有 CSS 变量体系。
- **RunStatusStrip 的 pill 行不做**:codemoss RunStatusStrip(890 行)依赖 git store、子代理派生、todo 派生等一整套数据面,tmd-cli 没有对应数据;当前 ss-working 底带 + SsHeader 统计已覆盖核心诉求。仅吸收其「右侧 chrome 开关可隐藏」的单一交互点,低优先级。
- **改动面收口在 structured-session + session-viewer 两个插件内**,kernel 零改动(架构 R1)。

## 对照映射(定稿)

| codemoss 组件 | 行数 | 职责 | tmd-cli 落点 |
|---|---|---|---|
| MessageTimeline | 769 | 时间线构建/分组/虚拟化/锚点 | 不搬虚拟化;吸收其 `timeline-rows.ts` 的行分类思想,重构 LiveTurn 的活块编排 |
| ProcessDisclosure | 543 | 工具调用折叠过程组(类型 chip + 文件 chip + 载荷) | 重写 structured-session 的 ToolRow → ToolDisclosure:工具类型分类(bash/read/edit/search/web/task)、目标路径 chip、载荷查看器 |
| ToolPayloadViewer | 427 | 工具载荷(输入/输出)查看器 | 上件内嵌实现,不独立成 427 行大件 |
| CollapsibleMessage | ~150 | 长消息折叠(480px 阈值 + 底部渐隐 + 中央 chevron) | session-viewer TranscriptBlockView 用户块/正文块加同款折叠 |
| ScrollControl + use-scroll-follow + use-tail-pin | ~300 | 滚轮唤出回顶/回底悬浮钮 + 贴底跟随 | structured-session 的 ss-scroll 吸收:离开底部 >100px 时浮出回底钮,点击滑到底并恢复跟随 |
| use-live-reveal / stream-reveal | — | 流式段落逐段揭示 | ThinkingRow 已有 streaming 展开律;补强「段落落定即折回单行摘要」 |
| RunStatusStrip | 890 | 底带 pill 行(子代理/已编辑/todo) | 不搬;ss-working 仅吸收「可隐藏」开关(低优先级) |
| ConversationFooter | 596 | 输入区组合 | 不搬;ssComposer 已在本轮与 PTY composer 对齐 |

## 渲染与样式

- **折叠律(本轮主交付)**:思考段与工具调用在**输出过程中展开**(streaming 自动展开已有),**段落/工具落定后折回单行摘要**——与工具行 running 展开/终态折叠同律,统一为一条「过程可见、终态收敛」规则,并在 CSS 上给折叠摘要统一的 `ss-disclosure` 组件类(头部行 + chevron + 摘要文本 + 展开区)。
- **工具过程组**:工具行头部 = 状态图标(Spinner/✓/✕,沿用) + 工具名 + 类型 chip(web/shell/read/edit/search/task,按 codemoss `toolTypeKey` 的分类思想,纯函数可测) + 目标文件 chip(路径尾名,过滤 glob/URL,同 codemoss `fileChipFor` 规则);展开区 = 命令预览 + 实时输出 + 载荷查看器(输入参数折叠在输出之下)。
- **长消息折叠**:用户块/正文块超过 480px 提供折叠,收起态 320px + 底部渐隐 + 中央 chevron;测量走 `scrollHeight`(codemoss 同款),晚到图片可重判。
- **滚动控制**:跟随逻辑抽成 `useTailPin`(贴底标记 + 离开阈值 100px),滚轮向上浮出「回底」悬浮钮,点击滑回底部并恢复跟随;短内容/贴底时隐藏。
- 全部样式挂现有 structured-session.css / session-viewer CSS 变量,不新增色板。

## 改动面与验证

- **改动面**(按提交拆批):
  1. `ss-disclosure` 折叠原语 + ToolRow 重写为 ToolDisclosure(类型/文件 chip + 载荷查看器)+ `toolTypeKey` 纯函数;契约测试覆盖分类与 chip 规则。
  2. ThinkingRow 落定折回律补强 + 长消息 CollapsibleMessage 移植进 session-viewer。
  3. useTailPin + ScrollControl 进 structured-session。
  - 每批交付前 `pnpm check:gate` 全绿;`pnpm tauri:dev` 真机目检:长轮次中过程展开/落定折叠、长消息折叠、滚轮回底。
- **验证清单**:流式轮次中思考/工具可见 → 落定后单行摘要;点击摘要可再展开;工具 chip 分类正确(对真实 omp/pi 轮次);粘贴长文档发送后用户块折叠;上翻后浮出回底钮。
- **不做**:虚拟列表、RunStatusStrip pill 行、锚点轨(MessageAnchorRail)、TimelineSearchBar( RPC 转录量不需要)。
- **风险**:LiveTurn 与 TranscriptView 的同形律是既有契约,ToolRow 重写必须保持落定后 TranscriptView 折叠组渲染不跳变(结算零跳变是硬约束)。
