# 11 工作区壁纸:表面 token 打穿 / 壁纸态层梯 / 流体着色器

- 日期:2026-09-13(b5c9d7c 起六连落地:3555c0f 流体移植与性能收口、5c42ece 审查收尾、edb9539 弹层透视根治、13bf374 插排提层、8f2bb97 bg-panel 拆分;同日定稿)
- 状态:生效中 —— 改壁纸插件 / 主题 token / 终端底色 / shell 层叠前必读
- 来源:调研 `docs/research/codemoss-workspace-wallpaper.md`(决策点 2 = token 覆盖替代 650 行选择器清单),评审 `docs/review/2026-09-13-wallpaper-perf-boundary.md`

## 结论

壁纸是 feature 插件(可拔):`overlay` 挂点 order -100 沉底背景层(`z-index:-1`,`pointer-events:none`,PTY 字节流与 xterm 渲染零触碰 —— 背景是幕布之外的视觉层)+ 设置「壁纸」分区。mode 三态 `off / fluid / image`;激活即「打穿」chrome 表面 token 为半透明 color-mix 让壁纸透出,关闭按快照原值还原。kernel 零壁纸语义:持久化与受管图库插件自管(`<config_dir>/wallpaper.json` + `wallpapers/`),kernel 只新增通用原语(`config_dir` / `fs_copy_file`,无插件语义)。

## 契约

1. **打穿引擎(`punch.ts`)**:六 token 表 `--tmd-bg-base 18% / bg-sunken 30% / bg-panel 45% / bg-hover 65% / bg-input 70% / terminal-bg 45%`(浓度对照 codemoss chrome veil)。覆盖值 = 快照原色 + color-mix,保留任意自定义 preset 真实底色;`terminal-bg` 单独解析为 rgba 字面量(xterm 自行解析主题色,不认 color-mix)。**elevated 不打穿**:它承担「浮层实底」语义(菜单/下拉经 `--surface-sidebar-opaque` 指到它),打穿会让弹层透视重叠;常驻大面板(composer 等)走 `--tmd-bg-panel` 单独打穿(2026-09-13 实测修正)。幂等:重复同向调用不重拍快照(快照必须在无覆盖态取)。theme.ts 重应用整批抹键 → `subscribeThemeApplied` 内重拍快照;主题桥(`terminalThemeBridge`)通知在监听循环之后发出,活幕布 xterm 重读必见打穿后的值。
2. **壁纸态层梯**(`wallpaper.css`):沉底 -1(依赖 `.app` 非定位兄弟不成 stacking context,隐式假设已在层组件注释声明);设置面板打开 → `is-lifted` z 40,插排页等 shell 全屏 overlay 经 `:root[data-shell-overlay]` 标记通道同提 40 —— 即层梯 **壁纸 40 < titlebar 45 < 插排页 50 < 设置面板 100**,面板薄纱透到的是纯壁纸(应用内容被不透明壁纸层挡住),调参实时跟手。
3. **流体模式(fluid)**:codemoss 移植(DSH-Transparent-UI-Plugin,MIT)WebGL 着色器,五运动场 × 预设色调,明暗跟随走 `subscribeThemeApplied`(theme.ts 是 `:root[data-theme]` 唯一写点,事件比 DOM 监听准);参数变化 `setParams` 原地推送,仅 profile 切换重挂 WebGL 上下文。性能边界(继承):dpr ≤1.5、流场 1/4 分辨、drift 30fps、隐藏窗口停 RAF;结构性成本与缓解选项见评审 P2(整窗持续合成 / 五程序急编译 / resize 逐帧重分配 / 大图主线程解码)。
4. **数据与清洗(`types.ts`)**:整体清洗任意畸形输入回落安全默认,绝不抛出;旧 `enabled` 字段迁移 → `mode:"image"`。库条目 id 黑名单拒 `[|\u0000-\u001f]`(轮播可见项按 `|` 连接计数,注入面收口);本地路径安全闸(非空 / 无 NUL / 非 URL)。导入 = 受管副本(`fs_copy_file`)+ 按 sourcePath 规范化去重复用已有条目。
5. **持久化(`store.ts`)**:`wallpaper.json` 防抖 400ms 落盘;`pagehide` / `visibilitychange` 退出冲刷(防抖窗口内关窗不丢最后一次改动);目录布局知识零持有 —— 经 Rust `config_dir` 原语取配置目录(评审 P1:插件自拼 `~/.tmd-cli` 属反向越界,已修)。
6. **边界红线**:插件不得改写 kernel 组件样式 —— 终端底色锚定(viewport 底色 = `--tmd-terminal-bg`,外层透明)归 `src/styles/terminal.css` 的 `terminal-view-host`,顺带修掉 token 变更不实时的陈旧性(评审 P1);popover/hover 族保实底可读是打穿表的硬前提,新增表面 token 先想打穿语义。

## 关键文件

- `src/plugins/wallpaper/punch.ts` —— 打穿表 / 快照还原 / 主题跟随接线
- `src/plugins/wallpaper/WallpaperLayer.tsx` —— 沉底层(mode 三态 / 轮播 / 提层)
- `src/plugins/wallpaper/FluidBackdrop.tsx` + `fluidShader.ts` / `fluidTones.ts` —— 流体着色器与运动场
- `src/plugins/wallpaper/store.ts` / `types.ts` —— 自管持久化与清洗
- `src/kernel/terminalThemeBridge.ts` —— 终端 token 写手 → 活幕布重读通知
- `src/styles/terminal.css` —— xterm 底色锚定(kernel 样式域)
- `src-tauri/src/session.rs`(`config_dir`)/ `fs_edit.rs`(`fs_copy_file`)—— 通用原语

## 验证

- 单测:`fluid.test.ts` / `wallpaper.test.ts`(打穿幂等 / 终端 veil rgba / 清洗与 id 黑名单 / 去重)。
- 评审:`docs/review/2026-09-13-wallpaper-perf-boundary.md` —— P1×2 随评落地(缩略图懒加载 / xterm 底色锚定归 kernel),P2 结构成本记录在案留实测定夺,P3 核查无虞。
- 真机:流体(aurora/chase)+ 图片双模式 `tauri:dev` 目检;弹层实底、设置面板提层透纯壁纸、插排页提层逐项过。
