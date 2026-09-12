/**
 * qoder 双分发版插件装配 —— 由分发渠道常量构造完整 Qoder 插件,两版插件目录
 * 只剩常量声明。自 qoderSessions.tsx 拆出(only-export-components):本文件只留
 * 装配工厂与变体契约,品牌组件在 qoderSessions.tsx,域逻辑在 qoderSessionModel.ts。
 */

import type { Plugin } from "@kernel/plugin";
import { QoderGlyph } from "./qoderSessions";
import {
  QODER_COMMAND_SUGGESTIONS,
  listQoderSessions,
  readQoderDefaultStatus,
  readQoderSessionIdentity,
  readQoderSessionStatus,
  readQoderUserMessages,
} from "./qoderSessionModel";
import { listQoderSuggestions } from "./qoderSuggestions";

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
        resumeArgs: (sessionId) => ["--resume", sessionId],
        listSessions: (cwd) => listQoderSessions(variant.dataDir, cwd),
        readSessionStatus: (cwd, cliSessionId) =>
          readQoderSessionStatus(variant.dataDir, cwd, cliSessionId),
        readSessionFileIdentity: readQoderSessionIdentity,
        readSessionUserMessages: (cwd, cliSessionId, full) =>
          readQoderUserMessages(variant.dataDir, cwd, cliSessionId, full),
        readDefaultStatus: () => readQoderDefaultStatus(variant.dataDir),
      });
    },
  };
}
