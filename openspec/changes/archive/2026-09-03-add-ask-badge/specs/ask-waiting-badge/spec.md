## ADDED Requirements

### Requirement: 提问会话打「等待确认」标签

系统 SHALL 在会话 PTY 输出中出现"CLI 阻塞等待用户确认"的界面标记(omp Ask 面板、
确认页脚、y/n 提问、权限确认标题)时,立即在该会话的列表行上显示「等待确认」标签;
标签 MUST 在用户向该会话写入(作答)时立即清除,且 MUST 随会话消亡一并清除。

#### Scenario: Ask 面板出现即亮标签
- **WHEN** 会话输出包含提问/确认面板标记(标记跨 PTY 分片、夹杂 ANSI 转义均可命中)
- **THEN** 该会话行 meta 区立即显示绿色「等待确认」胶囊标签,同时广播 `askDetected`
  事件(提示音消费端照常工作)

#### Scenario: 重绘不重复触发
- **WHEN** 同一个未回答的提问因 TUI 重绘在输出中反复出现,期间还有普通输出
- **THEN** 标签保持亮起,系统不重复广播 `askDetected`(输出流不作为"不再等待"的信号)

#### Scenario: 用户作答即清
- **WHEN** 用户在终端敲下选择/回车/快捷键,或经 composer 发送(统一经
  `host.writeSession` 写入)
- **THEN** 标签立即清除;旧提问字面量不得借写入回显复燃(检测尾巴随作答重置)
- **AND** 此后同一会话再出现新提问时,标签重新亮起并再次广播 `askDetected`

#### Scenario: 会话消亡清理
- **WHEN** 正在等待确认的会话退出或被移除
- **THEN** 等待状态与检测尾巴一并清除,同 id 新会话从零检测,状态不跨会话泄漏;
  退订前在途的迟到输出不得复活已删会话的等待状态

#### Scenario: 置顶区的活会话同款标签
- **WHEN** 全局置顶的会话当前有活 PTY 绑定且正等待确认
- **THEN** 置顶区该行同样显示「等待确认」标签;无活 PTY 的磁盘历史行不显示

### Requirement: Ask 检测状态由内核单点提供

系统 SHALL 由内核(host 输出主链路)单点执行 Ask 标记检测,标签呈现与提示音
MUST 消费同一检测源(`host.isWaitingConfirm` / `askDetected` 事件),不得存在
第二份检测实现。

#### Scenario: 单点检测双消费
- **WHEN** 提问标记命中
- **THEN** 会话列表标签(经 `isWaitingConfirm`)与 Ask 提示音(经 `askDetected`)
  由同一次检测同时驱动;提示音设置门控(开关/音效白名单)行为不变
