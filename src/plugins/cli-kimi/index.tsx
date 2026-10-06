import { KimiGlyph } from "../cli-shared/engineGlyphs";
import { KIMI_ACADEMY_COURSE } from "./academy/academyCatalog";
import type { CliProfile, CliSuggestion } from "@kernel/cli";
import type { Plugin } from "@kernel/plugin";
import { PI_TUI_ASK_MARKS } from "../cli-shared/askMarks";
import { PI_TUI_ECHO_MARKS } from "../cli-shared/echoMarks";
import { listKimiMcpServers } from "./mcpServers";
import { listKimiSuggestions } from "./scanSuggestions";
import {
  listKimiSessions,
  readKimiSessionIdentity,
  readKimiUserMessages,
} from "./kimiSessions";
import { readKimiConfigStatus } from "./configStatus";
import { isKimiSessionEmpty } from "./kimiEmpty";
import { kimiTranscriptLine } from "./kimiTranscript";
import {
  pairToolResults,
  parseTranscriptBlocks,
  readTranscriptText,
} from "../cli-shared/sessionTranscript";
import type { CliDiskSession, CliSessionTranscript } from "@kernel/cli";

/** 会话完整转录:wire 双候选位(新布局 agents/main/wire.jsonl,老 home 直挂),
 *  顺序探测先成者用(kimiEmpty 同款)。 */
async function readKimiTranscript(
  session: CliDiskSession,
): Promise<CliSessionTranscript | null> {
  for (const wire of [`${session.path}/agents/main/wire.jsonl`, `${session.path}/wire.jsonl`]) {
    const file = await readTranscriptText(wire);
    if (!file) continue;
    return {
      blocks: pairToolResults(parseTranscriptBlocks(file.text, kimiTranscriptLine)),
      truncated: file.truncated,
    };
  }
  return null;
}

/**
 * `/` 内置命令候选(官方 slash-commands 参考摘选高频项;action 初判见
 * openspec/changes/composer-command-drawer,/sessions /model 等 picker 类已拍板 send)。
 */
export const KIMI_COMMAND_SUGGESTIONS: CliSuggestion[] = [
  { value: "help", description: "帮助与快捷键", action: "send", icon: "help" },
  { value: "model", description: "切换模型/思考模式(幕布内 picker)", action: "send", icon: "model" },
  { value: "sessions", description: "会话列表与切换(幕布内 picker)", action: "send", icon: "resume" },
  { value: "new", description: "新建会话", action: "send", icon: "compact" },
  { value: "title", description: "重命名当前会话(需会话名)", icon: "plan" },
  { value: "plan", description: "只读规划模式", action: "send", icon: "plan" },
  { value: "compact", description: "压缩上下文", action: "send", icon: "compact" },
  { value: "usage", description: "用量与配额", action: "send", icon: "usage" },
];

/**
 * kimi CLI 插件(CLI 能力矩阵调研结论 + 本机 0.40.1 实证):
 * - `/` = 内置命令、`@` = 文件路径补全:原生支持,纯透传
 * - `$` = skill:kimi 原生语法 /skill:<name>,发送时翻译(与 omp 同方案)
 * - bracketedPaste:pi-tui 系编辑器整串写入会被粘贴爆发启发式吞掉回车
 *   (composer 发送不执行的问题1根因),标记注入让 CLI 走 handlePaste 通路
 * - 会话恢复:--session <session_id>(0.40 id 自带 session_ 前缀);历史列表 =
 *   扫 ~/.kimi-code/sessions 桶下 state.json(按 cwd 过滤)
 */
export const cliKimiPlugin: Plugin = {
  id: "cli-kimi",
  meta: {
    name: "Kimi",
    abbr: "KI",
    desc: "Kimi Code CLI 引擎:kimi-code 会话桶、config 状态",
    icon: KimiGlyph,
    iconColor: "var(--tmd-fg)",
    category: "engine",
  },
  activate(ctx) {
    const profile: CliProfile = {
      id: "kimi",
      docsUrl: "https://moonshotai.github.io/kimi-code/",
      npmPackage: "@moonshot-ai/kimi-code",
      /* 官方原生通道(install.ps1/install.sh 写 ~/.kimi-code/bin)。kimi 双分发:
       * npm TS 版与原生版并存时,PATH 前位的原生副本会遮蔽 npm 副本,npm 通道
       * 永远更不动探针命中的那份 —— 声明脚本通道后更新/安装走官方原生分发,
       * 与探针命中副本同源,版本才同步(win 实证 0.32.0 遮蔽 0.42.0)。
       * npmPackage 保留作 registry 最新版查询。 */
      scriptInstall: {
        unix: "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
        windows: "irm https://code.kimi.com/kimi-code/install.ps1 | iex",
      },
      name: "kimi",
      renderIcon: (size) => <KimiGlyph size={size} />,
      command: "kimi",
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
      suggestions: { command: KIMI_COMMAND_SUGGESTIONS },
      /* 技能真相:扫 ~/.kimi-code/skills + 项目 .kimi-code/skills + ~/.agents/skills
         (目录式与平铺 .md 双形态);kimi 无独立命令概念,命令走静态表 */
      listSuggestions: listKimiSuggestions,
      /* MCP 真相 = ~/.kimi-code/mcp.json + 项目 .kimi-code/mcp.json(dist 实证三层读源,
         旧居 ~/.kimi 无服务器存储不扫);点击 send "/mcp"(状态面板命令,dist 实证)。 */
      listMcpServers: listKimiMcpServers,
      resumeArgs: (sessionId) => ["--session", sessionId],
      bracketedPaste: true,
      modelArg: "--model",
      /* MCP 管理面:全局读写目标 = ~/.kimi-code/mcp.json(mcp-hub 经
         cli-shared/mcpWrite 读写;项目级 overlay 后置)。 */
      mcpGlobalConfig: { candidates: ["/.kimi-code/mcp.json"], format: "json" },
      listSessions: listKimiSessions,
      /* 会话卫生判空:path = 会话目录,wire 双候选位(新布局 agents/main/wire.jsonl,
         老 home 目录直挂 wire.jsonl,见 kimiEmpty.ts)。wire 缺失 = 判不了不删。 */
      isDiskSessionEmpty: (session) =>
        isKimiSessionEmpty(session.path),
      readSessionStatus: () => readKimiConfigStatus(),
      readSessionFileIdentity: readKimiSessionIdentity,
      readDefaultStatus: readKimiConfigStatus,
      readSessionUserMessages: readKimiUserMessages,
      readSessionTranscript: readKimiTranscript,
      /* Ask 卡片标记(pi-tui 系共享字面量,见 cli-shared/askMarks.ts)。 */
      askMarks: PI_TUI_ASK_MARKS,
      /* 用户消息回显标记(pi-tui 系共享字面量,见 cli-shared/echoMarks.ts)。 */
      echoMarks: PI_TUI_ECHO_MARKS,

      /* 待实采:busyMarks/idleMarks 与 omp 同源 pi-tui(见 cli-pi 同款注记;
       * kimi 版 UI 略异,须独立实采,禁照抄)。 */
    };
    /* CLI 学堂课程:43 条内置命令全量入册,消费归 academy 插件(契约见 kernel/academy.ts)。 */
    ctx.registerAcademyCourse(KIMI_ACADEMY_COURSE);
    ctx.registerCliProfile(profile);
  },
};
