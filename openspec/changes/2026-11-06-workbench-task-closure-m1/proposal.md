# 工作台任务闭环一期:判据 + 结算守望 + 驳回回灌

> 日期:2026-11-06 · 状态:实施中
> 上游:机制调研 `docs/research/ai-task-closure-orchestration.md` · 设计形态 `docs/design/task-closure-orchestration.html`
> 架构裁决:**workbench 插件内扩展,不新立插件**(任务域 owner 已是 workbench:状态机/TaskSessionLink/taskPrompt/storeWatch 全在;另立插件需深 import 其内部或把单插件语义塞 kernel,两路皆违规)

## 目标

工作台任务今天已是「AI 写台账 + 客户端盯文件」的半闭环(AI-TASKS.md 约定)。一期补三块最小缺口,把人工验收闭环补齐:**完成判据进任务实体与派发 prompt;会话落定/异常退出时按任务维度通知;验收驳回时把意见回灌到关联会话续跑**。

一期刻意不做(去向设计文档 §5 批次二/三):MCP 反向通道、并行 worktree 竞速、auto 判据执行、验收证据 diff 视图(复用 footprint 另立项)、手机审批卡。

## 范围

| 面 | 做 | 复用 |
|---|---|---|
| 数据契约 | `ProjectTask.criteria?: {id,text}[]`(纯字符串判据;结构化 pass/fail 状态不做,AI 在 updates[] 自检汇报) | types.ts 归一化模式、store.ts 串行 enqueue |
| 派发 prompt | taskPrompt 注入判据段 + 交付前逐条自检要求 | taskPrompt.ts / setPendingTaskCard 既有派发原语 |
| 表单 | TaskFormView 判据编辑(一行一条) | 既有表单 values 流 |
| 结算守望 | 新模块 taskSettleWatch:turnSettled/sessionExited → 反查关联任务 → 任务维度通知;**不写 status**(状态权威仍在 AI/用户,防双写打架) | bootGenSession 装配模式、notify 通知通道 |
| 驳回回灌 | review 态任务详情加「驳回并回灌」:意见写入存活关联会话(prepareSendPayload + writeSession)+ status 回 doing + updates 追加驳回记录;无存活会话则仅回滚状态并提示 | sessionOpen 存活判定、updateTask |
| 验收通过 | 既有推进链 review→done,不动 | NEXT_TASK_STATUS |

## 契约要点

1. **status 写权威不迁移**:客户端仅在用户显式手势(驳回回滚)写 status;结算守望只通知不写。AI 按 AI-TASKS.md 写,storeWatch 合并进 UI,双写面不重叠。
2. criteria 是用户声明、AI 自检、人验收的三方共读清单;id 随机防 AI 误合并。
3. 回灌目标 = 最新存活的 host 关联会话;全灭则状态回滚 + toast 指引,不静默丢意见。

## 验证

- 单测:taskPrompt 判据段注入;criteria 归一化防御;settle 反查纯函数(sessionId→task 命中/未命中/已终态跳过)。
- `pnpm check:gate` + react-doctor 100。
- 1421 dev 浏览器桩目检:建判据任务 → 派发 → 模拟 turnSettled → 通知与徽标 → 驳回回灌写会话。
