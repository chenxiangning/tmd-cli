/**
 * session-relay 插件 —— 跨引擎一键接力:当前会话(撞墙/卡死/想换引擎)把
 * 「最近用户输入摘要」带到新引擎的新会话,可预览可编辑再发。
 * 零 AI 调用、零新检测:摘要 = profile 声明的用户消息读取器 + 确定性拼装。
 * 入口:命令 `session-relay.to-engine`(命令抽屉/改键可达;tab 菜单贡献面
 * 属外壳契约,等价值验证后再议 —— 见 openspec 提案取舍)。
 */

import { ArrowSquareOut } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import type { Plugin } from "@kernel/plugin";
import { RelayDialog } from "./RelayDialog";
import { clearRelaySource, setRelaySource, useRelaySource } from "./relayStore";
import type { RelaySource } from "./relay";
import "./locales"; /* 域词典随插件自带:import 即注册 */

/** overlay 挂点渲染件:有源才挂对话框。 */
function RelayHost() {
  const source = useRelaySource();
  if (!source) return null;
  return <RelayDialog source={source} onClose={clearRelaySource} />;
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
        const sessionId = host.getActiveSessionId();
        const session = sessionId ? host.getSessions().find((s) => s.id === sessionId) : null;
        if (!sessionId || !session || session.kind === "shell") return;
        const engineId = session.engine ?? session.profileId;
        const source: RelaySource = {
          profileId: engineId,
          engineName: host.getCliProfile(engineId)?.name ?? engineId,
          cliSessionId: host.getCliSessionId(sessionId),
          title: session.title,
          model: host.getSessionStatus(sessionId)?.model ?? null,
        };
        setRelaySource(source);
      },
    });
    ctx.contribute("overlay", { order: 61, component: RelayHost });
  },
};
