# qoder-cli-integration Specification

## Purpose
TBD - created by archiving change add-qoder-cli. Update Purpose after archive.
## Requirements
### Requirement: 双分发版作为独立引擎接入
系统 SHALL 将 Qoder CLI 国际版（`qodercli`）与国内版（`qoderclicn`）注册为两个独立 CliProfile（id 分别为 `qoder` / `qoder-cn`），各自的二进制、数据目录（`~/.qoder` 与 `~/.qoder-cn`）与欢迎页引擎卡片 MUST 互不混淆。

#### Scenario: 国际版探针
- **WHEN** PATH 中存在 `qodercli` 而不存在 `qoderclicn`
- **THEN** 欢迎页只有国际版卡片显示已安装，国内版显示未安装

#### Scenario: 国内版探针
- **WHEN** PATH 中存在 `qoderclicn`
- **THEN** 国内版卡片可新建会话，命令为 `qoderclicn`

### Requirement: 磁盘历史会话扫描与恢复
系统 SHALL 扫描 `<数据目录>/projects/<slug>/<uuid>.jsonl`（slug = `cwd.replace(/[^a-zA-Z0-9]/g, "-")`）列出该 cwd 的历史会话，标题取自头部窗口的首条用户消息，并 SHALL 支持 `--resume <uuid>` 恢复。

#### Scenario: 会话列表
- **WHEN** 用户在会话列表查看 qoder 引擎的历史
- **THEN** 列表只含当前 cwd 对应 slug 目录下的 `<uuid>.jsonl` 会话，按修改时间排序

#### Scenario: 恢复会话
- **WHEN** 用户从历史列表恢复某会话
- **THEN** 终端以 `qodercli --resume <uuid>`（或 `qoderclicn --resume <uuid>`）启动

### Requirement: 会话模型状态观测
系统 SHALL 从会话 jsonl 尾部窗口提取最近 assistant 行的 `message.model` 作为当前模型，MUST 跳过 `isApiErrorMessage` 错误帧（其 model 为 `<synthetic>`）。

#### Scenario: 正常会话显示真实模型
- **WHEN** 会话文件尾部含 model=qmodel_38max 的 assistant 行
- **THEN** 工具栏显示 qmodel_38max

#### Scenario: 错误帧不污染模型显示
- **WHEN** 最新 assistant 行是额度耗尽错误帧（model=`<synthetic>`），更早行 model=qmodel_38max
- **THEN** 工具栏仍显示 qmodel_38max

### Requirement: 默认模型与思考强度读取
系统 SHALL 读取 `<数据目录>/settings.json` 的 `model.name` 与 `model.preferences[<name>].reasoning.effort`，作为全新会话的默认状态种子；文件缺失或异型 MUST 返回 null（不猜）。

#### Scenario: 完整配置
- **WHEN** settings.json 含 model.name=qmodel_38max 且同名偏好下 reasoning.effort=max
- **THEN** 新会话初始状态为 { model: qmodel_38max, thinkingLevel: max }

#### Scenario: 缺配置
- **WHEN** settings.json 不存在或 JSON 异型
- **THEN** 新会话不种默认状态

### Requirement: 锚点栏用户消息提取
系统 SHALL 提取会话 jsonl 中 `type=user` 且 `origin.kind=human` 的行为锚点消息；sidechain、工具结果与包装注入 MUST 排除。

#### Scenario: 人工输入成为锚点
- **WHEN** 用户行携带 origin.kind=human 与文本载荷
- **THEN** 锚点栏出现该消息并可定位幕布

#### Scenario: 非人工行不进锚点
- **WHEN** 用户行 origin.kind 不是 human（或字段缺失）
- **THEN** 该行不进锚点栏

