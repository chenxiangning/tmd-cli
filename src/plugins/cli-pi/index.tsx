import { PiGlyph } from "../cli-shared/engineGlyphs";
import { piFamilySessions } from "../cli-shared/piFamily";
import { readPiDefaultStatus } from "./configStatus";
import { fetchPiQuota } from "./quota";
import { piSessionsDir, readPiSessionEdits } from "./edits";
import { PI_TUI_ASK_MARKS } from "../cli-shared/askMarks";
import { PI_TUI_ECHO_MARKS } from "../cli-shared/echoMarks";
import { listPiSuggestions } from "./rpcCommands";
import { piConfigEntry } from "./configGui";
import type { CliSuggestion } from "@kernel/cli";
import { PI_ACADEMY_COURSE } from "./academy/academyCatalog";
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

/**
 * pi 磁盘会话四件套(扫描/状态/身份自证/用户消息)走 pi 族共享适配器
 * (状态字段键与 omp 分叉:modelId/provider 探测序);目录 slug 规则与写入
 * 事件在 ./edits.ts(与 omp 分叉)。
 */
const piSessions = piFamilySessions({
  sessionsDir: piSessionsDir,
  modelKeys: ["modelId", "model"],
  providerKeys: ["provider", "providerId"],
  /* 远程形态(WSL 发行版):slug(piSessionSlug 同规:去前导 /、\/: 全映射 -、
     -- 包裹)在 shell 侧现算 —— 工作区 root 落库是 ~ 形态(AddWslTab 惯例,
     wsl.exe --cd 会展开),先归一成绝对路径,否则 slug 恒失配找不到会话目录。 */
  remoteSessionsDirSh: (cwd) => {
    const shq = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
    return [
      `c=${shq(cwd.replace(/\\/g, "/"))}`,
      'case "$c" in "~"|"~"/*) c="$HOME${c#"~"}" ;; esac',
      's="${c#/}"',
      "s=$(printf '%s' \"$s\" | tr '/\\:' ---)",
      'd="$HOME/.pi/agent/sessions/--${s}--"',
    ].join("\n");
  },
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
    /* CLI 学堂课程:22 内置命令 + /skill: 调用面,消费归 academy 插件(契约见 kernel/academy.ts)。 */
    ctx.registerAcademyCourse(PI_ACADEMY_COURSE);
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
         发送走 bracketed paste,避开新版 TUI 的粘贴爆发回车吞没(见 kernel/cliProfile.ts) */
      bracketedPaste: true,
      ...piSessions,
      readDefaultStatus: readPiDefaultStatus,
      readSessionEdits: readPiSessionEdits,
      /* Ask 卡片标记(pi-tui 系共享字面量,见 cli-shared/askMarks.ts)。 */
      askMarks: PI_TUI_ASK_MARKS,
      /* 用户消息回显标记(pi-tui 系共享字面量,见 cli-shared/echoMarks.ts)。 */
      echoMarks: PI_TUI_ECHO_MARKS,

      /* 待实采:busyMarks/idleMarks(在工帧 ⎋ 与空闲页脚字面量)与 omp 同源
       * pi-tui,未声明前 4b 持轮/4d 空闲闸/readopt 现势证据对本引擎不生效
       * (字面量须实采,禁猜测;2026-09-17 review 留档)。 */
      /* win ConPTY 的 CPR 应答错位会被 pi-tui 当字符注入(架构 04 契约 7)。 */
      conptyCprMismatch: true,
    });
  },
};
