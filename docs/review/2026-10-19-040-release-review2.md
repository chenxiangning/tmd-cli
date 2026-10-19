---
date: 2026-10-19
scope: 0.4.0 发版前第二轮 code review(v0.3.9..HEAD,34 提交,+15.3k/-2.3k)
status: 已收口(同日修复落地,commit 见 git log)
---

# 0.4.0 发版二轮评审(查漏补缺)

方法:八路并行只读复审(notify / session-search / checkpoints / workspace 预设 / kernel 幕布 / storage-audit / 导出+QUOTA / 杂项),四维 checklist(边界 / 兼容 / 性能 / 准确合理性),对照 CHANGELOG 0.4.0 小节逐条核兑;另做交叉面自查(版本源六处 / CHANGELOG 完整性 / vite bench 入口)。第一轮收口(a16568a9 + 4a8889f9)已修项不重报。

## 结论

基线 HEAD `check:gate` 全绿(544 文件 4245 测试);复审净产出 **P1×4、P2×14、P3×15**。同日修复落地 4×P1 + 10×P2 + 10×P3(明细见下),其余 P3 按裁决豁免并留痕。发版级缺口 = CHANGELOG 定稿后落的 4 个用户可见特性零录入,已补录。

## P1(全部已修)

| 位置 | 缺陷 | 修法 |
| --- | --- | --- |
| notify/index.tsx:97 | blur 补扫死路径:`waitingNotified.add` 无条件先于闸,聚焦期 ask 必入集合 → 失焦补扫恒跳过(插件头注宣称要消灭的盲区) | dispatch 返回是否真发 OS 通知,add 只在真发时执行 |
| workspace/sessionPresets.ts | 非缺失读错误(EACCES/EBUSY)被 catch 当空库且 loaded 置位 → 下次 save 用近空 state 整本覆写真库 | readBroken 位:非缺失读错误拒 persist,savePreset/deletePreset 走既有回滚返败(同 notify/wiki 先例) |
| storage-audit/docgenArchive.ts | removeArchivedDoc 绕过 docgen store 单写者队列裸读写索引 → 任意后续 save/writeTasksNow 整体重写把已删条目静默复活,反复删反复复活 | 删除口收进 store.ts `removeArchivedEntry`(队列内改 currentIndex+补偿回写),CleanupTab 改调它 |
| welcome/QuotaPanel.tsx:231 | claudeHasQuota 把「无窗口仅 note」聚合算作已有真额度 → 官方订阅形态下 claude 推算卡+汇总条窗口永久消失 | `q.windows.length > 0 && /claude/i` 一行修 |

## P2(已修 10,豁免 0)

已修:

1. **TerminalView.tsx** 冻结快照卸载未先 flush 攒帧(≤250ms 尾巴已计水位不在投影,重开 fast 路径永久跳字)→ cleanup 先 `flushDeferredRef.current?.()`。
2. **fs_usage.rs** 超时逐个 await = 串行累加(12 类目全挂 240s)→ 各自包 timeout 再 `join_all`,总墙钟 ≈20s;JoinError 按超时入表不整批 Err(连带修 P3)。
3. **turnMatch.ts** 出现序配对被空批轮挤错位(同文两轮、首轮纯阅读 → chip 挂错消息)→ 改「轮号对齐(batch.index=锚点序号,纯阅读轮占号)+ 文本全等」双闸;测试翻转重写。
4. **diffCache/confirmCard** revert 模式吃跨弹层陈旧预览(回退→外部改文件→重开卡,「覆盖本地」药丸缺失)→ revert 挂载 `fresh` 现发 dry-run,undo 保持吃缓存。
5. **anchorJump.ts** 反向跳转自底向上恒落最新同文气泡 → `findAnchorRow` 加 occurrence 自顶向下数第 k 个命中;正向时间线/锚点栏点击一并带上序号(同根缺陷顺手修);跳转契约 openThenJumpToText/jumpToText 透传 occurrence。
6. **session-search/indexerTicks.ts** stop 后在途拍仍写态(旧扫描快照污染新消费面、settle 掐掉新扫描进度徽标与悬空收口守卫)→ emit/flush/settle 首行 stopped 闸。
7. **session-search/indexer.ts** LRU 3000 < 自估语料 3500 → all-scope 永久全量重读 → cap 抬 5000(ponytail 注明天花板:语料再涨一档改命名空间公平淘汰);失效区瞬时不可达误剪整区暖缓存 → 死键剪枝只认可达区。
8. **workspace 消费面** 提示词引用三元组后半程只剩 name(同名覆盖可注入他区/工作区版正文,与 CHANGELOG 矛盾)→ promptStore 增 `promptContentByRef`(scope+wsId+name 全等),presetPromptText 改收 ref 解析器。
9. **terminalPathLinks.ts** ①括号包裹路径(AI 输出高频)连闭符进链必死 → 剥尾改配对感知(闭多于开才剥);②绝对路径不归一,`/repo/../../etc/x` 裸前缀过守卫读区外文件 → 绝对分支同走 joinCwd 归一;③win 大小写不敏感前缀比(P3 顺手)。
10. **terminalSearch.tsx** onKeyDown 无 isComposing 守卫(IME 确认键误跳选、Esc 丢查询)→ 首行守卫,对齐 composerTextareaKeys/HistoryDrawer 先例。

已修的 P2 级杂项:workbench 归档撤退残留两处(「问一句」与 DocGenDialog 生成面改喂 `visible`;Reader 按 projectId 查原表不受影响)、structured-session turnEnd 通知漏传 dnd 第四参(免打扰窗照发,补齐)、welcome slug 漏控制字符(win 导出文件名拒收)、docgen removeEntryDir 条目 id 白名单(`../` 借删除原语越出 docsDir)。

## P3(修 10,豁免 5)

已修:worktreeCreate 注入先于记账两行对调;PresetFormCard worktree 预览名与真实分支同源(branchForWorktree);refKey 改 JSON 编码(名含 `|` 静默截断);SearchOverlay 时间/引擎 chip 换挡回顶选中;HistoryDrawer 订阅数组拷贝破同引用 bail;BatchRowParts abs 判定补盘符/UNC;ipc.ts 两处注释 E_EMPTY→E_EMPTY_PLAN;preview.rs 头注对齐双读事实;promptHistory 封顶口径「512KB 字节」→「512K 字符」(含 CHANGELOG);welcome 删除面残留(死键×6、死样式五组、--wq-info token、welcome.css 头注)清理;viewerTab pickSavePath 失败补 toast;terminalFreeze 增量切片代理对边界回退;terminalMatchCount 锚点列宽字符口径注释钉死。

豁免(留痕):

- `"-:-"` 哨兵指纹:双缺 meta 会话身份闸失效 —— 触达面窄且测试钉明有意设计;活 PTY 必有 pid,实际不可达 [INFERENCE]。
- undo 预览方向不反转(+/− 是 revert 方向):三处文档已声明裁决,纯信息性。
- webglBench pumpFrames 递归泵 O(帧数) 挂起上下文:bench 页专用,不进主包热路径。
- anim explorer `/select,` 逗号目录名误解析:单 arg 引号包裹是 Rust std 转义既有口径,目录含逗号属罕见 [INFERENCE]。
- fs_usage JoinError 时 label 不可得(句柄 panic 稀有):已按超时形态带 label 入表,此条不存在残留。

## 交叉面自查

- 版本源六处(package.json / Cargo.toml / Cargo.lock / tauri.conf.json / mobile-app/native-shell/Info.plist / project.yml)齐 0.4.0。
- **CHANGELOG 完整性缺口(发版级)**:小节定稿(ae67e261/89003a2e)之后落的 4 个用户可见特性零录入 —— 已补:首页 QUOTA 面板改版(摘 RESUME/TOKENS)、会话预设 worktree 范围、存储审计表比例条/合计行、WebGL 基准页;并修正「九类目」→「十二类目」、「512KB 字节」→「512K 字符」、LRU 3000→5000、quota 聚焦不记流水的措辞,新增「二轮发版评审收口」修复条目。
- bench「主包零携带」口径:独立 rollup 入口不进主 chunk 属实,但 `vite build` 产物 dist/bench-*.js(450KB/gzip 117KB)随 Tauri 整包携带;CHANGELOG 已按「devDep 零进主包」措辞。
- 预设存储读侧缺陷与 notify/log.ts、wiki 同形 —— 三处同守卫已是本仓第三例,后续可考虑沉淀 kernel 公共判定(本次不动,避免跨插件耦合)。

## 验证

- `pnpm vitest run`(受影响全域):241 文件 1911 测试全绿(含翻转重写的 turnMatch / anchorJump / messageAnchors / sessionPresets 钉子,新增 promptContentByRef 三元组行为、sessionPresets 读失败拒写、findAnchorRow occurrence 三例)。
- `cargo test` 368 passed / 0 failed;`cargo clippy --all-targets -- -D warnings` 绿;`cargo fmt --check` 绿。
- `pnpm check:gate` + `npx react-doctor` 见当日收口提交。
