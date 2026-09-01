# Composer 工具栏拆分设计

## 目标

重设计 Composer 对话框：清除容器级空白，将输入区和只读 session 状态工具栏拆分。

## 视觉结构

```text
Composer
└── 对话框容器
    ├── 工具栏：模型 + 思考强度
    └── textarea：用户输入
```

外层移除现有 `px-3 py-2`，textarea 移除现有 `px-3 py-3`。工具栏与输入区只保留 1px 分隔线，不设置区域间距；工具栏自身保留最小可读高度和水平内边距。

## 状态来源

模型与思考强度不在 `SessionMeta` 或 Rust session 中。各 CLI 的 session JSONL 是权威只读来源：

- OMP/Pi：读取最后一条 `model_change` 与 `thinking_level_change`。
- Codex：读取当前 rollout 的 `session_meta` 与最后一条 `turn_context`，兼容可识别字段。

各 `CliProfile` 提供状态读取函数，Composer 只消费统一的 `CliSessionStatus`，不感知 CLI 私有文件格式。

未绑定 CLI session id、文件尚未刷盘或字段不可识别时，工具栏显示 `—`，不得猜测默认值。

## 更新策略

Host 只轮询当前 active session，每 2 秒刷新一次；状态值未变化时不触发 React 重渲染。session 切换、磁盘身份绑定时立即刷新。session 退出时清理状态。

## 只读边界

工具栏使用非交互元素，不打开菜单、不发送命令、不修改模型或思考强度。模型切换继续由 CLI 原生 `/model` 等命令负责。

## 验证

- HTML 原型已在浏览器中检查：已识别和未识别两种状态均可见。
- `pnpm typecheck`
- `pnpm build`
- Tauri 应用启动 smoke check
