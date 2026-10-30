# 依赖批次合入与整体查漏评审(2026-10-30)

## 结论

三个 dependabot PR(#80/#81/#79)合入 `Tmd-0.4.5` 分支(Pull #83),全链验证绿;整体变更(83 commits vs main,覆盖 0.4.5→0.4.7)查漏补缺一轮,修三漏:CHANGELOG 0.4.7 缺依赖小节、AGENTS.md 强制清单第 2 条丢序号、PR 模板「500 行」与 300 行铁则口径不一。其余核过为干净:历次评审遗留账目清晰、版本四处同步、锁文件完整、morphicons 2.0 major 无运行时风险。

## 合入与冲突处理

- #80(前端 minor-and-patch 八项)ort 自动并,无冲突。
- #81(morphicons 1.7.1→2.0.0)pnpm-lock.yaml 与 #80 冲突——取 #81 侧锁后 `pnpm install` 重生成(终态锁同时含八项组与 morphicons 2.0.0,已 grep 实证)。
- #79(src-tauri 锁文件四项:webpki-roots 1.0.10、zip 9.0.5、libc 0.2.191、tauri-build 2.7.3)ort 自动并,无冲突。

## morphicons 2.0 major 风险裁决

消费面仅 `src/kernel/iconSet.tsx` 的 `MorphIcon` 组件(morphicons/react),图标数据为仓内自带表(iconSetTables),不依赖其图标名表——major 的图标增删不触及;组件 API 破坏由 typecheck + iconSet.test.tsx 双拦,check:gate 全绿为实证。

## 整体查漏清单

| 检查项 | 结果 |
|---|---|
| 版本四处同步(package.json / Cargo.toml / tauri.conf.json / CHANGELOG 0.4.7 小节) | 0.4.7 一致 |
| 新增文档登记 docs/README.md 索引 | 全部已登记,无漏 |
| 分支新增 TODO/FIXME | 零 |
| 046-supervisor 评审遗留 | P0×2/P1×16/P2 22 项当日修复落地;明示缓办 2 项(P2-18 远程写回乐观锁、P2-22 wslExec 路径插值转义)与真机目检 4 项为登记在案的另轮事项,非漏 |
| welcome omp bun 过旧修复(8abed23d,晚于上轮评审) | 走既有 script 安装通道,新增逻辑为纯函数(isBelowFloor/depOutdatedOf)带测试,latestVersion.test.ts 扩 26 行;无新信任边界 |
| 锁文件完整性 | morphicons@2.0.0、vitest@5.0.5、react@19.3.1 等均在锁 |

## 当轮修复

1. CHANGELOG 0.4.7 补 `### 变更` 依赖小节(CHANGELOG 为发版唯一事实源,依赖批次不可无声)。
2. AGENTS.md「0. 文档落盘铁律」强制清单第 2 条恢复 `2. ` 序号(此前改写丢前缀,列表变 1/无号/3/4/5)。
3. .github/PULL_REQUEST_TEMPLATE.md 自查清单「500 行」改「300 行」,对齐 check:file-size 铁则。

## 验证

- 合入树:`pnpm check:gate` 全链绿(typecheck+test+架构边界+行数铁则+i18n 键比对+kernel 盘点+build);cargo test + clippy --all-targets -D warnings + fmt --check 全绿;react-doctor 100/100。
- 本轮修复仅动文档三处,推送前在最新树复跑 check:gate。
