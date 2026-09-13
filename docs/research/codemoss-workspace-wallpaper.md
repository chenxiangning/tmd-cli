# codemoss 工作区壁纸(自定义背景)能力盘点

- 日期:2026-09-13
- 来源:codemoss 代码库只读扫描(`src/features/theme` / `src-tauri/src/workspace_wallpaper.rs` / `openspec/changes/*workspace-wallpaper*`)
- 用途:tmd-cli 壁纸插件(wallpaper)的需求基线 + 移植映射 + 决策点清单
- 状态:已完成

## 一句话结论

codemoss 的自定义背景是一套自成一体的「workspace wallpaper」子系统:**单一 settings 数据模型(mode + library + 效果参数)→ 模块级 store(useSyncExternalStore)→ 主窗口根部固定层 Host 渲染 img / video / 流体背景 + `:root` CSS 变量效果通道(模糊/暗化/翻转/object-fit)→ `:root[data-workspace-wallpaper]` 属性开关把整套 chrome 表面 token 替换为半透明 veil 实现打穿**。后端只有 6 个 Rust command(受管目录复制/删除 + 预览/字节读 + wallhaven 市场搜索/下载)。移植 tmd-cli 可以做成一个 feature 插件,真正要预先决策的只有三件事:壁纸文件是否复制进受管目录、chrome 打穿走哪条通道(tmd-cli 已有 `:root` 主题 token 体系,比 codemoss 的巨型选择器清单干净得多)、终端幕布区默认透还是保底色。

## 1. 总体数据流

```
Settings 外观区(BasicAppearanceSection「工作区壁纸」行)
  ├─ previewWallpaper:拖滑杆先 publish 到 store 即时预览,防抖 600ms 再落盘
  └─ persistWallpaper:sanitize 后整体写回 AppSettings.workspaceWallpaper
        │
AppSettings.workspaceWallpaper(单一字段,加载/保存时 publishWorkspaceWallpaper)
        │
模块级 store(workspaceWallpaperStore.ts,useSyncExternalStore 订阅)
        │
WorkspaceWallpaperHost(router.tsx 主窗口分支首个子元素,与 AppShell 平级)
  ├─ mode=custom:选中项 video → <video muted loop playsInline>;否则 <img>
  ├─ mode=fluid:FirstRunFluidBackdrop(Windows 走 lite profile)
  ├─ mode=none / 媒体解析失败:不挂层 / 运行时回落 fluid(不改写存储)
  ├─ 效果:写 :root CSS 变量(blur/darken/object-fit/flip),::before 压暗、::after 罩色
  └─ :root.dataset.workspaceWallpaper = mode → 触发全局 CSS 打穿体系

Rust(src-tauri/src/workspace_wallpaper.rs,目录 = ~/.ccgui/wallpapers/)
  ├─ import_workspace_wallpaper(sourcePath) → 校验白名单后 uuid 复制进受管目录
  ├─ remove_workspace_wallpaper(path) → 仅删受管目录内文件(canonicalize 围栏)
  ├─ read_workspace_wallpaper_preview(path) → 图片 data URL(40MB 闸)
  ├─ read_workspace_wallpaper_bytes(path) → 视频字节(WKWebView 兜底用)
  ├─ search_workspace_wallpaper_market(query) → wallhaven.cc 搜索(分页/分类)
  └─ download_workspace_wallpaper(request) → 仅 https wallhaven.cc 域下载入受管目录
```

## 2. 数据模型(src/types/settings.ts + features/theme/utils/workspaceWallpaper.ts)

```ts
type LibraryItem = {
  id: string;                       // uuid,import 时生成
  kind: "image" | "video";          // 与扩展名强一致,不一致整项丢弃
  path: string;                     // 受管副本绝对路径(~/.ccgui/wallpapers/<uuid>.<ext>)
  sourcePath?: string;              // 原始选择路径或 wallhaven 来源页(去重键 + 展示)
  hidden?: boolean;                 // 软删除:只从网格拿掉,不碰文件
};

type WorkspaceWallpaperSettings = {
  mode: "none" | "fluid" | "custom";
  library?: LibraryItem[];
  selectedLibraryId?: string | null;
  // 效果
  wallpaperBlur?: number;           // 0-40 px(加在媒体元素 filter 上,不是 backdrop-filter)
  wallpaperDarken?: number;         // 0-80 %(host ::before 黑罩)
  objectFit?: "cover" | "contain" | "center" | "fill";   // center 映射 CSS object-fit:none
  flip?: boolean;                   // scaleX(-1)
  playbackRate?: 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2;        // 仅视频
  paused?: boolean;                 // 仅视频
  // 轮播
  rotationEnabled?: boolean;        // 要求可见项 >= 2
  rotationIntervalMinutes?: 5 | 15 | 30 | 60;
  // 旧字段 / 流体
  customImagePath: string | null;   // legacy 单路径,无 selectedLibraryId 时兜底
  fluidPreset?; fluidMotion?;       // fluid 模式参数
  veilOpacity?: number;             // 毛玻璃,sanitize 现已硬回 0(弃用中)
};
```

sanitize 链要点(全在 `workspaceWallpaper.ts`,纯函数、双端复用):

- library 逐项校验:id 非空、扩展名白名单(png/jpg/jpeg/webp/gif/bmp/mp4)、kind 与扩展名一致、sourcePath 必须是 wallhaven 页 URL 或本地媒体路径,按 id 去重。
- `selectedLibraryId` 不在可见(未 hidden)项内 → 回退第一可见项;库空 → legacy `customImagePath`;两者皆空且 mode=custom → **运行时**回落 fluid,不改写存储。
- 数值 clamp 到合法域、枚举白名单、整体非法回落默认对象;任何时刻旧存储都能读。

## 3. 渲染层 Host(WorkspaceWallpaperHost.tsx,~300 行)

- 挂载:主窗口分支第一个子元素,`position: fixed; inset: 0; z-index: 0; pointer-events: none`,永远在 chrome 之下、不挡交互。
- 媒体 src 解析(`useManagedWallpaperSrc`):先 `convertFileSrc(path)`(asset://);onError 时图片回退 `read_workspace_wallpaper_preview` data URL,视频回退 `read_workspace_wallpaper_bytes` → blob: URL(**WKWebView asset:// 不能 Range 流播 MP4** 的兜底),再失败才标 failed 回落 fluid。blob URL 有 owner 登记 + 卸载 revoke。
- 视频暂停三条件:`paused` 设置 || 性能兼容模式 || `prefers-reduced-motion`(运行时强制,不改写存储);静音 + playsInline 是自动播放前提。
- 轮播:host 内 `setTimeout`(非 setInterval,依赖数组变化即重置 = 手动点选重置计时);到点先 publish store 再异步落盘。
- 效果通道:`:root` 上 6 个 CSS 变量(`--workspace-wallpaper-media-blur / darken / object-fit / object-position / flip / frost`),元素侧 `object-fit: var(...)`、`transform: var(--flip)`、`filter: blur(var(--blur))`。

## 4. chrome 打穿(最重的部分,workspace-wallpaper.css ~650 行)

机制分两层:

1. **表面 token 整体替换**:`:root[data-workspace-wallpaper]`(light/dim/dark 各一组)把 `--desktop-shell-background / --surface-sidebar / --surface-topbar / --surface-right-panel / --surface-composer / --surface-messages` 统一替换为 `color-mix(in srgb, #ededf0|#121212 16%, transparent)` 的同一 veil;`#root / .app / .sidebar / .main / .right-panel` 一律 `background: transparent + backdrop-filter: none`,每根 chrome 柱只刷一层 veil(历史上 messages/right-panel 二次混合导致「对话区露出原图」)。
2. **细部清单**:xterm 面板 `--terminal-background: transparent` + `.xterm/.xterm-screen/.xterm-viewport/.composition-view background: transparent !important`;设置页卡片半透明毛玻璃(`blur(22px) saturate(1.28)`);composer 输入框/代码块 chip 改半透明 sticker;拖拽条 `pointer-events` 交换。

平台坑(注释里血泪史,移植时直接继承结论):

- **WebView2(Windows)上 backdrop-filter 盖 WebGL 合成出黑色** → Windows 全部 `backdrop-filter: none` 改不透明 wash;壁纸模糊加在媒体元素 `filter` 上,不走 backdrop。
- WebKit 的 backdrop-filter 会按模糊半径外扩光晕染到相邻列 → 壁纸层绝不给 chrome 列挂 backdrop-filter。
- `prefers-reduced-transparency: reduce` → frost 强制 0。

## 5. 设置 UI(BasicAppearanceSection + WorkspaceWallpaperPicker)

外观区「工作区壁纸」行:segmented 无/自定义(fluid 无入口,它是 Windows 默认态)→ 自定义态展开:当前壁纸卡(缩略图 + 播放/暂停 + 「选择壁纸」)、object-fit 4 档、倍速 6 档(视频)、翻转开关、模糊/暗化滑杆(即时预览 + 防抖落盘)、轮播开关 + 间隔 4 档。

选择壁纸弹窗(实色 Dialog,双 tab):

- **库 tab**:缩略图网格 + 类型过滤(全部/图片/视频)+ 隐藏/已隐藏切换 + 导入(系统 dialog 多选图片视频)+ 每卡 隐藏/恢复/移除。移除才调 Rust 删受管副本;隐藏纯数据位。
- **市场 tab**:wallhaven 搜索(220ms 防抖)/ 分类 / 分页 / 下载入受管目录;下载与库按 `sourcePath` 规范化去重,重复直接取消隐藏并选中。

导入链:dialog 多选 → 逐个 invoke import → 按 sourcePath 去重 → 追加 library 并选中最后一张;失败 toast,不写坏 library。

## 6. Rust 受管文件层(src-tauri/src/workspace_wallpaper.rs)

- 受管目录 = `app_home_dir()/wallpapers/`,幂等创建。
- import:拒 `://` / NUL / 非文件;扩展名白名单;`<uuid>.<ext>` 复制;返回 `{id, kind, path, sourcePath}`。
- remove / read:canonicalize 后必须 `starts_with(受管目录)` 才动手(路径逃逸围栏);read 有 40MB 上限;preview 返回 data URL,bytes 返回 `tauri::ipc::Response`。
- 市场:reqwest 20s 超时、仅 https + wallhaven.cc 域(含子域)、purity=100、`atleast=1920x1080`、429 专门文案。

## 7. 移植 tmd-cli 映射表

| codemoss 件 | tmd-cli 对应 | 备注 |
|---|---|---|
| router 根部 Host 兄弟层 | `ctx.contribute("overlay", { order: 极小 })` | overlay Mounts 渲染在 AppShell 根容器内,组件自身 `fixed inset-0 z-0 pointer-events-none` 即可沉底;v1 不必新增挂点 |
| AppSettings.workspaceWallpaper + 模块 store | 插件自有 store + settings 持久化 | 先例:ssh 域(类型/sanitize 在 kernel `sshSettings.ts`,分区 UI 在插件)。壁纸域若照搬需动 kernel settingsTypes;也可走「插件自管 JSON 文件」避免 kernel 染插件语义 —— 写 spec 时定 |
| 设置外观区展开行 | `ctx.registerSettingsSection()` 自立分区 | 注册面只能加新分区,不能往 settings 插件「基础设置」里塞 tab;分区导航顺序 order 调 |
| WorkspaceWallpaperPicker Dialog | `plugins/DialogShell.tsx` | 居中弹层 + 双主题适配已有先例 |
| import/remove 两个 command | 无现成对应 | 见决策点 1 |
| `:root[data-...]` + 650 行打穿 CSS | 插件自带 CSS(先例 `welcome/tokens.css` 组件内 import) | tmd-cli 已有 `kernel/theme.ts` 在 `:root` 写 token、表面吃 `var(--surface-*)` —— 打穿可以走「覆盖 surface token」而非选择器清单,见决策点 2 |
| useManagedWallpaperSrc(asset:// + data URL/blob 兜底) | `ipc.assetUrl` + `readLocalImageDataUrl` 已有;视频 blob 兜底需 `readBinaryFileBase64`(已有) | 现有原语基本够 |
| wallhaven 市场 | v1 建议砍 | 外网依赖 + 域名白名单知识,留 v2 |
| 流体背景(fluid 模式) | 无对应,v1 砍 | codemoss 的首跑流体背景是 onboarding 资产 |

铁律核对:

- 300 行铁则:codemoss 侧 Host 302 行 / Picker 642 行 / CSS 650 行,tmd-cli 移植必须拆分(sanitize / store / host / picker / css 各自成件)。
- PTY 幕布铁律:**不冲突** —— 壁纸层在幕布之下,PTY bytes → xterm.js 仍是原样透传;「严禁幕布侧二次渲染」禁的是输出侧加工,背景透明化属于幕布之外的视觉层。但 xterm canvas 透明后终端区直接吃壁纸,可读性要在 v1 实测。
- R4(插件不 import @shell/*):壁纸插件只经 ctx 注册面 + CSS,不 import shell 模块,CSS 选择器若直接命中 app-shell 类名属灰区,优先走 token 覆盖路线规避。

## 8. 写 spec 前要定的决策点(2026-09-13 施工落定,见 src/plugins/wallpaper/)

1. **受管副本 vs 直引绝对路径** → 选受管副本:kernel 新增通用原语 `fs_copy_file`(src-tauri/src/fs_edit.rs,绝对路径 + .git 段防线 + 新建不覆写 + 256MB 上限,ipc 面 `fsCopyFile` + 权限表归类 ipc.fs.write);受管目录 `~/.tmd-cli/wallpapers/`,移除走既有 `fsTrashEntry`(废纸篓可挽回)。
2. **打穿策略** → 选 token 覆盖:壁纸层经 `contribute("overlay")` 渲染为 `fixed inset-0 z-index:-1`;激活时插件在 `:root` 把 `--tmd-bg-base/sunken/elevated/input/terminal-bg` 快照原色改写为 color-mix 半透明(terminal-bg 解析成 rgba 字面量,xterm 可直接吃),订阅 `subscribeThemeApplied` 在主题重应用后重打;popover/hover/accent 不动,弹层保持实底。
3. **视频 v1** → 砍:v1 只做图片(png/jpg/jpeg/webp/gif/bmp),`useWallpaperSrc` = asset:// + `readLocalImageDataUrl` 两级兜底;视频 blob 链路留 v2。
4. **settings 域归属** → 插件自管:状态持久化在 `~/.tmd-cli/wallpaper.json`(fsReadFile/fsWriteFile 文本原语),kernel settingsTypes 零改动,不复制 ssh 域先例。
