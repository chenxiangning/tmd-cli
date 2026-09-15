/**
 * 外网中继面板:部署卡 + 连接卡横向两卡(部署仅供首次/换账号时用,
 * 常态交互是连接卡);web 端(isWeb)只读。
 */

import { WebRelayCard } from "./WebRelayCard";
import { WebRelayDeployCard } from "./WebRelayDeployCard";
import { isWeb } from "@kernel/transport";
import { t } from "@kernel/i18n";

export function WebWanPane() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="text-xs text-[var(--tmd-fg-muted)]">
        {t("外网访问 = 桌面主动外拨中继,零入站端口。中继跑在你自己的 Cloudflare 账号(免费额度够),也可自建/换 frp/cloudflared。")}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <WebRelayDeployCard />
        <WebRelayCard />
      </div>
      {isWeb && (
        <div className="text-xs text-[var(--tmd-fg-muted)]">
          {t("当前为 Web 只读视图:中继的部署/连接/断开只能在桌面端操作。")}
        </div>
      )}
    </div>
  );
}
