# 0.4.3 二轮打磨评审(三路并行)

日期:2026-10-22 · 状态:已收口(P1×1/P2×3 当轮全修;P3 修 2 条、记 6 条;不成立若干)

## 背景与范围

0.4.3 变更集(`3f388ac7..321461b3`,13 笔,51 文件 +1007/-206)发版前二轮静态评审,三路 reviewer 并行:kernel 幕布滚动家族 + ports / checkpoints + files + 查看器 / anim + 发版一致性。第一轮(0.4.2 评审)覆盖至 `3f388ac7`,本变更集此前未经评审。伴随功能桩目检:ports 扫描超时提示端到端浮出实证通过(1421 桩,proc_communicate 按 timeoutMs 回 timedOut)。

## P1(当轮修)

- **回放面尾扫不容忍尾清屏前奏,与 live 守卫分叉**(`terminalSigwinchGuard.ts` stripDanceEnvelopes):178d2a38 给 live tail 加了逐字节吞前奏容忍(real_winch.bin 实测 `1049l` 与 `H+2J+3J` 之间有 `\x1b[0m\x1b]8;;\x07`,帧含 OSC8 超链接时缺省),回放面尾扫仍是逐 token `else break` —— 撞前奏即断,包络漏识别,全量回放(刷新钮/停滞重建/无冻结重挂/磁盘尾)把 3J 原样重进 xterm 清掉滚动缓冲,恰是本函数立身要防的事;测试钉的是无前奏理想形态,gate 全绿遮蔽。**修**:尾扫改与 live 同律(32B 预算内 indexOf 搜 3J 签名,命中整段剥除),补前奏形态/前奏后无 3J/超预算三例测试。最小复现:`stripDanceEnvelopes("\x1b[?1049hF\x1b[?1049l\x1b[0m\x1b]8;;\x07\x1b[H\x1b[2J\x1b[3JAFTER", 30)` 修前原样返回。

## P2(当轮修)

- **ports browserHost 对具体 IPv6 产出非法 URL**:splitHostPort 已剥括号,生产 addr 无括号;browserHost 裸 IPv6 原样返回 → `http://::1:3000` 非法。**修**:含 `:` 补方括号 + zone-id `%`→`%25`,测试补裸形与转义。
- **anim AI 会话 prepare 读通道半迁移**:555e748d 把列表读取换 32MB 原语,prepare 仍走 `fsReadFile` 512KB 预览闸,大项目(内嵌配音 dataURL 普遍超限)点「AI 会话」读失败被 `catch(() => null)` 折叠进「文件被删」分支 → 静默建「未命名动画」垃圾桩。**修**:prepare 换 `fsReadBytesBase64` 同原语;读失败(被删/超限/IO)与坏内容同归 `invalid-project` 显性报错,桩只留「未选项目」入口(projectPath=null,补钉);读失败改道建桩的旧测试翻钉。
- **发版版本源计划与执行矛盾**:规划批一写「六处版本源 bump」含 mobile 壳 Info.plist/project.yml,执行四处 + mobile 壳独立版本线(0.4.0 不跟,随 mobile M2 发版另 bump)。**修**:修订规划行记明口径,CHANGELOG 内务同步(桌面四处 0.4.3 已核一致)。

## P3(修 2,记 6)

修:

- **复制地址硬编码 localhost**:与同簇「浏览器打开」按行 addr 语义不一致,非回环/IPv6 行复制出的 URL 不可达。**修**:copy url 分支复用 `browserHost(entry.addr)`。
- **确认窗引用预览(3 卡)与实发引用块(5 条)两份清单必然漂移**(已漂移一次)。**修**:`animSessionRefs` 升单源(补 kind 图标位),prepare 预览复用,删第二份清单。

记(record-only):

- ports 二段杀宽限窗 pid 复用误杀(固有风险,0.4.2 评审已记)
- 守卫 dance 主相误捕 resize 后 2.5s 窗内启动的真 alt 应用(首屏吞 + 滞留至 10s 自愈,alt 碎片污染内联缓冲;触发面窄,改短停滞上限会推翻刚落档的 10s 自愈口径,留真机复验后议)
- anim >32MB 合法项目误标「无效项目」;轮询全量重读无缓存(按错误形态归因 + path+mtime 缓存,留 0.4.4)
- anim 泵侧 alt 段丢弃(178d2a38)在 CHANGELOG 缺账 → 本轮补账
- checkpoints 首个探测窗开窗瞬间批清单闪空一拍(键翻转沿无过渡,自愈)
- checkpoints 插件禁用正处探测窗 → close 边沿丢失 Set 残留(下次开合自愈,运行时插件开关窄路径)
- files 路径含逗号且前缀恰为「分隔符+完整尾」的合法单文件名被误切双死链(启发式固有歧义,注释已声明取舍)

## 判定不成立(要点)

- findAnchorFull 末次现行不自洽:重印后末次 = 最新帧,唯一受损场景为深翻读者与更新帧同文,属已记录取舍。
- enforcement 键盘让位漏 shift/误伤 IME:`e.key` 不随 shift 变、组合期为 `Process`,键集是超集。
- ports 超时提示竞态:refresh gate 严格串行,flags 各扫自有,无时序倒挂。
- anim spawn 归属取活动工作区时机:deps.spawn 回调内同步求值,异步链不回读。
- 探测窗单源热重载/多面板不一致:activate 一处订阅,静态 import 无 HMR 边界,双侧同归零。
- 读侧回落错读他账:`${cwd}|${key}` 隔离 + 后端双字段命中 + backfill 自愈,时序闭合。

## 验证

- 定向 vitest:守卫回放 21 例(新增 3)、ports 31 例、anim 37 例(翻钉 1 + 补桩入口钉 1)全绿。
- `pnpm check:gate` 全链 + `npx react-doctor` 100:提交收口前后各一次,推送前最新树复跑。
- 功能桩目检(1421):ports 扫描超时提示端到端浮出(「扫描超时,结果可能不完整」横幅 + 空态),截图存证;徽标截断/终端键盘让位为纯渲染与 xterm 装配面,单元契约已钉,真机四动作复验覆盖。
