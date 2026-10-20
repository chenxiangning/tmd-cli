# 2026-10-20 下午变更评审(0.4.1 收口轮 · 查漏补缺)

- 评审范围:当日 13:00–20:45 的提交(23 笔),两段——① 13–16 点:footprint 打磨收尾、299 行拆解 8 个、死键/轮询审计、FEATURES 补录、⌘Q 退出腿;② 19–20 点:足迹修正层差量化、补账对账、notify 额度三闸收口。
- 状态:已收口(4 项已修 + 4 项留观,无 P0)
- 方法:逐笔对码 + 四类自动取证(引用面 / 测试覆盖 / 静态四链 / 行数面),不复评已过项;发现即修、修完补测。

## 一、已修(本轮内改完并验证)

| # | 级别 | 位置 | 问题 | 处置 |
|---|---|---|---|---|
| 1 | P1 | `docs/architecture/30-footprint.md` 管线 D | 契约仍写「`.user.json` 整文件覆盖 AI 原档」,与当晚 v2 差量实现**事实相反**;补账这条写路径完全未收录(文档自称「唯一架构事实源」) | 管线 D 整段改写(v2 差量 / 读写分工 / v1 迁移口径 / 逐卡 provenance);新增「L1 补账对账」小节(缺口成因、触发点、五条口径、并发、诚实边界);读侧分层树补 `backfill.ts` / `userLayer.ts` |
| 2 | P1 | `footprint/backfill.ts` `accounted` | 用「月账任一天有该会话即跳过」做全局短路 → **跨零点会话次日漏账永远补不上**(19 日入账、20 日缺,整会话被跳过) | 删 `accounted`,改 `needsCheck`:按 `activeDaysOf`(活动区间裁进本月)逐日判缺口,任一日缺即查账;幂等仍由轮次号兜底。补 3 个用例(跨零点区间 / 两端倒挂 / 逐日缺口) |
| 3 | P2 | `footprint/index.tsx` 激活面 | 补账挂在启动后 8s 定时:`reconcileMonth` 内含 `loadSessionRows()` 全量会话扫描,与 0.4.1 批三「启动错峰、不叠启动负载」的结论冲突 | 撤掉启动定时,改 `reconcileOnce`(进程内单次闸)挂 `FootprintView` mount——用户看数据那一刻补,补到即 bump 重拉;补「重复调不再扫」「对账抛错不外抛」两个用例 |
| 4 | P2 | `docs/FEATURES.md` | 三条下午/晚间新行为未登记:额度预警三闸 + 跨重启去重、通知中心行 resume 重开、修正层差量 + 补账 | 三条正文条目 + 晚轮补校注记落盘 |
| 5 | P2 | `docs/review/2026-10-20-041-implementation.md` | 299 计数写「25 → 16(剩 9)」,自相矛盾且与实测不符 | 改为实测「25 → **14**」并列明剩余件归属 |

## 二、留观(不修,登记理由)

- **quotaPoll 无直接单测**:判定纯函数 `pickQuotaWarnings` / `pickBalanceWarning` 已有用例,`poll()` 本体是「host + provider + 去重键」的 IO 编排,补测要桩三层内核面,收益低于成本;与 D 档轮询事件化同批留 0.4.2。
- **openspec change 未建**:本轮三处行为变更(补账 / 修正层 v2 / quota 三闸)只落了代码 + FEATURES + 契约 30,未开 `openspec/changes/` 目录。按归档纪律应在 0.4.1 发版前补一条 change(或并入 042 followup),避免与在途的 M2、signing 两个 change 抢编号——**待拍板**。
- **macOS 菜单文案硬编码中文**(`退出 tmd-cli` / `编辑` / `窗口`):Rust 侧拿不到前端词典,不随系统语言切换;与既有「菜单未国际化」同源,移 0.4.2 i18n 面统一处理。
- **300 行无余量**:仍 14 个文件正好 299 行(mobile 三屏 / kernel host 系 / settings / cli 侧两件 / 四个测试件),gate 绿但下一次改动必破,继续拆解留 0.4.2。

## 三、复核后判定「不成立」的三类疑点(免得下次重复怀疑)

1. **拆解有孤儿文件?** 不成立。8 个拆出模块各 1 处消费即预期(纯展示件单挂点);`terminalReplay` 的 `attachTerminalStream` re-export 仍被 `TerminalView` 与 4 个测试文件消费,消费方路径零改动。
2. **notify 加字段要迁移?** 不需要。`NotifyEntry` 新增 `cliSessionId/cwd/workspaceId` 三个可选字段,旧 `notify-log.json` 直接兼容;`reopenNotifySession` 对无快照旧流水有「只维持点击手势,不聚焦不 resume」显式分支且有用例。
3. **菜单装配会重复注册?** 不会。全仓仅 `app_setup.rs` 触碰 `set_menu` / `on_menu_event`,setup 内单点调用;非 macOS 走 no-op 版本,cargo clippy/fmt 绿。

## 四、验证链(本轮改动面)

- `vitest run src/plugins/footprint/ src/plugins/notify/` → **97 测全过**(10 文件;足迹 64 + 通知 33)。
- `tsc --noEmit` 净;`check:file-size` / `check:arch-boundary` / `check:i18n-keys`(缺键 0、不对称 0)三链绿。
- 真机数据口径复核:`md5("/Users/chenxiangning/code/AI/github/tmd-cli")` = `10482c3f…` = 实际 ledger 目录名,补账 cwd 解析链路对得上;当日 6 张 AI 卡引用的 4 个会话里,2 个在该 ledger 有封口批(可补),另 2 个 ledger 无任何记录(补不出,诚实缺失)。
