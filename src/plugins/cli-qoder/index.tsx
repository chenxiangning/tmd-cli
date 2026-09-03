import {
  QODER_COMMAND_SUGGESTIONS,
  QoderGlyph,
  listQoderSessions,
  readQoderDefaultStatus,
  readQoderSessionIdentity,
  readQoderSessionStatus,
  readQoderUserMessages,
} from "../cli-shared/qoderSessions";
import type { Plugin } from "@kernel/plugin";

/**
 * Qoder CLI(国际版)插件(本机 qodercli 1.1.33 实证,2026-09-02):
 * - `/` 内置 skill 原生 /name 语法,纯透传;`@`/`$` 未实证,不声明(不猜接口)。
 * - 会话恢复 --resume <uuid>;历史列表扫 ~/.qoder/projects/<slug>/(claude 同构布局)。
 * - 模型/思考强度:会话态 tail 扫 message.model;默认态读 settings.json。
 * - 与国内版(cli-qoder-cn)只差分发渠道常量,磁盘格式知识归 cli-shared/qoderSessions。
 */

/** 国际版分发渠道:二进制名 + 数据目录(npm @qoder-ai/qodercli,docs.qoder.com)。 */
export const QODER_VARIANT = {
  profileId: "qoder",
  command: "qodercli",
  dataDir: ".qoder",
} as const;

export const cliQoderPlugin: Plugin = {
  id: "cli-qoder",
  meta: {
    name: "Qoder",
    abbr: "Q",
    desc: "Qoder CLI 引擎:磁盘会话、模型状态",
    icon: QoderGlyph,
    iconColor: "var(--tmd-fg)",
    category: "engine",
  },
  activate(ctx) {
    ctx.registerCliProfile({
      id: QODER_VARIANT.profileId,
      name: QODER_VARIANT.command,
      renderIcon: (size) => <QoderGlyph size={size} />,
      command: QODER_VARIANT.command,
      args: [],
      triggers: [{ char: "/", kind: "command" }],
      suggestions: QODER_COMMAND_SUGGESTIONS,
      resumeArgs: (sessionId) => ["--resume", sessionId],
      listSessions: (cwd) => listQoderSessions(QODER_VARIANT.dataDir, cwd),
      readSessionStatus: (cwd, cliSessionId) =>
        readQoderSessionStatus(QODER_VARIANT.dataDir, cwd, cliSessionId),
      readSessionFileIdentity: readQoderSessionIdentity,
      readSessionUserMessages: (cwd, cliSessionId, full) =>
        readQoderUserMessages(QODER_VARIANT.dataDir, cwd, cliSessionId, full),
      readDefaultStatus: () => readQoderDefaultStatus(QODER_VARIANT.dataDir),
    });
  },
};
