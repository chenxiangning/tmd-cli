# 本地插件:用户磁盘插件目录 + 运行时动态加载

日期:2026-09-10
状态:已实现未提交(实现含两轮对抗评审修订;方案取舍锚定代码事实:CSP / config_dir 惯例 / PluginLifecycle 记忆化 / turnSettled 事件 / trash_entry 废纸篓 / 全仓零 ErrorBoundary)

## 背景与目标

现状(2026-09-10 盘点):24 个插件全部经 `src/plugins/index.ts` 的 `allPlugins` 数组**编译期静态注册**;`PluginContext` 注册面(10 条通道)与激活编排(dependsOn 拓扑、disabledPlugins 拔插)已成熟,但全仓无任何「从磁盘发现/加载外部插件」的机制。三个目标课题:

1. **本地化插件**:用户/第三方不开仓库源码,把插件包放到本机目录即可被客户端加载;
2. **对话造插件**:在会话里让 AI 生成一个插件,落盘后客户端正确加载、免重启生效;
3. **三来源区分与版本可回退(用户指定,2026-09-10)**:内置(开发者)插件、本地插件、市场插件(二期)三来源显式区分;本地插件**版本化管理、任意历史版本可回退**;功能落地后**对现有客户端能力零影响**。

**落盘规则(用户指定,2026-09-10)**:本地插件目录 = **`~/.tmd-cli/plugins/<id>/`**(发布版与开发版同路径)。依据:Rust 侧 `session::config_dir()` 已定义 `~/.tmd-cli/` 为全部客户端本地数据之家(settings.json / workspaces.json / session 日志 / panic.log),插件包是同性质数据,不入 Tauri appDataDir。

**范围切割(一期/二期)**:

- 一期(本 spec):目录扫描 + Blob 装载 + boot 装配 + 晚激活(免重启装新插件)+ 对话结束自动重扫(对话即变闭环)+ 信任闸 + 故障隔离与回退 + origin 三分 + 本地插件版本库与回退 + 插排页本地分区;卸载 = 废纸篓 + 重启(对齐 disabledPlugins 既有语义)。
- 二期(明确不做):热卸载与热更新(各注册表 unregister 柄 + `deactivate` 兑现)、权限强制(一期 manifest 仅展示)、市场来源实装(origin 字段先立)、TSX 在线编译、欢迎页/侧栏等其余消费点的 origin 角标。

**热更新语义(一期)**:重扫发现同 id 插件 bundle 内容变化 → 不做运行期替换,插排页该插头标「已更新 · 待启用」,确认后**重启生效**(无摘除柄,见故障隔离节)。依据:`MountContribution` 不带 pluginId、`contribute()` 为纯 push(2026-09-10 实证,仅 marketPanel 注册表带 pluginId),运行期摘旧贡献无锚点;二期 unregister 柄补齐后升级为免重启热更新。

**信任闸(2026-09-10 校准,精确到内容)**:AI 会话内容不可信(读仓库/网页),「落盘即自动执行全权限代码」等于 prompt injection 直通车——信任绑定**内容 hash**而非 id:settings 持久化 `localPluginTrust: Record<id, hash[]>`(已确认内容清单)。新内容(首装/更新/回退到未确认过的版本)一律落「待启用」态,一次点击确认;回退到**曾经确认过的 hash** 免点击直接信任——版本回退不掉进信任闸。设置项「信任本机插件自动装载」(默认关)供个人开发机跳过确认。对话闭环保留:已确认插件的纯新增迭代全程免点击。

## 插件包格式

```
~/.tmd-cli/plugins/<id>/
├── plugin.json            # 清单(必需)
├── index.js               # 当前生效 bundle(必需;默认入口,manifest 可改名)
└── .versions/             # 版本库(客户端维护;确认更新时自动归档)
    └── <version>-<hash8>.js   # 历史版本,保留最近 5 份,超出淘汰最旧
```

`plugin.json`:

```jsonc
{
  "id": "hello",                // 必须与目录名一致
  "name": "示例插件",            // → PluginMeta.name
  "desc": "一句话能力描述",      // → PluginMeta.desc
  "abbr": "HI",                 // → PluginMeta.abbr
  "category": "feature",        // engine | feature(local 插件禁 core,core=焊死属内置)
  "version": "0.1.0",           // 插件自身版本,版本库文件名与插排页徽章消费
  "apiVersion": 1,              // 内核 API 纪元;与客户端不符 → 拒绝装载(见兼容性)
  "entry": "index.js",          // 缺省 index.js
  "permissions": ["mounts", "settings", "commands"],  // 声明用到的 ctx 通道;一期仅市场页展示,不强制
  "dependsOn": []               // 可选;只能依赖内置插件或先扫描到的 local 插件
}

bundle 约定:

- 默认导出(或具名导出 `plugin`)一个 `Plugin` 对象:`{ id, meta, dependsOn?, activate(ctx), deactivate?() }`;`meta` 缺省时由 manifest 合成。
- **裸 specifier 白名单**:`react` / `react-dom` / `react/jsx-runtime` / `tmd-sdk`;其余依赖必须打包进单文件(esbuild 一把梭)。
- 一期 bundle 必须是纯 ESM JS(无 TS/TSX);AI 生成时经 `tmd-sdk` 重导出的 `createElement` 写 UI,不写 JSX。
- 单文件上限 **16MB**(对齐 `fs_edit` MAX_WRITE_BYTES 既有先例),超限拒绝装载。

`tmd-sdk` 是内核提供的虚拟模块,按现行规则暴露「运行时能力模块」(`ipc` / `settings` 访问 / `host` 查询门面等 kernel 公开件),注册面仍只经 `activate(ctx)` 的 `PluginContext`——与内置插件完全同规则,不开旁路。

## 方案取舍

### 三来源区分(origin)

**选定:PluginLifecycle 分持双清单,origin 为内核维护的装载来源维度。** `activateAll` 只收内置 `allPlugins`(签名零变化),local 清单经 `registerLocalPlugins(records)` 单独登记;lifecycle 内部给内置标 `origin: "builtin"`、local 标 `"local"`,`listPluginStates()` 返回 `{ plugin, enabled, origin }`;`"market"` 字段一期先立不实装(类型联合占位)。UI:插排页内置区(现有插排视图原样)、本地分区(local-loader 贡献,每插头显 `v<version> · 本地` 徽章 + 状态标 + 版本历史入口)、市场占位(已有「建设中」)。

理由:24 个内置插件文件零改动、`PluginCategory`(engine/feature/core 能力分类)与 origin(来源)正交不混;欢迎页引擎卡/侧栏等其余消费点一期不标 origin(本地引擎注册 profile 后即正常引擎,无混淆),二期按需再标。

**否决:PluginMeta 加 origin 字段由各插件自声明。** 24 个文件逐个改,且来源是装载事实不是插件自述——本地插件可以谎报 builtin,自声明在信任模型上就是错的。

### 装载机制

**选定:Rust 通用原语扫描读文 + 前端 Blob URL 动态 import + 加载期 specifier 重写。**

链路:`plugin_scan()`(Rust:扫 `~/.tmd-cli/plugins/*/plugin.json`,返回 manifest 列表 **+ 各文件内容 SHA-256 + .versions 文件清单**(`.versions/` 本身不作为插件 id 扫描;指纹为原始字节哈希),通用原语零业务知识)→ 前端逐个 `plugin_read_file(id, entry)` —— **单次读取原子返回 `{content, sha256}`** → 前端核对该哈希与扫描定戳一致才继续(信任闸闭环:执行的字节必须就是用户确认的那个内容,消除「扫描定戳后文件被换、装载读到另一份」的双读断裂,2026-09-10 评审 blocker 修复)→ 正则把白名单裸 specifier 重写为 shim blob URL → `URL.createObjectURL` + `import(blobUrl)` → 校验导出与 manifest 一致 → 得到 `Plugin`。

**装载校验五条(任一不过即「加载失败」条目,不 import)**:① id 与内置插件 id 冲突 → 拒绝(allPlugins 合并 Map 同 key 会静默顶掉内置插件,必须前置拦截);② id 与目录名不一致 → 拒绝;③ apiVersion 与客户端不符 → 拒绝(「插件需要 API 纪元 X / 客户端 Y」);④ bundle 超 16MB → 拒绝;⑤ 导出缺失/形状不符 → 拒绝。bundle 引用了 shim 未提供的导出(如内核改名后旧插件)→ ESM 链接期报错,`import()` 抛出被 catch,同样落「加载失败」条目——兼容性破坏天然不炸客户端。

**重扫幂等与单飞**:turnSettled/手动重扫先做 manifest diff——无变化零动作(不重复 import,防 blob URL 与模块实例累积泄漏);新 id 且已过信任闸才 `activateLate`;已装 id 内容变化只换「已更新 · 待启用」徽章,不 import。并发重扫(多会话同时结算 + 手动按钮)经**单飞闸**收敛:进行中的重扫 Promise 共享复用(先例 = `activateAll` 的 activation 共享 Promise),杜绝重复 import 同一插件。

shim 无需构建:`main.tsx` boot 时把 `React`/`ReactDOM` 等实例挂 `window.__TMD_SHIMS`,加载器按模块 `Object.keys` 动态拼具名导出文本生成 shim blob(`export const useState = m.useState; …`,ESM 具名导出必须静态声明,故按 key 生成字符串);shim 源缺失时(时序异常)报「内核 shim 未就绪」而非抛裸 TypeError。

理由:零 vite 配置、零新构建产物、跨 WebView2/WKWebView/WebKitGTK 无兼容风险;esbuild 产物的 import 语句形式固定,重写正则可控。

**否决:静态 import map + vite 多 entry shim 产物。** import map 映射 `react` → 定名 shim chunk。需要:vite rollupOptions 双 entry + 定名输出 + index.html 注入 + import map 必须先于一切模块加载;且 import map 在低版本 WebKitGTK(Linux)支持不稳。配置与兼容成本远超一行重写正则。

**否决:Tauri 自定义协议 `plugin://` 直接 `<script type=module>` 引用。** Rust 侧要注册 `register_uri_scheme_protocol` + 响应头/CORS 处理,面变重;且 bundle 内裸 specifier 仍需改写,省不掉重写步骤。列为二期「收紧 CSP」升级路径(届时 script-src 可摘掉 blob:,改放 `plugin:`)。

**否决:asset protocol 复用。** `asset:` 不在 `script-src` 白名单且响应无 CORS 头,module script 跨源加载直接被拦;把它加进 script-src 等于把 `**/*` 读权开放给脚本执行,比 blob: 更宽。

### CSP

**选定:`tauri.conf.json` 的 `csp` 与 `devCsp` 的 `script-src` 追加 `blob:`(一行)。**

放宽面:blob: 允许执行任何 Blob 脚本——但本应用内 Blob 脚本只可能由本地插件加载器创建(其余 blob: 消费均为 img/media,CSP 分区互不影响)。风险记档,二期自定义协议落地后收回。

**否决:不改 CSP 走 `new Function`  eval 路线。** `script-src` 无 `unsafe-eval`,一样被拦;且 eval 丢 ESM 语义(import/export 全灭),重写量反而更大。

### 激活编排

**选定:boot 合并装载 + `activateLate` 晚激活通道。**

- `main.tsx`:扫描完成后 local 插件与内置**合并为一个数组**传入同一次 `activateAll`(签名零变化;dependsOn 拓扑、disabledPlugins 过滤原样复用;内置插件不依赖 local,顺序天然安全)。settings 总开关 `localPluginsDisabled`(默认关)为真时 local 清单不进合并。
- `PluginLifecycle` 新增 `activateLate(plugin)`:以已激活集合为依赖底座跑同一套拓扑等待循环,激活成功即 `notify()`——各注册表本就经 `useSyncExternalStore` 响应式渲染,挂点/设置/面板**免重启即时上屏**。插排页「本地插件」区放「重新扫描」按钮触发。
- **对话即变(核心闭环)**:`KernelTopics.turnSettled`(`kernel.sessions.turn.settled`,既有一轮对话结算事件)上挂静默重扫:AI 在会话里落盘/修改插件 → 轮次结束 → 客户端自动重扫 → 已过信任闸的新插件免重启上屏(变更的旧插件标「已更新 · 待启用」)。零新依赖、零 PTY 解析,AI 侧无需学任何客户端协议——「写完文件」就是全部契约。窗口失焦等边界沿用 turnSettled 既有语义,不为重扫特设。
- 单个插件扫描/导入/校验失败:catch 记错误,不阻塞启动;插排页该条目显「加载失败 + 原因」。
- **activate 安全包装**:装载成功的 `Plugin` 先包 safe wrapper(`activate` 内 try/catch,失败标「激活失败 + 原因」,插件不进激活注册表)再交给激活循环——`pluginLifecycle` 现状 `await plugin.activate(ctx)` 抛错会 reject 共享 Promise 导致 `setReady` 不执行**白屏**,local 插件(坏代码高发)必须隔离;内置链路不动。

**否决:激活失败即弹窗阻断。** 本地插件是用户侧产物,坏插件不能拖死客户端;市场页内联错误足够。

### 故障隔离与回退

**渲染期隔离(必做)**:全仓零 ErrorBoundary(2026-09-10 实证),挂点组件渲染抛错 = React 整树卸载白屏。local 插件贡献的**每个挂点组件包 ErrorBoundary**,最坏 = 该挂点渲染错误占位,客户端其余部分存活、插排页可达,用户随时可禁用/删除——保证「任何坏插件都有出路」。

**版本库回退(用户指定:必须能区分版本)**:确认更新时客户端自动把当前 entry 的 bundle 归档进 `.versions/<version>-<hash8>.js`(同内容去重),再换新;`.versions/` 保留最近 5 份、超出淘汰最旧。插排页本地插头「版本历史」入口:列表(版本号 + 归档时间 + hash 短码),任意条目「回退到此版」→ 复制回 entry → 内容 hash ∈ `localPluginTrust` 则**免确认重启生效**,否则「待启用」一击。回退永不丢当前版:回退前当前版同样先归档进版本库。文件系统即版本库,零新存储机制。

**一键还原**:设置加「禁用全部本地插件」总开关(`localPluginsDisabled`),boot 扫描前检查——插件全炸时无需逐个处理,关掉即回到干净内置态;插件文件与版本库原样保留,随时再开。

**卸载可挽回**:删除 = `fs_edit.trash_entry`(trash crate 系统废纸篓,路径锁死 `~/.tmd-cli/plugins/<id>` 前缀,幂等),不走物理删除——误删从废纸篓拖回即还原(版本库随目录一起进废纸篓,一并可挽回)。

**残留无害**:卸载后的 disabledPlugins / localPluginTrust / 孤儿设置值由 sanitize 兜底,不做清理(无消费者即无影响)。

### 热卸载

**选定(一期):不支持。卸载 = 插排页「删除」(废纸篓,见上)+ 重启。** 与 `disabledPlugins`「重启后不激活」的既有拔插语义一致,用户心智零新增。

**否决(留二期):运行期热卸载。** `deactivate` 在 `Plugin` 契约里已声明但全仓无调用方;热卸载要求 10 条注册通道全部补 unregister 柄 + React 组件树摘挂载点,是真正的二期工程,不塞进一期拖期。

### 兼容性

**内核 API 纪元**:manifest `apiVersion` 对不上客户端纪元 → 装载即拒(见校验③),错误信息给出两侧纪元号。纪元号在内核注册面发生破坏性变更时手动 bump——一期恒为 1,先立机制后立变更。

**activate 失败语义**(落在故障隔离):记录「激活失败」原因,插件仍占用注册位(无摘除柄的现实约束),已注册的贡献以实际注册为准;isPluginActive 消费方均为特性门控,误报无实际危害。渲染期隔离落在 Mounts.tsx 统一渲染器的 ErrorBoundary,内置挂点同享。

**跨平台**:目录沿用 `config_dir()`(Windows = `%USERPROFILE%\.tmd-cli\plugins`,遵循 architecture/04 既有契约);bundle 纯 ESM JS 平台无关;shim 方案不依赖 import map,WebKitGTK 低版本无兼容债。

**dev/prod 同源**:同一插件目录、同一装载链路,dev 侧验证即 prod 侧行为;dev 独有的「仓内 `src/plugins/` HMR 老路」与外部目录并存,语义不同(内置候选 vs 外部装载)互不影响。

**CSS 污染(记档)**:一期 manifest 无 style 字段(实现砍掉,YAGNI——插件经 createElement 的 inline style 自行解决),日后若加,内联 `<style>` 全局生效需配 scope 隔离。

### 零影响与回归保障(用户指定:不影响现有能力)

**设计不变式**:① 24 个内置插件文件零改动;② `activateAll(plugins, ctx)` 签名与语义零变化(local 经数组合并进入,manifest 分持是内部增量);③ settings 新字段全部带默认值 + sanitize,旧 settings.json 直接兼容;④ 除 CSP 一行外无任何全局面变更(无新全局样式、无启动时序变化——local 装载失败不阻塞 `setReady`);⑤ 无插件目录/空目录/`.versions` 残缺目录 → `plugin_scan` 返回空清单,boot 行为与 HEAD 完全一致。

**回归验证专项**(进验证清单第 5 项):全量现有 vitest **一个测试文件不改**全绿;插排页现有 24 插头视图、拔插 dirty 徽章、marketPanel 二级面板(omp 扩展面板)回归目检;`check:arch-boundary` / `check:file-size` 照跑——R1/R3/R4 边界对 local 插件同等生效(local bundle 是运行时数据,不经 import,天然不触 R1/R4;装载器属 kernel,不得出现任何插件私有知识)。

### AI 生成直出 ESM

**选定(一期):AI/作者直接产出纯 ESM bundle,经 `tmd-sdk` 的 `createElement` 写 UI。** 客户端零构建链,发布版可用;esbuild 打包路径(依赖非白名单时)作为进阶选项写进「插件开发提示词」。

**否决(留二期):内置 esbuild-wasm 在线编译 TSX。** 让 AI 写 TSX 体验更好,但引入 wasm 运行时与编译错误面;一期先跑通闭环。

## 改动面

| 位置 | 改动 |
|---|---|
| `src-tauri/src/plugins.rs`(新) | `plugin_scan()`(扫 `~/.tmd-cli/plugins/*/plugin.json`,返回 manifest + 各文件内容 SHA-256 + .versions 清单)/ `plugin_read_file(id,name)` / `plugin_read_version(id,file)` / `plugin_archive(id)` / `plugin_rollback(id,file)` / `plugin_delete(id)`(废纸篓,路径 Rust 锁死)等通用原语;路径白名单锁死 config_dir/plugins,防目录穿越;读入 16MB 上限 |
| `src-tauri/src/lib.rs` | 注册三命令 |
| `src-tauri/tauri.conf.json` | `csp`/`devCsp` 的 `script-src` 加 `blob:` |
| `src/kernel/localPlugins.ts`(新) | 扫描→diff(SHA-256)→读 bundle→specifier 重写→blob import→校验五条;产出 `LocalPluginRecord { plugin?, error?, origin: "local", contentHash, confirmedHashes }`;重扫单飞闸;activate 安全包装;版本归档/回退编排;turnSettled 订阅静默重扫 |
| `src/kernel/pluginLifecycle.ts` | 加 `registerLocalPlugins(records)`(双清单分持,origin 内部标注)+ `activateLate(plugin)`;`listPluginStates` 透传 origin 与本地状态(加载失败/激活失败/待启用/已更新) |
| `src/kernel/pluginSdk.ts`(新) | `tmd-sdk` 虚拟模块的实体:聚合 re-export kernel 公开运行时件 + `createElement`;同时是 shim 生成的数据源 |
| `src/kernel/settingsTypes.ts` | settings 加 `localPluginsDisabled: boolean` 与 `localPluginTrust: Record<string, string[]>`(均默认空 + sanitize) |
| `src/plugins/local-loader/`(新,内置插件) | 插排页本地分区 UI:清单/重扫/删除(废纸篓)/待启用确认/版本历史与回退/错误展示;挂点组件 ErrorBoundary 包裹;`v<version> · 本地` 徽章;「复制插件开发提示词」按钮(bundle 约定 + tmd-sdk 清单 + plugin.json 范本 + apiVersion 说明);经 ctx 注册,kernel 不染 UI |
| `app-shell` 插排页 | 挂「本地插件」分区(render 由 local-loader 贡献);设置页加「禁用全部本地插件」开关 |

`pnpm check:file-size` 300 行铁则对新增件同样生效;`localPlugins.ts` 超线即拆 `localPluginLoad.ts` / `localPluginShim.ts` / `localPluginVersions.ts`。

## 验证

1. `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` 全绿;Rust 侧 `cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`(plugins.rs 单测:目录穿越拒绝 / 缺 manifest 跳过 / id 与目录名不一致拒绝 / 16MB 超限拒绝 / `.versions` 不作为插件 id / 无目录返回空)。
2. vitest:`localPlugins` 装载编排单测——shim 重写(白名单命中/非白名单原样报错)、blob import 失败隔离、`activateLate` 依赖等待与依赖环报错被 catch、manifest diff 幂等(重扫无变化零 import)、id 与内置插件冲突拒绝、apiVersion 不匹配拒绝、信任闸按 hash(未确认不激活/已确认 hash 回退免确认)、重扫单飞(并发触发只跑一次)、activate 抛错隔离(不 reject 共享 Promise)、版本归档与保留上限淘汰(5 份)、回退编排(先归档当前版再换回)。
3. 样例插件端到端:手写 `~/.tmd-cli/plugins/hello/`(manifest + 纯 ESM,`createElement` 挂 `header.right` 一个按钮)→ `pnpm tauri:dev` 真窗目检:boot 装载 → 插排页本地分区「待启用」一次点击 → 上屏;再落第二个插件走「重新扫描」→ 确认 → 免重启上屏;改 hello bundle → 标「已更新 · 待启用」,确认后旧版进版本库;连改三轮 → 版本历史 3 条 → 回退中间版(hash 已确认)免点击重启生效;删目录 → 废纸篓可挽回;坏插件三连(语法错误 / activate 抛错 / render 抛错)分别落「加载失败」「激活失败」「挂点错误占位」,客户端全程不白屏;`localPluginsDisabled` 开关一键回到干净内置态。
4. 对话造插件闭环彩排:在一个 omp 会话里粘贴「插件开发提示词」→ 让 AI 生成上述样例插件落盘 → 轮次结束自动重扫 → 插排页「待启用」一次点击 → 免重启生效(仅首启一击;后续该插件纯新增迭代零点击),录为验收记录。
5. **回归保障(零影响承诺)**:全量现有 vitest 一个测试文件不改全绿;插排页现有 24 插头视图、拔插 dirty 徽章、omp 扩展二级面板回归目检;无 `~/.tmd-cli/plugins` 目录时启动行为与 HEAD 对照一致;`check:arch-boundary` / `check:file-size` 全绿。
