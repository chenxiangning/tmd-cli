# 2026-09-04 插件边界审计 + 死代码清理

> 日期:2026-09-04 | 状态:已完成,全量验证通过(typecheck / test 728 / arch-boundary / file-size / build / tauri:dev 冒烟)

## 结论

四条 CI 铁则(R1/R3/R4/500 行)基线全绿的前提下,语义层审计出 7 项边界泄露、4 项重复、5 项半成品。
本次落地 4 组修复:**A1 内核 CLI 私有格式下沉**(落实 09-02 评审 F7)、**B1 外壳面板 id 硬编码改注册声明**、
**C1/C2 四家 edits 尾窗骨架收敛**、**死代码 2 处删除 + 88 处零引用导出降级**;
其余 10 项判定为既定惯例 / 产品半成品 / 收益不足,记录在案不动代码。

## 审计方法

- CI 基线:`pnpm check:arch-boundary && pnpm check:file-size`(通过)。
- import 图脚本:全量解析 `src/**/*.{ts,tsx}` 的模块边,输出跨插件边 / 层间统计 / 孤儿文件(修复解析 bug 后:文件级孤儿仅 `vite-env.d.ts`,属正常全局类型)。
- 符号级脚本:收集全部命名导出,剔除注释/字符串后统计跨文件引用,再区分「同文件内部用(=仅 export 冗余)」与「全仓零引用(=死代码)」。
- 语义审查(scout):逐插件 @kernel 导入底账、app-shell 硬编码扫描、TODO/FIXME 全量扫描(零命中,唯一 `XXX` 是错误码正则)。

## 已修复

### A1 `kernel/diskSessions.ts` 整体迁 `plugins/cli-shared/diskSessions.ts`(落实 09-02 F7)

`extractJsonlTitle` 内含 omp `type:"title"` / omp-pi `type:"session"` 行内 title / claude `type:"summary"` / codex
`type:"response_item"` 四家私有行型,`isInstructionWrapper` 硬编码 codex `# AGENTS.md instructions` 包装 ——
违反「内核不理解任何 CLI 私有格式」。因 R1(kernel ↛ plugins)导致 `scanJsonlSessions` 无法留内核,整文件迁移。
消费方 7 处 import 更新:cli-claude / cli-codex / cli-omp / cli-pi / cli-shared/qoderSessions / workspace/PinnedSessions(+测试)。
workspace 侧加依赖合法性声明注释(同 welcome/credentials.ts 既有声明:「无生命周期格式库是插件零直接依赖铁律下的合法通道」)。

### B1 `RightPanelToolbar` 面板 id 硬编码 → 面板注册自声明

原 `if (mode === "git" || mode === "checkpoints" || mode === "ssh") return null` 直接违背
filePanel.ts「外壳不认识任何业务面板」声明。改为 `FilePanelContribution.showFileSubbar?: boolean`(缺省 true),
git / checkpoints / ssh 三插件注册处声明 `false` 并注明各自摘要行职责,外壳读注册表。
顺手修正同文件「兼容旧调用 ─ 内部用」误导注释(D3):RightPanelToolbar 是 AppShell 唯一活渲染入口。

### C1/C2 四家 `readSessionEdits` 尾窗骨架收敛 `cli-shared/sessionEdits.ts`

omp/pi/codex/grok 的 parse 循环(行预筛 → JSON.parse 容错 → editEventsOf → 水位线过滤)逐行同构,
仅预筛特征(`startsWith('{"type":"message"')` / `response_item` / grok `includes(sessionUpdate:tool_call)`)
与事件抽取私有。下沉 `parseEditEventsFromText`(谓词参数化)+ `readEditsTail`(path null → [] /
读失败 → null 契约)+ `EDITS_TAIL_BYTES`(2MB 预算四处各抄一份)。各家 `parse*EditEvents` 保留为
命名测试接缝。grok 的「读失败也返回 []」语义刻意不同(不卡水位线),不经 `readEditsTail`,
注释已写明差异理由。

### 死代码与 export 冗余

- 删真死代码 2 处:`kernel/sessionTitles.ts#getSessionTitle`(全仓零引用,`setSessionTitle` 仍在用)、
  `plugins/files/markdown/markdownMath.ts#getCachedKatex`(getter 无人调)。
- 88 处零外部引用的命名导出去 `export` 降级为模块内可见(kernel 22 / plugins+app-shell 66;
  复核二遍补降 `markdownImages.resolveLocalImagePath` 与 `markdownMath.unwrapLatexDelimiters`
  两处首轮漏网 —— 二者仅在别处注释中被提及,宽松审计误报为已引用)。
  `kernel/ipc.ts` 的 8 个契约类型例外保留(IPC 跨进程契约的声明性导出,Rust 侧对应)。
  降级后公共 API 面与真实消费面一致,读者不再需要判断「哪些 export 是活的」。
- `welcome/credentials.ts` 重复的 omp 分节注释合并。

## 记录在案、不动代码(判定理由)

| 项 | 现象 | 理由 |
|---|---|---|
| A2 | `composer/cliProfiles.contract.test.ts` import 6 个兄弟 cli-* 导出 | 仅测试文件;测的正是「composer 容器契约 × 全部 CLI profile」交叉矩阵,跨插件 fixture 是契约测试的合理形态;运行时零依赖(经 kernel CliProfile 注册表) |
| A3 | welcome 经 cli-shared 消费 codex rollout / grok config 解析 | credentials.ts 头部已有架构声明;引擎凭据盘点是 CLI 私有格式的合法聚合视角 |
| A4 | cli-omp / cli-pi 的 quota 读 `~/.codex` rollout 快照 | 业务事实:omp/pi 路由 openai-codex 后端,额度快照真源在 codex 侧;已在 cli-shared 共享 |
| A5 | `kernel/settings.ts` 的 `networkProxyEnabled/Url` 只服务 network-proxy 插件 | 迁出需插件级独立设置存储(新持久化通道),属设计变更非清理;对照 ssh 主机簿在 kernel 有一等概念背书。列架构债,待 settings 插件化提案 |
| A6 | Composer.tsx 识别 `/commit` 前缀 + 字面量 `git://composer-prefill` | 事件总线字符串契约是既定惯例(常量真源 git/gitEvents.ts);composer import git 常量反而制造 plugin→plugin 依赖。列观察项:若未来出现第二个跨插件命令,应升级为「composer 命令拦截」挂点 |
| B2 | SidebarSettingsCluster 硬编码 network-proxy topic / `DEFAULT_PINNED` 焊死入口 | 与 D1 占位动作同区,侧栏设置簇整体是半成品聚合层;动它属产品行为变更 |
| B3 | AppShell 按 `kind === "ssh"` 抑制 composer | kind 来自 kernel SessionMeta(内核一等会话类型),非插件 id;「ssh 会话无 composer」产品策略硬编码在外壳,记录待会话能力声明机制 |
| C3 | 三家 configStatus IO 薄壳(4-7 行) | 各含路径定位与解析容错的实质差异(yml/json/toml),下沉是纯搬运+间接层,拒绝无谓抽象 |
| D1/D2 | SidebarSettingsCluster 3 个占位动作 + RightPanelToolbar 1 个占位按钮(console.info) | 有意的演示态(文件头注释自陈);删除即 UI 行为变更,不属清理范畴 |

## 验证

- `pnpm typecheck` / `pnpm test`(83 文件 728 用例)/ `pnpm check:arch-boundary` / `pnpm check:file-size` / `pnpm build` 全绿。
- `pnpm tauri:dev` 冒烟:窗口进程启动稳定运行无 panic(B1 渲染路径变更逻辑等价,由测试与 typecheck 守护)。
- Rust 侧 `cargo clippy --all-targets` 零警告(无 dead_code)。
- CSS 30 个样式文件全部有引用;npm 依赖零死项(0 引用者均为工具链依赖)。
