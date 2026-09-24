/**
 * Cloudflare 中继面板:顶部流程引导 + 部署卡/连接卡横向两卡。
 * 只讲 Worker 一键部署路线(自建服务器落点见 WebSelfHostPane)。
 * web 端(isWeb)只读。
 */

import { WebRelayCard } from "./WebRelayCard";
import { WebRelayDeployCard } from "./WebRelayDeployCard";
import { WanStepsCard, type WanStep } from "./WanStepsCard";
import { isWeb } from "@kernel/transport";
import { t } from "@kernel/i18n";

const STEPS: WanStep[] = [
  {
    title: "① 部署中继(一次性)",
    detail:
      "中继是跑在你自己 Cloudflare 账号的 Worker(免费额度够),只做字节转发、零存储。" +
      "左卡填 Cloudflare API Token 点「立即部署」即可,Token 仅本次使用、不保存。",
  },
  {
    title: "② 连接中继(每次用前)",
    detail:
      "右卡填中继 URL 和密钥(一键部署会自动回填),点「连接中继」。桌面会主动外拨一条加密长连,状态点转绿即外网可达。" +
      "会顺带打开内网桥,不用先去内网 tab。",
  },
  {
    title: "③ 手机打开外网地址",
    detail:
      "连接成功后,右卡「手机打开」里的地址已带访问令牌,手机 Safari 直接开," +
      "加到主屏幕即当 app 用。令牌=门禁,别转发;用完回这里点「断开」。",
  },
];

export function WebCfPane() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <WanStepsCard steps={STEPS} />
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
