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

## 第二轮(2026-09-28 同日,正确性 / 竞态 / 生命周期角度)

大仙要求换角度重审且更谨慎:五路深读(会话发送链 / git-checkpoints-files 数据流 / memory 基建 / cli 引擎并发 / src-tauri Rust),纪律 = 整文件通读 + 完整调用链证据 + CONFIRMED/SUSPECTED 分级 + 对第一轮修复逐 hunk 回归判定。第一轮全部修复回归判定 SAFE;但 diffCache 差集清理抓出**第一轮我方修复自身的回归**(见下)。

### CONFIRMED 已修(12 项)

发送链(composer / session-relay):
- **F1(P1)**:`executeSend` 执行段重读活跃指针 —— 确认弹层展示目标 A,弹层在屏期间 Ctrl+Tab 切幕布/计划会话退出改活跃指针后,内容写进 B 且用旧闭包 profile 翻译。修:`SendTarget` 增 `id`,单发执行绑定计划目标、profile 按目标现取;广播维持「执行期重解析」既有设计。
- **F2(P2)**:settle 先清挂起态再回调执行,writeSession 在途窗内第三记 Enter 可重复弹确认、把同一题面写两遍。修:执行窗并入模态闸(`setSendExecuting`,`isConfirmPending = confirmPending || executing`,卸载复位同步)。
- **F3(P2)**:抽屉发送挂起确认框时按 Esc,CommandDrawer 的 document 监听把抽屉一并关掉,违背「Esc=''静默不关抽屉」契约。修:确认挂起/执行中抽屉 Esc 让位。
- **F4(P2)**:relay `createdRef` 不随目标引擎失效 —— 首轮失败后换引擎重试,摘要写进旧引擎会话(或对死会话永久失败)。修:`targetId` 变更即失效复用。
- **F5(P2)**:接力首发不广播 promptSent → 新会话首轮在 checkpoint 账本无锚点(首批变更并入下一轮或整轮不可见)、tab 首条标题保底缺失。修:`promptGate` 下沉 kernel(composer 三路 + relay 四路消费,避免再造跨件直连),relay 写前读闸、成功后广播。

checkpoints:
- **回归(我方第一轮修复引入,P1)**:diffCache 按 cwd 键控但批清单按会话拉取 —— 同工作区切会话后,他会话已封口批的审阅单被差集清理摘缓存且不再重拉,永久卡「生成批 diff…」。修:diffCache 与 byKey 同键(`${cwd}|${sessionId}`),prune 只作用同会话;四个动作函数补 sessionId 参数。
- **CKPT-3(P2)**:磁盘事件 4s 轮询在 activate 顶层注册且不入账 —— 熔断摘除后轮询继续不可见写账本。修:interval 句柄入 activate 返回的 cleanup。
- **CKPT-2(P2)**:审阅单「通过」无 catch(时间线侧同动作有 notice)→ unhandled rejection 且零反馈;「回退」静默 catch 同病。修:就地错误横幅。
- **F-CKPT-001(P1,数据丢失,Rust)**:undo_revert 单槽 guard_id 被最后一次部分回退覆盖,反悔时对不在最后 guard 内的已退路径按「不可恢复」**整删用户文件**(既有测试只断言 state、未查文件,把 bug 钉成契约)。修:`guard_ids` 追加链(serde default 兼容旧 states),反悔按路径取最近覆盖者;孤儿路径保留记账不动盘;测试补文件内容断言。
- **F-CKPT-002(P2,Rust)**:账本追加 = 条目与换行两次 write_all(杀进程缝隙产生粘行)+ read_to_string 全有或全无(中文撕裂字节毒化整本账)。修:单缓冲单次写;按字节切行逐行 UTF-8 容错。
- **F-CKPT-003(P2,Rust)**:seal_stale_foreign 注释称「单条失败不阻断」而 `?` 上抛炸掉整次 anchor_turn。修:单条失败记日志继续。

Rust 其余:
- **F-PTY-001(P2)**:`PtyRegistry::kill` 持全局注册表锁跨 `child.wait()` —— 慢死子进程冻结全部会话写/resize/spawn/退出清理。修:锁域收窄到注册表摘除(同 emitter 清理纪律)。
- **F-WEB-002(P1,Windows 全量失效)**:`/file read_scoped_file` 单侧 canonicalize,verbatim `\\?\` 前缀与非 verbatim home 比较恒 false → fail-closed 全 404。修:home 同基准 canonicalize(fs_remove 双侧先例)。
- **F-GIT-001(P2,Windows)**:`rebase_porcelain_paths` 的 verbatim 形态与 porcelain 正斜杠盘符形态永不匹配,函数在 Windows 恒 no-op → worktree 匹配/高亮错乱。修:`normalize_windows_shape` 归一比较(去 verbatim 前缀 + 斜杠归一 + 小写;非 Windows 形态恒等),纯函数单测。
- 引擎侧:**F1(P1)** dsh `ensureAdapterDeployed` 记忆化 rejected Promise —— 一次瞬时落盘失败运行期全灭 → 失败清 memo 可重试;**F4(P1)** omp `spawnPrewarm` 不查 `started` —— 停用瞬间在途 acquire 的 catch 重新排队,停用态仍拉起 ~800MB 预热进程 → 补 started 闸;**F5** QuotaChip 抓取无请求序守卫,被取代请求提前复位 loading/fetchedAt → seq 守卫;**F6** kimi `wirePathById` 拷贝-整体替换跨 await 丢更新(注释断言相反)→ 逐条 set 直写并修正注释;**F2** piFamily 远程列目录全量 32KB 头传输后才截 50 → shell 侧 `ls -t | head -n 50` 先截后传;**F7** dsh plugin.tsx 头注描述不存在的 index.tsx → 纠偏。

memory 基建:
- **MC1/P2**:「沉淀所选会话」异步链无 catch(spawn 失败 = 状态永久「提炼中…」)→ 补 catch。
- **MC2/P2**:`writeManual` 检查结果前清空输入(ok=false 丢用户原文)→ 成功才清。
- **MC3/MC4/P2**:MemoryConsole 与右栏面板 `reload` 均无完成守卫也无 catch —— 工作区切换竞态把旧工作区数据盖进新视图、recall 被锁 reject 成 unhandled rejection。修:epoch 守卫 + try/catch 保留上次数据。
- **MC5/P2**:session-search 索引器把「读取失败」按成功缓存(瞬态锁文件 → 该会话正文永久为空)→ 失败不写缓存。
- **MC6/P2**:InstallCard 对 opencode 检测/安装只硬编码 `opencode.jsonc`,与 paths.ts 四候选及预检三面分裂(检测假阴性 + 可能另立平行配置)→ 检测走 `isOpencodeMagicContextInstalled`、落点走新增 `resolveOpencodeConfigPath()`(候选首个存在者);孤化的 `detectOpencodeInstalled` 删除。
- **MC7/P2**:ProxyPopover 注释断言「打开即重挂载」与事实相反(overlay 常驻渲染),草稿/错误跨开合残留且不跟随外部修改 → open 翻真重置。
- **MC9/P2**:`resolveProjectIdentity` 负缓存永不失效(先以非 git 态看过,之后 git init 也永久「未纳入」)→ null 缓存 60s TTL。
- **MC10/P2**:DistillSettingsCard 模型列表 effect 无失效守卫(慢引擎迟到列表与当前引擎错配)→ cancelled 守卫。

### 记录不动(3 项)

- **F-WEB-001(P1)**:设备域 `config_read_settings` 剥密钥只剥顶层键,`relayDeployHistory[].password` 与 `ssh.hosts[].password` 明文出桥到手机 —— 这是 2026-09-25 拍板契约(43d847a:部署历史随存明文、手机 dispatch 本就全量可读),**维持现状**;conn.rs 剥键注释与 relay_selfhost_persist 头注的表述矛盾留待文档对码。
- **MC8(SUSPECTED)**:settings `load()`(settings:changed 回读)与在途 persist 链交错可能回退未落盘编辑 —— 需按评审给出的单测实验证实后再动。
- **F-FS-001(SUSPECTED)**:Rust `collect_files` 无遍历上限 —— 现无现实触发路径(消费方后缀恒 .jsonl),留观察。

### 第二轮验证

`pnpm typecheck` / `pnpm test`(371 文件 3011 用例)/ arch / file-size / build / react-doctor 100;`cargo test` 311(含 F-CKPT-001 回归锚点:反悔后两文件断言批后像内容)、clippy -D warnings、fmt --check 全绿。

## 验证(第一轮)

`pnpm typecheck` / `pnpm test`(371 文件 3011 用例)/ `pnpm check:arch-boundary` / `pnpm check:file-size` / `pnpm build` 全绿;`npx react-doctor -y` 100/100。
跨插件 import 穷尽解析脚本复跑:仅剩 `plugins/index.ts` 注册表引用。
桩目检(1421 dev + `__TAURI_INTERNALS__` 注入):Memory 控制台引擎配置卡渲染、sidekick 开关点击状态翻转(configHint 无错误)。
