# 0.4.0 候选 8 项(向内治理批)· 闭环深化可行性分析

日期:2026-10-18 · 状态:深化稿 v2(待大仙拍板)
本轮变更:大仙裁掉候选 4(composer 敏感信息守门);其余六项按「深入闭环调研打磨」重构;新增 2 个特性(⑦ 会话转录导出、⑧ checkpoint↔转录互跳)。
调研方法:七路并行源码核对(保留律/冻结/通知/预设/检索/存储/缺口盘点),全部结论带 `路径:行号` 锚点,非推测。

## 移出与不投记录(防翻案)

- **composer 敏感信息守门**:大仙 2026-10-18 拍板删除,示例页已撤。
- **助手消息入索引**(原检索增强子项):userMessages.ts 五种行型解析器只产 user 行,assistant 行需新写一族解析器(仅 claude 的 model 判别有现成注释),且索引缓存 value 形状变化要加版本戳——成本远超「加个开关」,移出本批,如做单独立项。
- **全局命令面板(⌘K)**:缺口盘点判弱——⌘K 已被 composer CommandDrawer 占用(CLI 命令/技能/MCP/插件四分区),global 注册表命令已有 shortcutCommands.ts + HubEntry 两个消费面;统一入口性价比低于转录导出,不投。
- **候选 1(24h 保留律)落地对账**:深化发现**已落地**(见下),从「待实现候选」转为「对账 + 待拍板缺口」。

---

## 1. 工作区会话保留律(24h)——「已落地,示例页改为对账」

**深化结论**:大仙 2026-09-19 拍板的三条口径已全量实现(spec `docs/superpowers/specs/2026-09-19-session-hygiene-auto-archive-design.md`),实现本体 = `src/plugins/workspace/sessionSweep.ts:26-77`。

**对账表**:

| 拍板口径 | 实现锚点 | 状态 |
|---|---|---|
| ① 默认视图仅留 24h | `settingsHygieneHours` 默认 24(`settingsDefaults.ts:59-69`),sanitize 白名单 `[12,24,48,168]` 回落 24(`settingsSanitize.ts:250-256`) | 已落地 |
| ② 超窗自动转归档视图 | sweep 门控后 `archiveSessions(keys)` 批量单次写盘(`sessionSweep.ts:62`);归档视图 `workspaceArchiveView`(`useCliSessionGroup.ts:58`) | 已落地 |
| ③ 空会话直接删不进归档 | `allowDelete && profile.isDiskSessionEmpty` 才删(`sessionSweep.ts:63-71`);六家族钩子全实现(omp/pi 出生文件标记、claude/codex/qoder jsonl 头检、grok chat_history、kimi 新老布局、opencode sqlite 计数、dsh host blank) | 已落地 |
| 懒扫描零轮询 | 唯一挂点 = 扫描结算 effect(`useCliDiskScan.ts:87-110`),文件头明言「零轮询,事件驱动」;全库无周期扫描定时器 | 已落地 |

**豁免集(已实现)**:门控序 = `modifiedAt<=0 永不扫 → 活会话跳过 → 已归档/已删/保留(keep)/置顶跳过`(`sessionSweep.ts:48-56`);keep 层 = 手动取消归档时写入(`SessionManage.tsx:122-130` 联动 `sessionKeep.ts`);归档≠删盘,磁盘文件不动。远程(WSL/SSH)分支 `allowDelete=false` 只归档不删盘。

**待拍板缺口(本轮真正要大仙决策的)**:
1. **长期不展开工作区就不清扫**:扫描事件驱动 = 不打开该工作区永不触发;要不要「应用启动时对活跃工作区补扫一次」(仍非定时器)?倾向:启动补扫一次,幂等零成本。
2. **keep 层容量 200 未论证**:归档层为容量从 200 提到 2000(`sessionArchive.ts:24`),keep 沿用 `overlayEvict` 默认 200(`sessionKeep.ts:26` 未传第三参);高密度手动保留会静默逐出最旧 keep——建议同提到 2000。

**成本**:零(已落地)+ 两处小补丁。**风险**:无新增;删除行为默认开(sessionHygieneEnabled=true)是既定拍板,示例页如实展示。

## 2. 后台会话分级保活(幕布冻结)——「挤除升级为快照回归」

**深化修正**(相对 v1 两处硬伤):
- `sessionTabsMax` 默认 **4**(1-10,`sessionTabs.ts:27-31`),不是「全部」——现状就是「超出 4 个挤除即卸载,回归全量回放」。
- 卸载前 `buildReseedScreen` 快照**已经在算**(`TerminalView.tsx:237` 卸载清理里 `host.reseedScreenMirror(...)` 喂 ask 镜像)——本项不是新算快照,是把这份现成快照升级为「重开即上屏」的回归源。

**闭环**:
- 触发:open 会话超出 `sessionTabsMax`(MRU 修剪 `state.ids.slice(-max)`)→ 现状直接卸载。
- 本项:卸载路径挂冻结快照存档(每会话 `{cols,rows,text}`,LRU 少量,内存);重开该会话 → 快照先行上屏(`terminalReplay.ts` 的 `QUIET_READY_MS=500` 静默判据下无遮罩)→ 历史后台回填。
- 回填数据源(已核实):内存 `outputBuffers`(纯内存,精确字节尾,`getBytes()` O(1))+ 磁盘 `session_history_page` 512KB 按字节分页(`terminalHistory.ts:42-100`),锚点 = `sessionLogSize - bufferBytes`,两段字节偏移无缝拼——**冻结不引入任何新数据面**。
- 失败路径:快照缺失/几何变化(cols/rows 不符)→ 回落现状全量回放,零行为劣化。
- 设置:不新增设置项(复用 `sessionTabsMax`);「冻结存档」默认开,可在设置关(关 = 现状挤除)。

**状态对清单(实现时逐对冒烟)**:激活×冻结(撤冻结=快照即上屏)/ 后台×冻结(ask 镜像照常,`getTerminalHandle` 互斥判定不变)/ 栏折叠×冻结(SessionTabBar 返 null 但 kept 集不动,正交)/ 最大化×冻结(纯 CSS 零宽折叠,永不卸载语义不变)/ 重载恢复×冻结(冻结存档纯内存,⌘R 后全部回落现状,readopt 磁盘尾路径兜底)。

**成本**:中(比 v1 估的低——快照与回填两半都是现成件,新写的只有存档 LRU 与重开分流)。**风险**:幕布回归敏感区不变,状态对逐条冒烟是硬要求。**验证**:造 5+ 会话挤除,重开最旧会话对比现状(遮罩时长/首屏内容),`terminalReplay` 既有测试链上补快照路径用例。

## 3. 应用内通知中心——「三处 dispatch 旁挂流水 + 右栏面板」

**已有锚点**:notify 订阅三类信号——`askDetected(sessionId)`、`turnSettled({sessionId,unviewed})`(仅 unviewed:true 发)、`sessionExitedDetail({title,profileId})`(`notify/index.tsx:60-92`);闸 = `shouldNotify(kind,settings,host.isWindowFocused())`,**聚焦一律静默**(`logic.ts:30-37`);OS 点击回调统一发 `sessionViewRequested` + `setActiveSession`(`index.tsx:36-39`);额度侧独立(30s 首查 + 10min 间隔,`quotaWatch.ts:10-15`)。右栏面板注册面 = `ctx.registerFilePanel({id,label,icon,component,pinnedByDefault?})`(`plugin.ts:124-131`、`filePanel.ts:24-40`),已注册先例 10+。

**闭环**:
- 数据:全局单文件 `~/.tmd-cli/notify-log.json`(通知是全局语义非工作区;wiki 同款 `{version,entries}`,`wiki.ts:59-83`);三处 `dispatch` 调用点旁挂「写流水」——**聚焦也记、失焦才发 OS**,这是中心相对 OS 通知的净增量。
- 过期:追加时顺带过滤 `ts < now-7d`(wiki 的 addEntry 模式,省定时器)+ `ENTRIES_MAX` 条数上限兜底;7 天可配(settings notify 段加字段)。
- 回跳:流水条目点击 = 同 OS 通知回调路径(sessionViewRequested,用户手势合规;唯一消费方 `editorMaximized.ts:41-43` 幂等摘最大化)。
- 免打扰窗(22:00-08:00 可配):**现有闸分散,需三处判定**——`shouldNotify`(logic.ts,单测已在)+ `playAskSound`(kernel/askSound.ts)+ `observeTurnSettled`(turnSound.ts:73-76,3s 延迟确认闸);免打扰只静 OS/声音,流水照记。
- 失败:流水读坏 JSON → 空文档不抛(wiki parse 先例);写失败静默(flush 下次)。
- mobile:不双写(`sendOsNotification` web 态恒 false,`ipc.ts:1013-1015`;手机树独立)。

**成本**:低-中。**风险**:与 turnEndSoundEnabled 等既有布尔的口径叠加要在设置页讲清;流水体积(条数上限 + 7 天双闸可控)。**验证**:三事件各造一条 → 断言流水/OS/声音三通道在「聚焦/失焦 × 免打扰开关」四象限的行为矩阵。

## 4. 会话预设(一键起会话配方)——「两步管线,anim 是模板」

**已有锚点**:`host.spawnRawSession(profileId, spec, workspaceId?, {activate?, identityTrack?})`(`host.ts:172-183`);spec = `{command,args,cwd,env,title}`,**prompt 不进 spec**——spawn 成功后 `setPendingPrompt(sessionId,prompt)` / `setPendingRefs` 经 pending 队列在会话就绪后注入(`animProjectsTab.tsx:181-204`);两步管线(取消零副作用 / 桩先落盘、spawn 失败清理)在 `anim/startSession.ts:60-130`,纯 DI 可 node 测试。identityTrack 语义 = spawn 前快照 listSessions、spawn 后绑定磁盘身份(`sessionSpawn.ts:43-67`),真 CLI 必开否则时间线/审批线全盲。

**预设实体**:`~/.tmd/session-presets.json`(agents.json 同款单文件 + 内存单源 + emit,`assets/store.ts:84-108` 先例);字段 = 名称/引擎+模型/范围(当前工作区|新 worktree)/初始提示词(引用提示词库或内联)。
- 引擎候选 = `defaultEngineCandidates()`(有 listSessions 且非 dsh,`defaultEngine.ts:19-21`),候选空 → 禁创建防空 spawn(`WorktreeSessionDialog.tsx:122-123` 先例);模型默认跟随 `workbenchDefaultEngine`(`settingsTypes.ts:124`)。
- 提示词库引用:**PromptEntry 无 id**,身份 = `(scope, wsId, name)` 三元组(`promptStore.ts:67`);预设存三元组,消费时 `promptContent` 现读;改名/删除 → 预设条目「悬空」标注(失效处理)。
- worktree 范围:分支 slug 复用 `finalBranchName(base, conflictSet)` 递增(`worktreeSession.ts:92`);里程碑回滚配方(`worktreeCreate.ts:39-71`,worktreeAdd 成功才可回滚、spawn 后不回滚)。
- 入口:工作区右键菜单段(循 worktree 项「恒显 + 弹层内报错」先例,`SessionMenu.tsx:101-119`;补 entryContract 同款测试)+ 会话右键「以此预设起新会话」(onDelete 缺省隐藏模式,`SessionContextMenu.tsx:44-45`)。
- 失效:预设引用的工作区 id 消费时以 root 复核(`wtSessionOf` 先例 `worktreeSession.ts:60-66`),失效标灰不静默跳转。

**成本**:低-中。**风险**:pending 注入时序(会话就绪前用户手动输入的竞争)——anim 已趟过,照抄;提示词三元组悬空的编辑面板改绑体验。**验证**:预设 → 起 worktree 会话 → 时间线/审批线可见(identityTrack 全装配)+ 取消中途不残留桩。

## 5. 会话检索增强——「时间过滤一行谓词 + resume 后行级定位」

**已有锚点**:索引条目 `{profileId, cliSessionId, title?, modifiedAt, messages[](仅 user 全文)}`(`session-search/indexer.ts:22-45`);`searchSessions` 谓词循环在 `indexer.ts:189`,时间过滤 = 循环头加一个 `modifiedAt` 区间判断,零结构改动;时间 chip 复刻引擎 chip 模式(`SearchOverlay.tsx:133-155`,静态枚举比动态引擎集更简单);mtime 来自 `listSessions` 的 `CliDiskSession.modifiedAt`(mtime 缓存判等,增量零读取)。

**命中行级定位链(关键深化)**:
- 现状点击 = 关浮层 + `sessionViewRequested` + `openDiskSession`(resume spawn,`SearchOverlay.tsx:76-79`)——不定位任何行。
- 本项:命中消息文本就是 `CliUserMessage.text` 同源(`userMessages.ts` 提取),可直接构造 `UserMessageAnchor`(id 用 fnv1a32,类型必填字段需决策填法)→ `openDiskSession` 返回后等 xterm handle 注册(handle 晚于激活,需等 terminalRegistryVersion 或事件——**这是唯一接线风险点**)→ `jumpToAnchor`:needle 24/14/8 字符梯队 buffer 匹配 + 不在 buffer 时 `loadEarlier` 逐页重试上限 12 页(`anchorJump.ts:48-77`)。
- 降级:定位失败 → 红色闪烁(`MISS_FLASH_MS=900`,TimelinePanel/AnchorRail 同款语义)+ toast 提示,不猜测。
- **助手消息入索引移出本批**(见头部记录)。

**成本**:低-中。**风险**:handle 就绪时序;超长 needle 梯队 miss(fallback 已有)。**验证**:活会话命中(滚出屏)/ 磁盘会话命中(resume 后跳)/ 超页命中(12 页内)三场景各一。

## 6. 存储管家(磁盘体检)——「体检要新命令,清理几乎全是现成件」

**体检面**:
- fs 原语无 size/stat(`ipc.ts:394-470` 清单核实)→ **必须新增一个 Rust 只读体检命令**;配方照抄 `dir_size`(`commands_worktree.rs:119-136`,手写递归、跳 `.git`、不跟符号链接、spawn_blocking、有单测),扩成返回 `Vec<{category, bytes, count}>`。
- 类目与真实路径(全部已核实):checkpoints `~/.tmd-cli/checkpoints/<md5(cwd)>/{ledger.jsonl,states.json,objects.git}`(`checkpoints/store.rs:81-105`);docgen `~/.tmd-cli/workbench/docgen/docs/<entryId>/v<N>.md`(`docgen/paths.ts:32-45`);omp `~/.omp/agent/sessions`、pi `~/.pi/agent/sessions`、claude/qoder `~/.claude|~/.qoder/projects`、codex `~/.codex/sessions/YYYY/MM/DD`、kimi `~/.kimi-code/sessions/<wd桶>`、grok `~/.grok/sessions/<encodeURIComponent(cwd)>`(各 cli-*/edits.ts|sessions.ts 常量);`.tmd`(wiki/工作台)。
- 条数联动:`isDiskSessionEmpty` 六家族钩子已在,空会话条数免新检测;体检结果本地缓存,点「开始体检」才扫。

**清理面(白名单,默认全关)**:
- checkpoints:**`checkpoint_prune(cwd, keep, ttl_days)` 命令已存在**(`checkpoints/commands.rs:147-150`、`prune.rs:15-69`,账本 rewrite + 清悬空 states/孤儿对象)——零新删除逻辑;按账本 ts 不按 mtime,天然避开 Linux coarse-clock 陷阱(`tests.rs:83-87` 注释)。
- docgen 已归档旧版本:`docState==="archived"` 条目的 `docs/<entryId>/` 目录,删除先例 `removeEntryDir` 走 `ipc.fsRemovePath`(`paths.ts:91-93`)。
- 确认流:行首击展开明细卡(ConfirmCard 先例 `BatchRowParts.tsx:39-92`)+ 3s 无操作武装回弹(`marketInstalledRow.tsx:149-153` 先例)组合。
- **红线**:各家 CLI 会话目录只报告不代删;`.tmd` 只读(空会话删除归保留律)。

**设置挂点**:`ctx.registerSettingsSection({id:"storage",title,icon,order,tabs:[...]})`(`settingsRegistry.ts:9-30`,assets order=45 先例 `assets/index.tsx:86-98`)。

**成本**:中(体检命令 + 分区 UI;清理面是组装)。**风险**:误删——白名单默认全关 + 明细二次确认 + CLI 目录零触碰三道闸。**验证**:体检数字与 `du` 对账;prune 后 `checkpoint_list` 一致性(既有测试链)。

## 7. 会话转录导出(md 快照)——「新特性,九家数据全在,样板可照抄」

**缺口实证**:session-viewer 全只读零导出(`viewerTab.tsx` grep copy/export/save 无业务命中);structured-session、wiki、docgen 均无会话级导出路径。数据面:`readSessionTranscript` 为 profile 可选声明,**九家全部声明**(piFamily 同产 omp/pi,其余各家自带);块结构 `CliTranscriptBlock {id, role, text, images?, startedAt?, tool?}`(`cliSessionTypes.ts:125-143`)。

**闭环**:
- 入口:会话查看 tab 工具行按钮(现有刷新钮旁,`viewerTab.tsx`);活会话 liveOverlay 同按钮后补(数据同源 `readChangedTranscript`)。
- 导出:`blocksToMarkdown()` 纯函数(可 node 测试)→ docgen 样板三件套 `pickSavePath → writeText → toast`(`DocGenFoot.tsx:49-63`,含 Windows 保留设备名加尾 `_` 处理)。
- 方案取舍:tool 块 → 折叠一行元信息(保检索价值不淹正文);thinking 块 → 丢弃 + 计数标注(会话原文仍在客户端);images → 首版丢弃 + 计数标注(旁路文件目录列为二期可选);`truncated:true`(32MB 预算)→ md 头部标注「截断版」。
- 失败:profile 未声明 transcript(理论不存在)→ 按钮禁用 + 提示;写盘失败 → toast 报错不落半文件(writeText 原子写先例)。

**成本**:低(纯前端,零 Rust)。**风险**:角色映射的取舍要大仙过目(页面已列);长会话 md 体积(块级已截断,可控)。**验证**:omp/claude 各导一条 → md 结构与 viewer 一致性目检;Windows 文件名 sanitize 用例照抄 docgen。

## 8. checkpoint↔转录时间线互跳——「新特性,账本里躺着钥匙」

**锚点(深化核实)**:账本条目 `LedgerEntry {id, kind: anchor|turn|guard|edit, ts, session_id, tmd_session_id, files, turn_files}`(`checkpoints/types.rs:75-114`);轮次 `BatchInfo {index(会话内 1-based 轮次), ts, ts_end?, prompt, engine, attribution: "events"|"git", files}`(`types.rs:177-198`)——**prompt 原文就在账本里**,而转录侧用户消息 = 同一文本(`userMessages.ts` 提取)。即:checkpoint ↔ 转录的映射键 = prompt 文本,而 prompt 文本正是 `jumpToAnchor` 的 needle(24/14/8 梯队 + 12 页回溯,`anchorJump.ts:48-77`)。零 Rust 改动,零新解析器。

**闭环(双向)**:
- A(checkpoints → 对话):CheckpointsPanel 批次行/时间线加「看对话」→ 活会话 `jumpToAnchor(prompt)`;磁盘/已关会话 → openDiskSession(resume)后同链(检索增强同款时序桥,两候选共享)。
- B(对话 → checkpoints):TimelinePanel 每条用户消息挂「本轮 M 文件」chip → 按 `session_id + prompt 文本` 匹配 BatchInfo → 展开该轮 `turn_files` 变更集(复用批内 diff 展示面);miss → chip 不渲染(匹配不到不猜测)。
- 可信度:`attribution:"git"`(推断模式)的提示语义复用现有 UI 文案,不冒充 events 精度。
- 已知边界:CliUserMessage 无时间戳(全量相对时间要动 10 家适配器,`TimelinePanel.tsx:18-19` 注释明言二期)——本项用文本匹配绕开,不碰适配器。

**成本**:低-中(纯前端映射 + 两个面板各一组 chip/按钮)。**风险**:prompt 文本被 CLI 规范化/截断导致 needle miss(降级 = chip 不渲染/闪烁);同名 prompt 多轮(按 session + seq 最近匹配)。**验证**:真实仓库跑 3 轮会话 → 双向跳转各 3 次 + git 归因轮提示正确。

---

## 汇总

| # | 项 | 定性 | 新增面 | 成本 | 建议批次 |
|---|---|------|--------|------|---------|
| 1 | 24h 保留律 | **已落地对账** | 启动补扫?keep 容量 2000(待拍板) | ~零 | 顺手 |
| 2 | 分级保活 | 优化 | 冻结存档 LRU + 重开快照分流 | 中 | 独立批次(幕布) |
| 3 | 通知中心 | 新特性 | 流水文件 + 免打扰三闸 | 低-中 | 顺带 |
| 4 | 会话预设 | 新特性 | 预设实体 + 两步管线复用 | 低-中 | 中批 |
| 5 | 检索增强 | 优化 | 时间谓词 + resume→handle→jump 桥 | 低-中 | 中批 |
| 6 | 存储管家 | 优化 | 体检 Rust 命令 + 白名单清理组装 | 中 | 独立批次(涉删除) |
| 7 | 转录导出 | 新特性 | blocksToMarkdown + 导出三件套 | 低 | 顺带 |
| 8 | checkpoint 互跳 | 新特性 | prompt 文本映射 + 双向 chip | 低-中 | 中批(与 5 共享时序桥) |

排期建议:7/3 先(最薄)→ 4/5/8 中批 → 2/6 独立批次;1 的两个待拍板缺口随任意批次顺手。
