# composer-command-drawer Specification

## ADDED Requirements

### Requirement: 协议声明(数据归 CLI 插件)

CLI 插件 SHALL 通过 `CliProfile.suggestions` 声明命令/技能候选,并 MAY 为每项声明 `action`("send" | "insert")、`icon`(语义名)、`group`、`order`;`action` 缺省 SHALL 为 "insert"。composer 侧 SHALL NOT 出现任何 `profile.id` 条件分支。

#### Scenario: 老 profile 零改动可用

- **WHEN** 某 CLI profile 未声明任何新字段(如迁移前的 omp)
- **THEN** 抽屉完整显示其命令与技能,全部点击表现为插入输入框

#### Scenario: 缺省 insert 的安全语义

- **WHEN** 用户点击一个未声明 action 的候选
- **THEN** 文本插入输入框光标处,不发生任何 PTY 写入

### Requirement: 分区由 triggers 派生

抽屉分区 SHALL 由 `profile.triggers` 已声明的 kind 派生;未声明对应触发符的 kind(如 qoder 无 `$` 技能触发符)SHALL 不显示该分区。

#### Scenario: 无技能触发符的 CLI

- **WHEN** 活跃 profile 的 triggers 只含 `{ char: "/", kind: "command" }`
- **THEN** 抽屉仅显示命令区,不出现空的技能区

### Requirement: 开合与入口

composer 右上角(原「只读」位置)SHALL 提供抽屉开关按钮,展开时呈现 `aria-expanded`;⌘/Ctrl+K SHALL 切换开合;Esc 与点击抽屉外 SHALL 关闭;无活跃会话时开关 SHALL 置灰。

#### Scenario: 键盘开合

- **WHEN** 用户在输入框按 ⌘K
- **THEN** 抽屉在开 ↔ 关之间切换,输入焦点与草稿不受影响

### Requirement: send 直接执行

`action: "send"` 的项被点击时,composer SHALL 将该候选文本经 `prepareSendPayload`(translate 钩子生效)后直接 `sessionWrite` 到活跃会话,SHALL 给出 toast 反馈并收起抽屉;发送路径 SHALL 与正常发送完全一致(不新增写入通道)。

#### Scenario: omp 技能直接发送

- **WHEN** 用户点击 omp 抽屉中 `action: "send"` 的 `$think`
- **THEN** 幕布收到 `/skill:think`(由 profile translate 决定),composer 不出现字面 `$think`

#### Scenario: 无活跃会话

- **WHEN** 会话已关闭后用户点击 send 项
- **THEN** 不写入任何内容,给出与 sendCurrent 一致的静默守卫行为

### Requirement: insert 插入输入框

`action: "insert"`(含缺省)的项被点击时,composer SHALL 在光标处插入候选 token(command 为 `/name`,skill 为 `$name`,翻译留到发送时),焦点 SHALL 回到输入框且光标位于插入文本之后。

#### Scenario: 带参命令续编

- **WHEN** 用户点击 kimi 的 `/title`
- **THEN** 输入框光标处出现 `/title `,用户继续输入会话名后自行发送

### Requirement: 过滤与键盘导航

抽屉 SHALL 提供实时过滤输入框(命中 name / description);打开时 SHALL 清空上次过滤词并聚焦;↑↓ SHALL 在全部可见项间移动选中,Enter SHALL 触发选中项,Esc SHALL 关闭。

#### Scenario: 过滤后键盘执行

- **WHEN** 用户输入 "re" 后按 ↓ ↓ Enter
- **THEN** 选中项在 resume/review 等命中项间移动并最终执行该项的动作

### Requirement: 运行时发现覆盖静态表

`CliProfile.listSuggestions(kind, cwd)` 声明时,抽屉与触发符下拉 SHALL 优先消费其结果;返回 null 或失败 SHALL 回退静态 `suggestions`;resolver SHALL 以 60s TTL 缓存(key 含 profileId/kind/cwd),失败不缓存。

#### Scenario: 磁盘技能热更新

- **WHEN** 用户在 `~/.claude/skills` 新增技能并等待缓存过期后重新打开抽屉
- **THEN** 新技能出现在候选中,无需重启应用

### Requirement: 图标语义声明与回退

profile MAY 为候选项声明语义图标名;composer SHALL 从内置图标集解析,未声明或名称未收录时 SHALL 回退按 kind 的通用 glyph(`/`、`$`)。

#### Scenario: 未收录图标名

- **WHEN** 某候选声明了图标集中不存在的 `icon: "rocket"`
- **THEN** 该项显示 kind glyph,不报错、不留空白
