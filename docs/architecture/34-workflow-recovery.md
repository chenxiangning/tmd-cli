# 34 - 0.4.8 可恢复、可审、可交付工作流契约

日期:2026-11-02 · 状态:已落地(设计:docs/superpowers/specs/2026-11-01-048-workflow-recovery-design.md)

## 1. 重启与关窗同一退出协调

- `kernel/quitGuardBoot.ts` 导出 `confirmAppExit(afterTabsClosed, prevent?)`:先 `draftMirrorFlushAll`,脏 tab 走既有聚合确认,再等待 `requestCloseAllTabs({ quit: true })` 结算,最后执行动作。
- 红 X / ⌘Q 仍传 `prevent`,脏空不拦原生销毁;插件市场重启不传 `prevent`,无脏稿也先完成 tab 协调再 `app_restart`。
- 取消只保留现场,不关闭 tab、不重启;退出强关仍不清草稿镜像。没有第二套确认框或恢复格式。

## 2. WSL 远程编辑版本令牌

- `RemoteFileSource.readText` 可返回 `{ content, version?: { mtimeMs, len } }`;字符串返回兼容未迁移来源。`writeText(uri, content, expected)` 的 `expected=null` 是显式覆盖,`undefined` 是无锁旧来源。
- WSL 同次远端脚本读取正文、mtime 与字节长度,读前／读后最多两轮复核,漂移拒绝返回错配正文;空文件返回空正文而非 truncated,空正文也产生一个写块以创建 `.wtmp`。保存先写临时分块、再比对期望版本、最后原子替换,漂移返回 `E_FS_MTIME`,写成功返回写后版本。编辑器复用本地「覆盖 / 重读」横幅,保存与重读都滚动版本基线。
- 保留 6KB b64 分块、`.wtmp` 原子替换、512KB 上限和 60s 写超时。远程 Git status 的 `linuxRoot` 经 `shellQuote` 作为单参数,传输仍走 b64 通道,不插 shell 调度。

## 3. structured-session 共同存证

- `StructuredTurnEvidence` 以 tab id `structured:<profileId>:<cwd>` 为账本副键,RPC 会话 id 仍是 CLI 身份;resume 换进程不换账本命名空间。
- prompt/follow_up 应答成功才 `captureAnchor`;busy 排队 prompt 等对应 `agent_start` 开锚。只把成功 `write/edit` 工具完成帧转成 `recordEdit`,失败工具和其他工具不猜文件副作用。
- 同一 tab 的 anchor/edit/seal 进入单一 Promise 队列,前序操作及其一次重试结束后才执行下一步;`settled()` 返回整队结算 Promise,不允许慢 anchor 反序越过 edit/seal。
- resume 换进程前调用 `reset()` 丢弃旧 activeSessionId、未发队列与工具暂存,已入 Promise 链的写账继续结算;`settled()` 清除未结束工具,迟到 end 不补记到下一轮。
- `session_settled` 复用 `sealTurn`,真实封口后广播 `ckptTurnSealed { cwd, sessionId, tmdSessionId }`,footprint 保存 structured 副键。进程退出不伪造封口。
- 批次与足迹深链在原 structured tab 存活时直接激活;原 tab 已关闭则打开原 CLI 会话的只读磁盘转录并定位原文,查看器不可用返回 miss,不新起空 RPC 会话。头部批次、接力、重试为图标按钮;接力经 `relayOpenRef` 传递 blocks/model/cwd/workspaceId,插件未启用即消钮。

## 4. 历史回合预览重试

- 入口:会话右键菜单、异常退出卡、structured-session 头部。数据源依次为活会话锚点、磁盘用户消息/转录、structured blocks;斜杠控制命令、XML/AGENTS 包装和接力外壳不是任务正文。
- 会话菜单与退出卡弹层一次读取全部有效候选,最新在前,可切换任意回合;过滤控制消息不改变原始轮号,checkpoint 仍按原轮号和 prompt 全文双闸配对。structured 头部保留上一回合快捷入口。
- 弹层展示原文、目标会话与原轮 checkpoint 批次。确认只回填,不调用 `session_write`、不自动发送;跨引擎仍走 relay。预览请求带代次与异常结算,切源开始即清旧候选,旧响应不覆盖新源。
- 当前活会话经 `composerReplaceRef` 整替草稿;非激活活会话最多等待 60 帧,目标 composer 明确接管后才写入,绝不写旧会话输入框。已退出会话先 `openDiskSession`,再挂 `sessionPending` 等 composer 接管。空历史无可用正文,重复确认覆盖而不叠加。

## 5. worktree 审阅与交付

- 非主仓、非悬空树显示「审阅 / 交付」。脏树按实际暂存/工作区状态打开该树现有 diff;干净树用 `gitPrDefaults.baseBranch` 打开既有分支比较,不能拿同名 upstream 当交付基线。
- 比较结果展示 currentOnly 待交付数、targetOnly 落后数与 `canCreate` 能力;无 currentOnly 时提示内容已包含在基线中、可清理。detached worktree 的当前侧固定用 `HEAD`,PR 创建仍按 detached 禁止保护。该状态仅描述本地 Git 事实,没有 PR 状态接口时不猜测远端已合并。
- 有待交付提交且可创建时进入 `CreatePrDialog`,head 预填当前 worktree 分支;空提交或无创建能力不显示创建入口。所有 IPC 使用 `entry.path`;不自动切分支、合并、删树。
- 移除继续走 `removeWorktreeWithCleanup` 的活会话、脏树与未合并分支保护。

## 6. 验证与真机边界

- 契约测试:重启取消/确认顺序、WSL 空文件与版本冲突、Git 特殊字符引用、structured 成功/失败工具与乱序闸、resume 清队列与迟到工具帧、历史回候选过滤/原轮批次、非激活重试接管、worktree 脏净与交付分态。
- 全量门禁:`pnpm check:gate` 612 文件 / 4752 例;Rust 408 例通过、5 个真机凭据测试忽略 + clippy `-D warnings` + fmt;`react-doctor` 100/100。
- 既有 1421 IPC 桩目检覆盖上一回合回填与 `session_write=0`、worktree 基线比较、structured 头部和 RPC 工具帧;本轮新增历史选择与交付状态仍需逐屏人工验收。
- `pnpm tauri:dev` 已启动原生进程并在烟测后停止,启动有既存 Tauri NPM/Rust 包 minor 版本提示;未把截图或点击标为已验。Windows WSL 外改、移动 M2 真机矩阵与遮挡洪水矩阵仍需对应设备验收。
