# omp 版本回退:首页引擎卡版本菜单 + 收藏

日期:2026-09-15
状态:已评审通过(用户三问确认:动作簇加「版本」按钮 / 菜单顶部固定当前版本行 / 只列稳定版)

## 背景与目标

首页(welcome)引擎列表里 omp 只能「重装/更新到最新版」。omp 发版节奏快,新版出问题时用户想回退只能手动去终端跑 `bun install -g @oh-my-pi/pi-coding-agent@<旧版本>`,且要自己查有哪些版本。

目标:

1. omp 引擎卡动作簇加「版本」按钮,弹出菜单列出**最新 10 个稳定版**,点选即装(回退);
2. 菜单顶部固定「当前版本」行——当前安装版本掉出 top10(发版快,常见)也能看到、能收藏;
3. 支持**收藏版本**:每行星标切换,收藏段独立列于菜单上部,**不占 top10 名额**;
4. 收藏持久化,跨重启保留。

非目标:其他引擎的版本菜单(机制声明式,omp 先行,一行开启);npm 双副本场景的钉版(见方案取舍);预发布版本入列(只列稳定版)。

## 方案取舍

**选定:welcome 插件自闭环,command 通道钉版,零 Rust 改动。**

- 版本列表:`latestVersion.ts` 加 `fetchVersionList(npmPackage)`,走 kernel `quota_fetch` 通用代理拉 `https://registry.npmjs.org/<pkg>`(Accept: `application/vnd.npm.install-v1+json` 精简 metadata),`versions` 键滤 prerelease(含 `-`)→ semver 降序 → 前 10;模块级 5min TTL 缓存(与 `fetchLatestVersion` 同款),开菜单时懒拉。webview 直 fetch 撞 CSP,不新增 Rust command(npm 语义留插件侧,与 latestVersion 既有决策一致)。
- 钉版安装:omp 安装主通道本来就是 `command`(`bun install -g <pkg>`)。`pinPlanVersion(plan, npmPackage, version)` 把 args 中 === 包名的项替换为 `pkg@ver`,走现有 `useEngineInstall`/`cliInstallRun` 流式安装链路,日志落行内 InstallLog,装完自动重探。
- 开启契约:`CliProfile` 加可选 `versionMenu?: boolean`(引擎卡出「版本」菜单),cli-omp 声明 `true`。kernel 只承载通用声明,零 omp 语义。
- 收藏持久化:`AppSettings` 加 `engineVersionFavs: Record<engineId, Record<version, { favedAt: number }>>`,进 `MERGE_TS_FIELDS`(favedAt 冲突取新,双实例合并白拿);sanitize 校验 semver 形状 + 每引擎上限 20(防爆)。

**否决 B:Rust npm 通道加 version 字段。** `InstallPlan::Npm` 硬编码 `@latest`,npm 双副本场景(probe.npmPrefix 命中)钉版需要扩它。omp 官方通道是 bun,收益仅覆盖边缘场景,代价是动 Rust 契约与测试。将来主通道为 npm 的引擎要钉版时再扩。

**否决 C:收藏存 localStorage。** 丢双实例合并保护,违背持久化惯例(sessionTitles / sessionPins 均走 settings)。

## 组件与数据流

- `VersionMenu.tsx`(welcome 插件新增,wsmenu 范式:portal + `wsmenu-backdrop` + Escape + 视口夹取):
  - 当前行:固定显示当前安装版本(`extractSemver` 抠三元组),带星标;
  - 收藏段:收藏版本 semver 降序,星标取消;空则不渲染段;
  - 最新版本段:top10;与当前版本去重(命中行标「当前」徽标);每行星标;
  - 点版本行 → 关菜单 → 钉版 plan 启装;安装中/已是最新点击态由行内既有安装链路呈现;
  - 列表拉取中显「加载中…」,失败显「获取失败 · 重试」。
- `EngineCardParts.RowActions`:「重装」旁加「版本」小按钮,仅 probe 成功(已安装)且 meta.versionMenu 时出现;安装进行中禁用。
- `EngineCard`:菜单开合态 + onPick(version) → 构造钉版 InstallTarget 喂 `useEngineInstall`。

## 验证

- 单测:`pickStableVersions`(滤 prerelease / 降序 / top10)、`pinPlanVersion`(args 替换)、sanitize 白名单;
- 渲染契约(EngineCard.test.tsx):版本按钮出现条件(probe ok + versionMenu)、菜单三段、当前徽标;
- 全量:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;
- 收口:`npx react-doctor@latest -y` 100 分;
- 目检:`pnpm tauri:dev` 真实窗口过「开菜单 → 收藏 → 回退旧版 → 版本号变化 → 再收藏当前」全流程。
