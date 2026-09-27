/**
 * session-relay 插件 —— 跨引擎一键接力:当前会话(撞墙/卡死/想换引擎)把
 * 「最近用户输入摘要」带到新引擎的新会话,可预览可编辑再发。
 * 零 AI 调用、零新检测:摘要 = profile 声明的用户消息读取器 + 确定性拼装。
 * 入口:命令 `session-relay.to-engine`(命令抽屉/改键可达)与异常退出卡
 * 「转其他引擎接力」按钮;两入口共用 store 开框面(setRelaySource)。
 */

import { ArrowSquareOut } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import type { Plugin } from "@kernel/plugin";
import { RelayLayer } from "./RelayDialog";
import { setRelaySource } from "./relayStore";
import type { RelaySource } from "./relay";
import { relayOpenRef } from "@kernel/relayBridge";
import "./locales"; /* 域词典随插件自带:import 即注册 */

/** 组当前激活 CLI 会话的接力源;不可接力(shell/ssh/无会话)返回 null。 */
function buildActiveSource(): RelaySource | null {
  const sessionId = host.getActiveSessionId();
  const session = sessionId ? host.getSessions().find((s) => s.id === sessionId) : null;
  /* 仅本地 CLI 会话可作源:shell 无 CLI 语义;ssh 的磁盘身份在远端,
     本地读取器读不到历史、新会话也会丢远端 cwd(远端接力二期)。 */
  if (!sessionId || !session || session.kind !== "cli") return null;
  const engineId = session.engine ?? session.profileId;
  return {
    profileId: engineId,
    engineName: host.getCliProfile(engineId)?.name ?? engineId,
    cliSessionId: host.getCliSessionId(sessionId),
    title: session.title,
    model: host.getSessionStatus(sessionId)?.model ?? null,
  };
}

export const sessionRelayPlugin: Plugin = {
  id: "session-relay",
  meta: {
    name: "跨引擎接力",
    abbr: "RL",
    desc: "把当前会话的进度带到另一个引擎的新会话,撞墙不停摆",
    icon: ArrowSquareOut,
    iconColor: "#3FA37C",
    category: "feature",
  },
  activate(ctx) {
    ctx.registerCommand({
      id: "session-relay.to-engine",
      title: t("转到其他引擎接力…"),
      run: () => {
        const source = buildActiveSource();
        if (source) setRelaySource(source);
      },
    });
    ctx.contribute("overlay", { order: 61, component: RelayLayer });
    /* 开框桥登记:app-shell 退出卡经它把接力源(快照)送进对话框;
       停用/熔断经贡献回滚跑 cleanup → null,退出卡即无钮。 */
    relayOpenRef.current = (detail) => setRelaySource({ ...detail, model: null });
    return () => {
      relayOpenRef.current = null;
    };
  },
};
