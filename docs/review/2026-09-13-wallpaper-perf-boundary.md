# 壁纸/流体插件性能与边界评审

- 日期:2026-09-13
- 范围:src/plugins/wallpaper 全量(图片模式 + 流体移植)与其触点(TerminalView / 主题 token / 设置面板 / 选择器弹窗)
- 状态:已完成(P1 两项随本评审落地修复;P2 记录缓解选项待实测定夺)

## 一句话结论

功能面无阻塞性瓶颈:流体的 GPU 成本已被 codemoss 的移植缓解(dpr≤1.5、1/4 分辨流场、drift 30fps、隐藏停 RAF)兜住,真机(wallpaper 插件 + aurora/chase 实测)无 fluidShader 告警。本轮修掉两个 P1:选择器网格缩略图无懒加载(数 MB 级图一次性解码,滚动卡顿)、插件 CSS 无条件改写 kernel 终端底色(边界越权)。边界共识别 6 项:2 项本轮修复,4 项记录在案。

## 性能盘点

### P1(本轮修复)

1. **选择器网格缩略图无懒加载**:每卡 `<img>` 经 asset:// 直载原图(实测库内 7.5MB 级 PNG),CSS 缩放显示——网格一次滚动触发 N 张全尺寸解码,内存峰值 + 主线程解码卡顿。修复:`loading="lazy"` + `decoding="async"`(viewport 外不加载)。
2. **xterm 底色锚定的实现位置**(与边界 #1 同源):插件 CSS 以无条件 `!important` 重锚 kernel 组件样式,壁纸关闭也生效。挪入 kernel 样式域后行为不变,但消除了插件对 kernel DOM 的越权(见边界 #1)。

### P2(结构性成本,记录 + 缓解选项)

3. **流体模式整窗持续合成**:canvas 30fps(drift)/60fps(结构场)+ 全 chrome 半透明 veil → 合成器每帧重混整窗,GPU 成本 = 窗口面积 × 帧率。已继承的缓解:dpr 上限 1.5、流场 1/4 分辨、隐藏窗口停 RAF、lite profile(未接 UI)。残余风险在低端 GPU/超大窗口;若实测烫/掉帧,候选缓解:终端区 veil 浓度提一档、或设置面加「流体帧率」档位(改 `fpsFor` 一处)。
4. **流体 attach 五程序急编译**:Mac 不 deferChase,启用流体瞬间一次性编译全部运动着色器(百 ms 级 hitch);此后切预设/运动是纯 program swap,无卡顿。若启用瞬间顿挫感可感,改 `deferChase: true`(选中游龙才编译,代价是首选游龙时小 hitch)。
5. **窗口拖拽 resize 期间 canvas 缓冲逐帧重分配**:ResizeObserver 每 tick 设 canvas.width/height = WebGL 重分配。缓解选项:防抖到 resize settle(代价:拖拽中位图短暂拉伸模糊)。默认不动,留实测定夺。
6. **大图壁纸主线程解码**:切换/轮播瞬间一次(decode="async" 已开)。瓶颈在图片本体;图库导入不设转码(v1 立场),用户侧选 ≤2MB 级图片体验最佳。
7. **themeApplied → punch 重拍**:每次任意设置变更触发 6 个 computed 读取 + 内联写,微秒级,忽略。
8. **滑杆拖动逐 input commit → 层重渲染**:store 防抖落盘已兜写盘,渲染量级小,预期行为。

### P3(核查无虞)

隐藏窗口停 RAF(visibilitychange)✓;mode 切换 dispose 句柄并断监听 ✓;无 object URL/dataUrl 泄漏(未用 blob,fallback dataUrl 为字符串随 GC)✓;轮播 setTimeout 随依赖重置 ✓;同值 setDark React bail ✓;rotation 仅 image 模式 ✓。

## 边界盘点

1. **[修复] 插件 CSS 无条件改写 kernel 终端底色**:wallpaper.css 内 `.xterm/.xterm-screen/.xterm-viewport` 规则(为壁纸打穿引入)无条件生效——插件永久重定义了 kernel 组件的渲染契约。修复:TerminalView 容器加 `terminal-view-host` class,锚定规则(等价映射:viewport 底色 = `--tmd-terminal-bg` token,外层透明)挪入 `src/styles/terminal.css`(global.css 登记),插件 CSS 删除该段。顺带修掉 kernel 潜伏陈旧性:xterm 底色此前只在挂载/themeApplied 时快照,token 变更不实时。
2. **[修复] 插件自拼 `~/.tmd-cli` 布局**:store.ts 以 `joinPath(home, ".tmd-cli", …)` 拼配置目录——目录布局 owner 是 Rust `session::config_dir()`,插件持内核布局知识属反向越界;且既有 `configHomeDir` 命名名不副实(返回用户主目录,codemoss 命名遗留)。修复:Rust 暴露通用 `config_dir` command,ipc 加 `configDir()`(权限面归类 ipc.config),store 改用;落盘位置不变。
3. **[记录] z-index:-1 沉底依赖 `.app` 非 stacking context**:overlay 挂点合法用法,但属对 shell 布局的隐式假设(app-shell 若引入 transform/opacity 即失效)。已在 WallpaperLayer 注释声明;不修。
4. **[记录] punch 内联覆盖主题 token 并在 restore 写回原值**:与 theme.ts「唯一应用点」职责重叠,经 subscribeThemeApplied 协调(监听注册早于任何终端,顺序保证成立)。restore 写回是必要的(否则关壁纸后 token 缺失回落静态值,自定义 preset 错色直到下次 applyTheme)。可接受。
5. **[修复] joinPath 双处重复定义**(store.ts / WallpaperPicker.tsx)——收敛为 store.ts 导出。
6. **[核查] import 面全 @kernel,无 @shell 反向依赖**(R4 CI 绿);持久化/受管目录全在插件侧,kernel 仅获通用原语(fsCopyFile/configDir 无插件语义)。

## 验证

typecheck / vitest 197 文件 1569 测试 / arch-boundary / file-size / build / react-doctor 100 全绿;cargo test / clippy / fmt 绿(config_dir 增量);tauri:dev 真机窗口流体(aurora/chase)+ 图片双模式目检通过。
