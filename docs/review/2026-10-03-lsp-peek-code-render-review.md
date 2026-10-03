# LSP 弹窗 code 渲染提交收口复审(提交纯净性 / 门禁序 / 运行链路取证)

日期:2026-10-03
状态:已完成(实锤 1 修随本提交;留观 3 条)

## 背景与目标

`55bef64f`(feat(lsp): 引用 peek 与 hover 代码渲染打磨)提交后,按 AGENTS.md「验证(交付前必跑)」
与「提交收口铁则」对**收口过程本身**做对抗复审:提交纯净性、门禁执行序与证据留存、目检挂账形态。

## 核实通过项(逐条取证)

| # | 检查 | 结论 | 证据 |
|---|---|---|---|
| 1 | 提交纯净性 | 11 文件全属本次改动;用户并行 WIP(`web_access.rs`、`docs/design/mobile-home-polish-*.html`)**未混入** | `git show --stat 55bef64f` |
| 2 | 门禁序 | typecheck → test(457F/3564T)→ arch-boundary → file-size → build 全绿 → react-doctor → 提交,顺序合规 | 会话执行序列;react-doctor 复跑 `Score: 100 / 100` |
| 3 | 提交信息 | `feat(lsp):` 一句祈使句,spec+code 同 commit 有 13355eec 先例 | git log |
| 4 | 文档落盘 | spec 落 `docs/superpowers/specs/` 四段齐全 + 索引登记;无自造目录 | 铁律比对 |
| 5 | 运行链路 | **已开 dev 窗口(vite:1421,21:26 起)实证吃到新代码**:服务端 transform 产物 grep 到 `peekWidget.ts` 含 `wrapSymRange`(×2)、`lsp-code.css` 含 `tmd-syntax` —— 热更不是假设 | `curl 127.0.0.1:1421/src/plugins/lsp/*` |
| 6 | hover 作用域 | hover 容器 `dom.className = "lsp-hover"`(cmLsp.ts:263),与 lsp-code.css 作用域匹配 | grep |

## 实锤(1,当场修)

1. **索引状态行漏目检挂账**:写「已实施」,漏仓库先例后缀(262 行先例:「已实施(真机目检留大仙)」)。
   本改动是 UI 行为改动,AGENTS.md 要求真实窗口目检,目检载体是用户既有窗口、尚未确认回执。
   修:状态改「已实施(窗口目检留大仙)」。

过程注:收口期起过一次 `pnpm tauri:dev`,撞 `strictPort`(1421 被既有实例占用)exit 1;实际目检
载体等价落在既有 dev 窗口(见核实 #5,新代码已入其热更链),不再另起实例。

## 留观(3,不阻收口)

1. **react-doctor 工作树口径**:铁则未约定扫描范围,本次对含用户 WIP 的整工作树跑(100 分只证明
   工作树整体达标);若用户 WIP 携违规会误伤归因。后续可考虑「先 add 分清、后跑分」的口径,或明确
   工作树口径写入铁则。
2. **预览截断缝符号**:peek 预览 >500 字符截断后,符号区间骑缝时会包到半个符号(视觉小瑕疵;
   旧三段拼接实现同病,非本回归)。
3. **分支未推**:`Tmd-0.2.9` 本地领先 1 提交,push 由用户定。

## 验证

- 本复审为文档 + 索引状态词一改,无代码变更;提交前复跑 react-doctor 达 100。
