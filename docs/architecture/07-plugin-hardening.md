# 07 —— 插件强化契约(权限门面 / 贡献记账 / 崩溃熔断)

状态:已落地(2026-09-10,openspec/changes/plugin-hardening,ee94119 起的实施链)。吸收 codemoss 插件系统三优点(权限声明、贡献回滚、崩溃隔离)的本地插件强化,内置插件零迁移。

## 分层与文件

| 文件 | 职责 |
|---|---|
| `kernel/plugin.ts` | `PLUGIN_PERMISSIONS` 15 类权限唯一声明 + `MountPoint`/`PluginContext`/`PluginEventBus` 契约 |
| `kernel/pluginPermissions.ts` | `IPC_METHOD_GRANTS`:103 个 ipc 方法 → 权限类别映射(穷尽性测试把关);`wrapIpc`/`wrapSettings`/`wrapHost` 逐插件包装;`PERMISSION_LABELS` 人话文案 |
| `kernel/pluginSdk.ts` | `installPluginSdkShim(key, permissions)`:按授权装配逐插件 shim(react/react-dom 公共 + tmd-sdk 私有) |
| `kernel/localPluginScan.ts` | 扫描记录、信任令牌(`trustToken`)、激活判定(自 localPlugins.ts 拆出,300 行铁则) |
| `kernel/contributionLedger.tsx` | attributed ctx:注册即记账、失败逆序撤销、贡献组件注册期统一包 `PluginBoundary` |
| `kernel/pluginQuarantine.ts` | 崩溃计数(阈值 3)→ 熔断落态 → 经 `setQuarantineHandler` 通知 hostRegistry 摘除 |
| `kernel/localPlugins.ts` | 装载编排:manifest 校验 → 双绑定信任闸 → shim 装配 → 记账激活 |
| `plugins/local-loader/` | 管理面 UI(权限清单 / 确认 / 熔断徽章),`devPrompt.ts` 为 AI 生成说明书 |

## 权限模型

- manifest 新增 `permissions` 字段,取值为 `PLUGIN_PERMISSIONS` 子集;**缺省/空 = 纯 UI 插件**(仅 React 原语与注册面)。
- 三档门面:`ipc`(按 15 类裁剪,未授权方法访问即抛并指明所需权限)、`settings`(read/write 分表,`configReadSettings` 等 8 个保留能力任何授权不下发)、`host`(整门面一类)。
- `events` 权限控制 `ctx.events`:未授权以同形拒绝桩顶替(访问即抛),非删属性。
- 注册面(挂点/右栏面板/设置分区/中央 tab/侧栏动作/命令)不设权限门槛,与内置插件同规则。

## 信任闸(双绑定)

信任令牌 = `trustToken(entrySha256, manifestHash)`:改代码**或改权限**都产生新令牌,已确认插件回到「待启用」。令牌存 `settings.localPluginTrust`(插件 id → 令牌数组,支持多版本并行信任)。

## 贡献记账与回滚

激活经 `makeAttributedCtx(base, plugin, undo)`:每次注册 push 撤销闭包;activate 抛错 → 逆序执行撤销(零残留)后落「激活失败」。`activate` 可返回 cleanup 函数,并入同一账本。11 处注册表配套 `remove*` 撤销 API。内置插件不经记账包装(行为零变化)。

## 崩溃熔断

六类渲染面的贡献组件在**注册期**统一包 `PluginBoundary`(渲染抛错只塌该贡献位);按插件归属计数,阈值 3 → 熔断(内存态):摘除该插件全部贡献 + 市场卡片「已熔断」徽章,重启恢复。

## 兼容纪元

`LOCAL_PLUGIN_API_VERSION = 2`(权限门面落地即 bump):apiVersion=1 的旧 manifest 拒装并提示「API 纪元不匹配」。生态为零期收窄 SDK 零兼容债。

## 守护测试

`pluginPermissions.grants.test.ts`(映射穷尽 + 三门面拒绝矩阵)、`contributionLedger.test.tsx`(回滚序 / 三通道透传 / events 拒绝)、`pluginQuarantine.test.ts`(阈值边沿 / 单次摘除)、localPlugins 系(纪元 / 双绑定 / 拓扑 / 回滚)。
