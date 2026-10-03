# 范围2提案(v0.2.8..13355eec)四维独立复审

- 日期:2026-10-04
- 状态:已完成(9 minor 实锤全修 + 2 处注释如实化;门禁全绿;真机目检留大仙)
- 范围:`docs/review/2026-10-03-v0.2.9-range-review-2.md` 提案内的提交区间 `9f17886c..13355eec`(16 笔,53 文件),评审对象为三轮评审修复落定后的 HEAD 终态
- 性质:评审记录 + 修复实施(修复随本日提交)

## 结论先行

前三轮(6 实锤 + 30 实锤)之后该范围质量已高,本轮四路独立复审(Rust/Swift 桥、composer/上传链、实况屏引擎、cli-shared/架构/文档)+ 主线核证仍实锤 **9 minor**,集中在三簇:① Swift 在途计数/前台探测两处生命周期缺口(除账错靶、慢握手误杀);② liveText 转义族四处语义缺口(smkx/rmkx 字面落屏、CNL/IND/NEL 缺实现、RI 归零列、CSI 空参数位折叠);③ confirm 畸形 id 无闸 + composer 两处 UX 失真(autosize 不随宽、错误条死钮)。无 blocker/major,架构零偏离。

## 实锤与修复

| # | 级 | 发现 | 修复 |
|---|---|---|---|
| 1 | m | piRpc confirm 分支无 id 守卫:缺 id/null 落空串、布尔/对象 String() 出垃圾串,产出的审批卡 respond 后引擎永不认领——widget 分支有 `!fid return` 同律闸,confirm 最高风险路径反而裸奔,且与 piRpcIds.test.ts 头注「畸形帧不产应答」自相矛盾 | confirm 入口守卫:仅非空 string 或 number 产卡,否则 return;测试补「缺 id/null id confirm 帧不产卡」 |
| 2 | m | ShellBridge open() 拆孤儿线 `inflightSendsById.removeValue(forKey: id)` 除的是**新连接 id**;注释设想「同 id 重拨」仅在页面 reload 成立,常态 JS nextConn 单调递增,stale 键计数滞留永不消失 | stale 各键全量清算 `for k in stale.keys { removeValue }` |
| 3 | m | send 迟到完成回调 `max(0, …-1)` 会把已除账键写回 0,条目复活滞留(与 #2 叠加成字典慢涨) | 归零即除键:表只持有在途 >0 的线;注释同步 |
| 4 | m | probeOnForeground 未闸 opened:握手未完成线 sendPing 排队(耗时 = 握手 + RTT),慢 TLS(自签中继/弱网/跨洋)>3s 即被死线 cancel,拨号期反复切前后台成「拨-杀-拨」抖动 | probe 循环首行 `guard opened.contains(id) else { continue }`,未开线交还周期死线链(15s 节拍 + 10s 死线宽窗) |
| 5 | m | Composer autosize effect 依赖仅 [draft, taH]:旋屏/分屏改 textarea 宽度后 scrollHeight 已变而高度滞留,变窄截字变宽留白,直到下一次击键——屏向切换正是本批 toggleOrient 主场景 | ResizeObserver 只认宽度变化触发重量高(宽度守卫防自设高度自激) |
| 6 | m | 发送失败保稿后,用户清空草稿移除挂图:错误条「消息已保留」+ 重试钮仍在,但 send() 里 composeSendText 返回 null 静默 return——死钮无反馈 | msg === null 时同步清 sendErr(错误条失去重试对象即退场) |
| 7 | m | liveText tok 单字节转义类 `[0-9A-Za-z]` 不含 `=`/`>`(DECKPAM/PNM)也无中间字节族:terminfo smkx/rmkx(`\E[?1h\E=`,vim/nano/less 进出全屏)与 `\x1b%G`(UTF-8 选择)的 ESC 及后续字节逐字落屏;注释自述「ESC+终字节(0x30-0x7E)」与实现不符 | 类扩 `[0-9A-Za-z=<>]` + 中间字节族 alternation `\x1b[ -/]+[终字节]`(置于 CSI/OSC/DCS/charset 之后不抢前缀);incompleteEsc 改通用「ESC+中间字节结尾挂起」;补 6 例回归(拆 liveTextEscapes.test.ts,先例 piRpcIds) |
| 8 | m | CSI E(CNL)头注声称为支持集但 switch 无 case;ESC D/E(IND/NEL)被单字节类吞成 no-op | CNL 并入 case 0x42 分支(final===0x45 归列首);ESC M→RI、ESC D→行进不归列、ESC E→CR+LF |
| 9 | m | reverseLineFeed(RI)多余归零列:xterm reverseIndex 列不动,行中定位后发 RI 的续写会被错到行首 | 删 `this.col = 0`;ESC M 与 CSI M 同路 |
| 10 | m | CSI 参数 `match(/\d+/g)` 折叠空位:`\x1b[;5H` 的 nums=["5"] → 行列全错位(应默认行 + 第 5 列) | 按 `body.split(";")` 逐位取值,空位/0 → 默认;合法序列行为等价 |
| 11 | 注释 | liveText 头注 `view(fromTop)` 参数不存在、支持集与实现脱节;useLiveStream「rAF 脏标合帧」实为 setTimeout 100ms 节流 | 三处如实化 |

## 留观(不修,含理由)

- **两路 ping(前台 probe/周期链)settled 各自独立,同一 task 可被双方各 cancel 一次**:task.cancel 幂等、receive 只报错一次,现无危害;仅当未来往 finish 加非幂等逻辑(重复 emit)时才成雷,记录防演化踩坑。
- **probe 对「连上但从未收帧」线不探测**(opened 未置位):由周期链宽窗兜底,语义维持,不另开口子。

## 四维核验通过面(不改动)

- **功能准确性/架构契合**:mobile 树 import 全落允许面(仅 @kernel 公共面 + cli-* 声明适配器/纯函数,经 @plugins),无 @shell 越界;piRpcReducer 头注准入先例(1 cli-* + feature)在位;新版块 notice id `live:n{len}` 无碰撞空间;SpawnSheet 会话计数 `workspaceId ?? "default"` 与 kernel 默认工作区 id 对齐。
- **兼容性**:新桌面 Ping 对老壳/老浏览器由协议栈自动 pong,互通零破坏;confirm 守卫只丢畸形帧,合法数值/字符串 id 行为不变;CSI 参数解析对既有合法序列(非空位)逐一等价;tok 扩类只吞终端惯例本就该吞的序列,不影响 DCS 预扫/charset 分支(alternation 顺序核过)。
- **性能**:心跳/探测路径零新增热路径开销;#2/#3 是内存卫生修正(字典无界慢涨);RO 宽度守卫零自激;TurnsView memo/setLive 尾沿节流/回放缓冲核验维持。
- **死代码**:BoardButton 删除无残留引用;sheet/composer css 孤儿类 0;structured-session en/ja 逐键引用扫描 0 死键;treeIcons 全导出有消费;i18n 缺键 0。

## 验证

typecheck 0 错;vitest 全仓全绿 + 新增 7 例(liveTextEscapes 6:扩展类/跨 chunk/CNL/RI×2/IND·NEL/空参数位;piRpcIds 1:畸形 confirm 不产卡);check:arch-boundary / check:file-size(liveText.ts 贴线 300,超限测试拆分)/ check:i18n-keys 过;react-doctor 100;ShellBridge.swift 全目录 `swiftc -typecheck` 0 错(存量 await 警告不在改动面)。真机目检留大仙:弱网拨中继期间切前台不再抖动重拨、旋屏后 composer 高度即时自适应、vim/less 进出全屏时实况屏无 `=` 残字。
