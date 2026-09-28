# 会话查看器(session-viewer)设计 spec

- 日期:2026-09-28
- 状态:已实施

## 背景与目标

tmd-cli 的会话列表只显示磁盘历史会话的标题行;想回顾一个会话的实际对话内容,唯一途径是把 PTY 恢复进去(改变引擎状态、占终端)。目标:在会话列表每一行(磁盘历史 + 活会话)最右侧加 view icon,点击打开**只读转录视图**——不 spawn、不 attach、零 PTY 交互,渲染形态完全参考 monocode(`~/code/AI/github/monocode`)的历史会话解析呈现:role 分块对话流(user/assistant/reasoning/tool)、工具卡(read/write/shell/search 四类 + 可展开 diff 行)、thinking 折叠。

数据源是各 CLI 自己的磁盘存储(JSONL/SQLite/zstd JSONL),沿既有声明式适配器模式:`CliProfile` 新增可选 `readSessionTranscript`,各 cli-* 插件实现,族共享纯函数骨架进 cli-shared,内核零 CLI 私有知识。

覆盖全部 10 个 cli-* 插件(6 套解析器):claude 族(claude/qoder/qoder-cn 共享)、kimi、pi 族(omp/pi 共享)、codex、grok、opencode、dsh。

## 方案取舍

| 决策点 | 选定 | 否决方案及理由 |
|---|---|---|
| 结构 | 独立 `session-viewer` 插件,中央 tab(kind `session-view`) | 并进 workspace 插件:违反「新增 UI 能力标准路径 = 新建插件」;kernel 加会话行挂点:挂点系统要从静态位扩到逐行 props 渲染,单消费者投机 |
| 入口 | workspace 插件(行属主)渲染 view icon(hover 显形,同 PinToggle 模式),点击走 kernel tab 契约 openTab | viewer 插件经挂点贡献图标:同上否决 |
| 数据面 | `CliProfile.readSessionTranscript?(session): Promise<CliSessionTranscript \| null>`(可选声明,缺省 = 暂不支持) | 各自直接读文件:绕过声明式适配器先例(readSessionUserMessages/readSessionEdits),内核无法统一枚举能力 |
| dsh zstd | JS 侧 fzstd 解压(纯 JS 依赖,零 Rust 改动) | Rust 侧 zstd crate 原语:src-tauri 正被并行工作占用,且为一家格式引入原生依赖不划算 |
| 渲染 | 自建轻量转录渲染(react-markdown 已在依赖),虚拟滚动用分批渲染 | 引组件库:违反不引入新 UI 库既定栈 |
| 渲染形态 | 完全参考 monocode Block 模型裁剪:磁盘文件可还原的字段(text/tool/thinking/时间戳),不留 live-only 字段 | 全量照搬 Block:一半字段(streaming/approval/btwThreads)磁盘上不存在,死重 |

## 架构

```
磁盘存储(各 CLI 私有格式,实证行型见附录)
  └─ cli-* 插件 readSessionTranscript(声明式适配器,族共享骨架在 cli-shared)
       └─ CliTranscriptBlock[](kernel cliSessionTypes.ts,跨插件契约)
            └─ session-viewer 插件 registerTabContent(kind: "session-view")渲染
workspace 会话行 view icon(hover 显形 + stopPropagation,不触发行 onOpen)
  └─ kernel/sessionViewTabs.ts(仿 fileTabs:openSessionViewTab 帮手)
```

### kernel 改动(宿主机制与跨插件契约,零 CLI 知识)

- `cliSessionTypes.ts`:`CliTranscriptRole`(user/assistant/reasoning/tool/system)、`CliToolPreview`(kind: read/write/shell/search;lines: add/del/context 行,path/query/output/additions/deletions)、`CliTranscriptBlock`(id/role/text/startedAt/tool{callId,title,kind,status,detail,preview})、`CliSessionTranscript`(blocks/truncated)。
- `cliProfile.ts`:`readSessionTranscript?: (session: CliDiskSession) => Promise<CliSessionTranscript | null>`。
- `sessionViewTabs.ts`(新):tab payload 契约(profileId/cliSessionId/title/modifiedAt)+ `openSessionViewTab` 帮手 + `isSessionViewTabRegistered` 查询(workspace 图标门控)。

### cli-shared 共享骨架

- `sessionTranscript.ts`(新):`readTranscriptFile`(全量读,32MB 预算,userMessages FULL_BYTES 同款事故教训:不走 512KB 预览 API)+ `parseTranscriptLines(text, lineParser)` 行循环壳(坏行跳过,宁漏勿误)。
- `claudeTranscript.ts`(新):claude/projects 行型 → blocks,claude/qoder/qoder-cn 三家消费(≥2 cli-* 准入达标,头注声明)。
- `piFamily.ts` 扩展:piFamilySessions 增 readSessionTranscript(omp/pi 两家)。
- codex/grok/kimi/opencode/dsh:解析器放各自插件目录(单家私有),行循环复用 sessionTranscript.ts 壳。

### 格式实证(2026-09-28 本机采样,解析器据此编写)

| 家族 | 存储 | 关键行型 |
|---|---|---|
| claude 族 | `~/.claude/projects/<slug>/<uuid>.jsonl`(qoder: `~/.qoder/projects` 同构) | `type=user/assistant`,`message.content` parts:`text`/`thinking{thinking}`/`tool_use{id,name,input}`;tool_result 在 user 行 part `{tool_use_id,content}`;`isSidechain:true` 跳过 |
| kimi | `~/.kimi-code/sessions/wd_*/session_*/agents/main/wire.jsonl` | `context.append_message`(user,滤 system-reminder/包装);`context.append_loop_event` → `content.part{part:{type:"think"/"text"}}`/`tool.call{toolCallId,name,args}`/`tool.result{result.output[]}` |
| pi 族 | `~/.pi/agent/sessions/<slug>/<ISO>_<uuid>.jsonl`(omp 同构) | `type=message` role=user/assistant/toolResult;assistant parts:`thinking{thinking}`/`toolCall{id,name,arguments}`/`text`;toolResult 行 `{toolCallId,toolName,content:[text]}` |
| codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `response_item` payload:`message{role,content:[input_text/output_text]}`/`function_call{name,arguments(JSON str)}`/`function_call_output`/`reasoning{content:[reasoning_text]}` |
| grok | `~/.grok/sessions/<enc(cwd)>/<uuid>/chat_history.jsonl` | `type=system/user/assistant(content 字符串)/reasoning(summary[].summary_text)`;工具行本机未实证 → 宽容跳过(宁漏勿误) |
| opencode | `~/.local/share/opencode/opencode.db`(SQLite,经 sqliteQuery) | session/message/part 表;part:`{"type":"text","text"}`/`{"type":"tool",tool,state{status,input}}` |
| dsh | `~/.dsh/sessions/<slug>/session-<uuid>/session.jsonl.zstd` | zstd 压缩;`user/message`{data.content,source.kind=plugin 滤}/`assistant/message`{data.message.content:[text/tool-call]}/`tool/call`{name,arguments}/`tool/result` |

### session-viewer 插件 UI

- 头部:引擎 glyph + 会话标题 + 相对时间 + truncated 徽记 + 刷新按钮(活会话重读快照)。
- **渲染形态完全对齐 monocode AgentTranscript(2026-09-28 二轮重构)**:
  - user 卡(左缘强调)+ assistant 全尺寸 markdown 正文(fold 外);
  - 一轮工作 = **折叠组(transcriptPhases.buildTranscriptPhases 纯函数)**:assistant
    散文开组做标题,thinking/tool/system 归组内;折叠头 = 类别图标(look·change·
    run·think)+ 单行摘要(headline proseSummary / 首工具动词摘要)+ 步数,默认
    收起,50% 透明 hover 加深(monocode WorkFoldLine 同款);
  - 思考行:Minus + proseSummary 单行截断,点击展开 48% 透明 markdown
    (monocode ActivityThinkingRow + agent-reasoning 同款阅读层级);
  - 工具行:动词 + mono 目标单行,点击展开命令/diff 行/输出。
- md 正文渲染与文件预览同源:remark-gfm + fvp-file-markdown/fvp-markdown-github
  全局样式(global.css 引入,--tmd-* token 桥接,零样式复制);有意裁剪
  katex/mermaid/本地图片解析/快路径(转录正文用不上)。
- 长会话性能:首屏 200 块滚动触底增量;正文单块 10k 字符、工具输出尾 2k 行截断。
- 空态/失败态显式占位不白块;grok 工具行未实证宽容跳过。
- 手动刷新:重新走 readSessionTranscript,不做文件 watch(活会话查看频率低,YAGNI)。

### 错误处理与边界

- 坏行/未知行型跳过不致命(sessionEdits 同款契约);行级 try/catch。
- 活会话并发写:读快照,读到什么渲染什么,文件半行(写一半)JSON.parse 失败跳过。
- 32MB 上限外的超大会话:truncated 标记,提示会话过大。
- 图标点击 stopPropagation + 不触发 onOpen/上下文菜单;键盘可达(button 元素)。
- grok 工具行未实证:文本与思考照常渲染,工具行宽容跳过,后续实证补齐。

### 并行会话避让

- 共享文件(cliProfile.ts / plugins/index.ts / docs/README.md / 五家 cli-*/index.tsx)全是追加式小 edit,动手前 fresh read,不重写别人段落;git add 显式文件清单。
- 不碰 src-tauri(并行会话在改):dsh zstd 走 JS fzstd。

## 验证

- 解析器:每族纯函数单测,fixture 用本机真实行型样本(上面实证表的缩减版);未知行型跳过、坏行容错、truncated 边界各有断言。
- 契约:tabContent 契约测试(session-view kind 注册)。
- 五连:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + react-doctor 100。
- 1421 桩目检:假会话(fs_collect_files 桩)→ 行 hover 出图标 → 点击开 tab → 块流渲染;未支持引擎显占位。
- 真机 `pnpm tauri:dev` 目检交互。
