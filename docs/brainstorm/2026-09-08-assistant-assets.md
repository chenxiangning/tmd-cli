# 智能体 / 提示词资产:需求澄清(对标 codemoss)

日期:2026-09-08
状态:已收敛 → [设计 spec](../superpowers/specs/2026-09-08-assistant-assets-design.md)

## 对话纪要

**发起人**:大仙。提供 codemoss「智能体 / 提示词」两张截图,问:tmd 客户端怎么做,完全复刻还是设计一版。

**调研**(scout 读 codemoss 源码 + 主会话读 tmd 侧 composer / cli-shared):

- codemoss 智能体 = `~/.ccgui/agent.json` 私有库 + 打包 248 个内置智能体(manifest + sha256,只启停);`#` 选中,发送时往用户消息尾拼 markdown 角色块,零协议。
- codemoss 提示词 = 每词一个 md(frontmatter `description` / `argument-hint`),全局级直接落 `~/.codex/prompts`(与 codex CLI 共享);`!` 插入,`/prompts:<name> K=V` 发送时 `$NAME` 展开。
- tmd 现状:composer 已有 `/` 命令、`$` 技能、`@` 文件三类触发,数据源 = 各 CLI 原生目录(cli-shared/mdCommands / skillDirs);`TriggerKind` 是 kernel 封闭联合;发送管线 `translatePrompt → prepareSendPayload`。

**裁决记录**:

1. 复刻 or 设计 → **设计一版**:机制(零协议文本注入)照抄,存储生态不复刻。否决理由:codex prompts 目录已废弃、与 CLI 原生 suggestions 双真相源、内置目录重资产。
2. v1 范围(多选)→ 提示词库 + 智能体 + codemoss 数据导入;砍:内置智能体目录、通用导入导出 JSON。
3. 触发符 → 用户裁决改 `!!` / `##`:`!` 与 shell 历史展开 / claude bash 模式冲突,`#` 与 claude memory 快捷冲突。
4. 增补需求 → 输入框右侧加两个唤醒图标,不按触发符也能拉起选择器。

**结论**:全部沉淀进 spec(见上链接),待用户审 spec 后进入实现。
