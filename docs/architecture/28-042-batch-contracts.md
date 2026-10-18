# 28 · 0.4.0 042 混合批落地契约(路径链接 provider / 历史双轨存储 / quota 三腿 / 全局检索索引 / 恢复预览 plan 抽取 / 软归档)

日期:2026-10-18 · 状态:已落地(042 批五项 + workbench 空壳归档债批 + 随手带四项全量;依据 `docs/design/042-candidates/feasibility.md` 推演定稿,五路并行实施+集成收口)

## terminalLinks 第二消费者(files terminalPathLinks.ts)

- provider(识别+打开)整体落插件侧,kernel 注册表与聚合 ILinkProvider 零改动;marks 回链是唯一先例,行为对称:**区外/不存在静默无 toast**,hover 零 I/O,点击时一次性存在探测(`fsReadTail(abs,1)`,kernel 无 fsStat 原语下的最便宜探针)。
- 识别:POSIX `~/`(经 `ipc.configHomeDir()` 展开)/`./`/盘符/UNC + 相对须含分隔符;尾部 `:line`/`:line:col`(**col 忽略只跳行**,reveal 契约仅 line);**URL 段整体预挖**(仅滤 `://` 挡不住 `https://a.com/x.ts:5` 尾巴命中,实测坑);空格路径续段须自身再含分隔符(sendTransform 先例)。
- cwd=点击时激活会话的 spawn cwd,PTY 内 cd 不追踪(OSC 7 被否,天花板钉文件头);`..` 段消除后做 root 前缀守卫。

## promptHistory 双轨语义(kernel promptHistory.ts)

- **存储轨全文**:单条硬上限 8000 字符(防御病态长粘贴),总量 `MAX_BYTES=512KB` 字节封顶——save 期 stringify 超限从 `items[0]` 连 `counts` 最旧淘汰(排序键=数组序 recency);写入失败静默不 throw,存储形状 `{items,counts}` 不变。
- **ghost 轨 300**:`MAX_TEXT_LENGTH=300` 语义降级为 ghost 匹配/展示窗口——前缀匹配只比对开头,展示截断 ≤300+「…」,accept/回填一律返回全文。双轨语义注释+测试钉死,后续改动不得把截断加回存储侧。
- 存量 v1 截断条目**不动不打标**(恰好 300 字符的新条目会假阳性),去重置底自然自愈。抽屉(Cmd+L,composer.toggleHistory 命令,Composer 局部 state 不进 drawerOpen 三态机)= 第三消费面,与 ghost 互补:↑ 线性翻旧 / 抽屉子串过滤。

## quota 告警三腿(notify + cli-shared/quota)

- **余额腿**:`QuotaSnapshot.balanceValue?: number` 旁挂(types.ts),**仅 deepseek(`info.total_balance`)/relay(`balanceNum`,含 New API 回退分支)透传**;其余家无余额概念——UI 不渲染余额行而非显「—」(无余额 ≠ 解析失败,kimi/minimax/zhipu/codex/grok 同);绝对阈值 `notifyQuotaBalanceBelow`(默认 0=关,货币跟随回包不换算,百分比被否=无分母发明数据)。
- **claude 窗口腿**:`windowResetFor` 纯函数迁 `cli-shared/quota/quotaWindow.ts`(文件头声明 notify+welcome 联合消费先例),notify 侧尾读推算(`fsReadTail` 128KB + usage 行提取,welcome/tokens.ts 同款配方);`notifyQuotaResetMinutes`(默认 30,5-240)→「N 分后重置」。
- **去重腿**:notify-log.json 头部 `quotaSeen:[{k,at}]`——键=既有 pickQuotaWarnings windowKey+引擎前缀;窗口键自带 resetsAt 按周期翻新,余额键用首次越线小时桶;随 notifyLogDays 裁剪同批清理,写坏按无记录宁多勿漏。修「重启失忆」;不建新状态文件(生命周期成本,被否)。
- **三闸修复**:NotifyKind 增 `"quota"`,quota 分支走 dispatch 同款 `shouldNotify`(免打扰/聚焦静默拦 OS 通知,流水照记)——此前绕过是免打扰窗不拦 quota 的真缺口。无新定时器(复用 0.2.8 轮询链);minimax windows=「剩余」% 与 usedLabel「已使用」口径已断言钉死。

## 全局检索索引(session-search)

- 缓存=**会话绝对路径唯一 key + cwd 命名空间留存 + 全局 LRU 3000**(`INDEX_CACHE_CAP`,单调 useSeq 时钟):prime 只剪「cwd===本次 && 不在 live」死键;纯 LRU 会把本区热缓存挤光(互踢回潮),纯命名空间无失控护栏——双管是定稿。
- 逐区 root 复核(`fsWalkFiles(root,1)` cap=1 探测)失败进 `goneCwds`:失效区命中灰 pill「工作区已移走」**不可跳**(开出 workspaceId 空的会话侧栏永不可见,比不跳坑)。
- **先切后跳**:Enter = setActiveWorkspace(目标) → resume → openThenJumpToText;miss/openDiskSession reject 落 toast 时已身处目标区(降级上下文不错位);8s 定位超时不回滚切换(单向手势)。时间盒=每 tick 12ms 排空缓存命中步(全暖缓存否则分钟级),真读步维持 60ms。作用域 chip=浮层局部 state 零持久化。
- 多命中:hit.subHits(cap 20)同会话多处命中,「N 处命中」展开子行逐项跳转(locateTargetOf(hit,sub))。

## checkpoint 恢复预览(plan_restore 抽取)

- `plan_restore(cwd,batch_id,paths) -> RestorePlan` 纯函数(plan.rs),**plan/execute 共用一份计划**(复制版 skip 语义必漂移,被否);preview 命令=plan+每写入项 `blob_patch(live,target)`(live 每路径读一次),binary 0/0 行,只读不落盘不改账本。
- 审批链「信息增强」模式:plan 空(E_Empty)→免弹直接 doRevert+中性提示「本批已无可回退的改动」(plan 非空全 untouched 照常弹);弹层内**冻结预览**(执行时阶段一用最新 live 重判,skip 兜底);IPC 失败回落纯文案确认+错误短句**不阻塞**;「覆盖本地」药丸仅 surgical 擦除成功行——账本判定精确到文件,git status ∩ 会把本会话刚写的未提交改动全员误标(恐吓化,被否)。
- undo_revert 复用该批恢复时的预览缓存,不新发 dry-run(guard 信息增量≈0,省一条 IPC);超 300 行拆 plan.rs/preview.rs/confirmCard.tsx。

## workbench 软归档

- 独立 `archived?: boolean + archivedAt?: string` 字段(**不进 ProjectStatus 中文五值枚举**,表单下拉不消费);`activeProjects()` 单点过滤 selector,概览/聚焦/看板/文档中心同一口径;恢复清 archived 留 archivedAt 留证;概览入口 ghosts ≥2 才渲染。

## 随手带契约

- 终端搜索计数:逐行扫描口径与 SearchAddon 对齐(跨行不命中/零长不计),当前序号由选区起点反推(addon 无序号 API)。
- ⌘字号缩放:terminal 作用域 match 键族(zoomCommands 同平台口径,mac 仅 meta、alt 排除、⇧= 两态),写回 `settings.terminalFontSize` ±1/重置 13,未聚焦落 global 界面缩放。
