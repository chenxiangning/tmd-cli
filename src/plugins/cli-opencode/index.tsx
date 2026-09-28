import { OpenCodeGlyph } from "../cli-shared/engineGlyphs";
import type { Plugin } from "@kernel/plugin";
import {
  deleteOpencodeSession,
  isOpencodeSessionEmpty,
  listOpencodeSessions,
  readOpencodeSessionEdits,
  readOpencodeSessionIdentity,
  readOpencodeSessionStatus,
  readOpencodeUserMessages,
} from "./db";
import { opencodeDefaultModel, readOpencodeConfig } from "./config";
import { listOpencodeSuggestions, OPENCODE_COMMAND_SUGGESTIONS } from "./commands";
import { OPENCODE_ACADEMY_COURSE } from "./academy/academyCatalog";
import { readOpencodeTranscript } from "./opencodeTranscript";
import type { CliDiskSession, CliSessionTranscript } from "@kernel/cli";

/** 会话完整转录:合成路径 <db>#<sessionId> 拆包查库(身份自证同款)。 */
async function readOpencodeSessionTranscript(
  session: CliDiskSession,
): Promise<CliSessionTranscript | null> {
  const hash = session.path.lastIndexOf("#");
  if (hash < 0) return null;
  const db = session.path.slice(0, hash);
  const blocks = await readOpencodeTranscript(db, session.path.slice(hash + 1));
  return blocks ? { blocks } : null;
}

/**
 * opencode CLI 插件(anomalyco/opencode,本机 1.18.25 实证,2026-09-05):
 * - TUI 即默认命令(`opencode [project]`),会话恢复 `-s/--session <id>`;
 * - 会话存储单库 SQLite(~/.local/share/opencode/opencode.db,WAL),读写分离
 *   经内核只读原语 sqliteQuery;表结构知识全部在 ./db.ts;
 * - 身份绑定用合成路径 <db>#<sessionId> 拆包查库(单库多会话,mtime 必串线);
 * - checkpoints events 归因:part 表已完成 write/edit 工具部件(./db.ts);
 * - 不声明 editMarks/askMarks(PTY 面板字面量未实证)、bracketedPaste(非 pi-tui)、
 *   fetchQuota(多供应商无统一额度接口;凭据盘点见 cli-shared/opencodeDisk)。
 */

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
    /* CLI 学堂课程:29 内置斜杠命令(真源 = 二进制注册表,见 academy/academyCatalog.ts 头注)。 */
    ctx.registerAcademyCourse(OPENCODE_ACADEMY_COURSE);
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
      resumeArgs: (sessionId) => ["--session", sessionId],
      deleteSession: deleteOpencodeSession,
      listSessions: listOpencodeSessions,
      /* 会话卫生判空:message 表 role=user 计数(sqlite 代读,库不可用 = 不删)。 */
      isDiskSessionEmpty: (session) => isOpencodeSessionEmpty(session.path),
      readSessionStatus: readOpencodeSessionStatus,
      readSessionFileIdentity: readOpencodeSessionIdentity,
      readSessionUserMessages: readOpencodeUserMessages,
      readSessionTranscript: readOpencodeSessionTranscript,
      readSessionEdits: readOpencodeSessionEdits,
      readDefaultStatus: async (cwd) => {
        const config = await readOpencodeConfig(cwd).catch(() => null);
        const model = opencodeDefaultModel(config);
        return model ? { model } : null;
      },
    });
  },
};

