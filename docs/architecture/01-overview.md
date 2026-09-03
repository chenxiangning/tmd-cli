# tmd-cli 基础架构总览

- 日期：2026-09-01（2026-09-03 按当前代码校准）
- 状态：骨架已落地，持续演进
- 铁律：**模块化 + 插件化**

## 1. 产品边界

| 区域 | 第一版职责 |
|---|---|
| 头部工具栏 | 复刻 mossx 外观，预留插件挂载点 |
| 左侧栏 | 工作区 + 会话列表；会话是主入口 |
| 中央区 | xterm.js 幕布透传 CLI 原生 PTY 输出，零消息/Markdown/Diff 二次渲染；无会话时 welcome 首页；文件编辑器与批审阅单以中央 tab 并存 |
| Composer | 富输入：工具栏显示当前 session 的模型/思考强度（只读）；输入支持截图、拖拽文件、`$` skill、`/` common、`@` 文件/文件夹 |
| 右侧栏 | files 文件树 / git 面板 / checkpoints 审批线时间线，三面板并列 tab（经 kernel/filePanel 注册表） |

## 2. 分层

```
React Host
├── kernel/       插件契约、生命周期、事件总线、IPC、PTY TerminalView
├── app-shell/    五区外壳、插件市场页(PluginMarketPage)与挂载点(宿主职责)
└── plugins/      cli-* ×8(omp/pi/kimi/codex/claude/grok/qoder/qoder-cn) · workspace · session-budget · files · git · checkpoints(审批线) · composer · settings · network-proxy · welcome

Tauri Rust
├── pty.rs            portable-pty：spawn / read / write / resize / kill,双线程聚合泵
├── session_log.rs    会话输出落盘(64MB 旋转) + 幕布翻页读取
├── resolve/          PATH 富化 / 裸命令名 → 绝对路径(mod/path_cache/which,pty·probe·installer 共用)
├── probe.rs          CLI 探针(found/path/version,8s 超时)
├── installer.rs      一键安装 CLI(npm -g / claude native),流式日志事件
├── omp_auth.rs       omp agent.db 凭据只读(sqlite,CLI 私有存储的唯一例外模块)
├── quota.rs          通用 HTTP 代理 + 只读环境变量
├── proxy.rs          进程级代理 env 注入(HTTP(S)_PROXY/ALL_PROXY;启动按 settings 应用,拔插件即断电)
├── hash.rs           MD5 原语(kimi 会话目录 / checkpoints 账本目录)
├── settings.rs       settings.json 读写
├── session.rs        Session 元数据注册表 + workspaces.json 持久化
├── fs.rs             文件树读取(只读)
├── fs_edit.rs        文件写操作:新建/重命名/废纸篓/访达显示/编辑器保存(绝对路径,禁 .git 段,16MB 上限)
├── git/              libgit2 原语(git2 vendored);fetch/pull/push 走远端 shell-out
└── checkpoints/      审批线账本 sidecar(ledger.jsonl + objects.git 裸库 + states.json,永不触碰用户仓库)

### 内核边界

内核只负责：窗口外壳、插件注册/激活、挂载点、PTY 生命周期、跨插件事件、IPC 边界。

插件不能直接依赖其它插件实现；通过 `PluginContext` 的 profile 注册、UI contribution 和 `EventBus` 协作。

## 3. 会话模型

```
Session = CLI profile + PTY + cwd + CLI native session id
```

一个会话固定一个 CLI，不能中途切换。恢复会话由 CLI 插件声明 `resumeArgs`，适配各 CLI 自身的会话存储和恢复机制。

Composer 的只读状态通过 CLI profile 的 `readSessionStatus` 适配器读取各 CLI 自己的 session JSONL。内核只编排状态刷新，不理解 OMP、Pi、Codex 的文件格式；状态缺失时显示 `—`，不猜测默认值。

## 4. Composer 输入模型

Composer 只负责富输入体验和发送编排，不实现 CLI 命令语义：

- `$`：skill；由 CLI profile 声明，不支持则不激活
- `/`：common command；由 CLI 自己解析
- `@`：文件/文件夹引用；候选来自 files 插件
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
- `contribute(point, contribution)`：向 header/footer/sidebar/composer 子挂点扩展
- `events`：跨插件唯一通信通道

新增能力的标准路径分两类：

- UI/CLI 能力：新增 `src/plugins/<id>/` → 实现 `Plugin` → 加入 `src/plugins/index.ts`。
- 跨插件基础契约：先在 `src/kernel/` 增加稳定类型/原语，再由插件实现；内核不得理解 CLI 私有格式。
- 插件可插拔：`PluginMeta.category` 三档 engine/feature/core（core 焊死不可拔）；插件市场数据源与激活编排见 `kernel/pluginLifecycle.ts`，拔插写 `settings.disabledPlugins`，重启生效。

## 7. Quota(额度查询)架构

额度是 composer 工具栏的只读指示,内核不理解任何供应商协议。

```
QuotaChip (composer 插件)
  └─ kernel/quota.ts        QuotaProvider 注册点 + QuotaSnapshot 统一结构
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
| `vendors/` | 6 类供应商协议:kimi / minimax-cn·en / zhipu-cn·en / deepseek / relay + codex wham(降级) | CLI 凭据格式 |
| `codexLocal.ts` | codex 官方 OAuth 本地 rollout 快照解析(优先路径) | HTTP(零请求) |
| `quota.rs` | 通用 HTTP 代理 + `quota_env_value` 只读环境变量 | 业务语义 |
| `omp_auth.rs` | omp agent.db(auth_credentials)只读代读:JS 无法解析 sqlite,CLI 私有存储知识集中于此例外模块 | HTTP/其它 CLI |

**关键设计决策**:

- **Codex 额度分级策略(官方登录零 HTTP,自定义 key 走 HTTP)**:直连 wham 有封号风险,故 `auth.json` 为 ChatGPT OAuth(`tokens.access_token + account_id`)时,优先读 CLI 本地 rollout 快照(`~/.codex/sessions/**/rollout-*.jsonl` 的 `token_count.rate_limits`,即 codex TUI 底部 5h/7d 的同一数据路径,实现在 `cli-shared/quota/codexLocal.ts`);快照不可用降级 wham HTTP。自定义 key 模式(`OPENAI_API_KEY` + `config.toml` 的 `[model_providers.<x>].base_url`,实证为 minimax 中转)按 base_url 检测供应商走 HTTP。cli-pi 的 openai-codex 路由同策略:OAuth 凭据 → 本地快照降级 HTTP,非 OAuth → 直接 HTTP。
- **Pi 是"多供应商 CLI",路由不猜**:model 前缀(`zai-coding-cn/glm-5.2`,provider 来自 session jsonl `model_change.provider`)→ 裸 modelId 经 models-store/models.json 反查(凭据存在性消歧,多候选报错)→ 无 model 时仅单供应商配置可安全回退。
- **Pi 凭据三源**:`auth.json[provider]` → auth 语义 vendor 匹配(模型前缀 `kimi-code` ≠ auth key `kimi-coding`)→ `models.json` 的 `apiKey`(中转站实证,auth.json 无条目)。配置目录支持 `PI_CODING_AGENT_DIR` 覆盖。
- **凭据引用**:`$ENV_VAR` 经 Rust `quota_env_value` 只读解析;`!command` 显式拒绝(不执行 shell)。
- **Claude 额度分级(与 codex 同策略)**:凭据源为 `~/.claude/settings.json` 的 `env.ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY`(实证 kimi 中转);有 base_url 则按 vendors 检测走 HTTP。官方 OAuth(`~/.claude/.credentials.json` 的 `claudeAiOauth.accessToken`)无公开套餐额度 HTTP 面,显式报不支持并指引 `claude /usage`,不猜接口。
- **relay(未知中转站)**:Sub2API `{origin}/v1/usage` 探测,失败回退 New API `/api/user/self`。
- **解析/IO 分离**:`parseCodexRolloutTail` / `parseZhipuLimit` / `resolvePiRoute` 为纯函数,契约由 vitest 单测守护(`pnpm test`)。

## 8. 当前实现状态

已完成：配置脚手架、插件宿主与插件市场（17 个注册插件）、八 CLI profile(omp/pi/kimi/codex/claude/grok/qoder/qoder-cn)、PTY 全生命周期与会话输出落盘翻页、输出缓冲分块化(streamSlice)、xterm 幕布、五区外壳、Composer 触发符/拖拽/截图/命令抽屉/消息锚点栏/Quota chip、bracketed-paste 发送器(pi-tui 系)、只读 session 状态工具栏、Quota 额度查询(7 类供应商 + relay 探测 + 契约单测)、welcome 首页(引擎探针/一键安装/凭据盘点/近期会话)、右栏 Git 面板全量(差异/分支/历史/远端 fetch-pull-push)、文件树 + 中央文件编辑器(CodeMirror) + Markdown 预览(mermaid/KaTeX/图片/大纲)、审批线(checkpoints 账本:双归因/整批与按文件回退/影子对象库)、主题引擎(21 个 VS Code preset)、网络代理、会话置顶(双作用域)/重命名/显示预算、Ask 等待确认检测与提示音、轮次结束提示音。

后续按优先级：命令抽屉真机验收(openspec composer-command-drawer)→ CLI 交互式兼容性验证；Git Graph 提案待开。
