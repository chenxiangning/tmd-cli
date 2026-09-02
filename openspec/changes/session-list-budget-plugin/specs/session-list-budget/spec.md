## ADDED Requirements

### Requirement: 会话列表按预算露出磁盘历史

系统 SHALL 以 `resolveCliSessionQuota(settings.sessionListBudget, profile.id, 注册 CLI id 集)` 的解析结果作为每个 CLI 分组磁盘历史的初始露出条数;预算设置修改 SHALL 响应式生效(各组按新预算重新露出,已展开的「更多」分页重置)。预算语义保持:total 为工作区内所有 CLI 分组共享的初始露出总条数(1–100,默认 20);已配置配额的组按配额(显式 0 = 初始不露出磁盘历史);未配置的组均分剩余(floor,不补尾数)。

#### Scenario: 未配置时均分默认预算

- **WHEN** 预算为默认值(total=20,perCli 为空)且注册了 4 个 CLI
- **THEN** 每个 CLI 分组初始露出 5 条磁盘历史

#### Scenario: 显式配 0 的组初始不露出历史

- **WHEN** 某 CLI 配额显式为 0,该组存在未置顶磁盘历史且无活会话
- **THEN** 该组不显示任何磁盘历史行,仅显示「更多...(还有 N 条)」;点击后从 10 条起翻倍加载

#### Scenario: 预算修改即时生效

- **WHEN** 用户在预算弹窗修改总数或某 CLI 配额并提交
- **THEN** 各 CLI 分组按新解析配额重新露出(无需重启或刷新工作区)

#### Scenario: 配额按注册集解析,全量 CLI 自适应

- **WHEN** 任一 cli-* 插件注册 profile(含新接入 CLI)
- **THEN** 该 CLI 分组与弹窗配额行无需改任何既有代码即参与解析与展示;禁用的插件不参与

### Requirement: caption 弹窗编辑预算

工作区标题旁入口 SHALL 打开「会话列表显示预算」悬浮弹窗(portal + fixed 定位,backdrop 点击 / Escape / X 关闭),内含总数编辑行 + 每注册 CLI 一行的配额编辑行(图标 + 名称 + 数字输入)。校验规则:total 须为 1–100 整数且不小于已分配配额之和;配额须为不大于剩余空间的非负整数;非法提交 SHALL 拒绝写入并给行内提示、回退输入框(不静默兜底);清空配额 = 取消预留回到均分;写入 SHALL 剪除已卸载 CLI 的残留 perCli key,且已分配之和按剪除后的基底计算(残留 key 不得虚增占用)。

#### Scenario: 配额行动态枚举注册 CLI

- **WHEN** 打开预算弹窗
- **THEN** 为每个已注册 CLI profile 渲染一行(品牌图标 + 名称 + 配额输入,placeholder 为当前均分/配额值),不出现已禁用插件的行

#### Scenario: 总数小于已分配被拒绝

- **WHEN** 已分配配额之和为 12,用户提交总数 8
- **THEN** 写入被拒绝,显示行内提示,输入框回退原值

#### Scenario: 清空配额回到均分

- **WHEN** 用户清空某 CLI 的配额输入并提交
- **THEN** 该 CLI 的 perCli key 被删除,回到未配置均分语义

#### Scenario: 卸载 CLI 残留 key 剪除且不虚增已分配

- **WHEN** settings.json 存在某已禁用 CLI 的残留 perCli key,用户提交任意合法修改
- **THEN** 写入的新 perCli 不再包含该残留 key,「已分配」提示按剪除后的基底计算

### Requirement: 更多分页翻倍加载

「更多...」SHALL 保持翻倍递增语义(现配额 → 2× → 4× …);配额为 0 的组首次点击 SHALL 加载 10 条。按钮 SHALL 显示剩余未露出条数。

#### Scenario: 正配额组翻倍

- **WHEN** 某 CLI 配额为 5 且剩余历史充足,用户连续点击「更多」
- **THEN** 露出条数按 5 → 10 → 20 递进

#### Scenario: 0 配额组首击加载 10 条

- **WHEN** 某 CLI 配额为 0,用户首次点击「更多」
- **THEN** 该组露出 10 条,后续点击翻倍
