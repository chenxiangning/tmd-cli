# 会话卫生清扫:超期自动归档 + 空会话删除

- 日期:2026-09-19
- 状态:已落地(commit 1e75245;实施纪要见文末)

## 背景与目标

工作区侧栏的磁盘历史会话只增不减:CLI 懒落盘、预热出生文件、适配器空壳(dsh 实测 springboot-demo 41 = 31 非空 + 10 空壳)长年堆积,默认视图被旧会话淹没。现有归档链路只有两条写入口:手动(SessionManage/board)与干净退出即归档(session-board/boardExit.ts),都覆盖不到「打开过但没干净退出」「外部 CLI 直接产生」的会话。

目标:

1. 超过时窗(默认 24h)未活动的会话自动转入归档(默认视图消失,归档视图可见,可随时恢复);
2. 其中的空会话(从未有过用户消息)直接物理删除;
3. 不引入任何定时器/短周期轮询——清扫必须搭既有事件驱动扫描的便车。

## 方案取舍

**A. 展示层惰性规则(否决)**:渲染时把 `modifiedAt < now - 窗` 视同已归档,零写入。
否决理由:① 用户在归档视图手动「取消归档」一条旧会话,下一次渲染又被规则隐藏——取消动作无效,除非再引入 keep 标记,那就回到写盘方案;② 归档语义分裂为「标记的」+「过期的」两套,所有消费方(useCliSessionGroup / RunningZone / session-board)都要双规则过滤,长期熵增。

**B. 扫描结算点清扫 + 写既有覆盖层(选定)**:每次磁盘扫描结果落定后跑一遍清扫,写 `settings.sessionArchive` 覆盖层标记,空会话经 profile 钩子判定后物理删除。
选定理由:① 触发面为零新增——磁盘扫描本来就是事件驱动(展开工作区 / 手动刷新 / 绑定跳变 / 标题退避补扫),应用打开、工作区展开这些用户必然经过的路径天然触发清扫;② 复用全部既有语义:归档覆盖层、删除 tombstone、makeOverlay 逐出、MERGE_TS_FIELDS 跨实例合并,增量代码集中一个新文件;③ 写入落 settings.json,重启不丢。

**C. 后台定时清扫(否决)**:setInterval 周期扫。用户明确否决高频轮询;应用常开时常驻 timer 纯浪费,B 的惰性触发已覆盖全部实际场景。

**防「取消归档又被扫回」的三个候选**:
- keep 覆盖层(选定):手动取消归档时写第四张覆盖层 `sessionKeep`,清扫跳过 keep 条目。与既有三张覆盖层(archive/pins/deleted)完全同构,makeOverlay 工厂直接复用。
- 取消归档时顺带刷 mtime(否决):touch 会话文件改 mtime 让其自然脱离过期区。否决:改 CLI 私有文件的 mtime 有副作用(看板日历落位、排序、mtime 缓存失效全受影响),且 kimi/opencode/dsh 的「文件」是目录/sqlite 行/远端流,根本没法 touch。
- 清扫跳过「曾手动取消归档过」的会话但用归档表内标记(否决):SessionArchiveEntry 只有 archivedAt 单字段,加字段要动 sanitize/merge/逐出全链路,不如独立覆盖层干净。

**空会话判定口径**:沿用 prewarmFs.lockAndRemoveBirthFile 的保守先例——读头 32KB,头内连用户消息标记子串都没有才算空;子串在但行截断/解析失败一律视为非空不删。防「首条消息是大段粘贴被推出窗口」误删。

## 设计

### 触发点(零轮询)

`useCliDiskScan` 两条扫描结算分支(本机 `.then(list)` / 远程 `.then(diskList)`)内,拿到扫描结果后调用 `sweepStaleSessions(...)`(fire-and-forget,不阻塞渲染)。远程分支只归档不删盘:本地 `fsRemovePath` 碰不到远端文件,删了列表消失而远端数据还在,重扫复活成幽灵。

清扫自身写归档标记后不触发重扫:归档只影响视图过滤(覆盖层是响应式的,settings emit → useSettingsState 重渲),扫描结果集不变,无需 setRescanTick。

### 清扫规则(workspace/sessionSweep.ts 新文件)

候选 = 同时满足:

| 条件 | 理由 |
|---|---|
| `modifiedAt > 0` | grok(summary 缺 updated_at)/dsh(无 updatedAt)回 0;0 = 时间未知,永不扫(防「无限老」误判) |
| `Date.now() - modifiedAt > 时窗` | 用户拍板 modifiedAt 为准:3 天前建、1 小时前还在用的会话留在默认视图 |
| 非活会话(不在 liveCliIds) | 正在跑的会话不归档 |
| 未归档 / 未删(覆盖层查) | 幂等;删过的不复活 |
| 未置顶(pins 查) | 置顶 = 用户显式保留意图 |
| 未 keep(sessionKeep 查) | 手动取消归档的不再被扫回 |

动作两段:

1. **批量归档**:候选一次 `archiveSessions(keys[])`(sessionArchive 新增批量 API,整表合并 + 逐出后单次 `updateSettings` 写盘)——不给 overlay 逐条打 N 次 persist(settings 每次 persist 是读盘→合并→写盘串行链,200 条 = 200 轮)。
2. **异步空判定**:对已归档候选逐个调 `profile.isDiskSessionEmpty?.(session)`,返回 true → 复用 `deleteDiskSessionFull` 同款语义(先杀活会话→物理删盘/代写钩子→清覆盖层→记 tombstone;删盘失败自动降级为「已归档+隐藏」,磁盘数据保留)。钩子缺省 = 只归档不删(保守缺省)。

时窗内已归档的不动(归档 ≠ 空,不追溯删);仅本次新扫出的过期候选走空判定。

### keep 覆盖层(kernel/sessionKeep.ts 新文件)

第四张会话覆盖层,`{keptAt}`,完全复用 makeOverlay 工厂(容量 200 缺省)+ overlayEvict 注册 + settingsTypes/defaults/sanitize/MERGE_TS_FIELDS 四处接线(与 sessionDeleted 同构抄写)。

写入点仅两处**手动**取消归档:

- workspace/SessionManage.tsx 恢复按钮(archive=false 分支);
- session-board/SwimTimeline.tsx 取消归档钮。

不写入的路径(有意):

- `host.openDiskSession` 的自动 unarchive(resume 打开):打开即用,CLI 会刷新 mtime,自然脱离过期区;之后干净退出 boardExit 照常再归档。写 keep 反而让「打开过一次的旧会话」永远脱离清扫。
- boardExit 干净退出归档:语义不变。

### 空判定钩子(CliProfile.isDiskSessionEmpty?)

```ts
/** 判定磁盘会话是否为空(从未有过用户消息);清扫超期空会话的物理删除依据。
 *  缺省 = 不可判定,只归档不删。实现必须保守:任何不确定都返回 false。 */
isDiskSessionEmpty?: (session: CliDiskSession) => Promise<boolean>;
```

与 deleteSession 同型:格式知识留插件侧,内核/workspace 不理解任何 CLI 私有格式。

全族接线(用户拍板「全族都接」):

| 插件 | 判定实现 |
|---|---|
| piFamily(omp/pi) | cli-shared 共享 helper:读头 32KB → `parseUserMessages(head, ompPiUserMessageLine)` 空且头内无用户消息子串 → true |
| cli-claude | 同款共享 helper + claudeUserMessageLine |
| cli-codex | 同款共享 helper + codexUserMessageLine |
| cli-qoder(双插件) | 同款共享 helper + qoderUserMessageLine |
| cli-grok | 读 `<dir>/chat_history.jsonl` 头 32KB → grokUserMessageLine(`<user_query>` 包裹判定天然滤注入) |
| cli-kimi | 读 `<会话目录>/agents/main/wire.jsonl`(老 home:`path` 即 wire.jsonl)头 32KB → kimiUserMessageLine;wire 不存在 → false(目录型,判不了不删) |
| cli-opencode | sqliteQuery:`SELECT COUNT(*) FROM message WHERE session_id=? AND role='user'`(经既有 db.ts 通道)count=0 → true |
| cli-dsh | host `session.list` 的 `blank` 标志(空壳垃圾正是它;RPC 走既有 dshRpc 通道,list 失败 → false) |

共享 helper 落 cli-shared(sessionEmpty.ts):准入 = piFamily/claude/codex/qoder/grok/kimi 六方消费同一「读头+行解析器判空」知识,满足 ≥2 插件消费标准,文件头注明先例。

保守闸(helper 内统一):

- 头内存在用户消息标记子串但**所有行解析失败**(截断/坏行)→ false(可能大粘贴把完整行推出窗口);
- 头读取失败/IPC 异常 → false(catch 兜底,判不了不删);
- 子串清单与 parseUserMessages 预筛同源:`"role":"user"` / `"type":"user"` / `"TurnBegin"` / `"turn.prompt"`。

### 设置(行为 tab 新增一卡)

```ts
/** 会话卫生清扫开关:超期自动归档 + 空会话删除。默认开。 */
sessionHygieneEnabled: boolean;
/** 超期时窗(小时),白名单 [12, 24, 48, 168]。默认 24。 */
sessionHygieneHours: number;
```

sanitize 白名单清洗(非白名单值回落默认,与 askSoundId 同款);BehaviorTab 一卡两行(segmented 开关 + StyledSelect 时窗),复用 pref-card/pref-row/segmented 零新增 CSS;BehaviorTab 现 260 行,加一卡超 300 行铁则 → 卡片拆 `HygieneCard.tsx` 子组件(与 PromptHistoryManager 同目录先例)。locales en/ja 补词条。

关闭开关 = 清扫整体短路(useCliDiskScan 调用点读 settings,不扫不删);已归档/已删的既成事实不回滚。

### 已知天花板

- 归档表 2000 上限不动:存量 >2000 条过期会话时,最深尾部条目在「逐出→重扫→再归档」间换血。肉眼不可见:列表按 modifiedAt 倒序分页,换血集全在第 2 页开外;代价 = 每次扫描多一次批量写盘。接受,不做容量扩张(ponytail:上限常量具名,真成问题改一个数)。
- 清扫依赖扫描发生:从不展开的工作区不清扫。接受——不展开的会话本来就不占用户注意力;首次展开即清扫,语义自洽。
- grok/dsh modifiedAt=0 的会话永不自动归档。接受——时间未知宁可不动。

## 改动面清单

kernel:`sessionKeep.ts`(新)、`sessionArchive.ts`(+archiveSessions 批量)、`overlayEvict.ts`(OverlaySettingsKey union +1)、`settingsTypes.ts`/`settingsDefaults.ts`/`settingsSanitize.ts`/`settings.ts`(MERGE_TS_FIELDS)各数行、`cliProfile.ts`(钩子声明);
cli-shared:`sessionEmpty.ts`(新,文件头准入先例注释);
插件:piFamily.ts / cli-claude / cli-codex / qoderPlugin.tsx / cli-grok / kimiSessions.ts / cli-opencode(db.ts+index.tsx)/ cli-dsh(dshRpc.ts+plugin.tsx)各接钩子;
workspace:`sessionSweep.ts`(新)、`useCliDiskScan.ts`(两处调用点)、`SessionManage.tsx`(keep 1 行)、`HygieneCard.tsx`(新) + `BehaviorTab.tsx`(挂卡);
session-board:`SwimTimeline.tsx`(keep 1 行);
locales:en/ja settings 词条。

测试:sweep 门控(modifiedAt=0/活会话/置顶/keep/时窗内 各不扫)、批量归档单次写盘、空判定行型(有用户消息/截断保守/读取失败)、keep 覆盖层同构契约、settings sanitize 白名单。

## 验证

- `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;
- `npx react-doctor@latest -y` 100 分;
- 1421 浏览器桩目检:fs_collect_files 造假 FileStamp(>24h 旧会话 + 空会话 + 新会话),展开工作区 → 默认视图只剩新会话、归档视图出现旧会话、空会话文件被删(fsRemovePath 桩计数)、手动取消归档后再次扫描不回弹(keep 生效)、关开关后全短路。

## 实施纪要(commit 1e75245)

1. **空判定 helper 收敛为标记子串版**(与 spec 初稿的 parseUserMessages 版偏离):
   保守闸「子串命中但解析 0 条 → 非空」使解析步骤零判别力(有标记即非空,与解析结果无关),
   只留成本。cli-shared/sessionEmpty.ts 仅做 32KB 读头 + 五标记子串
   (`"role":"user"`/`"type":"user"`/`"TurnBegin"`/`"turn.prompt"`,与 userMessages 预筛同源),
   读失败/异型返回 false。kimi 双 wire 候选位拆 kimiEmpty.ts(300 行铁则)。
2. **sweep 返回删除数**,useCliDiskScan 在 >0 时补扫一次(行即时消失,与手动删除同款);
   候选判空+删除并发 Promise.all(react-doctor async-await-in-loop)。
3. **overlayEvict markMany 修一枚真 bug**:`export const archiveSession = overlay.mark`
   解绑导出后 `this.markMany` 为 undefined(批量入口首测即炸);mark 改闭包内 markMany([key])。
4. **验证覆盖**:vitest 1762 全绿(新增 sessionSweep.test 12 例门控/批量写/远程不删、
   sessionEmpty.test 9 例行型、sessionKeep.test 8 例覆盖层+清洗);doctor 100;
   typecheck/arch-boundary/file-size/build 过。1421 桩目检:默认视图收走两条超期、
   归档视图出现旧非空会话、空会话 fsRemovePath 命中、行为页卡开关/时窗条件行与写盘;
   keep 门控由单测覆盖(未做 UI 目检,SessionManage 管理模式交互面大,单测已锁四道门)。
