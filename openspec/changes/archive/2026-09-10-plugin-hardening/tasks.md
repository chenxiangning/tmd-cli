# 插件强化 实施计划

对齐 `openspec/changes/plugin-hardening/proposal.md`。每项完成即勾。

## 1. 契约与权限映射(先行,独立可交付)

- [x] `kernel/plugin.ts`:`Plugin.activate` 返回值放宽为 `void | Promise<void> | (() => void)` + 注释补威胁模型边界
- [x] kernel 权限映射新文件:ipc/host/settings 导出 → 类别映射表 + wrap 实现 + 穷尽性单测(未归类导出报错)
- [x] `kernel/localPluginLoad.ts`:permissions 形状校验;`LOCAL_PLUGIN_API_VERSION` 1→2;逐插件 shim 生成(`tmd-sdk:<pluginId>` 寻址,无声明 = 纯 React 原语)
- [x] `kernel/localPlugins.ts`:manifestHash 记录 + 信任闸双绑定 + 记录透出 permissions

## 2. 贡献回滚栈

- [x] 约 11 处注册表 remove-by-owner API + 「注册→摘除→归零」单测(settingsRegistry/filePanel/tabs/marketPanel/sidebarActions/fileVisual/shortcuts/homePanels/cliConfigRegistry/cliProfile/mounts)
- [x] `kernel/pluginLifecycle.ts`:attributed ctx 记账 + activate 失败逆序撤销(cleanup + 贡献)+ 单测(抛错后注册表零残留)

## 3. 崩溃熔断

- [x] kernel `PluginBoundary`(pluginId props)替换 Mounts 匿名 boundary
- [x] tab 内容/右栏面板/设置 section/首页面板/市场面板五类渲染点补齐边界
- [x] 计数 + 阈值 3 次 + quarantine 集合 + 事件总线广播 + 贡献摘除 + 单测
- [x] local-loader 市场面:待启用卡片权限人话清单 + 熔断徽章/错误文案

## 4. 全链验证

- [x] 单测全绿 + 桩目检(权限矩阵/双绑定/失败回滚/熔断四场景)
- [x] `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`
- [x] `pnpm tauri:dev` 真窗目检:安装→权限展示→确认→激活→崩溃熔断→重启恢复
