# 19 - proc_stream 长驻流式原语与结构化会话

- 日期:2026-10-01
- 状态:已落地(structured-session 插件 + session-viewer 转录浮层双消费;设计 spec:docs/superpowers/specs/2026-09-30-structured-session-rpc-design.md)

## 背景

活会话的 token 级结构化流(思考/正文/工具调用 delta)在 PTY 会话里不存在任何数据源:第二进程 `--resume` 同会话挂旁收 0 实时帧(2026-09-30 实证),磁盘 JSONL 亦无 delta(全类型 census)——**观察者不成立**,结构化流必须自带子进程。omp/pi 18.x 提供 `--mode rpc` NDJSON 模式,内核只补一条通用长驻流式通道,帧语义全归插件侧。

## 原语契约(src-tauri/src/proc_stream.rs)

- 命令面四:`proc_stream_spawn(spec) → 流 id` / `proc_stream_write(id, data)` / `proc_stream_kill(id)` / `proc_stream_kill_all()`;`ipc.ts` 暴露 `procStream*` 并登记 `pluginPermissions`(新 ipc 方法必须登记的纪律)。spec = command/args/cwd/env,命令解析/PATH 富化/隐藏控制台窗与 proc_run 同律。
- 事件线:`proc://stream/{id}/out|err|exit` 经 event_sink 单源扇出(桌面 webview 与 Web 桥同收,`pty://out` 同纪律)。out/err 载荷 = 一行文本(单行上限 4MB,超长截断防无界缓冲);exit 载荷 = `code|null`(超时杀树/信号死均落 null)。
- 生命周期:registry 持 child(id = `proc-N` 单调);两 reader 线程 EOF 后由后到者 `wait_child_with_timeout`(2s 收割宽限,超时杀树兜底;proc_run EOF 竞态同修法)自然收割再发 exit——kill 与自然退出共用单一出口,退出码语义一致。kill 走 kill_tree(Windows npm shim 杀整树)。webview reload 后前端失忆,boot 期 `kill_all` 清孤儿(仅桌面分支执行;web 桥命令白名单不含 proc_stream_*,手机不可触达)。
- **内核不懂任何 CLI 协议**:本模块只有「跑一个进程、按行推流、可写可杀」语义,NDJSON RPC 帧语义归消费插件。

## structuredRpc 声明制(kernel/cliProfile.ts)

`CliProfile.structuredRpc?: { command }` 声明 CLI 具备 `--mode rpc` 能力(现 cli-omp/cli-pi 双声明);缺省 = 无,structured-session 入口不出现。新增 RPC 引擎的理论改动面 = 既有 cli-* 插件一行声明(或新插件目录 + `allPlugins` 一行),Rust/内核零改动。

帧语义沉淀 cli-shared(缝隙层准入:cli-omp/cli-pi 的 structuredRpc 声明 + structured-session feature 联合消费):

- `piRpc.ts`:spawn RPC 子进程、请求多路复用、审批回路(`extension_ui_request{method:"confirm"}` → `extension_ui_response{id, confirmed|cancelled}`);spawn 未决期被废弃即收割,防孤儿进程。
- `piRpcReducer.ts`:流内 `live:` 前缀块 delta 原地累积,`message_end` 落与磁盘 JSONL 同构的权威块;缺 message_end 时 freezeLive 兜底;全帧字段守卫,老版本帧缺字段安全降级。

## 挂点语义(kernel/plugin.ts)

- `editorCenter.canvasOverlay`:幕布画布浮层(画布绝对定位层,幕布保活之上的覆盖 UI,非平铺形态)。先例:session-viewer 活会话转录视图(幕布|转录双视图,1s 尺寸探测短路轮询 + 变更即重读;已知天花板:8MB+ 转录每秒重读约百毫秒主线程,文件头 ponytail 注明)。
- `terminal.canvasRow`:幕布右上工具行,内核渲染行容器 + 幕布刷新钮收尾最右,插件贡献同排工具钮(先例:结构化幕布切换钮);行不设 z,不透明画布浮层开启时整行隐没(详 17)。

## 消费方

- **structured-session 插件**:中央 tab,自带输入面(composer 直发 RPC prompt),PTY 零涉及;unmount 即 kill 子进程;启动失败收割残留进程并进可重试错误态;cwd 取激活工作区。
- **session-viewer 转录浮层**:幕布|转录双视图切换,读 PTY 会话的磁盘转录(与 RPC 流互不相干,借道 canvasOverlay 挂点)。

## 方案取舍

- 被否决:PTY 会话旁路解析(观察者不成立,见背景);磁盘 JSONL 轮询(无 delta,token 级流不存在)。
- 结构化流不并入 PTY 泵合批(不同通道):proc_stream 逐行即发,渲染合帧节奏属消费方职责。

## 验证

proc_stream_tests.rs / piRpcReducer.test.ts / liveOverlay.test.ts 钉原语与 reducer 契约;门禁:cargo test + clippy -D warnings / typecheck + vitest + arch-boundary + file-size + build。
