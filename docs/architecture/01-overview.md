# tmd-cli 基础架构总览

- 日期：2026-09-01（2026-09-04、2026-09-06、2026-09-07、2026-09-14、2026-09-19、2026-09-27、2026-10-04 按当前代码校准）
- 状态：骨架已落地，持续演进
- 铁律：**模块化 + 插件化**

## 1. 产品边界

| 区域 | 第一版职责 |
|---|---|
| 头部工具栏 | 三区布局(左区挂点按钮簇+折叠钮/中区会话与编辑 tab 条/右区工作区切换器+折叠钮);面板入口已迁右缘竖排 rail(2026-09-27),看板/市场/回首页入口已迁左缘 rail(2026-10-04) |
| 左侧栏 + 左缘 rail | 左缘竖排工具 rail(2026-10-04,右缘镜像):顶簇 会话看板〔插件 sidebarActions.leftRail 直挂〕/ 插件市场 / 回到首页 / 工作区切换,底簇 设置菜单触发钮(2026-10-04 自侧栏底栏迁入,菜单本体仍在左下簇);左侧栏 = 统一搜索折叠入口置顶 → 学堂 → 工作区 + 会话列表(会话是主入口;同仓 worktree 卡归簇共框),底栏「工作区显隐」多选菜单控制左栏显示集合 |
| 中央区 | xterm.js 幕布透传 CLI 原生 PTY 输出，零消息/Markdown/Diff 二次渲染；无会话时 welcome 首页；文件编辑器/多形态预览、批审阅单、Git 提交 diff、SSH 远端文件编辑以中央 tab 并存 |
| Composer | 富输入：工具栏显示当前 session 的模型/思考强度（只读）；输入支持截图、拖拽文件、`$` skill、`/` common、`@` 文件/文件夹、提示词增强、跨引擎接力 |
| 右侧栏 + 右缘 rail | 竖排面板 rail:files 文件树 / git 面板(含工作树常驻区) / marks 文件标记 / checkpoints 审批线 / approval-inbox 审批收件箱 / memory 面板 / skill-hub·mcp-hub hub 面板 / daily-journal 日志面板,钉住与 ⋯ 溢出经 rail;ssh 面板走侧栏入口(全部经 kernel/filePanel 注册表);rail 另并排侧栏快捷动作(内置终端/意图画布 rail 位,网络代理底簇;会话看板 2026-10-04 迁左缘 rail) |

## 2. 分层

```
React Host
├── kernel/       插件契约、生命周期、事件总线、IPC、PTY TerminalView
├── app-shell/    五区外壳、插件市场页(PluginMarketPage)与挂载点(宿主职责)
└── plugins/      44 注册:cli-* ×10(omp/pi/kimi/codex/claude/grok/qoder/qoder-cn/opencode/dsh,engine) · workspace · session-budget · files · git · checkpoints(审批线) · network-proxy · ssh(远程会话) · terminal(内置终端) · memory-coordinator(记忆协调) · assets(智能体/提示词) · cli-config(CLI 独立配置) · wsl(WSL 通道) · wallpaper(壁纸) · marks(文件标记) · search(搜索/快开/统一入口) · web-access(Web 访问桥) · session-board(会话看板) · intent-canvas(意图画布) · lsp(语义跳转) · prompt-enhancer(提示词增强) · approval-inbox(审批收件箱) · academy(CLI 学堂) · notify(系统通知) · session-search(会话历史检索) · session-relay(跨引擎接力) · skill-hub / mcp-hub(hub 面板) · session-viewer(会话转录/极简展示) · daily-journal(每日工作日志) · structured-session(结构化会话,omp/pi RPC)(feature) · composer · settings · welcome(core 焊死) · local-loader(本机插件,local)

Tauri Rust
├── pty.rs            portable-pty：spawn / read / write / resize / kill,双线程聚合泵
├── session_log.rs    会话输出落盘(64MB 旋转) + 幕布翻页读取
├── session_disk_log.rs spawn 代日志指针与磁盘尾读(session-last-log.txt 寻址,磁盘先行回放)
├── resolve/          PATH 富化 / 裸命令名 → 绝对路径(mod/path_cache/which,pty·probe·installer 共用)
├── probe.rs          CLI 探针(found/path/version/npmPrefix,8s 超时;npmPrefix = 命中副本的 npm prefix,双副本就地更新判据)
├── installer.rs      参数化安装执行器(InstallPlan:npm/script 双通道,配方由前端 CliProfile 声明),流式日志事件
├── sqlite.rs         通用只读 sqlite 查询(参数化绑定;CLI 私有库路径/表结构知识在插件侧)
├── quota.rs          通用 HTTP 代理 + 只读环境变量
├── proxy.rs          进程级代理 env 注入(HTTP(S)_PROXY/ALL_PROXY;启动按 settings 应用,拔插件即断电)
├── hash.rs           MD5 原语(kimi 会话目录 / checkpoints 账本目录)
├── settings.rs       settings.json 读写
├── session.rs        Session 元数据注册表 + workspaces.json 持久化
├── session_commands.rs session_* 命令自 lib.rs 拆件(PTY/SSH 会话按 kind 路由)
├── fs_walk.rs        全仓文件索引(gitignore 系语义,composer `@` 候选)
├── proc_run.rs       通用短进程通道(CLI RPC 副车 / inspect,spawn_blocking)
├── proc_stream.rs    通用长驻流式子进程通道(行事件 proc://stream/{id}/*;契约见 19)
├── render_health.rs  渲染健康守望(rAF 探针上报 + 壳侧 set_focus→reload 阶梯 + 泵侧洪水/渲染活性计量;契约见 17)
├── fs_temp.rs        临时上传写面(fs_write_temp 服务端字节闸 + 按年龄老化清理)
├── skill_pkg.rs      skill 包三原子(下载/zip 解压防 zip-slip/symlink 落位)
├── fs.rs             文件树读取(只读)
├── fs_edit.rs        文件写操作:新建/重命名/废纸篓/访达显示/编辑器保存/受管副本拷贝 fs_copy_file(绝对路径,禁 .git 段,16MB 上限)
├── fs_preview.rs     文件预览读取(文本/图片 dataURL/二进制 base64,自 fs.rs 拆出)
├── git/              libgit2 原语(status/diff/branch/log+refs装饰/commit);fetch/pull/push 与 worktree 走 shell-out(commands_worktree 写命令 run_mut 后 evict 缓存句柄,porcelain 解析在 worktree_parse)
├── lsp.rs + lsp_framing.rs  通用 LSP 进程通道(spawn/send/stop,组帧拆件;stderr 纯排空无事件)
├── open_with.rs      「打开方式」枚举与执行(macOS/Windows/Linux)
├── ssh/              russh 一等 SSH 会话引擎(transport/session/auth/known_hosts/control/forward/sftp 全家,附 e2e 实测)
├── web/              手机/浏览器远程桥:web_access(LAN 直连)+ relay(自建中继出站拨号/多路复用/一键部署)+ dispatch(全量命令镜像,EXCLUDED 面控清单有测试)+ event_sink(webview+桥双扇出)+ devices/pair/gate(设备凭证/配对/授权);selfhost SSH 部署与 relay_selfhost_persist 部署历史落盘(含口令明文,纪律同 ssh.hosts)
├── wsl*.rs           WSL 通道原语(发行版信息/远程探测/远程列表/引擎探针/exec/文件文本读取)
├── plugins_cmds.rs   本机插件扫描/读取/归档/回退/删除(~/.tmd-cli/plugins/)
├── app_setup.rs      启动装配:panic 钩子(直写 stderr 禁再 panic,后台打印一律 safe_eprintln 断管道免疫)+ 插件目录迁移 + 更新器
└── checkpoints/      审批线账本 sidecar(ledger.jsonl + objects.git 裸库 + states.json,永不触碰用户仓库)

### 内核边界

内核只负责：窗口外壳、插件注册/激活、挂载点、PTY 生命周期、跨插件事件、IPC 边界。

插件不能直接依赖其它插件实现；通过 `PluginContext` 的 profile 注册、UI contribution 和 `EventBus` 协作。

## 3. 会话模型

```
Session = CLI profile + PTY + cwd + CLI native session id
```

一个会话固定一个 CLI，不能中途切换。恢复会话由 CLI 插件声明 `resumeArgs`，适配各 CLI 自身的会话存储和恢复机制。

SSH 会话是第二类一等会话：同一 `Session` 形状但无 CLI profile，Rust 侧按 kind 路由（russh 引擎），输出走同一 `pty://out/{id}` 事件，幕布 / tab 条 / 输出缓冲 / 翻页全链路零分叉；无 composer，不参与 Ask 检测、审批线与只读状态栏。
连接失败不会静默消亡:错误文本原样进幕布,会话保留在 failed 态(右栏面板同步状态卡),由用户「断开」收尾;终态事件同时撤下未应答的 host key/KBI/密码提示卡。

内置终端是第三类一等会话(kind="shell"):本地默认 shell(macOS zsh / Linux bash / Windows cmd),同样无 CLI profile,经 `SpawnSpec.kind/title` 透传登记(`kernel/shellSessions.ts` 装配,SSH 同构);terminal 插件只贡献右缘 rail 直挂入口(点击聚焦最新/⌥⌘Ctrl 新建),会话生命周期归 kernel,拔插件不孤儿化会话。
WSL 不是第四类会话:本机发行版 = UNC 工作区 + `wsl.exe` spawn 包装,远程宿主 = SSH 通道内 `wsl.exe`,引擎/传输语义不变;契约见 `09-wsl-contract.md`。

Composer 的只读状态通过 CLI profile 的 `readSessionStatus` 适配器读取各 CLI 自己的 session JSONL。内核只编排状态刷新，不理解 OMP、Pi、Codex 的文件格式；状态缺失时显示 `—`，不猜测默认值。

## 4. Composer 输入模型

Composer 只负责富输入体验和发送编排，不实现 CLI 命令语义：

- `$`：skill；由 CLI profile 声明，不支持则不激活；候选以 CLI 为真相源（`listSuggestions`：omp/pi RPC 副车、grok `inspect --json`、claude/qoder/codex/kimi 磁盘扫描）与静态表按 value 去重合并
- `/`：common command；由 CLI 自己解析；候选来源同 `$`
- `@`：文件/文件夹引用；候选 = Rust `fs_walk_files` 全仓索引（gitignore 系语义，60s 缓存，上限 2 万）+ 客户端 smart-case 模糊（cli-shared/fileIndex）
- 截图/拖拽文件：落盘为会话临时文件，再按 CLI profile 规则注入
- 发送：统一进入 PTY 写入通道，多行文本直发并以 CR 提交；bracketed paste 按 profile 声明（`bracketedPaste`，pi-tui 系 kimi/pi 生效，正文包 `ESC[200~…ESC[201~` 再 CR），未声明的 CLI 裸文本直发

CLI 插件可以提供 `translate` 钩子处理语法差异，例如 omp/pi 的 `$skill` → `/skill:skill`；codex 原样透传。

## 5. 输出模型（硬约束）

```
PTY bytes → Tauri event pty://out/{sessionId} → xterm.js
```

中央幕布禁止额外渲染消息气泡、Markdown、Diff、token 面板。所有增强只能位于 Composer、左右侧栏、头部/底部工具栏。

## 6. 插件契约

核心接口位于 `src/kernel/plugin.ts`：

- `activate(ctx)` / `deactivate()`：生命周期
- `registerCliProfile(profile)`：CLI 插件注册启动 profile
- `CliProfile.readSessionStatus`：声明 CLI 私有 session 状态读取能力
- `contribute(point, contribution)`：向 17 个挂点扩展（header.left/right/leftCluster/breadcrumb、leftSidebar.section/workspaceCaption、workspace.newSessionMenu、overlay、editorCenter.welcome/composer、editorCenter.canvasOverlay、terminal.canvasRow、welcome.footer、composer.statusBar/inputRail/attachments、market.local；无渲染方的挂点不声明）
- `registerSettingsSection(section)`：向设置面板注册 section（左导航 + 右 tab），settings 插件按注册表渲染
- `registerFilePanel` / `registerTabContent` / `registerSidebarAction` / `registerFileVisual` / `registerMarketPanel` / `registerHomePanel` / `registerCliConfig` / `registerCommand` / `registerEditorExtension` / `registerTerminalLinkProvider` / `registerLanguageServer` / `registerAcademyCourse` / `registerRemoteFileSource` / `registerWorkspaceOrigin` / `registerSpecWrapper` / `registerShellSpecProvider`：右栏面板、中央 tab 内容（按 tab.kind 路由）、侧栏快捷动作、文件视觉、市场面板、首页面板、CLI 配置、命令键位、编辑器扩展、终端链接、语言服务器、学堂课程、远端文件源、工作区来源、规格包装、shell 装配,全部经 ctx 登记(无旁路注册表;完整签名见 plugin.ts PluginContext)

新增能力的标准路径分两类：

- UI/CLI 能力：新增 `src/plugins/<id>/` → 实现 `Plugin` → 加入 `src/plugins/index.ts`。
- 跨插件基础契约：先在 `src/kernel/` 增加稳定类型/原语，再由插件实现；内核不得理解 CLI 私有格式。
- 插件可插拔：`PluginMeta.category` 四档 engine/feature/core/local（core 焊死不可拔,local = 本机插件装载器自身可拔）；插件市场数据源与激活编排见 `kernel/pluginLifecycle.ts`，拔插写 `settings.disabledPlugins`，重启生效。

## 7. Quota(额度查询)架构

额度是 composer 工具栏的只读指示,内核不理解任何供应商协议。

```
QuotaChip (composer 插件)
  └─ kernel/quota.ts        QuotaSnapshot 统一结构 + 注册表(host 按 CliProfile.fetchQuota 自动接线)
       └─ cli-*/quota.ts    凭据适配层(读各 CLI 自己的登录态)
            ├─ cli-shared/quota/vendors/(目录:index/types/http/detect/fetchers/codex/relay)   供应商 HTTP 协议适配(kimi/minimax/zhipu/deepseek/relay/wham)
            │    └─ tauri quota_fetch        Rust 通用 HTTP 代理(reqwest,15s 超时)
            └─ cli-shared/quota/codexLocal.ts  codex 官方 OAuth 本地 rollout 快照(零 HTTP 优先)
```

**职责切分**:

| 层 | 职责 | 不理解 |
|---|---|---|
| `kernel/quota.ts` | `QuotaSnapshot{windows,balanceText,planLabel}` 契约与注册表 | 供应商差异 |
| `cli-*/quota.ts` | 凭据来源(codex auth.json+config.toml / omp agent.db / pi auth.json+models.json)与模型→供应商路由 | HTTP 协议 |
| `vendors/` | 供应商协议:kimi / minimax-cn·en / zhipu-cn·en / deepseek / relay + codex wham(降级);dashscope(阿里云百炼)显式识别为不支持(无公开额度 API,不误入 relay 探测) | CLI 凭据格式 |
| `codexLocal.ts` | codex 官方 OAuth 本地 rollout 快照解析(优先路径) | HTTP(零请求) |
| `quota.rs` | 通用 HTTP 代理 + `quota_env_value` 只读环境变量 | 业务语义 |
| `sqlite.rs` | sqlite 通用代读代写(RW 打开 + query_only 连接:重放 WAL 看到未 checkpoint 行;async + spawn_blocking):JS 无法解析 sqlite,但路径/表结构知识在插件侧(cli-shared/quota/ompAuth.ts、cli-opencode/db.ts) | HTTP/其它 CLI |

**关键设计决策**:

- **Codex 额度分级策略(官方登录零 HTTP,自定义 key 走 HTTP)**:直连 wham 有封号风险,故 `auth.json` 为 ChatGPT OAuth(`tokens.access_token + account_id`)时,优先读 CLI 本地 rollout 快照(`~/.codex/sessions/**/rollout-*.jsonl` 的 `token_count.rate_limits`,即 codex TUI 底部 5h/7d 的同一数据路径,实现在 `cli-shared/quota/codexLocal.ts`);快照不可用降级 wham HTTP。自定义 key 模式(`OPENAI_API_KEY` + `config.toml` 的 `[model_providers.<x>].base_url`,实证为 minimax 中转)按 base_url 检测供应商走 HTTP。cli-pi 的 openai-codex 路由同策略:OAuth 凭据 → 本地快照降级 HTTP,非 OAuth → 直接 HTTP。
- **Pi 是"多供应商 CLI",路由不猜**:model 前缀(`zai-coding-cn/glm-5.2`,provider 来自 session jsonl `model_change.provider`)→ 裸 modelId 经 models-store/models.json 反查(凭据存在性消歧,多候选报错)→ 无 model 时仅单供应商配置可安全回退。
- **Pi 凭据三源**:`auth.json[provider]` → auth 语义 vendor 匹配(模型前缀 `kimi-code` ≠ auth key `kimi-coding`)→ `models.json` 的 `apiKey`(中转站实证,auth.json 无条目)。配置目录支持 `PI_CODING_AGENT_DIR` 覆盖。
- **凭据引用**:`$ENV_VAR` 经 Rust `quota_env_value` 只读解析;`!command` 显式拒绝(不执行 shell)。
- **Claude 额度分级(与 codex 同策略)**:凭据源为 `~/.claude/settings.json` 的 `env.ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY`(实证 kimi 中转);有 base_url 则按 vendors 检测走 HTTP。官方 OAuth(`~/.claude/.credentials.json` 的 `claudeAiOauth.accessToken`)无公开套餐额度 HTTP 面,显式报不支持并指引 `claude /usage`,不猜接口。
- **relay(未知中转站)**:Sub2API `{origin}/v1/usage` 探测,失败回退 New API `/api/user/self`。
- **解析/IO 分离**:`parseCodexRolloutTail` / `parseZhipuLimit` / `resolvePiRoute` 为纯函数,契约由 vitest 单测守护(`pnpm test`)。

## 8. 当前实现状态

已完成:v0.2.9 全量。骨架 = 插件宿主与市场(44 注册:engine 10 / feature 30 / core 3 / local 1)、十 CLI profile + SSH 一等会话(russh 0.63,kind 路由)+ 内置终端(kind=shell)、PTY 全生命周期与输出落盘翻页(泵自适应聚合窗 8→50ms;后台/渲染暂停期钳 250ms 慢拍,session_set_viewed 在视打点)、xterm 幕布(DOM 渲染器)、五区外壳、顶栏会话 tab 条、Composer(触发符/拖拽/截图/命令抽屉/锚点栏/Quota chip/提示词增强 prompt-enhancer/附件芯片 marks/技能与 MCP 唤醒图标)、bracketed-paste、只读状态工具栏、Quota 全供应商识别 + relay 探测、welcome 首页(探针/安装/凭据盘点/RESUME·QUOTA·TOKENS 页脚)、Git 面板全量(差异/分支/历史 Graph + PR 一键/多仓 git_repos_scan + RepoBar 四象限)、**Worktree 关联管理**(Git 面板常驻「工作树」区 + 分支三分区 + 侧栏归簇,契约见 architecture/16)、文件树 + CodeMirror 编辑器 + 渲染档案 + Markdown 预览、审批线(双归因/回退/影子对象库/批内危险度红标,时间线节点复制原文)、审批收件箱(approval-inbox)、SSH 右栏面板(SFTP/端口转发/远端编辑)、WSL(M1)、主题引擎(31 个 VS Code preset + 六套 tmd 原创低饱和主题)+ 设计系统 token 阶梯(字号/间距/圆角/动效 + Empty/Spinner/错误契约三原语)+ 界面字号 rem 体系 + 图标装饰与五套图标组合、网络代理、会话置顶/重命名/预算/管理模式/运行区/会话行 tok/s pill(行型分派分子 + 近 5 对滑窗口径)、会话卫生清扫、Ask 检测(字节流+屏幕态双路,镜像与幕布互斥)+ 提示音 + 系统通知(notify)、异常退出 toast 与一键续聊、全局快捷键(注册表+分发器)、memory-coordinator、cli-dsh(幕布钉底光标纪律与会话 writer-held 分流,契约见 20)、版本号弹窗+updater 自动更新、LSP 语义跳转(四语言发现链 + peek/hover Prism 配色渲染)、统一搜索折叠入口、会话历史检索(session-search 增量索引+用量徽标)、跨引擎接力(session-relay)、CLI 学堂(academy:九家课程,契约见 15)、**能力 Hub 四件**(意图画布 intent-canvas / 技能中心 skill-hub / MCP 中心 mcp-hub / 每日工作日志 daily-journal,0.2.5..0.2.7 落地)、**结构化会话**(structured-session:proc_stream 原语 + omp/pi `--mode rpc` token 级流式,幕布|结构化双视图,审批卡直答,契约见 19;幕布右上工具行 terminal.canvasRow 挂点承载切换钮与刷新钮)、会话查看器(session-viewer 六族转录零 PTY + 极简展示)、Web 远程访问(web/ 桥:LAN + Cloudflare + 自建中继 SSH 一键部署,直连 WS 心跳保活,契约见 12)、手机 App(iOS SwiftUI/Android Kotlin 壳 + src/mobile 第二 UI 树:三态胶囊 composer/选图拍照上传/审批卡/Git 面板/历史续聊/首页卡片化)、右缘面板 rail、渲染健康守望(rAF 探针 + 壳侧心跳阶梯 + 洪水降级宽限 + 后台慢拍降档 + 幕布数据链停滞探针,契约见 17)、panic 钩子加固(safe_eprintln 断管道免疫)。

在途变更契约:mobile M2 轻交互(代码已落地,真机验收余 7 项,openspec/changes/2026-09-22-mobile-app-m2-light-interaction)、skill-hub / mcp-hub 变更契约待归档(openspec/changes/ 在册)、签名管道(macOS 管道就绪待 APPLE_* secrets)。其余已落地契约归档于 openspec/changes/archive/。

