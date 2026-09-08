/** en 词典 · misc 域(键 = 中文源串,由文案迁移按归属写入;zh 恒等无词典)。 */
export const MESSAGES = {
  // checkpoints 插件 meta(registerFilePanel label 与 plugin.meta 的渲染点在内核/首页,主会话包裹)
  "批次审批": "Batch approval",
  "AI 改动按轮成批:审 diff、整批或按文件回退":
    "Groups AI changes by turn: review diffs, revert a whole batch or per file",
  "审批线": "Approval timeline",
  // CheckpointsPanel
  "批次已标记通过 —— 仅记录状态,不影响任何文件":
    "Batch marked approved — state recorded only, no files affected",
  "已回退 {n} 个文件;跳过:{skipped}": "Reverted {n} files; skipped: {skipped}",
  "已回退 {n} 个路径 · 恢复点已留存,可反悔":
    "Reverted {n} paths · restore point kept, you can undo",
  "已应用 {n} 个文件;跳过:{skipped}": "Applied {n} files; skipped: {skipped}",
  "已应用 {n} 个文件 · 恢复点已留存,可反悔":
    "Applied {n} files · restore point kept, you can undo",
  "没有可应用的文件;跳过:{skipped}": "No files to apply; skipped: {skipped}",
  "没有可应用的文件": "No files to apply",
  "已从恢复点恢复 {n} 个文件,批次回到待审":
    "Restored {n} files from the restore point; batch is back to pending review",
  "待审": "Pending review",
  "点击关闭": "click to dismiss",
  "审批线清单刷新失败:{error} · 点击重试":
    "Failed to refresh the approval list: {error} · click to retry",
  "暂无活跃工作区": "No active workspace",
  "审批线跟随会话生命周期 —— 当前工作区没有活会话":
    "The approval timeline follows the session lifecycle — no active session in this workspace",
  "非 git 工作区 —— 仅声明写入事件检测的 CLI(如 claude)可在此记账,其余 CLI 需 git 仓库":
    "Not a git workspace — only CLIs that declare write-event detection (e.g. claude) can record here; other CLIs need a git repository",
  "读取批次…": "Loading batches…",
  "本会话还没有批次 —— 发送一条让 AI 改文件的消息后,这里会按轮归批":
    "No batches in this session yet — send a message that asks the AI to change files, and changes will be grouped by turn here",
  // TimelinePanel(审批线面板「时间线」页签)
  "时间线": "Timeline",
  "定位幕布": "Locate in terminal",
  "展开全文": "Show full text",
  "时间线跟随会话生命周期 —— 当前没有活跃会话":
    "The timeline follows the session lifecycle — no active session right now",
  "本会话还没有用户消息 —— 发送一条后,这里按时间记录":
    "No user messages in this session yet — send one and it will be listed here in order",
  // BatchRow / STATE_META(定义处保留中文,消费点 t(meta.label))
  "进行中": "In progress",
  "已处理": "Done",
  "已通过": "Approved",
  "已退": "Reverted",
  "点击审阅该批(用户消息 + 文件 diff) · {ts}":
    "Click to review this batch (user message + file diff) · {ts}",
  "{start} 发起": "started {start}",
  "{start} 发起 · {end} 封口": "started {start} · sealed {end}",
  "批次 #{index}": "Batch #{index}",
  "{n} 文件": "{n} files",
  "归因:AI 写入事件流(账本只记 CLI 声称写过的文件)":
    "Attribution: AI write event stream (the ledger records only files the CLI claims to have written)",
  "归因:窗口内 git 变更推断(该 CLI 未声明写入事件检测,可能有误差)":
    "Attribution: inferred from git changes in the window (this CLI doesn't declare write-event detection; may be inaccurate)",
  "该 CLI 未声明写入事件检测:批次由 git 变更推断,可能混入手改":
    "This CLI doesn't declare write-event detection: batches are inferred from git changes and may include manual edits",
  "推断": "Inferred",
  "思考 {level}": "Thinking {level}",
  "标记本批已审阅(纯标记,不影响任何文件)":
    "Mark this batch as reviewed (mark only; no files are touched)",
  "通过": "Approve",
  "回退整批({n})": "Revert batch ({n})",
  "按账本副本把这轮改动精确写回(live 已偏离批前像的文件跳过,绝不覆盖)":
    "Write this turn's changes back precisely from the ledger copy (files whose live state diverged from the pre-batch image are skipped, never overwritten)",
  "应用回此批": "Reapply batch",
  "反悔 · 恢复回来": "Undo · restore back",
  "进行中 —— 本轮对话结算后自动封口进入待审":
    "In progress — sealed automatically when this turn settles, then awaits review",
  "已处理 —— 无需操作": "Done — nothing to do",
  "已通过 —— 仅标记,改动仍在工作区": "Approved — mark only; changes stay in the workspace",
  "已回退 · 恢复点留存": "Reverted · restore point kept",
  "回退前自动打恢复点": "A restore point is created automatically before reverting",
  "已提交": "Committed",
  "内容已变": "Contents changed",
  // BatchRowParts
  "回退{target}": "Revert {target}",
  "{n} 个路径": "{n} paths",
  "整批": "whole batch",
  "按账本副本把这轮改动精确写回磁盘(回退的镜像);":
    "Write this turn's changes back to disk precisely from the ledger copy (the mirror of reverting);",
  "执行前已自动打恢复点,可反悔": "a restore point is created automatically before running — you can undo",
  "live 已偏离批前像的文件按 diff 精准重放,改动重叠才跳过。":
    "Files whose live state diverged from the pre-batch image are replayed precisely by diff; only overlapping changes are skipped.",
  "改动将还原到这轮消息发出之前;": "Changes will be restored to before this turn's message was sent;",
  "回退前已自动打恢复点,可反悔": "a restore point is created automatically before reverting — you can undo",
  "共改文件按 diff 精准擦除(只擦本批改动),重叠才跳过。":
    "Shared-change files are erased precisely by diff (only this batch's changes); only overlapping parts are skipped.",
  "取消": "Cancel",
  "确认应用": "Confirm apply",
  "确认回退": "Confirm revert",
  "点击在编辑区查看该文件 diff": "Click to view this file's diff in the editor",
  "AI 本轮写入该文件 {n} 次(事件流轨迹,账本可审计)":
    "AI wrote this file {n} times this turn (event-stream trace, auditable in the ledger)",
  "工作区内容已偏离本批后像,不可回退,仅可对照":
    "Workspace contents have diverged from this batch's after-image; cannot revert, compare only",
  "只回退这个文件": "Revert only this file",
  "只回退此文件": "Revert this file only",
  // BatchSheet
  "{s} 秒": "{s}s",
  "{m} 分 {s} 秒": "{m}m {s}s",
  "{h} 小时 {m} 分": "{h}h {m}m",
  "该工作区不是 git 仓库,无审批数据": "This workspace is not a git repository; no approval data",
  "批次不存在或已随会话结束(审批线生命周期 = 单个会话)":
    "Batch not found or ended with the session (an approval timeline spans a single session)",
  "已处理 · {reason}": "Done · {reason}",
  "批次 #{index} · {state} · {time}": "Batch #{index} · {state} · {time}",
  "确认回退{target}? 恢复点自动留存。": "Revert {target}? A restore point is kept automatically.",
  "整批({n} 文件)": "whole batch ({n} files)",
  "生成批 diff…": "Generating batch diff…",
  "用户消息": "User message",
  "思考": "Thinking",
  "耗时 {duration}": "Took {duration}",
  "AI 修改的文件({n}) —— 点击分区头折叠;hover 可单文件回退":
    "Files changed by AI ({n}) — click a section header to collapse; hover to revert a single file",
  "本批文件当前与批后像无差异(可能已回退或已提交)":
    "Files currently show no diff against the batch after-image (possibly already reverted or committed)",
  // PromptImages
  "{path}(文件已不可读)": "{path} (file no longer readable)",
  "{name} —— 点击放大查看": "{name} — click to enlarge",
  // cli-dsh hostPanel
  "连不上本地 host。确认 dsh web 已启动,或点立即启动。":
    "Can't reach the local host. Make sure dsh web is running, or click Start now.",
  "只能停掉本机 DSH host。远程地址不会被关闭。":
    "Only a local DSH host can be stopped. Remote addresses won't be closed.",
  "正在启动…": "Starting…",
  "未安装 DSH CLI": "DSH CLI not installed",
  "主机已连接": "Host connected",
  "主机未运行": "Host not running",
  "正在探测本地 host": "Probing local host",
  "先装本地 dsh。模型和密钥仍然去 DSH Web UI 配。":
    "Install the local dsh first. Models and keys are still configured in the DSH Web UI.",
  "连不上 {origin}。自动启动只影响下次对话;要现在拉起请点立即启动。":
    "Can't reach {origin}. Auto-start only affects the next conversation; click Start now to bring it up immediately.",
  "只信 host.describe,不把端口通当作已就绪。":
    "Only host.describe counts as ready; an open port alone doesn't.",
  "当前供应商": "Current provider",
  "当前模型": "Current model",
  "已挂会话": "Attached sessions",
  "提示": "Tip",
  "模型和 API Key 在 DSH Web UI 里配,这里只负责装 CLI、连本地 host(要求 Node ≥ 22.19 或 ≥ 24)。启动 = 新开一个「DSH Host」终端会话跑 dsh web,关掉会话即停止服务。":
    "Configure models and API keys in the DSH Web UI; this only installs the CLI and connects to the local host (requires Node ≥ 22.19 or ≥ 24). Starting opens a new “DSH Host” terminal session running dsh web; closing that session stops the service.",
  "已连接到 {origin}": "Connected to {origin}",
  "取消启动": "Cancel start",
  "打开 DSH Web UI": "Open DSH Web UI",
  "停止服务": "Stop service",
  "立即启动": "Start now",
  "仍尝试打开": "Try opening anyway",
  "重新检测": "Re-check",
  // cli-dsh dshConnectionSettings
  "自动启动开": "auto-start on",
  "自动启动关": "auto-start off",
  "连接设置": "Connection settings",
  "自定义 DeepSeek Harness 路径": "Custom DeepSeek Harness path",
  "留空用 PATH 里的 dsh;改动即保存,下次启动服务生效。":
    "Leave empty to use dsh from PATH; changes save immediately and take effect the next time the service starts.",
  "Host 地址": "Host address",
  "默认本机。改端口前先确认没有别的进程占着。":
    "Local machine by default. Before changing the port, make sure no other process is holding it.",
  "端口": "Port",
  "自动启动主机": "Auto-start host",
  "下次进首页且 host 未运行时自动拉起。拨开关不会立刻启动或停止。":
    "Automatically starts the next time you open the home page and the host isn't running. Toggling doesn't start or stop it immediately.",
} as Record<string, string>;
