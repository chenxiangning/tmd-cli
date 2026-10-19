# 27 · 0.4.0 向内治理批八项落地契约(冻结快照 / 通知中心 / 会话预设 / 检索定位桥 / 存储体检 / 转录导出 / 互跳)

日期:2026-10-18 · 状态:已落地(0.4.0 八项全量;依据 `docs/design/041-candidates/feasibility.md`,八路并行实施+集成收口)

## 挤除冻结快照(kernel terminalFreeze.ts)

- 存档:tab 条容量挤除(sessionTabsMax)卸载幕布时,把卸载路径本就要算的 `buildReseedScreen` 投影一次计算两用,连同缓冲水位存 LRU 8:`{sessionId, cols, rows, screenText, unloadChars, bytePos, headSample(48 字符), fingerprint(pid+createdAt), at}`;消费即弃(take 语义),重建重挂(canvasGen>0)先弃存量——停滞期幕布可能滞留旧帧,投影不可信。
- 命中裁决 `resolveFreezeReplay` 四闸:指纹 / 字节水位不回退 / 字符水位不回退 / 头样本前缀吻合(证明缓冲未从头截断);全过 → `term.write(screenText)` 同步上屏 + `slice(unloadChars)` 增量分块补写(期间活流攒队 flush,幂等保序)+ 零遮罩;任一闸不过 → 既有全量回放原样。
- 边界:仅覆盖「strip 挤除后重开且内存 outputBuffers 仍在」;磁盘重开(侧栏)/会话关闭清缓冲 = 存档天然不命中;快照只还原视口投影,卸载前 scrollback 不重写(上翻即见,「加载更早」一键自愈)。幕布红线不破:投影=原字节序列屏幕投影,与 reload reseed 同范式。

## 免打扰窗(kernel dnd.ts)与通知流水(notify/log.ts)

- `inDndWindow(now, start, end)`:HH:mm、跨夜窗、start===end 全天静默、起含终不含、非法串不静默(宁可响不静默);`isDndActive(prefs, now)` 三闸共用——notify `shouldNotify`、ask 音(`bootAskSound` 事件路径,设置页「测试」直连不受窗拘)、回合音(`observeTurnSettled` 3s 延迟确认播放刻再判,防结算与播放隔窗界)。设置键 `notifyDndEnabled/notifyDndStart/notifyDndEnd`(sanitize 非法回落)。
- 流水:全局单文件 `~/.tmd-cli/notify-log.json`(configDir 平铺惯例),`{version:1, entries:[{id,ts,kind:ask|turn|exit|quota,sessionId,profileId?,title,snippet?}]}`;追加时顺带过滤过期(`notifyLogDays` 默认 7)+500 条剪最旧,互斥队列仿 wiki,坏文件不抛。铁律:**流水=全量历史,聚焦静默/免打扰也记;OS 通知才受闸**。右栏面板行点击 = `sessionViewRequested` + `setActiveSession`(用户手势语义不变)。

## 会话预设(workspace)与 pending 队列上移(kernel sessionPending.ts)

- pending 队列核心自 anim refStore 上移 kernel(≥2 消费:anim AI 会话/workspace 预设):`setPendingPrompt`(LRU 8,插入序逐出)/`consumePendingPrompt`(原子读+清,发送变换唯一消费口)/`usePendingPrompt`;anim refs 半区留在插件。
- 预设存储:`~/.tmd-cli/session-presets.json` 单文件+内存单源+emit(agents.json 范式),白名单 sanitize 坏形整条弃置;`loadSessionPresets` 全错吞为空库(contract 测试无 Tauri 环境激活不炸)。
- 起会话链:`spawnRawSession`(kernel 统一装配,identityTrack 必开)→ 成功才 `setPendingPrompt`;失败零残留,报错走内核 `sessionStartFailed`。提示词引用存 `{scope,wsId,name}` 三元组(assets 提示词无 id),消费时 `promptContent` 现读;悬空引用灰态禁点不猜测。入口恒显先例:本地工作区(!origin)菜单段,引擎候选空禁点+提示。
- 范围字段(2026-10-19 补设计定稿):`worktree?: boolean` = 每次在新 worktree 起会话(分支 = 预设名 slug 加 wt/ 前缀,`finalBranchName` 冲突自动递增),undefined = 当前工作区 root。启动编排 `launchPresetWorktreeSession`(presetLaunch,gitInfo/create/startFailed 三依赖注入可 node 测)→ `runWorktreeCreate` 里程碑回滚链复用(spawnArgs/spawnEnv/promptText 覆盖面缺省 = 对话框路径零变化),pending 注入在 record 关联后;非 git 仓/建树失败经 `deps.startFailed` 广播 `sessionStartFailed`(StartFailureToast 呈现)。菜单行信息密度对齐设计:名称 + 范围/引用 pill + 描述行(引用 = 现读说明;内联 = 原文预览;无 = 明示)。表单范围选择带分支 slug 预览;悬空引用在编辑面板改绑或转自定义文本。
- 集成教训:`toggleGroup` 机械压缩曾误写工作区折叠 map(点组头错折工作区)——压缩必须变量级 diff 自查,不能只看行数。

## 检索定位桥(kernel anchorJump.ts 扩展)

- `textNeedle(text)` 与 `anchorNeedle` 同归一管线(剥 @token/折叠空白/首行 24 字符);`jumpToText(sessionId, text)`;`openThenJumpToText(target, text, opts) → "jumped"|"opened"|"miss"`:活会话按 tmd id 或绑定 cli 身份反查直跳;已关会话 `host.openDiskSession` 后**订阅 terminalHandles 注册表**等挂载(零轮询,默认 8000ms 上限)再跳。消费方:session-search(命中行级定位)与 checkpoints(「看对话」),时序桥唯一。
- 检索时间过滤:`searchSessions` 闭区间谓词(entry.modifiedAt)纯检索期,索引结构零改动;标题命中无正文不定位不猜。

## checkpoint↔转录互跳(checkpoints)

- 正向:时间线每条用户消息挂「本轮 N 文件」chip——匹配 = 账本 `BatchInfo.prompt` 与消息文本全等,多轮同文按出现序配对(锚点与批次皆单调序列,错位保单调不回跳);匹配不到不渲染(不猜测);`attribution:"git"` 带「推断」标注。展开复用审批线文件行配色(独立 `fileChipCls.ts`,组件文件禁非组件导出)。
- 反向:审阅单消息卡「看对话」(批头是 button 内嵌按钮非法 HTML,放 Sheet 消息卡);`resolveLedgerProfileId` 补账本缺 profileId——活会话直取,已关并行扫各引擎 `Promise.all` 唯一认领(多引擎同 id 歧义/零命中=null 不猜);无 prompt 的轮次(guard/edit)不出动作。

## 存储体检(Rust fs_usage.rs + settings 新区 storage-audit 插件)

- `fs_dir_usage(specs)`:std 递归不跟符号链接;**skip 目录取调用方参数**(命令不硬编码 .git——checkpoints objects.git 必须计入,与 `git_worktree_disk_usage` 的 worktree 专属语义区分);逐类目独立 `spawn_blocking` + 20s tokio 超时(`timedOut` 标记,超时 blocking 任务后台自然跑完即弃)。
- 清理白名单:checkpoints 按工作区 `checkpoint_prune(cwd,10,30)`(现成命令,按账本 ts 天然避开 coarse-clock 陷阱)+ 两步武装确认;docgen 归档版本删 `docs/<entryId>/` + 索引回写(索引先、目录后,对齐 terminateEntry);CLI 会话目录只读零触碰。工作区快照定位 = `ipc.md5Hex(root)` → `configDir/checkpoints/<md5>` 存在性探测。

## 转录导出(session-viewer)

- `blocksToMarkdown(transcript, meta)`:user→`## 用户`、assistant→`## 助手`、tool→折叠一行、thinking/图片跳过计数、truncated 头部标注;`sessionExportFileName` slug 封顶 80 字符。Windows 保留设备名 sanitize 沉淀 docgen `safeFileBase` 共享导出(DocGenFoot 内联副本未消,集成可选)。
- 导出链:viewerTab 工具行 → `pickSavePath` → docgen `writeText` 原子写 → 局部 toast;取消/桩态静默。liveOverlay 活会话导出后补未做。

## 保留律收尾(workspace)

- keep 层容量 200 → 2000(`SESSION_KEEP_MAX`,与 sessionArchive 同级;overlayEvict 容量逐出测试既有)。
- 启动补扫:`scheduleBootSweep`(activate 返回清理函数,45s 一次性)→ `bootSweepLocalWorkspaces`:等 workspacesReady → 顺序逐区逐 profile(有意串行,doctor.config 豁免对齐 tabClose 先例)跑 `scanAndSweep` 扫描结算核心;远程/SSH/WSL(`findWorkspaceOrigin`)跳过,前台在途(`foregroundScansInflight` 登记表)让路,单区失败不阻断;deleted>0 只记数不触发 UI 补扫(下次打开该工作区自然消失)。零轮询不新增周期触发面。
