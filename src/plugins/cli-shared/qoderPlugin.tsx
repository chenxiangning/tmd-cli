/**
 * qoder 双分发版插件装配 —— 由分发渠道常量构造完整 Qoder 插件,两版插件目录
 * 只剩常量声明。自 qoderSessions.tsx 拆出(only-export-components):本文件只留
 * 装配工厂与变体契约,品牌组件在 qoderSessions.tsx,域逻辑在 qoderSessionModel.ts。
 */

import type { Plugin } from "@kernel/plugin";
import { QoderGlyph } from "./engineGlyphs";
import {
  QODER_COMMAND_SUGGESTIONS,
  listQoderSessions,
  readQoderDefaultStatus,
  readQoderSessionIdentity,
  readQoderSessionStatus,
  readQoderTranscript,
  readQoderUserMessages,
} from "./qoderSessionModel";
import { claudeTranscriptLine } from "./claudeTranscript";
import { makeTranscriptTailReader } from "./sessionTranscript";
import { isJsonlSessionEmpty } from "./sessionEmpty";
import { listQoderSuggestions } from "./qoderSuggestions";
import { listQoderMcpServers } from "./qoderMcp";

/** 双分发版的差异面:插件身份 + 展示文案 + 分发渠道常量,其余接线完全同构。 */
interface QoderVariantSpec {
  /** 插件 id(cli-qoder / cli-qoder-cn)。 */
  id: string;
  /** 展示元数据:name/abbr/desc(icon/iconColor/category 两版一致,工厂内固定)。 */
  meta: { name: string; abbr: string; desc: string };
  profileId: string;
  command: string;
  dataDir: string;
  docsUrl: string;
  npmPackage: string;
  /** 就地自更新通道(实证 CLI 自带 update 子命令才声明;未装机器走 npm 安装)。 */
  commandUpdate?: { program: string; args: string[] };
}

/** 由分发渠道常量构造完整 Qoder 插件;两版插件目录只剩常量声明。 */
export function makeQoderPlugin(variant: QoderVariantSpec): Plugin {
  return {
    id: variant.id,
    meta: {
      name: variant.meta.name,
      abbr: variant.meta.abbr,
      desc: variant.meta.desc,
      icon: QoderGlyph,
      iconColor: "var(--tmd-fg)",
      category: "engine",
    },
    activate(ctx) {
      ctx.registerCliProfile({
        id: variant.profileId,
        docsUrl: variant.docsUrl,
        npmPackage: variant.npmPackage,
        commandUpdate: variant.commandUpdate,
        name: variant.command,
        renderIcon: (size) => <QoderGlyph size={size} />,
        command: variant.command,
        args: [],
        triggers: [
          { char: "/", kind: "command" },
          {
            char: "$",
            kind: "skill",
            translate: (token: string) => `/${token.replace(/^\$/, "")}`,
          },
        ],
        suggestions: QODER_COMMAND_SUGGESTIONS,
        /* 命令/技能真相:扫 .qoder/commands 与 .qoder/skills + .agents/skills 兼容层 */
        listSuggestions: listQoderSuggestions,
        /* MCP 真相 = <dataDir>/shared_client/mcp.json(本机实证标准 mcpServers 形状;
           项目级未实证不猜)。点击 = 展示性 insert(TUI 命令未实证,禁向幕布写 wire)。
           双分发版经本工厂一次覆盖。 */
        listMcpServers: () => listQoderMcpServers(variant.dataDir),
        resumeArgs: (sessionId) => ["--resume", sessionId],
        listSessions: (cwd) => listQoderSessions(variant.dataDir, cwd),
        /* MCP 管理面:全局读写目标 = <dataDir>/shared_client/mcp.json(与
           listMcpServers 同源;双分发版经本工厂一次覆盖)。 */
        mcpGlobalConfig: {
          candidates: [`/${variant.dataDir}/shared_client/mcp.json`],
          format: "json",
        },
        /* 会话卫生判空:path 即 <uuid>.jsonl,共享标记子串判定(sessionEmpty.ts) */
        isDiskSessionEmpty: (session) => isJsonlSessionEmpty(session.path),
        readSessionStatus: (cwd, cliSessionId) =>
          readQoderSessionStatus(variant.dataDir, cwd, cliSessionId),
        readSessionFileIdentity: readQoderSessionIdentity,
        readSessionUserMessages: (cwd, cliSessionId, full) =>
          readQoderUserMessages(variant.dataDir, cwd, cliSessionId, full),
        readSessionTranscript: readQoderTranscript,
        readTranscriptTail: makeTranscriptTailReader(claudeTranscriptLine("qoder")),
        readDefaultStatus: () => readQoderDefaultStatus(variant.dataDir),
      });
    },
  };
}
