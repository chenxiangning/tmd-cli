# 文档对码 v0.2.9(2026-10-04)

- 日期:2026-10-04
- 状态:已完成
- 范围:docs/architecture/01·02·17、docs/FEATURES.md、docs/README.md 索引、README.md、README_EN.md
- 方法:自 10-01 v0.2.7 校准(adf5ee49)以来提交逐域扫描 + 工作树在途件(渲染健康第十一轮)实读;全部口径以代码实数为准(allPlugins / generate_handler / MountPoint union / find 计数 / git log)

## 基线实数(机械扫描取证)

| 口径 | 旧文档 | 实况 |
|---|---|---|
| allPlugins 注册插件 | 44(01/02 已对;FEATURES/README 停留 38/39/43) | 44:engine 10 / feature 30 / core 3 / local 1 |
| MountPoint 挂点 | 17(01)/ 15(02 §6 漏 canvasOverlay·canvasRow 两节点) | 17(plugin.ts union) |
| Tauri command 注册 | 162(v0.2.7 校准) | 165:+session_set_viewed(session_commands 13→14)、+app_pid、+process_alive(lib.rs 直注册 10→12);git 40 / ssh 19 / commands_fs 18 / web·relay 13 / checkpoints 11 / fs_edit 8 / 本机插件 8 / wsl 6 / proc_stream 4 / open_with 3 / lsp 3 / quota 2 / sqlite 2 / mcp_probe 1 / render_health 1 |
| PluginContext 注册面 | 19 register* | 19(不变,plugin.ts 全表核对相符) |
| .ts/.tsx 源文件(不含测试) | 876(02 §9,09-27 口径) | 1129(2026-10-04,含工作树在途 2 件) |
| russh 版本 | 0.62(02 SSHB 节点 / FEATURES) | 0.63.3(Cargo.toml,0.2.9 依赖批) |
| 版本号 | 0.2.5(README 产物矩阵) | 0.2.9(package.json / tauri.conf.json / Cargo.toml 三处同源) |

## 逐档修订

- **01-overview**:头部校准戳 +2026-10-04;§1 右缘 rail 面板枚举补 skill-hub / mcp-hub / daily-journal 与 rail 位侧栏动作;§2 Rust 树补 proc_stream / render_health / fs_temp / skill_pkg 四模块;§8 状态段整体重写至 v0.2.9(44 注册、能力 Hub 四件、结构化会话、六套原创主题与设计系统、渲染健康守望族、手机 0.2.9 链路、tok/s pill、cli-dsh 契约 20),在途契约改实(mobile M2 余 7 项 / skill-hub·mcp-hub 待归档 / 签名管道待 secrets)。
- **02-code-architecture**:头部 v0.2.4→v0.2.9 + 在途工作树标注;§1 LIB 节点 162→165(分域含 session_commands 14、lib.rs 直注册 12)、PTY 节点补自适应窗与 250ms 慢拍、SSHB 节点 russh 0.62→0.63;§2 allPlugins 38→44;§6 挂点地图 15→17(补 editorCenter.canvasOverlay / terminal.canvasRow 节点与 session-viewer 贡献边,右栏面板并列 tab 枚举补三 hub 面板);§8 命令面 162→165 + session_set_viewed 新行(在视打点与泵侧降档语义)+ platform_kind 行扩 app_pid/process_alive(lsp jdt 双键隔离原语);§9 react-doctor 源文件口径 876→1129。
- **17-render-health**:本轮由十一轮实施会话同步增补(泵侧后台慢拍 + 镜像 feed 互斥 + 数据链停滞探针,引 superpowers/specs/2026-10-04-canvas-stall-pump-background-design.md);本对码轮仅核对相符,未重复改写。
- **docs/FEATURES.md**:新增 2026-10-04 补校头(0.2.8/0.2.9 增量域 + 10-01「不变 38」漏校更正);插件市场计数 38→44(10/30/3/1);SSH 引擎 0.62.2→0.63.3;新增域条目——工作区会话(tok/s pill 口径 / 会话 tab 收敛 / 视图保活统一 / 结构化会话基座条)、审批线(时间线节点复制钮)、文件与编辑器(LSP 弹窗 code 渲染与 jdt 隔离 / 文件操作条下放)、设置与外观(六套原创主题以代码标签为准:云白/雾灰/暖帛/石墨/黛蓝/暖炭 / 设计系统 token 阶梯与状态三原语 / 原生弹窗清零)、外壳与窗口(幕布右上工具行 / 渲染健康守望全链)、手机 App(三态胶囊 composer / 选图拍照双入口 / 快捷键条两行网格 / 直连 WS 心跳保活 / 实况屏治理 / 首页卡片化与 web 桥退避)。
- **README.md**:插件计数三处统一 44(插排 40 可视拔位 = 引擎 10 + 功能 30;架构分层 43→44 补 structured-session);「当前状态」补结构化会话 / 六套原创主题与设计系统 / 渲染健康 / 手机 0.2.9 对话链路;幕布渲染层改 xterm 内建 DOM(原文「WebGL 上下文丢失自动回退」为 09-10 弃用前旧貌);快捷键作用域 global / pty / composer 改实为 global / terminal / editor;tok/s pill 口径更新;技术栈 highlight.js 改 Prism(依赖实况);产物矩阵 0.2.5→0.2.9;快速开始补 check:i18n-keys;在途清单改实。
- **README_EN.md**:与中文版同源事实同步(计数 42→44、structured-session bullet、v0.2.9 产物矩阵、DOM 渲染器、Prism、快捷键作用域、主题与设计系统、手机 0.2.9、渲染健康)。
- **docs/README.md 索引**:01 / 02 / FEATURES 三行状态列追加 10-04 校准戳;本记录登记。

## 未动项(核对相符)

- 03/04/05/06/07/08/09/10/11/12/13/14/15/16/18/19/20 号契约:随各自实施提交同步维护,本轮抽核(12 含 10-03 直连心跳保活段、18 含 oneshotStdin、20 含 10-02 writer-held 分流)与代码相符,零改动。
- AGENTS.md:分层铁律 / 落盘铁律与代码实况无矛盾,零改动。

## 验证

纯文档轮:全部计数经机械扫描取证(git ls-files / generate_handler diff / plugin.ts union);markdown 不受 300 行闸约束;README 交叉链接与图片路径目检;react-doctor / typecheck 不受影响(零代码改动)。
