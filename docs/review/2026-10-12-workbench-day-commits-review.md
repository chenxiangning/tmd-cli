# 2026-10-12 工作台全天提交收口 code review

日期:2026-10-12
状态:已交付(待大仙定修复批次)
范围:`393f74ea^..4e0f6c71`(2026-10-12 全天 31 提交,非 merge 实质约 25 笔;workbench/journal/docgen 主体 + kernel 5 文件 + skill-hub/mcp-hub/files 长尾 + src-tauri web/skill_pkg)
方法:三路评审(系统/平台兼容性、插件边界收口、死代码)并行扫描 + 仓库全部门禁实证。子代理无 shell,门禁与 cargo 由主会话补跑,结论以实证为准。

## 结论

**一个 blocker:远端 CI 已经红在「i18n 键三语同步」**——今天已推提交(393f74ea docgen 闭环起)新增大量 t() 中文键未配 en/ja 词条,守护脚本 exit=1(en 缺 134 / ja 缺 135),远端 run 38226396778 实挂此步。其余:1 med(react-markdown 渲染管线被静态 import 拖进主 chunk,破坏既有按需拆包纪律)+ 7 low(全机械可修)。三路评审的通过面见文末「干净面」,今天批次整体质量不差,但 i18n 必须先解红再谈收口。

## Findings

### B1(blocker)i18n 三语词典欠账,CI 硬门红

- 证据:`node scripts/check-i18n-keys.mjs` exit=1,`[缺键][en] 134 处`、`[缺键][ja] 135 处`;`.github/workflows/ci.yml` 将 `pnpm check:i18n-keys` 列为硬步骤;远端 run 38226396778(16:53,8f5cc16f)「i18n 键三语同步」失败实锤。
- 分布(按文件计数):docgen/DocGenDialog.tsx 68、DocGenCenter.tsx 42、DocGenFoot.tsx 34、DocGenBlocks.tsx 28、genSession.ts 26、DocGenReader.tsx 24、ReaderChrome.tsx 20、docgen/queue.ts 10、jump.ts 8、docgenView.ts 4、ProjectDetail.tsx 4、welcome/locales.ts 2。
- 说明:b08a9ba9「i18n 漏网清账」清的是上午存量;下午 journal 清单(8f5cc16f)、看板五态(da6ba68b)、任务右栏(46b35a01)、dashboard(4e0f6c71)四批 feature 又欠了新账。zh 侧零缺键(死代码评审逐一回查证实),欠的全是 en/ja。
- 修法:按 `src/plugins/workbench/locales/en.ts` 既有格式补词,约 135 组;补完本地跑 `pnpm check:i18n-keys` 到 exit=0 再推。

### M1(med)react-markdown 管线泄入主 chunk,两处静态 import 破坏拆包纪律

- 证据:`src/plugins/workbench/docgen/DocGenBlocks.tsx:7` 与 `src/plugins/workbench/journal/articleBody.tsx:9` 静态 `import { MarkdownBody } from "@plugins/session-viewer/markdownBody"`;静态链 `index.tsx → journal/attach.ts:10 → ArticleTab → articleBody` 与 `WbScreen.tsx → DocGenReader.tsx:8 → DocGenBlocks` 全程无 lazy 边界,markdownBody 文件头自称「react-markdown 按需拆包 chunk 的实体」(remark-gfm/math + katex + mermaid 懒加载全在里面),整条重管线被拖进首屏 chunk。
- 同插件先例:`DocEditor.tsx:20-22` 用 `lazy(retryImport(() => import("@plugins/session-viewer/markdownBody")...))` 注释明写「重型依赖双双按需进 chunk」。
- 修法:两处照抄 DocEditor 模式,把静态 import 换成模块级 `const MarkdownBody = lazy(retryImport(...))`,渲染处包 `<Suspense>`;机械改动,不动任何调用面。

### L1(low)跨插件 import 用相对路径未走别名

- `src/plugins/workbench/journal/unfinished.ts:16`:`import { UNSEEN_WINDOW_MS } from "../../session-board/boardRows"`——workbench 全树唯一一处相对路径跨插件,应改 `@plugins/session-board/boardRows`;纯常量消费,暂不上收。

### L2(low)feature→feature 消费无先例声明

- `src/plugins/workbench/journal/GenSettings.tsx:12` import `@plugins/memory-coordinator/modelCatalog` 的 `listModels`:状态纯函数、只走 `@kernel/ipc`,判合规,但模块头(「引擎配置卡的数据拉取源」)与 import 处均无外部消费声明;同插件 `articleBody.tsx:7-8` 有标准声明注释先例。补两处注释(模块头消费方列表 + import 处一行)即闭合。

### L3(low)导出文件名未防 Windows 保留设备名

- `src/plugins/workbench/docgen/DocGenFoot.tsx:48`:导出清洗未覆盖 CON/PRN/AUX/NUL/COM1-9/LPT1-9 与结尾点/空格,标题恰为这些词时 Windows 写 `CON.md` 必败。清洗后比对保留名表命中追加下划线,顺带 strip 尾点尾空格。

### L4(low)恢复态文案裸串未过 t()

- `src/plugins/workbench/journal/taskQueue.ts:206`:`"中断(应用重启)"` 裸串,改 `t("中断(应用重启)")` 并把键补进 journal/locales/{en,ja}.ts(随 B1 一并)。

### L5(low)死导出

- `src/plugins/workbench/types.ts:10`:`PROJECT_STATUSES` 全仓无外部 import(仅本模块 isProjectStatus 内部消费,grep 实证 0 引用),去 export。

### L6(low)workbench 词典死键 8 组

- `src/plugins/workbench/locales/en.ts`(ja 镜像同步):87/90/96/141/155/167/185/209 行附近,旧空态/概要文案被看板与 dashboard 重构替换后残留(如「当前筛选下没有项目。」「还没有项目。」「没有未完成任务,清清爽爽。」等),双语各删 8 条。注:全仓死键告警面 929 键为存量水位(脚本仅告警不计失败),本条只清今天 range 内的 8 组。

### 备忘(不立项)

- `docgen/genSession.ts` 299/300 贴线,后续加行即破 300 铁则,下批动它先想拆法。
- `kernel/DialogShell.tsx` 的 `repoName` prop 与 `git-dialog-repo` class 带 git 场景味,range 前既有,仅记录。
- Linux/Windows 交叉编译档未装 rustup target,未跑;cargo check dev+release 双档 host(arm64-apple-darwin)均过。

## 干净面(三路评审实证通过)

- 门禁:typecheck ✅ / vitest 3909 全绿 ✅ / check:arch-boundary R1 R3 R4 ✅ / check:file-size ✅ / cargo check dev+release ✅;react-doctor 远端绿(仅 PR 门,本地收口另跑)。
- Rust 兼容面:cfg(debug_assertions) 门控 import 无孤儿(web_access 修复后无条件使用、relay_agent 双侧门控),378a73ee 同类事故绝迹;zip4 泛型逐符号核验匹配;skill_pkg symlink cfg(unix)/cfg(windows) 双平台闭合;今日无新增 process::Command/bash 假设。
- TS 兼容面:无新增 process.platform/shell spawn;路径正斜杠字符串约定有 journalFiles 先例;CRLF 用 `/\r?\n/`;genSession 后缀匹配跨平台安全。
- 边界面:workbench 纯叶子消费者(全 src 无 `@plugins/workbench` 反向依赖);ctx 注册面标准形制(registerTabContent/registerSidebarAction/registerSettingsSection,退订随 deactivate);kernel 今日 5 文件零插件私语义,workbench 入口键系「壳内建钮」预批口径;icon decor 48 键全链路消费无死键;@tauri-apps 仅 ipc.ts/transport.ts。
- 死代码面:workbench 全插件 111 文件无孤儿、看板/右栏/dashboard 重构无旧组件残留、无 TODO/stub/console 残留、Rust 零 dead_code allow、pdfjs v6 迁移与触点重绑均无旧路径遗留。

## 建议修复批次

| 批次 | 内容 | 量级 |
|---|---|---|
| B1 | 补 en/ja 约 135 组词条(含 L4 一键),`check:i18n-keys` 解红 | 最大头,机械 |
| B2 | M1 两处 lazy + L1 别名一行 + L5 去 export | 全机械 |
| B3 | L3 Windows 保留名 + L2 声明注释 + L6 死键 8 组 | 顺手清 |

B1 落地前不要推 Tmd-0.3.6,推一次红一次。
