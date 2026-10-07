/**
 * session-relay 插件 —— 跨引擎一键接力:当前会话(撞墙/卡死/想换引擎)把
 * 「角色化摘录摘要」带到新引擎的新会话,可预览可编辑再发。
 * 零 AI 调用、零新检测:摘要 = profile 声明的转录读取器(readSessionTranscript,
 * 9 家族全声明)+ kernel/transcriptDigest 确定性压缩。
 * 入口:会话 tab 右键「转到其他引擎接力…」(relayLiveRef 活桥)、异常退出卡
 * (relayOpenRef 快照桥)与命令 `session-relay.to-engine`(设置改键可达;
 * 命令抽屉不收录全局命令,勿再误标)。两入口共用 setRelaySource 开框。
 */

import { ArrowSquareOut } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import type { Plugin } from "@kernel/plugin";
import { RelayLayer } from "./RelayDialog";
import { setRelaySource } from "./relayStore";
import type { RelaySource } from "./relay";
import { relayLiveRef, relayOpenRef } from "@kernel/relayBridge";
import "./locales"; /* 域词典随插件自带:import 即注册 */

/** 组指定会话的接力源;不可接力(shell/ssh/已退出)返回 null。 */
function buildSourceFor(sessionId: string): RelaySource | null {
  const session = host.getSessions().find((s) => s.id === sessionId);
  /* 仅本地 CLI 会话可作源:shell 无 CLI 语义;ssh 的磁盘身份在远端,
     本地读取器读不到历史、新会话也会丢远端 cwd(远端接力二期)。 */
  if (!session || session.kind !== "cli") return null;
  const engineId = session.engine ?? session.profileId;
  return {
    profileId: engineId,
    engineName: host.getCliProfile(engineId)?.name ?? engineId,
    cliSessionId: host.getCliSessionId(sessionId),
    title: session.title,
    model: host.getSessionStatus(sessionId)?.model ?? null,
    /* tab 条是跨工作区 MRU:右键别的工作区的会话接力时,定位磁盘源与新
       会话落位都必须用源会话自己的 cwd/workspaceId(与退出卡路径同语义)。 */
    cwd: session.cwd,
    workspaceId: session.workspaceId,
  };
}

/* 命令语义 = 激活会话接力(全局命令,默认无键位,设置可绑)。 */
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
        const activeId = host.getActiveSessionId();
        const source = activeId ? buildSourceFor(activeId) : null;
        if (source) setRelaySource(source);
      },
    });
    ctx.contribute("overlay", { order: 61, component: RelayLayer });
    /* 开框桥登记:退出卡(快照)与 tab 右键「接力」(活会话)两口;
       停用/熔断经贡献回滚跑 cleanup → null,调用面按 null 闸消钮。 */
    relayOpenRef.current = (detail) => setRelaySource({ ...detail, model: null });
    relayLiveRef.current = (sessionId) => {
      const source = buildSourceFor(sessionId);
      if (source) setRelaySource(source);
    };
    return () => {
      relayOpenRef.current = null;
      relayLiveRef.current = null;
    };
  },
};
