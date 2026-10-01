/**
 * omp 扩展静态精选表 —— 实时目录的离线兜底 + 描述补全源(人工审校中文描述)。
 * 版本/下载量留空(offline 语义),条目均为 npm 在售的真实包。
 * 最近核对:2026-10-01(全表存活复验;新纳 billion-context / pi-goal-x /
 * langfuse 观测等 7 个新晋热门,omp-kiro 描述对齐 v1.2.6)。
 * 收录门槛:经 dist 审计不触碰 omp 18.4.8 legacy 垫片缺失的 pi 新版导出
 * (pi-usage 因 import hasApi 装载失败被撤,详见当日审计)。
 */

import type { ExtCatalogEntry } from "./catalog";

export const CURATED_CATALOG: ExtCatalogEntry[] = [
  {
    name: "@cortexkit/pi-magic-context",
    description: "Magic Context 共享记忆库:跨 CLI 持久记忆与会话检索",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/@cortexkit/pi-magic-context",
    curated: true,
  },
  {
    name: "@juicesharp/rpiv-todo",
    description: "模型自维护的 TODO 清单,浮层常驻、压缩后不丢",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/@juicesharp/rpiv-todo",
    curated: true,
  },
  {
    name: "@juicesharp/rpiv-ask-user-question",
    description: "模型向你发起结构化问卷(带类型选项),替代凭空猜测",
    weeklyDownloads: 0,
    homepage:
      "https://www.npmjs.com/package/@juicesharp/rpiv-ask-user-question",
    curated: true,
  },
  {
    name: "pi-background-tasks",
    description: "持久后台 shell 任务与只读委派代理",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/pi-background-tasks",
    curated: true,
  },
  {
    name: "pi-lens",
    description: "实时代码反馈:LSP / lint / 类型检查 / 结构分析",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/pi-lens",
    curated: true,
  },
  {
    name: "pi-subagents",
    description: "单代理委派与脚本化多代理工作流",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/pi-subagents",
    curated: true,
  },
  {
    name: "pi-web-access",
    description: "网络搜索 / URL 抓取 / GitHub 克隆 / PDF 与视频理解",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/pi-web-access",
    curated: true,
  },
  {
    name: "pi-mcp-adapter",
    description: "MCP(Model Context Protocol)服务器接入适配",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/pi-mcp-adapter",
    curated: true,
  },
  {
    name: "omp-kiro",
    description: "Kiro OAuth 登录、额度用量、模型发现与流式运行时",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/omp-kiro",
    curated: true,
  },
  {
    name: "omp-plugin-duplicate-detector",
    description: "基于 jscpd 的重复代码检测插件",
    weeklyDownloads: 0,
    homepage:
      "https://www.npmjs.com/package/omp-plugin-duplicate-detector",
    curated: true,
  },
  {
    name: "billion-context",
    description: "上下文压缩:100K 小窗口跑月级长会话,约省 5 倍 token",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/billion-context",
    curated: true,
  },
  {
    name: "pi-goal-x",
    description: "/goal 目标规划:对话式拆解、有序/弹性目标与独立完成审计",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/pi-goal-x",
    curated: true,
  },
  {
    name: "@langfuse/pi-observability-plugin",
    description: "Langfuse 观测:trace 提示词、代理回合与工具调用",
    weeklyDownloads: 0,
    homepage:
      "https://www.npmjs.com/package/@langfuse/pi-observability-plugin",
    curated: true,
  },
  {
    name: "bigpowers",
    description: "73 个 agent skills:17 年软件工程纪律沉淀的方法论",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/bigpowers",
    curated: true,
  },
  {
    name: "@plannotator/pi-extension",
    description: "交互式计划评审:标注 agent 消息,评审代码与 PR",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/@plannotator/pi-extension",
    curated: true,
  },
  {
    name: "pi-powerline-footer",
    description: "Powerline 风格状态栏",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/pi-powerline-footer",
    curated: true,
  },
  {
    name: "pi-claude-bridge",
    description: "把 Claude Code(Agent SDK)接入为模型提供方,附 AskClaude 工具",
    weeklyDownloads: 0,
    homepage: "https://www.npmjs.com/package/pi-claude-bridge",
    curated: true,
  },
];
