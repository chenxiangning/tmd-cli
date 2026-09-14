## ADDED Requirements

### Requirement: 预算功能为独立可插拔插件

会话列表显示预算 SHALL 作为独立插件 `session-budget`(meta.category = "feature")注册于插件清单,在插件市场(插排)以插头形式可见且可插拔;插件持有 caption 入口按钮、预算弹窗与提交校验(整体归属 `src/plugins/session-budget/`)。

#### Scenario: 插排可见可拔

- **WHEN** 打开插件市场
- **THEN** 「界面功能」分区出现 session-budget 插头(名称「会话列表预算」),点击可拔出/插入,重启后生效

#### Scenario: 弹窗与校验行为不因迁移改变

- **WHEN** 插件在位时打开预算弹窗并提交合法/非法值
- **THEN** 行为与迁移前一致(动态枚举注册 CLI、校验拒绝 + 行内提示、清空回均分、剪残留 key)

### Requirement: 入口经挂载点贡献

系统 SHALL 提供挂载点 `leftSidebar.workspaceCaption`(工作区标题行右侧动作区);workspace 插件 SHALL 以 kernel Mounts 渲染该挂点,session-budget 插件 SHALL 经其贡献入口按钮;两插件之间 SHALL 无直接 import 依赖。

#### Scenario: 入口出现在工作区标题行

- **WHEN** session-budget 插件激活且左侧栏渲染工作区 caption
- **THEN** 「会话列表显示预算」按钮出现在动作区(添加工作区按钮旁),点击弹出预算弹窗

#### Scenario: 拔出插件入口消失

- **WHEN** session-budget 被拔出并重启
- **THEN** caption 动作区不再有预算入口,workspace 其余功能不受影响

### Requirement: 拔出即完全断电

session-budget 未激活时,会话列表 SHALL 不消费预算:各 CLI 分组回默认分页(初始 10 条 + 「更多」翻倍);`settings.sessionListBudget` 数值 SHALL 保留,重新插入插件后 SHALL 继续按其生效。门控 SHALL 读取真实激活态(如 `host.isPluginActive`),而非随市场页切换即时变化的期望态。

#### Scenario: 拔出后列表回默认分页

- **WHEN** session-budget 被拔出并重启,某 CLI 分组有超过 10 条磁盘历史
- **THEN** 该组初始露出 10 条,「更多...」翻倍加载可用

#### Scenario: 重插后预算恢复生效

- **WHEN** 重新插入 session-budget 并重启
- **THEN** 各 CLI 分组按已保留的预算数值露出

#### Scenario: 运行期拔插不即时生效

- **WHEN** 应用运行中在插件市场拔出/插入 session-budget(未重启)
- **THEN** 会话列表分页行为保持激活态不变,仅重启后切换
