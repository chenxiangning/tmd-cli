# 首页终端窗体重设计(全动作行)

- 日期:2026-09-11
- 状态:已确认(用户拍板方案 S,原型 `docs/design/home-redesign-s-full-actions.html`)

## 背景与目标

现首页(welcome 插件)为「hero + 纵列引擎卡」结构:引擎信息密度低、
新建会话入口缺位(只能去侧栏工作区卡片)、配额/凭据/续作分散在三处。
经五轮原型探索(主角=动作/项目/工具/终端家族构图变体),用户选定
**终端窗体 + 全动作行**方案。目标:

1. 首页 = 一块等宽终端窗体:标题条 / prompt 行(工作区 select,右侧
   engines/updates 统计)/ 引擎行列表 / RESUME+QUOTA 页脚。
   (原 keybar 与顶部 hint 行内容重复,已删;统计行并入 prompt 行右侧。)
2. **每引擎一行,行尾常驻完整动作簇**,现有功能零丢失:安装 / 更新 /
   重装 / 重探 / 官方文档 / 前置依赖引导 / 安装进度条+流式日志 /
   凭据额度 / homePanels(dsh host 面板)/ 续作 / 换工作区。
3. 新增能力:行内「新会话」直达(选中工作区 × 引擎,`host.createSession`)。
4. 键盘游标:↑↓ 移光标、⏎ 以当前工作区启动选中引擎新会话(组件局部
   keydown,不进 kernel 命令注册表)。

## 方案取舍

- **选定:S 全动作行(终端窗体)** —— 行结构与现有 EngineCard 一一对应,
  改造是重排不是重写;信息一屏全给,无隐藏交互。
- 否决 T 命令面板:真命令行 = 新语法新学习成本,且 welcome 是盘点视角,
  命令解析器是纯增量复杂度。
- 否决 U 主从详情:动作藏进右面板,十引擎切详情比逐行扫慢。
- 否决 V 状态分组:分组语义(待更新/需处理)漂亮但把「就绪」引擎折叠,
  新会话主路径反而变远;批量更新按钮留作后续候选。
- 否决 W tile 网格:tile 内按钮簇在窄格里换行破版,等宽字体在 4 列网格
  下无法对齐配额列。
- 视觉铁律:颜色零硬编码,全消费 `--tmd-*` token(等宽终端色映射:
  ok→`--tmd-ok`、warn→`--tmd-warn`、err→`--tmd-err`、cyan→`--tmd-syntax-type`、
  光标蓝→`--tmd-accent`);字号走全局 rem 链,不新增 `text-[Npx]`。

## 设计

### 组件与数据流(全部在 src/plugins/welcome/,内核/Rust 零改动)

- `WelcomePage.tsx`(装配):
  - 状态:probes / depProbes / latest(不变)+ **credsMap**(新增:页级一次
    `listEngineCredentials` 全引擎拉取,喂行内配额列、凭据展开区、页脚
    QUOTA、状态行,免每卡各拉一遍)+ **wsSel**(prompt 行工作区 select,
    `useWorkspaces`,默认首个)+ **cursor**(行游标)。
  - 结构:`.welcome-tbar`(标题+⌘K 提示)→ `.welcome-promptline`
    (`<select>` 终端样式 + 右侧 `.welcome-statusline`(engines n/n /
    updates n))→ `.welcome-rows`(EngineCard 行列表)→
    `WelcomeFooter`(RESUME+QUOTA)。
  - 键盘:容器 `tabIndex=0` + onKeyDown ↑↓⏎; = `host.createSession(
    选中引擎, wsSel.root, wsSel.id)`。
- `EngineCard.tsx`(行):grid 列 = 游标 ▸ / 图标+名 / 版本(→latest)/
  配额块条(首供应商 windows 紧凑)/ 凭据状态(●/✗,点击展开)/
  动作簇。动作簇文案映射(行为不变):notFound→`安装`;ok&&outdated→
  `更新`(高亮);ok&&!outdated→`重装`(同 onInstall,语义=重装当前版);
  常驻 `重探` + `docs ↗` + `新会话`。行点击 toggle 展开区 =
  CredentialList(受控,props 传 creds)+ HomePanel(插座保留)。
  依赖引导 PrerequisiteGuide 与 InstallLog 原位(行下方)。
  `useEngineInstall` 钩子与导出接口不动。
- `WelcomeFooter.tsx`(新,吸收 RecentSessions):RESUME = 全工作区×全
  profile 磁盘会话扁平时间序前 8 条,点击 `host.openDiskSession`;
  QUOTA = credsMap 按供应商 title 去重聚合,5h/7d 块条 + 重置时刻 +
  余额型行。RecentSessions.tsx 删除,openSession 逻辑迁入。
- `CredentialList.tsx`:改受控组件(creds 由 props 给),渲染结构不变。
- `welcome.css` 重写 + `welcome-rows.css` 新(300 行铁则,两文件分片)。
- locales en/ja welcome.ts 补新键(重装/新会话/状态行/页脚标题等)。

### 错误处理

- creds 拉取失败:行配额列显 `—`,不噪音(对齐现规则);
- createSession 失败:内核已广播 sessionStartFailed toast,吞 rejection
  (对齐 SessionMenu 先例);
- 无工作区:select 显默认工作区(kernel 保证 default 在列),新会话恒可用。

## 验证

1. `pnpm typecheck && pnpm test && pnpm check:arch-boundary &&
   pnpm check:file-size && pnpm build`。
2. EngineCard.test.tsx 契约更新:outdated 行渲染「更新」、非 outdated 渲染
   「重装」、notFound 渲染「安装」+ 依赖门控禁用不变。
3. 浏览器桩目检(1421 + Tauri 桩配方):行网格对齐、展开区、安装进度、
   依赖引导、RESUME 续作点击、QUOTA 聚合、↑↓⏎ 游标。
