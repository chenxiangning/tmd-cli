# 手机截图注入(远程驾驶输入侧补齐)

> 日期:2026-09-26 · 状态:已落地(真机目检待大仙)
> 上游:能力盘点 `docs/research/client-capability-gap-analysis.md`(P1-8 末条;「远程贴截图痛苦」是 Termius 类方案死穴,中普遍度)

## 目标

手机远程驾驶时把截图/照片喂给 CLI:会话屏 composer 加「图」钮 → 拍照/相册 → 端内压缩 → 桥 `fs_write_temp` 落盘会话临时文件 → composer 注入 `@<路径>`(桌面附件同语义)。

## 范围边界

| 面 | 做 | 不做(去向) |
|---|---|---|
| 通道 | 复用桥既有 `fs_write_temp` 镜像(dispatch_fs 已有,零 Rust 改动) | 新 WS 二进制帧(现有 JSON 数组载荷在压缩后量级可接受) |
| 压缩 | 端内 canvas 压缩:长边 ≤1568px / JPEG q0.8 | 原图上传(动辄数 MB × JSON 数组膨胀);PNG 无损 |
| 注入 | composer 追加 `@<路径> ` token,用户自行补指令后发送 | 自动发送(桌面同款:注入后由用户补语境) |
| 入口 | SessionScreen composer 行「图」钮(WebView file input,零原生壳改动) | 原生相机桥接/多图(壳工程后续) |

## 方案取舍

| 决策 | 选定 | 否决与理由 |
|---|---|---|
| 落盘通道 | 桥 fs_write_temp 镜像(桌面 composer 附件同命令) | 新增 dispatch op——命令面双份真相,白名单审计面翻倍 |
| 压缩位置 | 手机端 canvas(发前缩) | 桌面端收后压——WS 载荷先膨胀一倍,中继场景真金流量 |
| 路径注入形态 | `@<路径> ` 文本(桌面 composer @ 触发符同构) | JSON 结构化消息——CLI 只认文本,结构与 TUI 契约冲突 |

## 风险

| 风险 | 对策 |
|---|---|
| JSON 数组载荷量级(压缩后 ~2-8MB 文本) | 压缩先行;内网/中继均可承受;后续如需再上二进制帧 |
| WebView file input 差异(iOS WKWebView 需原生 privacy 描述) | 壳工程 Info.plist 相机/相簿权限描述待真机验证,缺失时退化为纯相册选图 |
| CLI 不支持 @ 图片引用的引擎 | 注入的是路径文本,引擎侧行为与桌面附件一致(不新增兼容面) |

## 验证

- 门禁:前端五闸 + react-doctor 100(无 Rust 改动;shrinkImage 依赖 WebView API,单测面=类型与既有回归)。
- 真机(唯一有效验证):手机会话屏点「图」→ 拍照 → composer 出现 `@路径` → 发送 → CLI 收到图片引用,由大仙真机目检。
