# 会话看板:热力月历 + 泳道时间线日视图(插件化落地)

日期:2026-09-16
状态:已落地(实施完成,六轮原型迭代 + 插件化实施记录见下「实施纪要」)

## 背景与目标

侧栏会话列表是线性流:按工作区 × 引擎罗列,看不到「哪天干了什么、当天怎么过的、哪些会话还没看」。
重度用户磁盘上有 ~2000 会话(本机实测:grok 2455 / pi 428 / codex 234 / claude 133),需要时间维度的回溯与治理面。

目标(对应原型已定稿形态):

1. **热力月历**:格底色 = 当日会话数热力(sqrt 分级,当月最大值归一),格底 3 点 = 主引擎,右上玫红点 = 当日存在「结束-未查看」;
2. **聚焦日大视图**:其余周折叠为周条 + 24 小时节律条(小时分布,点段定位)+ **泳道时间线**(左侧共享小时时轨「HH:00 · N 个会话」+ 五态垂直泳道按小时分带对齐);
3. **生命周期五态纳入管理**:运行中 / 空闲 / 结束-未查看 / 结束-已查看 / 已归档;查看即自动归档(默认规则);
4. **卡上重命名**、引擎/状态过滤、← → 逐日、Esc 收起。

## 方案取舍

| 决策点 | 选定 | 否决 | 理由 |
|---|---|---|---|
| 载体 | 新插件 `session-board`:中央 tab(kind=session-board,`ctx.registerTabContent`)+ 侧栏快捷动作(`ctx.registerSidebarAction`)开 tab | welcome.footer 首页面板;overlay 全屏层 | 看板是管理面不是首页装饰;tab 可与终端 tab 并存、可 ⌘W 关;overlay 挡幕布 |
| 数据范围 | 当前工作区(与侧栏/归档 key 同一语义) | 全工作区全局看板 | 归档/置顶/删除 overlay key 均含 workspaceId,三段身份缺一不可;跨区聚合先破契约 |
| 查看动作 | 点卡 = `host.openDiskSession`(resume)+ `archiveSession`(默认自动归档规则)+ toast | 只看不归档 | 用户明确「已查看 默认进入已归档」;归档可逆所以默认激进 |
| 热力度量 | **会话数**(当日落会话计数) | token 用量 | `CliDiskSession` 无 token 字段;逐文件读 JSONL 聚合在 ~2000 会话下不可接受。留扩展位:adapter 未来提供 per-session token 时换度量,UI 分级管线不变 |
| 状态数据源 | 全部复用既有层:运行中/空闲 = `host.isTurnActive`;已归档 = `sessionArchive`;**未查看 = 未归档 且 modifiedAt 距今 < 14 天**(年龄启发) | 新增 kernel `sessionSeen` 已查看层 | 自动归档恒开时 seen 层只写不读(查看即归档,不存在「已查看未归档」中间态)= 死代码;年龄启发顺带消灭存量会话首跑全部标未查看的洪水。unarchive 后近期会话回「未查看」= 注意力重新浮出,语义成立。未来若加「关闭自动归档」设置,seen 层才是必需品(扩展点留档) |
| 未查看的活会话 | 并入「空闲」道,卡上带未读点(复用侧栏「空闲-未查看」语义) | 第六条泳道 | 泳道五态是用户钦定结构;活会话未读是转瞬态(点开即清),单列噪声大于信息 |
| 重命名 | 复用 `sessionTitles` 覆盖层 + kernel `RenameInput` | 写回 CLI 磁盘 title | 既有架构决策(定长 pad 覆写风险),零新语义 |

## 改动面

- **新插件 `src/plugins/session-board/`**:`index.tsx`(注册:tab 内容 + 侧栏动作)+ `BoardTab.tsx`(月历/周条/工具栏)+ `DayPanel.tsx`(日头/节律条)+ `SwimTimeline.tsx`(泳道时间线/卡片/重命名)+ `boardData.ts`(扫描/活会话合并/五态推导)+ `session-board.css`;`src/plugins/index.ts` 的 `allPlugins` 加一行;**kernel 零改动**;
- **locales/en**:新增文案词条。

UI 形态、交互契约、密度策略全部以 `docs/design/session-calendar-heat-agenda.html` 为准(六轮目检定稿);月历/泳道样式按应用既有 token(--tmd-* 变量)重写,不照抄原型像素。

## 验证

1. `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` 全绿;
2. 1421 dev server + 浏览器桩(Tauri IPC stub)目检:假会话数据下月历热力/周条折叠/节律条/五态泳道分带对齐/重命名/状态过滤/查看自动归档流转;
3. 真实 `pnpm tauri:dev` 窗口由用户最终目检确认(待办)。

## 实施纪要(2026-09-16)

- 落地件:`src/plugins/session-board/`(index 注册 / boardData 数据装配 / BoardTab 工具栏 / CalendarGrid 月历 / DayPanel 日头+节律 / SwimTimeline 泳道时间线 / BoardButton 左上角入口)+ `locales/`(插件自带词典)+ `allPlugins` 一行;kernel 零改动,与方案取舍一致。
- 契约测试同步:`tabContent.contract.test.ts` OPENABLE_KINDS 增 `session-board`;locales en/ja 双语齐。
- 桩目检(1421 + Tauri IPC stub):13 会话/10 未查看/5 热力格全吻合;日视图 5 时带 × 5 泳道对齐;重命名/查看自动归档(5→4/0→1)/恢复/状态过滤/节律高亮/← →/Esc 全通;窄编辑区(536px)泳道横向滚动可达已归档列。
- 修正项(vision 复核发现):泳道区 `overflow-x: auto`(5×108min + 时轨 56 > 窄编辑区宽);rule 徽标 nowrap。
- 门禁:typecheck / arch-boundary / file-size / vitest 205 文件 1634 用例 / build / react-doctor 100 分全绿。

## 实施纪要补遗(同日,入口 + 评审收敛)

- 左上角入口:`BoardButton` 经 `header.leftCluster` 贡献(与内置终端同簇:终端 → 看板 → 市场 → 回首页 → 折栏),`useEditorTabs` 订阅驱动激活态。
- reviewer 评审(6 P2 + 6 P3)全部收敛:重命名期 ← → Esc 输入框守卫;活会话表变化联动重扫(PTY 退出不再蒸发);远程来源工作区显式空态「远程工作区暂不支持看板(仅本机磁盘)」;年/月/日/周经 Intl 按设置语言本地化(格式器按语言缓存);词典迁 `src/plugins/session-board/locales/`(插件词典纪律);cwd 前缀补分隔符;workspaceDisplayName;去 `?? list[0]` 静默兜底;活会话兜底 ts 首见钉死;`.sb-strip-n` 规则。留档:自动归档加速 sessionArchive 200 条容量逐出(侧栏同款既有语义,可逆)。
- 门禁复跑:typecheck / vitest 1634 / arch / file-size / build / react-doctor 100 全绿;桩目检左上角入口全链(按钮 → tab 激活 → BoardTab → 月历 → 日视图)。


## 实施纪要补遗二(2026-09-17,设计对照查漏补缺)

- 对照定稿原型逐项复核,补齐四个未落地特性:①列头折叠(点列头折叠/展开,跨日保持,折叠列各时带留空);②节律条点段滚动到对应时带(原有高亮保留);③悬停卡反标节律段(离开即清);④轻反馈 toast(本面板局部,PluginMarketPage 同款模式:已查看→自动归档 / 已打开 / 已重命名)+ 工具栏热力图例(少 ▧×5 多 · 底点=主引擎)。
- 已核对为设计内有、实现内已有:热力 sqrt 四级/格底 3 引擎点/未查看玫红点/未来格淡化禁点/今天描边/周条折叠/节律条主引擎色/日头五态计数/双规则条/重命名/恢复/过滤联动/← → /Esc。
- 设计内但按 spec 取舍豁免:token 度量(热力/列头/时轨组头的 token 字段,CliDiskSession 无该字段,留扩展位);卡 meta 的工作区列(看板本身单工作区,冗余)。
- 桩验证(sbv7,9 会话数据):折叠 3 卡→0 且跨日保持、展开恢复;← → 逐日;节律点段高亮卡(当日内容无溢出,scrollTop 0 为正确行为);悬停卡反标节律段;点未查看卡 toast「已查看:「id」→ 默认自动进入已归档」+ 卡移入已归档列;重命名 toast;图例在屏。门禁复跑:typecheck / vitest 1634 / arch / file-size / build / react-doctor 100 全绿。

## 实施纪要补遗三(2026-09-17,覆盖层化 + 创建时刻定死)

- **看板改为覆盖层**(用户反馈「要像插件市场/回到首页的切换效果,不要 tab」):撤 `registerTabContent`,改经 overlay 挂点贡献 `BoardOverlay`(fixed inset-0 不透明盖住三栏,市场页同款「下层保持挂载零回放」语义);`boardOverlayStore` 插件局部开关,左上角按钮/侧栏动作 toggle;Esc 两段式(先收日视图再收板);点卡打开/resume 会话后自动收板让位幕布。`OPENABLE_KINDS` 同步撤 kind。
- **日历落位按创建时刻定死**(用户反馈「点老会话导致时间错位跳到最新日期」):根因 = `ts: createdAt ?? modifiedAt`,多数引擎 adapter 未填 createdAt → resume 刷 mtime → 卡片跳日。修复 = 六家 adapter 补填 `CliDiskSession.createdAt`,全部复用各家既有数据源零新增解析:claude/qoder 复用身份自证 `readXSessionIdentity`(file-history-snapshot/行内 timestamp ≈ 创建,resume 不改写);codex `extractMeta` 同窗 regex 提 payload.timestamp(零新增 IO);grok `parseGrokSummary` 增 `created_at`;kimi `state.createdAt` 透传;opencode `time_created` 透传;pi/omp 原有。dsh 宿主流无创建字段,留 modifiedAt 回退。桩实证:bump mtime=今天后重扫,9 会话仍钉死 9/1(未查看态随活动正确升为 9)。
- 门禁复跑全绿(typecheck / vitest 1634 / arch / file-size / build / react-doctor 100);桩目检:覆盖层开/两段 Esc/点卡自动收板/编辑 tab 条零「会话看板」残留。

## 实施纪要补遗四(2026-09-17,深评收敛)

- 看板本体 P2 ×7:未来格改 `>= 明日 0 点`(旧 +24h 判定放过明天);翻月清 selDay(选中日不在视图周易致全部周塌成折叠条);打开卡的 toast 删除(覆盖层同批收起必然卸载 toast,幕布现身即反馈;重命名 toast 保留);联动重扫保旧行不闪空(仅切工作区显扫描态);profiles 改 lazy useState 钉引用(host.getCliProfiles 每渲染返回新数组,diskRows memo 每渲染必炸);diskRows deps 补 sessionArchive/sessionDeleted(否则恢复/删除后看板僵化);mergeLive 磁盘行 Map 查找替代线性 find。
- 看板本体 P3:日头补 ← → 逐日 / Esc 收起提示条;扫描态接「正在扫描会话…」;LIVE_FIRST_SEEN 随活会话消失剪除;删死钩子(`.sb-lane-h > svg` 规则、`sb-lc-*`/`sb-st-*` class、DiskScan.titles 字段);UNSEEN_WINDOW_MS 收私有。
- adapter 侧 P2 ×2:**omp/pi 本机路径补 createdAt**(此前主力引擎的跳日 bug 实际未修);claude/qoder/omp/pi 的创建+标题解析合并为 `readHeadSessionMeta` 一次读头双解析(窗口 identity 8KB ⊂ 标题浅窗 32KB,扫描净增 0 次磁盘 IO);opencode createdAt 零值按未填回退;kimi state.json createdAt 留 legacy 注释声明。adapter P3-2(remoteExec 复用看板管线)留档待远程接入。
- 验证:typecheck / vitest 1634 / arch / file-size / build 全绿,react-doctor 100。

## 实施纪要补遗五(2026-09-17,覆盖层头部适配 + 点卡不收板)

- 覆盖层由 `inset: 0` 改为 `top: var(--titlebar-height, 33px)`(只盖 titlebar 之下主区,与插件市场同区),撤自带头部细条(标题+×):titlebar 左侧高亮按钮即开关,与「再点市场按钮退出市场」同心智;Esc 收板不变。
- 点卡改为「只开 tab 不收板」(用户明确要求不自动跳转,点 tab 才看现场):`dayOpen` 不再调 `closeBoardOverlay`;未查看卡照旧归档 + resume(openDiskSession 内部置 active,收板后会话即在)。
- 桩目检(1421 + sbv11):几何断言 overlay.top == titlebar.bottom(33);点卡后 overlay/日视图均保持打开;五道列头/时带/计数无回归;门禁复跑全绿。

## 实施纪要补遗六(2026-09-17,获取不准根治:双日落位 + 默认全部工作区)

- **问题**:「会话列表获取不准,今天一个会话都看不到」。实采磁盘:今天(9-17)只有 1 个新创建会话(在另一个工作区),其余全是 resume 老会话(claude 头 timestamp 9-6 / omp 首行 9-15)。「创建定死单日落位」把它们全锚在过去 → 活跃日看板空;叠加单工作区过滤(主战场 tmd-cli 不在当前工作区)双杀。
- **修复**:①**双日落位**——落位键 = 创建日 ∪ 最近活跃日(`modifiedAt` 日界),同日则单日:创建锚不跳日(补遗三诉求保留),活跃日也现身(本次诉求);②**默认全部工作区**——工作区从单选 pill 改选择器,默认「全部」(扫描全部工作区磁盘+活会话全局归属,卡片带工作区徽标,归档 key 按行归属 wsId),选择单工作区则过滤回单区语义。boardData 拆分出 boardRows.ts(merge 纯函数层,守 300 行)。
- **生产缺陷顺手修**:readHeadSessionMeta 在并行迭代中丢了非字符串守卫,异型 IPC 返回({lines} 而非 string)会炸掉 Promise.all 使该区 0 会话——守卫补回。
- 性能:多工作区扫描并行(.then 链,react-doctor 不认回调内 await);活会话归属 id 查找 Map 化,cwd 前缀兜底 for-of。react-doctor 100。
- 桩目检(sbv15):3 会话(pi×2 跨两工作区 + claude)全收,双日落位精确(9/1×1 创建 + 9/16×2 创建 + 9/17×3 活跃);选择器默认「全部」。桩保真度教训:pi slug = `--`+cwd **去前导斜杠**、只换 `[\\/:]`;pi listSessions 前置 `quota_env_value(PI_CODING_AGENT_DIR)` 须桩 null(桩 default 返 [] 会炸 .replace);pi session 行必须含 `id` 字段(解析器必填校验,缺则整条丢弃)。

## 实施纪要补遗七(2026-09-17,会话生命周期五态定稿 + 退出即归档)

- **定义(用户定稿)**:待运行(原「空闲」)⇄ 运行中;待运行关闭(进程退出)→ 再入已归档;尾巴未读的退出 → 结束-未查看(注意力保留);查看 → 结束-已查看(瞬态)→ 已归档;已归档打开 → 待运行;↩ 恢复才显式解除归档。超 14 天未处理仍视同已查看(既有语义,养未查看计数)。
- **差距与修复**:①「空闲」标签改为「待运行」(en Waiting / ja 待機中);②已查看原为不可见的瞬时动作 —— 归档落定后 2.4s 瞬态窗内显示「结束-已查看」再转「已归档」(mergeDisk 收 settings.sessionArchive 按 archivedAt 推导);③「关闭→再入已归档」原不存在(干净关闭落回未查看)—— 新增 boardExit.ts 订阅 kernel.sessions.exited:有归属工作区 + 有稳定身份 + 尾巴已读 → 写归档标记(emit 早于 removeRoom 完成,活表可查,与 checkpoints 同序);④归档标记跨打开/关闭持久已成立(无任何路径在打开时撤归档),用测试钉死。
- **另一根因修复(生产序)**:boardRows 模块级 profileById 在 import 期冻结(早于一切 activate 的 registerCliProfile)→ mergeLive 恒空 → 活会话两道整条死路且错以磁盘行示人。改为逐会话 host.getCliProfile() 活查。boardRows.live.test.ts 以「静态 import 先于注册」生产序固守。
- 测试:+7(boardRows.disk 3 + boardExit 4)。门禁:typecheck / vitest 1643 / arch / file-size 全绿。

## 实施纪要补遗八(2026-09-17,归档会话恢复对话即解除归档)

- **用户实测推翻补遗七的一处定稿**:「↩ 恢复才显式解除归档」导致归档会话恢复对话后
  生命周期链不重启 —— 侧栏默认视图活行被 isArchived 过滤、归档视图仍以磁盘行示人,
  看板 mergeDisk 亦按 archivedAt 推「已归档」,running 态无处呈现。
- **修订语义**:已归档会话经任何路径恢复对话(侧栏归档视图点开 / 看板点卡 / WSL 远程
  恢复 / CLI 内 /resume 探测绑定)即解除归档,生命周期链重启(待运行 ⇄ 运行中);
  干净退出由 boardExit 再归档收口,「待运行关闭 → 再入已归档」往返不变。显式 ↩ 恢复
  (看板泳道 / 会话管理批量)语义不变。
- **实现**:绑定唯一写入口 identityLedger.bind 成功且 meta 带归属工作区时
  unarchiveSession(key(workspaceId, engine ?? profileId, cliSessionId)),与
  archiveExitedSession 同构互逆;adoptSpawned 改为先 setSessions 后 bindIdentity
  (与 ssh/shell adopt 的 refreshSessions 先行同款序)—— 绑定刻账本可查 meta,
  顺带修复磁盘回放指针覆写在 resume 路径被跳过的同源缺陷。
- 测试:host.test.ts「归档会话恢复即解除归档」(同时钉住先刷表后绑定的顺序,
  回退任一即红)。