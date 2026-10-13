# tmd-anim 立项拍板与 M0 交付记录

- 日期: 2026-10-13
- 状态: 已拍板并落地 M0
- 前置: [技术动画视频制作工具调研](../research/tech-animation-video-tool.md)

## 拍板结论

用户当日拍板,三点:

1. **形态: 独立新项目**,不进 tmd-cli 插件体系(采纳调研推荐;理由见调研文档第五节)。
2. **命名: `tmd-anim`**,与 `tmd-cli` 同构(两音节后缀),短、好打、含义直白。
3. **位置: `~/code/AI/github/tmd-anim`**,tmd-cli 平级;技术栈与 tmd-cli 完全同源
   (React 19 + TS strict + Tailwind 4 + Vite 8 + Tauri 2,依赖版本逐一镜像),复用本地 pnpm store 与 cargo 缓存。

## M0 交付(当日完成)

范围 = 调研文档第六节的 M0 闭环验证:场景 JSON v1 契约 + Canvas 2D 纯函数渲染器 + 播放器 + 示例项目。

- 数据模型(`src/core/`): types / timeline(场景拼接与缓动)/ highlight(高亮短语切分)/ wrap(贪心折行)/ normalize(宽容归一化,agent 半成品也能播)。
- 渲染器(`src/core/render/`): `drawFrame(ctx, project, t)` 纯函数,10 种元素(标题芯片/正文/输入框/代码块/表格/便签/徽章/色块数组/连线/图片)x 5 种入场动画;预览与将来导出唯一路径。
- 播放器(`src/app/`): rAF 循环播放、进度擦洗、场景跳转、键盘(空格/左右键)、拖拽与文件打开 JSON、错误中文提示。
- 示例项目 `src/samples/bpe.json`: 四场景 BPE 分词演示,同时是 schema 活例。
- 桌面壳 `src-tauri/`: Tauri 2 最小壳 + 零依赖脚本生成的全套图标(`pnpm tauri icon` 派生 icns/ico)。
- 契约文档 `docs/schema.md`: agent 协议权威文档;新仓自带精简 `AGENTS.md`(沿用 300 行铁则/中文半角/提交格式)。

## 验证记录

- `pnpm check` 全绿: 26 单测 / typecheck / build(241KB js, 76KB gzip, 渲染核心零运行时依赖);最大文件 160 行,300 行铁则全过。
- `cargo check` 通过(45.7s)。
- 浏览器实开目检(http://localhost:1431): 场景 1 全要素(标题芯片/输入框/7 色块/三徽章/脚注)、场景 2(色块数组自定义色 + 徽章)、场景 3(深色表头斑马纹表格)渲染全部符合预期,与参考视频白板风一致。
- 目检发现并修复 1 项: body 未设背景色,深色系统下播放器 padding 区漏黑边(styles.css 显式浅色底 + color-scheme)。
- 已知测试环境坑(记录备查): 60fps rAF 重渲染会让 Playwright actionability 检查超时,自动化目检需先暂停播放再定位。

## 未做(留给下一轮)

- 未 git commit(工作树留用户检查)。
- M1 编辑器(画布交互/属性面板/时间轴拖拽/多场景管理)未启动。
- WKWebView VideoEncoder(avc)PoC、Mediabunny 导出管线属 M2。
