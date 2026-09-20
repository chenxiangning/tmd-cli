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

- [x] 3.1 三处 kill 补收尸:`pty.rs` kill(:133)/kill_all(:142)、`pty_spawn.rs` emitter 退出清理(:250)各加 child.wait()
- [x] 3.2 `pty_spawn.rs` 注册表插入提前到泵线程前(原 :248→现 :175-185):秒退会话的 emitter 清理不再跑空,死亡 handle 不滞留
- [ ] 3.3 [待真机] ps 级无僵尸验证归入 9.2 目检(单测需 AppHandle 不可行;伪造 Child 钉实现无行为价值,不写)

## 4. 搜索完整性(fs_walk 契约)

- [x] 4.1 `fs_walk.rs` walk_files_result 返回 `{files, truncated}`(cap/预算两臂都置);扁平 walk_files 保留包装(12+ 小目录消费方零波及),新命令 fs_walk_index 只供搜索 UI
- [x] 4.2 QuickOpen 改走 fsWalkIndex,walkTruncated 提示行复用「结果可能不完整:文件数超过扫描上限」词条
- [x] 4.3 wsfb truncated 消费真标志(弃 length>=4000);reject 分支独立 walkError 态显式「搜索失败」(en/ja 词条已补)
- [x] 4.4 useDirTree toggle 加 wantedRef 意向集竞态守卫 + .catch(折叠后在途结果按意向丢弃)
- [ ] 4.5 [归 9.2] 快开/wsfb UI 目检:headless 桩遇双模块实例分叉(store 与 app 树不同步)未能完成;Rust 截断契约有单测,真窗口目检并入收口批

## 5. 可见失败小修(四条独立)
- [x] 5.1 settings persistNow:Tauri 写盘失败经自持轻量监听注册面 onSettingsPersistFailed 通知(SettingsPersistToast 订阅,复用 sft 卡片样式);不 import host——动态导入链曾把他测 persist 失败放大成整张 host 图加载,实证拖爆归档测试,已改自持;localStorage 兜底仅浏览器 dev
- [x] 5.2 dsh 停止链:lsof/TERM 探针源头全容错(.catch → 跳过),hostPanel pending 不再永卡「正在停止…」(源头修复后 onStop 无需再包)
- [x] 5.3 终端复制:失败保菜单开 + 行内「剪贴板写入失败」(词条复用 common)
- [x] 5.4 引擎卡版本查询失败:RowVersion 行内「版本获取失败」占位 + tooltip 指向标题条刷新(重试通道已存在:refreshTick 强制重拉失败引擎)

## 6. git 打磨

- [x] 6.1 diff.rs file_patch 两段式:窄上下文全仓扫保 rename 配对(既有回归测试锁死不可 pathspec 收窄),full 态以 [旧,新] 双 pathspec + u32::MAX 二次 diff 只构目标文件;新增 full+rename 契约测试。commit_view 同款全文模式留待(频率低)
- [x] 6.2 git_pull_push 返回 RemoteOpReport(remote_ops::run 拆 remote_quick.rs);BranchView pull/fetch 真报告文案(up_to_date 不再假成功)+ isAuth 幕布引导(与对话框同口径);非当前分支 pull 走 refs 口径报告
- [x] 6.3 REMOTE_TIMEOUT 300s→600s;超时文案改「超时≠网络故障判定;大传输请到幕布终端」
- [x] 6.4 远端失败输出尾裁 500 字符(修复裁掉 CONFLICT 字面量后 exec_pull 匹配改大小写不敏感——测试实证抓出)
- [x] 6.5 unborn(首提交前)headSha 空判定:useGitPanelData 派生 → panelStore 镜像 → 拉取/推送/获取行禁用 + 「先创建首个提交」
- [x] 6.6 from_shell_output 识别 CONFLICT/Automatic merge failed → 统一中文中间态引导(divergent 兜底路径先返回不受影响)
- [x] 6.7 pull_report 逐 delta 聚合并跳过 pull 前已 staged 路径(staged_paths 基线;run_request/remote_quick 两入口同捕获)
- [x] 6.8 remote_refs_snapshot 并入 refs/tags(自动跟随 tag 不再误报「已是最新」)

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
