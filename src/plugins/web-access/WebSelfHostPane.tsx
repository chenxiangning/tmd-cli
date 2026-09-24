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
    title: "① 一键部署(一次性)",
    detail:
      "给你一台有公网 IP 的服务器(Node ≥ 18,SSH 可达),左卡填 SSH 信息点「一键部署」:" +
      "桌面自动上传中继服务、现场签发 443 TLS 证书、装 systemd、健康自检。凭据只进本次调用,不保存。",
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
      "连接成功后,右卡「手机打开」里的地址已带访问令牌,手机浏览器直接开,加到主屏幕即当 app 用。" +
      "自签证书由两端证书钉住校验,换服务器重新部署+重新扫码即可。令牌=门禁,别转发;用完回这里点「断开」。",
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
