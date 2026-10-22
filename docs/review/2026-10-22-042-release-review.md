# 0.4.2 发版评审(查漏补缺)

日期:2026-10-22 · 状态:已收口(当轮全修;留观项登记在案)

## 结论

五路并行评审代理(ports / 幕布滚动家族 / quota 缓存 / kernel 会话面 / 发版一致性)+ 收口快扫,覆盖区间 `83b9fac0..3f388ac7`(40 笔提交,141 文件 +5364/-369)。产出 **P1×2、P2×7**,当轮全部修复;P3 修 4 条、留观 12 条;判定不成立 2 条。验证门:修复后 `pnpm check:gate` 全链绿 + 定向 vitest 全绿;react-doctor 两次 Score API 不可达(网络环境),收口分未能复验,见「环境阻断」。

每条 finding 均经主线亲验(读码复核)后才采信修复,代理原话不作事实源。

## P1(2,均已修)

1. **ports 多条 pid null 行并成假家族**(`portsTree.ts groupByFamily`):`groups.get(top.pid!)` 以 null 作 Map 键,≥2 条无主监听行(Linux 无特权扫描常态,ss/netstat pid 列 `-`)第二条起被收为假子进程,折叠钮/虚线框全套误现;docstring「pid null 恒顶层」与实现矛盾,单 null 行用例测不出。修:循环头 null 行恒顶层守卫 + 三 null 行用例。
2. **幕布全量回放旁路舞步守卫**(`terminalStream.ts`):liveFilter 只挂 ptyLiveTopic 订阅,而 outputBuffer/磁盘 journal 存过滤前原始字节;刷新钮/stall 重建/无冻结快照重挂/磁盘尾四条回放面把历史舞步(`1049h…1049l H+2J+3J`)原样重放,3J 清掉刚回放出的滚动缓冲——live 守卫保住的位在回放面静默清零,0.4.2 新增的刷新钮反而稳定复现。修:`stripDanceEnvelopes` 两趟包络剥除(包络判据 = 1049h…1049l 后 32B 尾清屏内**含 3J**——3J 是舞步签名,vim 退 alt 不清滚动缓冲,真 alt 原样保留),接线三处 writeInChunks;残缺形态(未闭合头/孤儿尾)不动。

## P2(7,均已修)

3. **quota force×在飞竞态**(`cli-shared/quota/vendors/index.ts`):then/catch 无属主守卫,force 顶替在飞登记后,迟到前驱用新时间戳回写旧数据(污染缓存整个 60s TTL)并误删后继登记(重复抓取)。修:`snapInflight.get(key) === p` 属主守卫 + force 撞在飞用例。
4. **回声重验 token 交接不闭**(`identityWatch.ts echoLoop`):探测 await 期间重发 prompt,旧循环 break 后无条件 `endEchoProbe` 砍掉新窗(四拍探测一次不跑、checkpoints 主键提前回落),更坏分支按陈旧 prompt 证据绑错文件(即本提交要防的串账)。修:收束前与 bind 前双 token 守卫(比代理建议的收束单点守卫多堵 bind 分支)+ fake-timers 竞态用例。
5. **回声比对裸全等**(`identityWatch.ts`):promptSent 负载带 `\r\n` 而 CLI jsonl 存 `\n`,多行 prompt 恒 miss(fail-open 不误绑但重验静默失效;CLI 侧存储形态未逐引擎核,属[INFERENCE],按更宽松匹配修)。修:双侧空白折叠归一 + `\r\n`/`\n` 用例。
6. **查看器二次 locate 哑火**(`viewerTab.tsx`):防重放闸键 = 派生块 id,同文同 occurrence 二次深链算出同 id,effect 直接 return 不滚动。修:闸键改 payload.locate 对象引用(新深链必新对象,分批重渲引用不变)。viewer 侧无组件测试,行为改动待真机抽查。
7. **CHANGELOG feature 计数加和矛盾**:`35 feature` 使 10+35+3+1=49≠48(亲验 allPlugins 实数 48、FEATURES 基线 47=10/33/3/1)。修 34。release.yml 抠小节注入正文,错误分类随 v0.4.2 Release 正文外发,**已发 Release 正文需手动勘误或重打 tag 刷新**。
8. **CHANGELOG 漏记 42f512ad**:welcome 余额卡沉底/奇数占满/deepseek pill 是 0.4.0 后用户可见行为变化,实现与测试均在场。修:补修复 bullet。
9. **FEATURES 两处失实**:幕布回底钮未登记(代码三处齐);滚动回放上界「5 万行」已改 24_000。修:补录 + 订正 2.4 万行。

另:Scroll 片 P2「arm 窗 2.5s 误捕真 alt + 舞步相无超时」修后半(10s 停滞自愈),窗长收窄需真机舞步时序数据,留观。

## P3 当轮修(4)

- welcome Ring pct=0 零长 dash + round cap 渲染色点(SVG 规范):零长不画。
- footprint 跳转录链无 `.catch`(configDir 被拒会永久缓存 rejected promise):统一落「未能定位」提示。
- scrollKeeper 无 dispose 面(幕布卸载后守望 timer/rAF 轮询已 dispose 的 term ≤10s):补 `dispose()` 接 TerminalView 清理序;`cancelEnforcement` 注释订正(生产让位走 armEnforce 自挂监听)。伴生 300 行处置:锚函数(anchorText/findAnchor/findAnchorFull/ScrollLine)拆 `terminalScrollAnchor.ts`,keeper 311 行回落 264。
- settingsSessionEntries 注释「默认开」与 d94e046a 翻转后语义错位:改「默认关」。

## P3 留观(12,record-only;2026-10-22 0.4.3 收编 5 项:ports 超时提示/浏览器打开语义/kill 后补刷 + kernel findAnchorFull 末次现行 + files 逗号死链与徽标溢出,提交 e1509ab1..5a2cbbca)

ports:扫描超时截断输出静默接受(timedOut 未消费)/「浏览器打开」恒 localhost 对非回环 addr 语义错位/kill 后 refresh 可被在途扫描卫兵跳过(auto 开 5s 自愈,auto 关滞留)/二段杀宽限窗 pid 复用误杀(固有风险)。kernel:enforcement 让位缺键盘路径(shift+PageUp 窗内被钉回,测试盲区)/findAnchorFull 取全缓冲首现行,重复锚文偏高/guard tail 只认字面 H/2J/3J,变体归位穿透(未观测 CLI)。插件:exitedReads 读失败缓存 30s(测试钉死的有意取舍)/footprint 原话跳转不传 occurrence(数据面未沉淀)/useCkptScope 探测窗读侧不走 withEchoFallback(瞬态自愈)/terminalPathLinks 逗号分隔多文件头段仍合并死链/分支徽标长名溢出(形制先在,e282ecb7 仅前移触发点)。

## 判定不成立(2)

- quotaWindow.ts 准入:文件头已有「落位声明(联合消费先例):notify + welcome 两家」,符合 ≥2 feature 联合消费 + 头注声明条款。
- Release 片判「0.4.2 无 architecture 新增合规」:不采——按规则 4「落地后沉淀」,幕布滚动位家族/定位桥/quota 缓存/唯一源收敛均为跨插件契约,补契约 32。

## 验证链

- 修复后定向 vitest:portsTree/vendors.cache/identityWatch.echo/sigwinchGuard(+replay 新卷)/jumpTranscript 全绿(60 用例级)。
- `pnpm check:gate` 全链(typecheck+test+arch+300 行+i18n+kernel 分区+build)修复后复跑,绿。
- Rust 链 clippy -D warnings + test + fmt:发版态绿(本轮零 Rust 改动)。
- react-doctor:三次 Score API 超时不可达,**收口分未复验**,待服务恢复补跑。

## 真机待办(移交大仙)

- 幕布:开真 CLI 深翻历史 → 点刷新钮 → 回放后滚动缓冲应保留(包络剥除生效);vim/fzf 深链历史回放不受损。
- 转录查看器:同一条消息连点两次「看对话」,第二次应重新滚动定位。
- v0.4.2 已发 Release 正文 feature 计数勘误(重打 tag 或手改)。
