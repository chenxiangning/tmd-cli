# 打开方式(Open With)设计:复刻 mossx 客户端

日期:2026-09-19
状态:已评审通过(用户确认:入口仅文本族文件视图;添加方式 = 预设网格 + 浏览)

## 背景与目标

mossx 客户端有一套「打开方式」:设置页可管理外部应用清单(可用性探测/默认项/排序/增删),文件场景经弹出菜单用任一应用打开当前文件。tmd-cli 目前只有「在访达中显示」(fs_reveal_in_file_manager)一条外部通道,无打开方式概念。

目标(整体复刻,两处入口调整):

1. 基础设置新增「打开方式」配置面板:应用清单行(图标 + 名称 + 可用徽标 + 默认星标 + 上下移 + 删除)与「添加打开方式」对话框(预设网格 + 浏览选 .app);
2. 打开入口不放顶栏,放在**打开的文件底部矮工具条最右**(「打开方式」按钮 → 向上弹菜单),菜单行点击 = 用该应用打开当前文件,右侧圆圈点击 = 设为默认项。

## 方案取舍

**选定:预设 catalog(TS)+ 懒探测 + OS 图标提取 + 单条启动命令。**

- 数据模型:`OpenWithTarget { id, label, kind: "app"|"command"|"finder", appName?, command?, args? }`;settings 增 `openWithTargets: OpenWithTarget[]`(数组序即显示序)与 `openWithDefaultId`。默认种子仅「访达」。图标/可用性/顺序不持久化(mossx 同款:图标与可用性运行时解析,顺序即数组序,默认即 id 指向)。
- 应用发现:**不做全系统枚举**。TS 侧预设 catalog(vscode/cursor/zed/sublime/ghostty/antigravity/finder,平台过滤);Rust `fs_probe_open_app` 按目标探测(mac 标准应用目录找 `<appName>.app`,command 走 which)。
- 图标:Rust `fs_open_app_icon` 懒提取(mac bundle icns → sips → png base64 data URL),前端 mem 缓存,失败回落通用 phosphor 图标。否决「内置 SVG 资产表」:OS 提取一条路径通吃预设与自定义应用,免维护资产。
- 启动:Rust `fs_open_with(path, target)`:finder → 复用 `reveal_in_file_manager`;app → mac `open -a <appName> [--args…] <path>`、win/linux PATH 尽力;command → 直接 spawn。目标路径恒为最后参数。
- 否决「设置面板独立保存按钮」:tmd-cli settings 即写即生效(updateSettings),与现有 tab 一致。
- 否决「手动参数表单」:预设 + 浏览覆盖主场景;args 留在数据模型(预设/启动链路用),不做编辑入口(YAGNI)。
- 否决「全文件视图入口」:图片/PDF/二进制等字节通道视图无底部工具条,不为其加(用户裁决仅文本族);远程文件(wslr://)不渲染入口。
- 分层:类型进 kernel/settingsTypes(schema 中心),catalog 与判定纯函数进 kernel/openWith.ts(settings 编辑 + files 消费两插件契约),ipc 薄包装进 kernel/ipc.ts(R3 唯一通道);UI 分属 files(菜单)/ settings(配置面板)插件。Rust 新文件 open_with.rs(塞 fs_edit.rs 会顶到 300 行铁则)。

## 交互与边界

- 菜单(wsmenu 范式:portal + fixed + backdrop + Escape,向上弹、视口夹取):行 = 图标 + 名称 + 默认圆圈;行点击打开、圆圈点击仅设默认。无目标时按钮隐藏。
- 删除默认项:openWithDefaultId 回落到剩余首项;清空清单则按钮隐藏。
- 可用徽标:设置面板逐行懒探测(可用/未装);添加对话框预设网格未安装或已添加灰显。
- 浏览:tauri-plugin-dialog(已在 Cargo)选 .app / 可执行文件,产出自定义条目(label = 文件名,appName = 选中路径)。

## 验证

- 单测:kernel/openWith catalog 平台过滤与回落;settingsSanitize 新分支(非法 kind 剔除、args 白名单、默认 id 失效回落)。
- 桩目检(1421 + Tauri 桩):菜单弹出/收起、行点击 invoke 参数、圆圈设默认、设置面板 CRUD/排序/添加对话框/灰显。
- 真窗口 `pnpm tauri:dev` 目检真实打开链路。
- 门禁:pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build;npx react-doctor 100。
