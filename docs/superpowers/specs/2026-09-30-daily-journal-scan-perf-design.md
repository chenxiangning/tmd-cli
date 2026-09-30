# 每日工作日志扫描加速:旧数据先上屏 + 分批追加渲染 + codex/kimi 读头缓存

日期:2026-09-30
状态:已定稿(用户提出「分批获取/追加渲染」取向;三档范围询问未及应答,按推荐档 A+B+C+D 实施)

## 背景与目标

年/月/轴三视图共用 `useDaySessions`(daySessions.ts):挂载时若 60s TTL 模块缓存不新鲜,即全量扫描「全部工作区 × 全部 CLI 家族」的 `listSessions`,期间 `sessions === null`,主视图只剩一行「正在扫描会话…」白等,直到最慢家族返回。三个叠加慢点:

1. **挂载遇陈旧缓存也整页空白**:缓存仅在完全新鲜(TTL 内 + wsKey/liveKey 全同)时直用;过期/手动重扫/冷启动一律白等全扫完成。
2. **扫描不分批**:所有 (工作区×家族) 一次 `Promise.all`,最慢者决定整体;无渐进渲染、无进度。
3. **codex/kimi 扫描零缓存**:omp/pi/claude 读头已有 mtime 缓存(`readHeadSessionMetaCached`,重扫≈只读新文件);codex 每次每工作区读最近 200 个 rollout 头(4KB)+ 命中会话再读 32-256KB 标题头,kimi 每次每工作区读最近 200 个 state.json,且按工作区数放大(W 工作区 = W 倍重复读)。

目标:重扫不再白屏(旧数据先上屏,后台重扫静默换新);冷启动分批追加渲染带进度;codex/kimi 重扫收敛为 collect + 仅新/变文件读,惠及所有 `listSessions` 消费方(daily-journal / workspace 钉选 / 看板)。

## 方案取舍

**选定:视图三层(daySessions.ts 内闭环)+ 磁盘层缓存(cli-codex / cli-kimi / cli-shared)。**

- **A stale-while-revalidate**:模块缓存与 hook state 改存中间形态 `{diskRows, liveDisk}`;挂载遇同 wsKey 旧缓存先上屏,后台重扫完成后原位换新。空白只剩真冷启动。
- **B 分批追加渲染**:扫描改批式,每个 (工作区×家族) promise 落定即把累计磁盘行装配进 state,冷启动从「白等最慢家族」变「逐块长出来」;空态文案带 `k/n` 进度。
- **C 活会话同步合并**:磁盘行与活行拆开——活行来自 `host.getSessions()`(内存,同步),渲染层 `useMemo` 按 liveKey 即时重合并;活会话开关不再等全扫才反映到「今日增量中」/当日格。
- **D 磁盘层 mtime 缓存**:codex meta(4KB 头解析出的 cwd/id/createdAt)与 kimi state.json 解析结果各自加 `Map<path,{mtime,…}>` 模块缓存(collect 后按存活集剪除,上限 FIFO);codex 标题走 cli-shared 新增 `readHeadTitleCached`(与 `readHeadSessionMetaCached` 共池 headCache)。重扫 = 1 次 collect + 仅新/变文件读;W 工作区共享同一份缓存,重复读直接消失。

理由:A/B/C 全部落在 daily-journal 插件内,不动 CliProfile 契约、不动 Rust;D 沿用 `scanJsonlSessions` headCache 既有模式与测试范式,无新机制。四项正交,合起来覆盖「重扫频次 × 单次重扫成本 × 等待期观感」三个维度。

**否决:持久化缓存(localStorage/SQLite 落盘)**。冷启动白屏确可再消,但磁盘行结构含 disk 凭证与活合并语义,序列化出入库的版本管理成本高于收益;A+B 后冷启动已有渐进内容,非最痛。

**否决:只动视图层(A+B+C,不碰 cli-*)**。改动面最小,但「重新扫描」按钮与 TTL 过期全扫本身依旧慢(codex/kimi 大头),与用户「每次重新获取都很慢」主诉只解一半。

**否决:liveKey 变更完全不再触发重扫**。活行虽同步可见,但外部 CLI 落盘的新会话将滞留到下一次 TTL/手动扫描才出现,新鲜度回退明显;保留现触发面,重扫成本由 A(无感)+ D(变快)消化。

## 改动面

| 文件 | 改动 |
|---|---|
| `src/plugins/daily-journal/daySessions.ts` | 抽纯函数 `assembleRows`;新增批式 `collectSessionRowsBatched`(原 `collectSessionRows` 改为其非批封装,直用面 genSession/journalSchedule 签名不变);`useDaySessions` 返回 `{days, scanning}`,A/B/C 三层 |
| `src/plugins/daily-journal/JournalTab.tsx` | 适配新返回;空态进度 `k/n` |
| `src/plugins/daily-journal/JournalPanel.tsx` / `ArticleTab.tsx` | 适配新返回 |
| `src/plugins/cli-shared/diskSessions.ts` | 新增 `readHeadTitleCached`(复用 headCache 池) |
| `src/plugins/cli-codex/sessions.ts` | meta mtime 缓存 + 剪除;标题换 `readHeadTitleCached` |
| `src/plugins/cli-kimi/kimiSessions.ts` | state.json mtime 缓存 + 剪除(modern 路径;legacy 只读头一次,不加) |

## 验证

- 单测:assembleRows / collectSessionRowsBatched(受控 promise 分批断言 done/total 与增量行)/ codex 缓存(mtime 命中免读 / 变更重读 / 消失剪除)/ kimi 同款,沿用 diskSessions.cache.test.ts 范式;既有 daySessions/journalStore 测试保绿。
- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;提交前 `npx react-doctor@latest -y` = 100。
- 真机:`pnpm tauri:dev` 目检冷启动渐进上屏、TTL 过期再进 tab 无白屏、「重新扫描」期间视图可交互、活会话开关即时反映。
