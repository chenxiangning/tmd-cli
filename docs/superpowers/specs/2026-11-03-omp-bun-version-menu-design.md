# OMP 引擎卡集成 Bun 版本管理

日期:2026-11-03
状态:已落地(用户选定方案 1;全量门禁绿,react-doctor 100)

## 背景与目标

OMP 引擎卡已有主程序版本菜单,Bun 也有探针、最低版本判断和过旧「一键修复」。但 Bun 达标后依赖引导区整体卸载,当前版本与手动升级入口随之消失;Bun 版本管理无法像 OMP 一样查看稳定版、收藏或钉版安装。

目标:

1. OMP「版本」菜单分为 OMP 与 Bun 两个分区,Bun 达标后仍常驻显示当前版本和最低要求;
2. Bun 复用现有版本列表、收藏、钉版安装、流式日志与失败重试能力,升级只由用户点击触发;
3. 保留 Bun 低于 1.4.4 时的「一键修复 → 接续 OMP 更新」链,普通 Bun 版本切换不得连带更新 OMP;
4. 依赖版本管理使用通用声明,不在 kernel 或 welcome 写死 Bun 安装配方。

## 方案取舍

**选定:OMP 版本菜单内增加依赖分区。** 主程序与 Bun 各自保留当前版本、收藏和最新 10 个稳定版;Bun 分区标题同时显示最低要求。版本菜单拆出数据分区组件,两套数据独立懒拉、独立重试,任一安装进行中时两套版本行统一禁用,避免并行修改运行时与主程序。

**版本来源:npm registry 的 `bun` 包。** 实测其 `dist-tags.latest` 为 1.4.4,稳定版键集包含 1.4.0 至 1.4.4 等历史版本,可复用 `fetchVersionList`,无需新增 GitHub Releases 解析通道。

**钉版通道:依赖自声明官方脚本模板。** `CliPrerequisite` 增加 `versionMenu` 与 `scriptVersionInstall`;后者使用 `{version}` 占位,OMP 插件声明 Bun 官方 Unix `bash -s "bun-v{version}"` 与 Windows `-Version {version}` 形式。welcome 只做占位替换并复用 script 安装计划,不持有 Bun 私有命令知识。

**否决:OMP 行下新增常驻 Bun 状态行。** 只能解决版本可见,无法承载完整版本管理,且增加引擎列表密度。

**否决:独立 Bun 动作按钮。** 能力与集成分区相同,但 OMP 行动作簇更拥挤,主程序与运行时版本管理也被拆成两个入口。

## 设计

### 契约与钉版计划

- `CliPrerequisite` 保留现有 `npmPackage`,新增可选 `versionMenu?: boolean` 和 `scriptVersionInstall?: { unix: string; windows: string }`;只有显式开启、声明 npm 包、script 通道与双平台钉版模板齐全时才显示依赖分区。
- `PrerequisiteMeta` 透传上述通用字段;新增依赖钉版计划函数,校验双平台模板均含 `{version}` 后生成 script `CliInstallPlan`,缺项或形状不符返回 null。
- cli-omp 声明 `npmPackage: "bun"`、`versionMenu: true` 和官方钉版脚本;现有 `minVersion: "1.4.4"`、普通安装脚本与文档链接不变。

### 菜单组件与状态

- 将纯渲染的 `VersionMenuBody` 与懒拉数据的版本分区拆成独立组件,控制所有文件不超过 300 行;原菜单的 portal、背板、Escape、视口夹取和收藏持久化不变。
- 有依赖分区时,菜单先显示 OMP 分区,再显示 Bun 分区;Bun 标题显示「最低 {version}」,其当前版本取现有 `depProbe`,收藏键使用依赖 binary(如 `bun@1.4.4`),与 OMP 收藏隔离。
- 主程序或依赖任一安装运行时,「版本」按钮及菜单内所有版本行禁用;两个列表互不影响加载与失败重试。
- 菜单保持最大高度与纵向滚动,双分区在小窗口中不超出视口。

### 安装链与日志

- 点 Bun 版本行后关闭菜单,清除修复链标,以钉版 script 计划调用现有 `startDepInstall(overridePlan)`;成功后只重探 Bun。
- 原「一键修复」仍在 Bun 过旧时显示,只有它设置 `fixChainRef`,成功后接续 OMP 更新;全新安装 Bun 仍不自动安装 OMP。
- 依赖引导区隐藏时,EngineCard 直接渲染已有依赖 `InstallLog`;引导区可见时仍由原组件渲染,避免重复日志。

## 改动面与验证

改动:kernel 前置依赖契约、cli-omp 声明、welcome 的 engineMeta / VersionMenu 拆件 / EngineSection / EngineCard、英文与日文词典及对应测试;不新增 Rust command,不修改安装传输层。

验证:

1. 单测覆盖 script 钉版模板替换、缺模板/缺占位返回 null,以及 OMP 原 command 钉版回归;
2. 渲染契约覆盖双分区、Bun 当前版本与最低要求、独立收藏、安装中禁用,以及 Bun 达标后依赖日志仍可见;
3. `pnpm check:gate` 全链、`npx react-doctor@latest -y` 100 分;
4. `pnpm tauri:dev` 真实窗口目检 OMP/Bun 双分区、列表滚动、收藏与手动钉版入口;不替用户执行实际 Bun 升级。
