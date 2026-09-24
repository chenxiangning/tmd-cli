/**
 * 自建服务器中继面板:顶部流程引导 + 部署卡/连接卡横向两卡。
 * 与 Cloudflare tab 共用 WebRelayCard(同一时刻只挂载一个 pane,无状态冲突)。
 * web 端(isWeb)只读。
 */

import { WebRelayCard } from "./WebRelayCard";
import { WebSelfHostCard } from "./WebSelfHostCard";
import { WanStepsCard, type WanStep } from "./WanStepsCard";
import { isWeb } from "@kernel/transport";
import { t } from "@kernel/i18n";

const STEPS: WanStep[] = [
  {
    title: "① 一键部署(只做一次)",
    detail:
      "手边有一台带公网 IP 的服务器(阿里云/腾讯云轻量都行,装好 Node ≥ 18)?" +
      "左卡填它的 IP、SSH 用户名、密码,点「一键部署」:上传中继、签证书、装服务全自动。" +
      "成功后服务器记进「部署历史」,下次点一下就回填,重输密码即可。",
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
      "右卡「手机打开」的地址,手机浏览器直接开,加到主屏幕就当 app 用。" +
      "地址里带的令牌就是钥匙,别转发给别人;用完回这里点「断开」。",
  },
];

export function WebSelfHostPane() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <WanStepsCard steps={STEPS} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <WebSelfHostCard />
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
