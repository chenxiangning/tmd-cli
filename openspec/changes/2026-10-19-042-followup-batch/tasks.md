# 任务:0.4.0 追加批实施清单

实现口径唯一来源:`docs/design/042-candidates/` 页 9-14(实现级锚点)+ `docs/brainstorm/2026-10-19-042-followup.md`(深扫修正记录)。批次顺序 = 批一(13+14)→ 批二(12)→ 批三(11)→ 批四(10)→ 批五(9)→ 集成收口;每批完成即 review(跑偏/闭环/兼容),全部批次通过后分项独立提交。

## 批次一:项13 通知会话静音 + 项14 转录批量导出(均 S-M,零 Rust)

- [x] 13:`src/kernel/sessionMutes.ts`(新,仿 sessionPins:makeOverlay+三段 key+mutedAt/mode/askRing)
- [x] 13:settingsSessionEntries.ts SessionMuteEntry + settingsTypes.ts sessionMutes + settingsPersistMerge.ts MERGE_TS_FIELDS + settingsSanitizeSessions.ts sanitizeSessionMutes(帽 2000)+ settings.ts 接线
- [x] 13:shouldNotify 加 sessionId 参数与会话档查闸(dispatch/exit/fireQuota 三路径;quota 拦 record 后 send 前,不写 quotaSeen)
- [x] 13:snooze 自清挂 notify 既有 turnSettled 订阅;未落盘会话菜单项隐藏判空(SessionTabBar 判空同款)
- [x] 13:入口四处(SessionContextMenu/TabContextMenu/通知中心行钮/NotifySettingsTab 概览卡)+ locales 三语 + i18n 键比对
- [x] 13:单测(三档×四类别矩阵/snooze 自清/quotaSeen 不写/sanitize)
- [x] 14:`src/plugins/session-viewer/exportMd.ts`(新,抽 exportMdTo(dir) 内核;viewerTab 改调用)
- [x] 14:SessionManage 批量条加「导出」(pickDirectory+循环+进度 toast+失败列表+帽 50+防撞 -2)
- [x] 14:活会话右键「导出转录快照」(已落盘部分+时点注明)
- [x] 14:单测(文件名防撞/帽/失败聚合纯函数)

## 批次二:项12 草稿安全网(S-M;⌘Q Rust 腿裁决取消)

- [x] 12:kernel/ipc.ts 加 onCloseRequested 订阅原语(onResized 先例,isWeb 短路)。~~强制退出命令配套(Rust ExitRequested prevent)~~ **裁决取消(2026-10-19 批二 review P0+P1)**:tauri-runtime-wry 2.12.1 中 ExitRequested{code:None} 仅来自最后窗 Destroyed(prevent=僵尸进程),macOS(tao 0.37.1)无 applicationShouldTerminate、⌘Q 不发 ExitRequested —— Rust 侧无可靠挂点;⌘Q 若要做需菜单装配(Menu accel→前端命令)另立条目,证据与裁决见 review 记录。
- [x] 12:kernel/tabClose.ts 加退出确认模式(聚合列出 dirty→确认后逐 tab 强制放行;等 Promise 全结算再放行窗口)
- [x] 12:退出确认弹层 UI(列表+放弃并退出/取消+「本次不再问」=内存标志,本次运行有效,不持久)
- [x] 12:草稿镜像模块(files drafts Map/journal 便签/ssh-file 三处接 draftSet 防抖镜像+256KB 截断+7 天 TTL 台账+恢复黄条)
- [x] 12:单测(镜像 TTL/截断/退出模式聚合与强制放行)

## 批次三:项11 会话变更总览(S-M 纯前端)

- [x] 11:CheckpointsPanel view union 加「变更」档+segCls 按钮+hidden 保活容器
- [x] 11:ChangesPanel.tsx(新):flatMap 折叠+状态合成优先级表+摘要条+过滤 chips+路径过滤+排序+cap 50 展开
- [x] 11:行点击 openBatchTab focusPath 深链;± 账本口径与 BatchSheet 口径双注明 ~~(± 纯前端不可达:checkpoint_list 的 BatchFile 不序列化 ±,懒加载 diff 逐批 IPC 不堪总览)~~ **BatchFile ± 序列化字段:review 拍板放开(2026-10-19 Main),types.rs/view.rs 加 additions/deletions u32 透传(账本真值,零新命令零聚合逻辑,设计真意「回退不回缩」),ipc.ts TS 镜像同步**
- [x] 11:单测(合成优先级矩阵/折叠去重/排序)

## 批次四:项10 记忆文件面板(S-M)

- [x] 10:profile 声明字段(各 cli-* 插件声明 memoryFiles;内核零路径知识)+ skillSources 式探测
- [x] 10:memory-coordinator 右栏新面板 memory-files(分组行/三态/重新探测/footbar 零 AI 声明)
- [x] 10:settingsIconDecor 三表 + 词条同步;openFileInTab 打开链
- [x] 10:单测(声明缺省/三态渲染/路径展开)
- [x] 10:裁决留痕:omp 记忆后端徽标(off/local/mnemopi)二期可选(设计页注明本期仅展示),本批未做,已在交付记录标注
- [x] 10:裁决留痕:零声明 profile(omp/dsh/grok)入未声明灰组 —— 以 brainstorm 2026-10-19 二轮实证口径为准(与设计页「dsh/grok 不渲染」注记冲突,取渲染口径,用户可见可用)
- [x] 10:裁决留痕:探测原语 fsReadHeads(1) —— 空串=缺失/0 字节/读失败不可分辨,存在的 0 字节记忆文件显未生成(head 原语边界,如需精确后续单独立 fs_stat)

## 批次五:项9 重启现场恢复(M)

- [x] 9:settings 三源 sessionRestore{enabled,keys[]} + sanitize(帽 sessionTabsMax/形状校验)——类型落 settingsSessionEntries.SessionRestoreSettings;sanitize 帽由装配侧传 sanitizeSessionTabsMax(obj.sessionTabsMax)(清洗期 state 未提交,函数内现读会拿旧帽)
- [x] 9:sessionTabs trackOpen 防抖写三段 key MRU —— persist 是串行链无时间防抖,幂等短路(最新已在首位 = 重复聚焦零写盘)即防抖;keys 次序 = 首次打开序(重复聚焦不重排,与 tab 条 ids 同语义);头注「不持久化」已改写为三段持久
- [x] 9:bootScheduleRestore(DesktopApp ready 后 45s 错峰,workspace activate 挂/deactivate 清,可跳过 pill)——挂点实际落 DesktopApp ready 链(workspace/index.tsx 299 行贴 300 铁则无 +2 行余量,brief 允许 DesktopApp 直挂);编排内再等 readoptSessions+workspacesReady;至多一次防重入;pill 复用 wm-toast 固定条零新 CSS(app-shell/SessionRestorePill.tsx,挂 AppShell)
- [x] 9:逐 key 串行 openDiskSession + 失败矩阵五路径(evict/保留语义)——存在性预判 = profile.listSessions 按 (profile,root) 记忆化扫盘:确认缺失 evict、列举失败保留;远程工作区(remoteExec 存在)跳过预判(本机扫盘看不见远端,误 evict 防护,批五 review P1)、resume 走来源接管;畸形 key/工作区已删/用户已删(tombstone)evict,引擎缺失/spawn 失败保留;远程来源(WSL/SSH)先走 openRemoteDiskSession(与侧栏行点击同款分流,防重启误 spawn 本地 PTY);失败全静默不弹错
- [x] 9:单测(key 解析/失败矩阵/容量截断)+ 桩目检恢复全流程 —— 单测已落(sessionRestore.test.ts:record 去重/帽截断/解析/矩阵七断言/编排与跳过 + sanitize 链见 sessionRestore.test.ts:94-110(updateSettings 全链) + sessionTabs.test.ts trackOpen 落键回归);**桩目检待集成收口(Main 真机重启核对回位/跳过行态与 pill 收起)**

## 集成收口

- [x] pnpm check:gate 全链绿(554 文件 4337 测试+build)+ react-doctor 100/100(12 issue 清零:复杂度拆件/纯函数迁 .tsx 外/key 用 tab id/sessionRestore 串行豁免登记/deps 补齐)+ i18n 三段核对(缺键 0 不对称 0)
- [x] Rust 套件:cargo test 368 passed + clippy --all-targets -D warnings + fmt --check 全绿(批二 Rust 腿裁决拆除后 lib.rs 与 HEAD 逐字节一致;批三 BatchFile ± 透传字段在 cargo test checkpoints 67 passed 内)
- [x] 桩/真机目检:1421 当日未起,桩目检未跑;页面 index 已打绿标、README/brainstorm/docs 索引状态已推进;**真机目检清单留大仙**(29 号契约尾段):重启恢复全流程(含 1 个 WSL/SSH 会话)/红 X 关窗两态进程必须退出/⌘W 单关回归/静音三档矩阵抽查/批量导出一炉+失败列表掺无适配器/记忆文件面板三态
- [x] workbench 登记:workbench 无 0.4.0 相关在册任务,按规则未经要求不新增任务,登记无对象(已向大仙说明)
- [x] 分项独立提交(中文祈使句;推送前最新树再跑 gate)
