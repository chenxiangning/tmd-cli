# 意图画布 excalidraw 导入 · 提交收口评审

- 日期:2026-10-24
- 状态:已收口(P1/P2 当轮修)
- 对象:b3622726「feat(files): excalidraw 文件右键导入意图画布,深链直达编辑器」(15 文件 +252/-10)
- 方式:reviewer 子代理只读评审(深链竞态/坏文件/远程树暴露/工作区时序/i18n/seedScene 六维)+ 主会话核实

## P1(当轮修)· tab 重挂载重放导入 = 静默复制画布

- 链条:intent-canvas tab 非 keepAlive(`EditorCenter.tsx` 切走即卸载)→ 重挂后
  `useCanvasDocs` 的去重 ref 重建 → 同一深链 payload 重放 `importCanvas` → 再建一张同名画布落盘。canvasId 打开路径重放只是良性重开,import 路径是数据增殖。
- 修复:`excalidrawFileImport.ts` 新增 `claimImportRequestId`(模块级跨重挂去重,容量上限 501 清空),`importCanvas` 消费前 claim;只拦 import 路径,canvasId 重开不受影响。再次导入同一文件 = 再右键(新 requestId)照常放行。

## P2(当轮修)· 「512KB 读闸」声明失实,导入可全量读 100MB

- 实况:`fs_read_file` 预览闸是 100MB(`fs_preview.rs:7 MAX_PREVIEW_BYTES`),原注释「512KB 读闸自然封顶」不存在;带内嵌图的 .excalidraw 可达数十 MB,读入+parse 后才被写侧 496KB 闸拒。
- 修复:`importExcalidrawFile` 加前端 512KB 闸早拒(`aiDraw.ts:57` 同款;496KB 写闸的存储对齐值),注释与测试名同步修正;新键三语齐。既有 `documents.ts:76`/`indexWrite.ts:10` 同款失实注释系历史遗留,记档不改(涉及当年写闸对齐设计叙述)。

## P3(记档)

1. 深链导入无脏稿保护:`refresh:true` 换 payload 会替换编辑器中未保存草稿——`openIntentCanvasBacklink` 既有 refresh 语义,import 继承之,非本次引入。
2. 深链 requestId 用 `Date.now()`:同毫秒双击理论同 id(与反链先例同款),实际首击即关菜单不可达。

## 查过无问题

- 深链消费竞态:同 requestId add-before-async(StrictMode 双跑安全);连续两次菜单导入 id 不同 = 两次有意导入;activeWorkspace 为 null 时不标已消费,就绪后补消费。
- 远程/降级树不暴露入口:FileTreeContextMenu 仅 FileTreeOverlays 消费,Overlays 仅本机两棵树挂载;FileTreeRemoteSource 无右键菜单。
- 坏文件:JSON 畸形/根非对象/元素全畸形 → 本地化报错不建空画布;files base64 透传受写闸兜底。
- activeWorkspace 时序:importCanvas/saveDocument 同一消费闭包;Manager 切 root 清 activeDocument,无跨桶写。
- i18n:新键 en/ja 双语齐(files 菜单键 + 导入文案 6 键);zh 恒等。
- seedScene 信任边界:唯一生产方 importCanvas 已消毒;aiDrawImport 走独立工厂不投喂;注释在案。
- 分层:files 零 import intent-canvas(kernel tabs 深链);触及文件均 <300 行。

## 验证

- `vitest src/plugins/intent-canvas/`:77/77(含新增跨重挂去重 2 例、512KB 闸 1 例)。
- `pnpm check:gate` 全链绿(i18n 缺键 0,588 test files,build 过);react-doctor 100/100。
- 功能目检(提交 b3622726 前已做):右键导入 → 编辑器直达 → 落库 3 元素 + 来源回链(截图)。

## 收口

- 修复提交:`fix(intent-canvas): 导入深链跨重挂去重,前端 512KB 闸早拒`(本文件同批)。
