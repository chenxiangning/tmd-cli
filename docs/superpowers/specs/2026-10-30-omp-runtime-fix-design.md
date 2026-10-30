# omp 前置依赖过旧一键修复(首页引擎卡)

日期:2026-10-30
状态:已评审通过(方案 A 声明式契约扩展;修复链含自动更新 omp)

## 背景与目标

omp 18.14.0 起在启动时硬校验 Bun 运行时 `engines.bun >= 1.4.4`(上游因 CVE-2026-91403 伪造 CA 信任链、CVE-2026-111497 Brotli 越界写抬门槛)。Bun 过旧的机器上 omp 会话启动即退出,报错只出现在 StartFailureToast;回到首页引擎卡,依赖探针只区分「找到/没找到」,bun 已装但过旧的状态完全不可见,也没有修复入口。

目标:

1. 首页 omp 引擎卡对「依赖已装但版本低于声明下限」可见:引导区显示当前版本与所需下限;
2. 提供「一键修复」按钮,客户端内执行依赖升级(官方脚本通道,流式日志),**成功后自动接续 omp 本体更新**,整链完成后双探针重跑、引导区消失;
3. 机制做成通用契约字段,其他 CLI 声明运行时版本下限同样受益。

## 方案取舍

**选定:声明式契约扩展。** `CliPrerequisite` 增加可选 `minVersion`(semver 三元组),omp 声明 `1.4.4`;welcome 消费端用现有 `compareSemver`/`extractSemver` 判过旧,引导区扩分支,修复链复用两个 `useEngineInstall` 钩子(script 通道升 bun → onDone 自动 start omp 更新)。零内核配方语义(minVersion 是通用字段,非 omp 专属知识),探针/安装通道/流式日志/重探全部现成复用。缺点:下限硬编码,omp 将来抬门槛时本仓跟一行(注释标注维护口径)。

**否决:解析 omp 启动失败错误串**("Bun runtime must be >= 1.4.4")。下限实时准确(omp 自己说的),但文案措辞一改解析即碎;判定滞后(须先失败一次);omp 私有错误格式知识要先进 cli-omp 插件再回注 welcome,跨插件链路更绕。

**否决:通用环境体检页**(doctor 式全引擎依赖健康面)。范围过大,另立 spec;本次的 minVersion 契约字段是其地基,不冲突。

## 设计

### 契约与声明

- `src/kernel/cliPrerequisite.ts`:`CliPrerequisite` 加可选 `minVersion?: string`(运行时最低版本,semver 三元组;依赖探针版本低于它 = 过旧,引导区出升级入口)。kernel 只声明形状,比较逻辑在 welcome 消费端。
- `src/plugins/cli-omp/index.tsx`:`requires` 加 `minVersion: "1.4.4"`,注释写明来源(omp 18.14.0 engines.bun ≥1.4.4,两 CVE 修复线)与维护口径(omp 抬门槛时跟一行)。

### 判定与展示(welcome)

- 纯函数 `isBelowFloor(currentRaw, floorRaw)` 落 `latestVersion.ts`(与 `isOutdated` 同口径:任一无法解析 = false,不误报);
- `EngineCard` 派生 `depOutdated`(`meta.requires?.minVersion` 存在 && depProbe ok && 版本低于下限);引导区渲染条件由 `depProbe.status !== "ok"` 扩为 `… || depOutdated`;
- `PrerequisiteGuide` 加「过旧」分支:文案「依赖 {name} {current} 过旧,{engine} 需 ≥{floor}」+「一键修复」按钮(running 显「正在修复 {name}…」,title 提示修复后自动更新引擎),日志复用 `InstallLog`(label「{name} 修复」)。

### 修复链(EngineSection 编排)

1. 点「一键修复」→ 记 `fixChainRef = depOutdated`(点击时态)→ 跑依赖 script 通道;
2. 依赖 onDone(成功)且 fixChainRef → 自动 `startInstall()`(omp 更新,command 通道 `bun install -g @oh-my-pi/pi-coding-agent`,实际通道由 effectiveMeta 照常解析);
3. 两钩子各自 onDone 触发重探(依赖/引擎),双探针刷新后引导区消失。
- 链中断:任一步失败即停,日志保留可翻、按钮可重点;bun 全新安装(notFound 场景)不记链标,omp 装不装仍由用户手点(不越权)。

### 门控与兜底(维持现状)

`depBlocked` 逻辑不动(过旧时 depProbe.status 仍是 ok,omp 的安装/更新按钮照常可点,手动路径保留);「新会话」不拦,启动失败仍有 StartFailureToast 呈现 omp 原始错误——版本抠不出等边界不会变成无声失败。

## 改动面与验证

改动:`kernel/cliPrerequisite.ts`(+5 行)、`cli-omp/index.tsx`(+3 行)、welcome 六处(latestVersion 判定函数、engineMeta 透传、EngineSection 链编排、EngineCard 派生态+渲染条件、PrerequisiteGuide 过旧分支、locales en/ja 键);welcome-install.css 不动。所有触碰文件远离 300 行铁则上限(WelcomePage 295 行零改动)。

验证:`isBelowFloor` 单测(低于/等于/高于/不可解析/缺省)+ EngineCard 渲染契约测试(过旧出「一键修复」与版本文案、主按钮不受门控;达标引导区消失;无下限声明不受影响);`pnpm check:gate` 全链(含 i18n 键比对三段);react-doctor 100 分;`pnpm tauri:dev` 真窗口目检(旧 bun 复现过旧态 → 一键修复 → 链完成引导区消失)。
