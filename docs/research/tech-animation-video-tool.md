# 技术动画视频制作工具调研

- 日期: 2026-10-13
- 状态: 已完成(已拍板采纳推荐:独立项目,命名 tmd-anim,M0 当日落地;记录见 brainstorm/2026-10-13-tmd-anim-kickoff.md)
- 需求来源: 视频号「神秘的鱼仔」用 ZCode 生成的「技术动画视频制作站」(全栈 web 应用);用户想做一个同类工具,核心待决问题 = 怎么做、以什么形态做(独立项目 or tmd-cli 插件)
- 素材: 视频号分享页(外部无法抓取,以 8 张截图为准)+ 本仓库代码实证 + 外部方案许可证/兼容性核查

## 结论(先行)

1. **形态: 独立新项目,不进 tmd-cli 插件体系。** 决定性理由不是「插件做不到」(技术上完全做得到),而是:(a) 领域正交——它与 tmd-cli 的内核能力(会话/PTY/git/工作台数据)零交集,44 个插件里没有任何一个能给它省事;(b) 导出视频这类工具的常态需求(音频混流/GIF/转码)迟早要 ffmpeg,在 tmd-cli 里意味着动 Rust + 打包 externalBin,违背本仓「新增能力 Rust 零改动」的既定文化,且全仓至今无 sidecar 先例;(c) 创意工具需要快节奏试错,tmd-cli 的全量门禁 + 文档登记纪律会变成持续摩擦。保留反悔路径: 核心做成无 UI 的纯 TS 包(schema + 渲染器 + 时间轴引擎),将来真想进 tmd-cli 再写薄插件嵌入,损耗很小;反向拆出去则成本高得多。
2. **技术路线: 自建「场景 JSON + Canvas 2D 纯函数渲染器」核心,导出用 Mediabunny(WebCodecs)在浏览器内确定性逐帧编码 mp4,不基于 Remotion / Motion Canvas 二次开发。** 理由: 现成框架解决的是「用代码写动画」,本工具要解决的是「GUI 编排 + agent 可写数据格式 + 确定性导出」,三者都没有现成开源方案同时满足;而元素集是有限的 11 种静态排版 + 入场动画,自建渲染器工作量可控。
3. **AI 工作流是差异化所在,且不依赖工具住在哪里**: 视频里的核心玩法 = agent 写文件 → 工具热加载预览。靠「项目目录 + JSON schema 文档 + 校验 CLI」的文件契约即可达成,ZCode / Claude Code / omp 任何 agent 都能写,不需要与工具同 app。
4. 技术栈建议与 tmd-cli 完全同源(Tauri 2 + React 19 + TS strict + Tailwind 4 + Vite),零学习成本。

## 一、目标形态拆解(视频截图盘点)

视频里的工具是一个全栈 web 应用,由 ZCode 按一段 Goal 描述一次生成,共两个页面:

**页面 1 项目主页**: 项目卡片网格(封面缩略图 + 名称 + 更新时间),右上「新建项目」。

**页面 2 动画编辑器**,四区布局:

| 区 | 内容 |
|---|---|
| 顶栏 | 返回主页 / 项目名(行内编辑)/ 已保存·未保存状态 / 预览 / 导出视频 |
| 左栏 元素库 | 标题、正文、代码块、表格、输入框、便签、徽章、连线、图片、艺术字、数组格(共 11 种) |
| 中央 画布 | 16:9 浅色画布;元素单选(控制点)、拖拽、双击改文案 |
| 右栏 属性面板 | 风格(扁平/手绘)、文本、关键词高亮(逗号分隔)、字号、颜色、底色、动画类型(弹出/高亮/…) |
| 底部 时间线 + 场景 | 每元素一行色块,拖块调开始时间、拖边缘调时长;场景条(场景 N · 时长 · 元素数 · 停留 N 秒 · 复制/删除/新建场景) |

内容风格: 技术讲解白板动画(BPE 分词、token 拆解、三次握手等),关键词高亮 + 色块数组 + 分步骤卡片是高频构件。AI 玩法: 在 ZCode 里描述「在 AI 动画站中生成一个新的动画,内容是三次握手四次挥手的执行过程」,agent 直接产出动画数据。

## 二、竞品与现成方案盘点

| 方案 | 形态 | 许可 | 与目标的差距 |
|---|---|---|---|
| Remotion | React 组件即视频(代码优先) | 个人与 ≤3 人公司免费;更大公司需 Company License(约 $100/月起) | 无 GUI 时间轴;渲染主路径 Node + 无头 Chrome(新出 WebCodecs 浏览器内渲染);在其上自建 GUI 编辑器等于双份工作 |
| Motion Canvas | TS generator 编排动画 + 自带实时预览编辑器 | MIT | 编辑器是独立 Vite 应用,不作为可嵌入库设计;代码优先,无项目管理 GUI |
| Revideo | Motion Canvas 的「做编辑器用的库」化 fork | MIT | 定位最接近「自建编辑器的底座」,但尚早期、社区小、渲染走 Node + ffmpeg,浏览器内链路弱 |
| Manim | Python 数学动画(代码优先) | MIT | 纯代码无 GUI;风格是数学演算非白板讲解;不适合 agent GUI 工具 |
| Jitter / Rive / Canva / 剪映 | 闭源 SaaS / 商业 | - | GUI 强,但无代码/agent 工作流,动效设计向而非技术讲解向,数据不可自持 |
| 视频里的工具 | 自研 web 全栈应用 | 未公开 | 形态最接近;导出管线与数据模型未知,我们要做的正是同类桌面版 + 更硬的确定性导出 |

**判断**: 「GUI 时间轴 + 技术讲解元素库 + agent 可写格式 + 确定性 mp4 导出」四件事没有现成开源方案同时满足。四件事里真正难且值得自建的只有「渲染器 + 数据模型」(11 种元素的静态排版 + 入场动画,均为确定性绘制);导出、编码、封装都有成熟现成件(见下节)。因此自建核心、不背框架,是工作量与可控性的最优交点。

## 三、关键技术事实(已核查)

**导出链路(浏览器内确定性逐帧编码,本调研的核心可行性结论)**:

- [Mediabunny](https://github.com/Vanilagy/mediabunny): 纯 TS、零依赖、MPL-2.0(闭源商用可用),7.2k 星;读写 MP4/WebM/MOV/MKV 等,内置 25+ 编解码(经 WebCodecs 硬件加速),`CanvasSource` 直接吃 canvas 元素,tree-shakable(最小 5kB gzip)。Remotion 与 Screen Studio 是它的金牌赞助商——说明这正是当前「浏览器内出视频」的主流底座。`CanvasSource + Mp4OutputFormat + BufferTarget` 逐帧喂 canvas 即得 mp4 buffer。
- WebCodecs 兼容性(caniuse 实证): Safari/WKWebView 16.4–18.x 为「Video-only 支持」(VideoEncoder 可用,正是本工具所需),Safari 26 起全量;Chromium 系(含 Windows Tauri 的 WebView2)94 起全量。macOS Tauri 用 WKWebView,视频编码链路通;**音频编码在老 WKWebView 缺位,MVP 做无声 mp4,配音后置**(见风险节)。
- 降级路线: MediaRecorder + canvas.captureStream 实时录制 webm(所有浏览器可用,但实时录制会丢帧、不可确定性重放),仅作环境不支持时的 fallback。
- 后置路线: ffmpeg sidecar(Rust 有现成 [ffmpeg-sidecar](https://github.com/nathanbabcock/ffmpeg-sidecar) crate,支持自动下载二进制),留到需要音频混流/GIF/高分辨率转码时再上——独立仓库里加它零阻力。
- 性能量级: 1080p30 一分钟 = 1800 帧,Canvas 2D 每帧绘制十几个元素在毫秒级,WebCodecs 走硬件编码,整片导出预计秒级到一分钟内。

**tmd-cli 仓库现状(代码实证,两轮 Explore 核对)**:

- 插件注册面(`src/kernel/plugin.ts`): `registerTabContent`(中央 tab,支持 keepAlive/beforeClose)、`registerSidebarAction`、`registerSettingsSection`、`registerFilePanel`、`registerCommand` + 17 个 contribute 挂点。重量级 UI 有正门,且有先例: workbench 150 文件约 2 万行,intent-canvas 67 文件约 9300 行(消费 excalidraw,动态 import)。
- **全仓没有任何视频基础**: src / src-tauri / package.json / Cargo.toml 均无 ffmpeg、MediaRecorder、WebCodecs、多媒体 crate;`tauri.conf.json` 无 `externalBin`,无 sidecar 分发先例。外部进程原语(`procCommunicate` / `procStreamSpawn`)只能跑用户机器上已存在的可执行文件。
- 插件持久化惯例: `~/.tmd-cli/<插件>/` JSON sidecar,经 `ipc.fs*` + `ensureDir`;SQLite 原语在但非 feature 插件惯用。二进制读写有 32MB 闸(base64),对视频文件不友好。
- 门禁: 每笔提交 `check:gate` 全链 + react-doctor 100 + i18n 三语键比对 + 300 行铁则 + 文档登记铁则。

## 四、技术方案建议

### 数据模型(核心资产,按「agent 可写」设计)

单文件自包含 JSON(每项目一个 `project.json`),原则: 纯数据无逻辑、字段可枚举、id 稳定、无隐藏推导依赖(场景时长可由元素推导,但仍显式落盘便于 agent 精确控制):

```json
{
  "version": 1,
  "name": "BPE 训练过程",
  "canvas": { "width": 1920, "height": 1080 },
  "scenes": [{
    "id": "sc-01", "name": "预切分", "dwell": 5,
    "elements": [{
      "id": "el-01", "type": "title",
      "x": 360, "y": 80, "w": 1200, "h": 96,
      "text": "先按规则,把海量文本切成一段一段",
      "highlight": ["切成一段一段"],
      "style": { "fontSize": 56, "color": "#111", "variant": "flat" },
      "anim": { "type": "pop", "start": 0, "duration": 0.8 }
    }]
  }]
}
```

- 元素类型 11 种对齐视频: title / text / code / table / input / note / badge / connector / image / artText / arrayCells。
- 时间模型: 每元素 `anim{type, start, duration}`;场景时长 = 最后元素结束 + `dwell`;全局时间轴 = 场景顺序拼接。不做关键帧曲线——视频工具实际也是「入场动画 + 出现时刻 + 时长」模型,加曲线是过度设计。
- 配套: JSON schema 文档(供 agent 读)+ 校验 CLI(`validate` 检查引用完整性/越界/类型)+ 示例项目库。**这套文件契约就是 agent API,是整个工具的差异化。**

### 渲染: Canvas 2D 单实现,预览与导出同一路径

- `drawScene(ctx, project, sceneIndex, t)` 纯函数: 预览 = rAF 推 t 调它;导出 = t 从 0 步进到片长调它。单一实现保证「所见即所得的导出」,杜绝双渲染路径漂移。
- 文本折行 `measureText` + 贪心折行自绘(元素文案都是短句,工作量可控);表格手绘线格;代码块经 prismjs token 化后逐段着色绘制;手绘风格变体后置(rough.js 可加)。
- 编辑器交互(选中/拖拽/8 向缩放/对齐吸附)用画布上的 DOM overlay + 命中测试,与渲染层解耦。
- **否决 DOM/CSS 渲染方案**: DOM 无法确定性逐帧光栅化(html2canvas 类方案字体/样式还原不可靠),导出会被迫走第二条渲染路径——这正是此类工具最常见的架构陷阱。
- **否决 konva/fabric/excalidraw 底座**: 元素全是自定义排版,场景图库省不掉该手写的部分,反多一层抽象;excalidraw 是白板语义,无时间轴动画模型。

### 导出管线(三路线)

| 路线 | 做法 | 取舍 |
|---|---|---|
| A(推荐) | 离屏 canvas 逐帧 → Mediabunny(CanvasSource + avc)→ mp4 落盘 | 确定性、硬件加速、零外部依赖;MVP 无声 |
| B(降级) | MediaRecorder 实时录 webm | 实现最简,丢帧不可控,画质不稳 |
| C(后置) | ffmpeg sidecar | 音频混流/GIF/转码时再上;独立仓库加它零阻力 |

### AI 生成工作流(差异化主线)

1. 应用监听项目目录,mtime 变更即热重载(watch 模式)。
2. agent 侧交付物 = schema 文档 + 示例库 + 校验 CLI;任何 agent 改完 JSON 跑一遍 `validate` 即可自检。
3. 可选 M3: 截图 CLI(渲染指定时刻为 png),让 agent 能「看到」自己的产出形成闭环;更进一步可包一层 MCP server。

## 五、形态决策: 独立项目 vs tmd-cli 插件

| 维度 | 独立项目(推荐) | tmd-cli 插件 |
|---|---|---|
| kernel 复用 | 需自建壳层(Tauri 模板起步,1-2 天) | 白拿 tab/keepAlive、ipc.fs、settings、i18n、快捷键 |
| 领域匹配 | 内容创作垂直,自成一体 | 与 44 插件的服务域(AI CLI 工作台)零交集,kernel 无准入价值 |
| 导出纵深 | WebCodecs 起步,ffmpeg sidecar 随时可加 | WebCodecs 可行,但 ffmpeg = 动 Rust + externalBin 打包,违背本仓零改动文化,且无 sidecar 先例 |
| 依赖与包体积 | 自持(mediabunny 仅几 KB gzip) | excalidraw 已在包内,增量其实不大——此项不是决定因素 |
| 迭代节奏 | 自选门禁,创意工具快试错 | 每笔提交全量门禁 + 文档登记,对试错是持续摩擦 |
| 发版 | 独立节奏,互不阻塞 | 动画工具的 bug/依赖与工作台发版耦合 |
| AI 工作流 | 文件契约,任何 agent 可写,天然解耦 | 「在 composer 里让 omp 生成动画」顺一步,但文件契约同样可达 |
| 数据归属 | 项目目录自持(如 `~/anim-studio/projects/`) | 按惯例落 `~/.tmd-cli/`,用户内容与应用生命周期绑定 |
| 反悔成本 | 核心做成纯 TS 包,将来薄插件嵌入即可 | 先进插件再拆出,成本高得多 |

**结论: 独立项目。** 两条诚实的反向条件——出现以下情况应改选插件:(1) 目标缩水为「在工作台里预览 agent 产出的动画」而非完整制作工具;(2) 动画内容与工作台数据强绑定(例如把会话时间线自动变动画)。两者目前都不成立。

## 六、落地路径

- **M0 闭环验证(先跑通 agent 链路)**: schema v1 + Canvas 渲染器 + 播放器(Vite 空壳即可)+ 手写示例项目;同时半天 PoC 验证 WKWebView 上 `VideoEncoder`(avc)真实可用性。验收标准: agent 写 JSON → 应用热加载 → 看得见动画。
- **M1 编辑器**: 画布交互(选中/拖拽/缩放/吸附)、元素增删、属性面板、时间轴拖拽、多场景管理(复制/删除/停留秒数)、自动保存。
- **M2 出片**: Mediabunny 导出 mp4 + 项目主页(卡片列表/封面缩略)。
- **M3 打磨**: AI 工作流文档化(schema + 示例库 + 校验/截图 CLI)、手绘风格变体(rough.js)、音频后置方案(配音走剪映后处理或 ffmpeg mux)。

## 七、风险与开放问题

1. **WKWebView 编码器矩阵**: avc 在当前 macOS WKWebView 的实际可用性需 M0 实测兜底(不可用则先 vp9/webm 或以 Windows WebView2 为先行目标);Safari 26 起全量,风险窗口有限。
2. **中文字体排版**: Canvas 无自动折行,需自绘布局;系统字体(PingFang SC 等)光栅化无授权问题,跨平台一致性可后置思源黑体子集内嵌。
3. **音频缺位**: 老 WKWebView 无 AudioEncoder,MVP 无声;配音/BGM 靠后处理,或 M3 上 ffmpeg。
4. **工作量主体在编辑器交互**(时间轴拖拽/吸附/多选/撤销),渲染与导出反而小;M1 预估是 M0 的 3-4 倍体量,建议 M0 先验证 agent 链路价值再投入。
5. 待拍板: 项目名与仓库名;数据目录位置;是否开源。
