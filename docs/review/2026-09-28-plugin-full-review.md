# 2026-09-28 插件模块全量评审(边界 / 兼容性 / 性能 / 死代码)

日期:2026-09-28
状态:已完成(全部修复随本记录提交,全闸门绿)

## 背景与目标

对 `src/plugins/` 全部 38 个注册插件(约 9 万行)+ `src/kernel/` 纯度 + `src/mobile/` 契约做一轮全量 code review,四个维度:① 插件边界是否遵循架构铁律(插件间零直接依赖 / cli-shared 准入 / 注册面 / PTY 幕布透传);② 客户端兼容性(Windows 路径形态 / 平台假设 / file URI);③ 性能(轮询 / 无界缓存 / 扫描读放大 / 重渲染);④ 死代码清理。

方法:机械扫描(CI 三闸 + 跨插件 import 穷尽解析脚本 + ts-prune + split('/') 全仓 grep)与四路并行深读 reviewer(cli 引擎十家 / 核心重型六家 / 会话基建十一家 / feature + cli-shared 准入)双轨,每条 finding 经源码核实后修复。

## 方案取舍

**跨插件直连的两处修复路径**:
- `session-relay → composer/serialize`:**选定整模块迁 kernel**(`kernel/profileSend.ts`)。理由:serialize 管线只依赖 kernel 契约(CliProfile.translate/triggers/bracketedPaste + composerExt 发送变换),零插件私有状态;composer 与 session-relay 双消费,属「跨插件基础契约先沉淀进 src/kernel/」。被否决:ref 桥(bridge 适合 UI 触发型跨件调用,纯函数加生命周期交接是无谓间接层);迁 cli-shared(准入判据是 CLI 磁盘/HTTP 格式知识,prompt 翻译管线不是)。
- `files → git/fileHistoryTab`:**选定 ref 开框桥**(`kernel/fileHistoryBridge.ts`,协议同 relayBridge/terminalCopyMenuBridge)。理由:tab kind 与呈现面是 git 插件语义,不可入 kernel;files 只需要「开文件历史 tab」这一能力句柄,activate 交接 + cleanup 回滚 + null 闸是仓库钦定协议,还顺带修正「git 插件停用后 files 仍可开出无渲染 tab」的潜在死态。被否决:整个契约模块迁 kernel(kind 字符串属插件语义);命令注册面(files.showFileHistory 已存在但命令不带参数,无法传 cwd/path)。

**network-proxy / session-budget i18n 欠账**:选定随插件域词典(`locales.ts` + `registerMessages`,session-relay/approval-inbox 同款),校验 hint 在纯函数(budgetCommit/proxyCommit)生产端就地 `t()`。被否决:display 端动态键反查(组合串无法静态枚举词典)。

## 发现与处置(全部已修)

P1(1 项):
- memory-coordinator `MemoryConsole.tsx`:配置 effect 只探 `magic-context.jsonc` 可读性、从不 parse 进 `st.engine`,引擎配置卡(historian/dreamer/sidekick 模型编辑)永久不可达,`saveEngine` 成死代码。修复:effect 改用 `readEngineConfigFile()` 接通。已桩目检:卡片渲染 + sidekick 开关交互闭环。

P2(边界,3 项):
- session-relay `RelayDialog.tsx` import composer serialize(2026-09-26 接力落地时引入,当时评审记「已修」实为直连)→ 迁 `kernel/profileSend.ts`。
- files `index.tsx` + `FileDetailGitSubmenu.tsx` import git `openFileHistoryTab` → `kernel/fileHistoryBridge.ts` 开框桥 + null 闸(桥不在不出菜单项)。
- 全仓穷尽解析(别名 + 相对两种形态)确认除此之外零插件间直连;`plugins/index.ts` 注册表为合法例外。

P2(兼容性,5 项):
- session-board `boardRows.ts`、mobile `MobileApp.tsx`:cwd basename 用 `split('/')`,Windows 盘符路径整串落名 → 统一 `kernel/pathUtils.baseName`。
- checkpoints `BatchFileSection.tsx`:「工作区外」判定 `startsWith('/')` 漏盘符形态(`C:/…` 不以斜杠开头)→ `isOutsideWorkspace`(POSIX 绝对 / `C:/` / `//` UNC;账本契约已归一正斜杠)。
- checkpoints `risk.ts`:高危路径正则只认正斜杠 → 匹配前反斜杠归一。
- lsp `session.ts pathToUri`:盘符路径拼 `file://` 把盘符段落入 host 位 → 盘符形态补三斜杠 `file:///`。
- 残留 `split('/')` 展示层调用(checkpoints BatchRowParts、files WorkspaceFileBrowser 等)受账本/git 路径已归一契约保护,不动。

P2(性能,3 项):
- cli-kimi `kimiSessions.ts`:注释称「只解析最近 N 个」,实现对全树 state.json 先全量并发读后截断 → 先 regex 匹配再按 mtime 倒序截 `KIMI_SCAN_LIMIT` 再读(legacy 分支同),与 cli-codex 先例对齐。
- checkpoints `store.ts`:diffCache 无界(封口批看过即常驻)→ refreshBatches 成功后按权威批 id 差集清理 + 每 cwd LRU 24(访问序挪尾)。
- git `useGitStatus.ts`:5s 轮询无条件 setState,消费链全非 memo,零变更整面板重渲 → 值等守卫(与 files/gitDecorate sameEntries、panelStore setGitAggregate 同纪律)。
- memory-coordinator `autoDistill.ts`:幂等 Set 只增不减 → 超阈值按活会话剪除(保留近期去重窗口)。

P2(健壮性,2 项):
- memory-coordinator `MemoryConsoleCards.tsx writeManual`:`rememberFacts` reject 未接住(unhandled rejection、零 UI 反馈)→ try/catch 落 `distillState` 错误文案。
- cli-omp `marketInstalledRow.tsx toggleEnabled`:spawn 失败 reject 未接住 → catch 落日志行,与 runUninstall 同纪律。

P2(i18n 欠账,存量):network-proxy 与 session-budget 全部裸中文(两插件 0 处 `t()`)→ 补 `t()` + en/ja 域词典(含 budgetCommit 3 条校验 hint、proxyCommit 3 条校验错误,生产端就地翻译)。

文档纠偏(2 项):cli-pi `piRoute.ts`(宣称的 quota.ts re-export 不存在)、cli-omp `quota.ts`(宣称的 Rust `omp_auth_credential` 命令不存在,实为通用 `sqliteQuery` 代读)。

死代码(2 项):cli-opencode `db.ts` 七个纯函数 re-export 仅测试消费(与 dbRows.test.ts 重复)→ 删 re-export,db.test.ts 改直引 `./dbRows`;cli-pi `piRoute.ts` 头注腐句删除。ts-prune 全量跑过:其余候选均为「used in module」误报或类型哨兵(`_itemsCoverAllKeys`)。

cli-shared 头注(2 项):`bashWrites.ts`、`userMessages.ts` 补消费先例声明(准入本身达标,仅声明缺口)。

## 各维度裁定

- **边界**:kernel 纯度过(裸插件 id 仅测试/locale/注释);注册面无绕过(11 插件入口逐一核);PTY 幕布透传无违例(幕布唯一实现在 kernel/TerminalView);src/mobile 只 import 声明的适配器模块与 @kernel;wsl 三注册表走 ctx 与 09 契约吻合。
- **cli-shared 准入**:全模块过审——≥2 cli-* 或 1 cli-* + feature 或 ≥3 家族 + 2 feature(sessionUsage 按第三条合规:omp/pi + claude + codex 行型知识,session-search + welcome 双 feature 消费,头注已声明);qoder 双分发同族变体视同满足。
- **性能先例核对**:轮询全有 cleanup(SshPanel 15s / RemoteControlBadge 10s / approval-inbox 1.5s+1s);缓存有界(fileCache 32MB LRU、diskSessions FIFO 8192+mtime、welcome SWR 5min TTL、marks 墓碑);omp prewarm 计时器全清 + epoch 守卫 + 2MB 缓冲上限。
- **已知残留(接受)**:files `WorkspaceFileBrowser.tsx` base.split 兜底(有 workspaceDisplayName 遮蔽,纯外观);UNC 路径落盘形态未实证(04 契约既有边界);build 警告 INEFFECTIVE_DYNAMIC_IMPORT(FileCodeEditor 被 cli-config 静态 import 使 files/ssh 动态分块失效,改静态需另一轮目检,暂挂)。

## 验证

- `pnpm typecheck` / `pnpm test`(371 文件 3011 用例)/ `pnpm check:arch-boundary` / `pnpm check:file-size` / `pnpm build` 全绿;`npx react-doctor -y` 100/100。
- 跨插件 import 穷尽解析脚本复跑:仅剩 `plugins/index.ts` 注册表引用。
- 桩目检(1421 dev + `__TAURI_INTERNALS__` 注入):Memory 控制台引擎配置卡渲染、sidekick 开关点击状态翻转(configHint 无错误)。
