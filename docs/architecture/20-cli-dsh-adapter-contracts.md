# 20 - cli-dsh 契约:幕布钉底光标纪律 / 会话身份与删除闸 / host 探针

- 日期:2026-10-02
- 状态:生效中(改 cli-dsh 适配器渲染、侧栏会话列表、host 面板前必读)
- 相关:docs/superpowers/specs/2026-09-07-cli-dsh-pty-adapter-design.md(PTY 适配器一期)

## 背景

2026-10-02 用户报「本地 DSH 客户端生成的 session 在 tmd-cli 里打不开」+「dsh 对话实时幕布渲染损坏,重开也损坏」。实测定位到三条独立根因(全部有真实字节流/无头 xterm/真 host 复现):

1. **幕布底栏丢内容光标**:适配器 `dsh-stream` 的 `paint()` 在设滚动区(DECSTBM)之后再存一次光标,而 DECSTBM 会把光标搬到 home,最外层 `\x1b8` 因此还原到 home 而不是内容光标 —— 此后所有正文从第 1 行开始写,覆盖历史头部并把整屏搅乱。坏字节同时被 PTY 日志录下,重开会话原样复现,所以「实时」与「重开」是同一根因的两个面。
2. **子代理会话进了侧栏**:`session/list` 返回的子代理子会话(`origin:"subagent"` / 带 `parentSessionId`)生命周期归 DSH 的 subagent routing,`session/create` 必以 `session/agent-busy`("owned by subagent routing")拒绝。本机 tmd-cli 工作区 90 条里 75 条是这类会话,点开即适配器硬崩 → 侧栏留下一批死行。
3. **host 探针的 401 判据在真机上不可达**:DSH 的 401/403 响应体是纯文本(`unauthorized` / `forbidden`),而 `quota_fetch` 未声明 `text` 时对 body 做 JSON 解析,失败即 Err → invoke reject → 探针 catch 把「host 活着但拒凭据」归一成「没起来」,于是面板反复 spawn 一个必然 EADDRINUSE 的第二实例并白等 24s。单测用 mock 绕过了 Rust 解析,所以长期绿。

## 契约一:幕布底栏的光标纪律(dsh-stream)

- **存还原必须与设区同层**:存一次 →(设区 + 绝对寻址 + 擦写)→ 还一次。任何时候都不得嵌套 `\x1b7`。
- **`arm()` 先于任何内容**:适配器启动、还没写任何字节时就把滚动区钉到 `1..n-1`;此后内容光标由终端保证留在区内(区内写满即区内滚动),存还原永远回到合法位置。等正文铺满整屏才首次设区,内容光标会停在底栏行(实测还原到 (5,0) 后写字符落在底栏行),底栏与正文互相覆盖。
- **底栏写一律关自动换行**(`\x1b[?7l` … `\x1b[?7h`)+ `fitWidth` 双保险:PTY 列数与幕布真实列数在拖拽/隐藏期可能短暂不一致(实测日志出现 1/17 列钳制),开换行会把底栏折到下一行并滚动整个滚动区 = 残段刷屏,同样被日志录下来重开复现。
- **`reset()` 也要包存还原**:`\x1b[0r` 复位 region 同样会搬光标到 home,退出后复用幕布的下一条输出会覆盖历史首行。
- 交互区(`dsh-zone`)擦除优先「CPR 取当前光标行 → 绝对 CUP+EL」,相对上移在 resize/重排后行号失效会留半截;CPR 超时(400ms)必须立即清点击区,否则点新块的行会执行上一轮回调。绘制走串行队列,show/hide 交错不会擦一半画一半。
- 回归网:`dsh-stream.test.ts` 用 `@xterm/xterm` 无头终端(不 `open()`,只 write/resize/buffer)断言「底栏重画不吞内容光标」「谎报列数不折行」;纯字节断言看不见这类缺陷。

## 契约二:会话身份、采用分流与删除闸(dshRpc / dshSessionStore / dsh-session)

### 采用分流(2026-10-02 二轮:writer-held)

DSH 的 `session/create`(显式 id)对**活 agent 是幂等采用**(同一会话直接复用,
实测第二个客户端可立即写入 —— DeepSeek 客户端「正开着的对话」属于此类,
tmd-cli 直接打开即可续聊);`session/writer-held`("already owned by an active
write handle")只出现在**无活 agent 但写句柄仍被占**的窗口:另一客户端的
create 正在打开同一会话(并发开窗),或客户端长期占着附着会话。适配器
(dsh-session.cjs)按三层处理:

1. 首次成功 → 写者模式;
2. `writer-held` → 重试 3 次 × 1.5s(盖住并发开窗,之后幂等采用);
3. 重试耗尽 → **读者模式**:不新建,直接以请求的 id 走 `session/follow` 只读
   打开(历史 + 实时输出照常渲染),发送/切模型/取消在输入口拦下并说明原因,
   幕布提示「关闭占用方后重开即可续接」。

旧实现在这里统一「回落新建会话」:点开会话 X 得到空白会话 Y,正是
「app 生成的 session 打不开」的观感;更早的实现则直接硬崩。

### 列表与删除

- **列表只列可接管会话**(采用分流见上节):`origin === "subagent"` 或 `parentSessionId` 非空的一律不列(与 DSH 自己的 Web UI 工作区列表同一判据),否则侧栏出现点开即崩的死行。
- **会话盘目录名 === header.id === sessionId**(2026-10-02 全库 350 条实测,0 例外);244 条 id 本身就带 `session-` 前缀,所以既不能剥前缀也不能无脑加前缀。`dshSessionStore` 是目录名/文件名判据的唯一出处(删除与转录共用),历史 `session-<id>` 写法仅作兼容候选。
- **cwd 过滤先原串比(分隔符/尾斜杠归一),一条都不中才用 host 的 `workspace/create` 返回 canon path 比一次**:工作区 root 是符号链接时 DSH 存 realpath,直比会让整片历史静默消失。
- **删除前查活会话**:`session/list` 报 `running` / `agentAvailable` 即抛错拒绝删盘 —— DSH 每次 durable append 都按路径 `open("a")`,目录被整树删掉后下一次写直接 ENOENT、历史不可恢复。调用方 `removeDiskSessionBestEffort` 的契约是「钩子失败 → 只在 tmd-cli 侧隐藏,tombstone 照常生效,磁盘数据保留」,所以抛错是安全收口。删除还要校验目录里确有 `session[.vN].jsonl.zstd`。
- `CliDiskSession.path` = 磁盘路径;DSH 无单文件路径,置空串(消费方按缺失跳过),不得塞伪 URL。

## 契约三:host 探针与面板(dshHost / hostPanel)

- **探针必须 `text: true`**:401/403 是纯文本错误体,不声明会被 Rust 侧 JSON 解析拒掉,「host 活着但缺凭据 → 停监听换代自启」整条链失效。声明后自行 `JSON.parse`,并区分 401(缺凭据)/403(Host/Origin 栅栏)。
- 非本机 origin 不代 spawn 也不代杀;`0.0.0.0`/`::` 是 DSH 启动期直接拒绝的监听地址(`isWildcardBindHost`),不代拉起并给专门文案。
- 自拉起 host 会话按**多槽**登记(换端口再启动不得漏掉上一代进程);凭据(new cookie / launch token)按 origin 校验后才落盘,回读也只在同 origin 时兜底。
- 面板 pending 分动作给文案(start/stop/check);`connected` 优先于 `binFound`(host 连着就不报「未安装」,「重新检测」常驻);`refresh(target?)` 接受目标连接,禁止用旧闭包探测;远程「停止服务」只提示不重探(重探会在同一批更新里 `setError(null)` 吞掉提示)。
- 侧栏扫盘的补扫判据是「有在途启动」(`hostStartInFlight`),不是 `conn.autoStart`:host 被用户停掉后按 autoStart 判会每次白等一轮 24s。

## 验证

- `pnpm typecheck && pnpm test`(cli-dsh 16 文件 138 用例,含 xterm 无头语义断言与注入式 CPR/擦除断言)。
- 真 host 端到端:隔离 `DSH_HOME` + 伪装 TTY 尺寸跑真适配器,把捕获的字节流在无头 xterm 按多种尺寸回放,确认无残段/无覆盖(2026-10-02 实测:修复后 100x30 / 60x20 / 88x26 / 70x18 四种尺寸回放画面干净;修复前同一手法复现旧日志的 `[DSH] Mux 已连接ost...` 覆盖)。
