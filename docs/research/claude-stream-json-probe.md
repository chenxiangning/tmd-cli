# claude stream-json 双向流协议探针(C1 调研底稿)

> 探针日:2026-11-06。本机 claude CLI 2.1.282(Bun 原生二进制,`~/.local/bin/claude`)。
> 采集:/tmp/c1-probe/(p1 输出侧/p2a2+p2a3 审批/p2b steering/p2c interrupt/p4c 图片/p5 多轮续发),样本帧 `samples.jsonl`(16 帧)。
> 后端说明:本机 reclaude 代理 device_revoked(401)不可用,探针经 `--settings` 覆盖直连智谱 Anthropic 兼容端点(`open.bigmodel.cn/api/anthropic`,glm-5.3,附 `X-Title` 头)。帧由 claude CLI 本地生成,后端只影响内容不影响协议形态;reclaude 复活后无需重探。

## 结论(判定门三态,供 C2 拍板)

| 判定门 | 结果 | 依据 |
|---|---|---|
| ① 审批回路 | **内建流内审批面不存在(实证)**;MCP prompt-tool 路由未探 | 默认档与 `--permission-mode manual` 档均不产 `control_request/can_use_tool`,审批需求直接 `system:permission_denied` + is_error tool_result(见 §4) |
| ② 输入/握手形态 | **摸清,具备估传输层工作量条件** | §2/§3:长驻进程 + stdin 双向,user/control_request 入,init/assistant/user/system/result 出 |
| ③ 图片输入形态 | **明确:content block base64 直通,后端视觉可达** | p4c:真红图 → 应答「Orange」(GLM 视觉确认) |

C2 拍板要点:能接(②③齐),审批面决定交互档次——**路 A** = 补一次 `--permission-prompt-tool` MCP 探针(约 0.5 人日,confirmCard 走 MCP 应答);**路 B** = 降级「自动批准」形态(`--permission-mode acceptEdits` 仅自动批文件编辑 / `bypassPermissions` 全自动),审批卡隐藏。两路都不阻塞传输层动工(传输层与审批面解耦,answerConfirm 接口位保留)。

## 1. spawn 与会话模型

```
claude -p --output-format stream-json --input-format stream-json --verbose \
  [--resume <sessionId>] [--permission-mode acceptEdits|bypassPermissions|...] \
  [--dangerously-skip-permissions] [--include-partial-messages]
```

- **长驻会话**(P5 实证):进程不死,stdin 持续吃消息;每个 result = 轮界,result 后再发 user 帧即下一轮(同 session_id,「ONE」→「TWO」两轮实证)。与 pi RPC 会话模型同构,pi 的 reducer/证据层语义可平移。
- `--resume <id>`(P3 实证):init 保留原 session_id,转录零重放(usage.cache_read_input_tokens=73600,上下文服务端延续);resume 后续轮继续追加。
- stdin 帧必需字段:`{"type":"user","message":{"role":"user","content":[{"type":"text","text":...}]}}`(content 必须 block 数组;裸字符串未探,按 block 传即可)。出站控制帧 `{"type":"control_request","request_id":...,"request":{"subtype":"interrupt"}}`。
- 不发 turn_start/turn_end/session_settled/agent_settled——生命周期 = `system:init` 起、`result` 收轮(逐轮)。

## 2. 输出帧目录(一轮全景,SEQ 实证)

```
system:hook_started → system:hook_response → system:init →
  system:thinking_tokens(×N,几百帧洪流)→
  assistant(thinking 块) → assistant(tool_use) → user(tool_result) →
  assistant(text) → … → result(subtype success|error_during_execution)
```

- **system:init**:capabilities feature-detect 面,2.1.282 = `["interrupt_receipt_v1","interrupt_cancel_queued_v1","msg_lifecycle_v1","mcp_read_resource_v1","mcp_tool_ui_meta_v1"]`;另 tools(39 项)/mcp_servers/model/permissionMode/claude_code_version/session_id。
- **assistant**:`message.content` block 数组,`thinking`(思考段,带 signature)/`tool_use`(id+name+input)/`text`。工具帧形态 `Read + input.file_path`、`Write + input.file_path/content`、`Bash + input.command`——**evidence 归一层把 `input.file_path` 同形化为 pi 的 `args.path`,toolName `Write/Edit` → `write/edit`**。
- **user**:工具结果回显(`tool_use_id` + 带行号 content);**输入文本不回显**(与 omp 同,本地 echo 注入机制可平移)。
- **system 子型**:`thinking_tokens`(估算 token 流,**几百帧/轮,传输层须丢弃或降频**,否则重演 PTY 洪水)/`task_started`+`task_notification`(Bash 后台任务)/`permission_denied`(见 §4)/`api_retry`(后端重试,attempt/max_retries/error)。
- **result**:轮收口,`subtype: success|error_during_execution`,带 usage(input/cache_read/output tokens)、duration_api_ms、total_cost_usd、is_error、result 文本。
- **无 quota/stats/models 通道**(get_session_stats/get_available_models 无对应物):模型位/思考位/上下文 chip/命令抽屉/额度 chip 按 C2-6 空态降级,禁假数据。

## 3. 输入侧语义(p2b/p2c/p5 实证)

- **steering(轮在途追加)**:直接再写一条 user 帧,同一 run 内消费(p2b:sleep×6 途中注入,模型随后 `Write steer.md`,result 文本明说处理了插话);无队列轮界帧(无 queue_update 对应物)——**claude 侧无排队锚问题,B2-6 判据对 claude 分支天然不适用**(走 evidence.prompt 直通)。
- **interrupt**:出站 `control_request/subtype=interrupt` → 立即回 `control_response {subtype:"success", request_id, response:{still_queued:[]}}` → 该轮以 `result:error_during_execution`(is_error=true, result=null)收口。capabilities 的 `interrupt_receipt_v1`/`interrupt_cancel_queued_v1` 即此语义。
- **abort 对应物**:interrupt 即中止;无 pi `abort` 的软取消语义。

## 4. 审批面(p2a2/p2a3 实证,判定门①)

- 需要批准的工具调用(实测 cwd 外 `touch`):**不产 control_request**,直接:
  1. `system:permission_denied` 帧 `{tool_name, tool_use_id, decision_reason_type, message}`;
  2. `user` 帧 tool_result `is_error:true`,content = 拒绝原因文本;
  3. 模型在文本里转述拒绝。
- `--permission-mode manual` 与默认档行为一致(两者都直拒);`--permission-prompts` 的 "host" 指 Agent SDK 宿主进程(canUseTool 回调),裸 CLI stream-json 不可达。
- 剩余候选:`--permission-prompt-tool <mcp工具名>`(审批走 MCP 工具应答,CLI 会带着权限请求调我们的 MCP server,返回 allow/deny)——C2 走路 A 前需补这一根探针(MCP server 挂具 + 一轮审批往返)。

## 5. 图片输入(p4 实证)

- 形态:user content block `{"type":"image","source":{"type":"base64","media_type":"image/png","data":<b64>}}`,与 text block 并列。
- 传输端到端可达:64×64 纯红 PNG(224ch b64)→ GLM-5.3 应答「Orange」(视觉确认;颜色判断偏差是后端事)。
- 附注:拼接/伪造的 PNG 会静默得「Unknown」类回答,传输层不报错——C2 做附件适配时格式合法性由前端保证。
- C2 图片子拍板素材:**content-block 适配可行**(composer 附件读文件转 base64),无需降灰。

## 6. C2 传输层映射速查(pi/omp 形态 ↔ claude 形态)

| pi RPC | claude stream-json | 备注 |
|---|---|---|
| ready/state 握手(get_state) | system:init 即就绪,无握手请求 | 握手超时闸照旧(init 2s 实证) |
| turn_start / turn_end | 无 | busy 边沿 = user 帧发出 → result 收到 |
| agent_settled / session_settled | result(逐轮) | evidence.settled 挂 result |
| agent_start(整 run 单发) | 无 | evidence.agentStart 不适用;queueUpdate 不适用(§3) |
| message_start/update/end | assistant/user 帧整块投递 | reducer 需按块直落,无 delta 流(`--include-partial-messages` 可开增量,未探,初版不追) |
| tool_execution_start/end | assistant tool_use + user tool_result | 配对键 tool_use_id ↔ toolCallId;归一层换字段名 |
| queue_update | 无 | steering 直注入 |
| extension_ui_request confirm | 无(§4) | answerConfirm 接口位保留等 MCP 路 |
| follow_up RPC | stdin 直写 user 帧 | ack 语义无;本地 echo 注入沿用 |
| get_session_stats / models / commands | 无 | 空态降级(C2-6) |
| --resume 零重放 | --resume 零重放(cache_read) | 语义一致 |

传输层独立成家(`claudeRpcTransport` + `claudeRpcTypes` + `claudeRpcReducer`)依据坐实:帧族与 pi 完全不同名不同形,照搬不可行(复审 P0 判断实证成立);evidence 归一层只需工具帧换形,生命周期语义(pi 单 busy 周期)与 claude 逐轮 result 对齐后可直接复用。
