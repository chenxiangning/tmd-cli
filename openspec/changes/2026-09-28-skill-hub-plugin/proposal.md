# Skill Hub 插件:跨引擎 skill 目录管理 + ClawHub 市场

> 日期:2026-09-28 · 状态:已实现(真机 tauri:dev 复验留大仙;执行注记:Rust 侧实际 3 命令 —— 多出的 skill_symlink 服务 §4.6 claude 补链选项;skill_extract 对 ClawHub 实测平铺包不剥顶层(仅 GitHub 式单顶层包剥);grok 管理面走 §4.3 目录表直扫自家目录,composer 建议源维持 inspect 通道不变)
> 上游:`docs/research/skill-mcp-integration-architecture.md`(委托 CLI + 方言写代理,方案已定);2026-09-28 对一个三方开源客户端(MIT)skill 模块的本地调研(参考源码路径由派发指令提供,仅供执行者核对行为细节)。
> 并行约束:与 `2026-09-28-mcp-hub-plugin` 并行执行,冲突面协调见 §6,两提案该节内容一致。

## 实现纪律(最高优先)

三方开源客户端(MIT)只提供**交互形态与市场契约**参考。**实现一律按本提案记录的公开 API 契约与行为语义自研重写,禁止逐字移植其代码;仓内代码、注释、文档不得出现该项目名或其仓库名**。外部服务(ClawHub 等)是公开第三方服务,名称照常使用,无争议。存储模式遵循上游调研结论:**tmd 不做 skill 真相源,直接管理各家 CLI 自己的 skill 目录**。

## 1. 背景与目标

Agent Skills(`SKILL.md` + YAML frontmatter,agentskills.io)已是跨 CLI 事实标准(上游调研十家矩阵:claude/codex/gemini/opencode/pi/omp/kimi/grok/qoder/dsh 全部原生或兼容读取)。tmd-cli 的只读发现链已有骨架(`cli-shared/skillDirs.ts` 的 `scanSkillDirs` 双形态扫描,claude/codex/kimi/qoder 已接;grok 走 `grok inspect --json`;composer 抽屉技能分区已落地),缺的是一个统一管理面:跨引擎浏览、预览、删除、从 ClawHub 市场下载安装(落目标引擎目录或 `~/.agents/skills` 公约位一份多家用)。

目标 = 新插件 `skill-hub`:右栏工具栏入口,点开在中央 tab 区管理。kernel 零改动;Rust 侧仅新增下载/解压两个原子命令。

## 2. 范围边界

| 面 | 做 | 不做(去向) |
|---|---|---|
| P1 扫描管理 | 十家 skill 目录扫描(复用 `cli-shared/skillDirs.ts` 既有形态 + 补齐未接家)、按引擎分组卡片、来源徽标(用户级/项目级/公约位)、SKILL.md 预览抽屉、删除(回收站)、搜索 | 启用/禁用开关(各家原生机制方言不一:codex `[[skills.config]]`、omp frontmatter `hide`、gemini `/skills disable`;首版不做代理,后置);skill 内文件编辑(files 插件已有);批量模式(交互糖,后置) |
| P2 市场 | ClawHub 浏览/搜索/排序、安装弹窗(落位选项:目标引擎多选 / `~/.agents/skills` 公约位 / claude symlink 勾选)、安装阶段态 | GitHub/git URL 与本地目录/zip 手选安装(上游调研安装源三件套的另两件,后置);skill 创建/打包/校验(无 agent 参与者,价值低) |
| 存储 | 直接管理各家 skill 目录(fs 原子命令) | 自有 skill root 与导出链(上游调研否决:双真相源必然漂移) |

## 3. 方案取舍

| 决策 | 选定 | 否决与理由 |
|---|---|---|
| 插件形状 | 独立 `skill-hub` 插件,右栏 `registerFilePanel` + 中央 `registerTabContent`(先例:memory-coordinator 双贡献、git 右栏到中央 tab) | 并入 cli-config(领域不同);拆进各 cli-*(十份重复 UI);settings section(用户指定中央 tab 管理面,信息密度更高) |
| 存储模式 | 直接写各家 skill 目录(上游调研选定:委托 CLI,真相源唯一) | 自持式 root + 导出(双真相源漂移,上游调研否决 A) |
| 发现层 | **复用 `cli-shared/skillDirs.ts` 既有 `scanSkillDirs` + 各家 scanSuggestions 接线**,仅补齐未接家(opencode/dsh/pi 按上游矩阵);grok 继续走 inspect 通道 | 插件内自建目录表(重复声明漂移;既有层已准入) |
| 扫描深度 | 每目录仅一层子目录(既有 scanSkillDirs 形态) | 任意深度 + 祖先短路(实测各家均为一层;YAGNI) |
| 安装落位 | 弹窗三选:目标引擎多选(默认 claude)/ `~/.agents/skills` 公约位一份多家用(omp/pi/kimi/grok/dsh/codex 原生吃)/ claude 用户额外勾选建 symlink(Claude 官方支持 skill 目录 symlink) | 只做逐引擎复制(公约位一份多用是十家矩阵验证的核心价值,砍掉等于重装十遍) |
| 安装冲突 | 用户裁决:覆盖(trash 旧目录)或跳过 | 自动备份改名(留 backup 垃圾;回收站已是安全网) |
| 安装执行 | 前端 async 串行 + 阶段态 | Rust 后台 job 线程 + 轮询(skill 包 ≤10MB 秒级;YAGNI) |
| 解压 | Rust `zip` crate(纯 Rust,最小 feature 集) | 系统 unzip(Windows 缺位);前端解压库(体积) |
| 代码来源 | 按公开契约自研重写 | 逐字移植参考实现(用户要求仓内零该项目名,自研零争议) |

## 4. 设计

### 4.1 插件形状与入口

- `src/plugins/skill-hub/`,`src/plugins/index.ts` 的 `allPlugins` 注册一行。
- `ctx.registerFilePanel({ id: "skill-hub", label: "Skills", icon, component: SkillHubPanel, showFileSubbar: false })`:右栏轻量概览(每引擎一行:名称 + 已装数;底部「打开管理」按钮)。
- `ctx.registerTabContent({ kind: "skill-hub", component: SkillHubTab })`;面板按钮 → `openTab({ id: "skill-hub", kind: "skill-hub", title: "Skills" })`(幂等,单例 tab)。
- 图标执行时选,不与现有右栏面板图标及 composer 唤醒图标(Sparkle/HardDrive)撞形。

### 4.2 文件清单(全部 ≤300 行,超限即拆)

```
src/plugins/skill-hub/
  index.tsx              插件入口:注册面
  hubTab.ts              openSkillHubTab 契约(openTab 封装 + payload 读取)
  SkillHubPanel.tsx      右栏概览面板
  SkillHubTab.tsx        中央 tab 壳:已装/商店视图切换 + 顶栏
  skillScan.ts           扫描编排:调 cli-shared/skillDirs.ts 既有形态,聚合十家来源(含 grok inspect 通道),补齐未接家
  skillStore.ts          发现结果缓存与订阅(模块级 store,createSubscribable)
  InstalledView.tsx      已装视图:按引擎分组 + 来源徽标 + 搜索 + 删除
  SkillCard.tsx          卡片:name/description/引擎徽标/操作
  SkillPreviewDrawer.tsx 预览抽屉:元数据文件懒读(上限)
  clawhub.ts             ClawHub client(quotaFetch)
  clawhubNormalize.ts    卡片归一化 + owner 消歧
  StoreView.tsx          商店视图:分类/排序/搜索防抖/cursor 分页
  StoreCard.tsx          商店卡片
  InstallDialog.tsx      安装弹窗:落位选项(引擎多选/公约位/symlink 勾选)+ 冲突裁决 + 阶段态
  install.ts             安装编排(netDownload → skillExtract → 落位)
  locales/en.ts, locales/ja.ts
```

frontmatter 解析复用 `cli-shared/skillDirs.ts` 既有解析(已服务四家);本插件不重复实现。

### 4.3 发现契约(上游调研 §3.1 十家矩阵)

- 目录表(home 取 `ipc.configHomeDir()`,目录不存在 = 该引擎区隐藏,不猜测;以 `cli-shared/skillDirs.ts` 既有声明为基,补齐未接家):

| 引擎 | 用户级位置 | 读 `~/.agents/skills` |
|---|---|---|
| claude | `~/.claude/skills` | 否(只认自家目录;安装弹窗提供 symlink 选项补此缺口) |
| codex | `~/.agents/skills`(官方即此位) | 原生即此 |
| omp | `~/.omp/agent/skills`(多 provider 合并) | 是 |
| pi | `~/.pi/agent/skills` | 是 |
| kimi | `~/.kimi-code/skills`(另有平铺 `.md` 形,既有 scanSkillDirs 已处理) | 是 |
| grok | `~/.grok/skills` | 是 |
| qoder | `~/.qoder/skills` | 是(本机实证) |
| opencode | `~/.config/opencode/skills` | 是 |
| dsh | `~/.dsh/skills` | 是 |
| (公约位) | `~/.agents/skills` 单列一组,徽标「共享」 | — |

- 项目级目录(`.claude/skills`、`.agents/skills` 等)首版不扫(会话工作区相关,后置进工作区维度);gemini 无插件不做。
- 一个 skill = 目录下的一层子目录,含元数据文件;优先级 `skill.json` > `SKILL.md`/`skill.md`(大小写不敏感)> `README.md`(兜底:目录名展示)。元数据读取走文件头(前 64 行);name ≤64 字符、description 超 1024 截断——沿用既有解析行为,出入以 `cli-shared/skillDirs.ts` 现状为准。
- 预览全文整文件读,200KB 上限,超出截断标记。

### 4.4 ClawHub API 契约(公开 REST,base `https://clawhub.ai`)

| 端点 | 参数 | 返回 |
|---|---|---|
| `GET /api/v1/skills` | `limit`(默认 24)、`sort` ∈ downloads/stars/installs/updated/newest、`nonSuspiciousOnly=true`、`cursor` | `{items:[Card], nextCursor?}` |
| `GET /api/v1/search` | `q`、`limit`、`nonSuspiciousOnly=true` | `{results:[Card]}` |
| `GET /api/v1/skills/{slug}` | `ownerHandle?`(重名 slug 缺 owner = 409) | Detail |
| `GET /api/v1/download` | `slug`、`tag=latest`(或具体版本)、`ownerHandle?` | zip 包 |

- Card 字段:slug, displayName, summary, topics[], latestVersion, downloads, stars, installsCurrent, updatedAt, ownerHandle?, webUrl, downloadUrl。归一化:缺失值收敛为空串/0;topics 展示前 3。
- 消歧:卡片缺 ownerHandle 时,以 slug 精确搜索(limit 50)取候选,按 updatedAt → latestVersion → downloads 逐级收敛至唯一;仍歧义 = 安装报错并列出候选,不盲选。
- 元数据请求走 `ipc.quotaFetch({ url, headers: { Accept: "application/json" } })`;4xx/5xx 原样报错显示(不重试)。
- 下载不走 quotaFetch(body 通道是 JSON 文本,装不下 zip 二进制)→ 走 `netDownload`。

### 4.5 Rust 新原语(本提案唯一 Rust 改动)

新模块 `src-tauri/src/skill_pkg.rs`:

- `net_download(url: String, dest_dir: String) -> { path, bytes }`:下载到 dest_dir 下临时文件(名 = url 哈希 + `.tmp`),60s 超时,跟随重定向,失败返回错误串。
- `skill_extract(archive: String, dest_dir: String, strip_top: bool) -> { entries: number }`:zip 解压。**安全闸:entry 名含 `..` 或绝对路径 = 拒绝(zip-slip);symlink entry = 拒绝(公约位兼容性靠用户显式勾选 symlink,不由包内携带);解压总大小 >10MB = 拒绝**;strip_top = 单顶层目录剥离(ClawHub 包形状)。

接线:`src-tauri/Cargo.toml` 加 `zip`(default-features = false,仅开 deflate 所需最小 feature);`lib.rs` generate_handler +2 行;`src/kernel/ipc.ts` +2 方法(`netDownload`/`skillExtract`)。

### 4.6 安装链路

1. InstallDialog 落位三选:目标引擎多选(默认勾选 claude)/ `~/.agents/skills` 公约位(一份多家用,注明可覆盖引擎清单)/ claude 用户勾选「同步建 symlink 进 `~/.claude/skills`」(Claude 官方支持)。
2. 逐落位目标检测同名冲突,冲突列出由用户选覆盖/跳过。
3. `netDownload(downloadUrl, ~/.tmd-cli/cache/skills/)` → `skillExtract` 到各目标(strip_top=true);symlink 选项用 fs 原子命令建链接,失败不阻断(降级为提示)。
4. 阶段态:下载中 → 解压中 → 完成/失败(逐目标);失败时已落位目标保留不回滚,结果如实列出;缓存文件安装后即删。
5. 完成后失效发现缓存刷新列表,商店卡片显示「已装」徽标;提示语不带生效承诺(各家热重载差异,上游调研 §7:下次会话或 `/reload-skills` 生效)。

### 4.7 删除

卡片删除 → 确认弹窗 → `ipc` trash 原子命令(目标 skill 目录下同名子目录)——回收站安全网;公约位删除时提示影响面(多家共用)。symlink 目标按链接本身删。

### 4.8 i18n

`locales/en.ts` + `locales/ja.ts`,键前缀 `skillHub.*`;文案与现有插件风格一致。

## 5. 验证

- 单测:skillScan 聚合(多引擎/缺目录/公约位/来源徽标)、clawhubNormalize(归一化/消歧收敛/歧义报错)、install 冲突矩阵与落位选项(fs 桩)。
- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;Rust 改动加 `cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`;`npx react-doctor@latest -y` 达 100。
- 桩目检(复用 1421 常驻 dev):右栏图标与面板、打开中央 tab、两视图切换、分组与来源徽标、搜索、预览抽屉、删除确认、商店列表/搜索防抖/安装弹窗三选落位;桩配 `fs_walk_files` 假 skill 清单 + `quota_fetch` 假 Card。
- 真机 `pnpm tauri:dev`:真实 ClawHub 浏览 + 下载安装一发(公约位安装后 `~/.agents/skills/<name>` 落位、omp 会话 `/skill:<name>` 可唤起取证),留大仙复验。
- 网络不可达:商店页错误态 + 重试按钮,不白屏。

## 6. 并行执行协调契约(与 mcp-hub 插件,两提案本节一致)

| 冲突文件 | 纪律 |
|---|---|
| `src/plugins/index.ts` | 各自 +1 import +1 数组项;skill-hub 项插数组现有尾之后,mcp-hub 项插 skill-hub 之后(对方行尚不存在则尾插;发现对方已改,重读再插,勿动对方行) |
| `src/kernel/ipc.ts` | skill-hub 方法插 fs 族封装之后;mcp-hub 方法插 quota/sqlite 区段之后(不同区域,锚点独立;锚点漂移 = 重读再改) |
| `src-tauri/src/lib.rs` | generate_handler 各自追加;skill-hub 2 行在前、mcp-hub 1 行紧后(同 index.ts 纪律) |
| `src-tauri/Cargo.toml` | 仅 skill-hub 改(+zip);mcp-hub 零改动 |
| `cli-shared/` | skill-hub 若需扩 `skillDirs.ts` 只做加法注释声明先例;mcp-hub 新增 `mcpWrite.ts`;互不相交 |
| `docs/README.md` | 各登记自己的索引行,行序无要求 |
| 其余 | 各自新增文件互不相交;禁 import 对方插件目录;事件前缀 `skillhub:` / `mcphub:`;持久化 key 前缀隔离 |
| 提交 | git add 显式文件清单(共用工作区铁律);`type(scope): 中文一句话祈使句`,scope 用 skill-hub / mcp-hub |
