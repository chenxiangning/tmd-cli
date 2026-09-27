# composer-command-drawer Specification

## ADDED Requirements

### Requirement: 协议声明(数据归 CLI 插件)

CLI 插件 SHALL 通过 `CliProfile.suggestions` 声明命令/技能候选,并 MAY 为每项声明 `action`("send" | "insert")、`icon`(语义名)、`token`(完整 wire/插入文本)、`group`、`order`;`action` 缺省 SHALL 为 "insert"。MCP 服务器 MAY 经 `CliProfile.listMcpServers(cwd)` 声明;未声明时抽屉 SHALL NOT 显示 MCP 分区。composer 侧 SHALL NOT 出现任何 `profile.id` 条件分支。

#### Scenario: 老 profile 零改动可用

- **WHEN** 某 CLI profile 未声明任何新字段(如迁移前的 omp)
- **THEN** 抽屉完整显示其命令与技能,全部点击表现为插入输入框

#### Scenario: 缺省 insert 的安全语义

- **WHEN** 用户点击一个未声明 action 的候选
- **THEN** 文本插入输入框光标处,不发生任何 PTY 写入

### Requirement: 分区由声明派生并可以切换

命令/技能分区 SHALL 由 `profile.triggers` 已声明的 kind 派生;MCP 分区 SHALL 由 `listMcpServers` 声明派生;插件分区 SHALL 渲染内核 `listPluginStates()` 中 `category: "feature"` 的启用插件。抽屉 SHALL 以左缘竖排图标 rail 提供分区切换(2026-09-03 紧凑化:原横排 tab 行与标题/搜索行移除;二次修订:chip 去文案改图标,文案进 title/aria-label),rail SHALL 只渲染实际有数据的分区,并提供「全部」聚合视图;打开抽屉时 SHALL 重置为「全部」。抽屉高度 SHALL 自适应内容且不超过所在容器;抽屉 SHALL NOT 提供搜索/过滤输入框。

#### Scenario: 无技能触发符的 CLI

- **WHEN** 活跃 profile 的 triggers 只含 `{ char: "/", kind: "command" }` 且未声明 listMcpServers
- **THEN** 抽屉仅显示命令分区,rail 无「技能」「MCP」chip

#### Scenario: 插件分区点击

- **WHEN** 用户点击插件分区中的 Git 面板
- **THEN** 右栏面板经 `filePanel.setFilePanelMode` 切换到 Git,抽屉收起

### Requirement: 开合与入口

composer 右上角(原「只读」位置,只读标识直接删除、不迁移)SHALL 提供抽屉开关按钮,展开时呈现 `aria-expanded`;⌘/Ctrl+K SHALL 切换开合;Esc SHALL 关闭;点抽屉外 SHALL NOT 自动关闭(2026-09-03 修订:防失焦误关,显式关闭 = 开关按钮 / ⌘K / Esc / rail 关闭钮);无活跃会话时开关 SHALL 置灰。

#### Scenario: 键盘开合

- **WHEN** 用户在输入框按 ⌘K
- **THEN** 抽屉在开 ↔ 关之间切换;打开时焦点移入抽屉容器(搜索框已移除;草稿内容不受影响),关闭时焦点归还输入框

### Requirement: send 直接执行且与手动发送同路径

`action: "send"` 的项被点击时,composer SHALL 将该候选文本经 `prepareSendPayload`(translate 钩子生效)后直接 `sessionWrite` 到活跃会话,SHALL 给出 toast 反馈并收起抽屉;发送路径 SHALL 与用户手动输入同一命令后发送完全一致——composer 对手动输入的命令文本 SHALL NOT 做任何解析、拦截或特殊确认。

#### Scenario: omp 技能直接发送

- **WHEN** 用户点击 omp 抽屉中 `action: "send"` 的 `$think`
- **THEN** 幕布收到 `/skill:think`(由 profile translate 决定),composer 不出现字面 `$think`

#### Scenario: 手敲 model 与抽屉发送无差别

- **WHEN** 用户在输入框手敲 `/model` 回车,而非从抽屉点击
- **THEN** 与抽屉点击 `/model` 走完全相同的发送路径,幕布同样打开模型 picker,composer 无任何拦截

#### Scenario: 无活跃会话

- **WHEN** 会话已关闭后用户点击 send 项
- **THEN** 不写入任何内容,给出与 sendCurrent 一致的静默守卫行为

### Requirement: insert 插入输入框

`action: "insert"`(含缺省)的项被点击时,composer SHALL 在光标处插入候选 token(command 为 `/name`,skill 为 `$name`,声明 `token` 时用 token 原文,翻译留到发送时),焦点 SHALL 回到输入框且光标位于插入文本之后。

#### Scenario: 带参命令续编

- **WHEN** 用户点击 kimi 的 `/title`
- **THEN** 输入框光标处出现 `/title `,用户继续输入会话名后自行发送

#### Scenario: codex MCP mention

- **WHEN** 用户点击 codex 抽屉 MCP 分区中 `token: "$github "`、`action: "insert"` 的服务器
- **THEN** 输入框光标处出现 `$github `,原样透传(codex 原生 mention 语法)

### Requirement: 键盘导航

↑↓ SHALL 在全部可见项间移动选中,Enter SHALL 触发选中项(焦点落在按钮上时由原生 click 承担),Esc SHALL 关闭。(2026-09-03 紧凑化:过滤输入框移除,键盘导航挂在抽屉容器上。)

#### Scenario: 键盘执行

- **WHEN** 用户打开抽屉后按 ↓ ↓ Enter
- **THEN** 选中项在可见项间移动并最终执行该项的动作

### Requirement: 运行时发现覆盖静态表

`CliProfile.listSuggestions(kind, cwd)` 声明时,抽屉 resolver SHALL 优先消费其结果;返回 null 或失败 SHALL 回退静态 `suggestions`;resolver SHALL 以 60s TTL 缓存(key 含 profileId/kind/cwd),失败不缓存。`listMcpServers` 结果 SHALL 共享同一缓存语义(失败 = MCP 分区为空,不渲染错误)。触发符下拉消费 `listSuggestions` 与 CLI 磁盘技能热更新属后续变更范围(本变更落地时暂无 profile 声明该钩子,claude 技能仍为激活期扫描)。

#### Scenario: 声明即优先,失败即回退

- **WHEN** 某 profile 声明了 `listSuggestions("skill", cwd)` 并返回候选
- **THEN** 抽屉技能区消费其返回;若返回 null(如磁盘扫描失败),回退静态 `suggestions` 且不渲染错误

### Requirement: 图标语义声明与回退

profile MAY 为候选项声明语义图标名;composer SHALL 从内置图标集解析,未声明或名称未收录时 SHALL 回退按 kind 的通用 glyph(`/`、`$`)。

#### Scenario: 未收录图标名

- **WHEN** 某候选声明了图标集中不存在的 `icon: "rocket"`
- **THEN** 该项显示 kind glyph,不报错、不留空白
