# 插件强化 提案(plugin-hardening)

日期:2026-09-10 · 状态:已实现(2026-09-10 当日落地;typecheck/1370 测试/架构/行数/build 五闸全绿,桩目检过;待大仙真窗验收)
来源:`docs/review/2026-09-10-codemoss-plugin-architecture-comparison.md` 互鉴清单(codemoss 插件系统三优点:manifest 权限、Disposer 生命周期、崩溃熔断)

## Why

本地插件动态装载已落地(SHA-256 信任闸 + apiVersion 纪元 + 归档版本库),但对照 codemoss 插件系统逐项核 ours,三个缺口是真的,且都落在本地插件这个「不可信代码」面上:

1. **能力无围栏**。`kernel/pluginSdk.ts` 把整个 `ipc` / `host` / `settings` 命名空间裸给本地插件(`export * as ipc from "./ipc"`):一个过了信任闸的插件可读写任意文件(`fsReadFile`/`fsWriteFile`)、拉起会话与 PTY、改写全量设置。信任闸只证明「用户确认过这段内容」,不约束「确认之后能碰什么」。manifest 无 permissions 字段(`localPluginLoad.ts:validateManifest` 只查 id/apiVersion/entry 三条)。codemoss 对位物:manifest permissions 逐贡献点标注 + bridge 仅四条命令 + `plugin_caps.rs` 846 行 Rust 纵深。
2. **激活失败留残骸**。本地插件 activate 中途抛错只回滚占位(`pluginLifecycle.ts:106` 的 `plugins.delete`),已执行的 register\* 贡献残留在各注册表里——半截插件的挂点/命令/设置 section 继续活着。codemoss 对位物:Disposer 栈逆序回收。
3. **崩溃只隔离不熔断**。挂点贡献已有逐贡献 ErrorBoundary(`Mounts.tsx`),但全库边界仅此一处:registerTabContent / registerFilePanel / registerSettingsSection / registerHomePanel / registerMarketPanel 的贡献组件渲染无边界;且现有 boundary 静默渲染 null,无归属计数、无阈值熔断,坏插件的其余贡献与命令通道反复投毒。codemoss 对位物:PluginBoundary 计数 + 阈值 quarantine。

时机:本地插件生态为零,此刻收窄 SDK、bump `LOCAL_PLUGIN_API_VERSION` 1→2 零兼容债;生态起来后再做就是破坏性变更。

## 方案取舍

### A. 能力声明(permissions)

- **A1(选定)manifest 声明制 + 逐插件 shim 包装**:manifest 增可选 `permissions` 字段。`tmd-sdk` shim 从全局单例(`installPluginShims` 一份 `window.__TMD_SHIMS["tmd-sdk"]`)改为按插件实例:无 `permissions` = 纯 UI 插件,shim 只含 React 原语,ipc/host/settings 整体缺席;有声明 = 按 `ipc.<类别>` 粒度暴露白名单子集,白名单外成员访问即 throw 明确报错。`ipc`/`host`/`settings` 导出 → 权限类别的映射表收敛在 kernel 单文件(唯一事实源),配穷尽性单测:每个导出方法必须归类或显式拒发,杜绝「新加一个 ipc 方法静默逃过权限」的口子。信任闸升级双绑定:entry hash + manifest hash 都得对上(permissions 变了 = manifest 变了 = 重新过闸),信任记录从单 hash 串改为双 hash。既有 `rewriteSpecifiers(spec, shimUrlFor)` 机制原样复用,只改寻址:`tmd-sdk` → `tmd-sdk:<pluginId>`。
- A2(否)codemoss 式 bridge 少数命令收口:要把全量 ipc 门面坍缩成几条桥命令,等于重设计 IPC 层,波及全部内置插件调用点。收益错配,tmd-cli 的 ipc 门面是全产品共用底座,不是插件专用桥。
- A3(否)runAsPlugin 栈嗅探拦截(codemoss `hardening.ts` 同款,深度计数包裹 `__TAURI_INTERNALS__.invoke`):依赖 error.stack 嗅探,异步续体即丢栈——codemoss 自己在注释里承认残余绕过面靠市场审核兜底。高成本低保证;JS 层包装的天花板是「劝阻」不是「围栏」,本提案如实把这个天花板写进 SDK 文档。
- A4(否,v2)Rust 侧命令级插件身份(codemoss `plugin_caps.rs` 对位物):真围栏,但要求每条 IPC 命令携带 pluginId + 白名单校验,改动面横跨全部 Rust 命令与 invoke 协议。列为 v2;A1 的 JS 层过滤在 README/SDK 注释明示其威胁模型边界(防误用与低危恶意,不防蓄意同域逃逸)。

### B. 贡献回滚栈(undo)

- **B1(选定)内核逐插件记账 + activate 可返回 cleanup**:激活时给插件包一层 attributed ctx(register 调用先记账后透传宿主);activate 抛错 = 逆序撤销已记账贡献 + 删占位,半截插件零残留。`Plugin.activate` 签名放宽为可返回 cleanup 函数(插件自有资源:定时器/事件监听),失败回滚与未来热卸载共用同一条撤销通道。kernel 各注册表(settingsRegistry / filePanel / tabs / marketPanel / sidebarActions / fileVisual / shortcuts / homePanels / cliConfigRegistry / cliProfile / mounts,约 11 处)补 remove-by-owner API——本项主要工作量,机械且有界,每处配「注册→摘除→列表归零」单测。
- B2(否)codemoss 全量 Disposer 契约(每个 register 返 Disposer、25 个内置插件全部迁移调用点):与 B1 运行期效果相同,但强迫 25 个从未热卸载的内置插件陪跑迁移;内核记账对插件代码零侵入,内置插件一行不改。
- B3(否)维持现状:激活失败贡献残留是真 bug(本地插件「确认→激活→半途抛错」是主路径),不能不修。
- 运行期热卸载/热重载(本地插件「重启生效」→「对话即变」)明确列为 v2:B1 的记账与 cleanup 是它的 prerequisite,本提案只立地基不承诺行为变更。

### C. 崩溃熔断(quarantine)

- **C1(选定)PluginBoundary 归属计数 + 阈值熔断**:`Mounts.tsx` 的匿名 boundary 升级为 kernel 通用 `PluginBoundary`(props 带 pluginId),并补齐 tab 内容 / 右栏面板 / 设置 section / 首页面板 / 市场面板五类注册表的消费渲染点(实施时定位各渲染点,预计 app-shell 与相应消费插件)。componentDidCatch 按插件计数(会话内累计),阈值 3 次(对齐 codemoss quarantine 阈值先例)触发熔断:runtime 隔离集合 + 该插件全部贡献摘除(复用 B1 的 remove-by-owner)+ 本地插件记录落 error 文案 + 重启前不再晚激活;崩溃事件上事件总线,插件市场页显示熔断徽章。
- C2(否)只补 boundary 不熔断:现状已证明静默隔离不够——用户不知道哪个插件在坏、坏了几个挂点,坏插件的命令/事件通道照常活着;计数 + 摘除才是「外部代码」该有的待遇。
- C3(否)codemoss 式市场审核兜底:tmd-cli 没有市场审核环节,本地插件没有审核者,熔断必须本地闭环。

## What Changes

- **kernel/plugin.ts**:`Plugin.activate` 返回值放宽为 `void | Promise<void> | (() => void)`;注释补权限语义与威胁模型边界。
- **kernel/localPluginLoad.ts**:manifest 校验增 permissions 形状检查(字符串数组、类别枚举);`LOCAL_PLUGIN_API_VERSION` 1→2;逐插件 shim 生成(按 permissions 组装暴露面,替换全局 `installPluginShims` 单例——boot 早期仍一次安装全部实例)。
- **kernel 新文件(权限映射)**:`ipc`/`host`/`settings` 导出 → 权限类别映射表 + wrap 实现 + 穷尽性单测;类别 v1 清单:`ipc.fs.read` / `ipc.fs.write` / `ipc.config` / `ipc.git` / `ipc.terminal`(会话与 PTY,强能力)/ `ipc.net`(quota_fetch 任意 URL,强能力)/ `ipc.sql` / `settings.read` / `settings.write` / `host`(宿主编排门面,强能力)/ `events`。ctx 注册面(register\*/contribute)v1 不设权限(贡献是显式可见的 UI 行为,风险等级低一档),`registerCommand`(键盘捕获)与 `registerCliProfile`(引擎身份冲突面)列 v2 收窄候选。
- **kernel/localPlugins.ts**:扫描记录增 manifestHash;信任闸双绑定;LocalPluginRecord 透出 permissions 供 UI 渲染。
- **kernel/pluginLifecycle.ts**:attributed ctx 记账;activate 失败逆序撤销(cleanup + 贡献);quarantine 计数与隔离集合。
- **kernel 各注册表(约 11 处)**:remove-by-owner API,粒度与各自 add 对齐,单测覆盖摘除归零。
- **kernel/Mounts.tsx + 五类渲染面**:统一 PluginBoundary(带 pluginId)替换/补齐。
- **local-loader 插件市场 UI**:待启用卡片显示权限清单(类别 → 人话文案映射表);熔断徽章与错误文案展示。
- **不做(v2 候选)**:Rust 侧命令级插件身份;运行期热卸载/热重载;权限细化到单命令;内置插件权限声明;runAsPlugin 栈嗅探。

## 验证

- 单测:权限矩阵(无声明 = 纯 UI;逐类别放行/拒发;未归类导出穷尽性报错);manifest 双 hash 信任闸(只改 permissions 也要重新确认);undo 逆序与失败回滚零残留(activate 抛错后各注册表不含该插件任何贡献);熔断阈值触发 + 贡献摘除 + 事件广播;apiVersion=2 拒装旧纪元插件。
- 桩目检:待启用卡片权限清单渲染;无权限插件调 ipc 的错误态;坏组件三次渲染触发熔断 + 徽章;激活失败后注册表归零。
- 全链:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + `pnpm tauri:dev` 真窗目检本地插件全流程(安装→权限展示→确认→激活→崩溃熔断→重启恢复)。
