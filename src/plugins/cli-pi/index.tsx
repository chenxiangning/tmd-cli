import { piFamilySessions } from "../cli-shared/piFamily";
import { readPiDefaultStatus } from "./configStatus";
import { fetchPiQuota } from "./quota";
import { piSessionsDir, readPiSessionEdits } from "./edits";
import { PI_TUI_ASK_MARKS } from "../cli-shared/askMarks";
import { listPiSuggestions } from "./rpcCommands";
import { piConfigEntry } from "./configGui";
import type { CliSuggestion } from "@kernel/cli";
import type { Plugin } from "@kernel/plugin";

/**
 * pi 命令/技能候选(action 初判见 openspec/changes/composer-command-drawer)。
 * 技能注入后通常要跟任务文本 → 默认 insert。
 */
export const PI_COMMAND_SUGGESTIONS: CliSuggestion[] = [
  { value: "help", description: "查看可用命令", action: "send", icon: "help" },
  { value: "clear", description: "清屏", action: "send", icon: "clear" },
];

export const PI_SKILL_SUGGESTIONS: CliSuggestion[] = [
  { value: "think", description: "深度思考", icon: "think" },
  { value: "code", description: "代码任务", icon: "review" },
];

/** pi 品牌字形(codemoss EngineIcon 同源):π 方块组合;全对比度随主题(浅黑/深白,用户指定)。 */
const PI_ICON_PATHS = [
  "M1 1h16.5v11H12v5.5H6.5V23H1V1zm5.5 5.5V12H12V6.5H6.5z",
  "M17.5 12H23v11h-5.5V12z",
] as const;

function PiGlyph({ size }: { size: number | string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fillRule="evenodd"
      style={{ width: size, height: size, flexShrink: 0 }}
      aria-hidden
    >
      {PI_ICON_PATHS.map((d) => (
        <path key={d} d={d} fill="var(--tmd-fg)" />
      ))}
    </svg>
  );
}

/**
 * pi 磁盘会话四件套(扫描/状态/身份自证/用户消息)走 pi 族共享适配器
 * (状态字段键与 omp 分叉:modelId/provider 探测序);目录 slug 规则与写入
 * 事件在 ./edits.ts(与 omp 分叉)。
 */
const piSessions = piFamilySessions({
  sessionsDir: piSessionsDir,
  modelKeys: ["modelId", "model"],
  providerKeys: ["provider", "providerId"],
});

/**
 * pi CLI 插件（CLI 能力矩阵调研结论）：
 * 与 omp 同宗 pi-tui 编辑器，`/` 与 `@` 原生支持；
 * skill 走 /skill:<name>，`$` 发送时翻译。
 * 会话恢复：--resume <uuid>；历史列表 = 扫 pi 自己的 jsonl 目录。
 */
export const cliPiPlugin: Plugin = {
  id: "cli-pi",
  meta: { name: "Pi", abbr: "PI", desc: "Pi CLI 引擎:会话扫描、配额、状态", icon: PiGlyph, category: "engine" },
  activate(ctx) {
    ctx.registerCliConfig({ ...piConfigEntry, icon: (size) => <PiGlyph size={size} /> });
    ctx.registerCliProfile({
      id: "pi",
      fetchQuota: fetchPiQuota,
      docsUrl: "https://github.com/earendil-works/pi-coding-agent",
      npmPackage: "@earendil-works/pi-coding-agent",
      name: "pi",
      renderIcon: (size) => <PiGlyph size={size} />,
      command: "pi",
      args: [],
      triggers: [
        { char: "/", kind: "command" },
        { char: "@", kind: "file" },
        {
          char: "$",
          kind: "skill",
          translate: (token) => `/skill:${token.replace(/^\$/, "")}`,
        },
      ],
      suggestions: {
        command: PI_COMMAND_SUGGESTIONS,
        skill: PI_SKILL_SUGGESTIONS,
      },
      /* 命令/技能真相:RPC 副车 get_commands(扩展命令+模板+技能),静态表兜底 */
      listSuggestions: listPiSuggestions,
      resumeArgs: (sessionId) => ["--resume", sessionId],
      /* pi 与 kimi 同源 pi-tui:编辑器原生解析 ESC[200~ 粘贴标记;声明后 composer
         发送走 bracketed paste,避开新版 TUI 的粘贴爆发回车吞没(见 kernel/cli.ts) */
      bracketedPaste: true,
      ...piSessions,
      readDefaultStatus: readPiDefaultStatus,
      readSessionEdits: readPiSessionEdits,
      /* Ask 卡片标记(pi-tui 系共享字面量,见 cli-shared/askMarks.ts)。 */
      askMarks: PI_TUI_ASK_MARKS,
    });
  },
};
