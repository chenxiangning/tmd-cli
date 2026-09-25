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
    title: "① 部署中继(只做一次)",
    detail:
      "没有自己的服务器就走这条:中继跑在你自己的 Cloudflare 账号上(免费额度就够)," +
      "只搬字节、不存内容。左卡贴上 Cloudflare API Token 点「立即部署」," +
      "地址和密钥自动填进右卡;Token 只用这一次,不保存。",
  },
  {
    title: "② 连接中继(每次用前)",
    detail:
      "右卡点「连接中继」(地址和密钥上一步已自动填好)。圆点变绿,手机就能从外网连上这台电脑;" +
      "内网桥顺带打开,不用先去内网 tab。",
  },
  {
    title: "③ 手机打开地址",
    detail:
      "右卡「手机打开」的地址,手机 Safari 直接开,加到主屏幕就当 app 用。" +
      "地址里带的令牌就是钥匙,别转发给别人;用完回这里点「断开」。",
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
