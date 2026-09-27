# composer-terminal-focus Specification

## ADDED Requirements

### Requirement: 空输入方向键移交幕布焦点

composer 输入框为空(去除首尾空白后)且触发符候选下拉未打开且非 IME 组合输入时,按 ↑ 或 ↓ SHALL 将键盘焦点移交给活跃会话的幕布(xterm),并阻止默认光标移动;幕布聚焦后按键 SHALL 经 PTY 原生透传,语义由各 CLI 自行解释(历史回溯 / 候选选择等),tmd 不做翻译。

#### Scenario: 空输入取 CLI 历史

- **WHEN** composer 无任何输入,用户按 ↑ 再按 ↑
- **THEN** 第一次按键焦点落到幕布,第二次 ↑ 由 CLI 自己消费(如 kimi 回溯上一条历史输入)

#### Scenario: 非空输入行为不变

- **WHEN** composer 已有草稿文本,用户按 ↑
- **THEN** 光标在输入框内移动,焦点不发生移交

#### Scenario: 下拉打开时优先补全

- **WHEN** 用户输入 `/` 触发候选下拉后按 ↓
- **THEN** 下拉选中项下移,不触发焦点移交

#### Scenario: IME 组合中不触发

- **WHEN** 用户正在中文输入法组合状态按方向键
- **THEN** 交给输入法处理,不发生焦点移交

### Requirement: 焦点获取走 TerminalHandle 注册表

幕布聚焦 SHALL 经 `messageAnchors` 的 `TerminalHandle` 注册表(`focus()` 方法)完成, SHALL NOT 新增 IPC 或事件总线通道;目标会话无已注册 handle(如幕布未挂载)时 SHALL 静默忽略,焦点留在输入框。

#### Scenario: 幕布未挂载

- **WHEN** 活跃会话的 TerminalView 尚未挂载完成,用户在 composer 按 ↓
- **THEN** 无异常、无报错 toast,输入框保持焦点
