# 手机会话通用渲染:codemoss 视觉重皮 + transcript 实时生长

日期:2026-09-25
状态:已评审通过(大仙拍板:仅视觉重皮 + 允许扩展 kernel + 增量刷新;实现取更保守口径,kernel 零改动)

## 背景与目标

手机端(src/mobile/)实时会话屏(SessionScreen)与历史会话屏(HistoryScreen)共用 `TurnsView` 渲染 transcript 分层(用户/助手/工具),现状为最小可用样式:工具调用逐条平铺虚线芯片,transcript 进屏读一次快照后不再生长,新输出只进 VT 实况块。对标参考 `/Users/chenxiangning/code/AI/github/codemoss`(ccgui)的聊天时间线:用户气泡、助手正文、连续工具/思考折叠成一条 process 行。

目标(不动客户端、不动插件、不动 Rust):

1. TurnsView 按 codemoss 观感重皮,两屏继续共用同一组件、接口不变;
2. 连续工具调用折叠成一条「工具调用 {n} 次」行,点开逐条展开(codemoss ProcessDisclosure 的手机版,纯渲染折叠);
3. 实时会话的 transcript 随流生长:轮询 `fs_read_tail_changed`,changed 才重解析;历史屏保持静态一次读。

## 方案取舍

**选定:视觉重皮 + 整窗重解析轮询。**

- 渲染折叠在组件层做(连续 `role==="tool"` 的 turn 归组),数据面维持 `kernel/transcript.ts` 的 `{role, text, tool}`,kernel 一行不动。增量生长复用 kernel 现成 `ipc.fsReadTailChanged`(ChangedTail:changed/size/text,尺寸未变零读取,桥白名单已放行),2s 一拍、`changed` 才整窗重 parse + setState;`document.hidden` 暂停;文件变小(jsonl 轮转)全量重置。MAX_TURNS=40 封顶语义保留。
- i18n:新键进 `kernel/locales/{en,ja}/mobile.ts`(t() 中文源串 + `{n}` 插值,既有机制),纯增量,桌面不受影响。

**否决:markdown 正文 / 代码高亮 / 思考折叠块 / 工具参数面板。** 数据面没有这些字段(TranscriptTurn 无 args/thinking,thinking 在解析层即被丢弃);渲染层上了也是空壳。要上需先扩 kernel/transcript 解析(大仙已预批准该方向),等明确要再做。codemoss 的 StreamReveal 逐帧打字机同样否决:手机 transcript 增长粒度是「2s 一拍整段 turn」,没有逐字流,动画无数据基础。

**否决:增量 suffix 拼接解析**(客户端缓存旧尾窗、只 parse 追加后缀)。省的是一次几百行 JSON.parse,换来 suffix 断裂/窗口滑动/轮转三套分支;整窗重 parse 只发生在 changed 拍,代价可忽略。

**否决:手机树自建富解析器。** 与「session JSONL 知识留适配层」的仓规方向相悖;本方案根本不需要富解析。

**key 语义:索引 key 保留。** turns 来自 append-only 日志,下标即稳定身份(头注既有约定);仅当窗口超 40 条淘汰头部时旧行下标平移,clamp 展开态重置,与现状「进屏重读」行为一致,接受。

## 改动面

| 文件 | 改动 |
|---|---|
| `src/mobile/TurnsView.tsx` | 工具运行归组折叠 + codemoss 观感样式类名;AskCard/EarlierButton/LiveBlock 结构不动 |
| `src/mobile/sessionHooks.ts` | 新增 `useLiveTurns`(初始 loadTranscript + 2s 轮询生长),SessionScreen 换用 |
| `src/mobile/sessionFile.ts` | 补增量拍原语(复用 `loadTranscriptAt` 解析路径) |
| `src/mobile/mobile.css` | `.tr` 区样式重皮 |
| `src/kernel/locales/{en,ja}/mobile.ts` | 加「工具调用 {n} 次」「展开」等键 |

客户端(app-shell/plugins)与 Rust 零改动;`pnpm check:arch-boundary` 应保持全绿。

## 验证

1. `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;
2. 单测:工具归组折叠(分组正确性/展开交互/空组不渲染)、useLiveTurns 增量拍(mock invoke:unchanged 短路、changed 重解析、shrink 重置);既有 sessionFile/liveText/history/resume 测试不破;
3. 浏览器桩目检:`window.__TMD_SHELL__="mobile"` 强制进手机树 + 桥桩假数据,目检会话屏折叠组与生长、历史屏静态渲染;
4. 收口前 `npx react-doctor@latest -y` 达 100。
