# 结构化会话启动部件 notice 降噪(语义分档 + 聚合一处)

日期:2026-10-02
状态:已落地(2026-10-03 提交;门禁全绿;真机目检留大仙)

## 背景与目标

structured-session(omp/pi `--mode rpc`)启动时,omp 会连发一批 `extension_ui_request`:`setStatus` ×2、`notify`、`setWidget` ×2(2026-10-01 晚实证,五帧一秒内到齐)。这些是给终端 TUI 用的界面部件(状态行/通知/小部件注册),RPC 模式下无人能答,按协议回 `cancelled`;2026-10-01 打磨批(「不再静默替答」)让每次取消都在转录插一行可见 notice——交互类部件可见化是对的,但 boot 期装饰部件也逐条落行,用户开 tab 即见五行技术噪声。

目标:

1. TUI 装饰类部件(setStatus/notify/setWidget)取消不再逐条落行,聚成一条淡色 system 行(×N 计数,原地刷新);
2. 真交互部件(select/input/editor 及未知 kind)维持逐条可见——「不再静默替答」初衷不回退;
3. 渲染层零改动,协议应答(cancelled)两种照发,只改展示面。

## 方案取舍

**选定:部件语义分档 + reducer 聚合块。** `widgetTier(kind)` 纯函数分档:chrome 集 = `{setStatus, notify, setWidget}`(omp 18.x 实证;TUI 装饰在 RPC 模式下永远无意义,不随轮次语义变化),其余一切(interactive 含未知 kind)逐条可见——未知宁可多显示不可静默。chrome 取消进 reducer 新 `chromeCancel(kind, clock)`:落定基座尾块已是聚合块则原地更新计数,否则追加一条(被 select notice 等其他块隔开自然新开一条,时序不回流)。聚合行形如 `TUI 部件交互已自动取消 ×5(setStatus ×2 · notify · setWidget ×2 · 23:32:31)`,时刻取最近一次,kind 为协议词不译。理由:按语义切不按时间切,setStatus 轮次中也会来;聚合块就是普通 system 块,TranscriptView/liveTurn/极简折叠组全部照常工作,渲染层零改动;保留一行观测痕迹,排障时仍看得出 omp 发过什么。

**否决:启动期全静默**(首条 prompt 前的取消不显示)。按 prompt 边界切不看语义,边界本身武断;且把 10-01 的可见化决定整个回退,select 若恰好在启动期出现也会被吞。

**否决:渲染层折叠**(连续同类 system notice 折成一条可展开)。数据层仍逐条进基座,治标;TranscriptView 与 liveTurn 两处同步改,改动面反而大;boot 期默认仍有一行展开逻辑要解释。

**否决:chrome 全静默**(连聚合行都不留)。省一行但排障失明;聚合行成本近零,观测价值大于成本。

## 落地

- `src/plugins/cli-shared/piRpc.ts`:`CHROME_WIDGET_KINDS` + `widgetTier(kind)` 导出纯函数;`extension_ui_request` 非 confirm 分支按档分流(chrome → `reducer.chromeCancel`,interactive → 原 `widgetCancelledNotice` 路径);协议应答先于分档照发。
- `src/plugins/cli-shared/piRpcReducer.ts`:`chromeCancel` 聚合块——`aggTail` 记 {id, counts},写入前先校验 settled 尾块 id 与之一致(任何其他块落尾后自然失效新开),文案经 `t()` 插值;块 id `live:nagg{seq}` 保证多条聚合块并存时 key 唯一。
- `src/plugins/structured-session/locales/{en,ja}.ts`:新词条 `TUI 部件交互已自动取消 ×{count}`(与现有 notice 词条同处,消费点在 cli-shared 的 feature 插件带词典先例不变)。
- `src/plugins/cli-shared/piRpc.test.ts`:分档映射、chrome 五连取消并一条、chrome→select→chrome 时序三面单测。

## 验证

- `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` 全绿;
- `pnpm check:i18n-keys` 新键 en/ja 齐全;
- 真机 `pnpm tauri:dev` 开 omp 结构化 tab 目检:启动只剩一条淡色聚合行;select 问卷取消仍逐条可见(本项留大仙)。
