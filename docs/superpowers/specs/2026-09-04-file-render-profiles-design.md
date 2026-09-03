# 文件渲染档案:补齐 codoss 全量文件预览形态

- 日期:2026-09-04
- 状态:已落地

## 背景与目标

文件系统插件此前只有两条渲染路径:md → markdown 预览,其余 → CodeMirror 文本编辑。
Rust 侧 `fs_read_file` 对二进制/超大文件直接报错,表现为「部分文件类型没有被正确渲染」。

对照 codemoss `fileRenderProfile.ts` 的九种渲染形态,缺口共 6 类 + 1 类兜底:
图片 / PDF / 表格(csv・xls・xlsx)/ 文档(doc・docx)/ Dockerfile 结构化 /
shell 结构化 / 二进制识别占位。本次全部复刻进 `src/plugins/files/`(渲染子模块
`render/`),markdown 管线不动(已单独优化)。

## 方案取舍

| 决策点 | 选定方案 | 被否决方案与理由 |
|---|---|---|
| 分派中枢 | 移植 `fileRenderProfile`(render/renderProfile.ts)作为唯一分派依据,扩展名/文件名查表用 Record | 在 FileTabContent 里散写正则:分派规则会被右键菜单、未来 hover 预览重复需要,单一档案可测试、可复用 |
| PDF 数据通道 | 新增 Rust 命令 `read_binary_file_base64`(pdf/xls/xlsx/docx 白名单 + 分档大小闸 32/8/2MB)→ base64 → `getDocument({ data })` | 照抄 codemoss 的 asset:// fetch:受 asset 作用域与 CSP 约束,且每次挂载重复拉取;字节通道可控、可缓存 |
| 字节缓存 | 进程内缓存(路径 → 字节,TTL 60s + 总量 64MB LRU + 在途去重) | 每次挂载重取(codemoss 行为):10MB 级 PDF 切 tab 往返都要走 IPC + base64 解码,浪费明显(用户授权性能重写) |
| docx 消毒 | DOMPurify `USE_PROFILES: { html: true }`(与 codemoss 一致) | 无消毒直插 innerHTML:mammoth 输出理论上可信,但文档来自磁盘任意来源,防线必须有 |
| doc(legacy) | 占位说明 + 引导转换(codemoss 同款,不读盘) | 引入 antiword/textract 类解析:新依赖重、收益低,codemoss 亦未支持 |
| 图片体积信息 | data URL 按 base64 长度推算 | 照抄 codemoss 的 `fetch(imageSrc)`:tmd CSP `connect-src` 不含 `data:`,会被拦 |
| code/markdown 预算降级 | 不引入(codemoss 的 low-cost preview);仅结构化预览内部保留 120KB/3000 行解析上限 | 给 code 也加 200KB 降级:tmd 文本读取侧 Rust 已有 512KB 硬闸,再降级会牺牲现有可编辑性且收益重复;md 管线明确不动 |
| 大纲侧栏 | 复用 markdown/PreviewOutlineSidebar,F-bounded 泛型化(纯类型改造) | 在 render/ 复制一份侧栏:同一 UI 两套实现违反单一约定;直接扩 outline.ts 的 target 联合类型会波及 markdown 消费方(3 处窄化改写) |
| 重库打包 | pdf.js・xlsx・mammoth・结构化预览(Prism)全部 lazy chunk,主包零增量 | 静态引入:主包 +1.2MB 级,违背仓库按需拆包纪律 |
| 新依赖 | pdfjs-dist ^5.6 / xlsx ^0.18.5 / mammoth ^1.12 / dompurify ^3.3(与 codemoss 同源同版位) | 自研解析:PDF/OOXML 格式复杂度远超收益 |

## 验证

- `pnpm typecheck && pnpm test`(80 文件 702 用例,含新增 render/* 5 个测试文件:
  分派契约 / 文档快照 / PDF 大纲 mock / 结构化解析与超预算回退 / base64 解码与缓存)
  `&& pnpm check:arch-boundary && pnpm check:file-size && pnpm build` 全绿;
  构建产物确认 FilePdfPreview(413KB)/xlsx(424KB)独立懒 chunk。
- `cargo test`(98 用例,含 read_binary_file_base64 白名单与大小闸、MIME 全集、
  分档上限)通过;clippy/fmt 见交付说明(用户并行 WIP 的 git 历史图文件存在
  未接线 dead code,非本次改动引入)。
- 真机冒烟:`pnpm tauri:dev` 启动无错,图片/PDF/csv/docx/Dockerfile/sh/zip
  各开一 tab 目检形态与二进制占位按钮(见交付回复)。
