import { ipc } from "@kernel/ipc";
import type {
  CliProfile,
  CliSessionStatus,
  CliSuggestion,
} from "@kernel/cli";
import type { Plugin } from "@kernel/plugin";
import { PI_TUI_ASK_MARKS } from "../cli-shared/askMarks";
import { listKimiSuggestions } from "./scanSuggestions";
import {
  listKimiSessions,
  readKimiSessionIdentity,
  readKimiUserMessages,
} from "./kimiSessions";

/* 磁盘会话存储扫描与 wire/state 纯函数拆至 kimiSessions.ts(文件规模铁则);
   此处 re-export 维持既有导入契约(index.test.ts 从 ./index 直取)。 */
export {
  extractKimiTitle,
  kimiStateTitle,
  kimiUserMessageLine,
  matchKimiStatePath,
  normalizeKimiTitle,
  parseKimiState,
} from "./kimiSessions";

/**
 * Kimi 品牌 glyph:几何 K 字monogram(codemoss EngineIcon 同源策略),
 * 全对比度随主题(浅黑/深白,用户指定)。
 */
const KIMI_ICON_PATH =
  "M5 3h4v6.6L14.6 3H20l-6.9 8.3L20 21h-5.5L9 12.9V21H5z" as const;

function KimiGlyph({ size }: { size: number | string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path d={KIMI_ICON_PATH} fill="var(--tmd-fg)" />
    </svg>
  );
}

/**
 * config.toml → 默认模型/思考强度(纯函数,可测)。
 * 行级最小解析(不引入 toml 依赖):配置面只消费这几个键,契约由单测守护。
 * 思考键双代并存:0.40 后期起为 [thinking] 段(enabled 布尔 + effort 档位,
 * 实证本机 config.toml),更早为 default_thinking 布尔 → 映射 "on"/"off"。
 * [thinking] 段优先于旧键;全缺 → thinkingLevel undefined,工具栏显示 "—"。
 */
export function parseKimiConfigStatus(configToml: string): CliSessionStatus | null {
  const model = configToml.match(/^default_model\s*=\s*"([^"]+)"/m)?.[1];
  const legacy = configToml.match(/^default_thinking\s*=\s*(true|false)/m)?.[1];
  const section = configToml.match(/^\[thinking\]\s*\n((?:[^\[].*\n?|\n.*)*?)(?=^\[|\s*$)/m)?.[1];
  const enabled = section?.match(/^enabled\s*=\s*(true|false)\s*$/m)?.[1];
  const effort = section?.match(/^effort\s*=\s*"([^"]+)"/m)?.[1];
  let thinkingLevel: string | undefined;
  if (enabled === "false") {
    thinkingLevel = "off";
  } else if (effort) {
    thinkingLevel = effort;
  } else if (legacy !== undefined) {
    thinkingLevel = legacy === "true" ? "on" : "off";
  }
  if (!model && thinkingLevel === undefined) return null;
  return { model, thinkingLevel };
}

/**
 * 读取模型/思考强度。kimi 的模型真相只在全局 config.toml(实证 0.40:
 * /model 写配置并热重载,wire.jsonl 无模型事件)→ 会话态与默认态同源。
 * home 迁移双路径:~/.kimi-code 优先,老 ~/.kimi 兜底(键型一致)。
 */
async function readKimiConfigStatus(): Promise<CliSessionStatus | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  for (const path of [
    `${home}/.kimi-code/config.toml`,
    `${home}/.kimi/config.toml`,
  ]) {
    const text = await ipc.fsReadFile(path).catch(() => null);
    const status = text ? parseKimiConfigStatus(text) : null;
    if (status) return status;
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
      resumeArgs: (sessionId) => ["--session", sessionId],
      bracketedPaste: true,
      listSessions: listKimiSessions,
      readSessionStatus: () => readKimiConfigStatus(),
      readSessionFileIdentity: readKimiSessionIdentity,
      readDefaultStatus: readKimiConfigStatus,
      readSessionUserMessages: readKimiUserMessages,
      /* Ask 卡片标记(pi-tui 系共享字面量,见 cli-shared/askMarks.ts)。 */
      askMarks: PI_TUI_ASK_MARKS,
    };
    ctx.registerCliProfile(profile);
  },
};
