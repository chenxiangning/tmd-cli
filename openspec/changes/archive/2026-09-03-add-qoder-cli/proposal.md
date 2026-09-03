## Why

Qoder CLI 以两个独立分发渠道共存：国际版（`qodercli`，数据目录 `~/.qoder`，npm `@qoder-ai/qodercli`）与国内版（`qoderclicn`，数据目录 `~/.qoder-cn`，npm `@qodercn-ai/qoderclicn`）。两者登录体系、模型面、openapi 域名（openapi.qoder.com / openapi.qoder.sh ↔ openapi.qoder.com.cn）互相独立，本机实证并存（1.1.33 / 1.1.28）。tmd-cli 作为多 CLI 桌面宿主，需要把两者作为独立引擎接入：独立 profile id、独立欢迎页引擎卡片、独立磁盘会话扫描，互不混淆。

## What Changes

- 新增 `cli-qoder`（国际版）与 `cli-qoder-cn`（国内版）两个引擎插件，各自完整声明 CliProfile（command / 触发符 / resume / 会话扫描 / 状态读取）
- 两版共享的 qoder 磁盘格式知识沉淀到共享层：`cli-shared/qoderSessions.tsx`（slug 规则 / 会话列表 / 模型提取 / settings.json 默认状态 / Q glyph）与 `cli-shared/userMessages.ts` 的 `qoderUserMessageLine` 行型解析器
- welcome 页 `ENGINE_METAS` 追加两条引擎元数据（binary 探针 + npm 最新版查询）
- 能力面对齐 claude 插件：磁盘历史会话列表 + `--resume` 恢复、会话模型状态（tail 扫 assistant `message.model`）、锚点栏用户消息（`origin.kind=human` 行型）、默认模型/思考强度（settings.json）

## Capabilities

### New Capabilities

- `qoder-cli-integration`: Qoder CLI 双分发版（国际/国内）的引擎接入：会话扫描与恢复、模型状态观测、锚点栏提取与默认状态读取

### Modified Capabilities

（无 —— 现有引擎插件与内核能力均不变）

## Impact

- 新增：`src/plugins/cli-qoder/`、`src/plugins/cli-qoder-cn/`、`src/plugins/cli-shared/qoderSessions.tsx`
- 修改：`src/plugins/cli-shared/userMessages.ts`（+qoderUserMessageLine）、`src/plugins/index.ts`（注册双插件）、`src/plugins/welcome/engineMeta.ts`（+2 条 EngineMeta）
- 范围外：quota/额度面板（kimi 先例，后续单独变更）；`@` 文件触发符与 `$` skill 翻译（qoder 侧未实证，不猜接口）；`--remote` 系列云端会话
