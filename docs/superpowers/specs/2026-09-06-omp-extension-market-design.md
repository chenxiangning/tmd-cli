# omp 扩展市场:cli-omp 二级插件安装/卸载

日期:2026-09-06
状态:已评审通过(用户确认:npm 实时搜索 + 静态表兜底;仅 npm 包通道;A 注册表机制 + X command 安装通道)

## 背景与目标

omp 自带插件体系(`omp plugin install/uninstall`,实为在 `~/.omp/plugins` 下跑 bun install,本机 18.1.11 实测)。npm 生态活跃:`keywords:omp-plugin`(omp 专属)与 `keywords:pi-package`(pi/omp 兼容,omp 消费 pi manifest)两个关键词可搜到真实插件。当前 tmd-cli 对此零暴露,用户必须进终端手敲命令。

目标:插件市场页(插排)的 `cli-omp` 插头上增加角标 icon,点击滑出 omp 扩展面板,提供:

1. 热门扩展目录(npm 实时搜索,周下载量排序),展示用途描述与风险;
2. 安装/卸载(仅 npm 包通道),流式日志反馈;
3. 已装清单展示(含 enabled 徽章,只读)。

硬约束:omp 私有语义(目录源/安装命令/风险文案)全部留在 `cli-omp` 插件目录;kernel/app-shell 不出现任何 omp 字样。

## 方案取舍

### 挂载机制

**选定:A · 专用注册表 `marketPanel`。** 对齐 filePanel/tabs 先例:kernel 新增 `marketPanel.ts`(`MarketPanelContribution { pluginId, icon, iconColor?, title, component }`,pluginId 键),ctx 加 `registerMarketPanel` 通道;app-shell 插座单元发现插头有 panel 即渲染角标,点击开滑出面板,壳只管开合/动画/ESC,内容由插件贡献。机制天然泛化,pi 后续加同款面板是纯增量。

**否决:B · 泛化挂点 + 事件总线。** `MountContribution` 加 pluginId,icon/面板/开合状态分三处经 events 协调——为省一个注册表引入更松的链路,协调代码比注册表本身还多。

**否决:C · app-shell 直接 import cli-omp。** 违反「一切经 ctx 注册面」铁律。

### 目录数据源

**选定:npm registry 搜索 API 实时拉取 + 静态精选表兜底。** `registry.npmjs.org/-/v1/search` 免鉴权,响应含 `downloads.weekly`(真实热门排序依据)与描述;双关键词并发、去重、周下载降序取 20;HTTP 失败回落内置静态精选表(顶部黄条标注「离线精选目录」),静态表兼任缺失描述的补全源。与仓库「静态表兜底」既有模式一致。

**否决:纯静态精选表。** 零网络依赖但跟不上生态,需随版本人工维护。

**否决:marketplace 目录源。** 需先 `marketplace add` Git 源,且现有公开目录(claude-plugins-official)是 Claude 系,反而不覆盖 omp 原生 npm 生态。

### 管理范围与执行通道

**选定:仅 npm 包通道 + installer.rs 通用 command 通道。** 安装/卸载 = `omp plugin install/uninstall <pkg>`,经 `ipc.cliInstallRun("omp-ext:<pkg>", { channel:"command", program:"omp", args:[...] })` 执行:installer.rs 的 `InstallPlan` 增加 `Command { program, args }` 成员,完全复用既有 `cli-install://{id}` 流式事件协议(逐行日志 + phase 生命周期 + 300s 超时 + spawn_blocking)。Rust 仍零配方(program/args 由前端传入)。

**否决:marketplace 全量通道(add 源/scope/目录缓存)。** 一期明显变重,留二期。

**否决:proc_communicate 长超时缓冲。** 输出整段缓冲到最后,安装中无流式反馈;超时到点强杀,慢网络 bun install 易误杀。安装类长任务错位。

## 交互设计

### 入口

- 插排视图 `cli-omp` 插头右上角角标(lucide `Package` 字形,与左上 core 焊点对角);仅注册了 marketPanel 的插件渲染角标。
- 点击角标阻止冒泡(不触发插拔),市场页右侧滑出面板(~460px,轻遮罩;ESC / 点遮罩 / × 三路关闭)。
- 清单列表视图(PluginMarketList)一期不动。

### 面板结构(内容全部为 cli-omp 贡献组件)

| 分区 | 内容 |
|---|---|
| 头部 | 「omp 扩展」+ 本机 omp 版本 + 刷新按钮 + 关闭按钮 |
| 已安装区 | `omp plugin list --json` 的 npm 数组:包名 / 版本 / enabled 徽章(只读)/ 卸载按钮(两步确认:首击变红武装,3s 回弹,废纸篓先例同款) |
| 热门目录 | 卡片 = 包名@最新版 / 两行描述 / 周下载量 / 风险标签 / homepage 外链 / 安装按钮(已装置灰) |
| 安装中卡片 | 内联日志区:`cli-install://` 事件逐行等宽滚动,自动滚底;完成/失败后收起保留最近错误 |
| 底部横幅 | 固定风险与生效语义提示(见风险呈现) |

### 数据流

- **目录**:`quotaFetch` 并发拉 `https://registry.npmjs.org/-/v1/search?text=keywords:omp-plugin&size=25` 与 `text=keywords:pi-package&size=25` → 按包名去重、排除 `@oh-my-pi/*` 官方包 → `downloads.weekly` 降序取前 20;20s 内存缓存,面板重复开合不重拉,刷新按钮强刷。
- **已装清单**:`procCommunicate { command:"omp", args:["plugin","list","--json"], timeoutMs:15000, closeStdin:true }`,解析 `.npm[]`(name/version/manifest.version/enabled);面板打开拉一次,每次装/卸完成后重拉。头部 omp 版本同源:打开时一次性 `omp --version` 获取。
- **安装/卸载**:command 通道(见上);同包防重入(进行中禁按钮),异包可并行;完成后重拉清单 + 目录卡片状态翻转。

### 风险呈现(硬要求)

- 每张卡片固定红色「任意代码执行」标签——omp 插件进程内执行任意代码,官方文档明文警告无沙箱,此提示是真实约束不是装饰。
- 安装两步确认:首击展开风险详情(以当前用户权限运行 + 来源链接),第二击才执行。
- 卡片带 homepage 外链(lucide `ExternalLink`);无 homepage 回退 npm 包页。
- 底部固定横幅:「插件以当前用户权限在进程内执行任意代码,安装前请审查来源;磁盘安装即时,已开的 omp 会话不热加载,需重开会话生效」。

## 架构落点

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/kernel/marketPanel.ts` | 新建 | pluginId 键注册表,~40 行,filePanel 同款结构 |
| `src/kernel/plugin.ts` | +1 行 | `PluginContext.registerMarketPanel` |
| `src/kernel/host.ts` / `hostRegistry.ts` | +委托 | registerMarketPanel / getMarketPanel |
| `src/kernel/ipc.ts` | +1 成员 | `CliInstallPlan` union 加 `{ channel:"command"; program:string; args:string[] }` |
| `src-tauri/src/installer.rs` | +分支 | `InstallPlan::Command`:unix 直接 spawn;Windows 经 `cmd /c` 兼容 .cmd shim(npm 通道先例);沿用 300s 超时与流式事件 |
| `src/app-shell/PluginMarketStrip.tsx` | 改 | Outlet 角标渲染 + 点击回调(onOpenMarketPanel) |
| `src/app-shell/PluginMarketPage.tsx` | 改 | 滑出面板容器:开合状态 / 动画 / ESC / 遮罩;内容按 `getMarketPanel(激活插件)` 渲染 |
| `src/plugins/cli-omp/market.tsx` | 新建 | 面板组件(已装区/目录/日志/两步确认);预估 ~260 行,超 300 拆组件子文件 |
| `src/plugins/cli-omp/catalog.ts` | 新建 | npm 搜索并发/去重/排序/静态兜底/缓存 |
| `src/plugins/cli-omp/market.test.ts` / `catalog.test.ts` | 新建 | 见验证 |
| `src-tauri/src/installer.rs` tests | +用例 | command 通道命令构建(unix/windows) |

合规自查:R1(kernel 不 import plugins)不涉;R3(@tauri-apps 唯一 import 点)不涉;R4(插件不 import @shell/*)合规——面板内容组件只 import `@kernel/*`,开合状态由 app-shell 容器持有;300 行铁则逐文件受控;`allPlugins` 不动(cli-omp 已注册)。

## 错误处理

| 场景 | 行为 |
|---|---|
| omp 不在 PATH(proc 通道启动失败/code 非零) | 面板空态「未检测到 omp CLI」+ 引导到欢迎页引擎卡 |
| 目录请求失败/超时 | 静态精选表 + 顶部黄条「离线精选目录」 |
| list JSON 解析失败(未来格式变化) | 已装区显式「无法解析」+ 原样错误摘要,不做猜测兜底 |
| 安装失败 | 日志区保留,exit code 红字,卡片回可安装态 |
| 面板开着时会话在跑 | 无冲突:磁盘操作,不触碰运行中会话 |

## 验证

- vitest:catalog 合并去重(双关键词交集)/ 排序 / 排除官方包 / 失败兜底切换;list JSON 解析(scoped 包、enabled=false、manifest.version 缺失回退 version 字段)。
- cargo test:installer command 通道命令构建(unix 直 spawn / windows cmd /c 包装)。
- 交付前全量:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;Rust 侧 `cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`。
- 真机目检(`pnpm tauri:dev`):角标滑出 → 安装 `omp-plugin-duplicate-detector@0.2.3`(小包秒装)→ 幕布新开 omp 会话 `/plugins list` 确认出现 → 面板卸载 → 复验消失;安装日志流式滚动目检;ESC/遮罩关闭目检。

## 非目标(一期不做)

- marketplace 通道(marketplace add / name@marketplace / user-project scope)
- upgrade 按钮
- pi CLI 同款面板(机制就绪,加第二个消费方是纯增量)
- 幕布内热重载提示
