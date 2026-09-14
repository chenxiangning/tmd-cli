# v0.1.7 发布范围代码评审与收口

- 日期:2026-09-14
- 状态:已完成(评审发现已修/已报,门禁全绿)

## 背景与目标

对 v0.1.6..v0.1.7(31 commits,156 文件,+7684/-780)做发布范围评审:功能实现准确性、架构铁则偏离、兼容性、性能、死代码;另附审 tag 后提交(files/git 顶栏重构与 diff 视图改版,评审期间由并行会话继续推进)。方法 = 五个只读评审切片并行深读(wallpaper / kernel+cli-omp / Rust / wsl+workspace+git / tag 后)+ 主会话全套机械门禁。

## 结论先行

无 P0。共 30 条发现(5 P1 + 25 P2),当日修复 24 条,6 条 report-only(设计取舍或并行会话在途);机械门禁 typecheck / test(1610+230)/ build / arch-boundary / cargo(clippy+fmt)/ react-doctor 100 全绿,300 行铁则仅余 HistoryView.tsx 336 行(并行会话 22:16 后新提交引入,其文件仍在活跃编辑中,留给该线收口)。

## 修复明细(按严重度)

### P1(5 条全修)
1. **Rust clean 不查 ignore 规则**(index_ops.rs):后端语义宽于 `git clean -f`,插件 IPC 路径可删 ignored 文件 → 校验链新增 `git check-ignore --stdin -z` 批量防线(权威源:gitignore/info/exclude/全局排除),整体拒绝、先校验后删;新增测试 `clean_拒绝_ignored_路径_等价_git_clean_无_x`。
2. **fluidShader dispose 泄漏 WebGL 上下文与 GPU 资源**(fluidShader.ts):dispose 补 deleteProgram×N/deleteBuffer/FBO+tex + `WEBGL_lose_context`;setParams/dispose 加 disposed 闸(模式切换即不再遗弃整套活上下文)。
3. **壁纸插件缺 en/ja 词典**(index.tsx 等):照插件词典纪律新增 locales.ts(54 键 en+ja),预设/运动名与注册面文案全部裹 t()。
4. **wsl 绕过 ctx 注册面**(wsl/index.tsx):fileSources/workspaceOrigins/ptyAdapters 三注册表在 PluginContext 补 ctx 通道(返回退订),贡献账本纳入自动退订,wsl 改走 ctx;「不存在旁路注册表」契约恢复成立。
5. **git 变更操作失败静默**(DiffView.tsx):stage/unstage/discard/clean 失败只 console.warn → 统一走 PanelBanners notice 可见报错 + 失败也触发刷新。

### P2(修复 19 条,要点)
- Rust:rebase 中止探测补 rebase-apply 后端与 gitfile 布局;validate_rel_path 拒 Windows 盘符前缀;`--rebase` 兜底加 `args[0]=="pull"` 守卫。
- kernel:busyMarks 契约注释 5s→30s 对齐实现;sessionSpawn 二次 adopt 窄窗注释收敛;prewarm 池空闲回收/注入失败/进程退出后补货(长驻不再退化冷启动),handover 复用同一 scheduleRefill。
- 死代码/注释:cli.ts→cliProfile.ts 旧指引全仓 8 处清零;resetWallpaperStoreForTests、punch dataset 标记、useGitPanelData.upstream 死字段、DistroPanel 恒假高亮 + `.wsl-dir-row.on` 死样式、titlebar/filePanel/RightPanelToolbar/git-index 四处过期注释簇。
- 归一/共享:wsl joinPath×4/parentOf×2 收敛 wslCore(joinWslPath/parentWslPath);string→hue 三份复刻收敛 kernel/colorHash.ts。
- tag 后批:useGitPanelData upstream 死字段;HistoryView 提交行钉 h-10 与 offsets 常数同源(uiFontSize≠16 不错位)+ 头像 color-mix 混 fg 修浅色对比度;WorkspaceSwitcher 菜单 240px 视口夹取 + GitBranchLabel 值等守卫停 5s 空转;`.panel-subbar-actions` 隐态 pointer-events:none 防误触;right-panel-toolbar.css 按顶栏/底部条拆出 panel-subbar.css 达标。

## 方案取舍(report-only 6 条)

- **workspaceOrigins 内嵌 WSL UNC 正则 + ws.wsl 判定**(P1 arch): Removing it依赖插件激活期回填持久化;并行会话在途 + 回归 577b82c/d801735 风险,建议后续以「来源协议 legacy matcher + 回填持久化」迁移后删内核正则。
- **WorkspaceRowMenu 外壳内嵌 git 操作配方**(P2 arch):与 kernel/filePanel 自声明不变量冲突,建议菜单项改经插件贡献槽或 id 串收进 kernel 常量。
- **WorkspaceAddDialog 复用 wsl-\* 类名**(P2 arch):跨插件 CSS 耦合,建议中性化类名,属独立小重构。
- **activityWatch ticker 持轮无衰减**(P2):对偶缺陷「假在途」,但该区三轮修复刚落定、有 15.7MB 实采背书,加天花板需重跑实采验证,不动。
- **FluidBackdrop 整面未接线 props**(P2 deadcode):codemoss 逐字移植件,report-only;若首跑向导不进 v0.2 可砍。
- **HistoryView.tsx 336 行超铁则**:并行会话活跃编辑中(22:16 两个新提交引入),不抢文件;建议其收口时按行组件拆 HistoryRows.tsx。

## 验证

- typecheck / vitest 201 文件 1610 用例 / build / arch-boundary(R1/R3/R4)/ check:file-size(除上述 report-only 一处)/ cargo test 230 + clippy -D warnings + fmt / react-doctor 100。
- 新增 Rust 测试:clean ignored 拒绝;tests_flow 拆出 tests_pull(415→244+178,独立 SEQ 前缀防临时目录并行撞名)。
- UI 行为改动(DiffView 失败横幅、壁纸模式切换资源释放、顶栏菜单夹取)属交互细节,未开真机目检——后续 tauri:dev 目检时顺带核对。
