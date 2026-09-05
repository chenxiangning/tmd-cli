import type { Plugin } from "@kernel/plugin";
import {
  listOpencodeSessions,
  readOpencodeSessionEdits,
  readOpencodeSessionIdentity,
  readOpencodeSessionStatus,
  readOpencodeUserMessages,
} from "./db";
import { opencodeDefaultModel, opencodeMcpSuggestions, readOpencodeConfig } from "./config";
import { listOpencodeSuggestions, OPENCODE_COMMAND_SUGGESTIONS } from "./commands";

/**
 * opencode CLI 插件(anomalyco/opencode,本机 1.18.25 实证,2026-09-05):
 * - TUI 即默认命令(`opencode [project]`),会话恢复 `-s/--session <id>`;
 * - 触发符:`/` 命令(内置 + commands/*.md + JSON 命令)、`@` 文件引用(fuzzy);
 *   `!` bash 前缀不属于 composer kind,不声明;
 * - 会话存储单库 SQLite(~/.local/share/opencode/opencode.db,WAL),读写分离
 *   经内核只读原语 sqliteQuery;表结构知识全部在 ./db.ts;
 * - 身份绑定用合成路径 <db>#<sessionId> 拆包查库(单库多会话,mtime 必串线);
 * - checkpoints events 归因:part 表已完成 write/edit 工具部件(./db.ts);
 * - 不声明 editMarks/askMarks(PTY 面板字面量未实证)、bracketedPaste(非 pi-tui)、
 *   fetchQuota(多供应商无统一额度接口;凭据盘点见 cli-shared/opencodeAuth)。
 */

/**
 * opencode 品牌 glyph:vendored 自官方 favicon.svg(opencode.ai,2026-09-05)。
 * 官方为白框 + 灰色内块双色 mark → 框随 currentColor,内块用 --tmd-fg-muted。
 */
function OpenCodeGlyph({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 512 512"
      style={{ width: size, height: size, flexShrink: 0 }}
      aria-hidden
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z"
      />
      <rect x="192" y="224" width="128" height="128" fill="var(--tmd-fg-muted)" />
    </svg>
  );
}

export const cliOpencodePlugin: Plugin = {
  id: "cli-opencode",
  meta: {
    name: "OpenCode",
    abbr: "OC",
    desc: "OpenCode CLI 引擎:SQLite 会话、模型状态",
    icon: OpenCodeGlyph,
    iconColor: "var(--tmd-fg)",
    category: "engine",
  },
  activate(ctx) {
    ctx.registerCliProfile({
      id: "opencode",
      docsUrl: "https://opencode.ai/docs",
      npmPackage: "opencode-ai",
      name: "opencode",
      renderIcon: (size) => <OpenCodeGlyph size={size} />,
      command: "opencode",
      args: [],
      triggers: [
        { char: "/", kind: "command" },
        { char: "@", kind: "file" },
      ],
      suggestions: { command: OPENCODE_COMMAND_SUGGESTIONS },
      listSuggestions: (_kind, cwd) => listOpencodeSuggestions(cwd),
      listMcpServers: async (cwd) => {
        const config = await readOpencodeConfig(cwd).catch(() => null);
        const items = opencodeMcpSuggestions(config);
        return items.length ? items : null;
      },
      resumeArgs: (sessionId) => ["--session", sessionId],
      listSessions: listOpencodeSessions,
      readSessionStatus: readOpencodeSessionStatus,
      readSessionFileIdentity: readOpencodeSessionIdentity,
      readSessionUserMessages: readOpencodeUserMessages,
      readSessionEdits: readOpencodeSessionEdits,
      readDefaultStatus: async (cwd) => {
        const config = await readOpencodeConfig(cwd).catch(() => null);
        const model = opencodeDefaultModel(config);
        return model ? { model } : null;
      },
    });
  },
};

