/**
 * 外网 tab 门:首次开启前先弹 WebWanRiskDialog 一次性确认(localStorage 记忆,
 * 本机一次性,故意不做跨机同步 —— 风险承诺不该被中继带到陌生设备上)。
 * 接受后渲染传入的 Pane(Cloudflare/自建两 tab 各包一次;确认态全局共享,
 * 只弹一次);拒绝则停留在本门(不渲染任何中继控件)。
 */

import { useState, type ComponentType } from "react";
import { readWanRiskAccepted } from "./wanRiskAccepted";
import { WebWanRiskDialog } from "./WebWanRiskDialog";

export function WebWanGate({ Pane }: { Pane: ComponentType }) {
  const [accepted, setAccepted] = useState(readWanRiskAccepted);

  if (accepted) {
    return <Pane />;
  }
  return (
    <WebWanRiskDialog
      onAccept={() => setAccepted(true)}
      onReject={() => {
        /* 停留在本门;tab 切换由 settings 壳处理,这里不主动跳走。 */
      }}
    />
  );
}
