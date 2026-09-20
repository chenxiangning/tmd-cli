# 任务分解:0.2.2 打磨期(隐患与体验债清偿)

依据:全量体检复核定稿 `docs/review/2026-09-20-022-polish-survey.md`(v2,逐条实读复核;含修正记录与「已核实良好」清单)。i18n 底稿 `i18n-missing.txt`(382 条,MISS-EN/MISS-JA 标记 + 文件定位)。P3 池(§8)每条独立可穿插。

## 1. P1 发送链路收口(composer/marks)

- [x] 1.1 `src/kernel/host.ts:201-204` writeSession 返回写入结果:`void ipc.sessionWrite` 改为返回 `Promise<boolean>`;onUserWrite/notify 语义不变
- [x] 1.2 `useComposerSend.ts:74-86` 单路失败保现场:await 结果,失败时不 `setValue("")`/不清 attachments/matches,给可见错误
- [x] 1.3 `useComposerSend.ts:48-72` 广播逐路结果汇总:「N 路中 M 路失败」+ 失败会话名;变换单次化(marks 只翻一次)结构保持
- [x] 1.4 `sendTransform.ts:52` marks 乐观翻 sent 改发送成功后确认(或失败回滚)
- [x] 1.5 回归测试:单路+广播写入失败 → 草稿保留、芯片不翻 sent、错误可见

- [x] 2.1 `session.rs` write_atomic 泛化(tmp 名带 pid 防撞 + 保留目标权限 + rename 失败清残;write_json_atomic 委托之)
- [x] 2.2 六点接入(全部实读核实为裸 fs::write):`fs_edit.rs:55` write_file(编辑器保存+全部 CLI 配置写回通道)、`checkpoints/store.rs:168` rewrite_ledger(截断=批次历史不可逆丢)、`store.rs:185` save_states、`checkpoints/apply.rs:184` / `restore.rs:228` / `review.rs:78` 写回用户文件
- [x] 2.3 `fs.rs:54-63` write_temp_file ext 白名单(字母数字 1-5 位;含 "/" 的 ext 现会落 bin 而非拼出非法路径)
- [ ] 2.4 [缓修] LEDGER_LOCK 跨实例文件锁:std 无 flock、不为此引依赖;单用户单实例常态下仅进程内锁够用,已在 store.rs 留 ponytail 天花板注释(多实例共存时改 flock 或 prune 走 append 补偿)

## 3. PTY 进程收口(Rust)

- [ ] 3.1 三处 kill 补收尸:`pty.rs:132`(kill)、`pty.rs:140`(kill_all)、`pty_spawn.rs:238`(emitter 退出清理)——全库 grep 实证 PTY 是唯一无 try_wait/wait 的子进程路径(lsp/proc_run/wsl/git/resolve 均有)
- [ ] 3.2 `pty_spawn.rs:191` 泵线程先起、`:248-256` registry 插入在后:秒退会话的 emitter 清理跑在插入前,死亡 handle 永久滞留(master fd 泄漏)——改先插再起泵
- [ ] 3.3 验证:spawn 即退命令后 sessions 表无残留;多会话进出 `ps` 无僵尸

## 4. 搜索完整性(fs_walk 契约)

- [ ] 4.1 `fs_walk.rs:30,53-54` walk_files 返回 `{files, truncated}`(镜像 fs_search.rs FsSearchResult);cap 满额与 3s 预算两臂都置标志
- [ ] 4.2 `QuickOpen.tsx:16,178-183` WALK_CAP=5000 索引截断补提示(:178 注释自认「被截掉的文件静默不可达是误导(P3 评审项)」;现有提示只盖 SHOW_LIMIT=50 展示闸;硬错误 error 态已存在,勿重复造)
- [ ] 4.3 `WorkspaceFileBrowser.tsx:103-113` truncated 改消费标志(弃 `length>=4000`);reject 分支独立 error 态「搜索失败」,不再 setHits([]) 伪装「没有匹配的文件」
- [ ] 4.4 `useDirTree.ts:88-90` toggle 懒展开补竞态守卫 + .catch(同文件 revealDir:64-70 已有 catch,照抄即可)

## 5. 可见失败小修(四条独立)

- [ ] 5.1 `settings.ts:183-203` persistNow 失败降级 localStorage 仅限浏览器 dev(:195 注释自认);Tauri 环境写盘失败向 UI 通知——触发条件=写失败但盘上旧文件可读(磁盘满/杀软锁),此时 load(:205-215)永远读不到兜底,改动静默丢失
- [ ] 5.2 `cli-dsh/dshHost.ts:216-221` lsof procCommunicate 补 .catch(lsof 缺席即 reject;同函数 :236 KILL 已有 catch);`hostPanel.tsx:115-124,127-134` onStop/onCancelStart 包 try/catch 落 error——现 reject 后 setPending(null) 永不执行,面板卡「正在停止…」
- [ ] 5.3 `terminalCopyMenu.tsx:77` clipboard 失败轻提示(词条「剪贴板写入失败」已有)
- [ ] 5.4 `welcome/EngineCard.tsx:82-83` latest=null(类型注释自认「查询失败(不渲染)」)改行内轻量失败占位 + 重试

## 6. git 打磨

- [ ] 6.1 `diff.rs:84-103` build_diff full 态仅对目标 delta 二次 diff(pathspec 收窄)——现 context=u32::MAX(:92)作用于全仓所有 delta(含 untracked 内容),「全文查看」单文件 = 全仓全文 patch 进内存(P2,优先)
- [ ] 6.2 `BranchView.tsx:189-200` 分支右键成功文案无条件(「已更新 {branch}」up-to-date 也报;根因 commands.rs:244-259 git_pull_push 返回 String 非 report);`BranchView.tsx:83` 错误只走 gitErrorDisplay 无 isAuth「去幕布终端」引导(对话框路径 useGitPanelRemote.ts:50-54 有,双轨)。修:快速路径复用 git_remote_request 或返回体带 report;错误统一 isAuth 分流。注:busy 横幅已存在(BranchView.tsx:246),勿重复造
- [ ] 6.3 `remote_ops.rs:27,194-201` REMOTE_TIMEOUT 300s 策略:传输型(push/fetch)放宽或可配;文案「请检查网络/远端后重试」把超时误归因网络(收尸已完备,纯文案/策略)
- [ ] 6.4 `remote_ops.rs:209-219` 失败通知只取 stderr 尾 ~500 字符(combined 未截断进横幅刷屏),全文留 hover
- [ ] 6.5 `GitToolbarRemoteRows.tsx:66,80,96` + `useGitPanelData.ts:109` + `status.rs:4-5,33-35`:unborn(首提交前)branch 名正常返回、head_sha 空 → detached=false → 拉推行可点回裸英文 fatal。修:head_sha 空同样禁用 + 「先创建首个提交」
- [ ] 6.6 `remote_ops.rs:103-147` vs 显式策略路径:对话框策略 pull/合并/变基冲突透传英文 CONFLICT stderr(divergent+rebase 路径有完整中文处置)。修:from_shell_output 识别 CONFLICT/中间态统一中文引导
- [ ] 6.7 `remote_report.rs:72` ponytail 自认:HEAD 不动时 diff HEAD→index 把既有暂存计入「拉取成功:N 个文件变更」。修:对比 pull 前后 index oid 排除
- [ ] 6.8 `remote_report.rs:31-39` fetch 快照仅 refs/remotes/**,自动跟随 tag 不计入。修:并入 refs/tags

## 7. UX 习惯批

- [ ] 7.1 `Composer.tsx:51` 草稿按 workspace 存 localStorage:挂载恢复、发送清除
- [ ] 7.2 `serialize.ts:33` + `composerTextareaKeys.ts:47-52` 触发符守卫:前一字符为触发符自身或 `://` 不激活(现只挡 \w,`https://x`/`src//x` 照弹下拉,Enter 被 applyPick 劫持误改文本)
- [ ] 7.3 `marks/store.ts:155-158,165-183` staged 跨会话治理:loadAllMarks 回滚 pending 或醒目标识(isMark 收 staged/sent 随 sidecar 持久化,重启原样复活)
- [ ] 7.4 i18n 首批:settings 域 15 条 + git 12 + files 9 + kernel 8(高频面)+ `modelsConfig.ts:179-192` validateProviderInput 7 条校验文案包 t();git 参数化键({op}成功等)人工抽查
- [ ] 7.5 i18n 大批量:按 `i18n-missing.txt` 分批补 en(382)/ja(383)——welcome 63 / wallpaper 57 / wsl 49 / cli-omp 49 / web-access 42 / cli-config 24 / cli-shared 15 / 其余零散
- [ ] 7.6 终端三件:`askSound.ts:56` 提示音 soundVolume(0-1);`terminalSearch.tsx:30-33` isComposing 跳过 findNext;终端搜索启用命中高亮(findNext 传 decorations:matchOverviewRuler+activeMatchColorUnderline,closeSearch 清除——现无任何高亮仅滚动定位)
- [ ] 7.7 更新检查两件:`updateCheck.ts:46-56` isNewerVersion 对 current 剥 -rc 后缀再比(现 rc 装机恒不提示);`SidebarSettingsCluster.tsx:9,14` 头注释 v0.1.4 示意改 CHANGELOG 首条口径

## 8. P3 池(穿插清)

会话生命:
- [ ] 8.1 `askWatchCore.ts:139-144` 屏幕态自愈对称:!present 时字节尾巴页脚窗仍含标记则保留 waiting(现无条件连字节通道一并摘,整帧重绘瞬时采样闪摘)
- [ ] 8.2 `sessionStartFail.ts:50` 20s 窗外退出且 outputTail 非空 → 降级普通退出通知(现直接 return,慢启动 CLI 崩溃静默消失)
- [ ] 8.3 `sessionDeleted.ts:23` 墓碑提容对齐 2000(overlayEvict.ts:21 注释明说实例化处单独提容,此处漏;删盘失败路径 200 次后幽灵复活);`sessionArchive.ts:22-24` 注释 200→2000 口径
- [ ] 8.4 `host.ts:268` removeSession 兜底活跃指针改 sessionTabs MRU 序(现取注册表序 sessions[0])

marks/composer 补:
- [ ] 8.5 `useComposerSend.ts:76-81` sendTransforms 过轮次闸(现 payload 构建先于 readPromptGate,ask 确认期作答也注入 staged 引用并翻 sent)
- [ ] 8.6 `enterAction.ts:26` Enter 兜底 keyCode 229 / compositionend 短窗(WKWebView 平台差异,推断项)
- [ ] 8.7 `useComposerDrawer.ts:71-74` 抽屉发送对在挂 staged 芯片提示「仍待注入」或提供一并注入(现注释自认同路径但零拦截)
- [ ] 8.8 `marks/store.ts:266` relocatePath 唯一调用面 editorExtension.ts:160——面板打开/发送前补路径存在性检查,失存标 lost(现删/改名文件标记永不重定位,「定位」静默失败)

files/cli 补:
- [ ] 8.9 `open_with.rs:41-46` command 类直启不经 shell:设置面板加「参数请填 args」提示(或含空格且无对应可执行时 shell 分词兜底)
- [ ] 8.10 `cli-codex/edits.ts:67-75,73` locateRollout 双修:缓存带 mtime/重扫对齐 sessionStatus revalidate;:73 find 命中改取最新(现取首个匹配,同 id 新 rollout 漏事件)
- [ ] 8.11 `QuickOpen.tsx:53-68` walk 按 root+mtime 缓存(可选,大仓慢盘有感再做)

## 9. 收口

- [ ] 9.1 每批验证:前端五件套(typecheck/test/arch-boundary/file-size/build)+ react-doctor 100;涉 Rust 批跑 cargo test/clippy -D warnings/fmt
- [ ] 9.2 UI 行为改动(1.x/6.2/7.x)tauri:dev 真窗口目检
- [ ] 9.3 CHANGELOG 0.2.2 小节;本目录归档至 archive/;docs/README 状态同步
