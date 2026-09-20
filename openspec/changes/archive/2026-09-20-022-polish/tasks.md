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

- [x] 7.1 Composer 草稿按工作区 root 持久化 localStorage(tmd.composerDraft.<root>):挂载懒恢复、切换工作区旧稿先落盘再换稿、发送/清空随 value="" 落盘(失败保留草稿 = P1 批语义自然成立);300ms 去抖
- [x] 7.2 触发符三重前置守卫:词字符 + 触发符自身(src//x 第二个 /)+ 冒号(https: 后第一个 / 合成 ://)都不弹;回归测试 3 例入 serialize.test
- [x] 7.3 marks loadAllMarks 磁盘像 staged 回滚 pending(瞬态语义:重启即失效,芯片条消失、面板可见待重发)
- [x] 7.4 i18n 高频面(kernel 8 + git 12 含 remoteReport 参数化 8 + files 9 + workspace 7)+ git 域全量扫描零漏(git 插件 271 个 t() 键全核对)
- [x] 7.5 i18n 大批量(4 路子代理并行):welcome/wallpaper 底稿过时已在前批补齐(0 改动,程序核验);实补 wsl 53 + assets 5 + cli-pi 5 + cli-omp 49+7(modelsConfig 7 条 throw 包 t(),用户可见已实证)+ cli-config 24 + cli-shared 15 + web-access 42+6(WebWanPane STEPS 变量消费盲区,主会话补);en/ja 键集一致契约测试全过。遗留:变量式 t() 调用各域可能仍有零星盲区(字面量普查不覆盖),「Claude 官方订阅」welcome/cli.ts 跨文件冗余无害(flat registry 后到覆盖)
- [x] 7.6 终端三件:soundVolume 设置(0-1 钳制清洗 + BehaviorTab 原生 range 滑杆,ask/turnEnd 共用播放点);搜索框 IME 组合态跳过 findNext;搜索命中高亮(概览标尺中性灰=命中/主题色=活动命中,关闭 clearDecorations)
- [x] 7.7 isNewerVersion current 剥 -rc 后缀再比(同三元组不提示防 rc 期账本抖动,回归测试 2 例);SidebarSettingsCluster 头注释对齐 CHANGELOG 首条回落口径
## 8. P3 池(穿插清)

会话生命:
- [x] 8.1 askWatchCore 屏幕态自愈对称化:字节态等待摘除对称防抖(缺席 ≥ASK_CONFIRM_MS 两拍才摘,瞬时空屏帧不闪摘;spinner 静默流自愈保留);absentSince 随 onUserWrite/onSessionRemoved/resetForTest 全清
- [x] 8.2 20s 窗外退出带崩溃特征(error/fatal/panic/… 启发式)降级广播 late=true,Toast 标题「{name} 会话异常退出」;正常退出(/quit)静默不打扰
- [x] 8.3 墓碑提容 2000(容量测试同步);sessionArchive 注释对齐 2000 口径
- [x] 8.4 removeSession 后继指针走 sessionTabs MRU 序(closeSessionTab 同语义),回落注册表首项

marks/composer 补:
- [x] 8.5 发送变换过轮次闸(单路+广播):ask 确认期作答不注入 staged 引用块、不翻 sent,与 promptSent 锚点闸口径一致
- [x] 8.6 Enter 兜底 keyCode 229(WKWebView 组合末尾派发的确认 Enter 不误发送),回归测试入 enterAction.test
- [x] 8.7 抽屉命令发送后在挂 staged 芯片时 toast 附「{n} 条引用标记仍待下次输入注入」(composerExt 新 registerComposerPendingCount 注册面,marks 注册计数)
- [x] 8.8 MarksPanel 打开即存在性巡检:pending 标记文件失存批量标 lost(relocate 依赖打开文件,删除场景永无机会)

files/cli 补:
- [x] 8.9 打开方式帮助行补「命令类只填可执行文件名,参数写 args 字段」(open_with command 直启无 shell,空格串必败)
- [x] 8.10 codex rollout 定位:同 id 多文件取文件名最新(时间戳前缀降序)+ 读失败清缓存重定位(新 rollout 顶掉旧文件场景)
- [ ] 8.11 [缓做] QuickOpen walk 缓存(root+mtime):低优,大仓慢盘有感再做(任务板原文明示)
## 9. 收口

- [x] 9.1 每批验证:前端五件套 + react-doctor(每批全跑,2707 前端 + 260 Rust 测试);涉 Rust 批 cargo test/clippy -D warnings/fmt 全绿。注:并行会话 in-flight 文件(FileDetailContextMenu 等)的 doctor 93/超行属其提交时收口
- [ ] 9.2 [待用户侧] UI 行为改动(1.x/6.2/7.x)tauri:dev 真窗口目检:真窗口无法自动化(osascript 辅助访问拒/录屏无权限,记忆在案);headless 桩已覆盖 1.x 发送失败路径双向,快开/wsfb/搜索高亮/音量待真窗口过目
- [x] 9.3 CHANGELOG 0.2.2 小节;本目录归档至 archive/;docs/README 状态同步
