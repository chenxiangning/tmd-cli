## ADDED Requirements

### Requirement: Ask 面板出现时播放提示音
系统 SHALL 在会话 PTY 输出中出现"CLI 阻塞等待用户确认"的界面标记（omp Ask 面板、确认页脚、y/n 提问）时播放提示音，且提示音开启时每轮对话（以输出静默轮次为界）MUST 最多播放一次。

#### Scenario: omp Ask 面板触发
- **WHEN** 会话输出包含 omp Ask 面板标记（如 "Ask 2 questions"、"Enter select"），且提示音已开启
- **THEN** 系统播放当前选择的提示音

#### Scenario: 同一轮重绘不重复播放
- **WHEN** 同一轮对话内 Ask 面板因重绘多次出现在输出中
- **THEN** 系统只播放一次提示音

#### Scenario: 新一轮确认再次播放
- **WHEN** 上一轮已播放过提示音，用户回答后 CLI 在新一轮再次弹出 Ask 面板
- **THEN** 系统再次播放提示音

#### Scenario: 关闭时不播放
- **WHEN** 提示音设置为关闭
- **THEN** 出现 Ask 标记时系统不播放任何声音

#### Scenario: 标记跨输出分片到达
- **WHEN** Ask 标记文本被 PTY 分片劈开、跨多个输出块到达（含 ANSI 转义序列混杂与截断）
- **THEN** 检测仍然命中并播放提示音

### Requirement: 会话消亡清理提示音去重状态
系统 SHALL 在会话销毁时清理该会话的提示音去重状态，状态 MUST NOT 跨会话泄漏。

#### Scenario: 会话退出后重建
- **WHEN** 某会话播放过提示音后退出，同 CLI 新会话再弹出 Ask 面板
- **THEN** 新会话正常播放提示音

### Requirement: 行为页提供提示音配置
设置页「行为」tab SHALL 提供提示音开关（默认开启）、内置音效选择（默认/风铃/铃声/叮咚）与测试按钮；测试按钮 MUST 播放当前选择的音效。

#### Scenario: 开关即时生效
- **WHEN** 用户切换提示音开关
- **THEN** 设置即时写入并持久化，无需保存按钮

#### Scenario: 音效选择与试听
- **WHEN** 用户在音效下拉中选择"铃声"并点击测试按钮
- **THEN** 系统播放"铃声"音效

### Requirement: 提示音设置持久化兼容
系统 SHALL 将 `askSoundEnabled` 与 `askSoundId` 纳入设置持久化；非法/缺失值 MUST 回落默认值（开启 + "default"），旧版本配置文件 MUST 能无损加载。

#### Scenario: 旧配置文件加载
- **WHEN** 配置文件不含提示音字段
- **THEN** 系统以默认值（开启 + default 音效）运行

#### Scenario: 手改配置兜底
- **WHEN** 配置文件中 `askSoundId` 为白名单外的值
- **THEN** 系统回落为 "default"
