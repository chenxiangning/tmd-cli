# codemoss(ccgui-next)插件系统 vs tmd-cli 插件架构对比评审

- 日期:2026-09-10
- 状态:已完成(对比报告;事实两侧均经实读核实)

## 结论先行

两边插件架构**服务不同目标,各自在自己目标上做得更好**:

- **codemoss 做的是「面向陌生第三方代码的插件沙箱」**:manifest 权限声明、Disposer 生命周期栈、blob URL 物理隔离、Rust 侧 846 行权限纵深、契约漂移类型守卫、崩溃隔离熔断——安全与契约机制的完整度高于 tmd-cli。
- **tmd-cli 做的是「第一方功能拆分的组织手段」**:CI 机器把关的分层边界(R1/R3/R4)+ 300 行铁则、25 个实战在树插件、cli-shared 知识边界缝隙层——宿主内部架构纪律与插件化的真实深度高于 codemoss(其树内真插件为零,系统未经实战检验)。

若论「谁的插件系统机制设计更完备」:codemoss。若论「谁的宿主架构更健康、插件化更真」:tmd-cli。

## 双方定位差异(评价前提)

| | tmd-cli | codemoss(ccgui-next) |
|---|---|---|
| 宿主定位 | 多 CLI 宿主(10 引擎),一切能力皆插件 | 单 CLI(CC)的 GUI + 开放第三方插件生态 |
| 插件来源 | 全部树内第一方(25 个),编译期静态注册 | 全部外部独立 GitHub 仓,运行期安装,树内零插件 |
| 信任模型 | 插件=自己人,无需沙箱 | 插件=陌生代码,默认不信任 |
| 插件系统体量 | kernel 136 文件 + plugins 324 文件,约 6 万行 | 约 4.5k 行(features/plugins 1.6k + SDK 865 + Rust 2.1k) |

## 六维对照

### 1. 契约设计 —— codemoss 更完备

- codemoss:`packages/plugin-sdk/plugin.d.ts`(VS Code 式公共契约,带版本戳 v0.3.1)。`PluginManifest` 声明 id/version/tier/permissions/contributes/configSchema/sdkVersion 兼容区间;每个 `register*` 显式标注所需权限(如「权限 ui:panel-tab」)并返回 `Disposer`,未回收由宿主 disposer 栈兜底(`loader.ts` 逆序执行,throw 不中断栈)。
- tmd-cli:`src/kernel/plugin.ts` 的 `Plugin` 极简(id/meta/dependsOn/activate/deactivate),贡献经 `PluginContext` 11 个注册方法 + events 总线。无 manifest、无权限声明、无 Disposer 粒度回收——树内第一方场景下这些不是必需,但 deactivate 的可选粗粒度回收确实是较弱一环。

### 2. 注册/发现机制 —— 路线不同,各有利弊

- codemoss:运行期动态安装。Rust 侧 `plugins/mod.rs` 管理 `~/.ccgui-next/plugins/<id>/`(staging/backup rename 事务安装),JS 侧 `loader.ts` 把字节铸 blob URL 动态 import。物理隔离是结构必然:插件 bundle 无法解析宿主 `@/` 别名,天然无法 import 宿主内部。代价:运行时加载链路(blob/import/事务)复杂且树内零插件,该链路没被实战压过。
- tmd-cli:编译期静态数组(`src/plugins/index.ts` 的 `allPlugins`,新增=加一行)。零运行时加载风险,类型全链路静态检查;代价是不支持第三方热插拔——已由 2026-09-10 本地插件设计(Blob 装载 + SHA-256 信任闸)补上本地动态面,路线与 codemoss 同源。

### 3. 边界强制 —— 方向相反,各守一段

- tmd-cli 守「宿主内部卫生」且是**机器把关**:`scripts/check-arch-boundary.mjs`(R1 kernel↛plugins / R3 @tauri-apps 唯一通道 kernel/ipc.ts / R4 plugins↛app-shell)+ `scripts/check-file-size.mjs`(≤300 行),均在 `.github/workflows/ci.yml` 强制,违规即 CI 红。
- codemoss 守「插件运行时隔离」:`hardening.ts` 用 `runAsPlugin` 深度计数拦截插件栈上直调 Tauri IPC(throw);`bridge.invoke` 仅四条命令(network:/exec: 授权,授权全集单一事实源 `spec/permissions.json`,TS/Rust/模板三方消费);Rust `plugin_caps.rs` 846 行纵深防御 + 文件白名单。**但宿主自身零守卫**:features 平铺互 import 无约束、无 lint、CI 只 build 不跑测试。

### 4. 知识边界/隔离层 —— tmd-cli 独有

- tmd-cli 有显式铁律「内核不理解 CLI 私有格式」+ `cli-shared/` 缝隙层(准入标准:≥2 个 cli-* 插件消费同一格式知识;实测 35 处 import 跨 8+ 插件)。这是多 CLI 宿主的真实痛点解。
- codemoss 无此问题(单 CLI + 插件外部化,私有知识天然在插件侧)。其 `contract-check.ts`(类型层 Mutual 双向可赋值 + KeyParity)是精致的契约漂移守卫,但 tmd-cli 插件直接 import @kernel 类型,编译期天然一致,不需要这道工序。

### 5. 插件化真实深度 —— tmd-cli 碾压

- tmd-cli 25 个真插件:10 个 CLI 引擎 + composer/files/git/settings/terminal/welcome/checkpoints 等,连设置页、欢迎页都是插件。「一切能力皆插件」是落地事实,新增 CLI 引擎的理论改动面 = 插件目录 + allPlugins 一行,Rust/内核零改动。
- codemoss 树内真插件为零(`builtin/index.ts` 空数组,首个插件 usage-stats 尚未发布);仅两处 dogfood(命令面板走 commandRegistry、插件管理页走 settingsRegistry)。贡献点系统(9 个 registry + useRegistry + 双段挂载)设计完整但未被真实插件验证。

### 6. 测试与 CI 护栏 —— tmd-cli 更严

- tmd-cli:171 个测试文件(kernel 65 + plugins 106),CI 跑 300 行铁则 + 架构边界 + typecheck + test + build 全链。
- codemoss:21 个测试文件,插件系统自身覆盖不错(loader/registry/context/hardening/sdk-grants/sdk-version/interpreter 等),但 CI(release.yml)只做 install + tauri build,不跑测试、无 lint。

## 各自优缺点汇总

### codemoss 优点
1. 权限模型完整:manifest 声明 + JS 侧预 reject + Rust 侧强制,纵深三层。
2. 生命周期干净:Disposer 栈逆序回收,卸载路径经过设计。
3. 契约防漂移:plugin.d.ts 公共镜像 + 类型层 contract-check,SDK/宿主任一侧改形即编译错。
4. 崩溃隔离:PluginBoundary 熔断(阈值 3 次 quarantine)。
5. 宿主 dogfood 意识好:自家管理页走同一 registry 面。

### codemoss 缺点
1. 树内零真插件:整条动态加载/沙箱链路未经实战,设计正确性只有测试背书。
2. 宿主内部零纪律:无 lint、无边界守卫、CI 不跑测试,features 平铺互 import 迟早腐化。
3. hardening 的 IPC 拦截有明示残余绕过面(React 事件回调/异步续体/localStorage),靠市场审核兜底——审核流未建时是敞口。
4. 插件系统单 commit 一次落地(c7bcab377),无渐进验证。

### tmd-cli 优点
1. 分层边界 CI 强制(R1/R3/R4 + 300 行),不依赖自觉。
2. 25 个实战插件,插件化深度与注册面成熟度经受了真实迭代。
3. cli-shared 知识边界层:多 CLI 私有格式共享有明确准入标准,不进 kernel。
4. 测试密度与 CI 门槛全面。

### tmd-cli 缺点
1. 无权限/能力声明模型:插件=全信任,local-loader 引入动态加载后,动态面缺 codemoss 式 manifest 权限与 bridge 白名单(目前靠 SHA-256 信任闸一道)。
2. 生命周期回收粗:deactivate 可选、无 Disposer 栈,禁用/重载路径的回收保证弱于 codemoss。
3. 无契约漂移守卫:本地插件若与 kernel 类型脱节,只有运行时暴露(codemoss 的 contract-check 思路可借鉴)。

## 互鉴清单

### tmd-cli 可向 codemoss 借鉴
1. **本地插件权限声明**:local-loader 动态面引入 manifest permissions + bridge 白名单(收窄到少数宿主命令),与现有 SHA-256 信任闸互补——信任闸管「装不装」,权限管「装后能碰什么」。
2. **Disposer 栈**:PluginContext 各 register* 改返 Disposer,activate 期统一入栈,deactivate 逆序回收,替换现有手工清理。
3. **崩溃熔断**:挂点组件渲染崩溃计数 + quarantine,防一个本地插件拖死整个壳。

### codemoss 可向 tmd-cli 借鉴
1. CI 跑测试 + 加 lint:release.yml 目前只 build。
2. features 间 import 边界守卫:插件系统契约再干净,宿主内部互爬会拖累演进。
3. 内置功能插件化(dogfood 到底):把 files/git/terminal 之一迁为真插件,压一遍动态加载链路再对外开放市场。

## 证据附录

- tmd-cli:`src/kernel/plugin.ts`(Plugin/PluginContext/16 个 MountPoint)、`src/plugins/index.ts`(allPlugins 25 项)、`scripts/check-arch-boundary.mjs`、`scripts/check-file-size.mjs`、`.github/workflows/ci.yml:24-31`、`src/plugins/cli-shared/`(35 处跨插件 import 实证)。
- codemoss:`packages/plugin-sdk/plugin.d.ts:69-190`(PluginContext 全文,逐条权限标注)、`packages/plugin-sdk/src/contract-check.ts`、`src/features/plugins/runtime/hardening.ts`、`src/features/plugins/runtime/loader.ts`、`src/features/plugins/builtin/index.ts`(空数组)、`src-tauri/src/plugin_caps.rs`(846 行)、`src-tauri/src/plugins/mod.rs`、commit c7bcab377(插件系统单 commit 落地)。
