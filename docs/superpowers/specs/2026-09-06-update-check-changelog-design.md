# 版本号点击弹窗:更新记录展示 + 在线更新检查

状态:已落地(实现随本 spec 提交;含 atom 通道修订与 v0.1.1 升版)

## 背景与目标

侧栏底栏右下角常驻版本号 `v0.1.0`(壳自有渲染,`SidebarSettingsCluster`),目前纯展示。目标:

1. 点击版本号弹出浮层,展示每个版本的更新记录(数据源 = 仓库根 `CHANGELOG.md`);
2. 浮层内提供「检查更新」按钮:请求 GitHub 发布通道比对最新发布版本;
3. 发现新版本后提供「前往下载」按钮:跳系统浏览器到对应 release 页下载安装;
4. 新建仓库根 `CHANGELOG.md`(Keep a Changelog 格式,中文,版本与 Git tag / GitHub Releases 一一对应),并打包内嵌进应用(离线可看)。

线上事实(已实测):仓库已发布 v0.1.0(tag 由 `release.yml` 推 tag 自动建 Draft,人工 publish 后可查)。
落地当日追加修正:首版走 `api.github.com/releases/latest`,实测撞上**匿名 60 次/小时/IP 限流**(共享出口 IP 下 `remaining: 0`,403 被误报成「网络不可用」),改走不限额的 `github.com/.../releases.atom`(见下方修订)。

## 方案取舍

**选定:检查 + 跳转浏览器下载。**「检查更新」走 GitHub **releases.atom 订阅源**(`github.com/.../releases.atom`,经 kernel `ipc.quotaFetch` 的 Rust reqwest 代理,`text` 模式直返原文,复用 welcome 插件查 npm 的同一条出网通道,CSP 无需放行);发现新版后「前往下载」用既有 `openExternalUrl` 打开 release 页。理由:零签名依赖、当天可落地可验证;atom 由 github.com CDN 分发、无 API 匿名限额,draft 不含(prerelease 会含,当前无 rc 发版习惯)。atom 是 XML 而 `quota_fetch` 原本强解 JSON → 给 `QuotaRequest` 加通用 `text` 标志(内核通用原语,非 CLI 私有知识)。

**修订(已否决):GitHub Releases API `releases/latest`。** 语义最正(排除 prerelease),但匿名配额 60 次/小时按 IP 计,VPN/办公网共享出口随时打满;实测 403。留作将来配 token 时的升级通道。

**否决:tauri-plugin-updater 应用内静默更新。** 需要 ed25519 签名密钥对、GitHub 仓库 secret、`release.yml` 生成带签名的 `latest.json`、Rust 插件注册 + capabilities + CSP 改动;密钥由用户掌握,配好前无法验证,改动面与当前收益不匹配。将来若补齐签名基础设施,只需替换 `updateCheck.ts` 的安装执行段与新增 Rust 插件,UI 不动。

**否决:更新记录拉取 GitHub Releases 列表。** 列表接口分页且依赖网络;更新记录的本源是仓库内的 `CHANGELOG.md`,`?raw` 打包内嵌后离线可用、与 tag 同步演进,GitHub release body 当前是 CI 写的通用文案("Automated build"),不适合当更新记录。

## 设计

### 数据源与解析(`src/app-shell/updateCheck.ts`,纯逻辑可测)

- `RELEASES_PAGE_URL` = `https://github.com/chenxiangning/tmd-cli/releases`;
- `fetchLatestRelease()`:`quotaFetch` 请求 `releases/latest`,映射 `tag_name`(去 `v` 前缀)/`html_url`/`published_at`/`body`;非 200、缺字段、网络失败一律返回 `null`(调用方显示「检查失败」,不抛错,与 welcome `latestVersion.ts` 同纪律);
- `isNewerVersion(latest, current)`:严格 semver 三元组数值比较(容 `v` 前缀;`0.10.0 > 0.9.0`),任一不可解析返回 `false`(不误导);
- `parseChangelog(raw)`:解析 `## [x.y.z] - 日期` → `### 小节` → `- 条目` 的 Keep a Changelog 结构,按行扫描,纯函数;
- `CHANGELOG.md` 经 Vite `?raw` 导入打包(`import changelogRaw from "../../CHANGELOG.md?raw"`)。

### 浮层(`src/app-shell/VersionPopover.tsx`,壳自有)

- 入口:底栏版本号 `<span>` 改为 `<button>`,点击记录锚点(簇右缘、底栏上缘)并打开;
- 呈现:portal 挂 body + 全屏透明 backdrop(`ProxyPopover` 同款交互:backdrop 点击 / Escape / 右上角 X 关闭);`useLayoutEffect` 实测尺寸落位,默认锚点上方右对齐,视口夹取;
- 内容自上而下:标题行(tmd-cli + 当前版本)→ 状态区(空闲提示 / 检查中 / 已是最新 `--tmd-ok` / 发现新版本 `--tmd-accent` 高亮版本号与发布日期 / 检查失败 `--tmd-err`)→ 按钮行(「检查更新」始终可用,检查中禁用;「前往下载」= `openExternalUrl(release.htmlUrl ?? RELEASES_PAGE_URL)`)→ 分隔线 →「更新记录」分页翻页(每页一个版本,`‹ n/N ›` 切换,默认最新一版;发现新版本且记录中存在该版本时自动翻到对应页;每版本:版本号 + 日期 + 当前版本徽标,小节标题 + 条目);
- 检查为手动触发(点击按钮),不自动请求;检查状态与翻页跨开合保留,上次结果可复看。

### 不做的事(YAGNI)

- 不自动后台检查、不打扰式红点;
- 不做下载进度 / 静默安装(见否决项);
- 不解析 changelog 内嵌 markdown 内联语法(条目按纯文本渲染,内容自控)。

## 改动面

- 新增 `CHANGELOG.md`(根)、`src/app-shell/updateCheck.ts`、`src/app-shell/updateCheck.test.ts`、`src/app-shell/VersionPopover.tsx`;
- 修改 `src/app-shell/SidebarSettingsCluster.tsx`(版本号按钮化 + 挂浮层)、`src/styles/settings-cluster.css`(浮层样式,`vp-*` 前缀)、`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml`(版本号);
- Rust:`src-tauri/src/quota.rs` 的 `QuotaRequest` 加 `text` 标志(text 模式跳过 JSON 解析,body 以字符串返回);kernel `ipc.ts` 的 `QuotaFetchSpec` 同步加 `text?`;

## 验证

- 单测:`updateCheck.test.ts` 守 changelog 解析结构、semver 数值比较、atom 解析映射、检查结果分级(浏览器 dev / HTTP 状态 / 网络失败 / 格式异常)(vi.mock `@kernel/ipc`);
- 全套:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + Rust 侧 `cargo clippy/test/fmt`;
- 目检:dev 环境打开真实界面,点击版本号看浮层开关 / 更新记录渲染 / 翻页 / 检查按钮各态(浏览器 dev 下显示环境提示,桩 Tauri invoke 验证 outdated / latest);atom 真实形状已用 curl 实测(见背景)。
