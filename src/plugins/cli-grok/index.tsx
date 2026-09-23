import {
  grokUserMessageLine,
  readUserMessagesFromFile,
} from "../cli-shared/userMessages";
import { isJsonlSessionEmpty } from "../cli-shared/sessionEmpty";
import {
  readGrokDefaultStatus,
} from "./configStatus";
import { readGrokSessionEdits } from "./edits";
import { fetchGrokQuota } from "./quota";
import type { CliProfile, CliSuggestion } from "@kernel/cli";
import type { Plugin } from "@kernel/plugin";
import { listGrokSuggestions } from "./inspectSkills";
import {
  grokSessionsDir,
  listGrokSessions,
  readGrokSessionIdentity,
  readGrokSessionStatus,
} from "./sessions";

/* 纯函数兼容再导出(index.test.ts 消费面不变);实现在 ./sessions。 */
export { grokSessionsDirName, parseGrokSummary } from "./sessions";

/**
 * grok / 命令候选(官方 README 斜杠命令表;action 初判见
 * openspec/changes/composer-command-drawer,/model /load 等 picker 类已拍板 send)。
 */
export const GROK_COMMAND_SUGGESTIONS: CliSuggestion[] = [
  { value: "model", description: "查看/切换模型(幕布内 picker)", action: "send", icon: "model" },
  { value: "new", description: "新建会话(清空上下文)", action: "send", icon: "compact" },
  { value: "load", description: "恢复历史会话(幕布内 picker)", action: "send", icon: "resume" },
  { value: "compact", description: "压缩会话上下文", action: "send", icon: "compact" },
  { value: "skills", description: "查看/注入技能", action: "send", icon: "skills" },
  { value: "plugins", description: "管理插件", action: "send", icon: "plugins" },
];

/**
 * grok 品牌 glyph:xAI 官方斜杠标志(vendored 自 grok-build-vscode media/grok.svg,
 * 与 omp/claude glyph 同源策略;viewBox 0 0 24 24 官方一致)。
 * 官方为单色 mark → 全对比度随主题(浅色黑/深色白),不再随容器灰化,evenodd 官方一致。
 */
const GROK_ICON_PATH =
  "M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815" as const;

function GrokGlyph({ size }: { size: number | string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="var(--tmd-fg)"
      style={{ width: size, height: size, flexShrink: 0 }}
      aria-hidden
    >
      <path d={GROK_ICON_PATH} fillRule="evenodd" />
    </svg>
  );
}

/** grok 文件路径由会话目录布局直接可得,免扫目录。 */
async function readGrokUserMessages(cwd: string, cliSessionId: string, full: boolean) {
  const dir = await grokSessionsDir(cwd);
  if (!dir) return null;
  return readUserMessagesFromFile(
    `${dir}/${cliSessionId}/chat_history.jsonl`,
    full,
    grokUserMessageLine,
  );
}


/**
 * grok CLI 插件(xAI Grok Build,CLI 能力矩阵 + 本机 1.0.4 实证):
 * - `/` 命令、`@` 文件引用:官方文档明载,纯透传。
 * - `$` skill:grok 原生 skill 注入入口是 /skills <name>(README 斜杠命令表),
 *   发送时翻译(同 omp 的 $→/skill: 方案)。
 * - 会话恢复:grok --resume <uuid>;历史列表 = 扫 grok 自己的 sessions 目录。
 */
export const cliGrokPlugin: Plugin = {
  id: "cli-grok",
  meta: {
    name: "Grok",
    abbr: "GK",
    desc: "Grok Build 引擎:会话扫描、配额、状态",
    icon: GrokGlyph,
    iconColor: "var(--tmd-fg)",
    category: "engine",
  },
  activate(ctx) {
    /* 命令/技能真相:listSuggestions 磁盘扫描,激活不等待扫盘(2 次 IPC);
       profile 立刻可用,候选按需查询(与 cli-claude 同法)。 */
    const profile: CliProfile = {
      id: "grok",
      fetchQuota: fetchGrokQuota,
      // 官方 install.sh 走 x.ai(Cloudflare 墙),npm 通道更稳。
      docsUrl: "https://github.com/xai-org/grok-build",
      npmPackage: "@xai-official/grok",
      name: "grok",
      renderIcon: (size: number | string) => <GrokGlyph size={size} />,
      command: "grok",
      args: [],
      triggers: [
        { char: "/", kind: "command" },
        { char: "@", kind: "file" },
        {
          char: "$",
          kind: "skill",
          translate: (token: string) => `/skills ${token.replace(/^\$/, "")}`,
        },
      ],
      suggestions: {
        command: GROK_COMMAND_SUGGESTIONS,
        skill: [],
      },
      /* 命令/技能真相:grok inspect --json 枚举全层技能(用户/项目/兼容/插件);
         命令不可枚举 → listSuggestions 只供 skill,command 走静态表 */
      listSuggestions: listGrokSuggestions,
      resumeArgs: (sessionId) => ["--resume", sessionId],
      listSessions: listGrokSessions,
      /* 会话卫生判空:path = 会话目录,真实对话在 chat_history.jsonl
         (读不到 = 判不了,共享 helper 契约返回 false 不删)。 */
      isDiskSessionEmpty: (session) => isJsonlSessionEmpty(`${session.path}/chat_history.jsonl`),
      readSessionStatus: readGrokSessionStatus,
      readSessionFileIdentity: readGrokSessionIdentity,
      readSessionUserMessages: readGrokUserMessages,
      readSessionEdits: readGrokSessionEdits,
      readDefaultStatus: readGrokDefaultStatus,
    };
    ctx.registerCliProfile(profile);
  },
};
