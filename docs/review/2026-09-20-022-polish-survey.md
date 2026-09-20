# 0.2.2 打磨期全量功能体检(复核定稿)

- 日期:2026-09-20(v2 复核定稿,取代同日初版)
- 状态:已定稿(每条经主会话逐行实读复核至 Rust 层;P1 建议即刻修)
- 方法:初版为 8 路侦察初审;本版对全部 claim 逐条亲读源码复核(前端 → ipc 契约 → Rust 实现全链),i18n 为自写脚本全库普查(去重 1589 个 t() 字面量键)。凡本版保留的条目,行号与语义均以实读为准。

## 与初版的差异(修正记录)

- **删 1 条误报**:「closeSearch 不清 SearchAddon 高亮」——terminalSearch.tsx:32/37 的 findNext 均未传 decorations 配置,xterm 搜索本就无持久高亮,不存在残留。反向新增一条真实观察:终端搜索命中无高亮(仅滚动定位),见 §四。
- **BranchView 条目更正**:初版称「该路径无 busy 横幅」不实——BranchView.tsx:246 有 GitOpBanner(busy/error/notice 齐)。真问题是:①成功文案无条件、②错误处置无 isAuth 幕布引导(与对话框路径双轨)。降 P3。
- **REMOTE_TIMEOUT 降 P3**:超时路径 kill+wait 收尸完备(remote_ops.rs:195-196),仅 300s 上限策略与「检查网络」归因文案问题,无数据风险。
- **i18n 计数校准**:精确普查 en 缺 382 / ja 缺 383(字面量口径);域分布 welcome 63 / wallpaper 57 / wsl 49 / cli-omp 49 / web-access 42 / cli-config 24 / settings 15 / cli-shared 15 / git 12 / files 9 / kernel 8 / workspace 7。omp 校验文案实为 7 条(modelsConfig.ts:179-192)。
- **fs.rs ext 白名单条目改口径**:实测 ext 含分隔符时(如 name "a./x" → ext "/x")写入因父目录不存在而失败,是「上传失败」而非路径逃逸;仍值得白名单化,降 P3。
- **行号校准 11 处**:Composer.tsx:51(非 50)、sendTransform.ts:52(非 49-54)、terminalSearch.tsx:30-33(非 34-37)、terminalCopyMenu.tsx:77(非 81)、updateCheck.ts:46-56(非 41-43)、SidebarSettingsCluster.tsx:9,14(非 13,20)、sessionStartFail.ts:50(非 44)、askSound.ts:56(准确)、host.ts:268(准确)、marks/store.ts:155-158+165-183(非 131-140/166-178)、edits.ts:67-75(准确,另发现 :73 取首个匹配而非最新)。
- 其余条目全部复核通过,证据链补齐至 Rust 层。

## 一、P1(消息丢失面)

### 1. composer/marks 发送链路 fire-and-forget 吞错

- 全链实证:`host.ts:201-204` writeSession 内 `void ipc.sessionWrite(...)` 弃掉 Promise;`ipc.ts:340-341` invoke 返回 `Result<(), String>` 的 Promise;`session_commands.rs:65-78` Rust 侧会话不存在/PTY 写失败时返回 Err → Promise reject——但无人接。
- 后果:会话已死/PTY 断时,单路发送(useComposerSend.ts:74-86)照样 `setValue("")` 清草稿、清附件;marks 变换在发送时乐观翻 sent(sendTransform.ts:52 `setMarkState(cwd, mark.id, "sent")`);题面入史。消息实际未送达,零提示。广播模式(useComposerSend.ts:48-72)逐路同款吞错,部分目标已死时该路静默丢,无「M 路中 M' 路失败」可见性。
- 修法:writeSession 返回 `Promise<boolean>`(或 composer 层直接 await sessionWrite);失败保草稿、回滚 sent 翻转、广播汇总失败目标名单。一处修,单路/广播/抽屉三消费方全收口。

## 二、P2(按建议顺序)

### 2. 非原子写簇(一个原语修全库)

- 已核实现成模式:`session.rs:121-125` write_json_atomic(tmp+rename),settings/workspaces/known_hosts 已走它。
- 六个未接点(全部 `fs::write` 直接覆写,写中途崩溃/掉电截半文件):
  - `fs_edit.rs:55` write_file——编辑器保存 + 全部 CLI 配置 GUI 写回通道(claude/codex/omp/pi/grok settings、channelApply、providerChannels、cli-config io)
  - `checkpoints/store.rs:168` rewrite_ledger(prune/身份回填通道)——账本重写截断 = 全部批次历史不可逆丢失
  - `checkpoints/store.rs:185` save_states——已回退/已通过标记丢失,已回退文件 UI 上可再操作
  - `checkpoints/apply.rs:184` / `restore.rs:228` / `review.rs:78`——checkpoints 写回用户代码文件
- 修法:泛化 write_json_atomic 为 write_atomic 接入六点。
- 附带 P3:`fs.rs:54-63` write_temp_file 的 ext 未过滤分隔符(name 含 "a./x" 类形态时拼出带 "/" 的文件名,写入失败而非逃逸,白名单化即可);`store.rs:20-22` LEDGER_LOCK 仅进程内,注释「跨进程天然安全」只对 append 成立,双实例并发 rewrite 与 append 交错会吞行(rewrite 前文件锁,或 prune 走 append 补偿)。

### 3. PTY 子进程只杀不等候(僵尸累积)+ 秒退 handle 泄漏

- 全库 grep 实证:lsp.rs:75/134、proc_run.rs:166、wsl.rs:84/89、git/pr_gh.rs:42、git/remote_ops.rs:196、resolve/mod.rs:59 均有 try_wait/wait 收尸;PTY 路径零收尸——`pty.rs:132`(kill 只 child.kill())、`pty.rs:140`(kill_all)、`pty_spawn.rs:238`(emitter 退出清理同样只 kill)。每个退出的终端会话留僵尸进程直到 App 退出。
- 时序缺陷:`pty_spawn.rs:191` 泵线程先启动、`:248-256` registry 插入在后——子进程秒退时 emitter 清理(:237 remove)跑在插入之前,死亡 handle 永久滞留 sessions 表(master fd 泄漏)。
- 修法:三处 kill 后补 try_wait/wait;spawn 先插 registry 再起泵。

### 4. 搜索完整性:walk 无截断标志 + 失败伪装空结果

- `fs_walk.rs:30` 返回裸 Vec<String>,`:53-54` cap 满额与 3s 预算耗尽同形静默 break,消费方无从区分完整/部分。
- QuickOpen:`QuickOpen.tsx:16` WALK_CAP=5000 索引截断无提示——`:178` 注释自认「walk 5000 / 展示 50 双闸,被截掉的文件静默不可达是误导(P3 评审项)」,`:179-183` 现有提示只盖 SHOW_LIMIT=50 展示闸。(硬错误有独立 error 态,:140-143,这点初版没说清。)
- wsfb 搜索:`WorkspaceFileBrowser.tsx:103-113` truncated 仅判 `paths.length >= SEARCH_WALK_CAP(4000)`(:107),时间预算臂不置标志;reject 分支 `setHits([])`(:109-113)把「目录不可读/被删」伪装成「没有匹配的文件」。
- 修法:walk_files 返回 `{files, truncated}`(镜像 fs_search.rs FsSearchResult 契约),两消费方按标志提示;wsfb reject 设独立 error 态。
- 附带:`useDirTree.ts:88-90` 懒展开 toggle 的 .then 无竞态守卫(快速折叠后在途结果仍写回)且无 .catch——同文件 revealDir(:64-70)有 catch,toggle 路径漏了,修法照抄。

### 5. settings 写盘失败静默降级,Tauri 下重启即丢

- `settings.ts:183-203` persistNow 的 catch 降级写 localStorage(注释自认「浏览器 dev」用途);`load()`(:205-215)只在 configReadSettings 抛错时才读 localStorage。
- 精确触发条件:写盘失败但盘上旧文件仍可读(磁盘满/杀软锁 tmp 等)——Rust 侧 settings 写是原子的,旧文件完好 → 重启读旧值,localStorage 兜底永远不生效,用户改动无感知丢失。
- 修法:Tauri 环境写盘失败向 UI 发通知;localStorage 兜底仅浏览器 dev。

### 6. git「全文查看」对全仓已改文件构全文 diff

- `diff.rs:84-103` build_diff:full=true 时 `context_lines(u32::MAX)`(:92)作用于整个 diff(无 pathspec 收窄,含 untracked 内容),之后 file_patch_from_diff(:41,:69)才按 idx 取单文件 patch——点开单文件「全文查看」= 全仓所有已改文件的全文 patch 先在内存生成。
- 修法:full 态仅对目标 delta 二次 diff(pathspec 或对该 delta 单独 Patch)。

### 7. dsh 停止链可卡死「正在停止…」

- `dshHost.ts:216-221` terminateLocalListenerUnix 的 lsof procCommunicate 无 .catch(lsof 缺席的最小化 Linux/探针超时即 reject;同函数 :236 的 KILL 倒是有 catch);`hostPanel.tsx:115-124` onStop / `:127-134` onCancelStart 对 stopHostSession 无 try/catch——reject 后 `setPending(null)` 永不执行,面板卡死不再 refresh。
- 修法:lsof 扫描补 .catch(→ 跳过),hostPanel 两处 await 包 try/catch 落 error。

### 8. i18n 缺键(精确普查)

- 口径:src 下 1589 个去重 t() 字面量键;en 词典 1443 键、缺 382;ja 缺 383。底稿 `openspec/changes/2026-09-20-022-polish/i18n-audit.txt`(每条带 MISS-EN/MISS-JA 标记 + 文件定位)。
- 分布:welcome 63 / wallpaper 57 / wsl 49 / cli-omp 49 / web-access 42 / cli-config 24 / settings 15 / cli-shared 15 / git 12 / files 9 / kernel 8 / workspace 7 / assets 5 / cli-pi 4 / 其余零散。
- 另:参数化键(t(composed) 形态)不在字面量口径内,git 域参数化文案需人工抽查。
- `modelsConfig.ts:179-192` validateProviderInput 7 条校验文案 throw 硬编码中文不走 t(),同批处理。

## 三、P2 体验(用户习惯)

### 9. composer 草稿零持久化

- `Composer.tsx:51` `useState("")`,刷新/重启丢整段输入(含拖入附件注入的 @path token)。修:按 workspace 存 localStorage,挂载恢复、发送清除。

### 10. 触发符误弹:URL/双斜杠路径劫持 Enter

- `serialize.ts:33` 激活守卫只挡「前一字符是 \w」:`https://x` 的最后一个 `/` 前是 `/`、`src//x` 同理,照弹命令下拉;`composerTextareaKeys.ts:47-52` 下拉激活时 Enter/Tab 被 applyPick 拦截替换文本——输 URL 按 Enter 会误改文本而非发送。
- 修:前一字符为触发符自身或 `://` 时不激活;或 `/` 触发仅行首/空白后生效。

### 11. staged 标记跨会话复活静默注入

- `store.ts:155-158` isMark 收 staged/sent 态随 sidecar 持久化;`:165-183` loadAllMarks 原样并入。隔天重启「已入对话」芯片原样复活,下一次自然语言发送把陈旧引用块静默注入并翻 sent。
- 修:loadAllMarks 时 staged 回滚 pending(或跨会话恢复的 staged 加醒目标识)。

## 四、P3 池(逐条复核通过)

git:
- 成功文案无条件 + auth 无引导:`BranchView.tsx:189-200` 分支右键 pull/fetch 成功提示恒「已更新/已获取」,up-to-date 同样报——`commands.rs:244-259` git_pull_push 返回 String(combined output)非 report,快速路径无从知道 up_to_date;`BranchView.tsx:83` 错误只走 gitErrorDisplay,无 isAuth「去幕布终端」引导(对话框路径 useGitPanelRemote.ts:50-54 有,双轨)。修:快速路径复用 git_remote_request 或返回体带 report;错误统一 isAuth 分流。
- REMOTE_TIMEOUT 策略:`remote_ops.rs:27` 300s 上限,`:194-201` 超时 kill+wait 收尸完备,唯文案「请检查网络/远端后重试」把超时归因网络;大仓慢上行 push 易触顶被中止。修:传输型放宽/可配,文案区分「超时中止(非网络故障)」。
- pull 明细含既有暂存:`remote_report.rs:72` ponytail 注释自认——HEAD 不动时 diff HEAD→index 把用户既有暂存计入「拉取成功:N 个文件变更」。修:对比 pull 前后 index oid 排除。
- fetch 明细不含 tags:`remote_report.rs:31-39` 快照仅 refs/remotes/**,自动跟随的 tag 更新不计入,报「已是最新」但 refs 已动。
- unborn 分支拉/推可点:`status.rs:4-5,:33-35` unborn 时 branch 名正常返回、head_sha 空;`useGitPanelData.ts:109` detached 判定只看分支名前缀 → unborn 算非 detached;`GitToolbarRemoteRows.tsx:66,80,96` 拉推行仅 detached 禁用 → 空仓库首提交前可点,回裸英文 fatal。修:head_sha 空同样禁用 + 「先创建首个提交」。
- 冲突文案双轨:`remote_ops.rs:103-147` divergent+rebase 冲突有完整中文处置(abort 恢复+幕布引导),但对话框显式策略 pull 冲突、合并/变基菜单冲突透传原始英文 CONFLICT stderr。修:from_shell_output 识别 CONFLICT/中间态统一中文引导。
- 失败通知全文刷屏:`remote_ops.rs:209-219` combined stdout+stderr 未截断进错误 → GitPanelMain 横幅全文渲染。修:取 stderr 尾 ~500 字符,全文留 hover。

会话生命:
- 屏幕态自愈不对称:`askWatchCore.ts:139-144` !present 时无条件连字节通道 waiting 一并摘除,整帧重绘瞬时采样闪摘真等待标签,复检需 ≥1.2s。修:!present 时若字节尾巴页脚窗仍含标记则保留。
- 20s 窗外崩溃零呈现:`sessionStartFail.ts:50` `Date.now() - adoptedAt > START_FAIL_WINDOW_MS` 直接 return——慢启动 CLI(冷启 10-25s)崩溃时 pty://exit 秒删 tab + removeSession 清缓冲,崩溃原因销毁,无任何通知。修:窗外退出且 outputTail 非空降级普通退出通知。
- 删除墓碑容量 200:`sessionDeleted.ts:23` 用 makeOverlay 默认容量(overlayEvict.ts:22;:21 注释明说「实例化处单独提容」但这里没提)——删盘失败路径靠墓碑防复活,累计 200 次删除后最旧逐出,删失败会话重扫复活成幽灵行。修:对齐 sessionArchive 提容 2000。
- 注释过期:`sessionArchive.ts:22-24` 注释仍写「200 上限 ~10 天触顶逐出」而常量已 2000(标着双源同步的不变量旁)。
- 活跃指针兜底非 MRU:`host.ts:268` removeSession 取 `this.sessions[0]`(注册表序),当前会话退出/被删后用户被拽到任意首个会话。修:改查 sessionTabs MRU 序(与 closeSessionTab 同语义)。

终端/壳层:
- 提示音无音量档:`askSound.ts:56` `audio.volume = 1` 硬编码,设置只有开关+音效选择,嫌吵只能静音。修:settings 加 soundVolume。
- 搜索框不过 IME:`terminalSearch.tsx:30-33` onChange 逐字符触发 findNext,拼音组合中途跳选剧烈。修:isComposing 跳过。
- 终端搜索命中无高亮:findNext(terminalSearch.tsx:32,37-40)未传 decorations 配置,xterm 搜索仅滚动定位、无任何命中高亮(初版「关闭残留高亮」为此误报的反面)。修:传 decorations(matchOverviewRuler + activeMatchColorUnderline),closeSearch 时 clearDecorations。
- 复制失败静默:`terminalCopyMenu.tsx:77` `.catch(() => {})`,词典已有「剪贴板写入失败」词条未用。
- 引擎卡版本查询失败无痕:`EngineCard.tsx:82-83` 类型注释自认「null=查询失败(不渲染)」——行内零痕迹零重试,只点开版本菜单才见。
- rc 装机恒不提示新版:`updateCheck.ts:46-56` extractSemver 严格三元组,current 带 -rc 后缀 → null → isNewerVersion 恒 false。修:current 剥预发布后缀再比。
- 头注释过期:`SidebarSettingsCluster.tsx:9,14` 仍写底栏示意 v0.1.4 / 「浏览器 dev 回退 "0.1.4"」,实际已改 CHANGELOG 首条回落。

marks/composer:
- 变换先于轮次闸:`useComposerSend.ts:76-81` payload(含 marks 注入+翻 sent)在 readPromptGate 之前构建,ask 确认期自然语言作答也注入 staged 引用块并翻 sent,与闸语义不一致。修:transform 过 shouldBroadcastPrompt 同款判定。
- Enter 的 WKWebView 兜底:`enterAction.ts:26` 只查 isComposing;部分 WKWebView 在 compositionend 后派发确认 Enter 且 isComposing=false[平台差异,推断]。修:keyCode 229 或 compositionend 短窗兜底。
- 抽屉发送不注入 staged:`useComposerDrawer.ts:71-74` 注释自认与手动发送同路径但「零拦截」——staged 芯片挂着的场景,抽屉发命令后用户误以为引用随行带出。修:提示「仍待注入」或提供一并注入。
- 悬空标记:relocatePath 唯一调用面 editorExtension.ts:160(编辑器文档变更),文件删除/改名后 pending 标记永不重定位,面板持续显示旧行号;「定位」对已删文件静默失败。修:面板打开/发送前查路径存在性,失存标 lost。

files/cli:
- open_with command 直启:`open_with.rs:41-46` `Command::new(&target.command)` 不经 shell,command 填 "code --wait" 类含空格串必败(argv 的 args 字段才是参数位);设置面板无「参数请填 args」提示。
- codex rollout 定位双缺陷:`edits.ts:67-75` 缓存永久有效 + `:73` `files.find(...includes(id))` 取首个匹配而非最新——同 id 新 rollout 出现后 edits 永久读旧文件漏事件(sessionStatus 侧有 revalidateMs 特设处理)。
- QuickOpen walk 无缓存:每次开浮层全量 walk(慢盘 ≤3s),低优,大仓有感再做(root+mtime 缓存)。

## 五、已核实为良好(复核确认,勿重复排查)

- 壳层:tab 关闭无数据丢失(编辑草稿按路径持久;会话 tab × 只摘 tab 不杀 PTY)、滚动保持(keep-alive)、CJK 宽字符链接列映射、字号/缩放持久即时生效、快捷键注册表结构性同源、底栏「有新版」已恢复。
- 适配器:坏 JSON/截断尾行全路径降级不炸列表;超大单行有界窗口;prewarm 护栏齐备;配额失败显式(snapshot.error 红字)。
- Rust 纪律:IPC 路径 unwrap 近零;fs 命令全量 spawn_blocking + 3s 预算;settings/workspaces/known_hosts 原子写;checkpoints append 半行损坏容忍 + 归属窗口有测试钉;PTY 退出清理链(日志/注册表/reload 兜底)完备——唯独缺收尸,见 §二.3。
- QuickOpen 硬错误有独立 error 态(QuickOpen.tsx:140-143);wsfb 搜索有防抖 + alive 取消守卫(WorkspaceFileBrowser.tsx:101,116-119)。
- 已修欠账(复核确认):「结果可能不完整:文件数超过扫描上限」已入 en/ja(不在缺键清单);listModels 失败不进缓存;mdCommands 目录名派生;配额显错链;分支右键 busy 横幅存在(BranchView.tsx:246)。

## 六、建议排期

1. P1 发送链路收口——高频路径,真数据丢失面。
2. 原子写簇——一个原语修六点数据安全。
3. PTY 收尸 + 秒退泄漏——长开稳定性。
4. 搜索完整性(walk truncated 契约 + wsfb error 态)。
5. settings 写盘可见失败 + dsh 停止卡死(两条小修)。
6. git:全文 diff 收窄(P2)优先;其余 P3 按顺手。
7. UX 批:草稿持久化 + 触发符守卫 + staged 治理 + i18n 分批补录。
8. P3 池穿插清。

验证基线:每批 typecheck/test/arch-boundary/file-size/build + react-doctor 100;涉 Rust 加 cargo test/clippy/fmt;UI 行为改动 tauri:dev 真窗口目检。
