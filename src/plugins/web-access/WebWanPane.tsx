/**
 * 外网中继面板:顶部流程引导 + 部署卡/连接卡横向两卡。
 * web 端(isWeb)只读。
 */

import { WebRelayCard } from "./WebRelayCard";
import { WebRelayDeployCard } from "./WebRelayDeployCard";
import { isWeb } from "@kernel/transport";
import { t } from "@kernel/i18n";

const STEPS: { title: string; detail: string }[] = [
  {
    title: "① 部署中继(一次性)",
    detail:
      "中继是跑在你自己 Cloudflare 账号的 Worker(免费额度够),只做字节转发、零存储。" +
      "左卡任选一种:填 Cloudflare API Token 一键部署,或导 zip 到你的 ECS / 任意机器 wrangler deploy。",
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

export function WebWanPane() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="rounded border border-[var(--tmd-border)] bg-[var(--tmd-surface-1)] px-3 py-2">
        <div className="mb-1.5 text-xs font-medium text-[var(--tmd-fg)]">
          {t("使用流程")}
        </div>
        <ol className="flex flex-col gap-1.5">
          {STEPS.map((s) => (
            <li key={s.title} className="text-xs leading-relaxed">
              <span className="font-medium text-[var(--tmd-fg)]">
                {t(s.title)}
              </span>
              <span className="ml-1.5 text-[var(--tmd-fg-muted)]">
                {t(s.detail)}
              </span>
            </li>
          ))}
        </ol>
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
