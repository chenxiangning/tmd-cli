/**
 * 外网 tab 门:首次开启前先弹 WebWanRiskDialog 一次性确认(localStorage 记忆,
 * 本机一次性,故意不做跨机同步 —— 风险承诺不该被中继带到陌生设备上)。
 * 接受后渲染真正的 WebWanPane;拒绝则停留在本门(不渲染任何中继控件)。
 */

import { useState } from "react";
import { readWanRiskAccepted } from "./wanRiskAccepted";
import { WebWanRiskDialog } from "./WebWanRiskDialog";
import { WebWanPane } from "./WebWanPane";

export function WebWanGate() {
  const [accepted, setAccepted] = useState(readWanRiskAccepted);

  if (accepted) {
    return <WebWanPane />;
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
