# 手机 app 与桌面客户端样式/词典分家设计

- 日期:2026-09-25
- 状态:已落地(同日提交);同日按大仙反馈修订:回退 app 全局视觉改动(暗色令牌/转场/按压态/composer 与 keybar 细节),仅保留 git 模块细节(diff 着色/状态色)与分家机制本身

## 背景与目标

移动迭代(git 面板/keybar/回看)完成后,大仙要求 app 端与桌面客户端「区分开、不混载、不共用」。盘点出三处真实混载:

1. `main.tsx` 无条件静态引入 `styles/global.css`(桌面全量:themes+tailwind+插件样式)与 `mobile/mobile.css`——两棵树各背对方全部样式字节;
2. `mobile.css` 令牌挂在 `:root`,桌面加载时会污染宿主页面全局;另有两处 `--tmd-*` 桌面变量引用泄漏;
3. 手机专属键(~45 个)散落共用词典 `common/misc/settings` 域,与客户端词条混住。

目标:样式与文案按树互斥载入,app 深浅色跟随手机系统(大仙拍板),顺手完成一轮 app 视觉优化。

## 方案取舍

| 决策点 | 选定 | 被否决 | 理由 |
|---|---|---|---|
| 样式载入 | `main.tsx` 按 `isMobileShell()` 分支动态 import 对应唯一样式,渲染等 `cssPromise` | 保持双载加 class 隔离 | class 隔离不省字节也不断依赖,分家不彻底;CSS 动态 import 由 vite 原生切 chunk,零构建配置 |
| app 令牌 | `.m-app` 作用域自持全套令牌(亮默认+`prefers-color-scheme: dark` 覆盖) | 继续蹭桌面 themes.css / 跟随桌面设置 | 蹭桌面=共用;跟桌面设置需新增设置同步链路(YAGNI);系统跟随是独立 app 标准语义 |
| 令牌作用域 | `.m-app`(gate/MobileApp 一切 UI 根都带此类) | 保留 `:root` | `:root` 会污染宿主页面,违背分家初衷;实测全部页面状态均在 `.m-app` 内 |
| 词典 | 迁手机专属键入既有 `locales/{en,ja}/mobile.ts` 域(合并序最后);真共用词(刷新/取消/拉取/推送等,桌面 git 同用)留 common 不动 | 全部手机键硬迁 / 新建平行词典体系 | 同键双份=死数据(架构铁则);mobile.ts 域先例已存在且已最后合并,零接线成本 |
| 共享数据面 | `@kernel/*`(transport/ipc 契约/gitContract)维持共享 | 连数据面也复制 | kernel 是架构明文的合法共享层,复制即双真相 |

## 改动面

- `src/main.tsx`:样式分支互斥动态载入;渲染链挂 `cssPromise`。
- `src/mobile/mobile.css`:令牌迁 `.m-app`+暗色块+最小 reset(替代原蹭的桌面 preflight);修 2 处 `--tmd-*` 泄漏;UI 优化(路由 200ms 淡入转场尊重 reduced-motion、行/chip/键统一按压态、composer 聚焦描边与空草稿禁用发送、model 键 accent、git 状态字母分色 M/A/D/U/C、patch 按行 +绿/−红/@@ 暗淡)。
- `src/mobile/GitViews.tsx`:DiffPatch 按行着色(内容寻址 key 过 react-doctor);状态字母色类。
- `src/mobile/KeyToolbar.tsx` / `SessionScreen.tsx`:model 键强调类;发送钮禁用态。
- `src/kernel/locales/{en,ja}/`:common/misc/settings 迁出 45 键入 mobile.ts;补 15 个缺译键(en/ja 对称)。

## 验证

- 门禁:typecheck / 2835 vitest / locales 4 测试 / arch-boundary / file-size / build / react-doctor 100 / cargo 侧零改动复跑绿。
- 桩目检:git 面板亮色截图(diff 着色/状态色);`emulateMediaFeatures` 切 dark 验 `--bg-base` 变 `#1c1c1e`;复位验回落亮色;home 返回正常。
- 桌面树:`global.css` 分支不再载 mobile.css;构建 chunk 分离。
